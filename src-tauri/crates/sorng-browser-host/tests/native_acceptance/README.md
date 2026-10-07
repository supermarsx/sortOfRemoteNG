# Independent CEF acceptance client

Opt-in actual-browser executable; never an ordinary unit test or a production
readiness grant. Uses the production host, request context, sandbox bootstrap,
renderer hooks and route proxy. Source/DOM test doubles cannot satisfy this gate.

Windows build (PowerShell, pinned SDK already staged by the packaging lane):

```powershell
$env:CEF_PATH = 'F:\Projects\sortOfRemoteNG\.artifacts\cef-app-client-windows-x64-20261006\sdk\runtime'
node scripts/native-build-env.mjs cargo build --manifest-path src-tauri/crates/sorng-browser-host/tests/native_acceptance/Cargo.toml --lib --target-dir F:/Projects/sortOfRemoteNG/src-tauri/target --offline --locked
node scripts/cef-browser-acceptance.mjs stage --runtime $env:CEF_PATH --client src-tauri/target/debug/sorng_cef_acceptance.dll --output .artifacts/cef-acceptance-bundle-01 --target x86_64-pc-windows-msvc
node scripts/cef-browser-acceptance.mjs run --executable .artifacts/cef-acceptance-bundle-01/sorng_cef_acceptance.exe --output .artifacts/cef-acceptance-run-01
```

Both stage and run require new output directories and retain evidence. Staging
reuses packaging-lane binary/SDK inspection but does not establish archive-to-tree
provenance, signing or release acceptance. Use Dirac's archive-backed staging for
those independent claims. Windows runs the pinned bootstrap, not a fabricated
sandbox pointer or the normal Rust test harness.

Fixture key/certificate and profile are disposable. The private key stays in
memory. A test-only native App wrapper forwards production handlers and adds
the newly generated certificate SPKI pin and a local netlog output. After the
first run exposed global-profile public egress, it also installs a rejecting
loopback proxy on the global request context and maps non-loopback DNS to NOTFOUND. These extra
guards are explicitly labelled test scaffolding, not production containment.
Run 02 established that a command-line proxy prevents private-context proxy
writes (`Failed(ProxyRejected)`), so the fixture now installs and reads back the
global context preference during `OnContextInitialized` instead. The private
context is created only after that test guard succeeds. Production startup
containment still needs independent evidence without these extra guards. No system
certificate store, host mapping, firewall or sandbox privilege is changed.

The route dialer accepts only `fixture.test:443`, `frame.test:443` and
`accounts.google.com:443`, mapping them to the numeric loopback fixture listener.
It performs no DNS and has no network fallback. `accounts.google.com` is a local
synthetic staged form, **not** a public-provider login test. Credentials are fixed
synthetic literals; no application vault/database/profile is opened.

Evidence distinguishes real HTTPS/secure origin, HttpOnly and cross-context
cookies, cross-origin iframe access, native synthetic form filling, native
per-stage Google grants, request revocation and `OnBeforeClose`. DOM background
and prefers-dark observations are separate from actual native pixels. Native
first paint remains `not-run` until a pixel/frame capture is collected. Netlog
checks do not replace OS DNS/socket tripwires or renderer sandbox token evidence.
Missing observations always fail acceptance; the tool never unlocks runtime Ready.

## Portable gate and remaining platform measurements

The same `run --executable ... --output NEW_DIR` and report validator work on
Windows, Linux and macOS. The Rust binary invokes the existing Unix bootstrap on
Unix. Linux requires a packaging-lane X11/XWayland bundle and sandbox setup;
macOS requires the correctly signed application/framework/helper bundles. The
tool does not install packages, change setuid/user namespaces, sign binaries or
create signing identities. These platforms must run on their native runners;
Windows results do not count for Linux/macOS or either ARM64 target.

The Windows-only SDK copier intentionally rejects other targets rather than
inventing an unsupported package layout. Package the Unix executable/helper using
the existing platform packaging gate. Anonymous public provider acceptance is
separate and has not run here; CAPTCHA requires manual handling, never bypass.

