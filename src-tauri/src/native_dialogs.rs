//! Keep browser `confirm` synchronous while retaining the explicit dialog API.
//!
//! tauri-plugin-dialog 2.7.2's document-start script replaces `window.confirm`
//! with an async call to the removed `plugin:dialog|confirm` command. Besides
//! rejecting, that Promise is truthy in existing synchronous cancel guards.
//! Suppress only those global replacements. Forward the actual plugin under
//! its original name so setup, native commands, permissions and lifecycle
//! behavior are unchanged. The npm dialog API already uses `message` correctly.

use tauri::{
    ipc::Invoke,
    plugin::{Plugin, TauriPlugin},
    webview::PageLoadPayload,
    AppHandle, RunEvent, Runtime, Url, Webview, Window,
};

pub fn init<R: Runtime>() -> impl Plugin<R> {
    BrowserNativeDialogs(tauri_plugin_dialog::init())
}

struct BrowserNativeDialogs<R: Runtime>(TauriPlugin<R>);

impl<R: Runtime> Plugin<R> for BrowserNativeDialogs<R> {
    fn name(&self) -> &'static str {
        self.0.name()
    }

    fn initialize(
        &mut self,
        app: &AppHandle<R>,
        config: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        self.0.initialize(app, config)
    }

    fn initialization_script(&self) -> Option<String> {
        None
    }

    // Plugin::initialization_script_2 delegates to this method by default,
    // so neither initialization-script API exposes the upstream replacements.

    fn window_created(&mut self, window: Window<R>) {
        self.0.window_created(window);
    }

    fn webview_created(&mut self, webview: Webview<R>) {
        self.0.webview_created(webview);
    }

    fn on_navigation(&mut self, webview: &Webview<R>, url: &Url) -> bool {
        self.0.on_navigation(webview, url)
    }

    fn on_page_load(&mut self, webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
        self.0.on_page_load(webview, payload);
    }

    fn on_event(&mut self, app: &AppHandle<R>, event: &RunEvent) {
        self.0.on_event(app, event);
    }

    fn extend_api(&mut self, invoke: Invoke<R>) -> bool {
        self.0.extend_api(invoke)
    }
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::*;

    #[test]
    fn preserves_plugin_identity_without_replacing_synchronous_browser_dialogs() {
        let upstream = tauri_plugin_dialog::init::<tauri::Wry>();
        // This regression is tied to the pinned native dependency, not a
        // hand-copied imitation of its injected script.
        let script = upstream.initialization_script_2().unwrap().script;
        assert!(script.contains("window.confirm=async"));
        assert!(script.contains("plugin:dialog|confirm"));

        let adapter = init::<tauri::Wry>();
        assert_eq!(adapter.name(), upstream.name());
        assert_eq!(adapter.name(), "dialog");
        assert!(adapter.initialization_script().is_none());
        assert!(adapter.initialization_script_2().is_none());
    }
}
