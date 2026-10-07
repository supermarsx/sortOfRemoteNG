//! Borrowed Win32 parents and the pinned CEF bootstrap sandbox lifecycle.
//! Startup validation and native descriptors do not prove traffic containment
//! or live child-process sandbox behavior; those remain acceptance gates.

pub use cef::sys::HINSTANCE as BootstrapInstance;
use cef::{Rect, RuntimeStyle, WindowInfo};
use raw_window_handle::{
    DisplayHandle, HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle,
    WindowHandle,
};
use std::num::NonZeroIsize;

use super::bootstrap::{self, BootstrapError, ProcessDispatch};
#[path = "windows_runtime_access.rs"]
mod runtime_access;
use std::{
    ffi::{c_char, c_void, CStr},
    marker::PhantomData,
    ptr::NonNull,
    rc::Rc,
    thread::ThreadId,
};

/// ABI of the pinned CEF 154 `cef_version_info_t`. The high-level and sys Rust
/// crates do not bind this bootstrap-only header. Keep in sync with the bundled
/// `include/cef_version_info.h`, including its post-15101 installer fields.
#[repr(C)]
pub struct BootstrapVersionInfo {
    pub size: usize,
    pub cef_version_major: i32,
    pub cef_version_minor: i32,
    pub cef_version_patch: i32,
    pub cef_commit_number: i32,
    pub chrome_version_major: i32,
    pub chrome_version_minor: i32,
    pub chrome_version_build: i32,
    pub chrome_version_patch: i32,
    pub sandbox_compat_hash: [c_char; 17],
    pub libcef_path: *const u16,
    pub libcef_is_bundled: i32,
    pub libcef_version_full: *const c_char,
    pub installer_error_code: i32,
    pub installer_error_message: *const c_char,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum BootstrapFailure {
    #[error("CEF startup requires the non-null sandbox pointer supplied by the CEF bootstrap EXE")]
    MissingSandbox,
    #[error("The CEF bootstrap did not supply its executable instance")]
    MissingInstance,
    #[error("The CEF bootstrap version or sandbox ABI does not match the loaded runtime")]
    BootstrapMismatch,
    #[error("The CEF bootstrap installer reported a startup failure")]
    InstallerFailed,
    #[error("Sandboxed Windows CEF must use the same bootstrap EXE for every process")]
    SeparateSubprocess,
    #[error("CEF bootstrap calls must remain on the entry thread and follow execute/initialize/shutdown order")]
    InvalidLifecycle,
    #[error("CEF initialization failed")]
    InitializeFailed,
    #[error(transparent)]
    Common(#[from] BootstrapError),
}

/// Borrowed sandbox state from RunWinMain/RunConsoleMain, never fabricated or
/// allocated in the client DLL. Not Send/Sync. Does not free bootstrap memory.
/// Shutdown is explicit because Drop cannot prove that all browsers are closed.
#[must_use]
pub struct WindowsSandboxBootstrap<'entry> {
    args: cef::MainArgs,
    sandbox: NonNull<c_void>,
    thread: ThreadId,
    browser_dispatched: bool,
    dispatch_called: bool,
    initialized: bool,
    _entry: PhantomData<&'entry mut c_void>,
    _ui_thread: PhantomData<Rc<()>>,
}

impl<'entry> WindowsSandboxBootstrap<'entry> {
    /// # Safety
    /// Call inside the pinned bootstrap's exported RunWinMain entry, outside
    /// DllMain and before any application services. Pointers must be precisely
    /// those passed by that entry. `version` must expose its size field and the
    /// indicated allocation; `sandbox` must remain valid throughout 'entry.
    /// The CEF runtime must already be loaded from the trusted application
    /// bundle. This object must not outlive the bootstrap entry invocation.
    pub unsafe fn from_entry(
        instance: cef::sys::HINSTANCE,
        sandbox: *mut c_void,
        version: *const BootstrapVersionInfo,
    ) -> Result<Self, BootstrapFailure> {
        let sandbox = NonNull::new(sandbox).ok_or(BootstrapFailure::MissingSandbox)?;
        if instance.0.is_null() {
            return Err(BootstrapFailure::MissingInstance);
        }
        if version.is_null()
            || unsafe { (*version).size } < std::mem::size_of::<BootstrapVersionInfo>()
        {
            return Err(BootstrapFailure::BootstrapMismatch);
        }
        let version = unsafe { &*version };
        if version.installer_error_code != 0 {
            return Err(BootstrapFailure::InstallerFailed);
        }
        bootstrap::select_pinned_api()?;
        validate_bootstrap_version(version)?;
        Ok(Self {
            args: cef::MainArgs { instance },
            sandbox,
            thread: std::thread::current().id(),
            browser_dispatched: false,
            dispatch_called: false,
            initialized: false,
            _entry: PhantomData,
            _ui_thread: PhantomData,
        })
    }

