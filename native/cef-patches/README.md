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

## Targeted recovery checkpoint — 2026-10-07

The complete five-patch series compiled and linked on Windows x64. Its fresh
`package-windows-x64-recovery-04` package is registered in the ignored local
runtime selection for subsequent development builds; already running apps keep
their loaded engine. All five patches also passed pinned upstream digest and
clean apply checks in `.artifacts/cef-recovery-applycheck-20261007-02`.
The app's native-browser `cargo check`, full library compilation and Windows
`cargo rustc --lib --crate-type cdylib` link passed locally as well. The latter
produced `src-tauri/target/debug/app_lib.dll`; it was not launched against the
production profile. One existing localized MSVC informational linker-output
warning remains in the OPKSSH dependency, not a link failure.

The automated native TLS/storage run
`.artifacts/cef-recovery-tls-run-04c-20261007/acceptance.json` passed with exit 0:
eight TLS/login/cancellation cases, thirteen same-origin storage probes, native
close/shutdown, the loopback-proxy netlog gate and Windows renderer sandbox
observations. Its CEF log had zero FATALs and zero network-service crash/restart
markers. It exercised only synthetic accounts and a loopback TLS server, not
public Google or Cloudflare. Trusted manual input was explicitly not run.

The GPU overlay capability warning remains visible rather than being suppressed;
GPU/WebGL and sandbox checks are not disabled. The fixture also logs a
CacheStorage directory warning and a discardable-shared-memory shutdown warning;
successful shutdown is not evidence of warning-free or leak-free teardown.
Service workers/Cache Storage,
OS-level packet containment, first paint, real-app persistence across restart,
and Linux/macOS native execution remain separate acceptance work. The local
fixture pass is not a full production-readiness assertion.

Embedded native tabs remain in use. App-side recovery checks/falls back between
app-owned working directories before initialization, defers startup until an
authorized owner exists, and bounds speculative prewarm and startup diagnostics.
This does not isolate a fatal CEF browser-process crash from the app. Cookies
retained by app policy remain encrypted in the owning database; this working
directory is not a shared persistent website profile.

### Full-app first-website crash follow-up — 2026-10-07

A later full development-app crash when opening a website was symbolized with
its matching DLL/PDB: `__delayLoadHelper2 -> WSAStartup -> Tokio TcpListener::bind
-> PrivateForwardProxy::start`. Nearest-export labels in the crash log falsely
suggested AWS-LC/OPKSSH; the GPU overlay warning did not identify this cause.
MSVC 14.44/14.51 can mix lower/upper-case Winsock import libraries into orphaned
delay-call stubs. The broken app had 358 valid stubs and two orphaned startup/
cleanup stubs. SDK-first linking alone, or anchoring only those two imports,
did not repair the complete app. All thirty imports in the current Winsock
closure are now anchored to one SDK library by the shared final-client linker
policy. Winsock stays delayed; no sandbox or proxy bypass is introduced.

The fixed full Windows x64 `full-dev` DLL has 360 recognized valid stubs, zero
orphans, and no unmatched delayed slots. Its exit-early loopback proxy test
passed authentication-required and shutdown checks without opening profiles,
databases or CEF pages (`.artifacts/browser-network-fixed-4qw5Fs/network-probe.json`).
This required relinking the app, **not rebuilding Chromium**. It is not a live
website/login or cross-platform acceptance result.

Normal Windows app builds inspect the final PE before staging/publishing. The
guard follows INT/IAT entries and recognizes MSVC x64 delay stubs, including
orphans outside the advertised IAT. ARM64 gets structural import validation;
machine-code thunk ownership is explicitly not checked there. Unknown x64
thunk formats are reported as partial/not recognized, not complete proof.
If the dependency closure changes, repair the canonical imports and rerun the
full-DLL probe; never drop `/DELAYLOAD` or disable the sandbox to satisfy a gate.

Run `node scripts/browser-client-network-probe.mjs <trusted-Windows-bundle>`
for the loopback-only final-DLL smoke check. Older clients without this
exit-early mode are refused before launch. The Windows native CI entry check
also runs it; the separate CEF TLS/storage fixture remains necessary.

## Frozen contract for Main / Dirac

### Download destination follow-up — built locally, selection/acceptance scoped

`0006-cef-explicit-download-destination.patch` changes only
`libcef/browser/download_manager_delegate_impl.cc`. If an explicitly supplied
destination directory cannot be created, `GenerateFilename` now posts an empty
`RunDownloadTargetCallback` to CEF UI and returns, cancelling the download. It
does not clear the selected path and continue into the temp-directory fallback.
The upstream behavior for an unspecified/empty destination is unchanged. The
change replaces the assertion in this expected filesystem-failure branch; it
does not suppress DCHECKs globally or change sandbox/network policy. The patch
adds no path logging or path-bearing callbacks to the app shell. Source-test
diagnostics and app download events remain path-redacted; upstream filesystem
diagnostics are a separate surface (see the live observation below).

The app selects Alloy on Windows, Linux and macOS. Pinned Chromium's
`ChromeDownloadManagerDelegate::DetermineDownloadTarget` calls the CEF delegate
first. Its `handled` branch uses `CefBeforeDownloadCallbackImpl` for either
style; only **unhandled** downloads choose between Alloy cancellation and Chrome
defaults. Thus the explicit-path fallback affects the active Alloy adapter too.

