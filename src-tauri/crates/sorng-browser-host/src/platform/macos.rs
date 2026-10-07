//! Borrowed AppKit parent validation and native CEF child-view descriptions.
//!
//! The companion Objective-C++ bridge augments the existing TaoApp in place;
//! it never creates or replaces NSApplication or starts another Cocoa loop.
//! It must be compiled and installed explicitly before CEF initialization.
//! A borrowed NSView alone does not establish that startup contract.

use cef::{Rect, RuntimeStyle, WindowInfo};
use raw_window_handle::{
    DisplayHandle, HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle,
    WindowHandle,
};
use std::{ffi::c_void, ptr::NonNull};

use super::bootstrap::{self, BootstrapError, OwnedMainArgs, ProcessDispatch};
use std::{
    ffi::{c_char, CString},
    marker::PhantomData,
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
    rc::Rc,
    thread::ThreadId,
};

extern "C" {
    fn sorng_cef_is_main_thread() -> bool;
    fn sorng_cef_create_helper_sandbox(
        path: *const c_char,
        argc: i32,
        argv: *mut *mut c_char,
    ) -> *mut c_void;
    fn sorng_cef_destroy_helper_sandbox(sandbox: *mut c_void);
}

fn framework_path(executable: &Path, helper: bool) -> Result<PathBuf, BootstrapError> {
    if !executable.is_absolute() || !executable.is_file() {
        return Err(BootstrapError::PlatformPrecondition(
            "macOS executable must be an existing absolute bundle path",
        ));
    }
    let parent = executable
        .parent()
        .ok_or(BootstrapError::PlatformPrecondition(
            "macOS executable has no parent",
        ))?;
    // Resolve relative to the entry's bundle path before canonicalizing: helper
    // executables can be symlinks and still need their own Frameworks ancestry.
    parent
        .join(if helper { "../../.." } else { "../Frameworks" })
        .join("Chromium Embedded Framework.framework/Chromium Embedded Framework")
        .canonicalize()
        .map_err(|_| BootstrapError::PlatformPrecondition("bundled CEF framework is missing"))
}

fn path_string(path: &Path) -> Result<CString, BootstrapError> {
    CString::new(path.as_os_str().as_bytes())
        .map_err(|_| BootstrapError::PlatformPrecondition("bundle path contains NUL"))
}

/// Library load is deliberately explicit. No Drop unload: CEF references and
/// callbacks must have drained before the native framework may be unloaded.
unsafe fn load_framework(path: &Path) -> Result<(), BootstrapError> {
    let path = path_string(path)?;
    if unsafe { cef::load_library(Some(&*path.as_ptr())) } != 1 {
        return Err(BootstrapError::PlatformPrecondition(
            "CEF framework load failed",
        ));
    }
    if let Err(error) = bootstrap::select_pinned_api() {
        cef::unload_library();
        return Err(error);
    }
    Ok(())
}

/// Browser-process provider. It loads CEF without creating NSApplication; Tao
/// must create its EventLoop before initialize_native installs the event bridge.
/// Helper processes must use MacHelperBootstrap instead, before framework load.
pub struct MacBrowserBootstrap {
    args: OwnedMainArgs,
    thread: ThreadId,
    dispatched: bool,
    browser: bool,
    initialization_attempted: bool,
    initialized: bool,
    shutdown_completed: bool,
    _ui_thread: PhantomData<Rc<()>>,
}