## Bounded diagnosis and run-07 evidence

`native-trace.jsonl` is an append-only crash checkpoint: each bounded, redacted
entry is written and synchronized before returning to native code. A crash may
leave an incomplete final line; only complete lines are evidence. It is created
exclusively in the fresh run directory and never grants acceptance. Native hook
notifications and entry/return phases around context creation, browser creation,
and navigation help narrow failures before the first periodic snapshot.
`native-progress.json` is a once-per-second and after-each-attempt snapshot;
`native-report.json` remains the terminal report. The timeline retains at most
256 fixed-label entries plus a dropped count. It records context preparation,
native renderer/lifecycle notifications, synthetic grant stages, route-dial
results and fixture connection outcomes, never credentials or full page URLs.
The attempt table exposes only fixture names and numeric loopback proxy endpoints.
TLS counters distinguish accept, handshake completion and handshake failure.

Windows-only crash diagnosis is separately opt-in: set
`SORNG_CEF_ACCEPTANCE_EXCEPTION_TRACE=1` for the runner command. This installs a
process-local vectored exception observer after validating the fresh output
directory and before CEF initialization. `native-exceptions.txt` is exclusively
created and pre-opened. At most eight severe exceptions record the fixed code,
instruction address, known module label/base/relative offset, and up to 24
handler-stack addresses. It never records exception parameters, registers,
memory contents, URLs, credentials, or module paths; no symbol server is used.
The handler always returns `EXCEPTION_CONTINUE_SEARCH`, does not change context,
and neither overrides crash behavior nor enables global dumps. Stack capture and
disk writes are best effort and can perturb timing; the instruction record is
flushed before stack capture. Stack overflow, language exceptions, and debugger
breaks are excluded. The browser-process-only observer cannot attest child faults
or guarantee capture of fail-fast exceptions. Its file/registration deliberately
live until process exit to avoid callback teardown races. No acceptance or
production-readiness claim follows from this evidence.
The `native-command-line` trace reads the actual CEF global command-line object's
`disable-chrome-login-prompt` switch after initialization (not just source text
or the OS launch arguments). A missing switch is an explicit fixture failure;
auth-hook entry/return remains separate evidence that must actually occur.

For subsequent runs, `native-network-policy` calls production's
`network_policy_configured()` before each private context and before shutdown.
It also reads both actual preference stores, emitting only fixed comparison
booleans. The terminal `networkPolicy` stores the latest readback; the gate
requires both stores and the production check to pass, independently of traffic
containment. The legacy fixture proxy is installed first, then replaced by the
production global policy; metadata identifies that ordering explicitly.
The isolation attempt also exercises native zoom/reset/find/stop-find before
revocation and checks rejection afterward. `native-controls` reports dispatch
and admission only: there is no native zoom readback/find-result hook, so visual
effects and app IPC integration are not claimed.

### Run 17: local login passes; overall gate remains false

Latest measured artifacts: `.artifacts/cef-acceptance-run-17/run-OMJsDI/` and
`.artifacts/cef-acceptance-run-17/acceptance.json`. Host source snapshot:
`.artifacts/cef-acceptance-source-17/src/`; the five relevant host files matched
that snapshot after the run. Build/staging succeeded; the actual sandboxed CEF
fixture exited 0, with no native failures, no deadline termination, and no severe
exception records. The aggregate runner exited 1 for the remaining gates below.

- Generic `Form` and Google-shaped `Identifier`/`Password` grants reached
  `NativeSent`, `RendererReceived`, `RendererExecuting`, and `RendererAccepted`.
  Real local form proofs validated the synthetic values and completion.
- Real HTTPS-origin, native-cookie, iframe isolation, private-context isolation,
  and absent privileged-page-bridge checks passed. Nine HTTP requests reached the
  local TLS server; no upstream proxy-authorization header was observed.
- Production policy readback was true before private contexts and before
  shutdown, with all fixed checks true in both system and global stores.
- Zoom/reset/find/stop-find dispatch succeeded in isolation; zoom/find/stop-find
  were rejected after revocation. Visual effects and app IPC remain unmeasured.
