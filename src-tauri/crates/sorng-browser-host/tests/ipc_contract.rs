//! Exercise the exported wire API with real serde/URL/native-identity contracts.
//! These tests do not start a native browser or claim host readiness.
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use sorng_browser_host::ipc::*;
use sorng_protocols::origin_browser::OriginBrowserPolicy as NativePolicy;

fn owner() -> Value {
    json!({ "ownerDatabaseId": "database-1", "connectionId": "connection-1", "sessionId": "tab-1" })
}

#[test]
fn zoom_percent_is_finite_bounded_and_converted_to_cef_levels() {
    for percent in [25.0, 100.0, 120.0, 500.0] {
        let level = zoom_level_for_percent(percent).unwrap();
        assert!((100.0 * 1.2_f64.powf(level) - percent).abs() < 1e-9);
        assert!(decode::<OriginBrowserAction>(json!({
            "kind": "zoom", "percent": percent, "presentationRevision": 1
        }))
        .is_ok());
    }
    assert_eq!(zoom_level_for_percent(100.0).unwrap(), 0.0);
    for percent in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 24.99, 500.01] {
        assert!(OriginBrowserAction::Zoom {
            percent,
            presentation_revision: 1
        }
        .validate()
        .is_err());
    }
}

#[test]
fn find_controls_require_bounded_text_and_current_presentation_shape() {
    let find = json!({ "kind": "find", "text": "needle", "forward": true,
        "matchCase": false, "findNext": false, "presentationRevision": 1 });
    for text in [
        "x".repeat(MAX_FIND_TEXT_BYTES),
        "é".repeat(MAX_FIND_TEXT_BYTES / 2),
        "<script>literal search</script>".into(),
    ] {
        let mut value = find.clone();
        value["text"] = json!(text);
        assert!(decode::<OriginBrowserAction>(value).is_ok());
    }
    for text in [
        String::new(),
        "x".repeat(MAX_FIND_TEXT_BYTES + 1),
        "é".repeat(MAX_FIND_TEXT_BYTES / 2 + 1),
        "a\0b".into(),
    ] {
        let mut value = find.clone();
        value["text"] = json!(text);
        assert_rejected::<OriginBrowserAction>(value);
    }
    for mut action in [
        find,
        json!({"kind": "zoom", "percent": 100, "presentationRevision": 1}),
        json!({"kind": "stop-find", "clearSelection": true, "presentationRevision": 1}),
    ] {
        assert!(decode::<OriginBrowserAction>(action.clone()).is_ok());
        action["presentationRevision"] = json!(0);
        assert_rejected::<OriginBrowserAction>(action.clone());
        action["presentationRevision"] = json!(MAX_JS_INTEGER + 1);
        assert_rejected::<OriginBrowserAction>(action.clone());
        action
            .as_object_mut()
            .unwrap()
            .remove("presentationRevision");
        assert_rejected::<OriginBrowserAction>(action.clone());
        action["presentationRevision"] = json!(1);
        action["javascript"] = json!("window.find('needle')");
        assert_rejected::<OriginBrowserAction>(action);
    }
}

#[test]
fn new_controls_keep_native_identity_validation() {
    let policy = native_policy();
    for action in [
        json!({"kind": "zoom", "percent": 100, "presentationRevision": 1}),
        json!({"kind": "find", "text": "needle", "forward": false, "matchCase": true, "findNext": true, "presentationRevision": 1}),
        json!({"kind": "stop-find", "clearSelection": false, "presentationRevision": 1}),
    ] {
        let valid = json!({"identity": wire_identity(&policy), "action": action});
        let decoded = decode::<OriginBrowserControlRequest>(valid.clone()).unwrap();
        decoded
            .identity
            .validate_matches(policy.identity())
            .unwrap();
        let other = native_policy();
        assert!(decoded.identity.validate_matches(other.identity()).is_err());
        let mut missing = valid;
        missing.as_object_mut().unwrap().remove("identity");
        assert_rejected::<OriginBrowserControlRequest>(missing);
    }
}

