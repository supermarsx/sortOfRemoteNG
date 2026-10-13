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

/// What a failed installation leads to, and the one line a latch leaves.
/// Plain data: compiled and tested on every platform, used on Windows only.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod policy {
    use std::sync::atomic::{AtomicBool, Ordering};

    /// Pause before the single retry of a failed installation.
    pub(super) const RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(500);

    /// Why an installation attempt ended without a guard. Fixed words and an
    /// HRESULT only: never a URL, a path or an OS message.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(super) enum InstallFailure {
        MainWindowMissing,
        DispatchRejected,
        CoreUnavailable(i32),
        Step { step: &'static str, code: i32 },
    }

    impl std::fmt::Display for InstallFailure {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            match self {
                Self::MainWindowMissing => f.write_str("main-window-missing"),
                Self::DispatchRejected => f.write_str("webview-dispatch-rejected"),
                Self::CoreUnavailable(code) => {
                    write!(f, "core-webview-unavailable hresult=0x{code:08X}")
                }
                Self::Step { step, code } => write!(f, "{step} hresult=0x{code:08X}"),
            }
        }
    }

    /// Why the guard is latched failed until the application restarts.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(super) enum LatchCause {
        /// The installation and its single retry both failed.
        Install {
            first: InstallFailure,
            retry: InstallFailure,
        },
        /// An installed handler could not decide a request or navigation.
        Handler { handler: &'static str, code: i32 },
    }

    impl std::fmt::Display for LatchCause {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            match self {
                Self::Install { first, retry } => {
                    write!(f, "stage=install cause={retry} first_attempt={first}")
                }
                Self::Handler { handler, code } => {
                    write!(f, "stage=handler cause={handler} hresult=0x{code:08X}")
                }
            }
        }
    }

    /// What follows a failed installation attempt.
    #[derive(Debug, PartialEq, Eq)]
    pub(super) enum AfterFailure {
        Retry,
        Latch(LatchCause),
    }

    /// Installation is retried exactly once. Until the retry has failed the
    /// guard reads "initializing" and every proxy start is refused, so the
    /// wait never exposes a frame without its guard.
    pub(super) fn after_failure(
        first: Option<InstallFailure>,
        failure: InstallFailure,
    ) -> AfterFailure {
        match first {
            None => AfterFailure::Retry,
            Some(first) => AfterFailure::Latch(LatchCause::Install {
                first,
                retry: failure,
            }),
        }
    }

    /// The line a latch leaves, the first time only: a handler that failed
    /// once fails again for every later request.
    pub(super) fn latch_report(reported: &AtomicBool, cause: LatchCause) -> Option<String> {
        if reported.swap(true, Ordering::SeqCst) {
            return None;
        }
        Some(format!(
            "Website navigation guard latched failed until restart: {cause}; website tabs that use the embedded proxy are refused"
        ))
    }
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
    attempt_install(app.handle(), None);
    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

/// The only place that latches the guard failed, so every latch leaves its
/// cause in the log. The latch stays for this process: a handler that could
/// not decide may have let a request through, and readiness is published once.
#[cfg(target_os = "windows")]
fn latch(cause: policy::LatchCause) {
    static REPORTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if let Some(line) = policy::latch_report(&REPORTED, cause) {
        log::error!("{line}");
    }
    webview_origins::mark_frame_guard_failed();
}

#[cfg(target_os = "windows")]
fn install_failed(
    app: &tauri::AppHandle,
    first: Option<policy::InstallFailure>,
    failure: policy::InstallFailure,
) {
    match policy::after_failure(first, failure) {
        policy::AfterFailure::Retry => {
            log::warn!(
                "Website navigation guard stage=install cause={failure}; retrying once in {} ms",
                policy::RETRY_DELAY.as_millis()
            );
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(policy::RETRY_DELAY).await;
                attempt_install(&app, Some(failure));
            });
        }
        policy::AfterFailure::Latch(cause) => latch(cause),
    }
}

/// `first` is the failure of the earlier attempt when this is the retry.
#[cfg(target_os = "windows")]
fn attempt_install(app: &tauri::AppHandle, first: Option<policy::InstallFailure>) {
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
        install_failed(app, first, policy::InstallFailure::MainWindowMissing);
        return;
    };
    let on_main = app.clone();
    let dispatched = webview.with_webview(move |platform| {
        let result = unsafe { platform.controller().CoreWebView2() }
            .map_err(|error| policy::InstallFailure::CoreUnavailable(error.code().0))
            .and_then(|core| {
                windows::install_reporting(
                    &core,
                    &platform.environment(),
                    std::sync::Arc::new(webview_origins::allows_frame_url),
                    std::sync::Arc::new(move |url| {
                        webview_origins::allows_resource_url(url, &app_origin, Some(ipc_origin))
                    }),
                    std::sync::Arc::new(|fault: windows::HandlerFault| {
                        latch(policy::LatchCause::Handler {
                            handler: fault.handler,
                            code: fault.code,
                        })
                    }),
                )
                .map_err(|fault| policy::InstallFailure::Step {
                    step: fault.step,
                    code: fault.error.code().0,
                })
            });
        match result {
            Ok(guard) => {
                INSTALLED.with(|slot| {
                    *slot.borrow_mut() = Some(guard);
                });
                webview_origins::mark_frame_guard_ready();
                if let Some(first) = first {
                    log::info!(
                        "Website navigation guard installed on the retry; first attempt cause={first}"
                    );
                }
            }
            // The native proxy command remains refused; never continue by
            // publishing an iframe without its mandatory Windows guard.
            Err(failure) => install_failed(&on_main, first, failure),
        }
    });
    if dispatched.is_err() {
        install_failed(app, first, policy::InstallFailure::DispatchRejected);
    }
}
