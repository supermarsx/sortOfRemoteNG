//! Linux-only native fixture prerequisite. Realization never shows or focuses a window.
//! This module grants no browser, network, input, or runtime acceptance.
use std::{error::Error, fmt};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ParentError {
    WrongThread,
    NotHidden,
    NotRealized,
    PresentationChanged,
    WindowUnavailable,
    DisplayUnavailable,
    UnsupportedXlibWindow,
    UnsupportedXlibDisplay,
}
impl fmt::Display for ParentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::WrongThread => "Linux fixture parent: GTK main thread required",
            Self::NotHidden => "Linux fixture parent: hidden unmapped parent required",
            Self::NotRealized => "Linux fixture parent: native realization unavailable",
            Self::PresentationChanged => "Linux fixture parent: presentation changed",
            Self::WindowUnavailable => "Linux fixture parent: window handle unavailable",
            Self::DisplayUnavailable => "Linux fixture parent: display handle unavailable",
            Self::UnsupportedXlibWindow => "Linux fixture parent: trusted Xlib window required",
            Self::UnsupportedXlibDisplay => "Linux fixture parent: trusted Xlib display required",
        })
    }
}
impl Error for ParentError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Snapshot {
    realized: bool,
    visible: bool,
    mapped: bool,
}
fn before_realize(main_thread: bool, before: Snapshot) -> Result<(), ParentError> {
    if !main_thread {
        return Err(ParentError::WrongThread);
    }
    if before.visible || before.mapped {
        return Err(ParentError::NotHidden);
    }
    Ok(())
}
fn after_realize(before: Snapshot, after: Snapshot) -> Result<(), ParentError> {
    if !after.realized {
        return Err(ParentError::NotRealized);
    }
    if before.visible != after.visible || before.mapped != after.mapped {
        return Err(ParentError::PresentationChanged);
    }
    Ok(())
}
fn evidence(before: Snapshot, after: Snapshot) -> serde_json::Value {
    serde_json::json!({
        "kind":"linux-fixture-parent-readiness",
        "gtkMainThread":true,
        "realizedBefore":before.realized,"realizedAfter":after.realized,
        "visibleBefore":before.visible,"visibleAfter":after.visible,
        "mappedBefore":before.mapped,"mappedAfter":after.mapped,
        "trustedXlibWindow":true,"trustedXlibDisplay":true,
    })
}

/// Call immediately after building the trusted hidden Tao parent, before CEF init.
/// The parent and its native GTK object stay owned by the existing fixture Arc.
#[cfg(target_os = "linux")]
pub(crate) fn prepare(parent: &tao::window::Window) -> Result<serde_json::Value, ParentError> {
    use gtk::prelude::WidgetExt;
    use raw_window_handle::{HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle};
    use tao::platform::unix::WindowExtUnix;

    // Check the GTK thread before touching the GTK object. No event-loop wait,
    // mapping, visibility, activation, focus, or foreign native handle is used.
    if !gtk::is_initialized_main_thread() {
        return Err(ParentError::WrongThread);
    }
    let window = parent.gtk_window();
    let before = Snapshot {
        realized: window.is_realized(),
        visible: window.is_visible(),
        mapped: window.is_mapped(),
    };
    before_realize(true, before)?;
    window.realize();
    let after = Snapshot {
        realized: window.is_realized(),
        visible: window.is_visible(),
        mapped: window.is_mapped(),
    };
    after_realize(before, after)?;
    let native_window = parent
        .window_handle()
        .map_err(|_| ParentError::WindowUnavailable)?;
    match native_window.as_raw() {
        RawWindowHandle::Xlib(value)
            if value.window != 0 && u32::try_from(value.window).is_ok() => {}
        _ => return Err(ParentError::UnsupportedXlibWindow),
    }
    let native_display = parent
        .display_handle()
        .map_err(|_| ParentError::DisplayUnavailable)?;
    match native_display.as_raw() {
        RawDisplayHandle::Xlib(value) if value.display.is_some() && value.screen >= 0 => {}
        _ => return Err(ParentError::UnsupportedXlibDisplay),
    }
    Ok(evidence(before, after))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hidden(realized: bool) -> Snapshot {
        Snapshot {
            realized,
            visible: false,
            mapped: false,
        }
    }
    #[test]
    fn hidden_realization_and_already_realized_parent_keep_presentation() {
        for before in [hidden(false), hidden(true)] {
            before_realize(true, before).unwrap();
            after_realize(before, hidden(true)).unwrap();
        }
    }
    #[test]
    fn wrong_thread_visible_mapped_and_failed_or_presented_realization_deny() {
        assert_eq!(
            before_realize(false, hidden(false)),
            Err(ParentError::WrongThread)
        );
        for before in [
            Snapshot {
                visible: true,
                ..hidden(false)
            },
            Snapshot {
                mapped: true,
                ..hidden(false)
            },
        ] {
            assert_eq!(before_realize(true, before), Err(ParentError::NotHidden));
        }
        assert_eq!(
            after_realize(hidden(false), hidden(false)),
            Err(ParentError::NotRealized)
        );
        for after in [
            Snapshot {
                visible: true,
                ..hidden(true)
            },
            Snapshot {
                mapped: true,
                ..hidden(true)
            },
        ] {
            assert_eq!(
                after_realize(hidden(false), after),
                Err(ParentError::PresentationChanged)
            );
        }
    }
    #[test]
    fn evidence_is_only_fixed_kind_and_boolean_observations() {
        let row = evidence(hidden(false), hidden(true));
        assert_eq!(row.as_object().unwrap().len(), 10);
        for (name, value) in row.as_object().unwrap() {
            assert!(name == "kind" || value.is_boolean());
        }
        assert_eq!(row["realizedBefore"], false);
        assert_eq!(row["realizedAfter"], true);
        assert_eq!(row["visibleAfter"], false);
        assert_eq!(row["mappedAfter"], false);
    }
    #[test]
    fn errors_have_closed_messages_without_native_identifiers() {
        for error in [
            ParentError::WrongThread,
            ParentError::NotHidden,
            ParentError::NotRealized,
            ParentError::PresentationChanged,
            ParentError::WindowUnavailable,
            ParentError::DisplayUnavailable,
            ParentError::UnsupportedXlibWindow,
            ParentError::UnsupportedXlibDisplay,
        ] {
            let message = error.to_string();
            assert!(message.starts_with("Linux fixture parent: "));
            assert!(!message.contains("0x") && !message.contains("/") && !message.contains('\\'));
        }
    }
}
