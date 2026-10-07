// Compile as C11 and C++17. This checks ABI layout only, NOT engine behavior.
#include "cef_sorng_tls_bridge.h"
#ifdef __cplusplus
#define ASSERT_LAYOUT static_assert
#else
#define ASSERT_LAYOUT _Static_assert
#endif
ASSERT_LAYOUT(sizeof(void*) == 8, "V2 supported targets are 64-bit");
ASSERT_LAYOUT(sizeof(cef_sorng_tls_bytes_v2) == 16, "bytes ABI");
ASSERT_LAYOUT(sizeof(cef_sorng_tls_evidence_v2) == 112, "evidence ABI");
ASSERT_LAYOUT(offsetof(cef_sorng_tls_evidence_v2, hostname) == 32,
              "host offset");
ASSERT_LAYOUT(offsetof(cef_sorng_tls_evidence_v2, port) == 48, "port offset");
ASSERT_LAYOUT(offsetof(cef_sorng_tls_evidence_v2, peer_chain) == 72,
              "chain offset");
ASSERT_LAYOUT(sizeof(cef_sorng_tls_context_v2) == 72, "context ABI");
ASSERT_LAYOUT(offsetof(cef_sorng_tls_context_v2, trust_anchors) == 56, "anchors offset");
ASSERT_LAYOUT(offsetof(cef_sorng_tls_evidence_v2, ca_mode) == 104, "CA offset");
ASSERT_LAYOUT(sizeof(cef_sorng_tls_api_v2) == 40, "API ABI");

static void SORNG_TLS_CALL
evidence_callback(void* user, const cef_sorng_tls_evidence_v2* evidence) {
  (void)user;
  (void)evidence;
}
static void SORNG_TLS_CALL state_callback(void* user,
                                          uint64_t token,
                                          uint64_t generation,
                                          uint32_t state) {
  (void)user;
  (void)token;
  (void)generation;
  (void)state;
}
int main(void) {
  cef_sorng_tls_evidence_cb_v2 e = evidence_callback;
  cef_sorng_tls_state_cb_v2 s = state_callback;
  return e == 0 || s == 0;
}
