//! Platform startup contracts for CEF 154.0.32 / cef-rs 154.3.0.
//!
//! A successful bootstrap is not a containment or provider-login attestation.
//! See `platform/BOOTSTRAP.md` for entry point, pump and packaging requirements.

use std::ffi::{CStr, OsStr};
use std::path::{Path, PathBuf};

/// Native package locations, derived before profiles, plugins or the UI start.
/// This checks layout only; archive provenance/signatures are packaging gates.
#[derive(Debug)]
pub struct BundlePaths {
    pub root: PathBuf,
    pub helper: PathBuf,
    pub resources: PathBuf,
}

fn bundle_app_name(executable: &Path, macos_bundle: bool) -> Option<&str> {
    // Unix app bundle executable names have no suffix to strip: reverse-DNS
    // names such as com.sortofremote.ng must retain the final .ng component.
    let name = if macos_bundle {
        executable.file_name()
    } else {
        executable.file_stem() // packaged Windows .exe / Linux .bin
    };
    name.and_then(OsStr::to_str)
}

impl BundlePaths {
    pub fn from_executable(executable: &Path) -> Result<Self, BootstrapError> {
        if !executable.is_absolute() || !executable.is_file() {
            return Err(BootstrapError::PlatformPrecondition(
                "missing bundle executable",
            ));
        }
        let parent = executable
            .parent()
            .ok_or(BootstrapError::PlatformPrecondition(
                "missing bundle directory",
            ))?;
        let stem = bundle_app_name(executable, cfg!(target_os = "macos")).ok_or(
            BootstrapError::PlatformPrecondition("invalid bundle executable name"),
        )?;
        #[cfg(target_os = "windows")]
        let paths = Self {
            root: parent.to_owned(),
            helper: executable.to_owned(),
            resources: parent.to_owned(),
        };
        #[cfg(target_os = "linux")]
        let paths = Self {
            root: parent.to_owned(),
            helper: parent.join(format!("{stem}.helper")),
            resources: parent.to_owned(),
        };
        #[cfg(target_os = "macos")]
        let paths = {
            let root = parent
                .parent()
                .filter(|p| p.file_name() == Some(OsStr::new("Contents")))
                .and_then(Path::parent)
                .ok_or(BootstrapError::PlatformPrecondition(
                    "executable is not inside an application bundle",
                ))?;
            let frameworks = root.join("Contents/Frameworks");
            Self {
                root: root.to_owned(),
                helper: frameworks.join(format!("{stem} Helper.app/Contents/MacOS/{stem} Helper")),
                resources: frameworks.join("Chromium Embedded Framework.framework/Resources"),
            }
        };
        #[cfg(target_os = "windows")]
        if !parent.join(format!("{stem}.dll")).is_file() || !parent.join("libcef.dll").is_file() {
            return Err(BootstrapError::PlatformPrecondition(
                "missing bootstrap client DLL or CEF runtime",
            ));
        }
        let root = paths
            .root
            .canonicalize()
            .map_err(|_| BootstrapError::PlatformPrecondition("bundle cannot be resolved"))?;
        for required in [
            &paths.helper,
            &paths.resources.join("icudtl.dat"),
            &paths.resources.join("resources.pak"),
        ] {
            if !required.is_file()
                || !required
                    .canonicalize()
                    .map(|p| p.starts_with(&root))
                    .unwrap_or(false)
            {
                return Err(BootstrapError::PlatformPrecondition(
                    "bundle helper/resource missing or outside bundle",
                ));
            }
        }
        Ok(paths)
    }
}

/// Entry adapter called by the application's exported C-ABI RunWinMain.
/// The five exported arguments are (instance, command_line, show, sandbox,
/// version); command_line/show need not be forwarded here because CEF parses
/// the process's native command line. The browser closure owns app startup.
///
/// # Safety
/// Call only from the pinned sandbox bootstrap with its original pointers,
/// before any services/threads/profile initialization. The closure must release
/// every CEF object and complete shutdown before returning. Never unwind across
/// the application's extern-C export. Return the result directly to bootstrap.
#[cfg(target_os = "windows")]
pub unsafe fn run_windows_entry(
    instance: cef::sys::HINSTANCE,
    sandbox: *mut std::ffi::c_void,
    version: *const crate::platform::windows::BootstrapVersionInfo,
    run_browser: impl FnOnce(&mut dyn RuntimeBootstrap, &BundlePaths) -> i32,
) -> i32 {
    use crate::platform::windows::WindowsSandboxBootstrap;
    let Ok(mut provider) =
        (unsafe { WindowsSandboxBootstrap::from_entry(instance, sandbox, version) })
    else {
        return 1;
    };
    let dispatch = {
        let mut app = crate::cef_runtime::subprocess_application();
        provider.execute_process(Some(&mut app))
    };
    match dispatch {
        Ok(ProcessDispatch::Exit(code)) => return code,
        Ok(ProcessDispatch::Browser) => {}
        Err(_) => return 1,
    }
    let Ok(executable) = std::env::current_exe() else {
        return 1;
    };
    let Ok(paths) = BundlePaths::from_executable(&executable) else {
        return 1;
    };
    run_browser(&mut provider, &paths)
}

