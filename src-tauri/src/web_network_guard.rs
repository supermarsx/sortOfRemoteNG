//! Desktop integration for native Windows frame and HTTP(S) request enforcement.
//! macOS/Linux retain the parent/proxy CSP layer without native mediation status.

use crate::http::webview_origins;
#[cfg(target_os = "windows")]
use tauri::Manager;
#[cfg(target_os = "windows")]
use windows61 as windows_api;

#[cfg(target_os = "windows")]
#[path = "web_network_guard_windows.rs"]
mod windows;

#[cfg(target_os = "windows")]
thread_local! {
    static INSTALLED: std::cell::RefCell<Option<windows::InstalledGuard>> = const { std::cell::RefCell::new(None) };
}

pub fn close() {
    #[cfg(target_os = "windows")]
    INSTALLED.with(|slot| {
        slot.borrow_mut().take();
    });
}

#[tauri::command]
pub(crate) fn web_network_guard_status() -> webview_origins::FrameGuardStatus {
    webview_origins::frame_guard_status()
}

pub fn install(app: &tauri::App) {
    #[cfg(target_os = "windows")]
    {
        let config = app.config();
        let main = config
            .app
            .windows
            .iter()
            .find(|window| window.label == "main");
        let configured_url = if tauri::is_dev() {
            config.build.dev_url.as_ref()
        } else {
            match config.build.frontend_dist.as_ref() {
                Some(tauri::utils::config::FrontendDist::Url(url)) => Some(url),
                _ => None,
            }
        };
        let app_origin = configured_url
            .map(|url| url.origin().ascii_serialization())
            .unwrap_or_else(|| {
                if main.is_some_and(|window| window.use_https_scheme) {
                    "https://tauri.localhost".into()
                } else {
                    "http://tauri.localhost".into()
                }
            });
        // Tauri's Windows IPC custom protocol uses the window's configured
        // scheme even when the frontend runs on a development server.
        let ipc_origin = if main.is_some_and(|window| window.use_https_scheme) {
            "https://ipc.localhost"
        } else {
            "http://ipc.localhost"
        };
        let Some(webview) = app.get_webview_window("main") else {
            webview_origins::mark_frame_guard_failed();
            return;
        };
        if webview
            .with_webview(move |platform| {
                let result = unsafe { platform.controller().CoreWebView2() }.and_then(|core| {
                    windows::install(
                        &core,
                        &platform.environment(),
                        std::sync::Arc::new(webview_origins::allows_frame_url),
                        std::sync::Arc::new(move |url| {
                            webview_origins::allows_resource_url(url, &app_origin, Some(ipc_origin))
                        }),
                        std::sync::Arc::new(webview_origins::mark_frame_guard_failed),
                    )
                });
                if let Ok(guard) = result {
                    INSTALLED.with(|slot| {
                        *slot.borrow_mut() = Some(guard);
                    });
                    webview_origins::mark_frame_guard_ready();
                } else {
                    // The native proxy command remains refused; never continue by
                    // publishing an iframe without its mandatory Windows guard.
                    webview_origins::mark_frame_guard_failed();
                }
            })
            .is_err()
        {
            webview_origins::mark_frame_guard_failed();
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = app;
}
