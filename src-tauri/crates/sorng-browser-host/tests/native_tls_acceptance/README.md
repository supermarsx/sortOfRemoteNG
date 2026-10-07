# Standalone patched CEF TLS fixture

This independent executable uses the production host crate and sandbox bootstrap;
it does not launch the production app. It requires loaded ABI V2 and the frozen
`sorng-tls-v2-682c378-1` build. Stock SDKs can compile the client but cannot pass
its loaded-engine check. No certificate-ignore/security-disable/UA switches are
added. The disposable CA is passed to the private native context only.

The fixture runs manual login, native Identifier/Password login, deny, dropped
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
`--manual true` for unattended diagnostics; the absent manual case fails the gate.

On Linux/macOS, build the same crate's binary and use the existing platform
packager for its helper/resources (X11/XWayland and signed Mac helper/framework
bundles respectively). Run the same `run-tls --executable ...` command on that OS.
The Windows SDK copier intentionally does not fabricate Unix packages.

Evidence: `native-report.json`, intermediate `native-progress.json`, native
netlog, process outcome, Windows renderer-token observations, and aggregate
`acceptance.json`. Reports are tied to the fresh runner invocation. The validator
is not an attestation mechanism for untrusted executables or forged reports.
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

Windows x86_64 validation on 2026-10-07, with the stock SDK at the `CEF_PATH`
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
acceptance. Patched-engine execution remains pending; AIA/OCSP/CRL fetches and
HTTP keep-alive runtime coverage remain unimplemented. No Linux/macOS build or
runtime result is claimed. Further Cargo jobs and native runs remain scheduled
by main.
