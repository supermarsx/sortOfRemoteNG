// Portable regression model, NOT Chromium/CEF execution. The runner injects
// the exact maintained before/after UntraceImpl, substituting an instrumented
// std::map allocator and mutex. No PartitionAlloc, GWP-ASan or BRP is linked.
#include <array>
#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <thread>
#include <type_traits>
#include <vector>

#define PA_CHECK(value) do { if (!(value)) std::abort(); } while (false)

namespace {
thread_local bool storage_lock_held = false;
thread_local void (*on_node_deallocate)() = nullptr;
thread_local uint64_t outer_id = 0;
thread_local uint64_t nested_id = 0;
std::atomic<unsigned> locked_deallocations{0};
std::atomic<unsigned> callback_count{0};
std::atomic<unsigned> callback_failures{0};
std::atomic<unsigned> allocations{0};
std::atomic<unsigned> deallocations{0};
unsigned checks = 0;

void Check(bool condition, const char* message) {
  ++checks;
  if (!condition) {
    std::cerr << "CHECK FAILED: " << message << '\n';
    std::exit(1);
  }
}

class ObservedMutex {
 public:
  void lock() {
    // The free hook detects same-thread recursion BEFORE calling UntraceImpl,
    // so the unfixed baseline fails deterministically instead of deadlocking.
    PA_CHECK(!storage_lock_held);
    mutex_.lock();
    storage_lock_held = true;
  }
  void unlock() {
    storage_lock_held = false;
    mutex_.unlock();
  }
 private:
  std::mutex mutex_;
};

template <class T>
struct ObservedAllocator {
  using value_type = T;
  using is_always_equal = std::true_type;
  ObservedAllocator() = default;
  template <class U> ObservedAllocator(const ObservedAllocator<U>&) noexcept {}
  T* allocate(std::size_t count) {
    allocations.fetch_add(static_cast<unsigned>(count));
    return std::allocator<T>{}.allocate(count);
  }
  void deallocate(T* pointer, std::size_t count) noexcept {
    auto callback = on_node_deallocate;
    on_node_deallocate = nullptr;  // One shot; nested deletion cannot recurse forever.
    if (callback) {
      if (storage_lock_held) {
        locked_deallocations.fetch_add(1);
      } else {
        callback_count.fetch_add(1);
        callback();
      }
    }
    deallocations.fetch_add(static_cast<unsigned>(count));
    std::allocator<T>{}.deallocate(pointer, count);
  }
};
template <class T, class U>
bool operator==(const ObservedAllocator<T>&, const ObservedAllocator<U>&) { return true; }
template <class T, class U>
bool operator!=(const ObservedAllocator<T>&, const ObservedAllocator<U>&) { return false; }

// Same scalar/array ownership as pinned Info. Real stack collection is omitted;
// its allocation/reentrancy behavior is explicitly outside this model.
struct Info {
  uintptr_t slot_count;
  bool may_dangle;
  std::array<const void*, 32> stack_trace{};
};
static_assert(std::is_trivially_destructible_v<Info>);
using Storage = std::map<uint64_t, Info, std::less<uint64_t>,
                         ObservedAllocator<std::pair<const uint64_t, Info>>>;
Storage& GetStorage() {
  static Storage storage;
  return storage;
}
ObservedMutex& GetStorageMutex() {
  static ObservedMutex mutex;
  return mutex;
}
class InstanceTracer {
 public:
  static void UntraceImpl(uint64_t owner_id);
};

// EXACT_MAINTAINED_UNTRACE_FUNCTION

void Trace(uint64_t id, uintptr_t slot, bool may_dangle = false) {
  const std::lock_guard guard(GetStorageMutex());
  GetStorage().try_emplace(id, Info{slot, may_dangle, {}});
}
bool Contains(uint64_t id) {
  const std::lock_guard guard(GetStorageMutex());
  return GetStorage().find(id) != GetStorage().end();
}
std::size_t Visible(uintptr_t slot) {
  const std::lock_guard guard(GetStorageMutex());
  std::size_t count = 0;
  for (const auto& entry : GetStorage()) {
    if (entry.second.slot_count == slot && !entry.second.may_dangle) ++count;
  }
  return count;
}
void NestedUntrace() {
  if (Contains(outer_id)) callback_failures.fetch_add(1);
  InstanceTracer::UntraceImpl(nested_id);
  if (Contains(nested_id)) callback_failures.fetch_add(1);
}
void ReinsertSameOwner() {
  if (Contains(outer_id)) callback_failures.fetch_add(1);
  Trace(outer_id, 222);
}
void Arm(uint64_t outer, uint64_t nested, void (*callback)() = NestedUntrace) {
  outer_id = outer;
  nested_id = nested;
  on_node_deallocate = callback;
}
}  // namespace