#[test]
fn automation_uses_the_native_action_contract_and_exact_attempt_identity() {
    let policy = native_policy();
    for operation in [
        json!({"action":"document"}),
        json!({"action":"script", "documentToken":"document-1", "origin":"https://fixture.invalid", "requestId":"request-1", "code":"void 0;"}),
        json!({"action":"step", "documentToken":"document-1", "origin":"https://fixture.invalid", "requestId":"request-1", "step":{"kind":"fill", "selector":"html > body > input:nth-of-type(1)"}, "value":"transient"}),
        json!({"action":"recordStart", "documentToken":"document-1", "origin":"https://fixture.invalid", "requestId":"request-1"}),
        json!({"action":"recordStop", "documentToken":"document-1", "origin":"https://fixture.invalid", "requestId":"request-1"}),
        json!({"action":"cancel", "documentToken":"document-1", "origin":"https://fixture.invalid", "requestId":"request-1"}),
    ] {
        let wire = json!({"identity":wire_identity(&policy), "operation":operation});
        let request = decode::<OriginBrowserAutomationRequest>(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(&request).unwrap(), wire);
        request
            .identity
            .validate_matches(policy.identity())
            .unwrap();
        assert!(request
            .identity
            .validate_matches(native_policy().identity())
            .is_err());
        let mut missing = wire.clone();
        missing.as_object_mut().unwrap().remove("identity");
        assert_rejected::<OriginBrowserAutomationRequest>(missing);
        for key in [
            "permissions",
            "scripts",
            "macros",
            "ownerAvailable",
            "expectedOrigin",
            "expectedDocumentId",
        ] {
            let mut extra = wire.clone();
            extra[key] = json!(true);
            assert_rejected::<OriginBrowserAutomationRequest>(extra);
        }
    }
}

#[test]
fn automation_cannot_inject_authority_or_persist_recorded_field_values() {
    let policy = native_policy();
    for operation in [
        json!({"action":"document", "permissions":{"scripts":true,"macros":true}}),
        json!({"action":"recordStart", "documentToken":"document-1", "origin":"https://fixture.invalid", "requestId":"request-1", "allowAllOrigins":true}),
        json!({"action":"step", "documentToken":"document-1", "origin":"https://fixture.invalid", "requestId":"request-1", "step":{"kind":"fill", "selector":"html > body > input:nth-of-type(1)", "value":"must-not-be-recorded"}, "value":"transient"}),
    ] {
        assert_rejected::<OriginBrowserAutomationRequest>(
            json!({"identity":wire_identity(&policy), "operation":operation}),
        );
    }
    let script = decode::<OriginBrowserAutomationRequest>(json!({"identity":wire_identity(&policy), "operation":{
        "action":"script", "documentToken":"document-1", "origin":"https://fixture.invalid", "requestId":"request-1", "code":"void 0;"
    }})).unwrap();
    // A structurally valid trusted-shell message is not a permission grant.
    assert_eq!(
        script.operation.validate(Default::default()),
        Err(sorng_browser_host::native_automation::NativeAutomationFailure::Denied)
    );
}

fn native_policy() -> NativePolicy {
    NativePolicy::new(
        "database-1",
        "connection-1",
        "tab-1",
        "https://fixture.invalid",
    )
    .unwrap()
}

fn wire_identity(native: &NativePolicy) -> Value {
    serde_json::to_value(OriginBrowserIdentity::from_native(native.identity())).unwrap()
}

fn bounds() -> Value {
    json!({ "x": 20.5, "y": 80.25, "width": 800.5, "height": 600.25 })
}

fn create() -> Value {
    json!({
        "owner": owner(), "expectedSecurityRevision": "revision-7", "sourceSessionId": "unlock-1",
        "requestId": "renderer-correlation-only", "initialUrl": "https://fixture.invalid/login",
        "bounds": bounds(), "visible": false,
        "policy": { "darkMode": "forced", "autoLogin": { "enabled": true, "consent": { "kind": "required" } } }
    })
}

fn decode<T: DeserializeOwned + ValidateOriginBrowserRequest>(
    value: Value,
) -> Result<T, OriginBrowserIpcError> {
    decode_request(value)
}

fn expect_error<T: DeserializeOwned + ValidateOriginBrowserRequest>(
    value: Value,
    expected: OriginBrowserIpcError,
) {
    match decode::<T>(value) {
        Ok(_) => panic!("Invalid browser wire data was accepted"),
        Err(actual) => assert_eq!(actual, expected),
    }
}

fn assert_rejected<T: DeserializeOwned + ValidateOriginBrowserRequest>(value: Value) {
    assert!(
        decode::<T>(value).is_err(),
        "Invalid browser wire data was accepted"
    );
}

