//! Packaged native startup, before app profiles/services. Main wires this module
//! behind native-browser, install() in setup, and the registry pump/shutdown.
//! Operational admission follows checked native policy setup. Cross-platform
//! release acceptance and provider compatibility remain separate evidence.

use sorng_browser_host::{
    bootstrap_platform::{BundlePaths, ProcessDispatch, RuntimeBootstrap},
    cef_runtime::{self, CefRuntime, ScheduleWake},
};
use std::{
    cell::{Cell, RefCell},
    sync::Arc,
};

const STARTUP_FAILED: &str = "Packaged native browser startup failed";

struct Pending {
    provider: Box<dyn RuntimeBootstrap>,
    paths: BundlePaths,
}

thread_local! {
    static ENTERED: Cell<bool> = const { Cell::new(false) };
    static PENDING: RefCell<Option<Pending>> = const { RefCell::new(None) };
}

fn claim_entry() -> Result<(), &'static str> {
    ENTERED.with(|entered| {
        if entered.replace(true) {
            Err(STARTUP_FAILED)
        } else {
            Ok(())
        }
    })
}

/// Call at the very start of app::run, before profiles, tracing or services.
/// A normal Windows EXE cannot supply the CEF bootstrap sandbox capability.
pub(crate) fn dispatch_app_entry() -> Result<ProcessDispatch, &'static str> {
    #[cfg(windows)]
    {
        if ENTERED.with(Cell::get) && PENDING.with(|pending| pending.borrow().is_some()) {
            Ok(ProcessDispatch::Browser)
        } else {
            Err("The native browser requires the packaged Windows sandbox bootstrap")
        }
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // Main calls this before creating any app services or native toolkit.
        unsafe { prepare_unix() }
    }
}

fn retain_browser(provider: Box<dyn RuntimeBootstrap>) -> Result<ProcessDispatch, &'static str> {
    let executable = std::env::current_exe().map_err(|_| STARTUP_FAILED)?;
    let paths = BundlePaths::from_executable(&executable).map_err(|_| STARTUP_FAILED)?;
    PENDING.with(|pending| *pending.borrow_mut() = Some(Pending { provider, paths }));
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
) -> Result<ProcessDispatch, &'static str> {
    use sorng_browser_host::platform::windows::WindowsSandboxBootstrap;
    claim_entry()?;
    // The heap provider is dropped by the owned runtime's shutdown BEFORE
    // RunWinMain returns and bootstrap releases its borrowed sandbox pointers.
    let mut provider = unsafe { WindowsSandboxBootstrap::from_entry(instance, sandbox, version) }
        .map_err(|_| STARTUP_FAILED)?;
    let dispatch = {
        let mut app = cef_runtime::subprocess_application();
        provider
            .execute_process(Some(&mut app))
            .map_err(|_| STARTUP_FAILED)?
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
pub(crate) unsafe fn prepare_unix() -> Result<ProcessDispatch, &'static str> {
    claim_entry()?;
    #[cfg(target_os = "linux")]
    let mut provider =
        unsafe { sorng_browser_host::platform::linux::X11Bootstrap::prepare_before_threads() }
            .map_err(|_| STARTUP_FAILED)?;
    #[cfg(target_os = "macos")]
    let mut provider = unsafe {
        sorng_browser_host::platform::macos::MacBrowserBootstrap::from_bundle_executable(
            &std::env::current_exe().map_err(|_| STARTUP_FAILED)?,
        )
    }
    .map_err(|_| STARTUP_FAILED)?;
    let dispatch = {
        let mut app = cef_runtime::subprocess_application();
        provider
            .execute_process(Some(&mut app))
            .map_err(|_| STARTUP_FAILED)?
    };
    match dispatch {
        ProcessDispatch::Exit(code) => Ok(ProcessDispatch::Exit(code)),
        ProcessDispatch::Browser => retain_browser(Box::new(provider)),
    }
}

/// Call from Tauri setup on the same native thread, after Tao creates its native
/// application. The wake posts main-loop work; it must not synchronously reenter
/// the registry and must arrange a timer for positive CEF deadlines.
pub(crate) fn install(wake: ScheduleWake, data_root: &std::path::Path) -> Result<(), String> {
    let pending = PENDING
        .with(|slot| slot.borrow_mut().take())
        .ok_or(STARTUP_FAILED)?;
    let settings = cef_runtime::native_settings_with_data_root(
        &pending.paths.helper,
        &pending.paths.resources,
        data_root,
    )
    .map_err(|_| STARTUP_FAILED)?;
    let runtime = unsafe {
        CefRuntime::initialize_owned(
            pending.provider,
            &settings,
            wake,
            Arc::new(|_| {
                crate::origin_browser_runtime::revoke_all();
            }),
        )
    }
    .map_err(|_| STARTUP_FAILED)?;
    crate::origin_browser_runtime::install(runtime)
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
            crate::run();
            // Main normally drains the registry before its loop exits. Never
            // release bootstrap sandbox data while native browsers remain live.
            if crate::origin_browser_runtime::shutdown().is_err() {
                std::process::abort();
            }
            0
        }
        Err(_) => 1,
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
            Err("The native browser requires the packaged Windows sandbox bootstrap")
        );
        ENTERED.with(|entered| entered.set(true));
        assert!(dispatch_app_entry().is_err()); // claim alone supplies no provider.
    }
}
