---
title: Browser readiness evidence
eyebrow: Development
description: Automated browser transport contracts, live acceptance evidence, and cross-platform rollout requirements.
permalink: /browser-readiness/
---

# Browser readiness evidence

## Current integration checkpoint — 2026-10-07

CEF is selected for the native integration. The app now connects its native
certificate authority to the maintained TLS bridge V2
(`sorng-tls-v2-682c378-1`); stock CEF cannot supply that bridge. A missing bridge
is reported without changing the saved trust policy or falling back to another
engine. Source integration is not a completed engine rollout. Earlier sections
below record intermediate engineering milestones, not the current completion
status.

Earlier local Windows checks (before the database-contained session changes
currently in progress):

- The application `cargo check` with `--no-default-features --features
native-browser` passes against the pinned CEF SDK.
- Native host: 171 unit tests, 29 IPC contract tests, 10 display-publication
  tests and 6 login-consent tests pass. These include V2 acknowledgment lifetime
  handling and rejection of extra automation fields.
- Native database, route, credential and certificate authority: 47 tests pass.
  Command test executables now embed the Common Controls v6 manifest required
  for `TaskDialogIndirect` on Windows.
- Native encrypted retention and saved-preference integration: 30 tests pass;
  runtime/close coordination: 14 tests pass. These use the production codec and
  lifecycle logic, not a running CEF CookieManager.
- The combined settings, inheritance, capability, bookmark, mounted connection,
  notice and automation UI suites pass (280 tests across 12 files). TypeScript
  typechecking passes. Missing manual-submit preferences now agree between the
  UI and native authority; explicit saved choices survive unrelated saves.
- Build routing, custom-runtime provenance, packaging and acceptance-runner
  checks pass (154 tests, 4 platform/privilege-related skips).
- Native login adapter fixtures pass (48 tests), including deferred fresh-secret
  grants, preserved manual-submit preferences and staged provider transitions.
  These are not live sign-in or challenge-completion results.
- The standalone TLS acceptance client passes `cargo check --all-targets` and
  links its Windows DLL against the stock SDK. It has not been run against a
  patched engine; compilation does not establish native TLS acceptance.
- The two maintained engine patches apply to their exact upstream pins. The
  standalone certificate-admission predicate and header ABI checks pass; these
  do not execute the Chromium certificate verifier or its socket tests.

After the approved interactive installation, the local toolchain doctor now
passes: VS 2026 Build Tools 18.10.12224.181, SDK headers 10.0.28000.0,
Debugging Tools `dbghelp.dll` 10.0.28000.2270 and Python 3.12.10. VS 2022 remains
installed. The earlier installer rejection and terminal checkpoint files are
historical evidence, not the current installation state. Pinned build inputs
and the verified eight-file tool inventory are under
`.artifacts/cef-build-inputs-20261007/`.

CEF, Chromium and depot_tools checkouts match their pinned commits. Both engine
patches also pass applicability checks against those full checkouts. The
depot_tools bootstrap now provides `git.bat`. Bounded dependency acquisition
verified 154 Git dependency pins, but is not a clean completed sync: Windows
security blocked an x86 Google Updater integration-test fixture. No antivirus
exception or quarantine bypass was applied. That fixture is not an x64 CEF
production dependency. The approved encoding-only repair of the user-level
`pip.ini` is complete: its settings and permissions were preserved, a backup
was retained, and Chromium setup hooks now finish successfully.

The patched Windows x64 engine has compiled and its custom runtime archive has
been packaged, inventory-checked, round-trip verified and registered with the
local normal-build selector. This is not yet a passing browser acceptance gate.
The generated source workspace was moved outside the app
repository because Chromium's TypeScript tasks were picking up the app's
`node_modules`. The original artifact path is a junction to the isolated
workspace, preserving existing evidence paths. Build preflight now rejects
workspaces with ancestor `node_modules` directories. The pinned CEF release
metadata was also fetched; upstream version generation reports the expected
version. The completed build regenerated its version-dependent files before
packaging. Acquisition logs are under
`.artifacts/cef-src-20261007/acquisition-logs/`; the old
`terminal-checkpoint.json` does not describe the resumed run.

