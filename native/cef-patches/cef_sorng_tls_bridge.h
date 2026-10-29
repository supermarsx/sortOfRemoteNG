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
// TLS admission; no early data, resumption or TLS client auth.
#define CEF_SORNG_TLS_CAP_SOCKET_ADMISSION (1ull << 0)
#define CEF_SORNG_TLS_CAP_CONTEXT_REVOKE (1ull << 1)
#define CEF_SORNG_TLS_CAP_HTTP1_ONLY (1ull << 2)  // Legacy patch ID 1 only.
#define CEF_SORNG_TLS_CAP_SCOPED_EXCEPTIONS (1ull << 3)
#define CEF_SORNG_TLS_CAP_CUSTOM_CA (1ull << 4)
#define CEF_SORNG_TLS_CAP_PRIVATE_CONTEXT (1ull << 5)
// Exact native authority/session-key reuse only; no IP/SAN coalescing or Alt-Svc.
#define CEF_SORNG_TLS_CAP_SAME_AUTHORITY_HTTP2 (1ull << 6)
// Revision 5: end-to-end QUIC only through this context's authenticated owned
// datagram relay, with independent certificate admission and revocation.
#define CEF_SORNG_TLS_CAP_OWNED_HTTP3 (1ull << 7)
#define CEF_SORNG_TLS_CAP_PROXY_APPLIED (1ull << 8)
// Revision 4: monotonic token replay fence and bounded live registration state.
#define CEF_SORNG_TLS_CAP_BOUNDED_CONTEXT_RETIREMENT (1ull << 9)
// Revision 6: an isolated context may own one on-disk HTTP cache directory.
// Only the network HTTP cache persists; cookies and all other stores stay in
// memory. See cef_sorng_tls_create_context_with_cache_v2 and state 7.
#define CEF_SORNG_TLS_CAP_HTTP_DISK_CACHE (1ull << 10)
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
// 1=TLS delegate installed; 2=revocation acknowledged; 3=bridge failure;
// 4=exact owned proxy applied (only after apply_proxy, with PROXY_APPLIED cap).
// 5=proxy application failed (same capability; generic TLS faults remain 3).
// 6=owned datagram transport configured (OWNED_HTTP3 only, after configure).
// 7=HTTP disk cache released (HTTP_DISK_CACHE only; only for contexts created
// by cef_sorng_tls_create_context_with_cache_v2). Exactly once per such
// context: the NetworkContext that held the directory was destroyed or
// disconnected, or the context was revoked before any NetworkContext received
// the directory. It may arrive before or after 2.
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

// UI-thread read-only counters. No pointers, certificate bytes or endpoints.
typedef struct cef_sorng_tls_registry_stats_v2_t {
  uint32_t size;
  uint32_t abi_version;
  uint64_t registrations;  // Includes attached revoked and retiring entries.
  uint64_t retiring;
  uint64_t root_bytes;
  uint64_t token_high_water;
} cef_sorng_tls_registry_stats_v2_t;

SORNG_TLS_EXPORT int SORNG_TLS_CALL
cef_sorng_tls_registry_stats_v2(cef_sorng_tls_registry_stats_v2_t* stats);

SORNG_TLS_EXPORT const cef_sorng_tls_api_v2* SORNG_TLS_CALL
cef_sorng_tls_get_api_v2(void);
struct _cef_request_context_t;
struct _cef_request_context_settings_t;
struct _cef_request_context_handler_t;
// UI thread only after CefInitialize. Creates an ISOLATED IN-MEMORY request
// context; nonempty cache_path or persistent-session-cookies settings rejected.
// Token is installed on the actual native context BEFORE its initialization.
// Returns one owned CEF reference (release via base.release); NULL on failure.
// With BOUNDED_CONTEXT_RETIREMENT, every accepted token must be strictly larger
// than all previously accepted tokens in this process (no wrap/reuse, even with
// a different generation). NULL is callback-quiescent when that capability is
// present: after the call returns NULL, no application callback can occur for
// that descriptor. Older revisions retain their existing conservative lifetime.
// Handler is borrowed for the call; bridge retains its own reference as needed.
// Await state(1) AND normal OnRequestContextInitialized; return is not readiness.
SORNG_TLS_EXPORT struct _cef_request_context_t* SORNG_TLS_CALL
cef_sorng_tls_create_context_v2(
    const cef_sorng_tls_context_v2* context,
    const struct _cef_request_context_settings_t* settings,
    struct _cef_request_context_handler_t* handler);