int main() {
  // Ordinary ownership/removal and diagnostic filtering are unchanged.
  Trace(1, 100);
  Trace(2, 100, true);
  Trace(3, 200);
  Check(Visible(100) == 1 && Visible(200) == 1, "may_dangle filter preserved");
  InstanceTracer::UntraceImpl(999);
  Check(Contains(1) && Contains(2) && Contains(3), "unknown owner is a no-op");
  InstanceTracer::UntraceImpl(1);
  InstanceTracer::UntraceImpl(1);
  Check(Visible(100) == 0 && Contains(2) && Contains(3), "exact owner only removed");
  InstanceTracer::UntraceImpl(2);
  InstanceTracer::UntraceImpl(3);

  // This is the observed shape: deallocation re-enters even for an owner that
  // was never traced (raw_ref can untrace a non-BRP-pool address).
  Trace(10, 100);
  Arm(10, 999);
  InstanceTracer::UntraceImpl(10);
  if (locked_deallocations.load() != 0) {
    std::cout << "BASELINE_REENTRANT_FREE_UNDER_LOCK: nested Untrace would deadlock\n";
    return 42;
  }
  Check(callback_count.load() == 1, "missing-owner nested Untrace really executed");

  Trace(20, 100);
  Trace(21, 100);
  Trace(22, 200);
  Arm(20, 21);
  InstanceTracer::UntraceImpl(20);
  Check(!Contains(20) && !Contains(21) && Contains(22), "nested existing owner removed only");
  Check(callback_count.load() == 2, "existing-owner nested Untrace really executed");
  InstanceTracer::UntraceImpl(22);

  Trace(30, 111);
  Arm(30, 0, ReinsertSameOwner);
  InstanceTracer::UntraceImpl(30);
  Check(Contains(30) && Visible(111) == 0 && Visible(222) == 1,
        "old node destruction cannot erase a same-key replacement");
  InstanceTracer::UntraceImpl(30);

  // Independent owners may remove nodes concurrently; all mutation still uses
  // the original mutex, while allocator callback reentry occurs after unlock.
  constexpr unsigned threads = 4;
  constexpr unsigned per_thread = 64;
  for (unsigned index = 0; index < threads * per_thread; ++index) Trace(1000 + index, 300);
  std::vector<std::thread> workers;
  for (unsigned worker = 0; worker < threads; ++worker) {
    workers.emplace_back([worker] {
      for (unsigned index = 0; index < per_thread; ++index) {
        const uint64_t id = 1000 + worker * per_thread + index;
        Arm(id, 1000000 + id);
        InstanceTracer::UntraceImpl(id);
      }
    });
  }
  for (auto& worker : workers) worker.join();
  Check(Visible(300) == 0, "all independent concurrent removals finished");
  Check(callback_count.load() == 3 + threads * per_thread, "every armed callback executed");
  Check(callback_failures.load() == 0, "removal precedes callback and nested operations succeed");
  Check(locked_deallocations.load() == 0, "no tested node was freed under the storage mutex");
  Check(GetStorage().empty(), "no orphan owner records");
  Check(allocations.load() == deallocations.load(), "every allocated map node freed exactly once");
  std::cout << "PASS: " << checks << " checks; " << callback_count.load()
            << " allocator reentries; " << deallocations.load()
            << " nodes freed; portable map model, not Chromium acceptance\n";
}