fn snapshot(native: &NativePolicy, sequence: u64, url: &str, title: &str) -> OriginBrowserSnapshot {
    OriginBrowserSnapshot::new(
        native.identity(),
        sequence,
        OriginBrowserPhase::Attached,
        OriginBrowserPageState {
            url,
            title,
            loading: false,
            can_go_back: true,
            can_go_forward: false,
        },
    )
    .unwrap()
}

#[test]
fn create_matches_the_frontend_camel_case_contract_without_implicit_authority() {
    let request = decode::<OriginBrowserCreateRequest>(create())
        .unwrap_or_else(|_| panic!("Valid fixture rejected"));
    assert_eq!(serde_json::to_value(&request).unwrap(), create());
    assert_eq!(request.expected_security_revision, "revision-7");
    assert_eq!(request.source_session_id, "unlock-1");
    assert_eq!(request.request_id, "renderer-correlation-only");
    let source = request.bounds.to_native().unwrap();
    assert_eq!(
        (source.x(), source.y(), source.width(), source.height()),
        (20.5, 80.25, 800.5, 600.25)
    );
    let envelope: OriginBrowserInvokeRequest<OriginBrowserCreateRequest> =
        decode(json!({ "request": create() }))
            .unwrap_or_else(|_| panic!("Valid envelope rejected"));
    assert_eq!(
        serde_json::to_value(envelope).unwrap(),
        json!({ "request": create() })
    );
}

#[test]
fn create_rejects_authority_parent_route_secret_readiness_and_attempt_injection() {
    for key in [
        "attemptId",
        "identity",
        "nativeParent",
        "parentHandle",
        "hwnd",
        "authority",
        "allowedOrigins",
        "route",
        "proxyEndpoint",
        "proxyUsername",
        "proxyPassword",
        "password",
        "rawJs",
        "readiness",
        "nativeHostReadiness",
        "profileKey",
        "ownerAvailable",
        "unlocked",
        "ownerRevision",
        "unlockSessionId",
    ] {
        let mut value = create();
        value[key] = json!("private-rejected-value");
        expect_error::<OriginBrowserCreateRequest>(value, OriginBrowserIpcError::InvalidRequest);
    }
    expect_error::<OriginBrowserInvokeRequest<OriginBrowserCreateRequest>>(
        json!({ "request": create(), "authority": "private-rejected-value" }),
        OriginBrowserIpcError::InvalidRequest,
    );
}

#[test]
fn every_nested_create_object_rejects_unknown_fields_including_unit_consent_variant() {
    for path in [
        "/owner",
        "/bounds",
        "/policy",
        "/policy/autoLogin",
        "/policy/autoLogin/consent",
    ] {
        let mut value = create();
        value.pointer_mut(path).unwrap()["private-secret-field"] = json!(true);
        expect_error::<OriginBrowserCreateRequest>(value, OriginBrowserIpcError::InvalidRequest);
    }
    let mut existing = create();
    existing["policy"]["autoLogin"]["consent"] =
        json!({ "kind": "existing-grant", "grantId": "grant-1", "password": "private" });
    expect_error::<OriginBrowserCreateRequest>(existing, OriginBrowserIpcError::InvalidRequest);
}

#[test]
fn create_requires_string_revision_and_managed_unlock_session_proof() {
    for field in ["expectedSecurityRevision", "sourceSessionId"] {
        for bad in [Value::Null, json!(7), json!(true), json!({}), json!([])] {
            let mut value = create();
            value[field] = bad;
            expect_error::<OriginBrowserCreateRequest>(
                value,
                OriginBrowserIpcError::InvalidRequest,
            );
        }
        for bad in ["", "spaces are invalid", "proof\nsecret", "\u{2003}"] {
            let mut value = create();
            value[field] = json!(bad);
            expect_error::<OriginBrowserCreateRequest>(
                value,
                OriginBrowserIpcError::InvalidOwnerProof,
            );
        }
        let mut missing = create();
        missing.as_object_mut().unwrap().remove(field);
        expect_error::<OriginBrowserCreateRequest>(missing, OriginBrowserIpcError::InvalidRequest);
    }
}

