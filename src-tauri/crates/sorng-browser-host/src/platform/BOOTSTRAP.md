# CEF native platform bootstrap handoff

This code targets cef/cef-dll-sys `154.3.0+154.0.32`, CEF revision
`682c378d70d5780061e96644dca16ddd8fd157a9`, and Tao `0.35.3`.
Bootstrap success does not attest traffic containment, browser sandbox operation,
provider login acceptance, or production readiness.

## Integration surface

`bootstrap_platform::run_windows_entry` and `run_unix_entry` offer scoped entry
closures over `&mut dyn RuntimeBootstrap` plus `BundlePaths`. For the app's
thread-local `CefRuntime<'static>` registry, `src-tauri/src/origin_browser_entry.rs`
instead prepares the boxed provider before app services and installs it from
Tauri setup after Tao creation. It contains the production `RunWinMain` export.
Main must feature-gate that module, wire Unix prepare before profiles, install
the external-pump wake/timer, and drain/shutdown before native entry returns.
The owned runtime drops its provider on successful shutdown and
keeps the macOS framework resident until process exit. It always installs with
acceptance `false`; no package or unit test changes that flag.

`bootstrap_platform::RuntimeBootstrap` is an object-safe native provider with
`unsafe initialize_native(settings, app)` and `unsafe shutdown_native()`.
`CefRuntime` borrows it for its whole lifetime, owns scheduling, and delegates
native initialization/shutdown to it. There must be only one lifecycle owner.
`platform::bootstrap` re-exports the same module, not another definition.

| Platform | Startup provider | Before shared runtime initialization |
| --- | --- | --- |
| Windows | `WindowsSandboxBootstrap::from_entry` | Validate bootstrap pointer/version, dispatch `execute_process`, return every `Exit(code)` immediately |
| Linux | `X11Bootstrap::prepare_before_threads` | Validate launcher environment, call XInitThreads, dispatch `execute_process`, then create GTK/Tao |
| macOS browser | `MacBrowserBootstrap::from_bundle_executable` | Load verified framework, dispatch `execute_process`, let Tao create NSApplication |
| macOS helper | `MacHelperBootstrap::from_bundle_executable` | Initialize seatbelt sandbox before loading framework; use `execute_and_exit` and return its code |

Construct the native subprocess App only after the provider selected the pinned
API. Preserve all CEF-generated switches, including unknown future switches.
Unix `OwnedMainArgs` owns exact OS argument bytes and a NUL-terminated pointer
array; it does not clone pointers or rejoin quoted strings. Windows uses the
bootstrap executable's supplied HINSTANCE and CEF's native command-line parsing.
Never place private proxy credentials in arguments, environment, logs or URLs.

The shared runtime must use an external pump on the initial UI thread. Wake the
Tao loop from `OnScheduleMessagePumpWork`, replace/coalesce its deadline, and call
`CefDoMessageLoopWork` only on that UI thread. Never start a second CEF/Cocoa
event loop or a worker-thread pump. Positive delays replace the pending timer,
as required by the pinned header. The wake callback returns failure if the native
event channel is closed; the independent runtime fault callback must synchronously
revoke every owned relay without needing another UI poll. It must not call CEF on
the failing thread. A wake failure during initialization shuts the initialized
runtime down before returning an error. Keep the borrowed native parent alive until
every child has delivered `OnBeforeClose`. Revoke admissions and private relays,
close browsers, drain callbacks, release native wrappers, stop scheduled pump
work, drop App wrappers, and only then call the provider's shutdown method.
macOS shutdown deliberately leaves the framework loaded: caller-owned Settings
and other CefString values still need its native free functions. Drop those
values, then call `MacBrowserBootstrap::unload_after_shutdown` as the final native
entry action before process exit. Initialization-error cleanup follows the same
order. Windows never frees the borrowed sandbox data.

## Windows bootstrap and packaging

CEF M138+ no longer ships a sandbox static library for ordinary client linking.
The supported packaging is the pinned `bootstrap.exe` (or `bootstrapc.exe`)
loading the application DLL. The application DLL exports C ABI, not WINAPI ABI:

```rust,ignore
#[no_mangle]
pub unsafe extern "C" fn RunWinMain(
    instance: cef::sys::HINSTANCE,
    command_line: *mut u16,
    show: i32,
    sandbox_info: *mut std::ffi::c_void,
    version_info: *const platform::windows::BootstrapVersionInfo,
) -> i32 { /* create guard, dispatch child or continue browser main */ }
```

Rename the pinned bootstrap to the application EXE and put the matching named
DLL next to it, or use CEF's `--module=client` convention. Both browser and child
processes must execute this same bootstrap. `browser_subprocess_path` MUST stay
empty. Forward the supplied sandbox pointer unchanged to ExecuteProcess and
Initialize. A null pointer is a startup failure; `no_sandbox=0` alone establishes
no sandbox. Do not create/free sandbox info in a client DLL or do startup work
from DllMain. Do not launch Tauri, services or thread pools in a CEF child.

`BootstrapVersionInfo` mirrors the pinned header including the sandbox hash and
installer fields. `windows_bootstrap_abi.cc` checks it against the actual SDK
header; compile with clang-cl `/Zs /std:c++17 /I<CEF-root>` in a configured Windows
SDK/MSVC environment. The guard rejects mismatched version, hash, or installer
failure. The revision/API check verifies the loaded library, not its signature.
Package admission still must authenticate all native files.

Bundle the full matching CEF distribution: bootstrap, client DLL, libcef,
chrome_elf, ICU, resource PAKs, locales, V8 snapshot and runtime graphics
dependencies. Match CPU architecture. Preserve licenses. Sign the final
application/bootstrap and bundled binaries after modifying icons/resources.
Bundling authorization does not authorize automatic runtime download/update.

## Linux X11 / XWayland

The process launcher must set only this child's environment to `GDK_BACKEND=x11`
and inherit a real session DISPLAY and Xauthority access. XWayland is supported
even when WAYLAND_DISPLAY is also set. Missing DISPLAY, backend fallback lists,
native Wayland and late/multithreaded bootstrap fail closed. Do not set DISPLAY
to a guessed value, change globals after threads start, install packages, alter
user namespaces, change setuid bits, or change machine-wide display settings.

`prepare_before_threads` requires the initial thread and a single current task,
then calls XInitThreads. Its unsafe caller contract additionally excludes any
earlier toolkit/Xlib initialization or earlier worker threads; /proc alone
cannot prove history. GTK selection is validated without environment mutation.
The native App's command-line callback must also set `ozone-platform=x11` before
CEF initialization (including child inheritance). A GTK X11 selection alone
does not select Chromium's Ozone backend.

After GTK creates the trusted parent, use `X11Bootstrap::parent` to check actual
Xlib handles and their display name against the initial selection. Retain it
until all CEF children close. Package matching libcef/resources with an
application-local loader search path. Test the normal Chromium Linux sandbox
on the supported distributions; if OS policy denies it, report the failure.
Never add `--no-sandbox` or silently fall back to a direct route/backend.

## macOS application bridge, helper and packaging

`macos_application.mm` adds CEF protocols and methods to the already existing
TaoApp. It checks macOS 14+, main thread, the exact reviewed TaoApp superclass,
and Tao's own sendEvent method. It preserves NSApp identity, delegate and original
IMP, invoking that IMP inside a balanced @try/@finally event scope. Nested event
dispatch restores the previous value. It rejects an unknown/conflicting bridge.
There is no second NSApplication, application subclass swap, or second run loop.
Do not instantiate CEF's sample application before Tao: Tao would then inherit
the wrong singleton. Do not subclass TaoApp: its dynamic superclass lookup in
sendEvent would recurse. Re-review the bridge whenever the pinned Tao changes.

The host `build.rs` compiles the .mm using target-gated
`cc`, C++17, ARC, macOS deployment target 14.0, and the exact SDK include directory
from `DEP_CEF_DLL_WRAPPER_CEF_DIR`; link AppKit. Do not infer a runtime SDK from
an arbitrary CEF_PATH. A missing bridge is a link error, not a successful stub.

