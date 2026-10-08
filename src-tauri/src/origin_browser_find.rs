//! Find feedback stays in the authenticated source window. No new command or
//! authority, no UI-registry reentrancy, and no page strings in event payloads.
use super::*;
use sorng_browser_host::cef_browser::{BrowserError, NativeFindCompletion};

#[allow(clippy::too_many_arguments)]
pub(super) fn start(
    view: &View,
    host: &CefBrowserHost<'_>,
    view_id: Option<&str>,
    request_id: Option<&str>,
    text: &str,
    forward: bool,
    match_case: bool,
    find_next: bool,
) -> Result<(), BrowserError> {
    let id = &view.attempt.identity;
    let Some(request_id) = request_id else {
        return host.find(id, text, forward, match_case, find_next);
    };
    let attempt = Arc::downgrade(&view.attempt);
    let window = view.window.clone();
    let source_identity = OriginBrowserIdentity::from_native(id);
    let view_id = view_id.map(str::to_owned);
    let completion: NativeFindCompletion = Arc::new(move |result| {
        let Some(attempt) = attempt.upgrade() else {
            return;
        };
        if !attempt.current() || attempt.window != window.label() {
            return;
        }
        // Host has already checked the native view and document generation.
        // Never consult UI's RefCell here: CEF may invoke callbacks reentrantly.
        let _ = window.emit_to(
            tauri::EventTarget::webview_window(window.label()),
            "origin-browser-find-result",
            serde_json::json!({
                "sourceIdentity": source_identity,
                "viewId": view_id,
                "result": result,
            }),
        );
    });
    host.find_with_results(
        id, request_id, text, forward, match_case, find_next, completion,
    )
}
