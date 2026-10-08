//! Compile the new modules without requiring changes to shared lib.rs.
pub use sorng_browser_host::{ipc, native_automation};
#[path = "../src/native_extensions.rs"]
mod native_extensions;
#[path = "../../../src/origin_browser_extensions.rs"]
mod saved_extensions;

use native_automation::{
    NativeAutomationAction as Action, NativeAutomationFailure as Failure,
    NativeAutomationPermissions as Permissions,
};
use native_extensions::{NativeBrowserExtensionRequest, NativeExtensionGate};
use serde_json::json;
use sorng_protocols::origin_browser::{BrowserIdentity, OriginBrowserPolicy};

fn owner(database: &str, connection: &str, tab: &str) -> BrowserIdentity {
    OriginBrowserPolicy::new(database, connection, tab, "https://example.test")
        .unwrap()
        .identity()
        .clone()
}
fn script() -> Action {
    Action::Script {
        document_token: "receipt".into(),
        origin: "https://example.test".into(),
        request_id: "run-1".into(),
        code: "document.title = 'owned';".into(),
    }
}
fn cancel() -> Action {
    Action::Cancel {
        document_token: "receipt".into(),
        origin: "https://example.test".into(),
        request_id: "cancel-1".into(),
    }
}

#[test]
fn receipt_request_accepts_valid_native_identity_without_preference_grants() {
    let identity = owner("database", "connection", "tab");
    let request: NativeBrowserExtensionRequest = serde_json::from_value(json!({
        "identity": ipc::OriginBrowserIdentity::from_native(&identity)
    }))
    .unwrap();
    assert!(request.validate().is_ok());
    assert!(request.identity.validate_matches(&identity).is_ok());
}

#[test]
fn receipt_request_rejects_invalid_owner_and_attempt() {
    let identity = owner("database", "connection", "tab");
    for field in ["ownerDatabaseId", "connectionId", "sessionId", "attemptId"] {
        let mut payload = json!({"identity": ipc::OriginBrowserIdentity::from_native(&identity)});
        payload["identity"][field] = json!("");
        let request: NativeBrowserExtensionRequest = serde_json::from_value(payload).unwrap();
        assert!(request.validate().is_err(), "empty {field} must be invalid");
    }
    let mut request = NativeBrowserExtensionRequest {
        identity: ipc::OriginBrowserIdentity::from_native(&identity),
    };
    for invalid in ["not-a-uuid", "00000000-0000-0000-0000-000000000000"] {
        request.identity.attempt_id = invalid.into();
        assert!(request.validate().is_err());
    }
    request.identity = ipc::OriginBrowserIdentity::from_native(&identity);
    request.identity.owner_database_id.clear();
    assert!(request.validate().is_err());
    assert!(serde_json::from_value::<NativeBrowserExtensionRequest>(json!({})).is_err());
}

#[test]
fn receipt_request_rejects_unknown_fields_and_renderer_capability_grants() {
    let identity = owner("database", "connection", "tab");
    for field in [
        "appEnabled",
        "appControls",
        "forcedDark",
        "websiteExtensionsEnabled",
        "unexpected",
    ] {
        let mut payload = json!({"identity": ipc::OriginBrowserIdentity::from_native(&identity)});
        payload[field] = json!(true);
        assert!(serde_json::from_value::<NativeBrowserExtensionRequest>(payload).is_err());
    }
    let mut payload = json!({"identity": ipc::OriginBrowserIdentity::from_native(&identity)});
    payload["identity"]["unexpected"] = json!(true);
    assert!(serde_json::from_value::<NativeBrowserExtensionRequest>(payload).is_err());
}

