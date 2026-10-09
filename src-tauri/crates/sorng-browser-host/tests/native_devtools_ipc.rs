use serde_json::json;
use sorng_browser_host::ipc::OriginBrowserAction;

#[test]
fn inspector_requires_a_current_presentation_and_accepts_no_extra_authority() {
    let value = json!({ "kind": "devtools", "presentationRevision": 9 });
    let request: OriginBrowserAction = serde_json::from_value(value.clone()).unwrap();
    request.validate().unwrap();
    assert_eq!(serde_json::to_value(request).unwrap(), value);
    for revision in [0, 9_007_199_254_740_992, u64::MAX] {
        let request: OriginBrowserAction = serde_json::from_value(json!({
            "kind": "devtools", "presentationRevision": revision,
        }))
        .unwrap();
        assert!(request.validate().is_err());
    }
    assert!(serde_json::from_value::<OriginBrowserAction>(json!({"kind": "devtools"})).is_err());
    for key in [
        "url",
        "script",
        "port",
        "remoteDebuggingPort",
        "browserId",
        "method",
        "params",
    ] {
        let mut forged = value.clone();
        forged[key] = json!("untrusted");
        assert!(
            serde_json::from_value::<OriginBrowserAction>(forged).is_err(),
            "{key}"
        );
    }
}

#[test]
fn inspector_uses_native_window_and_isolated_client_without_remote_debugging() {
    let inspector = include_str!("../src/cef_devtools.rs");
    assert!(inspector.contains("self.check(identity)?"));
    assert!(inspector.contains("self.shared.focus_allowed(Some(&browser))"));
    assert!(inspector.contains("host.show_dev_tools("));
    assert!(inspector.contains("*extra_info = None"));
    assert!(inspector.contains("*use_default_window = 1"));
    assert!(inspector.contains("bundled_document(&url)"));
    assert!(inspector.contains("inspector_resource(&CefString::from(&request.url()).to_string())"));
    assert!(inspector.contains("InspectorResources::new(self.owner.clone())"));
    assert!(inspector.contains(".arm(&self.shared, Instant::now())?"));
    assert!(inspector.contains("owner.current()"));
    assert!(!inspector.contains("execute_java_script"));
    assert!(!inspector.contains("NativeClient::new"));
    assert!(!inspector.contains("NativeLife::new"));
    let runtime = include_str!("../src/cef_runtime.rs");
    assert!(runtime.contains("remote_debugging_port: 0"));
    let browser = include_str!("../src/cef_browser.rs");
    assert!(browser.matches("host.close_dev_tools();").count() >= 3);
}

#[test]
fn inspector_bootstrap_is_private_context_scoped_and_precedes_website_admission() {
    let context = include_str!("../src/cef_context.rs");
    let gate = context.find("self.preparation.inspector_bootstrap.handler(").unwrap();
    let website = context.find("crate::cef_requests::context_resource_handler(").unwrap();
    assert!(gate < website);
    assert!(context.contains("&self.preparation.session, &self.preparation.identity"));
    assert!(context.contains("browser.is_none(), frame.is_none(), request.as_deref()"));
    let browser = include_str!("../src/cef_browser.rs");
    assert!(browser.contains("inspector_bootstrap: context.inspector_bootstrap()"));
    let popups = include_str!("../src/cef_popups.rs");
    assert!(popups.contains("inspector_bootstrap: source.inspector_bootstrap.clone()"));
}

#[test]
fn root_and_popup_dispatch_recheck_owner_and_presentation() {
    let root = include_str!("../../../src/origin_browser_runtime.rs");
    let popup = include_str!("../../../src/origin_browser_popup_runtime.rs");
    assert!(root.contains("view.host.open_devtools(id)"));
    assert!(root.contains("if result.is_ok() || is_devtools"));
    assert!(
        popup.contains("if presentation_revision == view.presentation => host.open_devtools(id)")
    );
    // DevTools joins the saved-authority recheck lists in both trusted routes.
    for route in [root, popup] {
        assert!(route.contains("| OriginBrowserAction::Devtools { .. }"));
        assert!(route.contains(".recheck(&window, state)"));
    }
}
