# Standalone patched CEF TLS fixture

This independent executable uses the production host crate and sandbox bootstrap;
it does not launch the production app. It requires loaded ABI V2 and the frozen
`sorng-tls-v2-682c378-1` build. Stock SDKs can compile the client but cannot pass
its loaded-engine check. No certificate-ignore/security-disable/UA switches are
added. The disposable CA is passed to the private native context only.

The fixture runs optional manual login, native Identifier/Password login, deny, dropped
completion (cancel), exact host/port/leaf mismatch, stale completion after owner
revocation, and a successor whose native TLS challenge arrives while the
predecessor browser and unanswered completion are still retained. Both attempts
use the same owner/connection/tab and distinct attempt identities. Only then is
the predecessor revoked and its stale allow completion submitted; the successor
must still complete its login. All route dials map only
`accounts.google.com:443` to the numeric loopback TLS listener. The reviewed staged
adapter requires that exact origin. This is **not public Google acceptance**.

TLS completions are held for at least 350 ms. Each accepted TCP transport gets a
unique leaf DER signed by the disposable CA (unique serial and fresh key, no
server session cache or TLS 1.3 tickets). Before its TLS handshake starts, the
fixture records that leaf against the socket ID. Native evidence must match that
exact DER once; `(context, generation, challenge)` is then bound to the socket.
Every server HTTP read checks that socket's decision, never a shared credit.
`allowDecisionsSubmitted` explicitly measures submissions, not native completion
acknowledgments; the ABI does not expose such an acknowledgment to this client.

Positive cases require completed handshakes and actual HTTP login/pulse proofs.
Negative cases require native challenges, zero completed handshakes, zero HTTP
bytes, and retained TLS-error outcomes. Merely attempting a connection cannot
pass them. Unchallenged speculative transports are retained and can pass only
if TLS fails with zero payload. Each connection retains completed/EOF/TLS-error/
I/O-error/timeout/cancellation outcomes. Listener/task failures, timeouts,
cancellation, incomplete collection, duplicate correlation, and aggregate/socket
counter disagreement fail the validator. Collection is drained after revocation
before the terminal report is assembled; forced task cancellation fails.

Post-revocation counters are server-read observations relative to the local
revocation marker, not packet timestamps. This fixture still closes HTTP/1.1
connections after one request. **AIA/OCSP/CRL fetches and keep-alive reuse have no
runtime coverage yet.** The mismatch cases exercise fixture-owned policy; they
do not establish production persistent trust-authority integration.

Run from the repository root, after the main lane allocates the Cargo slot:

```powershell
# Compilation can use the stock SDK. Execution must use the patched runtime.
$env:CEF_PATH = (Resolve-Path '.artifacts/browser-app/x86_64-pc-windows-msvc-7fsoBq/sdk/runtime').Path
node scripts/native-build-env.mjs cargo build --manifest-path src-tauri/crates/sorng-browser-host/tests/native_tls_acceptance/Cargo.toml --lib --offline --locked --target-dir F:/Projects/sortOfRemoteNG/.cache/cef-target

# Set this to the completed, inspected patched SDK runtime directory.
$tlsRuntime = 'F:/Projects/sortOfRemoteNG/.artifacts/PATCHED_SDK/runtime'
node scripts/cef-browser-acceptance.mjs stage --suite tls --runtime $tlsRuntime --client .cache/cef-target/debug/sorng_cef_tls_acceptance.dll --output .artifacts/cef-tls-bundle-01 --target x86_64-pc-windows-msvc
node scripts/cef-browser-acceptance.mjs run-tls --executable .artifacts/cef-tls-bundle-01/sorng_cef_tls_acceptance.exe --output .artifacts/cef-tls-run-01 --manual true --timeoutMs 360000
```

Use a new stage/run directory for every invocation. The initial offline check
generated this independent crate's lockfile; main should review it. Subsequent
checks/builds use `--locked`.
The manual case waits up to 120 seconds: type `synthetic@example.test` and
`synthetic-local-only` in the visible local form and submit. The Manual adapter
releases no credentials, and the proof requires a trusted submit event. Omit
`--manual true` (or use `run --suite tls --manual false`) for unattended automated
acceptance. That mode hides the native window, runs every automated case, and
explicitly reports `manualStatus: "not-run"`, `manualAcceptance: false` and the
remaining trusted-manual-input probe. It cannot establish manual acceptance.
This is a hidden native-window run, not Chromium's headless mode: it still needs
the platform's desktop/windowing and sandbox prerequisites. No headless,
certificate-ignore, GPU-disable or security-disable switch is added.

