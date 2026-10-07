//! Exercise the production native storage codec without starting CEF.
//! Actual CookieManager import/export remains a packaged-engine acceptance gate.
#[allow(dead_code)]
#[path = "../../../src/origin_browser_retention.rs"]
mod retention;

#[allow(dead_code)]
#[path = "../../../src/origin_browser_preferences.rs"]
mod preferences;

#[allow(dead_code)]
#[path = "../../../src/origin_browser_retention_gate.rs"]
mod checkpoint_gate;