On 2026-10-08 the six-patch Windows x64 engine was **built and packaged locally**
as `package-windows-x64-recovery-05`: 10 incremental steps at 16 jobs, followed by
archive extraction, SDK inventory, V2 export and compiled-output byte checks.
Its source-lock identity is
`2e70763972ceaf0ccecee507928396cf66ca3c69e536edfa0e198e94a637aedc`;
the packaging receipt is
`F:/cef-builds/sorng-20261007/package-windows-x64-recovery-05/packaging-result.json`.

This does **not change normal runtime selection**: the local selector still
points to five-patch recovery04, whose explicit-path fallback is still present.
The isolated r8 app bundle was explicitly staged with recovery05; this is not
a selection update or a production-readiness grant.

Dedicated live cancellation validation **passed locally on Windows x64** with
recovery05. Exact receipt:
`.artifacts/cef-download-destination-20261008/run-AyvOLw/receipt.json`
(run ID `6323eb0a-9102-4608-b023-a0cd64f496a5`, exit 0, 4.703 seconds).
The positive case completed and its 44-byte payload matched. After native
destination validation, the negative case replaced its newly created empty
parent directory with a fixture-owned file: CEF could no longer create that
directory and emitted a terminal `cancelled` event, never `completed`.
Both requests traversed the production app-private proxy and one private
request context. Two native save continuations, path-redacted app events,
browser close and CEF shutdown were observed. The isolated temp scan/watcher
found no `blocked.txt` or `.crdownload` fallback artifact; ordinary temporary
`.tmp` activity did occur, so this is not a zero-temporary-I/O claim.

Merely missing directories can normally be created; that is not a cancellation
case. This result covers an explicitly supplied directory that cannot be
created. The raw CEF log contains an upstream `CreateDirectory` warning with
the synthetic fixture path, plus existing GPU/CacheStorage/shutdown warnings:
do not describe all native logs as path-free or this run as warning-free.
Earlier failed fixture setup/startup attempts are retained beside the passing
receipt. No application, driver, frontend, engine PDB or selector was changed
by the live lane. Real app save-dialog acceptance and other platforms remain
unverified; no normal-selection or production-readiness grant follows.
Source/apply/package checks alone are not runtime security proof. Main owns
normal selection and app-level acceptance; this patch changes no existing TLS
ABI or runtime-selection marker.

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

- Native Aura widget teardown clears the platform delegate's borrowed pointer
  before destroying the widget (`0003-cef-native-widget-lifetime.patch`). This
  preserves dangling-pointer detection instead of disabling the safety checks.
  The ABI/bridge ID is unchanged; the additional patch changes the source-lock
  digest and therefore requires a newly inventoried runtime package.
- Pending asynchronous app TLS admission is a valid socket verification state,
  even after the native verifier request has finished. The debug invariant now
  accepts that state without admitting data before the app decision (`0001`).
- `SodaComponentUpdates` gates optional SODA speech-model provisioning before
  profile registration/download state changes (`0004`). The app disables that
  feature; microphone capture, WebRTC and other component updates are unaffected.
- `SkipIPv6ReachabilityProbe` skips Chromium's direct IPv6/NAT64 route probe for
  this app's numeric IPv4 loopback proxy (`0005`). Upstream IPv6 remains the
  backend's responsibility. The app merges this feature with forced-dark paint
  rather than replacing either feature list.
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

## Earlier source-only verification

- V2 exported patches pass `git apply --check --whitespace=error-all` separately
  for Chromium and CEF against freshly fetched pinned upstream bytes in
  `.artifacts/cef-tls-bridge-applycheck-02`; upstream SHA256 manifest checked.
- ABI C11 and C++17 freestanding syntax/layout passed for Windows x64, Linux
  x64/arm64 and macOS x64/arm64. This is HEADER-ONLY validation.
- Standalone C++17 policy test compiled with `-Wall -Wextra -Werror` and executed:
  **785606 checks passed**. It exercises the exact predicate called by both the
  browser bridge and network-service admission, not a substitute implementation.
- Scratch Chromium/CEF `git diff --check` passed. That earlier source-only pass
  did not include engine compilation or execution; see the recovery checkpoint
  above for the later Windows build and native run.

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

1. Windows x64 engine compilation/linking and the local native fixture now pass.
   Linux/macOS engine builds/runs and the 12 authored Chromium socket unit cases
   remain unverified; one platform's result does not establish the others.
2. Real custom-root chain validation, constrained roots and custom-only exclusion
   need executable verifier tests; the standalone test covers admission logic only.
3. The Windows fixture covers delayed admission, cancellation, stale replies,
   overlapping successor contexts and two simultaneously live isolated contexts.
   Multiple-partition readiness/revocation, service-restart recovery and full ABI
   callback lifetime coverage still need additional native tests.
4. Local CONNECT+TLS observations cover zero HTTP bytes before admission,
   fixture-policy host/port/leaf rejection, a private custom CA, and revoke/cancel.
   Production persistent trust authority, explicit self-signed consent, constrained
   CA roots and custom-only system-root exclusion remain separate gates.
   AIA/OCSP fetches, socket keep-alive reuse and transports outside the observed
   HTTP sessions need runtime coverage; netlog is not OS-level containment proof.
5. Main owns Rust FFI/runtime/authority wiring and admission gating. Existing app
   TrustPolicy must not be announced fully supported solely from this patch queue.
6. Verify stock CEF API hashes remain compatible and additive exports survive all
   platform linkers. The ABI header stays OUT of includes_common_capi, which pinned
   tools/cef_api_hash.py hashes; package the additional header separately.