impl MacBrowserBootstrap {
    /// # Safety
    /// Call once in the native browser entry, before any CEF call or worker
    /// startup. The executable/framework must come from the verified app bundle.
    /// The loaded framework remains live through shutdown_native. Release all
    /// owned CEF values (including Settings strings) before explicit unloading.
    pub unsafe fn from_bundle_executable(executable: &Path) -> Result<Self, BootstrapError> {
        if !unsafe { sorng_cef_is_main_thread() } {
            return Err(BootstrapError::InvalidLifecycle);
        }
        if std::env::args_os()
            .skip(1)
            .any(|arg| arg == "--type" || arg.as_bytes().starts_with(b"--type="))
        {
            return Err(BootstrapError::PlatformPrecondition(
                "CEF child must enter the sandboxed macOS helper",
            ));
        }
        let args = OwnedMainArgs::from_current_process()?;
        unsafe {
            load_framework(&framework_path(executable, false)?)?;
        }
        Ok(Self {
            args,
            thread: std::thread::current().id(),
            dispatched: false,
            browser: false,
            initialization_attempted: false,
            initialized: false,
            shutdown_completed: false,
            _ui_thread: PhantomData,
        })
    }

    pub fn execute_process(
        &mut self,
        app: Option<&mut cef::App>,
    ) -> Result<ProcessDispatch, BootstrapError> {
        if self.thread != std::thread::current().id() || self.dispatched {
            return Err(BootstrapError::InvalidLifecycle);
        }
        self.dispatched = true;
        let result = ProcessDispatch::from_cef_exit_code(cef::execute_process(
            Some(self.args.as_main_args()),
            app,
            std::ptr::null_mut(),
        ))?;
        self.browser = result == ProcessDispatch::Browser;
        Ok(result)
    }

    /// The final native entry-point action before process termination. Merely
    /// shutting CEF down is insufficient: Settings/other CefString destructors
    /// still call the loaded framework. No automatic Drop unload is installed.
    ///
    /// # Safety
    /// Native shutdown completed and every CEF-backed value, callback and
    /// settings object has been dropped. No later CEF function may be called.
    pub unsafe fn unload_after_shutdown(self) -> Result<(), BootstrapError> {
        if self.thread != std::thread::current().id()
            || self.initialized
            || !self.shutdown_completed
        {
            return Err(BootstrapError::InvalidLifecycle);
        }
        if cef::unload_library() != 1 {
            return Err(BootstrapError::PlatformPrecondition(
                "CEF framework unload failed",
            ));
        }
        Ok(())
    }
}

impl bootstrap::RuntimeBootstrap for MacBrowserBootstrap {
    unsafe fn initialize_native(
        &mut self,
        settings: &cef::Settings,
        app: &mut cef::App,
    ) -> Result<(), BootstrapError> {
        if self.thread != std::thread::current().id()
            || !self.browser
            || self.initialization_attempted
        {
            return Err(BootstrapError::InvalidLifecycle);
        }
        bootstrap::validate_native_settings(settings)?;
        install_tao_application_bridge().map_err(|_| {
            BootstrapError::PlatformPrecondition(
                "Tao CEF application bridge could not be installed",
            )
        })?;
        self.initialization_attempted = true;
        if cef::initialize(
            Some(self.args.as_main_args()),
            Some(settings),
            Some(app),
            std::ptr::null_mut(),
        ) != 1
        {
            return Err(BootstrapError::InitializeFailed(cef::get_exit_code()));
        }
        self.initialized = true;
        Ok(())
    }

    unsafe fn shutdown_native(&mut self) -> Result<(), BootstrapError> {
        if self.thread != std::thread::current().id() || !self.initialized {
            return Err(BootstrapError::InvalidLifecycle);
        }
        check_tao_application_bridge().map_err(|_| {
            BootstrapError::PlatformPrecondition(
                "Tao CEF application bridge changed during runtime",
            )
        })?;
        cef::shutdown();
        self.initialized = false;
        self.shutdown_completed = true;
        // The caller's Settings is borrowed by initialize_native, not owned by
        // this provider. Keep its CefString free functions loaded through Drop.
        Ok(())
    }
}