#[test]
fn fields_are_bounded_during_deserialization_and_again_for_native_constructed_requests() {
    for field in ["expectedSecurityRevision", "sourceSessionId", "requestId"] {
        let mut value = create();
        value[field] = json!("x".repeat(MAX_ID_BYTES));
        assert!(decode::<OriginBrowserCreateRequest>(value.clone()).is_ok());
        value[field] = json!("x".repeat(MAX_ID_BYTES + 1));
        expect_error::<OriginBrowserCreateRequest>(value, OriginBrowserIpcError::InvalidRequest);
    }
    let mut request = decode::<OriginBrowserCreateRequest>(create())
        .unwrap_or_else(|_| panic!("Valid fixture rejected"));
    request.source_session_id = "x".repeat(MAX_ID_BYTES + 1);
    assert_eq!(
        request.validate(),
        Err(OriginBrowserIpcError::InvalidOwnerProof)
    );
    let mut value = create();
    value["initialUrl"] = json!(format!(
        "https://fixture.invalid/{}",
        "x".repeat(MAX_URL_BYTES)
    ));
    expect_error::<OriginBrowserCreateRequest>(value, OriginBrowserIpcError::InvalidRequest);
}

#[test]
fn owner_fields_are_nonempty_bounded_and_whitespace_free() {
    for field in ["ownerDatabaseId", "connectionId", "sessionId"] {
        for bad in ["", " ", "contains space", "control\t", "\u{2003}"] {
            let mut value = owner();
            value[field] = json!(bad);
            expect_error::<OriginBrowserOwner>(value, OriginBrowserIpcError::InvalidOwner);
        }
        let mut value = owner();
        value[field] = json!("a".repeat(MAX_ID_BYTES + 1));
        expect_error::<OriginBrowserOwner>(value, OriginBrowserIpcError::InvalidRequest);
    }
}

#[test]
fn forced_dark_enabled_autologin_and_hidden_creation_cannot_be_disabled() {
    let mut visible = create();
    visible["visible"] = json!(true);
    expect_error::<OriginBrowserCreateRequest>(visible, OriginBrowserIpcError::InvalidPresentation);
    let mut login = create();
    login["policy"]["autoLogin"]["enabled"] = json!(false);
    expect_error::<OriginBrowserCreateRequest>(login, OriginBrowserIpcError::InvalidPolicy);
    for mode in ["off", "auto", "disabled"] {
        let mut value = create();
        value["policy"]["darkMode"] = json!(mode);
        expect_error::<OriginBrowserCreateRequest>(value, OriginBrowserIpcError::InvalidRequest);
    }
    let mut consent = create();
    consent["policy"]["autoLogin"]["consent"] = json!({ "kind": "granted" });
    expect_error::<OriginBrowserCreateRequest>(consent, OriginBrowserIpcError::InvalidRequest);
    let mut tagged_object = create();
    tagged_object["policy"]["darkMode"] = json!({ "forced": null });
    expect_error::<OriginBrowserCreateRequest>(
        tagged_object,
        OriginBrowserIpcError::InvalidRequest,
    );
}

#[test]
fn existing_consent_is_only_a_bounded_reference_not_credentials_or_a_new_grant() {
    let mut value = create();
    value["policy"]["autoLogin"]["consent"] =
        json!({ "kind": "existing-grant", "grantId": "grant-1" });
    assert!(decode::<OriginBrowserCreateRequest>(value.clone()).is_ok());
    value["policy"]["autoLogin"]["consent"]["grantId"] = json!("");
    expect_error::<OriginBrowserCreateRequest>(value, OriginBrowserIpcError::InvalidPolicy);
    assert_rejected::<OriginBrowserConsent>(json!({ "kind": "existing-grant" }));
    assert_rejected::<OriginBrowserConsent>(json!({ "kind": "required", "grantId": "unexpected" }));
}

