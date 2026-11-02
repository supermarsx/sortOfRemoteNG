// Fixed Windows ARM64 compiler-input prerequisite. This is not a CEF build,
// runtime test, ARM default profile, or permission to execute its linked image.
// No CRT, standard-library headers, WinAPI, global state, or runtime helpers.

#if !defined(__clang__) || !defined(_MSC_VER)
#error This probe requires Clang with the Microsoft target environment.
#endif

#if !defined(_WIN32) || !defined(_WIN64) || !defined(_M_ARM64) || !defined(__aarch64__)
#error This probe requires the Windows ARM64 target.
#endif

#if defined(_M_ARM64EC) || defined(__arm64ec__) || defined(_M_X64) || defined(_M_AMD64) || defined(_M_IX86) || defined(__x86_64__) || defined(__i386__)
#error Hybrid or x86 targets cannot qualify this ARM64 input probe.
#endif

#include "partition_alloc/buildflags.h"
#include "cef/include/cef_config.h"

static_assert(sizeof(void*) == 8, "The target pointer width must be 64 bits.");
static_assert(sizeof(int) == 4 && sizeof(long) == 4 && sizeof(long long) == 8,
              "The target must use the Windows LLP64 data model.");

// Only the existing policy's explicit invariants and minimums are consumed.
// The remaining generated macro values still require separate ARM review.
static_assert(PA_BUILDFLAG(ENABLE_BACKUP_REF_PTR_INSTANCE_TRACER) == 0,
              "Existing policy: instance tracer is disabled.");
static_assert(PA_BUILDFLAG(HAS_64_BIT_POINTERS) == 1,
              "Existing policy: 64-bit pointers are required.");
static_assert(PA_BUILDFLAG(IS_COMPONENT_BUILD) == 0,
              "Existing policy: component builds are disabled.");
static_assert(PA_BUILDFLAG(IS_DEBUG) == 0,
              "Existing policy: debug builds are disabled.");
static_assert(PA_BUILDFLAG(ENABLE_BACKUP_REF_PTR_SUPPORT) == 1,
              "Existing policy: backup reference pointer support is required.");
static_assert(PA_BUILDFLAG(USE_RAW_PTR_BACKUP_REF_IMPL) == 1,
              "Existing policy: the raw pointer backup implementation is required.");
static_assert(PA_BUILDFLAG(ENABLE_BACKUP_REF_PTR_FEATURE_FLAG) == 1,
              "Existing policy: the backup reference pointer feature flag is required.");
static_assert(PA_BUILDFLAG(FORCE_DISABLE_BACKUP_REF_PTR_FEATURE) == 0,
              "Existing policy: the backup reference pointer feature cannot be forced off.");
static_assert(CEF_V8_ENABLE_SANDBOX == 1,
              "The generated CEF configuration must declare the V8 sandbox.");

// No calls or dynamic initialization: the future no-default-library link only
// checks that this fixed entry is present. Its ARM64 output must never run here.
extern "C" int sorng_arm64_qualification_entry() noexcept {
  return 0;
}