## Same-origin storage and reconnect probes

After the TLS cases, `storage.rs` runs 13 ordered page probes through
`PrivateRequestContext::create_with_tls`, the production patched native context
factory. It uses the same native certificate decisions, disposable custom CA,
350 ms admission hold and per-socket byte ledger as the existing TLS suite.
There is no SPKI exception or use of the legacy fixture. All requests retain
the exact `https://accounts.google.com` origin but route to loopback only.

Two distinct synthetic connection identities share that origin and are live
simultaneously. They use identical script-cookie, HttpOnly-cookie, localStorage,
IndexedDB database, object-store and key names. A writes, B proves it is empty
and writes back, A proves its value survived and overwrites it, then B proves
its value survived. IndexedDB evidence waits for transaction completion and
closes each database handle before navigation. Server Cookie headers independently
check both cookies; missing API observations are not treated as empty stores.

A is then revoked, acknowledged closed, dropped, and its relay/server tasks are
stopped and drained. B stays live and re-reads its values. A reconnects with the
same database/connection/session IDs but a fresh attempt/native context, proves
all four stores empty, writes new values, and B proves its values unchanged.
All three contexts must have distinct native TLS tokens, actual renderer pulse
requests, rejected post-revocation navigation, zero post-revocation HTTP bytes,
acknowledged closure and drained tasks. Final CEF shutdown remains mandatory.

`storage-progress.json` retains completed steps if a native close crashes;
the terminal result is `native-report.json.storageIsolation`. Missing, partial,
failed or unrun probes fail the storage validator. A cleanup deadline writes a
failure checkpoint and exits without attempting CEF shutdown with live owners.
The runner still records process failure; a partial checkpoint is never a pass.

Coverage limits: ephemeral private contexts only, with no retained-cookie import;
A reconnect is covered, B reconnect is not. This does not test app IPC, saved
database authorization, production user sessions, public providers, disk erasure,
service workers/Cache Storage, or persistence across a process restart. No
production files, cookies or performance metadata are opened or deleted.

The new source/validator checks can run without a native build:

```powershell
node --test tests/tooling/cefBrowserAcceptance.node-test.mjs
```

They validate fixtures and synthetic report rejection, not actual CEF isolation.
The Rust code and its helper unit tests also require a native build/run; the
current Windows result is recorded below, separately from the validator tests.

On Linux/macOS, build the same crate's binary and use the existing platform
packager for its helper/resources (X11/XWayland and signed Mac helper/framework
bundles respectively). Run the same `run-tls --executable ...` command on that OS.
The Windows SDK copier intentionally does not fabricate Unix packages.

Evidence: `native-report.json`, intermediate `native-progress.json`, native
netlog, process outcome, Windows renderer-token observations, and aggregate
`acceptance.json`. Reports are tied to the fresh runner invocation. The validator
is not an attestation mechanism for untrusted executables or forged reports.
The runner also scans `cef.log` into `native-crash-summary.json`, containing only
fixed labels and counts, never log lines, URLs, credentials or native error text.
Native FATALs and network-service crash/restart messages fail both suites even
after recovery, otherwise passing negative TLS cases, or process exit zero.
Missing/unreadable/changing logs, unterminated final lines, lines over 64 KiB, or
logs over 16 MiB cannot establish a clean scan. A readable empty log is allowed;
this is logged-marker detection, not an OS-level crash monitor. Existing process,
network, sandbox and native shutdown gates remain independent and mandatory.
`nativeTlsFixtureAccepted` is set only by the runner after native report, process,
network-log and (on Windows) sandbox observations pass. Full
`actualCefAcceptance`, `productionReady`, and `publicProviderAcceptance` remain
false, including when all local fixtures pass. OS packet containment, first-paint
pixels, public providers, scoped certificate exceptions, application persistent
trust integration, and native runs on each supported OS remain separate gates.

Lane verification: `node --test tests/tooling/cefBrowserAcceptance.node-test.mjs`
and `rustfmt --edition 2021 --check` on this crate's Rust entrypoints. The ledger
also has dependency-free Rust tests, runnable without a Cargo build:

```powershell
$tlsLedgerDir = Join-Path ([IO.Path]::GetTempPath()) ('sorng-native-tls-ledger-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tlsLedgerDir | Out-Null
rustc --edition 2021 --test src-tauri/crates/sorng-browser-host/tests/native_tls_acceptance/src/ledger.rs -o (Join-Path $tlsLedgerDir 'ledger-tests.exe')
if ($LASTEXITCODE -eq 0) { & (Join-Path $tlsLedgerDir 'ledger-tests.exe') }
```