#[test]
fn navigation_rejects_non_http_credential_malformed_and_control_character_urls() {
    let native = native_policy();
    for bad in [
        "",
        "relative/path",
        "https:fixture.invalid",
        "https:/fixture.invalid",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/plain,secret",
        "https://user:secret@fixture.invalid",
        "https://user@fixture.invalid",
        "https://:secret@fixture.invalid",
        "https://fixture.invalid/a\nprivate",
        " https://fixture.invalid",
        "https://fixture.invalid ",
        "https://fixture.invalid\\@other.invalid",
        "https://[invalid]/",
        "https://",
    ] {
        let mut value = create();
        value["initialUrl"] = json!(bad);
        expect_error::<OriginBrowserCreateRequest>(value, OriginBrowserIpcError::InvalidUrl);
        expect_error::<OriginBrowserNavigateRequest>(
            json!({ "identity": wire_identity(&native), "url": bad }),
            OriginBrowserIpcError::InvalidUrl,
        );
    }
    for allowed in [
        "http://fixture.invalid:8080/",
        "https://fixture.invalid/path?value=1#section",
        "https://[::1]:8443/path",
    ] {
        // URL shape does not grant destination admission: native validates the
        // saved connection and policy before any of these can open a socket.
        assert!(decode::<OriginBrowserNavigateRequest>(
            json!({ "identity": wire_identity(&native), "url": allowed })
        )
        .is_ok());
    }
}

#[test]
fn attempt_reference_requires_canonical_non_nil_uuid_and_exact_native_owner() {
    let native = native_policy();
    let wire = OriginBrowserIdentity::from_native(native.identity());
    assert!(wire.validate_matches(native.identity()).is_ok());
    let successor = native_policy();
    assert_eq!(
        wire.validate_matches(successor.identity()),
        Err(OriginBrowserIpcError::IdentityMismatch)
    );
    for field in ["ownerDatabaseId", "connectionId", "sessionId"] {
        let mut value = wire_identity(&native);
        value[field] = json!("other");
        let foreign: OriginBrowserIdentity =
            decode(value).unwrap_or_else(|_| panic!("Valid shape rejected"));
        assert_eq!(
            foreign.validate_matches(native.identity()),
            Err(OriginBrowserIpcError::IdentityMismatch)
        );
    }
    for bad in [
        "renderer-correlation-only",
        "",
        "00000000-0000-0000-0000-000000000000",
        "12345678123412341234123456789abc",
        "12345678-1234-1234-1234-123456789abg",
        "12345678-1234-1234-1234-123456789ABC",
        "{12345678-1234-1234-1234-123456789abc}",
    ] {
        let mut value = wire_identity(&native);
        value["attemptId"] = json!(bad);
        expect_error::<OriginBrowserIdentity>(value, OriginBrowserIpcError::InvalidAttempt);
    }
}

#[test]
fn native_allocation_is_distinct_from_renderer_request_correlation() {
    let request = decode::<OriginBrowserCreateRequest>(create())
        .unwrap_or_else(|_| panic!("Valid fixture rejected"));
    let native = native_policy();
    let response =
        OriginBrowserCreateResult::new(&request.request_id, snapshot(&native, 0, "", "")).unwrap();
    let value = serde_json::to_value(response).unwrap();
    assert_eq!(value["requestId"], "renderer-correlation-only");
    assert_eq!(
        value["snapshot"]["identity"]["attemptId"],
        native.identity().attempt_id().to_string()
    );
    assert_ne!(
        value["requestId"],
        value["snapshot"]["identity"]["attemptId"]
    );
}

#[test]
fn bounds_reuse_native_limits_and_reject_nonfinite_or_minimized_values() {
    for (x, y, width, height) in [
        (-1.0, 0.0, 1.0, 1.0),
        (0.0, -1.0, 1.0, 1.0),
        (0.0, 0.0, 0.0, 1.0),
        (0.0, 0.0, 1.0, 0.5),
        (32_768.0, 0.0, 1.0, 1.0),
        (0.0, 32_768.0, 1.0, 1.0),
        (0.0, 0.0, 8193.0, 8192.0),
        (f64::NAN, 0.0, 1.0, 1.0),
        (0.0, 0.0, f64::INFINITY, 1.0),
    ] {
        assert_eq!(
            OriginBrowserBounds {
                x,
                y,
                width,
                height
            }
            .validate(),
            Err(OriginBrowserIpcError::InvalidBounds)
        );
    }
    assert!(OriginBrowserBounds {
        x: 24_576.0,
        y: 24_576.0,
        width: 8192.0,
        height: 8192.0
    }
    .validate()
    .is_ok());
}