    /// Dispatch CEF before Tauri/plugins/thread pools. On `Exit(code)` return
    /// that code to the bootstrap immediately, including code zero.
    pub fn execute_process(
        &mut self,
        app: Option<&mut cef::App>,
    ) -> Result<ProcessDispatch, BootstrapFailure> {
        if self.thread != std::thread::current().id() || self.dispatch_called {
            return Err(BootstrapFailure::InvalidLifecycle);
        }
        self.dispatch_called = true;
        let outcome = ProcessDispatch::from_cef_exit_code(cef::execute_process(
            Some(&self.args),
            app,
            self.sandbox.as_ptr().cast(),
        ))?;
        self.browser_dispatched = outcome == ProcessDispatch::Browser;
        Ok(outcome)
    }

    /// # Safety
    /// The caller must install the native-owned App callbacks and own the UI
    /// event pump. On success it must close every browser and call shutdown on
    /// this same thread before returning from the bootstrap entry.
    pub unsafe fn initialize_browser(
        &mut self,
        settings: &cef::Settings,
        app: Option<&mut cef::App>,
    ) -> Result<(), BootstrapFailure> {
        if self.thread != std::thread::current().id()
            || !self.browser_dispatched
            || self.initialized
        {
            return Err(BootstrapFailure::InvalidLifecycle);
        }
        bootstrap::validate_native_settings(settings)?;
        if !settings.browser_subprocess_path.to_string().is_empty() {
            return Err(BootstrapFailure::SeparateSubprocess);
        }
        // Initialization can only be attempted once, even when CEF rejects it.
        self.browser_dispatched = false;
        // Only the browser dispatch reaches here. Never repair ACLs from a
        // sandbox child, change sandbox flags, or touch the profile/data root.
        let _runtime_access = runtime_access::prepare(settings)?;
        if cef::initialize(
            Some(&self.args),
            Some(settings),
            app,
            self.sandbox.as_ptr().cast(),
        ) != 1
        {
            return Err(BootstrapFailure::InitializeFailed);
        }
        self.initialized = true;
        Ok(())
    }

    /// # Safety
    /// All browsers must have acknowledged OnBeforeClose, all CEF references
    /// must be released and scheduled pump work must have been cancelled. Do
    /// not destroy the Tao parent or tear down its loop before those callbacks.
    pub unsafe fn shutdown(&mut self) -> Result<(), BootstrapFailure> {
        if self.thread != std::thread::current().id() || !self.initialized {
            return Err(BootstrapFailure::InvalidLifecycle);
        }
        cef::shutdown();
        self.initialized = false;
        Ok(())
    }
}

fn validate_bootstrap_version(version: &BootstrapVersionInfo) -> Result<(), BootstrapFailure> {
    let fields = [
        version.cef_version_major,
        version.cef_version_minor,
        version.cef_version_patch,
        version.cef_commit_number,
        version.chrome_version_major,
        version.chrome_version_minor,
        version.chrome_version_build,
        version.chrome_version_patch,
    ];
    if fields
        != [
            cef::sys::CEF_VERSION_MAJOR,
            cef::sys::CEF_VERSION_MINOR,
            cef::sys::CEF_VERSION_PATCH,
            bootstrap::PINNED_CEF_COMMIT_NUMBER,
            cef::sys::CHROME_VERSION_MAJOR,
            cef::sys::CHROME_VERSION_MINOR,
            cef::sys::CHROME_VERSION_BUILD,
            cef::sys::CHROME_VERSION_PATCH,
        ]
    {
        return Err(BootstrapFailure::BootstrapMismatch);
    }
    let hash = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 3);
    let supplied: Vec<u8> = version
        .sandbox_compat_hash
        .iter()
        .map(|c| *c as u8)
        .collect();
    let supplied =
        CStr::from_bytes_with_nul(&supplied).map_err(|_| BootstrapFailure::BootstrapMismatch)?;
    if hash.is_null()
        || unsafe { CStr::from_ptr(hash) } != supplied
        || supplied.to_bytes().len() != 16
    {
        return Err(BootstrapFailure::BootstrapMismatch);
    }
    Ok(())
}