#[test]
fn off_blocks_credential_delivery_scripts_and_macros_but_keeps_cleanup() {
    let identity = owner("database", "connection", "tab");
    let gate = NativeExtensionGate::new(identity.clone(), false);
    let allowed = Permissions {
        scripts: true,
        macros: true,
    };
    assert!(!gate.app_enabled());
    assert!(!gate.permits_login(&identity, true));
    assert_eq!(
        gate.authorize_automation(&identity, &script(), allowed),
        Err(Failure::Denied)
    );
    let record = Action::RecordStart {
        document_token: "receipt".into(),
        origin: "https://example.test".into(),
        request_id: "record-1".into(),
    };
    assert_eq!(
        gate.authorize_automation(&identity, &record, allowed),
        Err(Failure::Denied)
    );
    assert_eq!(
        gate.authorize_automation(&identity, &cancel(), allowed),
        Ok(Permissions::default())
    );
    let receipt = serde_json::to_value(gate.receipt(&identity).unwrap()).unwrap();
    assert_eq!(receipt["appEnabled"], false);
    assert_eq!(receipt["forcedDark"], true);
    assert_eq!(receipt["chromium"], "unsupportedPrivateContext");
}

#[test]
fn on_never_creates_consent_or_bypasses_action_validation() {
    let identity = owner("database", "connection", "tab");
    let gate = NativeExtensionGate::new(identity.clone(), true);
    assert!(!gate.permits_login(&identity, false));
    assert!(gate.permits_login(&identity, true));
    assert_eq!(
        gate.authorize_automation(&identity, &script(), Permissions::default()),
        Err(Failure::Denied)
    );
    let allowed = Permissions {
        scripts: true,
        macros: false,
    };
    assert_eq!(
        gate.authorize_automation(&identity, &script(), allowed),
        Ok(allowed)
    );
    let mut invalid = script();
    if let Action::Script { origin, .. } = &mut invalid {
        *origin = "http://example.test".into();
    }
    assert_eq!(
        gate.authorize_automation(&identity, &invalid, allowed),
        Err(Failure::InvalidRequest)
    );
}

#[test]
fn no_database_connection_tab_or_attempt_can_borrow_another_gate() {
    let identity = owner("database", "connection", "tab");
    let gate = NativeExtensionGate::new(identity, true);
    for other in [
        owner("other", "connection", "tab"),
        owner("database", "other", "tab"),
        owner("database", "connection", "other"),
        owner("database", "connection", "tab"),
    ] {
        assert!(!gate.permits_login(&other, true));
        assert_eq!(
            gate.authorize_automation(&other, &cancel(), Permissions::default()),
            Err(Failure::Denied)
        );
        assert!(gate.receipt(&other).is_err());
    }
}

#[test]
fn saved_layers_inherit_and_explicit_overrides_survive_serialization() {
    use saved_extensions::saved_app_extensions_enabled as resolve;
    assert_eq!(resolve(&json!({}), &json!({})), Ok(true));
    let settings = json!({"webBrowser":{"version":1,"websiteExtensionsEnabled":false}});
    assert_eq!(resolve(&json!({}), &settings), Ok(false));
    let connection = json!({"browserSession":{"version":1,"websiteExtensionsEnabled":true}});
    let restored = serde_json::from_str(&connection.to_string()).unwrap();
    assert_eq!(resolve(&restored, &settings), Ok(true));
    assert_eq!(
        resolve(&json!({"browserSession":{"version":1}}), &settings),
        Ok(false)
    );
}

#[test]
fn malformed_or_unknown_version_preferences_fail_closed() {
    use saved_extensions::saved_app_extensions_enabled as resolve;
    for invalid in [
        json!(null),
        json!({"version":2,"websiteExtensionsEnabled":true}),
        json!({"version":1,"websiteExtensionsEnabled":"true"}),
        json!({"websiteExtensionsEnabled":true}),
    ] {
        assert!(resolve(&json!({"browserSession":invalid}), &json!({})).is_err());
    }
    assert!(resolve(
        &json!({"browserSession":{"version":1,"websiteExtensionsEnabled":true}}),
        &json!({"webBrowser":{"websiteExtensionsEnabled":null}})
    )
    .is_err());
}

#[test]
fn chromium_installation_is_a_fixed_native_error_not_an_empty_success() {
    assert_eq!(
        native_extensions::require_chromium_extension_installation(),
        Err(native_extensions::CHROMIUM_EXTENSION_UNAVAILABLE)
    );
}
