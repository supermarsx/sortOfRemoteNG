# sorng CEF TLS bridge — ABI V2 patch queue

Pinned CEF: `682c378d70d5780061e96644dca16ddd8fd157a9`.
Pinned Chromium: `154.0.8037.58`.
**Frozen patch ID: `sorng-tls-v2-682c378-1`.**

This directory owns the additional C ABI and maintained engine delta, not Rust
integration or engine packaging. Custom binaries are required. The pinned
Windows x64 engine has been compiled and packaged locally; full runtime and
cross-platform acceptance have not passed. See
[the current readiness checkpoint](../../docs/browser-readiness.md).
Symbol presence and patch applicability are not runtime security proof.

## Frozen contract for Main / Dirac

`cef_sorng_tls_bridge.h` is the canonical ABI. It does not change stock CEF structs.
Resolve these four symbols from the already-loaded patched libcef:

- `cef_sorng_tls_get_api_v2`
- `cef_sorng_tls_create_context_v2`
- `cef_sorng_tls_complete_v2`
- `cef_sorng_tls_revoke_v2`

Use C calling convention (`__cdecl` on Windows). Supported targets are 64-bit;
bytes/evidence/context/API structure sizes are 16/112/72/40 bytes respectively.
Require ABI 2, exact CEF/Chromium/patch identifiers and required capabilities.
The additional exports intentionally remain outside the stock CEF API hash.

Create on the CEF UI thread after CefInitialize. Token and generation are nonzero
and immutable; tokens are single-use for the process lifetime. Creation binds the
token to the actual native browser-context instance BEFORE initialization. It
creates an isolated IN-MEMORY context: nonempty cache_path and persistent session
cookies are rejected. No path identifier, global next-context slot or persistent
profile substitution is used. Return is one owned CEF reference, or NULL. The
handler argument is borrowed for the call; the bridge retains its own reference.
Configuration and DER anchors are copied before return.

Both state 1 and normal OnRequestContextInitialized are required, independently
of proxy, renderer and native acceptance gates. State 1 acknowledges installation
on the network sequence, not certificate approval. It may repeat for additional
storage partitions; each partition installs its own delegate before requests.
Do not assume an ordering between context initialization and bridge callbacks.

All callbacks and mutating exports run on the CEF browser UI thread. Callbacks
cannot block or unwind across C. Evidence buffers are borrowed until callback
return: copy before asynchronous authority evaluation. Evidence contains actual
TLS hostname AND port, peer/verified chains, original native result/status,
context generation, CA mode and a one-use challenge. Completion returns 1 only
for an accepted reply, 0 for invalid/stale/duplicate replies. Decisions:

- 0: deny, mask 0.
- 1: admit native success, mask 0; still requires independent app authority.
- 2: admit a fresh app-authority exception for the exact destination/chain,
  with EXACT nonzero allowed_exception_mask (name/date/authority bits 1/2/4).

Fatal/HSTS, revoked, malformed, CT, weak-key, built-in pin and unknown errors
cannot be overridden. Neither original CertVerifyResult nor its cert-status
bits are rewritten. No persistent browser exception cache is created.

CA modes are 0 system, 1 system+custom, 2 custom-only. Custom modes require
1..64 DER CA certificates (<=256KiB each, <=4MiB total). Anchors are immutable
per context and enforce certificate constraints. Custom-only removes both
system and Chrome built-in roots from the main verification trust collection;
later Chrome profile updates cannot replace these anchors. Custom CA capability
is advertised only on builds with Chrome root-store support; unsupported builds
reject custom modes. The app owns CA selection and policy/consent semantics.

Revoke permanently tombstones the token, denies pending challenges and asks all
known network delegates to disconnect sockets. State 2 acknowledges revocation
and terminates userdata callbacks. Retain callback userdata until state 2 returns,
or until CefShutdown returns if shutdown/disconnection prevents acknowledgment.
State 3 is a fault, NOT permission to free userdata. Revoke can synchronously
deliver state 2 when no network endpoint exists; callbacks must support reentry.
Main must also revoke proxy/credential leases; transmitted bytes cannot be recalled.

