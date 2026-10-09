//! Reviewed PTisp resource default, not navigation or credential authority.
//! The caller applies this only outside same-origin-only mode; the ordinary
//! resolver retains explicit-deny precedence and cross-origin capability gates.

use serde_json::Value;
use sorng_browser_host::domain_permissions::WebsiteRequestClass;

pub(super) fn resource_grant(
    connection: &Value,
    source_origin: &str,
) -> Option<(&'static str, &'static [WebsiteRequestClass])> {
    let application = connection.get("httpApplication")?;
    if source_origin != "https://my.ptisp.pt"
        || application.get("version") != Some(&Value::from(1))
        || application.get("id").and_then(Value::as_str) != Some("ptisp")
        || application.get("invalid").is_some()
    {
        return None;
    }
    // Manual login and the form adapter use the same page-owned API requests.
    // Never infer API siblings, accept an override, or add document authority.
    Some(("https://api3.ptisp.pt", &[WebsiteRequestClass::FetchXhr]))
}
