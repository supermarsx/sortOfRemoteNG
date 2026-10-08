//! Packaged native startup, before app profiles/services. Main wires this module
//! behind native-browser; only an authorized create or idle prewarm installs the
//! deferred runtime. Both require a current native database owner lease.
//! Operational admission follows checked native policy setup. Cross-platform
//! release acceptance and provider compatibility remain separate evidence.

use sorng_browser_host::{
    bootstrap_platform::{BootstrapError, BundlePaths, ProcessDispatch, RuntimeBootstrap},
    cef_runtime::{self, CefRuntime, RuntimeError, ScheduleWake},
};
use std::{
    cell::{Cell, RefCell},
    sync::Arc,
};

const STARTUP_FAILED: &str = "Packaged native browser startup failed";

/// Only fixed native diagnostics and numeric codes; never OS/path/page strings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EntryError {
    Fixed(&'static str),
    Bootstrap(BootstrapError),
    Runtime(RuntimeError),
    #[cfg(windows)]
    Windows(sorng_browser_host::platform::windows::BootstrapFailure),
    #[cfg(target_os = "linux")]
    Linux(sorng_browser_host::platform::linux::X11BootstrapError),
}

impl std::fmt::Display for EntryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Fixed(message) => f.write_str(message),
            Self::Bootstrap(error) => std::fmt::Display::fmt(error, f),
            Self::Runtime(error) => std::fmt::Display::fmt(error, f),
            #[cfg(windows)]
            Self::Windows(error) => std::fmt::Display::fmt(error, f),
            #[cfg(target_os = "linux")]
            Self::Linux(error) => std::fmt::Display::fmt(error, f),
        }
    }
}

struct Pending {
    provider: Box<dyn RuntimeBootstrap>,
}

thread_local! {
    static ENTERED: Cell<bool> = const { Cell::new(false) };
    static PENDING: RefCell<Option<Pending>> = const { RefCell::new(None) };
}

fn claim_entry() -> Result<(), EntryError> {
    ENTERED.with(|entered| {
        if entered.replace(true) {
            Err(EntryError::Fixed(STARTUP_FAILED))
        } else {
            Ok(())
        }
    })
}

/// Call at the very start of app::run, before profiles, tracing or services.
/// A normal Windows EXE cannot supply the CEF bootstrap sandbox capability.
pub(crate) fn dispatch_app_entry() -> Result<ProcessDispatch, EntryError> {
    #[cfg(windows)]
    {
        if ENTERED.with(Cell::get) && PENDING.with(|pending| pending.borrow().is_some()) {
            Ok(ProcessDispatch::Browser)
        } else {
            Err(EntryError::Fixed(
                "The native browser requires the packaged Windows sandbox bootstrap",
            ))
        }
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // Main calls this before creating any app services or native toolkit.
        unsafe { prepare_unix() }
    }
}

fn retain_browser(provider: Box<dyn RuntimeBootstrap>) -> Result<ProcessDispatch, EntryError> {
    // Resolve/validate package resources on first authorized startup. A missing
    // resource must not consume the provider or prevent using app settings.
    PENDING.with(|pending| *pending.borrow_mut() = Some(Pending { provider }));
    Ok(ProcessDispatch::Browser)
}

/// # Safety
/// Call only with the pinned bootstrap's original entry parameters before all
/// application services. The registry must shut down before this entry returns;
/// failed initialization requires immediate process termination. The pending
/// provider must never be moved to another thread or reused after shutdown.
#[cfg(windows)]
pub(crate) unsafe fn prepare_windows(
    instance: sorng_browser_host::platform::windows::BootstrapInstance,
    sandbox: *mut std::ffi::c_void,
    version: *const sorng_browser_host::platform::windows::BootstrapVersionInfo,
) -> Result<ProcessDispatch, EntryError> {
    use sorng_browser_host::platform::windows::WindowsSandboxBootstrap;
    claim_entry()?;
    // The heap provider is dropped by the owned runtime's shutdown BEFORE
    // RunWinMain returns and bootstrap releases its borrowed sandbox pointers.
    let mut provider = unsafe { WindowsSandboxBootstrap::from_entry(instance, sandbox, version) }
        .map_err(EntryError::Windows)?;
    let dispatch = {
        let mut app = cef_runtime::subprocess_application();
        provider
            .execute_process(Some(&mut app))
            .map_err(EntryError::Windows)?
    };
    match dispatch {
        ProcessDispatch::Exit(code) => Ok(ProcessDispatch::Exit(code)),
        ProcessDispatch::Browser => retain_browser(Box::new(provider)),
    }
}