/// Earliest Unix application entry; the separate helper never calls this.
///
/// # Safety
/// Call on the initial thread before toolkit, services, logging or workers.
/// The launcher must have selected GDK_BACKEND=x11 on Linux. The closure owns
/// the UI loop and must close browsers, drop all CEF objects and shut down before
/// returning. Exit the process immediately with this function's result, including
/// after initialization failure. No caller may retain CEF wrappers across it.
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub unsafe fn run_unix_entry(
    run_browser: impl FnOnce(&mut dyn RuntimeBootstrap, &BundlePaths) -> i32,
) -> i32 {
    let Ok(executable) = std::env::current_exe() else {
        return 1;
    };
    let Ok(paths) = BundlePaths::from_executable(&executable) else {
        return 1;
    };
    #[cfg(target_os = "linux")]
    let Ok(mut provider) =
        (unsafe { crate::platform::linux::X11Bootstrap::prepare_before_threads() })
    else {
        return 1;
    };
    #[cfg(target_os = "macos")]
    let Ok(mut provider) = (unsafe {
        crate::platform::macos::MacBrowserBootstrap::from_bundle_executable(&executable)
    }) else {
        return 1;
    };
    let dispatch = {
        let mut app = crate::cef_runtime::subprocess_application();
        provider.execute_process(Some(&mut app))
    };
    match dispatch {
        Ok(ProcessDispatch::Exit(code)) => return code,
        Ok(ProcessDispatch::Browser) => {}
        Err(_) => return 1,
    }
    let code = run_browser(&mut provider, &paths);
    #[cfg(target_os = "macos")]
    if code == 0 && unsafe { provider.unload_after_shutdown() }.is_err() {
        return 1;
    }
    // On failure leave the framework resident until immediate process exit:
    // outstanding CEF string destructors must never call an unloaded library.
    code
}

