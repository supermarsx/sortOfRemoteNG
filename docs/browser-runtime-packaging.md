# CEF runtime packaging contract

`scripts/browser-runtime-package.mjs` provides offline inspection plus explicit
`download`, `extract`, `build-client` and `stage` commands for the optional `sorng-browser-host` engineering
feature. Inspection remains read-only. Staging verifies an archive, safely
extracts it, checks application/helper binary headers and writes a new bundle.
Only `download` acquires archive bytes; other commands never silently download.
It never signs, launches, installs or selects a browser. Package checks
cannot report browser `Ready` or prove a public website login. Forced dark mode
and automatic login remain host requirements, including authentication/challenge
pages; this tool does not change either feature.

The default manifest includes Windows, Linux and macOS together, for x86_64 and
ARM64. Linux uses X11/XWayland. The application macOS deployment floor is 14.0.
There is no implicit selection based on the machine running the script.

```sh
node scripts/browser-runtime-package.mjs manifest
node scripts/browser-runtime-package.mjs manifest --target aarch64-apple-darwin
node scripts/browser-runtime-package.mjs verify --target x86_64-pc-windows-msvc --runtime /path/to/cef_windows_x86_64 --archive /path/to/pinned_minimal.tar.bz2 --bundle /path/to/staged-app
node --test tests/tooling/browserRuntimePackage.node-test.mjs
```

`--runtime` points to the flattened **download-cef** installation: `Release/`
contents at its root, plus non-macOS `Resources/` contents, `archive.json`,
`include/cef_version.h` and `CREDITS.html`. It does not accept a raw extracted
minimal distribution or assume that `target/debug` contains this metadata.
`--bundle` points to the staged application directory, or the `.app` directory
itself on macOS. `--app-name` changes the executable/helper stem (default
`sortofremoteng`); names are validated as single path components.

JSON is written to stdout. Exit 0 means the specified packaging checks passed;
1 means incomplete or mismatched inputs; 2 means invalid invocation. Missing
archives/bundles remain failed checks, including when other checks succeed.
There is no automatic recovery download. The exported `inspectMatrix(reports)`
requires one passing packaging report for each of the six targets; it never
grants release readiness.

## Exact distribution pin

Both Cargo packages are `154.3.0+154.0.32`, constrained in the host manifest by
`=154.3.0`. The runtime is exactly
`154.0.32+g682c378+chromium-154.0.8037.58`, Chromium `154.0.8037.58`, with
Windows bootstrap compatibility hash `265fca9293e6b6ef`. The downloaded Linux
and macOS headers use an empty value for this Windows-only ABI macro; the
verifier requires that platform-specific value. It checks both Cargo packages,
optional dependency/sandbox/resource settings, distribution name, target,
upstream checksum, header versions and sandbox compatibility hash.