/// # Safety
/// Initial main thread only, before GTK/Tao, services, logging or worker threads.
/// Linux must enter through the packaged GDK_BACKEND=x11 launcher. Return child
/// exit codes immediately; never continue app startup after an error.
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) unsafe fn prepare_unix() -> Result<ProcessDispatch, EntryError> {
    claim_entry()?;
    #[cfg(target_os = "linux")]
    let mut provider =
        unsafe { sorng_browser_host::platform::linux::X11Bootstrap::prepare_before_threads() }
            .map_err(EntryError::Linux)?;
    #[cfg(target_os = "macos")]
    let mut provider = unsafe {
        sorng_browser_host::platform::macos::MacBrowserBootstrap::from_bundle_executable(
            &std::env::current_exe()
                .map_err(|_| EntryError::Fixed("Native executable path is unavailable"))?,
        )
    }
    .map_err(EntryError::Bootstrap)?;
    let dispatch = {
        let mut app = cef_runtime::subprocess_application();
        let dispatch = provider
            .execute_process(Some(&mut app))
            .map_err(EntryError::Bootstrap)?;
        dispatch
    };
    match dispatch {
        ProcessDispatch::Exit(code) => Ok(ProcessDispatch::Exit(code)),
        ProcessDispatch::Browser => retain_browser(Box::new(provider)),
    }
}

/// Authorized create/prewarm only, on the original native thread. Keep the provider on
/// all pre-init failures. Once native initialization is issued it is NEVER retried.
pub(crate) fn install(
    wake: ScheduleWake,
    data_root: &std::path::Path,
    timing: &crate::origin_browser_startup_diagnostics::Trace,
    begin_native: impl FnOnce() -> bool,
) -> Result<(), EntryError> {
    use crate::origin_browser_startup_diagnostics::{self as diagnostics, Failure, Stage, TimingStage};
    let executable = std::env::current_exe()
        .map_err(|_| EntryError::Fixed("Native executable path is unavailable"))?;
    let paths = BundlePaths::from_executable(&executable).map_err(EntryError::Bootstrap)?;
    let settings =
        cef_runtime::native_settings_with_data_root(&paths.helper, &paths.resources, data_root)
            .map_err(EntryError::Runtime)?;
    sorng_browser_host::bootstrap_platform::validate_native_settings(&settings)
        .map_err(EntryError::Bootstrap)?;
    if !PENDING.with(|slot| slot.borrow().is_some()) {
        return Err(EntryError::Fixed("Native startup provider is unavailable"));
    }
    if !begin_native() {
        return Err(EntryError::Fixed(
            "Native startup was cancelled before initialization",
        ));
    }
    let pending = PENDING
        .with(|slot| slot.borrow_mut().take())
        .expect("provider retained until native startup on this thread");
    diagnostics::record(Stage::Initializing, None);
    // The native wrapper includes Windows runtime-access preflight and CEF.
    // Record before entering: a hung call need not return to leave a milestone.
    timing.mark(TimingStage::NativeInitializeEntered);
    let runtime = unsafe {
        CefRuntime::initialize_owned(
            pending.provider,
            &settings,
            wake,
            Arc::new(|_| {
                crate::origin_browser_runtime::revoke_all();
            }),
        )
    };
    timing.mark(TimingStage::NativeInitializeReturned);
    let runtime = match runtime {
        Ok(runtime) => runtime,
        Err(error) => {
            timing.finish(0);
            diagnostics::record(Stage::Failed, Some(Failure::Initialization));
            log::error!("Native browser stage=initializing error={error}");
            eprintln!("Native browser stage=initializing error={error}");
            log::logger().flush();
            // CEF documents immediate process exit after failed Initialize.
            // Delaying startup does not contain a native FATAL/abort.
            let code = match error {
                RuntimeError::Bootstrap(BootstrapError::InitializeFailed(code)) if code != 0 => {
                    code
                }
                _ => 1,
            };
            std::process::exit(code);
        }
    };
    crate::origin_browser_runtime::install(runtime)
        .map_err(|_| EntryError::Fixed("Native runtime registry installation failed"))?;
    timing.mark(TimingStage::RuntimeInstalled);
    Ok(())
}

/// The production export is compiled into app_lib.dll when main declares this
/// module under native-browser and builds --lib --crate-type cdylib.
#[cfg(windows)]
#[no_mangle]
#[allow(non_snake_case)]
pub unsafe extern "C" fn RunWinMain(
    instance: sorng_browser_host::platform::windows::BootstrapInstance,
    _command_line: *mut u16,
    _show: i32,
    sandbox: *mut std::ffi::c_void,
    version: *const sorng_browser_host::platform::windows::BootstrapVersionInfo,
) -> i32 {
    match unsafe { prepare_windows(instance, sandbox, version) } {
        Ok(ProcessDispatch::Exit(code)) => code,
        Ok(ProcessDispatch::Browser) => {
            // Explicit diagnostic only. Never start app profiles, databases or
            // CEF browsing for this loopback-only final-link regression test.
            if std::env::args_os().any(|arg| arg == super::origin_browser_network_probe::FLAG) {
                return super::origin_browser_network_probe::run();
            }
            crate::run();
            // Main normally drains the registry before its loop exits. Never
            // release bootstrap sandbox data while native browsers remain live.
            if crate::origin_browser_runtime::shutdown().is_err() {
                std::process::abort();
            }
            0
        }
        Err(error) => {
            eprintln!("Native browser stage=bootstrap error={error}");
            1
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn ordinary_windows_executable_cannot_enter_native_browser_startup() {
        assert_eq!(
            dispatch_app_entry(),
            Err(EntryError::Fixed(
                "The native browser requires the packaged Windows sandbox bootstrap"
            ))
        );
        ENTERED.with(|entered| entered.set(true));
        assert!(dispatch_app_entry().is_err()); // claim alone supplies no provider.
    }
}