/// Separate macOS helper entry. Initializes the seatbelt sandbox before loading
/// the CEF framework, as required by CEF. It never creates Tao/NSApplication.
/// The helper must dynamically load CEF after sandbox initialization and must
/// never call the browser application bridge or start application services.
pub struct MacHelperBootstrap {
    args: OwnedMainArgs,
    sandbox: NonNull<c_void>,
    thread: ThreadId,
    _ui_thread: PhantomData<Rc<()>>,
}

impl MacHelperBootstrap {
    /// # Safety
    /// Call as the first native helper startup action with the verified helper
    /// bundle executable. No CEF framework load, application code or worker
    /// startup may precede this sandbox initialization. Call execute_and_exit
    /// immediately afterwards, constructing only the required CEF App callbacks.
    pub unsafe fn from_bundle_executable(executable: &Path) -> Result<Self, BootstrapError> {
        let args = OwnedMainArgs::from_current_process()?;
        let framework = framework_path(executable, true)?;
        let sandbox_path = executable
            .parent()
            .unwrap()
            .join("../../../Chromium Embedded Framework.framework/Libraries/libcef_sandbox.dylib")
            .canonicalize()
            .map_err(|_| {
                BootstrapError::PlatformPrecondition("CEF helper sandbox library is missing")
            })?;
        let sandbox_path = path_string(&sandbox_path)?;
        let native_args = args.as_main_args();
        let sandbox = NonNull::new(unsafe {
            sorng_cef_create_helper_sandbox(
                sandbox_path.as_ptr(),
                native_args.argc,
                native_args.argv,
            )
        })
        .ok_or(BootstrapError::PlatformPrecondition(
            "CEF helper sandbox initialization failed",
        ))?;
        if let Err(error) = unsafe { load_framework(&framework) } {
            unsafe {
                sorng_cef_destroy_helper_sandbox(sandbox.as_ptr());
            }
            return Err(error);
        }
        Ok(Self {
            args,
            sandbox,
            thread: std::thread::current().id(),
            _ui_thread: PhantomData,
        })
    }