These tests use synthetic observations and cannot establish CEF acceptance.

Earlier Windows x86_64 compilation on 2026-10-07, with the stock SDK at the `CEF_PATH`
shown above and target directory `.cache/cef-target`:

- `cargo check --lib --offline`: passed, exit 0, 1m 36s.
  Full log: `.cache/native-tls-check-20261007-131319.log`.
- `cargo check --all-targets --offline --locked`: passed, exit 0, 2.47s.
  Full log: `.cache/native-tls-check-all-targets-20261007-131516.log`.
- `cargo build --lib --offline --locked`: passed, exit 0, 1m 57s, including
  linking `.cache/cef-target/debug/sorng_cef_tls_acceptance.dll`.
  Full log: `.cache/native-tls-build-lib-20261007-131827.log`.

These commands used `scripts/native-build-env.mjs` with this crate's
`--manifest-path`, in Cargo slots allocated by main. No dependency fetch was
needed. No stock runtime was executed. Successful Windows compilation/linking
does not establish patched-engine loading, sandbox bootstrap, or TLS fixture
acceptance. See the later patched-engine execution below. AIA/OCSP/CRL fetches and
HTTP keep-alive runtime coverage remain unimplemented. No Linux/macOS build or
runtime result is claimed.

## Patched Windows execution — 2026-10-07

The five-patch `package-windows-x64-recovery-04` engine and the current fixture
completed `.artifacts/cef-recovery-tls-run-04c-20261007/acceptance.json` with
`ok: true`, `exitCode: 0`, `nativeTlsFixtureAccepted: true` and
`storageIsolationObserved: true`. The correlated native run is `run-R4eZ0x`.
All eight automated TLS cases and all thirteen storage steps passed. Native
shutdown completed, the proxy-netlog gate passed, Windows renderer sandbox
observations passed, and the bounded log scan reported zero native FATALs and
zero network-service crash/restart markers. Expected rejected-TLS errors remain
logged; neither TLS verification nor the sandbox was disabled to pass the test.

The staged fixture now explicitly uses an email input and same-origin POST form,
as required by both production login clients. Seven DOM regressions exercise
those real clients, including rejection of default-GET and cross-origin forms.
Eight Rust ledger/storage helper tests passed as well. These tests do not change
the production credential-release rules to accommodate an unsafe fixture.

`manualStatus` remains `not-run`; production readiness, full CEF acceptance and
public-provider acceptance remain false. This run does not exercise retained
cookie import across app restarts, service workers/Cache Storage, or real user
databases. The coverage limits above still apply.

## Hidden startup zoom regression — 2026-10-08

The fixture now applies 100% zoom before first navigation, matching the app's
startup ordering. Native attachment intentionally hides the view until the app
presents it; zoom previously required an already-visible `Attached` view.

- Before the fix, `.artifacts/cef-hidden-zoom-before-run-20261008/acceptance.json`
  failed at `staged: Browser lifecycle transition is unavailable`, before the
  first website navigation. This reproduced the app's generic create failure.
- After allowing owner-checked zoom in `Attached` and `Hidden` (without changing
  visibility), `.artifacts/cef-hidden-zoom-after-run-20261008/acceptance.json`
  passed with `exitCode: 0`, `nativeTlsFixtureAccepted: true`, all eight automated
  TLS cases and all thirteen storage steps. Sandbox observations and native
  shutdown passed; logged native FATAL and network-service restart counts were zero.

These are Windows x86_64 disposable local-fixture results using the same pinned
patched engine as above. Manual input remains `not-run`; this does not establish
public-provider acceptance, production database retention or Linux/macOS runtime
verification. The fix is in shared native-host code and needs no CEF rebuild.

## Script-free document automation regression

The `staged` case now first navigates to `/script-free`, served from
`src/script_free.html` through the same admitted TLS sockets and loopback-only
proxy. The HTML contains no scripts, event handlers, external resources or
JavaScript URLs. The existing hidden startup zoom still runs before navigation.

`src/static_document.rs` waits for that exact HTTPS URL to finish loading, then
calls the production `CefBrowserHost::automation(Document {})` with both script
and macro permissions disabled. Only an actual native completion containing a
nonempty document receipt for the fixture origin advances the test. It never
uses eval, DevTools, a page pulse or a preliminary script to obtain that receipt.