Normal-build custom-runtime staging now has source-pin, provenance and export
validation, with no stock-runtime fallback. Global and per-connection browser
settings exist, and the earlier native integration compiles against the pinned
SDK. The unavailable-browser warning now has a themed button opening Settings
→ Web Browser; its mounted UI tests pass. This action does not change the
connection's policies or select a fallback engine.

Retention is being corrected to store sign-in cookie snapshots inside the
owning encrypted database, including its sync/export path, rather than in
device-local sidecars. This integration and its native atomic transfer checks
are still in progress. Retention is capability-gated and is not available merely
because settings exist. Each attempt uses a private in-memory context; retained
cookies may only be restored under an unlocked owning-database lease. This is
not a full browser profile, localStorage or IndexedDB backup. Retention is off
by default.

Cookie retention settings support memory-only or encrypted database snapshots, bounded
idle/absolute expiry and optional deletion on database lock. Lock always closes
live attempts. An ordinary close checkpoints cookies before revoking its
retention lease; owner loss never uses that checkpoint path. Opting out blocks
restoration; existing encrypted snapshots can remain dormant rather than being
deleted when settings are saved. Background cleanup runs independently of live views. File-system
stalls can delay cleanup; error notices do not claim that deletion succeeded.

The normal Windows x64 debug application build now succeeds with the locally
registered patched engine. Its package inventory passes and staging repairs
missing sandbox read/execute grants without disabling the sandbox. The
standalone TLS fixture also rebuilds with the native startup repair and final
client delay-load policy. These are build/package results, not completed
application startup or sign-in acceptance.

The final frontend browser subset passes 2,068 tests across 60 files, and the
application TypeScript check passes. The browser tooling suites pass 253 tests
with five platform/privilege skips; a separate browser-contract run passes 115
tests. These checks do not replace native runtime acceptance.

Cold-launch testing exposed a Windows ACL control-bit preservation failure.
The native repair now preserves the existing auto-inheritance state; its 11
focused regression tests pass, including unchanged descendant permissions.
The rebuilt cold-launch fixture repaired 245 runtime entries without changing
original ACEs, owner/group, control flags or ancestor permissions and reached
CEF initialization. It then failed a separate TLS handshake assertion
(`cert_verifier_request_`) and dangling-pointer check; the full native acceptance
gate still fails. This confirms the bounded ACL repair, not browser readiness.

An earlier native netlog also recorded a direct IPv6 reachability UDP probe to
`[2001:4860:4860::8888]:443`. Consequently, complete proxy containment has not
passed: resolver switches alone do not establish that every engine request is
routed through the app proxy. The package remains `productionReady: false`.

A subsequent normal development launch was reported to reach CEF but fail
cache, cookie and service-worker database access, followed by a fatal
`ServiceWorkerRegistration` uninstall-state assertion. Storage initialization
and context teardown require separate investigation; the sandbox executable
access repair is not evidence that this later failure is resolved. Existing
profiles and database-contained session snapshots must not be deleted as a
blanket recovery step.

Remaining gates include native socket and
cookie restore tests, normal-build startup, all-platform
packaging and runtime containment, live native login-adapter validation,
and real Google/Cloudflare acceptance. CookieManager restoration, AIA/OCSP/CRL
fetch containment and HTTP keep-alive runtime coverage remain unverified. No provider sign-in or challenge success
is inferred from source, compilation or fixture checks. Changes are being
committed locally by concern; no push or remote CI was run.

### Windows sandbox startup recovery

Windows AppContainer/LPAC children need read/execute access to packaged browser
code and resources, independently of the signed-in user's access. Copying a
working package into a private development directory can remove that access.
The build/launch preflight repairs these grants, and the native browser startup
also checks them when a packaged executable is launched directly.

Recovery is a bounded preflight, not a crash/relaunch loop. It targets only the
application bootstrap/client, pinned CEF runtime files and locale packs, with
non-inheritable read/execute grants for the two application-package SIDs.
Profiles, cookies, databases, unrelated files and ancestor permissions are not
repair targets. Explicit deny rules, redirected paths and unsupported ACLs fail
with repair/reinstallation guidance. There is no elevation, write-access grant,
certificate-policy change or sandbox-disable fallback.