    /// Takes ownership of App so it is dropped before unloading CEF. Return the
    /// resulting code directly from helper main; never start the desktop app.
    ///
    /// # Safety
    /// App callbacks must not retain CEF objects after ExecuteProcess returns.
    pub unsafe fn execute_and_exit(self, mut app: Option<cef::App>) -> Result<i32, BootstrapError> {
        if self.thread != std::thread::current().id() {
            return Err(BootstrapError::InvalidLifecycle);
        }
        let result = cef::execute_process(
            Some(self.args.as_main_args()),
            app.as_mut(),
            std::ptr::null_mut(),
        );
        drop(app);
        let unloaded = cef::unload_library();
        unsafe {
            sorng_cef_destroy_helper_sandbox(self.sandbox.as_ptr());
        }
        if unloaded != 1 {
            return Err(BootstrapError::PlatformPrecondition(
                "CEF helper framework unload failed",
            ));
        }
        match ProcessDispatch::from_cef_exit_code(result)? {
            ProcessDispatch::Exit(code) => Ok(code),
            ProcessDispatch::Browser => Err(BootstrapError::PlatformPrecondition(
                "helper was launched without a CEF process type",
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ApplicationBridgeError {
    #[error("The CEF application bridge must be used on the AppKit main thread")]
    NotMainThread,
    #[error("The CEF host requires macOS 14 or newer")]
    UnsupportedSystem,
    #[error("Tao must create NSApplication before the CEF application bridge is installed")]
    TaoNotInitialized,
    #[error("The existing NSApplication is not the reviewed TaoApp class")]
    UnexpectedApplication,
    #[error("The reviewed Tao sendEvent implementation is unavailable")]
    MissingEventHandler,
    #[error("Another component changed or already owns the CEF application bridge")]
    ConflictingBridge,
    #[error("The CEF application protocol or event bridge could not be installed")]
    InstallationFailed,
    #[error("AppKit raised an exception while validating the CEF application bridge")]
    CocoaException,
}

extern "C" {
    fn sorng_cef_install_tao_application_bridge() -> i32;
    fn sorng_cef_check_tao_application_bridge() -> i32;
}

/// Install on the main thread after Tao creates its EventLoop, before CEF
/// initialization and native child creation. Keeps Tao's class, original
/// sendEvent handler and application delegate. The bridge stays installed for
/// the process lifetime; removing it during nested event dispatch is unsafe.
///
/// Linking requires `platform/macos_application.mm` (see BOOTSTRAP.md). This
/// function is not a stub: a missing bridge is a link error, not success.
pub fn install_tao_application_bridge() -> Result<(), ApplicationBridgeError> {
    bridge_result(unsafe { sorng_cef_install_tao_application_bridge() })
}

pub fn check_tao_application_bridge() -> Result<(), ApplicationBridgeError> {
    bridge_result(unsafe { sorng_cef_check_tao_application_bridge() })
}

fn bridge_result(code: i32) -> Result<(), ApplicationBridgeError> {
    Err(match code {
        0 => return Ok(()),
        1 => ApplicationBridgeError::NotMainThread,
        2 => ApplicationBridgeError::UnsupportedSystem,
        3 => ApplicationBridgeError::TaoNotInitialized,
        4 => ApplicationBridgeError::UnexpectedApplication,
        5 => ApplicationBridgeError::MissingEventHandler,
        6 => ApplicationBridgeError::ConflictingBridge,
        8 => ApplicationBridgeError::CocoaException,
        _ => ApplicationBridgeError::InstallationFailed,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ParentError {
    #[error("The native parent view is not currently available")]
    WindowUnavailable,
    #[error("The native parent display is not currently available")]
    DisplayUnavailable,
    #[error(
        "The browser child requires AppKit window and display handles from the trusted app window"
    )]
    UnsupportedNativeBackend,
    #[error("Child bounds must have nonnegative coordinates, positive dimensions and non-overflowing edges")]
    InvalidBounds,
}

/// A borrowed NSView from the trusted native toolkit, never an IPC pointer.
///
/// This does not retain the NSView through Objective-C or prove attachment to an
/// NSWindow. The host must keep the native owner alive and attached until the
/// browser has closed, including when the toolkit exposes explicit destruction.
pub struct NativeChildParent<'a> {
    window: WindowHandle<'a>,
    display: DisplayHandle<'a>,
}

impl<'a> NativeChildParent<'a> {
    /// Acquire the AppKit handles from the same trusted native window provider.
    ///
    /// Call on the Cocoa main thread. The borrowed AppKit handle guarantees a
    /// valid non-null NSView; no raw pointer constructor is exposed here. This
    /// function does not dispatch Cocoa messages or validate NSApplication's
    /// CEF protocol/event-pump integration.
    pub fn from_window<W>(window: &'a W) -> Result<Self, ParentError>
    where
        W: HasWindowHandle + HasDisplayHandle + ?Sized,
    {
        let native_window = window
            .window_handle()
            .map_err(|_| ParentError::WindowUnavailable)?;
        let display = window
            .display_handle()
            .map_err(|_| ParentError::DisplayUnavailable)?;
        validate_handles(native_window.as_raw(), display.as_raw())?;
        Ok(Self {
            window: native_window,
            display,
        })
    }

    /// Describe a visible Alloy native child NSView, not a popup or OSR surface.
    ///
    /// Bounds must already use CEF's platform coordinate space. Creation must
    /// happen on the Cocoa/CEF UI thread after bootstrap has passed its gates.
    /// Keep the native parent alive until the child closes: the returned CEF
    /// descriptor contains a pointer but does not retain the view or its owner.
    pub fn window_info(&self, bounds: &Rect) -> Result<WindowInfo, ParentError> {
        let parent = validate_handles(self.window.as_raw(), self.display.as_raw())?;
        validate_bounds(bounds)?;
        Ok(native_child_info(parent, bounds))
    }
}

fn validate_handles(
    window: RawWindowHandle,
    display: RawDisplayHandle,
) -> Result<NonNull<c_void>, ParentError> {
    match (window, display) {
        (RawWindowHandle::AppKit(window), RawDisplayHandle::AppKit(_)) => Ok(window.ns_view),
        _ => Err(ParentError::UnsupportedNativeBackend),
    }
}

fn validate_bounds(bounds: &Rect) -> Result<(), ParentError> {
    if bounds.x < 0
        || bounds.y < 0
        || bounds.width <= 0
        || bounds.height <= 0
        || bounds.x.checked_add(bounds.width).is_none()
        || bounds.y.checked_add(bounds.height).is_none()
    {
        return Err(ParentError::InvalidBounds);
    }
    Ok(())
}

fn native_child_info(parent: NonNull<c_void>, bounds: &Rect) -> WindowInfo {
    WindowInfo {
        runtime_style: RuntimeStyle::ALLOY,
        windowless_rendering_enabled: 0,
        ..Default::default()
    }
    .set_as_child(parent.as_ptr(), bounds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use raw_window_handle::{
        AppKitDisplayHandle, AppKitWindowHandle, XlibDisplayHandle, XlibWindowHandle,
    };

    // Raw test values are never promoted to borrowed WindowHandles or passed
    // to Cocoa/CEF creation. These tests cannot attest native view attachment.
    #[test]
    fn accepts_matching_appkit_handles() {
        let view = NonNull::<u8>::dangling().cast();
        assert_eq!(
            validate_handles(
                AppKitWindowHandle::new(view).into(),
                AppKitDisplayHandle::new().into()
            ),
            Ok(view)
        );
    }

    #[test]
    fn rejects_non_appkit_or_mixed_handles() {
        assert_eq!(
            validate_handles(
                XlibWindowHandle::new(42).into(),
                AppKitDisplayHandle::new().into()
            ),
            Err(ParentError::UnsupportedNativeBackend)
        );
        assert_eq!(
            validate_handles(
                AppKitWindowHandle::new(NonNull::<u8>::dangling().cast()).into(),
                XlibDisplayHandle::new(None, 0).into()
            ),
            Err(ParentError::UnsupportedNativeBackend)
        );
    }

    #[test]
    fn rejects_empty_negative_or_overflowing_bounds() {
        for (x, y, width, height) in [
            (0, 0, 0, 1),
            (0, 0, 1, 0),
            (0, 0, -1, 1),
            (-1, 0, 1, 1),
            (0, -1, 1, 1),
            (i32::MAX, 0, 1, 1),
            (0, i32::MAX, 1, 1),
        ] {
            assert_eq!(
                validate_bounds(&Rect {
                    x,
                    y,
                    width,
                    height
                }),
                Err(ParentError::InvalidBounds)
            );
        }
        assert_eq!(
            validate_bounds(&Rect {
                x: 0,
                y: 0,
                width: 1,
                height: 1
            }),
            Ok(())
        );
    }

    #[test]
    fn child_descriptor_preserves_parent_bounds_and_native_rendering() {
        crate::platform::test_runtime::ensure_loaded();
        let view = NonNull::<u8>::dangling().cast();
        let bounds = Rect {
            x: 10,
            y: 20,
            width: 800,
            height: 600,
        };
        let info = native_child_info(view, &bounds);
        assert_eq!(info.parent_view, view.as_ptr());
        assert!(info.view.is_null());
        assert_eq!(
            (
                info.bounds.x,
                info.bounds.y,
                info.bounds.width,
                info.bounds.height
            ),
            (bounds.x, bounds.y, bounds.width, bounds.height)
        );
        assert_eq!(info.runtime_style, RuntimeStyle::ALLOY);
        assert_eq!(info.hidden, 0);
        assert_eq!(info.windowless_rendering_enabled, 0);
    }
}
