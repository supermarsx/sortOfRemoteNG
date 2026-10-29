#![cfg(feature = "cef-host")]
//! Exercise the production app diagnostic projection without a webview or secrets.
#[path = "../../../src/origin_browser_login_activity.rs"]
mod activity;
#[allow(dead_code)]
#[path = "../../../src/origin_browser_login_consent.rs"]
mod consent;
