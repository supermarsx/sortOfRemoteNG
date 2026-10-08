#![cfg(feature = "cef-host")]
//! Compile-only native API contract; never initializes/controls a live browser.
#![allow(dead_code)]
use sorng_browser_host::cef_browser::{
    AppearanceCompletion, AppearanceGuard, BrowserError, CefBrowserHost,
};
use sorng_protocols::origin_browser::BrowserIdentity;

fn apply(
    host: &CefBrowserHost<'_>,
    id: &BrowserIdentity,
    json: &str,
    guard: AppearanceGuard,
    callback: AppearanceCompletion,
) -> Result<(), BrowserError> {
    host.apply_appearance(id, json, guard, callback)
}