// Revision 6 (HTTP_DISK_CACHE). Borrowed for the call; copied before return.
typedef struct cef_sorng_http_cache_v2 {
  uint32_t size;      // Exactly sizeof(cef_sorng_http_cache_v2).
  uint32_t reserved;  // Must be zero.
  // Absolute UTF-8 path, not NUL-terminated, no NUL. It must already exist and
  // be a strict descendant of <CefSettings.root_cache_path>/http-cache/; every
  // component from http-cache down is a plain directory (no symlink, junction
  // or other reparse point) and none is "." or "..".
  const char* directory_utf8;
  size_t directory_length;
  uint64_t max_bytes;  // 16 MiB..1 GiB inclusive.
} cef_sorng_http_cache_v2;

// UI thread only. Same contract as cef_sorng_tls_create_context_v2, plus: the
// context's first NetworkContext gets <directory>/net/Cache as its disk HTTP
// cache with max_bytes as its limit. Later NetworkContexts of the same
// context (other partitions, a restarted network service) and any created
// after revocation use an in-memory cache. Cookies, transport security,
// reporting/NEL, trust tokens, shared dictionaries, device-bound sessions and
// SCT reports are never given a file. The directory is held from a non-NULL
// return until state(7); while held, no other registration may use it or any
// directory nested with it. NULL on any failure; after a NULL from a late
// factory failure the engine may still hold the directory internally (no
// callbacks) until its NetworkContext is gone. Descriptor and cache
// validation failures do not consume the token; a later factory failure
// does, so a caller retrying without the cache uses a new, larger token.
// Keep callback user_data alive until BOTH state(2) and state(7) have
// returned, or until CefShutdown returns.
SORNG_TLS_EXPORT struct _cef_request_context_t* SORNG_TLS_CALL
cef_sorng_tls_create_context_with_cache_v2(
    const cef_sorng_tls_context_v2* context,
    const struct _cef_request_context_settings_t* settings,
    struct _cef_request_context_handler_t* handler,
    const cef_sorng_http_cache_v2* http_cache);
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
// UI thread only. Permanently rejects token replay; cannot subsequently rearm it.
// Keep callback user_data alive until on_state(2), or until CefShutdown returns
// if shutdown prevents delivery. Main must also revoke proxy/credential leases.
SORNG_TLS_EXPORT int SORNG_TLS_CALL
cef_sorng_tls_revoke_v2(uint64_t context_token, uint64_t generation);
// UI thread only, after private fixed preference installation and state(1).
// ACKs the exact HTTP 127.0.0.1:port config in NetworkService without network
// traffic, DNS or PAC; completion is state(4), proxy failure state(5). One request per
// context. Existing callback lifetime/revocation contract is unchanged.
SORNG_TLS_EXPORT int SORNG_TLS_CALL
cef_sorng_tls_apply_proxy_v2(uint64_t context_token, uint64_t generation,
                            uint16_t expected_port);

// UI thread only, after states(1) and (4). OWNED_HTTP3 only. The expected port
// must match the already-acknowledged private HTTP 127.0.0.1 proxy. Password is
// exactly 64 ASCII hexadecimal bytes; copied before return and never exposed to
// renderer configuration, page headers, URLs or logs. Username is the fixed
// sorng-private-proxy principal. Configuration is one-shot per native context.
// Return 1 accepts the request, not readiness: await state(6). No destination DNS
// or traffic is generated by this call. Revoke cancels configuration and all
// active datagram flows. A context without this configuration cannot use QUIC.
SORNG_TLS_EXPORT int SORNG_TLS_CALL
cef_sorng_tls_configure_datagrams_v2(uint64_t context_token, uint64_t generation,
                                    uint16_t expected_port,
                                    const uint8_t* proxy_password,
                                    size_t password_length);

#ifdef __cplusplus
}
#endif
#endif
