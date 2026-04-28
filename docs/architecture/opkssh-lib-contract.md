# OPKSSH Library Contract

## Status

This document freezes the smallest host contract that Phase B actually proved in the local OPKSSH fork.

It is a Phase C planning contract, not a cross-language ABI contract. Hard dylink or shared-library packaging is explicitly deferred.

## Goal

Give SortOfRemoteNG a narrow boundary it can wrap in Phase C without mirroring the OPKSSH CLI.

## Frozen Scope

Phase B freezes only four things:

1. the extracted login-oriented `libopkssh` core;
2. the current host-owned seams for browser handoff, home-directory ownership, and log capture;
3. typed client-config helpers that preserve current YAML semantics;
4. the audit helper only as an admin-facing bridge surface.

Everything else stays deferred.

## Frozen Minimum Contract

### Login core

The current fork proves a login-oriented library seam through these symbols:

- `StartLogin(ctx, req, host) (*LoginOperation, error)`
- `RunLogin(ctx, req) (*LoginResult, error)`
- `RunLoginWithHost(ctx, req, host) (*LoginResult, error)`
- `LoginOperation.Await(ctx) (*LoginResult, error)`

The minimum semantic contract for Phase C is:

- start an interactive login without going through Cobra or CLI text parsing;
- optionally receive the browser login URL before the login completes;
- await a structured success or failure result;
- receive structured certificate material instead of stdout parsing.

### Login request and result semantics

The current Go request type is:

- `LoginRequest.Provider`
- `LoginRequest.KeyType`
- `LoginRequest.SendAccessToken`

The current Go result type is:

- `LoginResult.Session`
- `LoginResult.Certificate`
- `LoginResult.PrivateKeyPEM`
- `LoginResult.Identity`
- `LoginResult.ExpiresAt`

Phase C should freeze the semantics, not the exact cross-language shape:

- provider selection must happen on the Go side or inside a Go-facing wrapper;
- key type is limited to the currently extracted algorithms;
- the result must include certificate bytes, OpenSSH private-key PEM, identity text, and expiry time;
- the returned session state should be treated as opaque by downstream wrappers even though the current Go struct is public.

`RefreshLogin(...)` exists in the fork, but it is not part of the minimum required Phase C slice.

### Host seam

The current host-owned inputs are intentionally narrow:

- `Host.UserHomeDir`
- `Host.Logger`
- `Host.CaptureBrowserURL`
- `Host.OpenBrowser`

This freezes only the following behaviors:

- the host may override home-directory resolution;
- the host may capture provider or login notices through a log sink;
- the host may capture the login URL and decide whether to open the system browser;
- the host may also let the provider use its default browser behavior by omitting those hooks.

`HostSession.LoginURLs` should be treated as a zero-or-one URL handoff in the current implementation, not as a general event bus.

### Client config helpers

The typed client-config helper set proven in Phase B is:

- `DefaultClientConfigBytes()`
- `LoadDefaultClientConfig()`
- `NewClientConfig(...)`
- `ResolveClientConfigPath(...)`
- `LoadClientConfig(...)`
- `CreateDefaultClientConfig(...)`
- `CreateProvidersMap(...)`

This surface is frozen only as a typed wrapper around the current client config file format and provider alias validation.

Important caveat: if `client_secret` is present in `~/.opk/config.yml`, it remains plaintext. Phase C must not present this surface as secure secret storage.

### Audit bridge

`libopkssh/audit.go` is a typed audit wrapper behind the `libopkssh_audit` build tag.

Its frozen status is intentionally limited:

- it is an admin-facing bridge surface;
- it is not part of the minimum login contract;
- it intentionally does not absorb verify, permission-fix, Windows install, or other server-side CLI flows.

## Ownership Rules

### Context and cancellation

The host owns cancellation through `context.Context`. Login wait and shutdown semantics must therefore be wrapped around context cancellation in Phase C.

