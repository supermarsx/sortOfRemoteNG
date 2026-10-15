//! Origin-bound page-content defaults, independent of saved-login authority.
use serde_json::Value;

pub(super) fn enabled(connection: &Value, source_origin: &str) -> bool {
    defaults_enabled(
        connection,
        source_origin,
        "scriptDefaults",
        "allowAllScripts",
    )
}

pub(super) fn requests_enabled(connection: &Value, source_origin: &str) -> bool {
    connection
        .pointer("/httpApplication/id")
        .and_then(Value::as_str)
        == Some("zoom")
        && defaults_enabled(
            connection,
            source_origin,
            "requestDefaults",
            "allowAllRequests",
        )
}

fn defaults_enabled(connection: &Value, source_origin: &str, field: &str, flag: &str) -> bool {
    let Some(application) = connection.get("httpApplication") else {
        return false;
    };
    let Some(id @ ("instagram" | "linkedin" | "zoom")) =
        application.get("id").and_then(Value::as_str)
    else {
        return false;
    };
    if application.get("version") != Some(&Value::from(1)) || application.get("invalid").is_some() {
        return false;
    }
    let Some(defaults) = super::native_login_catalog()
        .get("profiles")
        .and_then(|profiles| profiles.get(id))
        .and_then(|profile| profile.get(field))
    else {
        return false;
    };
    defaults.get(flag) == Some(&Value::Bool(true))
        && defaults.get("sourceOrigin").and_then(Value::as_str) == Some(source_origin)
        && source_origin.starts_with("https://")
}