Browser framework path is relative to `<App>.app/Contents/MacOS/<App>` under
`../Frameworks/Chromium Embedded Framework.framework`. Helpers live under
`Contents/Frameworks/<App> Helper*.app/Contents/MacOS/` and resolve the framework
via `../../..`. Resolve ancestry before canonicalizing helper executable links.
Distribute the pinned helper variants: Helper, Helper (Renderer), Helper (GPU),
Helper (Plugin), Helper (Alerts), with correct bundle identifiers and names.
Keep framework Resources/Libraries and `libcef_sandbox.dylib` intact.

Helper startup calls the sandbox dylib's initialize function before dynamically
loading CEF. It then selects the API, creates its process App, executes CEF,
drops App, unloads CEF, destroys the sandbox context and returns the exact exit
code. Never statically link the CEF framework, call the browser application
bridge or run Tauri/services in the helper. Sign nested framework/helper bundles
and the app with the CEF-prescribed per-role entitlements and hardened runtime;
verify launch under the final signed/notarized packaging on both Mac architectures.
The helper and its seatbelt effectiveness have not been run on this Windows host.

For macOS unit tests that allocate/free CefString, call
`platform::test_runtime::ensure_loaded()` first. build.rs must export
`SORNG_CEF_TEST_RUNTIME_DIR` from the selected DEP_CEF_DLL_WRAPPER_CEF_DIR. The hook
loads the framework once and keeps it loaded through process exit. It does NOT
initialize CEF, install an application bridge, or disable the sandbox.

## Verifier gates and local evidence

Windows evidence at the platform handoff: all 72 host Rust tests passed with cef-host, including
ten platform/bootstrap tests,
including matching the actually loaded CEF revision/API and null-sandbox
rejection. The C++ ABI fixture compiled against the downloaded pinned SDK on
Windows x64. No live browser, child sandbox or public sign-in test was performed.
Linux/macOS native compilation, signed helper launch, live embedding and bridge
event behavior remain target-runner verification requirements.

The reviewed unit-test bodies need no GTK/NSApplication/CefInitialize call on
Linux/macOS: they use structural native-handle checks, Rust-owned callback
vtables, loopback transports and CEF strings. The macOS string tests now use the
once-only framework loader. Run the full `--features cef-host --lib` suite in
CI, not just `--no-run`. This is source-reviewed portability, not a recorded
Linux/macOS pass. Runners still need the platform loader dependencies and the
selected CEF shared library discoverable (especially when CEF_PATH puts it
outside Cargo's target directory). The Windows-only native surface test creates
real hidden HWNDs; it does not create a CEF browser or require a second UI loop.

Native acceptance must exercise child launch and exit before any Tauri startup,
keyboard CMD-key-up/device events on Mac, nested dispatch, child focus and bounds,
parent destruction, delayed close acknowledgement, timer cancellation and shutdown.
Run the same proxy tripwires on all three OSes: redirects, workers, frames,
WebSockets, DNS, QUIC, WebRTC and disabled proxy. No destination may escape the
private authenticated forward proxy, and TLS must remain end-to-end. Keep forced
dark and autologin active in the tested browser behavior. These platform files
do not attest those independently owned routing/renderer policies.

Primary contracts reviewed:

- [CEF sandbox setup](https://chromiumembedded.github.io/cef/sandbox_setup.html)
- [Pinned CEF sandbox Windows header](https://github.com/chromiumembedded/cef/blob/682c378d70d5780061e96644dca16ddd8fd157a9/include/cef_sandbox_win.h)
- [Pinned CEF application protocols](https://github.com/chromiumembedded/cef/blob/682c378d70d5780061e96644dca16ddd8fd157a9/include/cef_application_mac.h)
- [Pinned CEF helper sequence](https://github.com/chromiumembedded/cef/blob/682c378d70d5780061e96644dca16ddd8fd157a9/tests/shared/process_helper_mac.cc)
- [Tao 0.35.3 application handler](https://github.com/tauri-apps/tao/blob/tao-v0.35.3/src/platform_impl/macos/app.rs)
- [Tao 0.35.3 singleton creation](https://github.com/tauri-apps/tao/blob/tao-v0.35.3/src/platform_impl/macos/event_loop.rs)