impl bootstrap::RuntimeBootstrap for WindowsSandboxBootstrap<'_> {
    unsafe fn initialize_native(
        &mut self,
        settings: &cef::Settings,
        app: &mut cef::App,
    ) -> Result<(), BootstrapError> {
        unsafe { self.initialize_browser(settings, Some(app)) }.map_err(runtime_error)
    }

    unsafe fn shutdown_native(&mut self) -> Result<(), BootstrapError> {
        unsafe { self.shutdown() }.map_err(runtime_error)
    }
}

fn runtime_error(error: BootstrapFailure) -> BootstrapError {
    match error {
        BootstrapFailure::Common(error) => error,
        BootstrapFailure::InvalidLifecycle => BootstrapError::InvalidLifecycle,
        BootstrapFailure::InitializeFailed => {
            BootstrapError::InitializeFailed(cef::get_exit_code())
        }
        BootstrapFailure::SeparateSubprocess => {
            BootstrapError::PlatformPrecondition("Windows subprocess path must be empty")
        }
        _ => BootstrapError::PlatformPrecondition(
            "Windows bootstrap sandbox/version validation failed",
        ),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ParentError {
    #[error("The native parent window is not currently available")]
    WindowUnavailable,
    #[error("The native parent display is not currently available")]
    DisplayUnavailable,
    #[error("The browser child requires Win32 window and Windows display handles from the trusted app window")]
    UnsupportedNativeBackend,
    #[error("Child bounds must have nonnegative coordinates, positive dimensions and non-overflowing edges")]
    InvalidBounds,
}

/// Keep the toolkit parent alive until CEF completes child closure. Borrowing
/// guards Rust lifetime, not explicit toolkit destruction of a live window.
pub struct NativeChildParent<'a> {
    window: WindowHandle<'a>,
    display: DisplayHandle<'a>,
}

impl<'a> NativeChildParent<'a> {
    /// Obtain matching handles from the trusted native window on its UI thread.
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

    /// Bounds are already in CEF's native coordinate space; no implicit DPI
    /// conversion. The returned raw descriptor does not retain its HWND owner.
    pub fn window_info(&self, bounds: &Rect) -> Result<WindowInfo, ParentError> {
        let parent = validate_handles(self.window.as_raw(), self.display.as_raw())?;
        validate_bounds(bounds)?;
        Ok(native_child_info(parent, bounds))
    }
}

fn validate_handles(
    window: RawWindowHandle,
    display: RawDisplayHandle,
) -> Result<NonZeroIsize, ParentError> {
    match (window, display) {
        (RawWindowHandle::Win32(window), RawDisplayHandle::Windows(_)) => Ok(window.hwnd),
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

fn native_child_info(parent: NonZeroIsize, bounds: &Rect) -> WindowInfo {
    WindowInfo {
        runtime_style: RuntimeStyle::ALLOY,
        windowless_rendering_enabled: 0,
        ..Default::default()
    }
    .set_as_child(
        cef::sys::HWND(parent.get() as *mut cef::sys::HWND__),
        bounds,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use raw_window_handle::{
        Win32WindowHandle, WindowsDisplayHandle, XlibDisplayHandle, XlibWindowHandle,
    };

    #[test]
    fn rejects_missing_bootstrap_before_calling_cef() {
        assert!(matches!(
            unsafe {
                WindowsSandboxBootstrap::from_entry(
                    cef::sys::HINSTANCE::default(),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                )
            },
            Err(BootstrapFailure::MissingSandbox)
        ));
    }

    #[test]
    fn loaded_runtime_matches_pinned_revision_and_api() {
        bootstrap::select_pinned_api().unwrap();
    }

    #[test]
    fn bootstrap_version_abi_matches_pinned_native_header() {
        // Also checked against CEF's C++ definition by windows_bootstrap_abi.cc.
        #[cfg(target_pointer_width = "64")]
        {
            assert_eq!(std::mem::size_of::<BootstrapVersionInfo>(), 104);
            assert_eq!(
                std::mem::offset_of!(BootstrapVersionInfo, sandbox_compat_hash),
                40
            );
            assert_eq!(std::mem::offset_of!(BootstrapVersionInfo, libcef_path), 64);
            assert_eq!(
                std::mem::offset_of!(BootstrapVersionInfo, installer_error_message),
                96
            );
        }
        #[cfg(target_pointer_width = "32")]
        {
            assert_eq!(std::mem::size_of::<BootstrapVersionInfo>(), 76);
            assert_eq!(
                std::mem::offset_of!(BootstrapVersionInfo, sandbox_compat_hash),
                36
            );
            assert_eq!(std::mem::offset_of!(BootstrapVersionInfo, libcef_path), 56);
            assert_eq!(
                std::mem::offset_of!(BootstrapVersionInfo, installer_error_message),
                72
            );
        }
    }

    #[test]
    fn rejects_bootstrap_from_a_different_revision() {
        let version = BootstrapVersionInfo {
            size: std::mem::size_of::<BootstrapVersionInfo>(),
            cef_version_major: 153,
            cef_version_minor: 0,
            cef_version_patch: 32,
            cef_commit_number: bootstrap::PINNED_CEF_COMMIT_NUMBER,
            chrome_version_major: 154,
            chrome_version_minor: 0,
            chrome_version_build: 8037,
            chrome_version_patch: 58,
            sandbox_compat_hash: [0; 17],
            libcef_path: std::ptr::null(),
            libcef_is_bundled: 0,
            libcef_version_full: std::ptr::null(),
            installer_error_code: 0,
            installer_error_message: std::ptr::null(),
        };
        assert_eq!(
            validate_bootstrap_version(&version),
            Err(BootstrapFailure::BootstrapMismatch)
        );
    }

    // Synthetic handles only validate descriptors: never sent to window APIs.
    #[test]
    fn requires_matching_native_handles() {
        let parent = NonZeroIsize::new(1234).unwrap();
        assert_eq!(
            validate_handles(
                Win32WindowHandle::new(parent).into(),
                WindowsDisplayHandle::new().into()
            ),
            Ok(parent)
        );
        assert_eq!(
            validate_handles(
                Win32WindowHandle::new(parent).into(),
                XlibDisplayHandle::new(None, 0).into()
            ),
            Err(ParentError::UnsupportedNativeBackend)
        );
        assert_eq!(
            validate_handles(
                XlibWindowHandle::new(1234).into(),
                WindowsDisplayHandle::new().into()
            ),
            Err(ParentError::UnsupportedNativeBackend)
        );
    }

    #[test]
    fn rejects_invalid_geometry() {
        for (x, y, width, height) in [
            (-1, 0, 100, 100),
            (0, -1, 100, 100),
            (0, 0, 0, 100),
            (0, 0, 100, 0),
            (i32::MAX, 0, 2, 1),
            (0, i32::MAX, 1, 2),
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
        assert!(validate_bounds(&Rect {
            x: 0,
            y: 50,
            width: 1280,
            height: 720
        })
        .is_ok());
    }

    #[test]
    fn describes_native_child_not_popup_or_offscreen() {
        let bounds = Rect {
            x: 10,
            y: 20,
            width: 800,
            height: 600,
        };
        let parent = NonZeroIsize::new(1234).unwrap();
        let info = native_child_info(parent, &bounds);
        assert_eq!(info.parent_window.0, parent.get() as *mut cef::sys::HWND__);
        assert_eq!(info.windowless_rendering_enabled, 0);
        assert_eq!(info.runtime_style, RuntimeStyle::ALLOY);
        assert_eq!(
            (
                info.bounds.x,
                info.bounds.y,
                info.bounds.width,
                info.bounds.height
            ),
            (10, 20, 800, 600)
        );
        assert_ne!(info.style & 0x40000000, 0); // WS_CHILD
    }
}