// From the pinned distribution's include/cef_version.h. The Rust bindings do
// not expose cef_version_info; cef_api_hash entry 2 exposes the full revision.
pub const PINNED_CEF_COMMIT_NUMBER: i32 = 3631;
pub const PINNED_CEF_COMMIT_HASH: &[u8] = b"682c378d70d5780061e96644dca16ddd8fd157a9";

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum BootstrapError {
    #[error("CEF must run with its sandbox enabled")]
    SandboxDisabled,
    #[error("Native embedding requires a single UI thread and the external CEF message pump")]
    InvalidMessageLoop,
    #[error("Native embedding must not enable windowless rendering")]
    WindowlessRendering,
    #[error("CEF browser command-line configuration must be disabled; use the native-owned App callback")]
    BrowserArgumentsEnabled,
    #[error("CEF must use its genuine browser identity")]
    BrowserIdentityOverride,
    #[error("The loaded CEF runtime does not match the pinned build")]
    RuntimeMismatch,
    #[error("The loaded CEF runtime does not support the pinned API")]
    ApiUnavailable,
    #[error("CEF returned an unexpected process-dispatch result")]
    ProcessDispatchFailed,
    #[error("Launch the application with GDK_BACKEND=x11 before GTK or worker threads start")]
    X11BackendRequired,
    #[error("X11/XWayland requires a nonempty DISPLAY supplied by the desktop session")]
    X11DisplayRequired,
    #[error("Process arguments contain an interior NUL or exceed CEF's argc range")]
    InvalidArguments,
    #[error("CEF platform startup prerequisite failed: {0}")]
    PlatformPrecondition(&'static str),
    #[error("CEF platform lifecycle must run once in order on its initialization thread")]
    InvalidLifecycle,
    #[error("CEF initialization failed; exit the process (code {0})")]
    InitializeFailed(i32),
}

/// Native-only, object-safe provider borrowed by the shared runtime. The
/// runtime owns scheduling and calls these methods exactly once; the provider
/// owns platform prerequisites, initialization/shutdown and loaded libraries.
/// Keep the provider alive until the shared runtime has completed shutdown.
pub trait RuntimeBootstrap {
    /// # Safety
    /// The caller owns the main/UI event loop, supplies reviewed native-owned
    /// callbacks and keeps all package resources alive. Failed initialization
    /// requires process exit. A successful initialization requires shutdown.
    unsafe fn initialize_native(
        &mut self,
        settings: &cef::Settings,
        app: &mut cef::App,
    ) -> Result<(), BootstrapError>;

    /// # Safety
    /// All browsers acknowledged OnBeforeClose; browser references are released,
    /// network admissions revoked and pump work cancelled. No later engine work.
    /// Do NOT unload a dynamic framework here: callers may still own Settings
    /// and other CefString values whose destructors call its free functions.
    /// Final unloading is separate, after those values are dropped.
    unsafe fn shutdown_native(&mut self) -> Result<(), BootstrapError>;
}

/// Owns the exact Unix argv bytes and the pointer array. Never reconstruct
/// subprocess arguments from a joined string, discard unknown switches, or
/// place proxy credentials in argv. Deliberately not Clone: cloning raw argv
/// pointers independently of their CStrings would make them dangle.
#[cfg(unix)]
pub struct OwnedMainArgs {
    _strings: Vec<std::ffi::CString>,
    _argv: Vec<*mut std::ffi::c_char>,
    args: cef::MainArgs,
}

#[cfg(unix)]
impl OwnedMainArgs {
    pub fn from_current_process() -> Result<Self, BootstrapError> {
        use std::os::unix::ffi::OsStrExt;
        let strings = std::env::args_os()
            .map(|arg| {
                std::ffi::CString::new(arg.as_bytes()).map_err(|_| BootstrapError::InvalidArguments)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let argc = i32::try_from(strings.len()).map_err(|_| BootstrapError::InvalidArguments)?;
        let mut argv: Vec<_> = strings.iter().map(|arg| arg.as_ptr().cast_mut()).collect();
        argv.push(std::ptr::null_mut());
        let args = cef::MainArgs {
            argc,
            argv: argv.as_mut_ptr(),
        };
        Ok(Self {
            _strings: strings,
            _argv: argv,
            args,
        })
    }

    pub fn as_main_args(&self) -> &cef::MainArgs {
        &self.args
    }
}

/// Validate settings immediately before `cef::initialize`. This does not add
/// routing preferences: the native-owned App and context handlers own those.
pub fn validate_native_settings(settings: &cef::Settings) -> Result<(), BootstrapError> {
    if settings.no_sandbox != 0 {
        return Err(BootstrapError::SandboxDisabled);
    }
    if settings.multi_threaded_message_loop != 0 || settings.external_message_pump != 1 {
        return Err(BootstrapError::InvalidMessageLoop);
    }
    if settings.windowless_rendering_enabled != 0 {
        return Err(BootstrapError::WindowlessRendering);
    }
    if settings.command_line_args_disabled != 1 {
        return Err(BootstrapError::BrowserArgumentsEnabled);
    }
    if !settings.user_agent.to_string().is_empty()
        || !settings.user_agent_product.to_string().is_empty()
    {
        return Err(BootstrapError::BrowserIdentityOverride);
    }
    Ok(())
}

/// Call only after the platform library has been loaded, before creating any
/// CEF objects. The API selection is process-global and must happen once on the
/// startup thread. The caller must keep the library loaded through shutdown.
pub fn select_pinned_api() -> Result<(), BootstrapError> {
    if cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 0).is_null() {
        return Err(BootstrapError::ApiUnavailable);
    }
    if cef::api_version() != cef::sys::CEF_API_VERSION_LAST {
        return Err(BootstrapError::ApiUnavailable);
    }
    let revision = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 2);
    if revision.is_null()
        || unsafe { CStr::from_ptr(revision) }.to_bytes() != PINNED_CEF_COMMIT_HASH
    {
        return Err(BootstrapError::RuntimeMismatch);
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessDispatch {
    Browser,
    /// Return this exact code immediately from the native entry point. Never
    /// create Tauri, initialize logging/plugins or run application services.
    Exit(i32),
}

impl ProcessDispatch {
    pub fn from_cef_exit_code(code: i32) -> Result<Self, BootstrapError> {
        match code {
            -1 => Ok(Self::Browser),
            0.. => Ok(Self::Exit(code)),
            _ => Err(BootstrapError::ProcessDispatchFailed),
        }
    }
}

/// Pure validation, shared with non-Linux tests. A fallback backend list (even
/// `x11,wayland`) is not accepted. WAYLAND_DISPLAY may remain set for XWayland.
/// This deliberately never calls set_var or guesses DISPLAY=:0.
pub fn validate_x11_environment(
    gdk_backend: Option<&OsStr>,
    display: Option<&OsStr>,
) -> Result<(), BootstrapError> {
    if gdk_backend != Some(OsStr::new("x11")) {
        return Err(BootstrapError::X11BackendRequired);
    }
    match display {
        Some(display) if !display.is_empty() && !display.as_encoded_bytes().contains(&0) => Ok(()),
        _ => Err(BootstrapError::X11DisplayRequired),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reverse_dns_names_keep_their_last_component_in_all_bundle_layouts() {
        assert_eq!(
            bundle_app_name(Path::new("com.sortofremote.ng.exe"), false),
            Some("com.sortofremote.ng")
        );
        assert_eq!(
            bundle_app_name(Path::new("com.sortofremote.ng.bin"), false),
            Some("com.sortofremote.ng")
        );
        assert_eq!(
            bundle_app_name(Path::new("com.sortofremote.ng"), true),
            Some("com.sortofremote.ng")
        );
    }

    fn native_settings() -> cef::Settings {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        cef::Settings {
            external_message_pump: 1,
            command_line_args_disabled: 1,
            ..Default::default()
        }
    }

    #[test]
    fn reject_security_and_loop_configuration_regressions() {
        assert_eq!(validate_native_settings(&native_settings()), Ok(()));
        let mut settings = native_settings();
        settings.no_sandbox = 1;
        assert_eq!(
            validate_native_settings(&settings),
            Err(BootstrapError::SandboxDisabled)
        );
        settings = native_settings();
        settings.multi_threaded_message_loop = 1;
        assert_eq!(
            validate_native_settings(&settings),
            Err(BootstrapError::InvalidMessageLoop)
        );
        settings = native_settings();
        settings.external_message_pump = 0;
        assert_eq!(
            validate_native_settings(&settings),
            Err(BootstrapError::InvalidMessageLoop)
        );
        settings = native_settings();
        settings.windowless_rendering_enabled = 1;
        assert_eq!(
            validate_native_settings(&settings),
            Err(BootstrapError::WindowlessRendering)
        );
        settings = native_settings();
        settings.command_line_args_disabled = 0;
        assert_eq!(
            validate_native_settings(&settings),
            Err(BootstrapError::BrowserArgumentsEnabled)
        );
        settings = native_settings();
        settings.user_agent = cef::CefString::from("pretend-browser");
        assert_eq!(
            validate_native_settings(&settings),
            Err(BootstrapError::BrowserIdentityOverride)
        );
        settings = native_settings();
        settings.user_agent_product = cef::CefString::from("pretend-product");
        assert_eq!(
            validate_native_settings(&settings),
            Err(BootstrapError::BrowserIdentityOverride)
        );
    }

    #[test]
    fn subprocess_exit_never_falls_through_into_app_startup() {
        assert_eq!(
            ProcessDispatch::from_cef_exit_code(-1),
            Ok(ProcessDispatch::Browser)
        );
        for code in [0, 1, 42, i32::MAX] {
            assert_eq!(
                ProcessDispatch::from_cef_exit_code(code),
                Ok(ProcessDispatch::Exit(code))
            );
        }
        assert_eq!(
            ProcessDispatch::from_cef_exit_code(-2),
            Err(BootstrapError::ProcessDispatchFailed)
        );
    }

    #[test]
    fn linux_requires_explicit_exclusive_x11_selection_and_session_display() {
        let display = Some(OsStr::new(":17.0"));
        for backend in [
            None,
            Some(""),
            Some("wayland"),
            Some("x11,wayland"),
            Some("*"),
        ] {
            assert_eq!(
                validate_x11_environment(backend.map(OsStr::new), display),
                Err(BootstrapError::X11BackendRequired)
            );
        }
        let x11 = Some(OsStr::new("x11"));
        assert_eq!(validate_x11_environment(x11, display), Ok(()));
        assert_eq!(
            validate_x11_environment(x11, None),
            Err(BootstrapError::X11DisplayRequired)
        );
        assert_eq!(
            validate_x11_environment(x11, Some(OsStr::new(""))),
            Err(BootstrapError::X11DisplayRequired)
        );
        assert_eq!(
            validate_x11_environment(x11, Some(OsStr::new(":0\0other"))),
            Err(BootstrapError::X11DisplayRequired)
        );
    }
}