#[test]
fn presentation_requires_safe_integer_revision_and_bounds_when_visible() {
    let native = native_policy();
    let control = |action| json!({ "identity": wire_identity(&native), "action": action });
    for action in [
        json!({ "kind": "presentation", "revision": 1, "bounds": bounds(), "visible": true }),
        json!({ "kind": "presentation", "revision": 2, "bounds": null, "visible": false }),
        json!({ "kind": "focus", "presentationRevision": MAX_JS_INTEGER }),
    ] {
        let expected = control(action);
        let decoded: OriginBrowserControlRequest =
            decode(expected.clone()).unwrap_or_else(|_| panic!("Valid action rejected"));
        assert_eq!(serde_json::to_value(decoded).unwrap(), expected);
    }
    for action in [
        json!({ "kind": "presentation", "revision": 0, "bounds": bounds(), "visible": true }),
        json!({ "kind": "presentation", "revision": 1, "bounds": null, "visible": true }),
        json!({ "kind": "presentation", "revision": 1, "visible": false }),
        json!({ "kind": "presentation", "revision": MAX_JS_INTEGER + 1, "bounds": bounds(), "visible": false }),
        json!({ "kind": "focus", "presentationRevision": 0 }),
        json!({ "kind": "focus", "presentationRevision": -1 }),
        json!({ "kind": "focus", "presentationRevision": 1.5 }),
        json!({ "kind": "focus", "presentationRevision": MAX_JS_INTEGER + 1 }),
    ] {
        assert_rejected::<OriginBrowserControlRequest>(control(action));
    }
}

#[test]
fn every_action_variant_rejects_unknown_fields_and_script_execution() {
    let native = native_policy();
    for kind in ["back", "forward", "reload", "stop", "focus", "presentation"] {
        let mut action = match kind {
            "focus" => json!({ "kind": kind, "presentationRevision": 1 }),
            "presentation" => {
                json!({ "kind": kind, "revision": 1, "bounds": null, "visible": false })
            }
            _ => json!({ "kind": kind }),
        };
        assert!(decode::<OriginBrowserAction>(action.clone()).is_ok());
        action["rawJs"] = json!("private-script");
        expect_error::<OriginBrowserControlRequest>(
            json!({ "identity": wire_identity(&native), "action": action }),
            OriginBrowserIpcError::InvalidRequest,
        );
    }
    assert_rejected::<OriginBrowserAction>(
        json!({ "kind": "execute-script", "script": "private-script" }),
    );
}

#[test]
fn all_request_containers_and_identity_reject_unknown_authority() {
    let native = native_policy();
    let identity = wire_identity(&native);
    let mut identity_extra = identity.clone();
    identity_extra["profileKey"] = json!("private-profile");
    assert_rejected::<OriginBrowserIdentity>(identity_extra);
    assert_rejected::<OriginBrowserNavigateRequest>(
        json!({ "identity": identity, "url": "https://fixture.invalid", "route": "direct" }),
    );
    assert_rejected::<OriginBrowserControlRequest>(
        json!({ "identity": identity, "action": { "kind": "reload" }, "readiness": "ready" }),
    );
    assert_rejected::<OriginBrowserCloseRequest>(
        json!({ "identity": identity, "ownerAvailable": true }),
    );
    assert_rejected::<OriginBrowserStatusRequest>(
        json!({ "owner": owner(), "identity": identity, "capability": { "availability": "available" } }),
    );
}

#[test]
fn status_optional_attempt_must_belong_to_requested_owner() {
    let native = native_policy();
    let request: OriginBrowserStatusRequest =
        decode(json!({ "owner": owner() })).unwrap_or_else(|_| panic!("Valid status rejected"));
    assert!(request.identity.is_none());
    assert_eq!(
        serde_json::to_value(request).unwrap(),
        json!({ "owner": owner() })
    );
    assert!(decode::<OriginBrowserStatusRequest>(
        json!({ "owner": owner(), "identity": wire_identity(&native) })
    )
    .is_ok());
    let mut foreign = wire_identity(&native);
    foreign["ownerDatabaseId"] = json!("other");
    expect_error::<OriginBrowserStatusRequest>(
        json!({ "owner": owner(), "identity": foreign }),
        OriginBrowserIpcError::IdentityMismatch,
    );
}

#[test]
fn close_references_exact_attempt_without_replacing_its_native_identity() {
    let native = native_policy();
    let request: OriginBrowserCloseRequest = decode(json!({ "identity": wire_identity(&native) }))
        .unwrap_or_else(|_| panic!("Valid close rejected"));
    assert!(request.identity.validate_matches(native.identity()).is_ok());
    assert_eq!(
        serde_json::to_value(request).unwrap(),
        json!({ "identity": wire_identity(&native) })
    );
}

