use serde_json::json;
use sorng_browser_host::ipc::{validate_find_request_id, OriginBrowserAction};

const ID: &str = "10000000-0000-4000-8000-000000000001";
fn action() -> serde_json::Value {
    json!({ "kind":"find", "text":"needle", "forward":true, "matchCase":false,
        "findNext":false, "presentationRevision":1, "requestId": ID })
}

#[test]
fn uuid_survives_decode_validate_and_reserialization() {
    let value = action();
    let request: OriginBrowserAction = serde_json::from_value(value.clone()).unwrap();
    request.validate().unwrap();
    assert_eq!(serde_json::to_value(request).unwrap(), value);
}

#[test]
fn malformed_or_oversized_correlation_is_rejected_at_decode() {
    for value in [
        json!(""),
        json!("secret-query"),
        json!("a".repeat(10_000)),
        json!(4),
        json!("10000000-0000-4000-8000-00000000000z"),
    ] {
        let mut request = action();
        request["requestId"] = value;
        assert!(serde_json::from_value::<OriginBrowserAction>(request).is_err());
    }
    assert!(validate_find_request_id(ID).is_ok());
    assert!(validate_find_request_id("invalid").is_err());
}

#[test]
fn legacy_find_and_stop_find_remain_compatible() {
    let mut request = action();
    request.as_object_mut().unwrap().remove("requestId");
    let decoded: OriginBrowserAction = serde_json::from_value(request.clone()).unwrap();
    decoded.validate().unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), request);
    let stop: OriginBrowserAction = serde_json::from_value(json!({
        "kind":"stop-find", "clearSelection":true, "presentationRevision":1,
    }))
    .unwrap();
    stop.validate().unwrap();
}

#[test]
fn token_does_not_bypass_text_or_presentation_validation() {
    let mut request = action();
    request["presentationRevision"] = json!(0);
    assert!(serde_json::from_value::<OriginBrowserAction>(request)
        .unwrap()
        .validate()
        .is_err());
    let mut request = action();
    request["text"] = json!("");
    assert!(serde_json::from_value::<OriginBrowserAction>(request)
        .unwrap()
        .validate()
        .is_err());
}

#[test]
fn both_runtime_routes_use_owner_scoped_native_feedback() {
    let root = include_str!("../../../src/origin_browser_runtime.rs");
    let popup = include_str!("../../../src/origin_browser_popup_runtime.rs");
    let bridge = include_str!("../../../src/origin_browser_find.rs");
    assert!(root.contains("find::start(view, &view.host, None, request_id.as_deref()"));
    assert!(popup.contains("find::start(view, host, target, request_id.as_deref()"));
    assert!(bridge.contains("Arc::downgrade(&view.attempt)"));
    assert!(bridge.contains("!attempt.current()"));
    assert!(bridge.contains("EventTarget::webview_window(window.label())"));
    assert!(bridge.contains("host.find_with_results("));
    assert!(!bridge.contains("UI.with("));
    assert!(!bridge.contains(".emit("));
}