The Windows final-client linker policy also follows the pinned CEF delay-load
contract. Loading UI/COM DLLs before dispatching a sandboxed child can fail under
Win32k lockdown; the fix delays those dependencies, rather than weakening that
lockdown. Startup repair does not establish browser compatibility or network
containment; those still require the native acceptance runs above.

The sections below include dated earlier milestones. Their statements about
unwired or optional integration describe those milestones; this checkpoint is
the current integration status, not a completed rollout claim.

This gate checks deterministic regressions for Google login, Cloudflare
login/challenge routing, Porkbun opening/login helpers, proxy isolation, injected
assets, browser identity and dark-mode readiness. It does **not** open a browser,
contact a live login endpoint, submit credentials, or certify that a service will
accept an embedded browser.

## Architecture and service limits

The current mediator rewrites upstream origins to isolated local aliases and
injects compatibility scripts into embedded documents. It is not a native
browser retaining the upstream HTTPS origins, even when it forwards the correct
WebView user agent. Reducing injected bytes and fixing script timing can improve
compatibility, but cannot establish that a provider accepts this architecture.

Google documents that sign-in can be blocked for browsers embedded in another
application or controlled by software automation. An identifier page rendering
successfully does not prove that Google will accept the password or complete
authentication. See [Google's supported-browser guidance](https://support.google.com/accounts/answer/7675428?hl=en).

Cloudflare requires Turnstile's API script at its canonical URL and warns that
proxying or caching it can break verification after updates. Fixing script
discovery in the current mediator does not remove that vendor limitation. See
[Cloudflare's client-side rendering guidance](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/).

A replacement using an origin-preserving forward proxy and a top-level
renderer is being developed separately from the legacy mediator. The native
transport foundations below are not an enabled browser mode or a promise that
providers will accept it. Browser identity spoofs are not evidence of acceptance. All application
requests, including redirects and secondary resources, must still traverse the
app proxy; neither current testing nor a future design permits direct fallback.

The legacy mediator's anonymous external-resource route supports approved classic
scripts and stylesheets, but does not yet preserve the base URL for CDN ES modules
with relative imports. Mapping a module entry or `modulepreload` URL alone is not
proof that its dependency graph loads: relative imports currently resolve against
the local resource endpoint. This remains a compatibility limitation to cover with
a real module-loading fixture; the origin-preserving foundation is not yet wired
to website tabs and does not fix that limitation in the current mode.

### Origin-preserving upgrade contract

The approved rollout is Windows, Linux and macOS **together**, with macOS 14+
acceptable for the replacement. The proxy remains private to this application.
A bundled Chromium runtime is permitted if native engines cannot satisfy the
same compatibility and isolation requirements; this is not a commitment to a
particular runtime or evidence of a working host integration.

The implementation sequence, ownership, dependencies, risks and acceptance gates
are tracked in [the real-origin browser plan](real-origin-browser-plan.json).
CEF is the current **feasibility candidate**, not a selectable production engine.
The optional `sorng-browser-host/cef-host` engineering feature pins matching CEF
bindings and runtime; the application does not enable it. The native API review did not establish the required complete
resource/worker/WebRTC containment with public WKWebView APIs. CEF in turn needs
a macOS application-event-loop bridge. Linux **X11/XWayland is approved**:
the app GTK shell and native CEF child must both use X11, selected before toolkit
initialization. Native Wayland embedding is not claimed or silently substituted.
See the [CEF macOS application contract](https://github.com/chromiumembedded/cef/blob/master/include/cef_application_mac.h)
and [Linux native child implementation](https://github.com/chromiumembedded/cef/blob/master/libcef/browser/native/browser_platform_delegate_native_linux.cc).

Forced dark mode and automatic login must remain active on authentication and
challenge pages, as explicitly requested. This does not authorize CAPTCHA
automation, foreign-origin credential release, or silent suspension of those
features to obtain a passing compatibility result. Shared website/domain request
defaults **plus per-connection overrides** are also part of the planned upgrade;
the effective permission and its source must be visible. These permission screens
are not implemented by the transport fixtures below.

### Native host engineering checks

The optional host crate contains attempt-fenced lifecycle state, private in-memory
CEF context preparation, fixed proxy preference write/readback, native proxy-auth
and URL admission callbacks, and borrowed native-child descriptors. Context
callbacks also cover requests without a browser/frame (for example workers).
These components do not start a production browser or report it ready. Sandbox
bootstrap, alternative-transport containment, native event loops, tab integration,
dark-mode and login adapters remain release gates.

```powershell
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-browser-host --features cef-host --locked
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-file-viewer-host --test native_real_origin --locked -- --probe
```

On 2026-10-06, the first command passed 35 boundary tests on Windows, including
actual tunnel termination after poisoned session/context state and protection
against stale callbacks revoking a successor. Linux and
macOS child modules are platform-gated and were not compiled or run here.
The explicit `--probe` run passed on WebView2 146.0.3856.84 using a disposable
profile and a synthetic local HTTPS hostname resolved only by the retained relay.
It checked original `location.origin`, top-level secure context, native cookies,
HttpOnly isolation, local storage, upstream SNI and proxy-credential isolation.
The generated fixture certificate was pinned only in that disposable view;
no OS trust store or production certificate policy changed. Profile cleanup passed.

The probe installs no Wry IPC handler and disables native web messaging and host
objects. Wry still exposes an inert `window.ipc` property; the receipt reports
that honestly rather than claiming the property is absent. The probe never emits
production Ready, uses no public website/account, and is **not** an all-traffic
containment, CEF-runtime or provider-acceptance test. Without `--probe`, it reports
SKIPPED; a successful process exit on that path is not browser evidence.

The transport foundation uses an authenticated loopback HTTP/CONNECT listener with
an OS-selected port and native-held, per-session credentials. After CONNECT
admission it relays opaque bytes: the browser owns destination TLS, HTTPS origins,
cookies, storage, redirects and WSS. An explicit HTTP(S) upstream proxy route
reuses the existing bounded CONNECT transport, including proxy TLS validation;
failure never silently becomes a direct route. SOCKS5 routes support explicit
no-auth or username/password authentication, remote target DNS, bounded
establishment and cancellation, without authentication downgrade or fallback.
Native browser routes share a 16-job OS DNS limit. Cancelling a caller does not
release a running resolver's slot until the OS lookup ends; queued callers stay
cancellable, numeric endpoints bypass DNS, and results are capped at 64 addresses.
HTTP(S) upstream proxies currently need to allow CONNECT to the destination
port, including port 80 for a plain HTTP destination.

Plain HTTP forwarding handles absolute-form requests, streamed fixed-length or
chunked bodies, `100-continue`, responses and WebSocket upgrades. It preserves
website URLs, credentials, cookies and response bodies, removes hop-by-hop and
proxy-authentication headers, and never follows redirects itself. Ambiguous
framing and unsupported transfer codings are rejected, not guessed. HTTP traffic
has response-head and no-progress deadlines; upgraded WS/CONNECT streams remain
usable while quiet until revoked. These rules follow the framing and forwarding
requirements in [HTTP/1.1](https://httpwg.org/specs/rfc9112.html) and the
[WebSocket opening handshake](https://www.rfc-editor.org/rfc/rfc6455.html#section-4.1).

The initial HTTP implementation deliberately closes each browser HTTP connection
after one response, so a pipelined request cannot inherit admission for a
different destination. Message trailers are discarded. Connection pooling,
SOCKS4/SSH/chain adapters, production browser authentication callbacks, native view hosting
and enforcement of non-proxy browser traffic are still unimplemented here.

The shared native `answer_proxy_challenge` boundary now checks the current
attempt, proxy role, exact numeric listener address/port, Basic scheme, relay
realm and live session before calling the credential callback. A website 401
using the relay's realm, a localhost alias or a stale attempt does not qualify.
This boundary is available during host setup but does not assert host readiness.

The native session policy defaults to its source origin only. Additional
HTTP(S) origins can be granted explicitly (bounded to 128 total); there are no
wildcards or implicit credential-consent grants. Login admission remains
source-only. The native host must enforce exact schemes for navigation,
redirects and resources; relay authority checks alone see only host and port.

Before exposing the replacement in settings, every platform must demonstrate:

- An isolated top-level website view inside the connection tab, with no app
  iframe ancestor or privileged app IPC access; printer child frames retain
  normal same-origin behavior without disabling browser security.
- An isolated browser profile and authenticated proxy session bound to the
  owning database, connection and attempt; closure/revocation cancels traffic.
- Proxy enforcement before first navigation, including redirects, workers,
  WSS, DNS, loopback destinations and proxy failure. UDP, QUIC, WebRTC and
  unsupported routes must not silently bypass the configured network path.
- Native browser identity, TLS and vendor scripts without localhost rewriting,
  fake `postMessage` origins or browser-identity spoofing.
- Origin-bound auto-login and first-paint dark-mode injection without modifying
  challenge verification or exposing credentials to foreign frames.
- Actual Google password-stage navigation, Cloudflare human verification,
  Porkbun login and Kyocera frame navigation on each supported engine; synthetic
  transport fixtures cannot stand in for these observations.

`browser-transport-contracts` in CI runs the shared deterministic/native fixture
gate on Windows, Linux and macOS and is required by the rolling-release job.
It does **not** certify the browser-host requirements above. Until those pass,
the replacement remains unavailable on all three platforms; a successful
Windows fixture run does not authorize a Windows-only rollout.

## Run the automated gate

From the repository root, with the repository's Node/npm versions and dependencies installed:

```powershell
npm run browser:readiness
npm run browser:readiness -- --report .artifacts/browser-readiness.json
npm run browser:readiness -- --native --report .artifacts/browser-readiness-native.json
node --test tests/tooling/browserReadiness.node-test.mjs
```

The fixed suite list is exported as `SUITES` in `scripts/browser-readiness.mjs`.
It includes `autologinAsset.test.ts`, `autologinScopedAsset.test.ts` and
`autologinClientLifecycle.test.ts`, so changes to staged asset assembly,
selected-adapter dispatch and lifecycle remain part of the gate. The
runner verifies a JSON receipt for every required file and requires at least one
executed, passing test in each. A missing dependency/file/receipt, skipped test,
empty selection, failed assertion or unsuccessful child exit cannot pass.

`--native` executes eleven scoped commands from the repository root, each with
its own status, counts and duration:

```powershell
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib cloudflare_challenge --locked
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib google_tests --locked -- --skip live_accounts_navigation_distinguishes_malformed_metadata_from_native_identity_and_cookies
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib autologin_asset --locked
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib dark_mode::tests --locked
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib origin_browser --locked
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib private_forward_proxy --locked
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib private_forward_route --locked
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib browser_transport --locked
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib browser_dns --locked
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --test origin_browser_real_origin --locked
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --test origin_browser_native_auth --locked
```

The native build wrapper sets up platform build helpers; there are no added
feature or target overrides. Existing Cargo environment/workspace configuration
still apply. These cover Cloudflare/Porkbun challenge transport/CSP, Google
identity/cookie/lifecycle fixtures, selected auto-login asset assembly and the
first-paint dark-mode CSS/readiness contract.
The final seven selections cover the origin-preserving session contract,
authenticated HTTP/CONNECT relay, explicit route adapters, the opaque upstream
transport, cancellation-safe DNS resource bounds and public-API TLS/WSS session
integration and native challenge credential-release boundaries. The TLS/WSS integration target tests original TLS/SNI/certificate/ALPN,
cookie/header preservation, quiet WSS streams, owner/host/drop revocation,
wrong-host certificates and rejected redirects across real loopback sockets.
Both integration targets use `--test`, not similarly named `--lib` filters. These fixtures
do not instantiate native browser hosts.
They do not run the whole workspace. The ignored live Google probe is explicitly
excluded with `--skip` and separately reported `not-run`. Cargo's filtered-out
tests are outside the declared scope; zero executed tests, failed tests or
ignored tests remaining within a selection fail that suite. Ignored counts are
reported independently and never counted as passed.

Exit `0` means only the requested automated layers passed; `1` means a requested
layer failed or did not run; `2` means a usage, runner or report-writing error.
The JSON separates `deterministic`, `native`, `embeddedLive` and `loginReadiness`.
The latter two always remain `not-run`. Native is `not-run` without `--native`.
Browser prerequisites are explicitly unprobed; an unavailable browser is never
treated as a successful browser check. There is no implemented live-test flag.

Reports contain fixed suite paths, statuses, counts, durations, timestamps and Node version.
Raw stdout/stderr, assertion titles, error stacks, account values, URLs with query
strings, cookies and tokens are not copied into the report or runner output.
The raw Vitest receipt is temporary and removed after parsing. `--report` replaces
the chosen report file; use an artifact path. To debug a failed fixture, run its
listed suite separately and inspect diagnostics locally before sharing them.

## Acceptance matrix

| Layer                      | Executable evidence                                                                                                                                       | What it proves                                                                                                                  | What remains unproved                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Deterministic              | Default runner                                                                                                                                            | Reviewed staged forms, injection/lifecycle, route rejection, identity options and paint recovery under mocks/jsdom              | Real parser/network timing, WebView behavior, vendor acceptance                                                |
| Native fixtures            | Runner with `--native`                                                                                                                                    | Actual Rust mediator against synthetic TLS/proxy peers; isolated cookies, exact origins, CSP, redirects and document revocation | Live challenge solve, Google account login, production transport                                               |
| Installed browser fixtures | `node scripts/test-web-network-browser.mjs`; `node --test tests/tooling/webBrowserFrame.browser-test.mjs tests/tooling/webSpaNavigation.browser-test.mjs` | Real Edge/Chromium semantics against local synthetic pages                                                                      | Tauri injection/native mediator and the three live services; these are separate commands, not run by this gate |
| Embedded live              | Manual procedure below                                                                                                                                    | Only the stages actually observed in the built Tauri/WebView app                                                                | Every unobserved stage remains not-run; blocked verification is not success                                    |

The installed-browser harnesses require a browser executable and can skip when
it is absent: a skipped browser test is **not-run**, even if Node exits zero.
The app runner at `e2e/wdio.conf.ts` requires a verified isolated binary via
`TAURI_BINARY_PATH` (built using `npm run e2e:build`). Its existing HTTP Viewer
spec mainly checks visible UI; it is not a Google/Cloudflare/Porkbun login gate.
No dedicated desktop login specs for those three were found in this audit.

The Synology CDP harness is a useful design reference. Its updated mirror passes
19 static production-shape checks across five native source files, and the
script passes `node --check`. It models the mode-scoped Synology asset and current
network/readiness bootstrap; the complete legacy bundle has a separate guard.
The browser harness itself has not been run for this validation, so these static
checks are not browser or login evidence. No live-session test or automated
browser prerequisite check is implemented in this runner.

## Actual WebView acceptance

### Repeatable anonymous live probe (Windows)

`npm run browser:live` builds and runs a disposable **real WebView2** host with
the production proxy startup, response rewriting, cookie handling and Windows
network guard. It opens Google Analytics's Google sign-in route, Cloudflare
Dashboard and Porkbun, once normally and once with the proxy's dark bootstrap.
Use `-- --site porkbun --dark` for one case. Each case observes for 45 seconds.
Use `-- --report .artifacts/browser-live-check.json` to preserve a separate run.

This is not jsdom, a recorded HTTP response or an unrelated browser. It is also
not the entire React/Tauri application shell: the small parent reproduces its
sandbox and validated document-activation handshake. The dark bootstrap's local
CSS fallback is tested, not the React-delivered DarkReader configuration.
There is no debugger port, fake User-Agent or WebDriver flag. Each invocation
uses an isolated temporary profile and closes its controller and proxy afterward.
It never opens the application's database or imports an existing browser profile.

The sanitized `.artifacts/browser-live.json` contains visible form counts,
challenge/refusal booleans, script/CSP error counts, activation counts, request
status counts and blocked origins. It contains no field values, cookies, query
strings or raw page/console text. Missing observations and unrendered forms fail
the command. **A rendered form is not a successful login:** identifier submission,
password, MFA, human challenges, authenticated state and reload remain untested
until exercised interactively with a test account. No dummy credentials are sent.
An ordinary Cargo test run skips this public-network probe unless `--live` is
explicitly supplied. Site refusals are test findings, not reasons to disable the
network guard or browser security.

#### Observed on 2026-10-01

The six-case matrix ran against the real public services with Windows WebView2
146.0.3856.84 and its native Edge 146 User-Agent, verified upstream TLS and the
default per-connection network policy. Every normal run removed its temporary
profile after closing the browser. Results are opening-stage evidence only:

| Site                              | Dark off                                                | Dark bootstrap on          | Remaining evidence gap                                                     |
| --------------------------------- | ------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| Google Analytics / Google sign-in | Email field visible, no observed script/CSP errors      | Same; dark shield released | Identifier submission, password, MFA, authentication, reload               |
| Porkbun                           | Username/password visible; Turnstile present            | Same; dark shield released | Human verification and authenticated login; two resource/CSP blocks remain |
| Cloudflare Dashboard              | 403 managed challenge, no login fields after 45 seconds | Same; dark shield released | Challenge completion and every login stage                                 |

A focused Cloudflare rerun recorded `Worker` / `unsupported-network-context`
from the **production injected network layer**. This is an app-side compatibility
blocker even though no uncaught script/CSP error was reported. The following
repair removes that particular blocker; it does not establish challenge clearance.

Local receipts: `.artifacts/browser-live.json` (complete matrix) and
`.artifacts/browser-live-cloudflare-diagnostic.json` (categorized block).
The runner correctly exits nonzero for the unresolved Cloudflare cases. The
anonymous probe never asserts successful account login or challenge clearance.

#### Repair verification on 2026-10-02

The same six live cases were repeated with WebView2 146.0.3856.84. Google still
renders its identifier field and Porkbun still renders username/password, with
dark bootstrap off and on. Cloudflare still shows its managed challenge after
45 seconds in both cases: three upstream requests (two 200, one 403), no login
fields, and no recorded bootstrap, script, CSP or injected-network blocks.
Temporary profiles were removed. The matrix deliberately exits nonzero.
Receipt: `.artifacts/browser-live-repairs.json`.

The closed Cloudflare/Porkbun challenge profile now permits **blob workers only**
through CSP and preserves the native `Worker` constructor. Network worker URLs
remain prohibited; blob workers inherit the creator's local-only connect/script
policy. Shared workers, service workers and other unsupported network contexts
remain blocked. There is no direct-network fallback. Source navigation no longer
forwards Fetch Metadata describing the localhost embedding iframe; no fabricated
top-level/user-activation headers or alternate User-Agent are added.

An opt-in real WebView regression captures the native constructor before page
injection and verifies local worker computation plus actual CSP rejection of
external `fetch`, WebSocket and `importScripts` calls. It checks violation events,
not merely failed DNS resolution. All four checks passed:

```powershell
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-file-viewer-host --test native_live_browser --locked -- --live cloudflare --check-workers
```

The worker probe is separate from challenge readiness: its success is not a
successful challenge. It records only fixed booleans and never executes during
ordinary live runs. Do not build this executable concurrently with another live
invocation on Windows.

Cloudflare explicitly excludes challenge pages embedded in cross-origin iframes
and challenges served under a different domain from the requested one. The
current alias-based iframe viewer has both characteristics. This documented
architecture mismatch remains after the worker repair; the probe does not
identify Cloudflare's private decision logic. See
[Cloudflare challenge limitations](https://developers.cloudflare.com/cloudflare-challenges/concepts/how-challenges-work/#limitations).
An origin-preserving top-level browser surface using the mandatory app proxy is
still architectural work, not an implemented or verified fallback.

Google's password-stage transport also has a new native fixture. It exercises
identifier GET, unchanged RPC POST, and continuation GET through the production
Axum handler and a synthetic CONNECT/TLS peer, including cookies and returned
password-form HTML. Reviewed Accounts `batchexecute` continuation URLs carried
inside JSON are now mapped to existing document aliases while retaining XSSI
guards, length framing and opaque fields. This fixes a source-discovered gap;
the public live probe has not submitted an identifier and therefore **does not
verify the user's missing-password-field failure or authenticated login**.

### Full application and authenticated acceptance

Use a freshly built isolated app profile, a test account entered interactively,
and the intended saved application profile and proxy settings. Record build
revision, WebView version, platform, enabled options, stage outcomes and elapsed
times. Keep account values, credential fields, tokens/cookies, query strings and
unredacted screenshots/network traces out of shared artifacts. The runner does
not collect or import this manual evidence.

1. Open each saved profile through the app proxy: Google Accounts via its
   approved application route, Cloudflare Dashboard, and Porkbun
   `/account/login`. Require visible usable content, successful document
   activation and no uncaught shim/injection error. Porkbun opening is its own
   acceptance result; it does not require a successful login to pass that stage.
2. Observe email/username, then password. Check that only the intended stage
   receives credentials, fields remain usable through SPA transitions, and
   submit does not duplicate. Mark absent stages not-observed rather than passed.
3. If a challenge appears, require its API script/frame/resources to use the
   native proxy aliases. Check both parser-loaded and dynamically created script
   discovery; `script.src` may present the canonical Turnstile API URL while the
   native loading attribute remains local. Complete verification manually when
   the service permits it. Record a refusal or inability to complete as such;
   never bypass it or infer success from a challenge token's presence.
4. Require a real authenticated application view and a successful authenticated
   operation that reads harmless account state. A submitted form, HTTP 200,
   anonymous GET, hidden challenge or fixture success is insufficient.
5. Reload within the same app session and confirm authenticated state persists
   through the native cookie jar and proxy. Then close/reopen as a separate
   observation; do not assume persistence across a new proxy/session lifetime.

For each site retain separate results for opening, identifier, password,
challenge, authenticated state and reload. Distinguish failed, not-run and
not-observed. Fonts/Stripe policy blocks are separately recorded by origin and
resource type; they do not authorize wildcard permissions or disabled CSP.

## Timing and injected footprint comparison

Measure the same page/build/profile with optional dark mode, automation/recording
and compatibility settings off, then enable one at a time. Keep the mandatory
network guard, native proxy enforcement and CSP active in every comparison.
Do not change browser identity to claim a verification bypass. Compare multiple
runs, recording cold/warm conditions and only nonsecret timings/counts:

- Navigation to guard installation, `proxy_document_start`, native activation,
  first upstream script, first usable form, `proxy_dom_ready` and paint-ready.
- Injected script bytes/count, long tasks, uncaught exception counts, CSP
  violation origins/directives and whether requested resources reached the
  expected local alias. Assert zero unintended direct application requests.
- Parser-blocking, async/defer and dynamically inserted Turnstile scripts;
  Google identifier-to-password transitions; Porkbun's named blank iframe;
  refresh/close while activation or challenge resources are pending.

Source-backed candidates, not additional proven live bugs: `http_response.rs`
installs networking, dark mode and automation before emitting
`proxy_document_start`; a synchronous exception can prevent that signal.
`useHTTPViewer.ts` invokes native activation only after a validated signal.
`http_network_client.rs::await_document` bounds that wait to five seconds;
challenge parser requests wait for that activation. Existing native fixtures
cover selection/newer-document/stop with a short delay, not a busy embedded
renderer exceeding the deadline. Measure this chain before changing ordering.
The early inserter intentionally precedes upstream executable content; verify
that property on actual returned HTML rather than assuming jsdom proves it.

An existing ignored native Google probe performs anonymous GETs and checks
request metadata/cookies. It uses a recorded browser identity and is neither a
real WebView run nor a post-identifier login test. To explicitly run that
public-network diagnostic separately from the root:

```powershell
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib live_accounts_navigation_distinguishes_malformed_metadata_from_native_identity_and_cookies --locked -- --ignored
```

The filter intentionally omits `--exact`, which would require the full Rust
module path. This GET-only diagnostic cannot promote any live-login stage.
