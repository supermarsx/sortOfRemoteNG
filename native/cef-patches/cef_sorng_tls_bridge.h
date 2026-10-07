// Additional ABI for the sorng patch queue, NOT part of stock CEF.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef CEF_SORNG_TLS_BRIDGE_H_
#define CEF_SORNG_TLS_BRIDGE_H_
#include <stddef.h>
#include <stdint.h>
#if defined(_WIN32)
#define SORNG_TLS_CALL __cdecl
#if defined(BUILDING_CEF_SHARED) || defined(SORNG_TLS_IMPLEMENTATION)
#define SORNG_TLS_EXPORT __declspec(dllexport)
#else
#define SORNG_TLS_EXPORT
#endif
#else
#define SORNG_TLS_CALL
#define SORNG_TLS_EXPORT __attribute__((visibility("default")))
#endif
#ifdef __cplusplus
extern "C" {
#endif

#define CEF_SORNG_TLS_ABI_V2 2u
// TCP TLS / HTTP1 only; no early data, resumption, QUIC or TLS client auth.
#define CEF_SORNG_TLS_CAP_SOCKET_ADMISSION (1ull << 0)
#define CEF_SORNG_TLS_CAP_CONTEXT_REVOKE (1ull << 1)
#define CEF_SORNG_TLS_CAP_HTTP1_ONLY (1ull << 2)
#define CEF_SORNG_TLS_CAP_SCOPED_EXCEPTIONS (1ull << 3)
#define CEF_SORNG_TLS_CAP_CUSTOM_CA (1ull << 4)
#define CEF_SORNG_TLS_CAP_PRIVATE_CONTEXT (1ull << 5)
#define CEF_SORNG_TLS_CA_SYSTEM 0u
#define CEF_SORNG_TLS_CA_SYSTEM_PLUS_CUSTOM 1u
#define CEF_SORNG_TLS_CA_CUSTOM_ONLY 2u
#define CEF_SORNG_TLS_EXCEPTION_NAME 1u
#define CEF_SORNG_TLS_EXCEPTION_DATE 2u
#define CEF_SORNG_TLS_EXCEPTION_AUTHORITY 4u
#define CEF_SORNG_TLS_DENY 0u
#define CEF_SORNG_TLS_ADMIT_NATIVE 1u
#define CEF_SORNG_TLS_ADMIT_EXCEPTION 2u

typedef struct cef_sorng_tls_bytes_v2 {
  const uint8_t* data;
  size_t length;
} cef_sorng_tls_bytes_v2;

typedef struct cef_sorng_tls_evidence_v2 {
  uint32_t size;
  uint32_t abi_version;
  uint64_t context_token;
  uint64_t generation;
  uint64_t challenge;
  // UTF-8 canonical native TLS destination hostname (not URL or proxy IP).
  cef_sorng_tls_bytes_v2 hostname;
  uint16_t port;
  uint16_t reserved;
  int32_t native_error;
  uint32_t certificate_status;
  uint32_t fatal_error;
  uint32_t issued_by_known_root;
  const cef_sorng_tls_bytes_v2* peer_chain;
  size_t peer_chain_count;
  const cef_sorng_tls_bytes_v2* verified_chain;
  size_t verified_chain_count;
  uint32_t ca_mode;
  // Exact overridable name/date/authority mask; 0 means no exception permitted.
  uint32_t allowed_exception_mask;
} cef_sorng_tls_evidence_v2;

// All callbacks run on the CEF browser UI thread, without bridge locks held.
// Callback buffers are borrowed until callback return; copy before async work.
// Never block this thread, unwind across C, or log certificate/host material.
typedef void(SORNG_TLS_CALL* cef_sorng_tls_evidence_cb_v2)(
    void* user_data,
    const cef_sorng_tls_evidence_v2* evidence);
// 1=network context installed; 2=revocation acknowledged; 3=bridge failure.
typedef void(SORNG_TLS_CALL* cef_sorng_tls_state_cb_v2)(void* user_data,
                                                        uint64_t context_token,
                                                        uint64_t generation,
                                                        uint32_t state);

typedef struct cef_sorng_tls_context_v2 {
  uint32_t size;
  uint32_t abi_version;
  uint64_t context_token;
  uint64_t generation;
  void* user_data;
  cef_sorng_tls_evidence_cb_v2 on_evidence;
  cef_sorng_tls_state_cb_v2 on_state;
  uint32_t ca_mode;
  uint32_t reserved;  // Must be zero.
  // Copied before return; immutable thereafter. 1..64 DER CA certs for custom
  // modes, zero for SYSTEM. Each <=256KiB; combined <=4MiB. No leaf trust mode.
  const cef_sorng_tls_bytes_v2* trust_anchors;
  size_t trust_anchor_count;
} cef_sorng_tls_context_v2;

typedef struct cef_sorng_tls_api_v2 {
  uint32_t size;
  uint32_t abi_version;
  uint64_t capabilities;
  // NUL-terminated build identifiers owned by libcef for its lifetime.
  const char* cef_revision;
  const char* chromium_version;
  const char* patch_id;
} cef_sorng_tls_api_v2;

SORNG_TLS_EXPORT const cef_sorng_tls_api_v2* SORNG_TLS_CALL
cef_sorng_tls_get_api_v2(void);
struct _cef_request_context_t;
struct _cef_request_context_settings_t;
struct _cef_request_context_handler_t;
// UI thread only after CefInitialize. Creates an ISOLATED IN-MEMORY request
// context; nonempty cache_path or persistent-session-cookies settings rejected.
// Token is installed on the actual native context BEFORE its initialization.
// Returns one owned CEF reference (release via base.release); NULL on failure.
// Handler is borrowed for the call; bridge retains its own reference as needed.
// Await state(1) AND normal OnRequestContextInitialized; return is not readiness.
SORNG_TLS_EXPORT struct _cef_request_context_t* SORNG_TLS_CALL
cef_sorng_tls_create_context_v2(
    const cef_sorng_tls_context_v2* context,
    const struct _cef_request_context_settings_t* settings,
    struct _cef_request_context_handler_t* handler);
// UI thread only. Engine retains exact native result/chain until completion.
// ADMIT_NATIVE needs native success and mask=0. ADMIT_EXCEPTION needs a fresh
// app-authority permit for this exact chain/destination and the EXACT nonzero
// allowed_exception_mask from evidence. Fatal/HSTS, revocation, CT, weak keys,
// malformed certs, unknown errors and built-in pin failures cannot be overridden.
// No browser-global exception cache or CertVerifyResult replacement is created.
SORNG_TLS_EXPORT int SORNG_TLS_CALL
cef_sorng_tls_complete_v2(uint64_t context_token, uint64_t generation,
                          uint64_t challenge, uint32_t decision,
                          uint32_t exception_mask);
// UI thread only. Tombstones the token; cannot subsequently rearm it.
// Keep callback user_data alive until on_state(2), or until CefShutdown returns
// if shutdown prevents delivery. Main must also revoke proxy/credential leases.
SORNG_TLS_EXPORT int SORNG_TLS_CALL
cef_sorng_tls_revoke_v2(uint64_t context_token, uint64_t generation);

#ifdef __cplusplus
}
#endif
#endif
