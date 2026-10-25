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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ObservationFailure {
    WrongThread,
    NotX11,
    HandleUnavailable,
    HandleMismatch,
    QueryFailed,
    InvalidAttributes,
    InvalidTrapResult,
    XError,
}
impl ObservationFailure {
    fn code(self) -> &'static str {
        match self {
            Self::WrongThread => "wrong-thread",
            Self::NotX11 => "not-x11",
            Self::HandleUnavailable => "handle-unavailable",
            Self::HandleMismatch => "handle-mismatch",
            Self::QueryFailed => "query-failed",
            Self::InvalidAttributes => "invalid-attributes",
            Self::InvalidTrapResult => "invalid-trap-result",
            Self::XError => "x-error",
        }
    }
}
fn unavailable(reason: ObservationFailure) -> serde_json::Value {
    serde_json::json!({"kind":"linux-owned-parent-x11-observation", "status":"unavailable", "reason":reason.code()})
}
#[derive(Clone, Copy)]
struct AttributeValues {
    class: i32,
    depth: i32,
    visual: Option<u64>,
    map_state: i32,
    default_depth: i32,
    default_visual: u64,
    colormap_is_default: bool,
    root_is_default: bool,
    screen_is_default: bool,
}
fn attribute_record(values: AttributeValues) -> Result<serde_json::Value, ObservationFailure> {
    let class = match values.class {
        1 => "input-output",
        2 => "input-only",
        _ => return Err(ObservationFailure::InvalidAttributes),
    };
    let map_state = match values.map_state {
        0 => "unmapped",
        1 => "unviewable",
        2 => "viewable",
        _ => return Err(ObservationFailure::InvalidAttributes),
    };
    if !(0..=64).contains(&values.depth)
        || !(1..=64).contains(&values.default_depth)
        || values.default_visual == 0
        || values.default_visual > u64::from(u32::MAX)
        || values
            .visual
            .is_some_and(|id| id == 0 || id > u64::from(u32::MAX))
        || (values.class == 1 && values.visual.is_none())
    {
        return Err(ObservationFailure::InvalidAttributes);
    }
    Ok(serde_json::json!({
        "kind":"linux-owned-parent-x11-observation", "status":"available",
        "parentClass":class,"parentDepth":values.depth,"parentVisualId":values.visual,
        "parentMapState":map_state,"defaultRootDepth":values.default_depth,
        "defaultRootVisualId":values.default_visual,
        "parentVisualIsDefault":values.visual == Some(values.default_visual),
        "parentColormapIsDefault":values.colormap_is_default,
        "parentRootIsDefault":values.root_is_default,
        "parentScreenIsDefault":values.screen_is_default,
        "gtkWindowMatchesTrustedHandle":true,
        // No child exists yet and the selected CEF GLX visual is not measured.
        "childAttributesObserved":false,
    }))
}
trait AttributeProbe {
    fn push(&mut self);
    fn query(&mut self) -> Result<AttributeValues, ObservationFailure>;
    fn pop(&mut self) -> i32;
}
struct ErrorTrap<'a, P: AttributeProbe> {
    probe: &'a mut P,
    active: bool,
}
impl<'a, P: AttributeProbe> ErrorTrap<'a, P> {
    fn new(probe: &'a mut P) -> Self {
        probe.push();
        Self {
            probe,
            active: true,
        }
    }
    fn finish(mut self) -> i32 {
        self.active = false;
        self.probe.pop()
    }
}
impl<P: AttributeProbe> Drop for ErrorTrap<'_, P> {
    fn drop(&mut self) {
        if self.active {
            self.active = false;
            self.probe.pop();
        }
    }
}
fn collect_attributes(probe: &mut impl AttributeProbe) -> serde_json::Value {
    let trap = ErrorTrap::new(probe);
    let result = trap.probe.query();
    let error = trap.finish();
    if !(0..=255).contains(&error) {
        return unavailable(ObservationFailure::InvalidTrapResult);
    }
    if error != 0 {
        let mut record = unavailable(ObservationFailure::XError);
        record["xErrorCode"] = error.into();
        return record;
    }
    result
        .and_then(attribute_record)
        .unwrap_or_else(unavailable)
}

