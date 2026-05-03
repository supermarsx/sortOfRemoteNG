# 1. Title

OPKSSH in-process boundary and dylink requirement

# 2. Status

Phase B complete.

The final Phase B decision is: freeze the minimal `libopkssh` host boundary that was actually extracted, keep CLI fallback for product integration, and continue to defer any hard dylink or shared-library packaging requirement.

This ADR now records the Phase B boundary that Phase C may wrap. It does not freeze a cross-language ABI or a bundled shared-library artifact.

# 3. Context

SortOfRemoteNG currently shells out to a local `opkssh` CLI for runtime detection and login and then consumes CLI-shaped results. Task `t8` exists to replace that subprocess-first local integration with a library-backed path only if Phase 0 proves that the host ownership model is safe and maintainable.

Upstream OPKSSH is Go-based, so the real engineering choice is not a direct Rust dependency versus CLI. The actual choice is an extracted Go client library with a narrow host bridge versus keeping CLI as the production path.

Phase A evidence came from `t8-e1` through `t8-e4`. `t8-e4` executed against a reachable local checkout and produced a passing integration-backed in-process login spike.

Phase B evidence came from `t8-e6` through `t8-e8`. That work extracted a reusable login core into `libopkssh`, added a narrow host seam for browser, home-directory, and log ownership, and split typed client-config and audit helpers away from CLI formatting.

# 4. Problem statement

SortOfRemoteNG needs a local client integration boundary that removes subprocess text parsing and binary-path dependence without importing server-side verify, permissions, and install concerns into the desktop app.

The repo also needs an answer to a narrower architectural question: should it require a hard shared-library or dylink artifact as part of the first approved design, or keep that packaging requirement flexible until the fork-side proof and later bundle validation exist?

# 5. Upstream reality discovered in Phases 0 and B

- `libopkssh/login.go` now exposes a real reusable login core through `StartLogin(...)`, `RunLogin(...)`, and `RunLoginWithHost(...)`, with typed `LoginRequest` and `LoginResult` data.
- `libopkssh/host.go` proves a narrow host seam for home-directory ownership, log sink ownership, optional browser opening, and optional browser-URL capture.
- Callback listener lifecycle is still provider-owned. The current host session explicitly reports `CallbackListenerOwnedByProvider` and `CallbackShutdownOwnedByProvider` as true.
- The current log sink integration is sufficient for embedding but not yet ideal: provider logging is still captured by temporarily redirecting process-global `logrus` output under a mutex during login.
- `libopkssh/config.go` now exposes typed client-config helpers, but it still mirrors the current YAML format. If `client_secret` is stored there, it remains plaintext on disk.
- `libopkssh/audit.go` is a typed audit wrapper behind the `libopkssh_audit` build tag. It is an admin-facing bridge surface, not part of the minimal login contract.
- Server verify, permission-fix, Windows install, and other server or admin CLI flows remain outside the extracted client-library boundary.
- In the current repo wrapper, server-policy edits, server install, and remote audit still execute over an existing SSH shell session through backend-built command strings. That surface is intentionally residual for v1 and is not claimed as library-backed.
- SortOfRemoteNG's first app seam is still narrow: Phase C only needs a login-oriented wrapper plus minimal client-config handling. Mirroring the CLI remains explicitly out of scope.
- Phase B proved the library seam, but it did not prove a shared-library artifact form, cross-language ABI shape, or host-supplied callback server model.

# 6. Options considered

- Option A: proceed with Go library plus narrow C ABI shim and keep hard dylink or shared-library packaging as a requirement now.
  - Rejected because the fork-side proof validates the seam, not the artifact form, and shared-library packaging would still be a guess.
- Option B: relax the hard dylink requirement while keeping the same seam.
  - Preferred because Phase A found an extractable client boundary, validated the hardest login path, and still did not prove artifact form or full host ownership yet.
- Option C: stop and keep CLI as the production path.
  - Rejected for now because Phase A did not uncover a structural blocker at the upstream login and config seam or the local app seam, and the proof spike passed.

# 7. Chosen boundary

Choose Option B: relax the hard dylink requirement while keeping the same seam.

The frozen Phase B seam is:

- extracted Go `libopkssh` login core for local-client login;
- narrow host bridge for browser handoff, home-directory resolution, and log capture;
- typed client-config helpers that preserve current config semantics;
- audit only as a build-tagged admin bridge;
- local Rust wrapper or backend adapter inside `sorng-opkssh`;
- CLI path retained as production fallback until later packaging work proves otherwise.

This choice preserves the extracted-library direction without prematurely committing the repo to runtime-loaded shared libraries or bundle-specific loader behavior.

## Frozen now

- Login orchestration may be wrapped in Phase C around `StartLogin(...)`, `RunLoginWithHost(...)`, and the typed `LoginResult` output.
- The host seam is limited to home-directory ownership, log sink ownership, and browser URL capture or open callbacks.
- Client-config helpers are frozen only as typed wrappers over the existing `~/.opk/config.yml` model.
- Audit is frozen only as an optional admin bridge and is not required for the first product integration slice.

## Explicitly not frozen yet

- no C ABI or symbol list;
- no `abi_version()` policy or error-buffer ownership rule;
- no `.dll`, `.dylib`, or `.so` naming or loader-path contract;
- no host-supplied callback listener API;
- no secure-store replacement for plaintext config secrets.

# 8. Host ownership model

## browser open

Frozen now: the host may capture the browser URL, supply an `OpenBrowser` callback, or both.

Current limitation: browser-open failures are logged to the host sink when one exists, but they are not surfaced as a returned login error.

## callback listener lifecycle

Frozen Phase B limitation: callback bind and shutdown remain provider-owned.

The current host session explicitly reports `CallbackListenerOwnedByProvider = true` and `CallbackShutdownOwnedByProvider = true`. Phase C must not assume that a host-supplied callback server exists yet.

## config path ownership

Frozen now: the host can supply home-directory ownership for login-related path resolution, and the typed config helpers expose explicit path resolution and load or create calls.

Current caveat: config helpers still mirror the existing client YAML model, including plaintext `client_secret` when present on disk. The repo-side wrapper now redacts provider secrets from the long-lived Tauri transport and service cache, blocks new plaintext `client_secret` writes through the app config update path, and preserves only secrets that were already present on disk when the frontend round-trips a redacted config. This is still not secure-store integration.

## log sink ownership

Frozen now: the host can inject a log sink and avoid stdout or stderr as the integration contract.

Current limitation: provider logging is captured by temporarily redirecting process-global `logrus` output under a mutex for the lifetime of the login. That is acceptable for Phase C wrapping, but it is not a final concurrency-friendly logging contract.

Repo-side hardening note: the current SortOfRemoteNG wrapper now omits raw login, audit, and server-install output from the serialized app contract and clears cached login and audit raw text before retention. That reduces accidental retention in app state, but it does not change the upstream process-global logger limitation.

## key material and secret handling

Frozen now: login returns structured certificate bytes, private-key PEM, identity, expiry, and reusable session state instead of CLI text.

Current caveat: the client-config surface still permits plaintext `client_secret` because the upstream file format has not changed. The repo-side wrapper now redacts provider secrets from app-facing config reads, blocks new plaintext client-config secret writes, and avoids retaining raw login or audit output in the long-lived service contract. Existing secrets already on disk remain plaintext until removed externally, and the CLI fallback still accepts custom-provider `client_secret` input at the immediate login invocation boundary. The returned session state should still be treated as opaque by downstream wrappers until a later ABI or wrapper layer defines handle ownership more explicitly.

# 9. Packaging and distribution model

Phase B still does not approve a hard dylink or shared-library distribution requirement.

The artifact form remains intentionally flexible:

- a local wrapper crate or direct vendored build is acceptable for the first app integration slice;
- a shared-library or dylink artifact is a later packaging decision, not a current gate;
- no platform artifact names, loader rules, signing rules, updater coupling, or rollback rules are frozen here.

Current repo wiring keeps that decision truthful:

- the app release `full` feature set now includes `opkssh-vendored-wrapper`, which forwards to `sorng-opkssh/vendored-wrapper`;
- the linked wrapper embeds the bridge when the pinned OPKSSH checkout and Go toolchain are available, otherwise it truthfully reports metadata-only capability and keeps CLI fallback active;
- production Tauri/Docker builds stage the wrapper artifact with `--enable`; direct helper use without `--enable` / `SORNG_ENABLE_OPKSSH_VENDOR_BUNDLE=1` still scrubs stale staged artifacts.