#[test]
fn status_defaults_to_explicit_unavailable_and_serializes_every_reason() {
    assert_eq!(
        serde_json::to_value(OriginBrowserStatusResult::default()).unwrap(),
        json!({
            "capability": { "availability": "unavailable", "reason": "host-unavailable" }, "snapshot": null
        })
    );
    for (reason, expected) in [
        (
            OriginBrowserUnavailableReason::RuntimeMissing,
            "runtime-missing",
        ),
        (
            OriginBrowserUnavailableReason::PlatformUnsupported,
            "platform-unsupported",
        ),
        (
            OriginBrowserUnavailableReason::ContainmentUnverified,
            "containment-unverified",
        ),
        (
            OriginBrowserUnavailableReason::PolicyUnavailable,
            "policy-unavailable",
        ),
        (
            OriginBrowserUnavailableReason::OwnerUnavailable,
            "owner-unavailable",
        ),
        (
            OriginBrowserUnavailableReason::HostUnavailable,
            "host-unavailable",
        ),
    ] {
        assert_eq!(
            serde_json::to_value(OriginBrowserStatusResult::unavailable(reason)).unwrap(),
            json!({
                "capability": { "availability": "unavailable", "reason": expected }, "snapshot": null
            })
        );
    }
}

#[test]
fn snapshots_separate_full_owner_address_from_redacted_diagnostics_and_bound_titles() {
    let native = native_policy();
    let result = snapshot(
        &native,
        MAX_JS_INTEGER,
        "https://fixture.invalid/login?private-query=1#private-fragment",
        &format!("\0\n{}", "😀".repeat(600)),
    );
    assert_eq!(result.sequence(), MAX_JS_INTEGER);
    let value = serde_json::to_value(result).unwrap();
    assert_eq!(value["displayUrl"], "https://fixture.invalid/login");
    assert_eq!(
        value["currentUrl"],
        "https://fixture.invalid/login?private-query=1#private-fragment"
    );
    assert_eq!(
        value["title"].as_str().unwrap().encode_utf16().count(),
        MAX_TITLE_UTF16
    );
    assert_eq!(value["phase"], "attached");
    assert_eq!(value["canGoBack"], true);
    assert_eq!(value["canGoForward"], false);
    assert!(!value["displayUrl"].as_str().unwrap().contains("private"));
    assert_eq!(value.as_object().unwrap().len(), 9);
    assert_eq!(ORIGIN_BROWSER_STATE_EVENT, "origin-browser-state");
}

#[test]
fn snapshot_sequence_and_source_url_fail_closed_without_echoing_invalid_values() {
    let native = native_policy();
    for (sequence, url) in [
        (MAX_JS_INTEGER + 1, ""),
        (0, "file:///private-secret"),
        (0, "javascript:private-secret"),
        (0, "https://user:private-secret@fixture.invalid/login"),
        (0, "https://private-secret@fixture.invalid/login"),
        (0, "https://fixture.invalid/\nprivate-secret"),
    ] {
        let result = OriginBrowserSnapshot::new(
            native.identity(),
            sequence,
            OriginBrowserPhase::Starting,
            OriginBrowserPageState {
                url,
                title: "",
                loading: true,
                can_go_back: false,
                can_go_forward: false,
            },
        );
        let error = result.err().expect("Invalid output accepted");
        assert!(!error.to_string().contains("private-secret"));
        assert!(!format!("{error:?}").contains("private-secret"));
    }
    for (phase, expected) in [
        (OriginBrowserPhase::Starting, "starting"),
        (OriginBrowserPhase::Attached, "attached"),
        (OriginBrowserPhase::Closing, "closing"),
        (OriginBrowserPhase::Closed, "closed"),
        (OriginBrowserPhase::Failed, "failed"),
    ] {
        assert_eq!(serde_json::to_value(phase).unwrap(), expected);
    }
}

