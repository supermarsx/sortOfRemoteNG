//! Reviewed Autodesk CFP bootstrap resource, not login or document authority.
//! The caller applies this only outside same-origin-only mode; the ordinary
//! resolver retains explicit-deny precedence and cross-origin capability gates.
//!
//! Public evidence reviewed 2026-10-09, without an account/login attempt:
//! https://manage.autodesk.com/home loads both scripts beforeInteractive:
//! https://prd-cfp.autodesk.com/cfp-vendors/current/main.js
//! https://prd-cfp.autodesk.com/cfp-runtime/current/main.js
//! Its /_next/ue1/_next/static/chunks/7987-9956355a7ad76c52.js waits up to
//! 10,000 ms for window.cfp.providers.auth.register. These scripts returned 200.
//! Other auth, telemetry, profile and challenge routes are not implied here.

use serde_json::Value;
use sorng_browser_host::domain_permissions::WebsiteRequestClass;

pub(super) fn resource_grant(
    connection: &Value,
    source_origin: &str,
) -> Option<(&'static str, &'static [WebsiteRequestClass])> {
    let application = connection.get("httpApplication")?;
    if source_origin != "https://manage.autodesk.com"
        || application.get("version") != Some(&Value::from(1))
        || application.get("id").and_then(Value::as_str) != Some("autodesk")
        || application.get("invalid").is_some()
    {
        return None;
    }
    // Page-owned bootstrap is independent of saved credential/autofill consent.
    // Exact HTTPS origin and script class only: no sibling hosts or documents.
    Some((
        "https://prd-cfp.autodesk.com",
        &[WebsiteRequestClass::Script],
    ))
}