## Implemented engine delta

- TLS socket gate after sync AND async native verification, outside verifier
  caches. Cached verification results still require fresh socket admission.
- Bounded private-context Mojo bridge: 64 pending challenges, browser timeout
  300 seconds, network timeout 305 seconds; process limit 1024 context tombstones.
- Native success, scoped exceptions and custom CA modes all retain app admission.
- Delegate loss/revoke denies pending admission and disconnects registered sockets;
  payload reads/writes also check active admission.
- Protected contexts disable HTTP2/QUIC, early data, TLS resumption and TLS
  renegotiation. HTTP1 exact-destination reuse remains; no cross-authority H2 pool.
- Existing allowed-bad-cert shortcuts cannot bypass native verification.
- ECH public-name retries and TLS client authentication fail closed (unsupported).
- Six parameterized real-socket tests authored for sync/async verifier modes
  (12 cases), including self-signed exception status preservation and late reply
  after destruction. These require Chromium net_unittests; not executed yet.

## Verified locally

- V2 exported patches pass `git apply --check --whitespace=error-all` separately
  for Chromium and CEF against freshly fetched pinned upstream bytes in
  `.artifacts/cef-tls-bridge-applycheck-02`; upstream SHA256 manifest checked.
- ABI C11 and C++17 freestanding syntax/layout passed for Windows x64, Linux
  x64/arm64 and macOS x64/arm64. This is HEADER-ONLY validation.
- Standalone C++17 policy test compiled with `-Wall -Wextra -Werror` and executed:
  **785606 checks passed**. It exercises the exact predicate called by both the
  browser bridge and network-service admission, not a substitute implementation.
- Scratch Chromium/CEF `git diff --check` passed. No full source fetch, engine
  build, native launch, commit or remote write was performed by this lane.

Reproduce with a new scratch destination:

```powershell
./native/cef-patches/check-series.ps1 -Scratch F:/Projects/sortOfRemoteNG/.artifacts/cef-tls-bridge-applycheck-NEW
clang++ -std=c++17 -Wall -Wextra -Werror native/cef-patches/policy_test.cc -o .artifacts/cef-tls-bridge-source-01/policy_test.exe
& ./.artifacts/cef-tls-bridge-source-01/policy_test.exe
```

`fetch-sources.ps1` fetches individual pinned files into fresh isolated scratch.
`export-series.mjs` mechanically exports scratch index-to-worktree deltas without
commits, checking canonical ABI/policy header equality first. The series file
names each patch and its separate project application root (CEF lives at
Chromium's `cef/` in a real checkout).

## Remaining acceptance gates

1. Full Chromium/CEF compilation: GN dependencies, generated Mojo/CToCpp bindings,
   link/export checks and the 12 authored socket cases have NOT run. Compile-ready
   intent is not compile proof. Dirac owns builds/toolchains and all-platform output.
2. Real custom-root chain validation, constrained roots and custom-only exclusion
   need executable verifier tests; the standalone test covers admission logic only.
3. Browser-side cancellation, two distinct empty-cache contexts, multiple-partition
   readiness/revocation, service restart and ABI callback lifetime need native tests.
4. Actual CONNECT+TLS fixtures must prove no HTTP/credential bytes before admission,
   CA-valid wrong-pin rejection, explicit self-signed consent, custom CA behavior,
   port separation, stale reply rejection, revoke/timeout and no private-proxy bypass.
   AIA/OCSP fetches and transports outside this HTTP session remain a separate
   containment gate; these are not proved by socket tests.
5. Main owns Rust FFI/runtime/authority wiring and admission gating. Existing app
   TrustPolicy must not be announced fully supported solely from this patch queue.
6. Verify stock CEF API hashes remain compatible and additive exports survive all
   platform linkers. The ABI header stays OUT of includes_common_capi, which pinned
   tools/cef_api_hash.py hashes; package the additional header separately.