The receipt then authorizes a native Click step on a disclosure summary with
`role="button"`. Its default HTML behavior opens a `<details>` element without
page JavaScript. An empty-string native Fill step must then clear a text input
whose initial value is `clear-me`. A subsequent native Script request asserts
that the disclosure opened and the input was cleared,
the exact URL is still current, the document is a secure top-level context,
`document.scripts` is empty, and the Tauri bridge is absent. All mutation
completions must match their request IDs. Only then does the existing staged
Identifier/Password login run; its TLS, cookie, pulse and cleanup gates remain
mandatory. This exercises native automation directly, not production app IPC.

The native 15-second request timeout remains unchanged. The fixture adds a
17-second missing-callback bound, a 25-second static-probe bound, and a 40-second
overall staged-case bound. Failure enters the existing revoke/close/drain path,
adds to the top-level `failures`, and makes the executable and existing runner
fail. Evidence is recorded at `cases[name=staged].staticDocument` in
`native-progress.json` and `native-report.json`, without receipt tokens. The
runner's case inventory is unchanged; no runner files need modification.

This is a regression for the observed native document-automation gap. It does
not assume that absent V8 initialization is the cause, or that executing inert
`void 0` in `on_load_end` fixes it. A pre-fix run may report `TimedOut` or another
native receipt failure; both must fail before any fixture click/script request.

Build only the fixture against the existing SDK; no CEF engine rebuild is needed.
Allocate the shared Cargo slot before using the commands below. A separate
absolute target directory can be used while that slot is occupied.

```powershell
$env:CEF_PATH = 'F:/Projects/sortOfRemoteNG/.artifacts/browser-app/x86_64-pc-windows-msvc-W0XID5/sdk'
$env:CARGO_TARGET_DIR = 'F:/Projects/sortOfRemoteNG/.cache/cef-target'
node scripts/native-build-env.mjs cargo build --manifest-path src-tauri/crates/sorng-browser-host/tests/native_tls_acceptance/Cargo.toml --lib --offline --locked --jobs 2

# Use the inspected custom runtime plan and fresh bundle/run directories.
node scripts/cef-browser-acceptance.mjs stage --suite tls --custom-plan F:/cef-builds/sorng-20261007/package-windows-x64-recovery-04/acceptance-plan.json --client .cache/cef-target/debug/sorng_cef_tls_acceptance.dll --output .artifacts/cef-static-document-after-20261008 --target x86_64-pc-windows-msvc
node scripts/cef-browser-acceptance.mjs run-tls --executable .artifacts/cef-static-document-after-20261008/sorng_cef_tls_acceptance.exe --output .artifacts/cef-static-document-after-run-20261008 --manual false --timeoutMs 360000
```

Use a new output suffix when repeating the run. Inspect the `staged` case's
`staticDocument` fields as well as the existing overall acceptance report;
historical bundles built before this regression contain no such probe.

Native failing baseline on Windows x86_64, 2026-10-08:
`.artifacts/cef-static-document-before-run-20261008/run-Db180C/native-report.json`
records one completed script-free page load, `documentReceived: false`, and
`script-free native automation failed: TimedOut`. Neither click nor script ran.
The DLL was built before the empty-CEF-string wire fix and before adding the
clear-Fill step. The executable exited 1 without an outer-runner timeout;
revocation, acknowledged closure, task drain and native shutdown completed.
The network-log and Windows renderer-sandbox gates passed, with zero logged
native FATAL or network-service crash/restart markers. The normal login/storage
acceptance failures are expected because the required static probe failed first.

Native passing run on the same platform and date:
`.artifacts/cef-static-document-after-run-20261008/acceptance.json` passed with
`exitCode: 0`, `nativeTlsFixtureAccepted: true`, and `storageIsolationObserved:
true`. `run-5eivY4/native-report.json` records one static page load, all four
automation completions (`documentReceived`, `clickCompleted`,
`clearFillCompleted`, `scriptCompleted`), all eight automated TLS cases and all
thirteen storage steps. Shutdown, proxy-netlog and renderer-sandbox checks passed;
logged native FATAL and network-service crash/restart counts were zero.

This build includes the shared empty-CEF-string decoder fix and has no
`NativeLoad::on_load_end` initialization hook. The fixture therefore demonstrates
that this static document's automation succeeds without that proposed hook.
It does not establish production app IPC or public-site acceptance. The fixture
DLL build, Rust formatting check, and 45 existing runner/page tests passed; the
click/clear assertions were also checked against the actual renderer automation
factory in a DOM harness, including rejection before either required effect.
