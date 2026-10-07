// SPDX-License-Identifier: BSD-3-Clause
// Shared by the real network-service patch and standalone executable tests.
#ifndef NET_SOCKET_SORNG_TLS_POLICY_H_
#define NET_SOCKET_SORNG_TLS_POLICY_H_
#include <stdint.h>
namespace sorng_tls {
// Pinned Chromium values checked by static_assert at the engine call site.
constexpr uint32_t kAllCertErrors = 0xff00ffffu;
constexpr uint32_t kOverridable = 7u;  // name/date/authority only
constexpr uint32_t ExceptionMask(int error, uint32_t status, bool fatal) {
  const uint32_t errors = status & kAllCertErrors;
  return !fatal && (error == -200 || error == -201 || error == -202) &&
                 errors != 0 && (errors & ~kOverridable) == 0
             ? errors : 0;
}
constexpr bool Admit(bool active, int native_error, uint32_t status, bool fatal,
                     uint32_t decision, uint32_t exception_mask) {
  if (!active) return false;
  if (decision == 1)
    return native_error == 0 && !(status & kAllCertErrors) && exception_mask == 0;
  const uint32_t allowed = ExceptionMask(native_error, status, fatal);
  return decision == 2 && allowed != 0 && exception_mask == allowed;
}
}  // namespace sorng_tls
#endif
