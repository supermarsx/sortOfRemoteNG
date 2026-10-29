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
// Revision 6: HTTP disk cache descriptor and capability bit.
ASSERT_LAYOUT(sizeof(cef_sorng_http_cache_v2) == 32, "HTTP cache ABI");
ASSERT_LAYOUT(offsetof(cef_sorng_http_cache_v2, size) == 0, "cache size offset");
ASSERT_LAYOUT(offsetof(cef_sorng_http_cache_v2, reserved) == 4,
              "cache reserved offset");
ASSERT_LAYOUT(offsetof(cef_sorng_http_cache_v2, directory_utf8) == 8,
              "cache directory offset");
ASSERT_LAYOUT(offsetof(cef_sorng_http_cache_v2, directory_length) == 16,
              "cache directory length offset");
ASSERT_LAYOUT(offsetof(cef_sorng_http_cache_v2, max_bytes) == 24,
              "cache max bytes offset");
ASSERT_LAYOUT(CEF_SORNG_TLS_CAP_HTTP_DISK_CACHE == (1ull << 10), "cache bit");
ASSERT_LAYOUT((CEF_SORNG_TLS_CAP_HTTP_DISK_CACHE &
               (CEF_SORNG_TLS_CAP_SOCKET_ADMISSION | CEF_SORNG_TLS_CAP_CONTEXT_REVOKE |
                CEF_SORNG_TLS_CAP_HTTP1_ONLY | CEF_SORNG_TLS_CAP_SCOPED_EXCEPTIONS |
                CEF_SORNG_TLS_CAP_CUSTOM_CA | CEF_SORNG_TLS_CAP_PRIVATE_CONTEXT |
                CEF_SORNG_TLS_CAP_SAME_AUTHORITY_HTTP2 | CEF_SORNG_TLS_CAP_OWNED_HTTP3 |
                CEF_SORNG_TLS_CAP_PROXY_APPLIED |
                CEF_SORNG_TLS_CAP_BOUNDED_CONTEXT_RETIREMENT)) == 0,
              "cache bit is distinct");
typedef struct _cef_request_context_t*(SORNG_TLS_CALL* create_with_cache_fn)(
    const cef_sorng_tls_context_v2*,
    const struct _cef_request_context_settings_t*,
    struct _cef_request_context_handler_t*,
    const cef_sorng_http_cache_v2*);
#ifdef __cplusplus
#include <type_traits>
ASSERT_LAYOUT(std::is_same<decltype(&cef_sorng_tls_create_context_with_cache_v2),
                           create_with_cache_fn>::value,
              "cache export signature");
#else
ASSERT_LAYOUT(_Generic(&cef_sorng_tls_create_context_with_cache_v2,
                       create_with_cache_fn: 1, default: 0),
              "cache export signature");
#endif

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
