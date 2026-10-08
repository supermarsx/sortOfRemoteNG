#![allow(dead_code)]
#[path = "../../../src/origin_browser_appearance_config.rs"]
mod config;
#[path = "../src/native_appearance.rs"]
mod model;
#[path = "../../../src/origin_browser_appearance_request.rs"]
mod request;

#[test]
fn narrow_request_rejects_enabled_config_css_and_extra_palette_fields() {
    use serde_json::json;
    let base = json!({"identity":{
        "ownerDatabaseId":"fixture-db", "connectionId":"fixture-connection",
        "sessionId":"fixture-session", "attemptId":"12345678-1234-4123-8123-123456789abc"
    }, "appPalette":{"backgroundColor":"#ABCDEF","textColor":"#123456"}});
    let parsed: request::AppearanceRequest = serde_json::from_value(base.clone()).unwrap();
    assert_eq!(parsed.app_palette.unwrap().background_color, "#abcdef");
    for (name, value) in [
        ("enabled", json!(true)),
        ("config", json!({})),
        ("css", json!("body{}")),
        ("viewId", json!("another-owner")),
    ] {
        let mut hostile = base.clone();
        hostile[name] = value;
        assert!(serde_json::from_value::<request::AppearanceRequest>(hostile).is_err());
    }
    let mut hostile = base.clone();
    hostile["appPalette"]["extra"] = json!(true);
    assert!(serde_json::from_value::<request::AppearanceRequest>(hostile).is_err());
    for color in [
        "#fff",
        "red",
        "#123456;display:none",
        "url(https://fixture.invalid)",
    ] {
        let mut hostile = base.clone();
        hostile["appPalette"]["backgroundColor"] = json!(color);
        assert!(serde_json::from_value::<request::AppearanceRequest>(hostile).is_err());
    }
    let mut null = base;
    null["appPalette"] = serde_json::Value::Null;
    assert!(serde_json::from_value::<request::AppearanceRequest>(null)
        .unwrap()
        .app_palette
        .is_none());
}

#[test]
fn response_exposes_only_acknowledged_status_and_follow_flag() {
    use sorng_browser_host::native_appearance::AppearanceStatus;
    for (status, label) in [
        (AppearanceStatus::Applied, "applied"),
        (AppearanceStatus::Off, "off"),
        (AppearanceStatus::Fallback, "fallback"),
    ] {
        for requested in [false, true] {
            let value =
                serde_json::to_value(request::AppearanceResponse::acknowledged(status, requested))
                    .unwrap();
            assert_eq!(
                value,
                serde_json::json!({
                    "status":label,
                    "followingAppTheme":requested && status == AppearanceStatus::Applied,
                })
            );
        }
    }
}

/// Real CEF value/string boundary, no engine initialization or browser launch.
/// The no-default-features suite cannot expose CEF's empty-string encoding.
#[cfg(all(feature = "cef-host", target_os = "windows"))]
#[test]
fn cef_wire_accepts_empty_css_but_rejects_missing_wrong_type_and_oversize() {
    use serde_json::{json, Value};
    let _ = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 0);
    assert!(cef::CefString::from("").as_slice().is_none());
    let default: Value = serde_json::from_str(model::DEFAULT_JSON).unwrap();
    let (config, _) = model::wire::parse(model::DEFAULT_JSON).expect("valid empty default CSS");
    assert_eq!(config.theme.custom_css, "");
    let serialized = serde_json::to_string(&model::AppearanceConfig::default()).unwrap();
    assert!(model::wire::parse(&serialized).is_some());
    let mut live = default.clone();
    live["theme"]["backgroundColor"] = json!("#161b22");
    live["theme"]["textColor"] = json!("#e6edf3");
    assert!(model::wire::parse(&live.to_string()).is_some());
    for css in [
        Value::Null,
        json!(false),
        json!(0),
        json!({}),
        json!([]),
        json!("x".repeat(16_385)),
        json!("é".repeat(8_193)),
    ] {
        let mut invalid = default.clone();
        invalid["theme"]["customCss"] = css;
        assert!(model::wire::parse(&invalid.to_string()).is_none());
    }
    let mut missing = default.clone();
    missing["theme"]
        .as_object_mut()
        .unwrap()
        .remove("customCss");
    assert!(model::wire::parse(&missing.to_string()).is_none());
    for field in ["mode", "backgroundColor", "textColor"] {
        let mut invalid = default.clone();
        invalid["theme"][field] = json!("");
        assert!(model::wire::parse(&invalid.to_string()).is_none());
    }
}
