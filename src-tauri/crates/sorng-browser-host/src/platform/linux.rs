//! Native X11/XWayland child-window descriptions for the optional CEF host.
//!
//! Obtain the parent from the trusted toolkit on its UI thread. An X11-looking
//! integer or the presence of `DISPLAY` is not a native-window capability. This
//! adapter requires borrowed toolkit handles and checks their actual backend.
//! It neither changes environment variables nor attempts to convert an already
//! initialized Wayland GTK application to X11.
//!
//! Bootstrap still owns CEF initialization, matching the toolkit and CEF X11
//! display, event pumping, parent destruction coordination and containment gates.
//! These constructors do not query the X server or establish production readiness.

use cef::{Rect, RuntimeStyle, WindowInfo};
use raw_window_handle::{
    DisplayHandle, HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle,
    WindowHandle,
};
use std::os::raw::c_ulong;

use super::bootstrap::{
    self, validate_x11_environment, BootstrapError, OwnedMainArgs, ProcessDispatch,
};
use std::{
    ffi::{c_char, c_void, CStr, OsString},
    marker::PhantomData,
    os::unix::ffi::OsStrExt,
    rc::Rc,
    thread::ThreadId,
};

#[link(name = "X11")]
extern "C" {
    fn XInitThreads() -> i32;
    fn XDisplayString(display: *mut c_void) -> *const c_char;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum X11BootstrapError {
    #[error(transparent)]
    Environment(#[from] BootstrapError),
    #[error("X11 bootstrap must run on the initial thread before worker threads or toolkit initialization")]
    TooLate,
    #[error("Could not verify Linux process/thread startup state")]
    ThreadStateUnavailable,
    #[error("Xlib thread support could not be initialized")]
    XlibInitializationFailed,
    #[error("The startup X11 environment changed after validation")]
    EnvironmentChanged,
    #[error("The toolkit display does not match the X11 display selected at startup")]
    DisplayMismatch,
    #[error(transparent)]
    Parent(#[from] ParentError),
}

/// Evidence that the launcher selected X11 before toolkit/CEF initialization.
/// This is not evidence of a reachable X server or of network containment.
/// Not Send/Sync; use on the initial UI thread throughout the runtime lifetime.
pub struct X11Bootstrap {
    display: OsString,
    thread: ThreadId,
    args: OwnedMainArgs,
    dispatched: bool,
    browser: bool,
    initialization_attempted: bool,
    initialized: bool,
    _ui_thread: PhantomData<Rc<()>>,
}

impl X11Bootstrap {
    /// # Safety
    /// Call in the browser process at native entry, before any Xlib/GTK call
    /// and before creating threads. Checking /proc also rejects an obviously
    /// late invocation, but cannot prove that an earlier thread never existed.
    /// The launcher must already have supplied GDK_BACKEND=x11. No environment
    /// mutation, toolkit backend fallback, or system configuration is performed.
    pub unsafe fn prepare_before_threads() -> Result<Self, X11BootstrapError> {
        let backend = std::env::var_os("GDK_BACKEND");
        let display = std::env::var_os("DISPLAY");
        validate_x11_environment(backend.as_deref(), display.as_deref())?;
        let current = std::fs::read_link("/proc/thread-self")
            .map_err(|_| X11BootstrapError::ThreadStateUnavailable)?;
        let process = std::process::id().to_string();
        if current.file_name() != Some(std::ffi::OsStr::new(&process)) {
            return Err(X11BootstrapError::TooLate);
        }
        let tasks = std::fs::read_dir("/proc/self/task")
            .map_err(|_| X11BootstrapError::ThreadStateUnavailable)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| X11BootstrapError::ThreadStateUnavailable)?;
        if tasks.len() != 1 {
            return Err(X11BootstrapError::TooLate);
        }
        if unsafe { XInitThreads() } == 0 {
            return Err(X11BootstrapError::XlibInitializationFailed);
        }
        bootstrap::select_pinned_api()?;
        Ok(Self {
            display: display.ok_or(BootstrapError::X11DisplayRequired)?,
            thread: std::thread::current().id(),
            args: OwnedMainArgs::from_current_process()?,
            dispatched: false,
            browser: false,
            initialization_attempted: false,
            initialized: false,
            _ui_thread: PhantomData,
        })
    }

    /// Dispatch before GTK or application services. Return an Exit code from
    /// native main immediately; do not continue into the browser entry path.
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

    /// Recheck before CEF initialization/child creation. GTK's actual backend
    /// is checked separately by the borrowed native parent contract below.
    pub fn validate_environment(&self) -> Result<(), X11BootstrapError> {
        if self.thread != std::thread::current().id() {
            return Err(X11BootstrapError::TooLate);
        }
        if std::env::var_os("GDK_BACKEND").as_deref() != Some(std::ffi::OsStr::new("x11"))
            || std::env::var_os("DISPLAY").as_ref() != Some(&self.display)
        {
            return Err(X11BootstrapError::EnvironmentChanged);
        }
        Ok(())
    }

    /// Match the real toolkit Xlib display to the startup selection. The
    /// native owner must remain alive until CEF has closed all child windows.
    pub fn parent<'a, W>(&self, window: &'a W) -> Result<NativeChildParent<'a>, X11BootstrapError>
    where
        W: HasWindowHandle + HasDisplayHandle + ?Sized,
    {
        self.validate_environment()?;
        let parent = NativeChildParent::from_window(window)?;
        let RawDisplayHandle::Xlib(display) = parent.display.as_raw() else {
            return Err(ParentError::UnsupportedNativeBackend.into());
        };
        let display = display.display.ok_or(ParentError::MissingDisplay)?;
        let name = unsafe { XDisplayString(display.as_ptr()) };
        if name.is_null() || unsafe { CStr::from_ptr(name) }.to_bytes() != self.display.as_bytes() {
            return Err(X11BootstrapError::DisplayMismatch);
        }
        Ok(parent)
    }
}

impl bootstrap::RuntimeBootstrap for X11Bootstrap {
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
        self.validate_environment().map_err(|_| {
            BootstrapError::PlatformPrecondition("X11 environment changed after startup")
        })?;
        bootstrap::validate_native_settings(settings)?;
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
        cef::shutdown();
        self.initialized = false;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ParentError {
    #[error("The native parent window is not currently available")]
    WindowUnavailable,
    #[error("The native parent display is not currently available")]
    DisplayUnavailable,
    #[error("Native Wayland embedding is unavailable; start the application using X11/XWayland before toolkit initialization")]
    WaylandUnsupported,
    #[error("The browser child requires matching Xlib window and display handles from the trusted app window")]
    UnsupportedNativeBackend,
    #[error("The X11 parent window ID must be nonzero and fit an X11 resource ID")]
    InvalidWindow,
    #[error("An explicit live Xlib display is required; the default display is not inferred")]
    MissingDisplay,
    #[error("The X11 screen index must not be negative")]
    InvalidScreen,
    #[error("Child bounds must have nonnegative coordinates, positive dimensions and non-overflowing edges")]
    InvalidBounds,
}

/// A borrowed native parent, not a renderer-supplied window identifier.
///
/// The underlying window must remain alive until CEF has finished closing its
/// child. A Rust borrow alone does not prevent a toolkit's explicit destroy
/// operation; the host lifecycle must coordinate that operation.
pub struct NativeChildParent<'a> {
    window: WindowHandle<'a>,
    display: DisplayHandle<'a>,
}

impl<'a> NativeChildParent<'a> {
    /// Acquire both handles from the same trusted native window provider.
    ///
    /// Call on the toolkit UI thread. This checks the handle contract, not X
    /// server ownership, CEF's selected display or whether a window has since
    /// been explicitly destroyed. No raw-integer constructor is exposed.
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

    /// Describe an Alloy native child; this never creates a popup or OSR view.
    ///
    /// Bounds are already in CEF's platform coordinate space; this adapter does
    /// not guess a DPI conversion. Keep this parent and its native owner alive
    /// throughout child creation and until the child has closed. The returned
    /// CEF descriptor contains raw handles and does not itself retain the parent.
    pub fn window_info(&self, bounds: &Rect) -> Result<WindowInfo, ParentError> {
        let parent = validate_handles(self.window.as_raw(), self.display.as_raw())?;
        validate_bounds(bounds)?;
        Ok(native_child_info(parent, bounds))
    }
}

fn validate_handles(
    window: RawWindowHandle,
    display: RawDisplayHandle,
) -> Result<c_ulong, ParentError> {
    if matches!(window, RawWindowHandle::Wayland(_))
        || matches!(display, RawDisplayHandle::Wayland(_))
    {
        return Err(ParentError::WaylandUnsupported);
    }
    let (RawWindowHandle::Xlib(window), RawDisplayHandle::Xlib(display)) = (window, display) else {
        return Err(ParentError::UnsupportedNativeBackend);
    };
    if window.window == 0 || u32::try_from(window.window).is_err() {
        return Err(ParentError::InvalidWindow);
    }
    if display.display.is_none() {
        return Err(ParentError::MissingDisplay);
    }
    if display.screen < 0 {
        return Err(ParentError::InvalidScreen);
    }
    Ok(window.window)
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

fn native_child_info(parent: c_ulong, bounds: &Rect) -> WindowInfo {
    WindowInfo {
        runtime_style: RuntimeStyle::ALLOY,
        windowless_rendering_enabled: 0,
        ..Default::default()
    }
    .set_as_child(parent, bounds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use raw_window_handle::{
        AppKitDisplayHandle, WaylandDisplayHandle, WaylandWindowHandle, XlibDisplayHandle,
        XlibWindowHandle,
    };
    use std::ptr::NonNull;

    // Raw values below exercise only structural validation. They are never
    // promoted to borrowed handles, dereferenced, or passed to native CEF/Xlib.
    fn xlib_display() -> RawDisplayHandle {
        XlibDisplayHandle::new(Some(NonNull::<u8>::dangling().cast()), 0).into()
    }

    #[test]
    fn accepts_explicit_xlib_parent_and_display() {
        assert_eq!(
            validate_handles(XlibWindowHandle::new(42).into(), xlib_display()),
            Ok(42)
        );
    }

    #[cfg(target_pointer_width = "64")]
    #[test]
    fn rejects_out_of_range_x11_resource_id() {
        assert_eq!(
            validate_handles(
                XlibWindowHandle::new(u64::from(u32::MAX) + 1).into(),
                xlib_display()
            ),
            Err(ParentError::InvalidWindow)
        );
    }

    #[test]
    fn rejects_missing_x11_capabilities() {
        assert_eq!(
            validate_handles(XlibWindowHandle::new(0).into(), xlib_display()),
            Err(ParentError::InvalidWindow)
        );
        assert_eq!(
            validate_handles(
                XlibWindowHandle::new(42).into(),
                XlibDisplayHandle::new(None, 0).into()
            ),
            Err(ParentError::MissingDisplay)
        );
        assert_eq!(
            validate_handles(
                XlibWindowHandle::new(42).into(),
                XlibDisplayHandle::new(Some(NonNull::<u8>::dangling().cast()), -1).into()
            ),
            Err(ParentError::InvalidScreen)
        );
    }

    #[test]
    fn rejects_backend_mismatches_and_wayland_in_either_handle() {
        assert_eq!(
            validate_handles(
                XlibWindowHandle::new(42).into(),
                AppKitDisplayHandle::new().into()
            ),
            Err(ParentError::UnsupportedNativeBackend)
        );
        assert_eq!(
            validate_handles(
                WaylandWindowHandle::new(NonNull::<u8>::dangling().cast()).into(),
                xlib_display()
            ),
            Err(ParentError::WaylandUnsupported)
        );
        assert_eq!(
            validate_handles(
                XlibWindowHandle::new(42).into(),
                WaylandDisplayHandle::new(NonNull::<u8>::dangling().cast()).into()
            ),
            Err(ParentError::WaylandUnsupported)
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
    fn child_descriptor_keeps_bounds_and_never_selects_osr() {
        let bounds = Rect {
            x: 10,
            y: 20,
            width: 800,
            height: 600,
        };
        let info = native_child_info(42, &bounds);
        assert_eq!(info.parent_window, 42);
        assert_eq!(info.window, 0);
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
        assert_eq!(info.windowless_rendering_enabled, 0);
    }
}
