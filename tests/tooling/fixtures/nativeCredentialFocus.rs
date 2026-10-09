//! Production focus-gate tests using OS doubles; no desktop input or secrets.
use std::cell::Cell;

#[derive(Clone, Copy, PartialEq, Eq)]
struct Handle(*mut std::ffi::c_void);
fn handle(value: usize) -> Handle {
    Handle(value as *mut _)
}
#[derive(Clone, Copy)]
struct Desktop {
    foreground: Handle,
    visible: bool,
    minimized: bool,
}
thread_local! { static DESKTOP: Cell<Desktop> = const { Cell::new(Desktop {
    foreground: Handle(std::ptr::null_mut()), visible: true, minimized: false,
}) }; }
struct WebviewWindow {
    handle: Option<Handle>,
    shell_focus: Option<bool>,
}
impl WebviewWindow {
    fn hwnd(&self) -> Result<Handle, ()> {
        self.handle.ok_or(())
    }
    fn is_focused(&self) -> Result<bool, ()> {
        self.shell_focus.ok_or(())
    }
}
#[allow(non_snake_case)]
mod windows {
    pub mod Win32 {
        pub mod Foundation {
            // Tauri and the application can depend on different windows crate
            // versions. These HWND wrappers must not be treated as one type.
            #[allow(clippy::upper_case_acronyms)]
            #[derive(Clone, Copy, PartialEq, Eq)]
            pub struct HWND(pub *mut std::ffi::c_void);
        }
        pub mod UI {
            pub mod WindowsAndMessaging {
                use super::super::Foundation::HWND;
                use crate::DESKTOP;
                pub struct Bool(bool);
                impl Bool {
                    pub fn as_bool(&self) -> bool {
                        self.0
                    }
                }
                pub unsafe fn GetForegroundWindow() -> HWND {
                    DESKTOP.with(|d| HWND(d.get().foreground.0))
                }
                pub unsafe fn IsWindowVisible(_: HWND) -> Bool {
                    Bool(DESKTOP.with(|d| d.get().visible))
                }
                pub unsafe fn IsIconic(_: HWND) -> Bool {
                    Bool(DESKTOP.with(|d| d.get().minimized))
                }
            }
        }
    }
}
/* PRODUCTION_GUARDS */

fn window() -> WebviewWindow {
    DESKTOP.with(|d| {
        d.set(Desktop {
            foreground: handle(7),
            visible: true,
            minimized: false,
        })
    });
    // Native CEF child owns keyboard focus, not the shell HWND.
    WebviewWindow {
        handle: Some(handle(7)),
        shell_focus: Some(false),
    }
}
#[test]
fn foreground_native_child_does_not_need_shell_focus() {
    let w = window();
    assert!(!w.is_focused().unwrap());
    assert!(owner_window_has_focus(&w));
}
#[test]
fn another_app_window_or_process_never_passes() {
    let mut w = window();
    w.shell_focus = Some(true); // Cached shell focus must not override native truth.
    for other in [0, 8, 99] {
        DESKTOP.with(|d| {
            d.set(Desktop {
                foreground: handle(other),
                ..d.get()
            })
        });
        assert!(!owner_window_has_focus(&w));
    }
}
#[test]
fn hidden_or_minimized_owner_never_passes() {
    let w = window();
    for (visible, minimized) in [(false, false), (true, true), (false, true)] {
        DESKTOP.with(|d| {
            d.set(Desktop {
                visible,
                minimized,
                ..d.get()
            })
        });
        assert!(!owner_window_has_focus(&w));
    }
}
#[test]
fn invalid_owner_handle_is_closed() {
    let mut w = window();
    for invalid in [None, Some(handle(0))] {
        w.handle = invalid;
        assert!(!owner_window_has_focus(&w));
    }
}
#[test]
fn focus_loss_and_return_are_checked_each_time() {
    let w = window();
    assert!(owner_window_has_focus(&w));
    DESKTOP.with(|d| {
        d.set(Desktop {
            foreground: handle(8),
            ..d.get()
        })
    });
    assert!(!owner_window_has_focus(&w));
    DESKTOP.with(|d| {
        d.set(Desktop {
            foreground: handle(7),
            ..d.get()
        })
    });
    assert!(owner_window_has_focus(&w));
}
#[test]
fn other_platforms_keep_native_focus_check_and_deny_query_failure() {
    let mut w = window();
    for (focused, expected) in [(None, false), (Some(false), false), (Some(true), true)] {
        w.shell_focus = focused;
        assert_eq!(non_windows_owner_window_has_focus(&w), expected);
    }
}