The six minimal archive names, byte lengths and SHA-1 checksums are pinned in
the script from the [CEF distribution index](https://cef-builds.spotifycdn.com/index.json),
inspected on 2026-10-06. No live index is consulted by the offline verifier.
All six complete archives were downloaded from their exact HTTPS URLs (the
Windows x64 archive was already cached), checked against the official index's
size and SHA-1, and read again independently to verify these measured SHA-256 pins:

```text
windows64   aa1f7ab28005307edcc13f95e3ce5cd9d221894b00458fb5e368c00603204a2a
windowsarm64 805825d3ad7304e945205b818811806eb34b5226b91fa6c483cb6212eef44812
linux64     9b6a82e04506d5e1af560e031e718c89af5f96760413fd16380358784545d153
linuxarm64  65829646cad7223c68bbcc659257e41ec282741adf2570d000722d201c3ccf1e
macosx64    e7e17e6c899ffe6c4cb16065d6dcaf16f9735d9cd0861099558f578d40714552
macosarm64  0adf18dc3c4dadf0fecdb3ce2b9d558989fa264743cdcd46e89b1b3b118dd85f
```

The five newly acquired archives and per-file `.provenance.json` receipts remain
under `.artifacts/cef-archives-20261006/`. The downloader rechecks the exact index
record, refuses redirects, verifies complete bytes before promotion from `.part`,
and never overwrites a different existing archive. Interrupted inputs remain for
diagnosis. Upstream SHA-1 checksums are integrity checks, not
signature or publisher-authenticity proof. A locally measured SHA-256 adds an
exact byte pin; it does not independently authenticate the publisher.

Archive verification reads the complete local archive and rejects size/digest
mismatches. `verify` cannot prove that an arbitrary existing runtime came from
that archive. `stage` always creates a fresh extraction using Python 3.12+'s
tar data filter, rejects traversal, external links and special files, preserves
internal framework links, and retains the original distribution and license.
It verifies the archive before and after extraction. Extraction/staging never
reuse an existing destination and leave failed outputs intact for diagnosis.
No mutable Cargo runtime tree is used as staging provenance.

## Build and stage

First acquire the exact archive listed by `manifest`:

```sh
node scripts/browser-runtime-package.mjs download --target x86_64-pc-windows-msvc --output NEW_ARCHIVE_PATH
```

All six names/sizes/SHA-1 values were rechecked against the official index on
2026-10-06. The build/staging commands below make no downloads themselves.
`extract` requires Python 3.12+; use `--python` to select an installed interpreter.

```sh
node scripts/browser-runtime-package.mjs extract --target x86_64-pc-windows-msvc --archive PINNED_ARCHIVE --output NEW_SDK_DIRECTORY
```

Set `CEF_PATH` **for the build child** to the returned `runtime` directory.
Build from the repository root using the target's native runner/toolchain:

```sh
# Windows: the app library must export RunWinMain (see the entry handoff below).
node scripts/native-build-env.mjs cargo rustc --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --release --features native-browser --lib --crate-type cdylib

# Linux/macOS: substitute the matching target from manifest.
cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-unknown-linux-gnu --release --features native-browser --bin app
cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-unknown-linux-gnu --release -p sorng-browser-host --features cef-host --bin sorng-cef-helper
```

The equivalent Windows build wrapper extracts and checks the pinned SDK,
sets `CEF_PATH` only in the build child, invokes locked/offline Cargo with an
explicit `cdylib` output, and verifies the resulting DLL architecture/export:

```sh
node scripts/browser-runtime-package.mjs build-client --target x86_64-pc-windows-msvc --archive PINNED_ARCHIVE --output NEW_BUILD_DIRECTORY --profile debug
```

It requires a Windows MSVC runner. Default Cargo outputs are isolated under the
new directory; `--cargo-target-dir` explicitly selects an existing build cache.
The command returns a copied `app_lib.dll` for `stage --application`. It performs
no application launch and cannot enable acceptance. `--offline` constrains Cargo;
the exact SDK preflight prevents cef-dll-sys from treating a missing/older SDK as
permission to download another distribution. The full Windows x64 application
DLL was built successfully with this command; see the evidence section below.

For Linux, both executable link commands need `-C link-arg=-Wl,-rpath,$ORIGIN`
(quote the literal dollar in the invoking shell). The launcher sets its child's
`GDK_BACKEND=x11`; it does not guess DISPLAY or change the global environment.
For macOS, set the build child's `MACOSX_DEPLOYMENT_TARGET=14.0`. Both app and
helper Mach-O files must declare 14.0. Do not link the helper directly to the CEF
framework: cef-rs loads it after `MacHelperBootstrap` installs the sandbox.

```sh
# Windows: app_lib.dll is renamed to match the pinned bootstrap EXE.
node scripts/browser-runtime-package.mjs stage --target x86_64-pc-windows-msvc --archive PINNED_ARCHIVE --application src-tauri/target/x86_64-pc-windows-msvc/release/app_lib.dll --output NEW_BUNDLE

# Linux: generates sortofremoteng launcher plus .bin and .helper.
node scripts/browser-runtime-package.mjs stage --target x86_64-unknown-linux-gnu --archive PINNED_ARCHIVE --application APP_BINARY --helper HELPER_BINARY --output NEW_BUNDLE

# macOS: validates the app plist and emits all five helper bundles/plists.
node scripts/browser-runtime-package.mjs stage --target aarch64-apple-darwin --archive PINNED_ARCHIVE --application APP_BINARY --helper HELPER_BINARY --app-plist APP_INFO_PLIST --output NEW_APP.app
```

Use `--app-name` when CFBundleExecutable/application names differ from the
default `sortofremoteng`. Helper identifiers derive from the supplied app plist.
The complete framework is retained. Signing, entitlements, notarization and
native sandbox acceptance must follow staging; no signing identity is invented.
Linux staging never sets root ownership or setuid bits: the namespace sandbox
must work under the target distribution's policy, or packaging/launch must fail.

The Node binary-header tests are synthetic and establish parser behavior only.
`stage` checks PE architecture/DLL/RunWinMain export, ELF architecture and macOS
Mach-O architecture/deployment floor. It does not attest complete linkage,
signatures, executable safety or runtime containment.

## Main entry handoff

The production export now lives in `src-tauri/src/origin_browser_entry.rs`.
Main has wired `#[cfg(feature = "native-browser")] mod origin_browser_entry;`
in the application library. The public-to-app handoff is
`dispatch_app_entry() -> Result<ProcessDispatch, &'static str>` before services,
then `install(ScheduleWake)` in setup. Internal platform preparation uses
`prepare_windows(...)` and `prepare_unix()`. Preparation precedes app profiles,
logging and services; return subprocess exit codes immediately. Call `install`
from main-thread Tauri setup after Tao creates its application. It invokes
the native registry's `install(runtime)` and keeps the platform provider alive
until successful registry shutdown drops it. Main's operational policy now
transitions pending to ready after native policy readback, with terminal
revocation. This replaces the earlier permanent `install(runtime, false)` gate;
operational admission is separate from cross-platform release attestation.
Main owns pump scheduling,
timers and closing/draining before the event loop exits. The macOS framework
stays loaded until process exit in this app adapter.

For integrations with a scoped runtime instead of the app's static registry,
the host also supplies the following lower-level entry-closure API:

```rust,ignore
// Before Tauri, logging, profiles or services:
#[cfg(windows)]
#[no_mangle]
pub unsafe extern "C" fn RunWinMain(
    instance: cef::sys::HINSTANCE,
    _command_line: *mut u16,
    _show: i32,
    sandbox: *mut std::ffi::c_void,
    version: *const sorng_browser_host::platform::windows::BootstrapVersionInfo,
) -> i32 {
    unsafe {
        sorng_browser_host::bootstrap_platform::run_windows_entry(
            instance, sandbox, version, run_native_application,
        )
    }
}

// Unix main must exit immediately with this code.
let code = unsafe {
    sorng_browser_host::bootstrap_platform::run_unix_entry(run_native_application)
};
std::process::exit(code);

fn run_native_application(
    provider: &mut dyn sorng_browser_host::bootstrap_platform::RuntimeBootstrap,
    paths: &sorng_browser_host::bootstrap_platform::BundlePaths,
) -> i32 { /* app-owned UI loop; initialize, close/drain/drop, shutdown */ }
```

Each adapter creates `cef_runtime::subprocess_application()` only after native
API selection, dispatches child processes before the closure and preserves
their exit code. Windows retains bootstrap-owned sandbox data throughout the
closure. The caller must complete native shutdown and drop CEF values before
returning. macOS then unloads the framework on a successful shutdown; on failure
the process must exit with it still loaded so late string drops remain safe.

Main has registered the supplied helper in the host manifest:

```toml
[[bin]]
name = "sorng-cef-helper"
path = "native/helper.rs"
required-features = ["cef-host"]
```

The helper uses the same subprocess App as Windows dispatch, so reviewed
renderer callbacks remain shared. It never starts Tauri/services/profiles.

## Layout and sandbox requirements

The resource lists follow the installed pin's `cmake/cef_variables.cmake`,
`include/cef_sandbox_win.h`, and cef-rs `src/sandbox.rs`. macOS layout also follows
the [upstream redistribution contract](https://github.com/chromiumembedded/cef/blob/master/tools/distrib/mac/README.redistrib.txt).
The manifest requires complete resource packs and a default locale, and retains
all installed locales and the complete macOS framework during bundle verification.
It also retains Linux's conditional `libminigbm.so` when present.
Missing, empty, nonregular or
escaping linked files fail. Unix execute permissions are checked when running
on a Unix filesystem; a Windows fixture cannot establish Unix permissions.

| Platform | Required integration                                                                                                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | Rename the pinned `bootstrap.exe` to the application EXE stem and supply the matching client DLL. Include CEF DLLs/resources/locales, with `dxil.dll` and `dxcompiler.dll` on x64.                                                                   |
| Linux    | Put the executable and CEF libraries/resources/locales together, preserve `chrome-sandbox`, and establish either supported user-namespace sandboxing or a correctly installed root-owned mode-4755 helper. Select X11 before toolkit initialization. |
| macOS    | Place the framework under `Contents/Frameworks`, retaining `Libraries/libcef_sandbox.dylib`, architecture-specific V8 snapshot and `.lproj` locales. Include base, Alerts, GPU, Plugin and Renderer Helper app bundles with executables and plists.  |

CEF 154 uses the post-M138 sandbox design. On Windows, the bootstrap supplies
the sandbox pointer to the client DLL's `RunWinMain` or `RunConsoleMain`, which
must pass it through process execution and initialization. Browser and child
processes use that bootstrap executable. A separate `browser_subprocess_path`
is incompatible with this Windows sandbox design. On macOS, initialize the
sandbox in the helper **before** loading the CEF framework.
See [CEF sandbox setup](https://chromiumembedded.github.io/cef/sandbox_setup.html).
File presence cannot establish that either startup sequence ran correctly.

Bundle checks compare copied runtime bytes to the supplied runtime source with
SHA-256. They run **before signing or customizing bootstrap resources**; those
operations can legitimately change binary bytes and need separate provenance
and signature checks. The source CEF `CREDITS.html` is staged as
`cef-CREDITS.html` (under `Contents/Resources` on macOS). Release packaging also
needs applicable license notices from the original distribution; download-cef's
flattening discards some top-level distribution files.

## Signing and release evidence

Every report retains `releaseReady: false`. The `ok` field covers only its
artifact/layout/Cargo-alignment/copy checks. `stage` additionally records native
header checks and fresh archive extraction. Neither command validates imports,
sandbox execution or signing. Windows-built synthetic fixtures cannot establish
Unix file modes or native Linux/macOS execution.

Windows release validation must authenticate the final EXE/DLL set and its
expected publisher, including bootstrap and client module compatibility. macOS
release validation must check nested helper/framework signatures, intended
entitlements, hardened runtime and deployment targets, then the final app's
notarization result and stapled ticket. A signature's presence is not proof of
notarization. Linux needs native loader/dependency and sandbox checks; checksum
verification is not a substitute for them. None of these native release checks
ran as part of the synthetic Node fixture suite.

All six artifacts must pass their corresponding native sandbox, no-bypass,
owner-revocation and app-integration fixtures before coordinated release.
Provider acceptance remains a separately observed human-driven result. The
packaging fixture tests use synthetic files and exercise validation logic only.

## Remaining integration and release boundaries

- `cef-dll-sys` 154.3.0's `build.rs` may download when a configured `CEF_PATH`
  is missing or invalid. `download-cef` 3.0.0's `check_archive_json` accepts an
  archive version less than or equal to the expected version and trusts metadata
  for existing installations. It is not this application's exact-pin gate.
  Preflight verified build inputs and constrain build-network access in release
  automation. Keep runtime installer activation disabled: the optional
  [CEF installer](https://chromiumembedded.github.io/cef/installer.html) can make
  its own downloads outside the session's application-private proxy.
- Only the paired bootstrap/client package is a supported Windows entry.
  `cargo run`'s ordinary executable cannot provide bootstrap sandbox data.
  An installed Rust `sandbox` feature alone is not launch evidence.
- `cef_context.rs` prepares a private in-memory context, installs/readbacks the
  fixed authenticated proxy, and leaves the session `NotReady`.
  `cef_requests.rs` retains worker admission and denies wrong/stale proxy auth;
  these hooks are useful but do not constitute a full native CEF client.
- Parallel work added `cef_runtime.rs` and `cef_browser.rs` during this audit.
  The runtime supplies QUIC/WebRTC restriction switches; the browser now supplies
  popup, download and permission denial handlers. These code paths still need
  native tripwire proof of DNS, QUIC, WebRTC, socket and WebSocket containment.
- **Windows app entry and package built; renderer acceptance separate:**
  `cef_runtime::native_settings()` now leaves `browser_subprocess_path` empty on
  Windows, matching the pinned sandbox's same-executable contract; helper paths
  remain platform-specific on non-Windows targets. The runtime now borrows
  `RuntimeBootstrap` for platform-owned sandbox initialization and shutdown.
  The actual bootstrap/client build and isolated exit-early app dispatch are
  recorded below. They do not establish a sandboxed renderer's restrictions.
- `OriginBrowserSession::report_host(Ready)` checks profile and endpoint binding;
  its caller must first establish the documented runtime containment conditions.
  `authorize_navigation` admits only its strict HTTP(S) origin grammar. Routing
  resource callbacks through it does not prove WSS support: native callback
  behavior and the socket path require explicit fixtures before readiness.
- Platform adapters describe borrowed parent handles; new runtime and lifecycle
  code does not by itself establish the macOS application protocol/event bridge,
  early Linux GTK/X11 selection or native child/network acceptance. Main owns
  app-shell integration; native Linux/macOS execution remains outstanding.

Application registrations, primary CI, Tauri resources, the shared plan and
frontend selection remain main-owned. This lane owns the native entry adapters,
helper source, host build script, package staging tools and their focused checks,
plus the separate opt-in `browser-native-packages.yml` workflow.
No request-path direct fallback, TLS interception, fake browser identity or
disabled browser security is introduced by packaging.

## Recorded Windows native evidence (2026-10-06)

`native/CMakeLists.txt` built `sorng_cef_bootstrap_check.dll` with MSVC
19.44.35225.0 against the pinned SDK. A fresh stage of the pinned Windows x64
archive passed 237 runtime checks and 235 staged runtime-copy comparisons.
The actual pinned bootstrap loaded this compiled DLL and returned its sentinel
73, proving the C ABI entry received the expected version and non-null sandbox
pointer. The executable/package is at `.artifacts/cef-bootstrap-entry-staged-02`.
The probe never calls CefInitialize, creates a profile, loads a page or starts
application services. It is **not** a renderer or sandbox-containment test.

The ABI sentinel does not establish localhost CEF renderer/proxy acceptance,
Linux X11 helper runtime, macOS helper/framework runtime, Windows ARM64 runtime,
signing, notarization or all-platform release acceptance. Failed first-stage
artifacts were retained; nothing was deleted.

The new app-entry source was independently type-checked on Windows using
`native/entry_typecheck.rs` against the built `sorng-browser-host` library.
That harness emits Rust metadata only; its registry stubs must never execute.
This is not a linked application build or a native browser launch.

After main wired dispatch/setup, the actual application check also passed:
`node scripts/native-build-env.mjs cargo check --manifest-path src-tauri/Cargo.toml -p app --lib --features native-browser --locked`
(no warnings). Focused recorded runs: 91 CEF host library tests; 53 combined
readiness/packaging Node tests with one Unix-permission test skipped on Windows;
seven extraction-safety tests. Formatting and scoped diff-whitespace checks
passed. These historical checks did not establish live acceptance; at that
snapshot startup still used `install(runtime, false)`. Main has since replaced
that permanent gate with the native operational admission lifecycle above.

### Actual Windows app client and isolated entry

The full default-feature app client (not the C++ sentinel) linked successfully
with `native-browser` and `--lib --crate-type cdylib` in 5m26s:

```text
.artifacts/cef-app-client-windows-x64-20261006/app_lib.dll
SHA256 ec6b4983b87af98395c8987fcbb62427e4410499f7a24debd3b86ed27a7b146b
.artifacts/cef-app-package-windows-x64-20261006/sortofremoteng.exe
```

That production-identity package was **not launched**. A second build with the
child-only `TAURI_CONFIG={"identifier":"com.sortofremote.ng.cef-packaging-probe"}`
linked in 2m13s, and its paired package passed the same fresh-extraction checks:

```text
.artifacts/cef-app-client-isolated-windows-x64-20261006/app_lib.dll
SHA256 03d87e564e8f23cdd8b17876add94d624b03a1a7044e27a8180ba8697682002e
.artifacts/cef-app-package-isolated-windows-x64-20261006/sortofremoteng.exe
```

`probeWindowsAppEntry` in `scripts/browser-runtime-native-ci.mjs` scanned the
actual client DLL's unique isolated identity, verified runtime copies, and
launched the genuine bootstrap with `--sorng-profile-probe` and an explicit
workspace-local WebView2 argument. Exit 0, the native PID, reported isolated
profile paths and unchanged client digest all passed. Evidence is retained in
`.artifacts/cef-app-entry-probe-windows-x64-20261006/`. The exit-early probe creates
only its report: no profile directories, CEF initialization, renderer, app
services, credential access or production-profile launch. These hashes describe
the source snapshot at build time, not later concurrent changes.

## Executable native matrix (authored, not remotely run)

`.github/workflows/browser-native-packages.yml` is manually dispatchable or
reusable only; it has no push/PR trigger and was not pushed or triggered here.
All six native runners must finish successfully. Each acquires the exact archive,
builds the actual app shell plus helper and Carver's independent fixture, stages
both bundles, then runs the fixture through the platform's real entry. CI uses
`--no-default-features --features native-browser` for the app shell; it does not
claim a complete release-feature app build. The local Windows builds above used
the full defaults. The app is never normally launched by this workflow.

```sh
# Run on the matching native OS/CPU. Output must be new; artifacts are retained.
node scripts/browser-runtime-native-ci.mjs build x86_64-unknown-linux-gnu .artifacts/cef-native-ci
dbus-run-session -- xvfb-run -a node scripts/browser-runtime-native-ci.mjs run .artifacts/cef-native-ci/sorng-cef-acceptance-bundle/sorng-cef-acceptance .artifacts/cef-native-ci/acceptance

node scripts/browser-runtime-native-ci.mjs build aarch64-apple-darwin .artifacts/cef-native-ci
node scripts/browser-runtime-native-ci.mjs run .artifacts/cef-native-ci/sorng-cef-acceptance.app/Contents/MacOS/sorng-cef-acceptance .artifacts/cef-native-ci/acceptance

node scripts/browser-runtime-native-ci.mjs build x86_64-pc-windows-msvc .artifacts/cef-native-ci
node scripts/browser-runtime-native-ci.mjs run .artifacts/cef-native-ci/sorng-cef-acceptance-bundle/sorng-cef-acceptance.exe .artifacts/cef-native-ci/acceptance
```

The build recipe sets Linux `$ORIGIN` loader paths and X11 before toolkit startup;
macOS app/helper compilation and plists require 14.0. No framework-direct helper
link or sandbox bypass is introduced. macOS bundles here are engineering builds,
not Developer ID signed/notarized release artifacts. Runtime/signature failures
must be fixed and rerun on macOS, never hidden by disabling its protections.

The fixture runner's strict assessment rejects every `missingEvidence` item,
bad native exit, absent network log, missing origin/login/isolation observation
and failed lifecycle/revocation check. Its current report explicitly lists
renderer sandbox-token, native-first-paint and DNS/socket-tripwire gaps, so a
rendering-only success is still a failed acceptance gate. All report uploads
retain `productionReady: false`. External provider login is not tested.

Local environment inspection found Windows x64 available and WSL2 Ubuntu 24.04
with Rust 1.98.1/Python 3.12/X11, but no native Node/CMake, GTK/WebKit development
packages or NSS development package. No packages were installed or OS sandbox
policy changed. The existing WSL distro was started for read-only diagnostics.
No local macOS or native ARM64 runner is available. Authored matrix recipes are
not evidence that any unavailable target built, launched, or passed acceptance.

## Strictly local continuation

The native orchestrator now supports an explicitly local mode. It reads the
provided archive, verifies/extracts it, and compiles with locked/offline Cargo;
it does not contact the archive index, download CEF or run `cargo fetch`:

```sh
node scripts/browser-runtime-native-ci.mjs build-local TARGET LOCAL_ARCHIVE NEW_OUTPUT
```

Run this only on the matching native OS/CPU. It does not install dependencies.
The older `build` command intentionally performs acquisition and is **not** the
strict-local command. Neither command dispatches CI or changes admission.

### Observed local platforms (2026-10-06 follow-up)

- Windows x64 is the app/fixture native build platform.
- WSL2 Ubuntu 24.04 x64 has Rust 1.98.1, GCC, Python 3.12, X11/WSLg, and every
  dynamic library needed by the pinned Linux `libcef.so` (`ldd` found no missing
  dependencies). It lacks native Node/CMake and GTK/WebKit development packages.
- Existing Docker Rust/build images were inspected with `--pull=never`, no
  network, read-only filesystems and no added privileges. The inspected images
  do not supply the missing GTK/NSS development packages or CMake. No image was
  downloaded and no running user container was modified.
- No macOS runner or native ARM64 runner was found. The archives for those
  targets are real, downloaded and inspected; that is not native execution.

The actual Rust helper check was attempted in WSL with the pinned local SDK:

```sh
CEF_PATH=/mnt/f/Projects/sortOfRemoteNG/.artifacts/cef-sdk-x86_64-unknown-linux-gnu-20261006/runtime \
CARGO_TARGET_DIR=/mnt/f/Projects/sortOfRemoteNG/.artifacts/cef-linux-native-check-20261006 \
/home/mariana/.cargo/bin/cargo check --manifest-path /mnt/f/Projects/sortOfRemoteNG/src-tauri/Cargo.toml \
  --locked --offline -p sorng-browser-host --features cef-host --bin sorng-cef-helper
```

It failed during dependency resolution: the lock requires `flate2` 1.1.10 while
WSL's offline index/cache offers 1.1.9. No Rust target compilation is claimed.
The host also depends on Tauri through `sorng-protocols`, so the full helper/app
cannot avoid GTK development prerequisites merely by omitting app features.

Using only installed GCC/X11/runtime libraries, the real Linux entry ABI probe
`tests/tooling/native/cef_linux_entry.c` was compiled with `-Wall -Wextra -Werror`
and linked to the actual pinned `libcef.so`. The binary is retained at
`.artifacts/cef-linux-entry-local-20261006/cef_linux_entry`. Its actual WSL run
returned exit 0, connected to X11, selected API 15400, matched commit
`682c378d70d5780061e96644dca16ddd8fd157a9`, and received browser dispatch (-1) from
`cef_execute_process`. It never calls `cef_initialize`, creates a profile or
starts a renderer. It is not the Rust helper, browser acceptance or sandbox proof.

```sh
# From WSL, repository root. The absolute probe rpath is test-only, not shippable.
gcc -std=c11 -Wall -Wextra -Werror \
  -I "$PWD/.artifacts/cef-sdk-x86_64-unknown-linux-gnu-20261006/runtime" \
  tests/tooling/native/cef_linux_entry.c \
  -L "$PWD/.artifacts/cef-sdk-x86_64-unknown-linux-gnu-20261006/runtime" \
  -Wl,-rpath,"$PWD/.artifacts/cef-sdk-x86_64-unknown-linux-gnu-20261006/runtime" \
  -lcef -lX11 -o .artifacts/cef-linux-entry-local-20261006/cef_linux_entry
GDK_BACKEND=x11 .artifacts/cef-linux-entry-local-20261006/cef_linux_entry
```

All six actual SDK trees now pass header/resource inspection, including the
completed macOS ARM64 extraction at
`.artifacts/cef-sdk-aarch64-apple-darwin-complete-20261006/runtime`. Inspection
on Windows does not establish Unix file ownership/modes or macOS execution.

## Normal app build/dev driver

`scripts/browser-app-build.mjs` now implements the normal CEF-aware build and
development path. Main owns routing `tauri.mjs`, managed `tauri-dev.mjs`, native
feature families and release automation to this driver. The older proposal
below records the integration requirements, not the current implementation
status of those main-owned files.

```text
node scripts/browser-app-build.mjs build [existing Tauri arguments]
node scripts/browser-app-build.mjs dev [existing managed-dev arguments]
```

Both separated and equals forms of `--target`, `--features`, `--config` and
`--bundles` are supported. Cargo arguments follow `--`; development app arguments
follow Cargo's second `--`. Cargo-side feature flags are included in native
dependency selection. `--all-features` is rejected because the repository's
static/dynamic linkage choices are mutually exclusive. Help/version pass through
without CEF preparation. Explicit reduced features plus `--no-default-features`,
without a `full*` family or `native-browser`, retain ordinary Tauri behavior;
a missing SDK never selects that opt-out.

### Custom patched runtime in normal builds (2026-10-07)

Configured custom runtimes now use the same normal build/dev driver, native
Cargo runner, publication and installer paths on all six targets. The maintained
bridge identity remains `sorng-tls-v2-682c378-1`. This staging implementation does
not mean a patched engine has been built or that native trust acceptance passed.

Supply the engine lane's reviewed source lock, custom artifact manifest,
archive/build receipt directory and inventoried SDK:

```powershell
$env:SORNG_CEF_RUNTIME_KIND = 'custom'
$env:SORNG_CEF_SOURCE_LOCK = 'F:/cef-artifacts/source-lock.json'
$env:SORNG_CEF_CUSTOM_MANIFEST = 'F:/cef-artifacts/custom-runtime.json'
$env:SORNG_CEF_ARTIFACT_ROOT = 'F:/cef-artifacts'
$env:SORNG_CEF_SDK = 'F:/cef-artifacts/sdk'
node scripts/browser-app-build.mjs build
# Use the same inputs with the normal development launcher or driver dev verb.
```

These paths illustrate configuration, not existing built artifacts. Equivalent
driver flags are `--cef-runtime-kind custom`, `--cef-source-lock`,
`--cef-custom-manifest`, `--cef-artifact-root` and `--cef-sdk`. The artifact root
defaults to the manifest's directory. Manifest/lock inputs implicitly select
custom mode; an explicit conflicting `official` selection fails. The selected
target must exist in both documents. An optional `--cef-archive` must resolve to
the manifest's selected archive. Missing inputs, bad digests, incomplete SDKs,
`--cef-download`, and browser-disabled feature selections fail without stock
discovery, download or fallback. Source acquisition and engine compilation remain
separate, explicit operations.

Before Cargo, the driver verifies archive and receipt digests, the receipt's
source/build/SDK bindings, every SDK leaf, version and patch identity, the
selected API version/hash and the two **defined** native V2 exports. PE/ELF/Mach-O
inspection checks architecture and export tables without loading the library.
The selected library and sandbox bytes must match those used by the payload.
This checks export presence; it does not execute or attest bridge capabilities.

The SDK may be a distribution with `Release/` and `Resources/`, or an already
flattened SDK. It must include the manifest's `archive.json`, version/bridge/API
headers, CMake and `libcef_dll` sources, credits, license, complete runtime packs
and locales, and the Windows import library when applicable. A private SDK copy
is created beneath the run directory; normalization rejects colliding paths and
escaping links. Every copied leaf is checked against its declared digest/link.
The source SDK is retained and never rewritten.

The private copy gets a derived `archive.json` compatible with the pinned
`download-cef` metadata parser: its name explicitly contains `sorng-custom` and
its SHA-1 is calculated from the custom archive. The authoritative SHA-256
manifest and full private-copy inventory are retained in `plan.json`. This
adapter does not assert that custom bytes are an official CEF archive. Custom
Cargo children receive an unsupported `CEF_DOWNLOAD_URL` scheme so the bindings'
otherwise automatic downloader fails before networking if SDK selection fails;
inherited `FLATPAK`/`NIX_CEF_BINARY` substitution is removed. Version-directory
fallback inputs are rejected.

The archive, source SDK and private SDK are rechecked before Cargo and around
staging. Build/dev stage the verified custom bootstrap or framework, application,
Unix helper binaries, resources/locales and licenses. macOS gets all five helper
bundles; Windows installer preparation retains the custom bootstrap and produces
separate MSI/NSIS client DLLs before signing. Watch rebuilds retain separate
payloads. Native host OS and development architecture restrictions still apply.

The archive-to-SDK relationship remains
`reviewed-manifest-bound-not-extraction-tested`: this path consumes an existing
inventoried SDK and does not extract the archive. Reports retain
`productionReady: false`, `runtimeCapability: not-probed`, and
`nativeAcceptance: not-tested`. Actual engine construction, native compilation
against that engine, application launch, sandbox/trust containment, provider
acceptance and signed installation remain separate acceptance work.

Local fixture tests execute the real input loader, SDK preparation, app staging,
watch staging, bundle configuration and Windows installer client preparation for
x86_64 and ARM64 across Windows/Linux/macOS. They compare file bytes and reject
tampering, missing exports, wrong architecture and malformed helpers. Synthetic
PE/ELF/Mach-O fixtures are never loaded or executed. Cross-target fixture success
on Windows is not Linux/macOS runtime evidence; file-symlink cases require a
host with symlink permission.

### Local inputs, cache and outputs

The archive acquisition options below describe the official runtime
path; custom configuration uses the contract above and never acquires stock CEF.

- `--cef-archive PATH` / `SORNG_CEF_ARCHIVE`: the local pinned archive, verified
  against the six-target strong digest pins before any Cargo invocation.
- `--cef-sdk PATH` / `SORNG_CEF_SDK` (also `CEF_PATH`): an existing inspected SDK
  **runtime** directory for compilation. The pinned archive is still required
  for fresh, independently verified package staging; an SDK alone does not prove
  archive-to-extracted-tree provenance.
- With no explicit archive, discovery checks `.cache/cef/TARGET/ARCHIVE`,
  `.artifacts/cef-archives/ARCHIVE`, then existing
  `src-tauri/target/debug/build/cef-dll-sys-*/out/ARCHIVE`. It never selects latest.
  With no SDK, the selected archive is extracted into the driver workspace.
- Normal online builds acquire a **missing pinned** archive into the reusable
  `.cache/cef/TARGET/ARCHIVE` cache, using the existing official-index/version/
  digest gate. This is an authorized normal build step, never a latest-version
  lookup. Existing archives are verified and reused without contacting the
  index. `--cef-no-download` or `SORNG_CEF_ACQUIRE=0` disables acquisition;
  `--cef-download` remains an explicit opt-in. No download was needed for the
  local checks recorded here.
- `--cef-offline` also makes Cargo offline. It cannot be combined with download.
  The existing dynamic-native vcpkg stager is not offline-capable: use a prepared
  native environment or `--cef-static` with cached static dependencies.
- `--cef-output NEW_DIR` / `SORNG_CEF_OUTPUT`: a new retained orchestration and
  staging directory; default `.artifacts/browser-app/TARGET-<unique>`.
- `--cef-cargo-target-dir DIR` / `SORNG_CEF_CARGO_TARGET_DIR`: raw compilation
  cache; default `.cache/cef-target`. Cargo adds the target/profile subdirectories.
  It must differ from the public target directory so Cargo never reuses a
  launcher as its binary. The former `.artifacts/browser-app-cache/TARGET/target`
  default repeated the target triple and produced a 262-character Kafka MSBuild
  tracking path, failing with `FTK1011`; the shorter default reduces that path
  to 221 characters in this checkout. A real locked Cargo build of `sorng-kafka`
  with `--no-default-features --features cmake-build` passed in this cache,
  compiling the native library, Rust bindings and Kafka crate in 2m25s. The
  retained log is `.artifacts/kafka-short-cache-cargo-build-20261006.log`.
  This targeted check does not establish full desktop-build success.
  Existing caches are preserved, not automatically migrated or deleted; explicit
  overrides still apply and should use a short path on Windows.
- `--cef-public-target-dir DIR` / `SORNG_CEF_PUBLIC_TARGET_DIR`: publication root;
  otherwise inherited `CARGO_TARGET_DIR`, otherwise **`src-tauri/target`**.
  Existing CI therefore finds `TARGET/PROFILE/bundle` at the usual location.
  Only concrete files being replaced are backed up into the run workspace's
  `previous-output`; unrelated artifacts are untouched. A locked output fails;
  the driver never kills an existing app to replace it.
- `--cef-prepare-only` validates local prerequisites, emits `plan.json` and
  `build-config.json`, and compiles the tiny native Cargo trampoline; it neither
  compiles nor launches the app and is not an acceptance check.

If the existing `native-build-env.mjs` already performed dynamic dependency
selection/staging, main sets `SORNG_CEF_NATIVE_PREPARED=1` before routing to the
driver and forwards its generated resource config. The driver checks the
Windows DLL map and does not stage those dependencies again. Otherwise normal
`full` builds select the existing platform dynamic family and invoke its stager
with run-local resource/license output paths. Explicit feature lists are retained.

### Entry, watch and bundle contracts

The driver invokes the installed Tauri CLI with a dependency-free native Cargo
runner (`scripts/native/browser-cargo-runner.rs`). Tauri retains its frontend
hooks, chosen dev URL, frontend waiting/HMR, Cargo options and Rust watcher.
Windows runner builds use `cargo rustc --lib --crate-type cdylib`, without adding
global `cdylib` output to the root manifest. Unix builds compile the app plus
`sorng-cef-helper`. Every path prepares CEF before Cargo, removes inherited
`FLATPAK`/`NIX_CEF_BINARY` substitution variables, and stages the pinned payload.

For development, the runner launches only the staged bootstrap/X11 launcher/mac
bundle. Watch iterations retain separate package directories and reuse the raw
Cargo cache. A Windows kill-on-close job owns the runner's descendants (without
weakening CEF's nested sandbox); Unix Node supervision detects native-runner loss
and terminates only its own spawned process group. These cleanup mechanisms
must still receive native watch/restart acceptance on each OS.

Development staging merges existing real directories without overwriting files.
This is required both for the pre-created target/profile directory and for CEF
locale `.pak` files to coexist with the app's locale JSON files. Node 24's strict
`fs.cp` otherwise rejects those directories with `ERR_FS_CP_EEXIST`. File/type
collisions and destination symlinks/junctions remain errors. The repaired copy
step was exercised against an actual compiled Windows development payload and
all three configured app-resource mappings: 254 files / 859,764,517 bytes matched
their sources by SHA-256. Evidence:
`.artifacts/cef-dev-copy-check-9B8JXA/report.json`. This is staging evidence, not
an application launch or provider-login acceptance result.

For release, Tauri first builds with `--no-bundle`; the driver verifies the CEF
closure and then calls Tauri's **bundle-only** command. Tauri owns the final
Info.plist, configured signing and notarization; existing bundle hooks remain.
The published Windows executable is the genuine CEF bootstrap and its matching
DLL is bundled alongside it. App resource maps, OPKSSH/file-viewer payloads,
native DLLs and locale JSONs are retained alongside CEF locale PAKs. Linux
installs the public X11 launcher in `usr/bin` and its executable/helper/CEF data
through Tauri resources in `usr/lib/PRODUCT_NAME`; both native binaries use
literal `$ORIGIN` lookup. macOS includes the framework and all five helper apps,
preserves custom app plist/signing configuration and requires macOS 14.0.

`build.json` records the public output and generated `bundle-config.json` for
release collection/audit. The manifest's `productionReady: false` is deliberate:
packaging neither edits runtime admission nor certifies rendering, sandbox
execution, transport containment or provider acceptance. It does not relax
per-attempt proxy authentication, permit direct fallback, change forced dark
mode, grant auto-login consent or automate CAPTCHA.

### Local driver evidence (2026-10-06)

#### Startup failures are not necessarily missing runtime files

The development app was observed with CEF subprocesses after the staging repair.
The old shell startup handler nevertheless replaced every rejected startup
request with `host-unavailable`, including saved-policy and login-consent errors.
The shell now distinguishes capability unavailability from failures during event
subscription, capability lookup, owner validation, creation and state resync.
Only exact, reviewed native error strings receive specific guidance; unknown
errors remain redacted and identify the failed stage without logging secrets.

One source-confirmed default mismatch is important: app HTTPS trust inherits
`trustPolicy: "tofu"`, while the production native authority currently admits
only strict verification without the complete native certificate adapter.
Inherited TOFU therefore rejects creation before opening a website. HTTP-only
addresses separately fail the HTTPS-only permission check. These code paths
explain plausible all-connection failures, but the old generic message alone
does not establish which rejection a user's session encountered.

The certificate-policy notice explains the limitation and points to the saved
connection's **HTTPS Certificate Trust Policy**, including its inherited global
policy. At the user's explicit request, it is guidance only: no policy-changing
button, silent strict override, certificate bypass or automatic engine fallback.
Native TOFU/pinning/interactive certificate trust remain incomplete. Error
classification is not implementation of those certificate hooks or proof that
real provider logins succeed.

The final focused browser UI/hook suite passed **161 tests across seven files**;
full TypeScript checking and targeted ESLint/Prettier checks also passed. These
checks cover safe error classification, stale-attempt cleanup, unchanged policy
and themed guidance. A retry in the user's development app is still needed to
observe its formerly hidden native rejection. The release installer proof below
uses the earlier compiled frontend, not these later diagnostic UI edits.

#### Normal build and packaging

The later normal `npm run tauri:build` invocation retained frontend, OPKSSH and
file-viewer preparation hooks and selected the complete
`full-windows-dynamic,native-browser` release configuration. After the short-cache
repair, native compilation/linking finished successfully in **39m14s**. The real
249,811,456-byte app DLL passed fresh CEF archive/runtime/package checks;
`.artifacts/browser-app/x86_64-pc-windows-msvc-7fsoBq/package.json` reports
`ok: true`. Independent PE import inspection found no missing native dependency.
The normal build log is
`.artifacts/desktop-normal-build-short-cache-20261006.log`.

The full command did **not** complete successfully: WiX MSI validation failed.
A packaging-only verbose retry in
`.artifacts/desktop-bundle-msi-verbose-20261006.log` identified `LGHT0217`,
Windows Installer error `1719`, and ICE09 failure `0x643`. The service was running
but inaccessible to validation from this non-elevated build process. Validation
was not disabled, and no service/registry repair was attempted. This is separate
from the resolved Kafka compiler-path and development resource-copy failures.

Windows installer preparation now creates a separate app-client DLL for each
installer format. Tauri's `bundle_type()` marker lives in that DLL, not in the
pinned CEF bootstrap executable. The preparation helper replaces only the unique
`UNK` initializer with `MSI` or `NSS` before signing, preserves the comparison
literals, records SHA-256 digests and leaves raw/unbundled clients and the
bootstrap unchanged. Missing or ambiguous markers fail rather than guessing.
Explicit installer selections, including `-bnsis` and `-b=nsis`, are retained.
The six focused build/package tooling files pass **86 tests**, with two
platform-specific skips.

Tauri's stock warning about the missing marker in the bootstrap executable is
still visible; it does not inspect the prepared client DLL. Warning suppression
or inserting a meaningless marker into the bootstrap is not used as a repair.

The subsequent packaging-only **NSIS build exited 0**:

```text
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/sortOfRemoteNG_26.50.0_x64-setup.exe
.artifacts/desktop-bundle-nsis-20261006.log
.artifacts/nsis-extraction-20261006/verification-resources.json
```

The installer is 205,460,831 bytes, SHA-256
`8f1e384aa92895d87a02d75795addcc8595bf3eb81200e42d3b6f044478b7413`.
Read-only extraction found all **272 application files** (720,248,379 bytes)
SHA-256-equal to their configured resource/bootstrap sources, including **235
CEF runtime-copy comparisons**. The extracted client contains the expected
`NSS` marker and has SHA-256
`b3195e70c314808bbc2dfa28dd7a99dffd4a09d3b13c04b65010fd44c0708ced`.
Raw/unbundled/staged originals and the pinned bootstrap were unchanged.

Six additional files belong to NSIS support. The retained report records a
7-Zip listing-size discrepancy for `$PLUGINSDIR/StartMenu.dll`; no application
resource mismatch was ignored. The installer was not executed, and runtime
updater bundle-type readback was not tested. This is packaging evidence, not
installation, signing, website-login or latest diagnostic-UI acceptance.

Earlier bounded checks follow for historical context:

Using the existing archive/SDK and warm compilation cache, the real full-feature
Windows app DLL (`full-dev,native-browser`, no default features, isolated
identifier `com.sortofremote.ng.cef-driver-check`) linked in **1m53s** through the
new runner and passed fresh pinned-archive staging:

```text
.artifacts/browser-app-driver-check-20261006/package.json
.artifacts/browser-app-driver-check-20261006/payload/sortofremoteng.exe
.artifacts/browser-app-driver-check-20261006/payload/sortofremoteng.dll
```

This is an actual app compilation/package check, not a synthetic native fixture.
An isolated exit-early bootstrap-to-DLL probe also passed (exit 0), with client
SHA-256 `cc3e7d0a3f82485a500c6d99492634e577fad65ff63183ed5e41fa6c89cd0dcd`;
evidence is in `.artifacts/browser-app-driver-entry-check-20261006`. It did not
initialize CEF or test a renderer sandbox.

The outer installed-Tauri invocation then passed separately with **reduced**
`native-browser` features, debug/custom-protocol build, `--no-bundle`, offline
inputs, existing frontend/resource assets and isolated identifier
`com.sortofremote.ng.cef-driver-outer-check`. Its DLL linked in 3m05s; the driver
staged the bootstrap, client DLL, pinned runtime/locales and existing app
resources at:

```text
.artifacts/browser-app-driver-outer-check02-20261006/target/x86_64-pc-windows-msvc/debug/
.artifacts/browser-app-driver-outer-check02-20261006/build.json
.artifacts/browser-app-driver-outer-check02-20261006/bundle-config.json
```

The first outer attempt exposed Tauri's injected `--bins` argument. The runner
now replaces it with the correct single entry target; the retry above passed.
The root Cargo manifest hash was unchanged across both attempts. Frontend and
resource preparation hooks were overridden to empty for this bounded check;
it reused existing artifacts instead of claiming a fresh complete frontend
build. No installer/signing or bundled application launch was performed.

Native watch restart, installer execution and signed/notarized macOS packages
remain unverified. Linux/macOS driver
plans have tooling checks only; local Linux dependency and macOS runner limits
described above still apply. No remote CI, system installs or production profile
launches were performed for this verification.

## Original normal-app integration proposal (historical)

Historical snapshot, before normal-build integration: the new UI default alone
did not make CEF part of a normal artifact. At that time, the
`full`, `full-windows-dynamic`, `full-unix-dynamic`, `full-linux-system` and
explicit release feature lists omitted `native-browser`. Root library output was
`rlib`; ordinary Tauri build/dev launched the Cargo executable. The engineering
stager included the CEF closure, not the complete normal app resource/native-DLL
closure, and was not a replacement installer.

These are historical proposal instructions, not outstanding integration status.
For the implemented path and recorded verification, see
[Normal app build/dev driver](#normal-app-builddev-driver) and
[Local driver evidence](#local-driver-evidence-2026-10-06); for current operational
admission, see [Main entry handoff](#main-entry-handoff). Those checks do not
establish all-platform runtime acceptance.

The proposal called for main to make these changes together, rather than enable
the feature in isolation:

1. **Cargo feature wiring:** append `"native-browser"` to every normal shipping
   feature family (`full`, the two dynamic families, `full-linux-system`).
   `full-dev` inherits `full`; this requires the packaged development launcher
   in the same change. Add `native-browser` to both explicit
   `RELEASE_FEATURES_BUNDLED`/`RELEASE_FEATURES_WINDOWS` lists, which bypass the
   default feature sets. Reduced builds may remain explicitly unavailable;
   there must be no automatic legacy/direct fallback.
2. **Build driver:** route `package.json`'s `tauri:build` and desktop dev/e2e
   launchers through a CEF-aware driver after existing native-runtime feature
   selection. At that time, `native-build-env.mjs` required exactly `--features full`
   for its dynamic selector: appending `,native-browser` in that CLI argument
   alone would break it. Feature-family wiring avoids that mismatch. Keep all
   frontend, OPKSSH, file-viewer and dynamic-native staging steps.
3. **Windows build/bundle split:** in a disposable dedicated target directory,
   build the production-feature app library with `cargo rustc --lib --crate-type
cdylib` and the same Tauri release asset/configuration flags as the normal
   app. Stage the pinned bootstrap as `<mainBinaryName>.exe` and the actual
   client as `<mainBinaryName>.dll`; they must have identical stems. Then invoke
   installed Tauri's `bundle --target TARGET --features FEATURES --config CONFIG`
   without rebuilding the ordinary Cargo EXE. The installed CLI's `bundle`
   command explicitly operates on prebuilt binaries and runs
   `build.beforeBundleCommand`; use that hook for a final pair/hash/layout check.
   Set `mainBinaryName` in the generated config and place the pair at the
   dedicated target's corresponding profile root. Never overwrite a shared dev
   EXE or ship the ordinary EXE instead of the bootstrap.
4. **Windows resources:** merge every CEF payload file and locale into the
   generated `bundle.resources` map with executable-relative destinations. Also
   retain the existing native DLL set, `opkssh/`, `file-viewer/`, app locale JSONs
   and license resources. CEF locale `.pak` files and app locale `.json` files
   must both survive; never replace the app locale directory wholesale. Sign
   only after the full payload exists; recheck final installed/portable copies.
5. **Linux launcher and payload:** keep the existing public
   `com.sortofremote.ng` entry/icon/Flatpak identity. Put the compiled
   `com.sortofremote.ng.bin`, `com.sortofremote.ng.helper`, `libcef.so` and CEF
   resources/locales together in an application-private directory. The public
   launcher selects `GDK_BACKEND=x11` and execs that `.bin`; desktop/autostart/
   updater paths must point at the launcher. Preserve literal `$ORIGIN` loader
   lookup for both ELF executables. Keep the existing app resources in their
   Tauri-resolved location: on Linux Tauri's `resource_dir` is not generically
   the executable directory. Apply the same closure to AppImage, deb, rpm,
   Flatpak and portable packaging, not just one archive. Do not disable kernel
   sandbox policy or introduce automatic setuid installation to make a probe pass.
6. **macOS bundle config:** set `bundle.macOS.minimumSystemVersion` to `14.0`,
   `MACOSX_DEPLOYMENT_TARGET=14.0`, and add the staged CEF framework through
   `bundle.macOS.frameworks`. Add each complete base/Alerts/GPU/Plugin/Renderer
   helper app via `bundle.macOS.files`, whose keys are destination paths relative
   to `Contents`, e.g. `"Frameworks/<name> Helper (Renderer).app": "<staged helper>"`.
   Preserve the real Tauri app Info.plist and resources, not the CI fixture plist.
   Helpers initialize their sandbox before loading the framework. Review nested
   helper/framework signing and required entitlements on a real Mac, then sign,
   notarize/staple and inspect the final updater/DMG payload. No reduced security
   setting is proposed and none is validated locally.
7. **Admission (historical proposal):** the original permanent
   `install(runtime, false)` gate has since been replaced by main's
   `install(runtime)` and native pending/readback-ready/terminal-revoked policy.
   Package inclusion and operational startup are still not all-platform live
   acceptance or release attestation.

At that snapshot, the packaging lane had added support for safe reverse-DNS
names such as `com.sortofremote.ng`, while rejecting Windows device names and
trailing dots/spaces. `BundlePaths` preserved a macOS executable's entire dotted
name when locating helper apps (Windows `.exe` and Linux `.bin` suffixes were
still stripped).
No shared Cargo manifest, root entry/runtime, package.json or release workflow
was changed by this proposal. Installed CLI/schema and tauri-utils resource
resolution were inspected locally; final installer integration had not been built.

### Historical fresh-archive Windows fixture result: failed

This records the earlier fixture's failure, not the current runtime status or
admission policy. See [Main entry handoff](#main-entry-handoff) for current
operational admission and [Local driver evidence](#local-driver-evidence-2026-10-06)
for later build/entry verification, which does not turn this failed renderer
fixture into a pass.

The independently compiled fixture DLL was staged from a fresh verified archive:

```text
.artifacts/cef-acceptance-package-windows-x64-20261006/sorng-cef-acceptance.exe
client SHA256 64ec9f6d50e5e7bdee57bb18f2943a426541c78a862e192d0daf3206f0ee406a
```

Actual launch through that pinned bootstrap exited 3 (not a runner timeout).
`.artifacts/cef-packaged-acceptance-run-windows-x64-20261006/acceptance.json`
records `generic: native lifecycle deadline`, zero fixture requests/route dials,
no completed real-origin/login observations and no renderer-token observation.
`run-CNZq4I/cef.log` records child processes terminating after 15 seconds without
a connection. This reproduced Carver's first run with independently extracted
runtime provenance. Native context/browser progress was unresolved at that
snapshot, so this run did not justify production admission. Both failure reports
and disposable profiles were retained.