- All three attempts closed with zero post-revocation requests. Restricted
  renderer-token observation passed for seven renderers; this is not a general
  sandbox security attestation.
- Remaining aggregate failures: unmeasured native first paint, unverified
  DNS/socket containment, and unexpected socket observations. The complete
  netlog has zero unexpected DNS entries and three `UDP_CONNECT` attempts to
  `[2001:4860:4860::8888]:443`, each ending -109. This is not proof of transmitted
  packets; classification remains unresolved and the tripwire was not relaxed.
- DOM background was white and `prefersDark` true; neither measures Chromium
  auto-dark pixels. `nativePixelsCaptured=false`, `firstPaint=not-run`.

No public provider was tested; Google-shaped content was served only through
the local synthetic route. Production readiness remains false. Tooling tests
passed 12/12 after the run. No lane-owned processes remained at handoff.

### Run 14: terminal local evidence, not acceptance

Artifacts: `.artifacts/cef-acceptance-run-14/run-Ms6ciJ/`; aggregate result:
`.artifacts/cef-acceptance-run-14/acceptance.json`. Run 13 was not launched: the
baseline build overlapped the host close fix. Run 14 includes the completed
deferred-close fix and native Chrome-login-prompt switch, with exception
observation explicitly enabled.

- CEF global switch readback was true; all three attempts emitted proxy
  `AuthChallenge` and `AuthCompleted { handled: true }`.
- The local TLS server observed 26 HTTP requests; private-context isolation
  returned its proof. This does not prove full native cookie/login acceptance.
- Each attempt emitted one `Closed` event and reported zero post-revocation
  requests. The parent was reused across all three attempts; native shutdown
  returned and produced a terminal report. The observer recorded no severe
  exception; process exit was ordinary failure code 1, not `0xC000041D`.
- Generic and Google-shaped completion timed out. Grants reached only `Form`
  and `Identifier`; successful native filling/submission is not established.
- The complete netlog still recorded 20 public UDP connection attempts, so the
  egress tripwire failed. First-paint pixels remain unmeasured. Public-provider
  acceptance has not run and production readiness remains false.
- This run exercised orderly timeout/revocation close, not a separately forced
  `OnLoadError`/failed-navigation regression.

Repeat with a new output directory (never reuse a profile):

```powershell
$env:SORNG_CEF_ACCEPTANCE_EXCEPTION_TRACE='1'
node scripts/cef-browser-acceptance.mjs run --executable .artifacts/cef-acceptance-bundle-14/sorng_cef_acceptance.exe --output .artifacts/cef-acceptance-run-NEW
```

Re-analyze a completed or truncated log without launching anything:

```powershell
node scripts/cef-browser-acceptance.mjs trace --netlog .artifacts/cef-acceptance-run-07/run-96yT3X/netlog.json --output .artifacts/cef-acceptance-run-07/run-96yT3X/redacted-connect-trace-new.json
```

The output path must be new. CONNECT correlation retains at most 128 sockets and
16 observations per socket. Only known fixture authorities, loopback endpoints,
numeric HTTP/native errors and authentication-presence booleans survive; raw
headers, realms, tokens, usernames, passwords and full URLs are not retained.
The tripwire includes TCP, UDP and generic socket-connect attempts. A failed
non-loopback attempt is still a failure, never discarded because no bytes flowed.

Run 07 established private proxy write/readback, inert renderer bootstrap and
acknowledged closure, but **not** page/login acceptance. It had 14 HTTP 407
challenges followed by Basic-handler initialization and CONNECT cancellation
(`-3`), no successful tunnels, no route dials and no fixture TLS accepts. A
separate six CONNECTs reached the test global rejecting proxy and got 403.
Corresponding fixture stream-controller records include `is_preconnect: true`;
these speculative CONNECT failures do not by themselves establish the main
navigation's cause. Run 08's native hook confirms browse admission followed by
main-frame `LoadError -3`; resource/auth host observations must narrow it further.
Its netlog also contains failed non-loopback UDP attempts (`-109`); the earlier
TCP-only summary was insufficient. No production-containment claim follows.
