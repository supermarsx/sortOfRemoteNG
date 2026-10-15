//! Normal CEF content defaults. This never expands saved credential authority.
use serde_json::{json, Value};

pub(super) fn standard(policy: Option<&Value>) -> bool {
    let Some(policy) = policy else { return true };
    match policy.get("nativeBrowsingMode").and_then(Value::as_str) {
        Some("standard") => return true,
        Some("restricted") => return false,
        _ if policy.get("nativeBrowsingMode").is_some() => return false,
        _ => {}
    }
    let Some(row) = policy.as_object() else {
        return false;
    };
    let resources: Value = serde_json::from_str(include_str!(
        "../../src/utils/protocol/commonResourceOrigins.json"
    ))
    .expect("bundled resource defaults");
    let canonical = json!({
        "version": 1, "pageScripts": "allow", "allowAllScripts": false,
        "allowAllRequests": false, "httpsOnly": false, "sameOriginOnly": false,
        "allowExternalFonts": true,
        "externalFontOrigins": ["https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
        "externalResourceOrigins": resources,
        "allowCrossOriginRedirects": false, "allowHttpDowngradeRedirects": false,
        "cacheMode": "normal", "queryParameters": []
    });
    row.iter().all(|(key, value)| {
        if matches!(
            key.as_str(),
            "version"
                | "pageScripts"
                | "allowAllScripts"
                | "allowAllRequests"
                | "sameOriginOnly"
                | "allowExternalFonts"
                | "externalFontOrigins"
                | "externalResourceOrigins"
        ) {
            canonical.get(key) == Some(value)
        } else {
            canonical.get(key).is_some()
        }
    })
}
