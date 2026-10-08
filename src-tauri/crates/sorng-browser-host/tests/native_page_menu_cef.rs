#![cfg(feature = "cef-host")]
//! Compile-only public menu contract; does not initialize or control CEF.
#![allow(dead_code)]
use sorng_browser_host::cef_browser::{
    BrowserError, CefBrowserHost, PageMenuCompletion, PageMenuGuard,
};
use sorng_protocols::origin_browser::BrowserIdentity;

fn print(host: &CefBrowserHost<'_>, id: &BrowserIdentity) -> Result<(), BrowserError> {
    host.print_page(id)
}
fn history(
    host: &CefBrowserHost<'_>,
    id: &BrowserIdentity,
    guard: PageMenuGuard,
    completion: PageMenuCompletion,
) -> Result<(), BrowserError> {
    host.navigation_history(id, guard, completion)
}
fn jump(
    host: &CefBrowserHost<'_>,
    id: &BrowserIdentity,
    token: &str,
    index: i32,
    guard: PageMenuGuard,
    completion: PageMenuCompletion,
) -> Result<(), BrowserError> {
    host.navigate_history(id, token, index, guard, completion)
}