#[cfg(target_os = "linux")]
fn observe_attributes(window: &gtk::ApplicationWindow, expected_xid: u64) -> serde_json::Value {
    use gtk::{glib::object::ObjectType, prelude::WidgetExt};
    use x11::xlib;
    if !gtk::is_initialized_main_thread() {
        return unavailable(ObservationFailure::WrongThread);
    }
    let Some(gdk_window) = window.window() else {
        return unavailable(ObservationFailure::HandleUnavailable);
    };
    let display = gdk_window.display();
    // Only a retained GTK-owned X11 object is downcast; no default connection.
    let native_display = display.as_ptr().cast::<gdk_x11_sys::GdkX11Display>();
    let native_window = gdk_window.as_ptr().cast::<gdk_x11_sys::GdkX11Window>();
    unsafe {
        if gtk::glib::gobject_ffi::g_type_check_instance_is_a(
            display.as_ptr().cast(),
            gdk_x11_sys::gdk_x11_display_get_type(),
        ) == 0
            || gtk::glib::gobject_ffi::g_type_check_instance_is_a(
                gdk_window.as_ptr().cast(),
                gdk_x11_sys::gdk_x11_window_get_type(),
            ) == 0
        {
            return unavailable(ObservationFailure::NotX11);
        }
    }
    let xid = unsafe { gdk_x11_sys::gdk_x11_window_get_xid(native_window) };
    if xid == 0 || xid != expected_xid {
        return unavailable(ObservationFailure::HandleMismatch);
    }
    let xdisplay = unsafe { gdk_x11_sys::gdk_x11_display_get_xdisplay(native_display) };
    if xdisplay.is_null() {
        return unavailable(ObservationFailure::HandleUnavailable);
    }
    struct NativeProbe {
        _display: gtk::gdk::Display,
        _window: gtk::gdk::Window,
        display: *mut gdk_x11_sys::GdkX11Display,
        xdisplay: *mut xlib::Display,
        xid: xlib::Window,
    }
    impl AttributeProbe for NativeProbe {
        fn push(&mut self) {
            unsafe { gdk_x11_sys::gdk_x11_display_error_trap_push(self.display) }
        }
        fn pop(&mut self) -> i32 {
            unsafe { gdk_x11_sys::gdk_x11_display_error_trap_pop(self.display) }
        }
        fn query(&mut self) -> Result<AttributeValues, ObservationFailure> {
            let mut attributes = std::mem::MaybeUninit::<xlib::XWindowAttributes>::zeroed();
            // This is the only server query; it flushes the owned GTK connection.
            // Xlib calls are synchronous, under the maintained outer deadline.
            if unsafe {
                xlib::XGetWindowAttributes(self.xdisplay, self.xid, attributes.as_mut_ptr())
            } <= 0
            {
                return Err(ObservationFailure::QueryFailed);
            }
            // XGetWindowAttributes initializes the generated C layout on success.
            let attributes = unsafe { attributes.assume_init() };
            if attributes.screen.is_null() {
                return Err(ObservationFailure::InvalidAttributes);
            }
            let screen = unsafe { xlib::XScreenNumberOfScreen(attributes.screen) };
            if screen < 0 || screen >= unsafe { xlib::XScreenCount(self.xdisplay) } {
                return Err(ObservationFailure::InvalidAttributes);
            }
            let default_screen = unsafe { xlib::XDefaultScreen(self.xdisplay) };
            if default_screen < 0 || default_screen >= unsafe { xlib::XScreenCount(self.xdisplay) }
            {
                return Err(ObservationFailure::InvalidAttributes);
            }
            let default_visual = unsafe { xlib::XDefaultVisual(self.xdisplay, default_screen) };
            if default_visual.is_null() {
                return Err(ObservationFailure::InvalidAttributes);
            }
            Ok(AttributeValues {
                class: attributes.class,
                depth: attributes.depth,
                visual: (!attributes.visual.is_null())
                    .then(|| unsafe { xlib::XVisualIDFromVisual(attributes.visual) }),
                map_state: attributes.map_state,
                default_depth: unsafe { xlib::XDefaultDepth(self.xdisplay, default_screen) },
                default_visual: unsafe { xlib::XVisualIDFromVisual(default_visual) },
                colormap_is_default: attributes.colormap
                    == unsafe { xlib::XDefaultColormap(self.xdisplay, default_screen) },
                root_is_default: attributes.root
                    == unsafe { xlib::XRootWindow(self.xdisplay, default_screen) },
                screen_is_default: screen == default_screen,
            })
        }
    }
    collect_attributes(&mut NativeProbe {
        _display: display,
        _window: gdk_window,
        display: native_display,
        xdisplay,
        xid,
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
    let expected_xid = match native_window.as_raw() {
        RawWindowHandle::Xlib(value)
            if value.window != 0 && u32::try_from(value.window).is_ok() =>
        {
            value.window
        }
        _ => return Err(ParentError::UnsupportedXlibWindow),
    };
    let native_display = parent
        .display_handle()
        .map_err(|_| ParentError::DisplayUnavailable)?;
    match native_display.as_raw() {
        RawDisplayHandle::Xlib(value) if value.display.is_some() && value.screen >= 0 => {}
        _ => return Err(ParentError::UnsupportedXlibDisplay),
    }
    let mut record = evidence(before, after);
    record["x11Observation"] = observe_attributes(window, expected_xid);
    Ok(record)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn attributes() -> AttributeValues {
        AttributeValues {
            class: 1,
            depth: 24,
            visual: Some(33),
            map_state: 0,
            default_depth: 24,
            default_visual: 33,
            colormap_is_default: true,
            root_is_default: true,
            screen_is_default: true,
        }
    }
    struct Probe {
        events: Vec<&'static str>,
        result: Result<AttributeValues, ObservationFailure>,
        error: i32,
        panic_query: bool,
    }
    impl AttributeProbe for Probe {
        fn push(&mut self) {
            self.events.push("push");
        }
        fn query(&mut self) -> Result<AttributeValues, ObservationFailure> {
            self.events.push("query");
            assert!(!self.panic_query, "owned mock query panic");
            self.result
        }
        fn pop(&mut self) -> i32 {
            self.events.push("pop");
            self.error
        }
    }
    fn probe() -> Probe {
        Probe {
            events: vec![],
            result: Ok(attributes()),
            error: 0,
            panic_query: false,
        }
    }
    #[test]
    fn x11_records_actual_parent_values_without_claiming_child_or_readiness() {
        let record = attribute_record(attributes()).unwrap();
        assert_eq!(record["parentClass"], "input-output");
        assert_eq!(record["parentDepth"], 24);
        assert_eq!(record["parentMapState"], "unmapped");
        assert_eq!(record["parentVisualId"], 33);
        assert_eq!(record["childAttributesObserved"], false);
        assert!(record.get("trusted").is_none() && record.get("ready").is_none());
        for name in record.as_object().unwrap().keys() {
            assert!(![
                "windowId",
                "xid",
                "display",
                "pointer",
                "origin",
                "token",
                "environment",
                "childVisualId"
            ]
            .contains(&name.as_str()));
        }
        let input_only = AttributeValues {
            class: 2,
            depth: 0,
            visual: None,
            map_state: 1,
            ..attributes()
        };
        let record = attribute_record(input_only).unwrap();
        assert_eq!(record["parentClass"], "input-only");
        assert_eq!(record["parentVisualId"], serde_json::Value::Null);
        assert_eq!(record["parentMapState"], "unviewable");
        let different = attribute_record(AttributeValues {
            visual: Some(77),
            default_depth: 16,
            map_state: 2,
            colormap_is_default: false,
            root_is_default: false,
            screen_is_default: false,
            ..attributes()
        })
        .unwrap();
        assert_eq!(different["parentDepth"], 24);
        assert_eq!(different["defaultRootDepth"], 16);
        assert_eq!(different["parentVisualIsDefault"], false);
        assert_eq!(different["parentColormapIsDefault"], false);
        assert_eq!(different["parentRootIsDefault"], false);
        assert_eq!(different["parentScreenIsDefault"], false);
        assert_eq!(different["parentMapState"], "viewable");
    }
    #[test]
    fn x11_conversion_denies_unknown_or_out_of_bounds_attributes() {
        for values in [
            AttributeValues {
                class: 0,
                ..attributes()
            },
            AttributeValues {
                class: 3,
                ..attributes()
            },
            AttributeValues {
                depth: -1,
                ..attributes()
            },
            AttributeValues {
                depth: 65,
                ..attributes()
            },
            AttributeValues {
                map_state: -1,
                ..attributes()
            },
            AttributeValues {
                map_state: 3,
                ..attributes()
            },
            AttributeValues {
                visual: Some(0),
                ..attributes()
            },
            AttributeValues {
                visual: Some(u64::from(u32::MAX) + 1),
                ..attributes()
            },
            AttributeValues {
                visual: None,
                ..attributes()
            },
            AttributeValues {
                default_depth: 0,
                ..attributes()
            },
            AttributeValues {
                default_depth: 65,
                ..attributes()
            },
            AttributeValues {
                default_visual: 0,
                ..attributes()
            },
            AttributeValues {
                default_visual: u64::from(u32::MAX) + 1,
                ..attributes()
            },
        ] {
            assert_eq!(
                attribute_record(values),
                Err(ObservationFailure::InvalidAttributes)
            );
        }
    }
    #[test]
    fn x11_probe_pushes_queries_and_pops_once_on_success_and_every_failure() {
        let mut p = probe();
        assert_eq!(collect_attributes(&mut p)["status"], "available");
        assert_eq!(p.events, ["push", "query", "pop"]);
        for reason in [
            ObservationFailure::WrongThread,
            ObservationFailure::NotX11,
            ObservationFailure::HandleUnavailable,
            ObservationFailure::HandleMismatch,
            ObservationFailure::QueryFailed,
            ObservationFailure::InvalidAttributes,
            ObservationFailure::InvalidTrapResult,
            ObservationFailure::XError,
        ] {
            let mut p = probe();
            p.result = Err(reason);
            let record = collect_attributes(&mut p);
            assert_eq!(record["status"], "unavailable");
            assert_eq!(record["reason"], reason.code());
            assert_eq!(p.events, ["push", "query", "pop"]);
        }
        for error in [-1, 3, 8, 256] {
            let mut p = probe();
            p.error = error;
            p.result = Err(ObservationFailure::QueryFailed);
            let record = collect_attributes(&mut p);
            assert_eq!(record["status"], "unavailable");
            assert_eq!(p.events, ["push", "query", "pop"]);
            if (1..=255).contains(&error) {
                assert_eq!(record["xErrorCode"], error);
            } else {
                assert!(record.get("xErrorCode").is_none());
            }
        }
        let mut p = probe();
        p.result = Ok(AttributeValues {
            depth: 65,
            ..attributes()
        });
        assert_eq!(collect_attributes(&mut p)["reason"], "invalid-attributes");
        assert_eq!(p.events, ["push", "query", "pop"]);
    }
    #[test]
    fn x11_trap_is_released_during_owned_mock_unwind() {
        let mut p = probe();
        p.panic_query = true;
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| collect_attributes(&mut p)))
                .is_err()
        );
        assert_eq!(p.events, ["push", "query", "pop"]);
    }
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