#[test]
fn status_output_rejects_foreign_snapshots_or_snapshot_without_attempt_request() {
    let native = native_policy();
    let request: OriginBrowserStatusRequest =
        decode(json!({ "owner": owner(), "identity": wire_identity(&native) }))
            .unwrap_or_else(|_| panic!("Valid fixture rejected"));
    let good = OriginBrowserStatusResult::from_native(
        &request,
        OriginBrowserCapability::Available,
        Some(snapshot(&native, 0, "", "")),
    );
    assert!(good.is_ok()); // Serialization contract only; not a real host readiness claim.
    let other = native_policy();
    assert!(matches!(
        OriginBrowserStatusResult::from_native(
            &request,
            OriginBrowserCapability::Available,
            Some(snapshot(&other, 0, "", ""))
        ),
        Err(OriginBrowserIpcError::IdentityMismatch)
    ));
    assert!(matches!(
        OriginBrowserStatusResult::from_native(
            &request,
            OriginBrowserCapability::Unavailable {
                reason: OriginBrowserUnavailableReason::HostUnavailable
            },
            Some(snapshot(&native, 0, "", ""))
        ),
        Err(OriginBrowserIpcError::InvalidStatus)
    ));
    let request: OriginBrowserStatusRequest =
        decode(json!({ "owner": owner() })).unwrap_or_else(|_| panic!("Valid fixture rejected"));
    assert!(matches!(
        OriginBrowserStatusResult::from_native(
            &request,
            OriginBrowserCapability::Available,
            Some(snapshot(&native, 0, "", ""))
        ),
        Err(OriginBrowserIpcError::InvalidStatus)
    ));
}

#[test]
fn sanitized_decode_errors_never_echo_parser_input_field_names_or_values() {
    for raw in [
        r#"{"private-secret-field":"private-secret-value"}"#,
        r#"{"owner":{"ownerDatabaseId":"private-secret-value"},"private-secret-field":0}"#,
        r#"{"initialUrl":"https://private-secret-user:private-secret-password@fixture.invalid/""#,
        r#""private-secret-value""#,
    ] {
        let mut deserializer = serde_json::Deserializer::from_str(raw);
        let result = decode_request::<OriginBrowserCreateRequest, _>(&mut deserializer);
        let error = result.err().expect("Invalid fixture accepted");
        assert_eq!(error, OriginBrowserIpcError::InvalidRequest);
        assert!(!error.to_string().contains("private-secret"));
        assert!(!format!("{error:?}").contains("private-secret"));
        assert!(!serde_json::to_string(&error)
            .unwrap()
            .contains("private-secret"));
        assert!(std::error::Error::source(&error).is_none());
    }
}

#[test]
fn duplicate_fields_are_rejected_before_native_state_is_consulted() {
    let raw = r#"{"owner":{"ownerDatabaseId":"database-1","connectionId":"connection-1","sessionId":"tab-1"},"expectedSecurityRevision":"revision-1","expectedSecurityRevision":"revision-2","sourceSessionId":"unlock-1","requestId":"r","initialUrl":"https://fixture.invalid","bounds":{"x":0,"y":0,"width":1,"height":1},"visible":false,"policy":{"darkMode":"forced","autoLogin":{"enabled":true,"consent":{"kind":"required"}}}}"#;
    let mut deserializer = serde_json::Deserializer::from_str(raw);
    assert!(matches!(
        decode_request::<OriginBrowserCreateRequest, _>(&mut deserializer),
        Err(OriginBrowserIpcError::InvalidRequest)
    ));
}

#[test]
fn native_readiness_and_output_types_cannot_be_deserialized() {
    // This becomes an ambiguous trait lookup (a compile failure) if any listed
    // type gains DeserializeOwned. It protects the direction of the boundary.
    trait AmbiguousIfDeserialize<A> {
        fn check() {}
    }
    impl<T: ?Sized> AmbiguousIfDeserialize<()> for T {}
    struct HasDeserialize;
    impl<T: DeserializeOwned> AmbiguousIfDeserialize<HasDeserialize> for T {}

    let _ =
        <sorng_protocols::origin_browser::NativeHostReadiness as AmbiguousIfDeserialize<_>>::check;
    let _ = <OriginBrowserCapability as AmbiguousIfDeserialize<_>>::check;
    let _ = <OriginBrowserSnapshot as AmbiguousIfDeserialize<_>>::check;
    let _ = <OriginBrowserCreateResult as AmbiguousIfDeserialize<_>>::check;
    let _ = <OriginBrowserStatusResult as AmbiguousIfDeserialize<_>>::check;
}
