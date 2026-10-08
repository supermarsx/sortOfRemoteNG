//! Exercise Tauri's real event router with mock windows, without launching an
//! application, WebView or CEF. Scoped listeners mirror the shell hook's explicit
//! WebviewWindow target; an Any listener is deliberately NOT an isolation fence.
use serde_json::{json, Value};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use tauri::{
    test::{mock_builder, mock_context, noop_assets, MockRuntime},
    App, Emitter, EventTarget, Listener, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

const EVENT: &str = "origin-browser-certificate-review";

struct Owners {
    _app: App<MockRuntime>,
    first: WebviewWindow<MockRuntime>,
    second: WebviewWindow<MockRuntime>,
}

impl Owners {
    fn new() -> Self {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let first = WebviewWindowBuilder::new(&app, "owner-a", WebviewUrl::default())
            .build()
            .unwrap();
        let second = WebviewWindowBuilder::new(&app, "owner-b", WebviewUrl::default())
            .build()
            .unwrap();
        Self {
            _app: app,
            first,
            second,
        }
    }
}

fn observe(window: &WebviewWindow<MockRuntime>) -> Receiver<Value> {
    let (sender, receiver) = mpsc::channel();
    // Tauri's WebviewWindow::listen registers EventTarget::WebviewWindow(label),
    // the same target used by the frontend's scoped JS listener.
    window.listen(EVENT, move |event| {
        let _ = sender.send(serde_json::from_str(event.payload()).unwrap());
    });
    receiver
}

fn notify(window: &WebviewWindow<MockRuntime>, snapshot: &Value) {
    window
        .emit_to(EventTarget::webview_window(window.label()), EVENT, snapshot)
        .unwrap();
}

fn assert_empty(receiver: &Receiver<Value>) {
    // Native listeners run synchronously on emit; no sleeps or live event loop.
    assert_eq!(receiver.try_recv(), Err(TryRecvError::Empty));
}

#[test]
fn scoped_prompts_and_dismissals_never_cross_owner_windows() {
    let owners = Owners::new();
    let first = observe(&owners.first);
    let second = observe(&owners.second);

    for (window, own, other, revision) in [
        (&owners.first, &first, &second, 1),
        (&owners.second, &second, &first, 2),
    ] {
        let snapshot = json!({
            "revision": revision,
            "prompt": {"requestId": window.label(), "origin": "https://example.test"}
        });
        notify(window, &snapshot);
        assert_eq!(own.try_recv().unwrap(), snapshot);
        assert_empty(own);
        assert_empty(other);
    }

    for (window, own, other, revision) in [
        (&owners.first, &first, &second, 3),
        (&owners.second, &second, &first, 4),
    ] {
        let dismissed = json!({"revision": revision, "prompt": null});
        notify(window, &dismissed);
        assert_eq!(own.try_recv().unwrap(), dismissed);
        assert_empty(own);
        assert_empty(other);
    }
}

#[test]
fn missing_label_and_wrong_target_kind_do_not_reach_scoped_listeners() {
    let owners = Owners::new();
    let first = observe(&owners.first);
    let second = observe(&owners.second);
    let snapshot = json!({"revision": 1, "prompt": null});
    for target in [
        EventTarget::webview_window("owner-missing"),
        EventTarget::window(owners.first.label()),
        EventTarget::webview(owners.first.label()),
    ] {
        owners.first.emit_to(target, EVENT, &snapshot).unwrap();
        assert_empty(&first);
        assert_empty(&second);
    }
    // Positive control: listeners are installed and can receive the right target.
    notify(&owners.first, &snapshot);
    assert_eq!(first.try_recv().unwrap(), snapshot);
    assert_empty(&second);
}

#[test]
fn broadcast_and_any_listeners_are_not_owner_isolation() {
    let owners = Owners::new();
    let first = observe(&owners.first);
    let second = observe(&owners.second);
    let (any_sender, any) = mpsc::channel();
    owners.first.listen_any(EVENT, move |event| {
        let _ = any_sender.send(serde_json::from_str::<Value>(event.payload()).unwrap());
    });

    let targeted = json!({"revision": 1, "prompt": {"requestId": "owner-b"}});
    notify(&owners.second, &targeted);
    assert_empty(&first);
    assert_eq!(second.try_recv().unwrap(), targeted);
    assert_eq!(any.try_recv().unwrap(), targeted);

    // Regression control: WebviewWindow::emit broadcasts despite its receiver.
    let broadcast = json!({"revision": 2, "prompt": null});
    owners.first.emit(EVENT, &broadcast).unwrap();
    assert_eq!(first.try_recv().unwrap(), broadcast);
    assert_eq!(second.try_recv().unwrap(), broadcast);
    assert_eq!(any.try_recv().unwrap(), broadcast);
}

#[test]
fn production_notifications_share_the_explicit_owner_target() {
    // The production wrapper is app-runtime-specific, so pair routing behavior
    // above with this narrow wiring guard rather than instantiate its TLS runtime.
    let source = include_str!("../../../src/origin_browser_certificate_review.rs");
    let compact: String = source.chars().filter(|c| !c.is_whitespace()).collect();
    assert!(compact
        .contains("window.emit_to(EventTarget::webview_window(window.label()),EVENT,snapshot)"));
    assert!(
        !compact.contains(".emit("),
        "do not broadcast certificate reviews"
    );
    assert_eq!(compact.matches(".emit_to(").count(), 1);
    assert_eq!(compact.matches("notify(window,&snapshot)").count(), 2);
    assert_eq!(compact.matches("notify(&self.window,&snapshot)").count(), 1);
}
