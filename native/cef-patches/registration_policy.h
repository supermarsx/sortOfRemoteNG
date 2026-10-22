// Copyright 2026 The sorng Authors. BSD-3-Clause.
// Shared by the actual CEF registration bridge and its standalone unit test.
#ifndef SORNG_TLS_REGISTRATION_POLICY_H_
#define SORNG_TLS_REGISTRATION_POLICY_H_

#include <array>
#include <cstddef>
#include <cstdint>

namespace sorng_tls {
inline constexpr size_t kMaxLiveRegistrations = 1024;
inline constexpr size_t kMaxRegistrationControls = 64;

class TokenHighWater {
 public:
  bool Reserve(uint64_t token, uint64_t generation, size_t live_count) {
    if (!token || !generation || token <= maximum_ ||
        live_count >= kMaxLiveRegistrations)
      return false;
    maximum_ = token;
    return true;
  }
  uint64_t maximum() const { return maximum_; }

 private:
  uint64_t maximum_ = 0;
};

class RegistrationLifetime {
 public:
  void Attach() { attached_ = true; }
  void Detach() { attached_ = false; released_ = true; }
  // A failed factory may not call the application after returning NULL. If it
  // partially attached a context, retain its denying delegate until Detach.
  void Abandon() { released_ = true; callbacks_quiescent_ = true; }
  void TerminalCallbackReturned() { terminal_callback_returned_ = true; }
  bool callbacks_quiescent() const { return callbacks_quiescent_; }
  bool CanRetire(bool all_controls_settled) const {
    return released_ && !attached_ && callback_depth_ == 0 && all_controls_settled &&
           (terminal_callback_returned_ || callbacks_quiescent_);
  }

 private:
  friend class RegistrationCallbackScope;
  size_t callback_depth_ = 0;
  bool attached_ = false;
  bool released_ = false;
  bool terminal_callback_returned_ = false;
  bool callbacks_quiescent_ = false;
};

class RegistrationCallbackScope {
 public:
  explicit RegistrationCallbackScope(RegistrationLifetime& lifetime)
      : lifetime_(lifetime) { ++lifetime_.callback_depth_; }
  ~RegistrationCallbackScope() { --lifetime_.callback_depth_; }
  RegistrationCallbackScope(const RegistrationCallbackScope&) = delete;
  RegistrationCallbackScope& operator=(const RegistrationCallbackScope&) = delete;
 private:
  RegistrationLifetime& lifetime_;
};

// IDs are stable slot+1 values, never reused within a registration. A control
// disconnect and its queued revoke callback may both arrive: settle once.
class ControlRevocations {
 public:
  uint64_t Add() {
    if (used_ == controls_.size()) return 0;
    controls_[used_].requested = revoking_;
    return ++used_;
  }
  void RequestAll() {
    revoking_ = true;
    for (size_t i = 0; i < used_; ++i) controls_[i].requested = true;
  }
  bool TakeRevoke(uint64_t id) {
    auto* control = Find(id);
    if (!control || !control->requested || control->settled || control->sent)
      return false;
    control->sent = true;
    return true;
  }
  bool Acknowledge(uint64_t id) {
    auto* control = Find(id);
    return control && control->requested && control->sent && Settle(control);
  }
  bool Disconnect(uint64_t id) { return Settle(Find(id)); }
  bool AllSettled() const {
    if (!revoking_) return false;
    for (size_t i = 0; i < used_; ++i)
      if (!controls_[i].settled) return false;
    return true;
  }

 private:
  struct Control { bool requested = false; bool sent = false; bool settled = false; };
  Control* Find(uint64_t id) {
    return id && id <= used_ ? &controls_[static_cast<size_t>(id - 1)] : nullptr;
  }
  static bool Settle(Control* control) {
    if (!control || control->settled) return false;
    control->settled = true;
    return true;
  }
  bool revoking_ = false;
  size_t used_ = 0;
  std::array<Control, kMaxRegistrationControls> controls_{};
};
}  // namespace sorng_tls
#endif