### Browser handoff

The host owns browser handoff only at the URL and opener level. It can observe the login URL, call a browser opener, or both.

Current limitation: if `OpenBrowser` fails, the failure is logged to the host sink but is not surfaced as a returned login error.

### Callback listener ownership

This limitation is frozen now and must be treated as real:

- `CallbackListenerOwnedByProvider = true`
- `CallbackShutdownOwnedByProvider = true`

Downstream Rust integration must not assume that a host-supplied callback server exists yet. The current provider still owns callback bind and shutdown.

### Home-directory ownership

If `Host.UserHomeDir` is supplied, it owns the home-directory decision for login-related path resolution. If it is omitted, process defaults are used.

### Log sink ownership

If `Host.Logger` is supplied, it becomes the visible sink for login-time provider notices.

Current limitation: the implementation achieves this by temporarily redirecting process-global `logrus` output under a mutex for the duration of the login. Phase C must not assume independent concurrent log routing per login operation.

### Session ownership

The returned `LoginSession` is reusable state inside Go, but downstream wrappers should treat it as opaque until later wrapper or ABI work defines handle ownership explicitly.

## Lifecycle

1. Go-side code resolves or constructs the OpenID provider.
2. The caller builds `LoginRequest` and optionally `Host`.
3. The caller starts login with `StartLogin(...)` or uses `RunLoginWithHost(...)` as a blocking wrapper.
4. If browser hooks are enabled, the caller may receive the login URL and may open the system browser.
5. The provider-owned callback listener completes the OIDC round-trip.
6. The caller awaits `LoginResult` or cancels through the context.
7. The caller receives structured certificate material and reusable session state.

Phase C should keep this lifecycle small and should not try to recreate CLI flag semantics in Rust.

## Artifact Assumptions

Phase B proves only the source-level seam. It does not prove the final shipping artifact.

The current assumptions are:

- Phase C may wrap the Go surface through a local wrapper or vendored build step;
- no runtime-loaded `.dll`, `.so`, or `.dylib` is assumed;
- no platform artifact names, loader paths, signing rules, updater rules, or rollback rules are frozen here;
- no stable C ABI is frozen yet.

Current repo implementation note:

- `sorng-opkssh-vendor` can now be linked into the app graph behind `app --features opkssh-vendored-wrapper` / `sorng-opkssh --features vendored-wrapper`;
- the linked wrapper only exports truthful metadata today and still reports `embedded_runtime = 0`, so the library backend remains unavailable;
- bundle staging is a separate packaging gate through `SORNG_ENABLE_OPKSSH_VENDOR_BUNDLE=1` or `npm run stage:opkssh-vendor -- --enable`, with the default helper path scrubbing stale staged artifacts.

If later work introduces a C ABI or shared-library artifact, it must preserve the same narrow login-oriented seam and then separately define:

- ABI version negotiation;
- symbol naming and export list;
- string and buffer ownership;
- error-buffer ownership and lifetime;
- artifact naming and loader expectations per platform.

Those items are deferred to later packaging work and are not part of the current freeze.

## Explicitly Deferred

The following are not frozen in Phase B:

- hard dylink or shared-library packaging;
- cross-language ABI details;
- host-supplied callback listener ownership;
- secure-store replacement for plaintext client secrets;
- making audit a default-build, app-facing contract;
- server verify, permission-fix, Windows install, and other admin CLI surfaces;
- any wrapper shape that would mirror the OPKSSH CLI instead of the small login contract.

## Phase C Guidance

Phase C should:

- wrap only the login core and the minimum client-config helpers it actually needs;
- keep CLI fallback intact;
- treat linked wrapper metadata as capability reporting only until a real embedded runtime and Rust-side callable bridge both exist;
- treat callback listener ownership as provider-owned until later hardening changes it;
- treat `LoginSession` as opaque;
- keep audit and other admin surfaces off the critical path for the first app integration slice.