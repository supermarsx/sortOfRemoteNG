//! Browser-owned form history is not the application's deliberate saved login.
//! Enforce this for every Tauri webview, including dynamically detached windows.
//! No HTML autocomplete attributes, website cookies, or existing profile data
//! are changed. WebView2 password autosave=false does not remove old passwords.
//!
//! Tauri 2.11's general-autofill switch is Windows-only. Its WebKit backends
//! expose no equivalent supported setting; do not claim a native guarantee on
//! those platforms or use private WebKit preferences to manufacture one.

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("webview-form-privacy")
        .on_webview_ready(|webview| {
            #[cfg(target_os = "windows")]
            install_windows(webview);
            #[cfg(not(target_os = "windows"))]
            let _ = webview;
        })
        .build()
}

#[cfg(any(target_os = "windows", test))]
#[path = "webview_privacy_settings.rs"]
mod settings;

#[cfg(target_os = "windows")]
fn install_windows<R: tauri::Runtime>(webview: tauri::Webview<R>) {
    use settings::{enforce, FormPrivacySettings};
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4;
    use windows61::core::{Interface, BOOL};

    struct Settings(ICoreWebView2Settings4);
    impl FormPrivacySettings for Settings {
        fn disable_general_autofill(&mut self) -> Result<(), ()> {
            unsafe { self.0.SetIsGeneralAutofillEnabled(false) }.map_err(|_| ())
        }
        fn disable_password_autosave(&mut self) -> Result<(), ()> {
            unsafe { self.0.SetIsPasswordAutosaveEnabled(false) }.map_err(|_| ())
        }
        fn general_autofill_enabled(&self) -> Result<bool, ()> {
            let mut enabled = BOOL::default();
            unsafe { self.0.IsGeneralAutofillEnabled(&mut enabled) }.map_err(|_| ())?;
            Ok(enabled.as_bool())
        }
        fn password_autosave_enabled(&self) -> Result<bool, ()> {
            let mut enabled = BOOL::default();
            unsafe { self.0.IsPasswordAutosaveEnabled(&mut enabled) }.map_err(|_| ())?;
            Ok(enabled.as_bool())
        }
    }

    let failed_view = webview.clone();
    if webview
        .with_webview(move |platform| {
            let core = unsafe { platform.controller().CoreWebView2() };
            let result = core.as_ref().map_err(|_| ()).and_then(|core| {
                let settings = unsafe { core.Settings() }.map_err(|_| ())?;
                let settings = settings.cast::<ICoreWebView2Settings4>().map_err(|_| ())?;
                enforce(&mut Settings(settings))
            });
            if result.is_err() {
                if let Ok(core) = core {
                    let _ = unsafe { core.Stop() };
                }
                privacy_failure(failed_view);
            }
        })
        .is_err()
    {
        privacy_failure(webview);
    }
}

#[cfg(target_os = "windows")]
fn privacy_failure<R: tauri::Runtime>(webview: tauri::Webview<R>) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

    // Do not leave an interactable view after a mandatory engine setting fails.
    // The asynchronous OS dialog avoids blocking the UI event loop and reports
    // only fixed text, never a URL, profile path, field value, or native error.
    tracing::error!("Embedded browser form-history privacy could not be enforced");
    let window = webview.window();
    let _ = window.hide();
    // Stop the actual webview immediately, not after the user dismisses the
    // dialog. Keep its empty native window until then so startup has visible
    // error feedback instead of silently terminating.
    let _ = webview.close();
    webview
        .dialog()
        .message("The embedded browser could not disable form-history saving. This window will close to protect typed values. Update the Microsoft Edge WebView2 Runtime, then reopen the application. No saved application data was deleted.")
        .title("Browser privacy unavailable")
        .kind(MessageDialogKind::Error)
        .show(move |_| {
            let _ = window.destroy();
        });
}