If shared libraries are later reintroduced, they must preserve the same narrow seam and pass separate Windows, macOS, and Linux bundling, signing, updater, and rollback validation.

# 10. Compatibility plan

- Preserve existing Tauri command names where possible, especially `opkssh_get_status` and `opkssh_login`.
- Change the local runtime contract from binary-first status to backend and runtime-first status.
- Keep CLI fallback alive during migration and treat `opkssh_check_binary` and download-url flows as fallback metadata rather than the primary runtime model.
- Wrap only the minimal login seam and the client-config helpers that are needed immediately; do not mirror the CLI into Rust.
- Treat audit as an optional admin bridge rather than part of the first critical login path.
- Leave keys, server-policy helpers, and broader admin flows on their current paths in the first integration slice unless later work proves a smaller stable contract for them. For the current repo slice, that means backend-built remote shell wrappers over SSH, not a library-backed admin API.

# 11. Security constraints

- System browser only. No OIDC token handling in the Tauri webview.
- No process-global logger mutation and no raw stdout or stderr contract in the embedded login path.
- Explicit callback bind policy, timeout, cancellation, and stale-callback handling.
- No implicit home-directory writes unless the host enables them.
- No new app-side secret regression: provider secrets and raw OPKSSH output should be redacted at the repo wrapper boundary. New plaintext client-config secret writes are blocked, but existing on-disk secrets and CLI custom-provider secret arguments remain residual risks until the upstream format or backend invocation path changes.
- Server verify, permissions, install, audit, and policy-edit commands remain outside the first local-client library boundary. In v1 they still depend on a remote shell hop over SSH; the repo-side requirement is only to keep those command builders narrow, quoted, and explicit about staying CLI-backed.

# 12. Stop conditions and fallback plan

Stop and keep CLI as the production path if any of the following remain true after the fork-side proof work:

- process-global logging and output cannot be removed from the login path;
- callback listener lifecycle cannot be made host-controllable or host-driven through an explicit handle;
- the bridge expands into a broad or unstable ABI that mirrors the CLI;
- the extracted client boundary still depends on implicit default writes to `~/.opk` or `~/.ssh`;
- later packaging evidence shows the extracted path is materially less reliable than CLI fallback across supported desktop platforms.

Until those conditions are cleared, the existing CLI integration remains the production path and the extracted-library direction remains an R&D track only.

# 13. Consequences

Positive consequences:

- preserves the most promising architecture seam uncovered in Phase A;
- upgrades the decision from design-feasible to code-and-test-backed at the hardest login seam;
- gives Phase C a concrete contract to wrap without forcing Rust to mirror the CLI;
- avoids locking the repo into a hard dylink decision without packaging evidence;
- keeps the local app diff narrow and the rollback path cheap.

Negative consequences:

- callback listener ownership is still not in final host-controlled form;
- logging capture still relies on temporary process-global redirection under a mutex;
- plaintext `client_secret` semantics still exist in the upstream config surface even though the repo wrapper now blocks new plaintext writes and redacts them from long-lived app transport and cache;
- CLI fallback custom-provider login can still place `client_secret` values on the subprocess invocation boundary when that login mode is used;
- audit and server-policy administration still rely on backend-built remote shell commands over SSH rather than a narrower library or RPC surface;
- the project still depends on later wrapper or ABI and packaging work.

Operational consequence:

- the next approved action is Phase C app-side wrapping against this small contract, with CLI fallback intact and packaging decisions still deferred.

# 14. Follow-on tasks

- In Phase C, wrap only the frozen login core and the smallest necessary client-config helpers inside `sorng-opkssh`.
- Keep CLI fallback in place while the wrapper path proves runtime behavior on at least one platform. Current repo wiring only proves metadata linkage, not a callable embedded runtime.
- Treat callback listener ownership as provider-owned until a later boundary-hardening slice explicitly replaces it.
- Keep audit on its current admin-bridge footing and out of the critical login path unless a later slice removes the build-tag and package-cycle debt cleanly.
- Defer C ABI design, symbol ownership, error-buffer rules, artifact naming, and shared-library packaging to later packaging work.