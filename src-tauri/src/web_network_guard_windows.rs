//! Windows-only frame and HTTP(S) request enforcement, shared with the isolated
//! native integration fixture. No Referer inference or JavaScript dependency.
//! Other socket protocols such as WebSocket/WebRTC are outside this contract.

use super::windows_api as windows61;
use std::sync::Arc;
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows61::core::{Interface, HSTRING, PWSTR};

/// A handler that could not decide a request or navigation, and the HRESULT it
/// ended with. Never the URL.
// The isolated fixtures install without causes and read neither field.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy)]
pub struct HandlerFault {
    pub handler: &'static str,
    pub code: i32,
}

/// The installation step that failed.
// The isolated fixtures keep only the error.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct InstallFault {
    pub step: &'static str,
    pub error: windows61::core::Error,
}

fn step(step: &'static str) -> impl Fn(windows61::core::Error) -> InstallFault {
    move |error| InstallFault { step, error }
}

/// Event handlers capture the core for fail-closed Stop. Explicit removal is
/// therefore required to break the COM reference cycle before closing the view.
pub struct InstalledGuard {
    core: ICoreWebView2,
    frame: Option<i64>,
    popup: Option<i64>,
    external: Option<i64>,
    resource: Option<i64>,
    resource_filter: bool,
    /// Set once every handler is in place. Only then was this a capability
    /// whose removal must stay latched.
    armed: bool,
}

impl Drop for InstalledGuard {
    fn drop(&mut self) {
        // Removing a mandatory handler immediately invalidates its capability.
        // Failure stays latched; dropping/reinstalling cannot reset protection.
        // An installation that never completed was never published as ready:
        // it only removes what it added, and its caller decides what follows.
        if self.armed {
            super::webview_origins::mark_frame_guard_failed();
        }
        unsafe {
            if let Some(token) = self.resource.take() {
                let _ = self.core.remove_WebResourceRequested(token);
            }
            if self.resource_filter {
                if let Ok(core) = self.core.cast::<ICoreWebView2_22>() {
                    let _ = core.RemoveWebResourceRequestedFilterWithRequestSourceKinds(
                        &HSTRING::from("*"),
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                    );
                }
            }
            if let Some(token) = self.frame.take() {
                let _ = self.core.remove_FrameNavigationStarting(token);
            }
            if let Some(token) = self.popup.take() {
                let _ = self.core.remove_NewWindowRequested(token);
            }
            if let Some(token) = self.external.take() {
                if let Ok(core) = self.core.cast::<ICoreWebView2_18>() {
                    let _ = core.remove_LaunchingExternalUriScheme(token);
                }
            }
        }
    }
}

/// Installs for a caller that reports no causes. A failed installation is
/// latched here, as it always was through this entry point.
// The application installs through `install_reporting`.
#[allow(dead_code)]
pub fn install(
    core: &ICoreWebView2,
    environment: &ICoreWebView2Environment,
    allows: Arc<dyn Fn(&str) -> bool + Send + Sync>,
    allows_resource: Arc<dyn Fn(&str) -> bool + Send + Sync>,
    failed: Arc<dyn Fn() + Send + Sync>,
) -> windows61::core::Result<InstalledGuard> {
    install_reporting(
        core,
        environment,
        allows,
        allows_resource,
        Arc::new(move |_| failed()),
    )
    .map_err(|fault| {
        super::webview_origins::mark_frame_guard_failed();
        fault.error
    })
}

/// Installs and names what failed: the step on an error, the handler on a
/// later fault. A failed installation is not latched here; nothing was
/// published as ready, so the caller may try once more before it latches.
pub fn install_reporting(
    core: &ICoreWebView2,
    environment: &ICoreWebView2Environment,
    allows: Arc<dyn Fn(&str) -> bool + Send + Sync>,
    allows_resource: Arc<dyn Fn(&str) -> bool + Send + Sync>,
    failed: Arc<dyn Fn(HandlerFault) + Send + Sync>,
) -> std::result::Result<InstalledGuard, InstallFault> {
    let mut installed = InstalledGuard {
        core: core.clone(),
        frame: None,
        popup: None,
        external: None,
        resource: None,
        resource_filter: false,
        armed: false,
    };
    let mut token = 0;
    let on_failure = failed.clone();
    let stop = core.clone();
    unsafe {
        // The older FrameNavigationStarting event can be too late to prevent
        // HTTP transmission. Enforce every resource category and source,
        // including nested frames and workers. Do not use the deprecated filter
        // that misses cross-origin iframes.
        core.cast::<ICoreWebView2_22>()
            .map_err(step("resource-filter"))?
            .AddWebResourceRequestedFilterWithRequestSourceKinds(
                &HSTRING::from("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            )
            .map_err(step("resource-filter"))?;
        installed.resource_filter = true;
        let environment = environment.clone();
        let resource_failed = failed.clone();
        let resource_stop = core.clone();
        core.add_WebResourceRequested(&WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
            let result = (|| -> windows61::core::Result<()> {
                let args = args.ok_or_else(windows61::core::Error::from_win32)?;
                let mut context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
                args.ResourceContext(&mut context)?;
                let uri = (|| {
                    let request = args.Request().ok()?;
                    let mut uri = PWSTR::null();
                    request.Uri(&mut uri).ok()?;
                    Some(take_pwstr(uri))
                })();
                let blocked = !uri.as_deref().is_some_and(|uri| allows_resource(uri));
                // Best-effort global diagnostics have no frame/session identity.
                // Never read body/headers or retain paths or query strings.
                if let Some(uri) = uri {
                    let method = (|| {
                        let request = args.Request().ok()?;
                        let mut method = PWSTR::null();
                        request.Method(&mut method).ok()?;
                        Some(take_pwstr(method))
                    })().unwrap_or_default();
                    let mut source = COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_NONE;
                    if let Ok(args2) = args.cast::<ICoreWebView2WebResourceRequestedEventArgs2>() {
                        let _ = args2.RequestedSourceKind(&mut source);
                    }
                    super::webview_origins::http_observations::record(&uri, &method, context.0, source.0, blocked);
                }
                if blocked {
                    let response = environment.CreateWebResourceResponse(None, 403,
                        &HSTRING::from("Blocked by application network policy"),
                        &HSTRING::from("Content-Length: 0\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'"))?;
                    args.SetResponse(&response)?;
                }
                Ok(())
            })();
            if let Err(error) = &result {
                resource_failed(HandlerFault { handler: "resource-request", code: error.code().0 });
                let _ = resource_stop.Stop();
            }
            result
        })), &mut token).map_err(step("resource-handler"))?;
        installed.resource = Some(token);

        core.add_FrameNavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                let result = (|| -> windows61::core::Result<()> {
                    let args = args.ok_or_else(windows61::core::Error::from_win32)?;
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    let uri = take_pwstr(uri);
                    // Missing/malformed URLs are denied; we never log the URL.
                    if allows(&uri) {
                        // Never undo a cancellation made by another native
                        // security/navigation handler.
                        Ok(())
                    } else {
                        args.SetCancel(true)
                    }
                })();
                if let Err(error) = &result {
                    on_failure(HandlerFault {
                        handler: "frame-navigation",
                        code: error.code().0,
                    });
                    let _ = stop.Stop();
                }
                result
            })),
            &mut token,
        )
        .map_err(step("frame-handler"))?;
        installed.frame = Some(token);

        // Website-created windows never become an unguarded second webview.
        // The app's explicit Open externally command does not use this event.
        let on_failure = failed.clone();
        let stop = core.clone();
        core.add_NewWindowRequested(
            &NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
                let result = args
                    .ok_or_else(windows61::core::Error::from_win32)
                    .and_then(|args| args.SetHandled(true));
                if let Err(error) = &result {
                    on_failure(HandlerFault {
                        handler: "new-window",
                        code: error.code().0,
                    });
                    let _ = stop.Stop();
                }
                result
            })),
            &mut token,
        )
        .map_err(step("popup-handler"))?;
        installed.popup = Some(token);

        let stop = core.clone();
        core.cast::<ICoreWebView2_18>()
            .map_err(step("external-scheme-handler"))?
            .add_LaunchingExternalUriScheme(
                &LaunchingExternalUriSchemeEventHandler::create(Box::new(move |_, args| {
                    let result = args
                        .ok_or_else(windows61::core::Error::from_win32)
                        .and_then(|args| args.SetCancel(true));
                    if let Err(error) = &result {
                        failed(HandlerFault {
                            handler: "external-scheme",
                            code: error.code().0,
                        });
                        let _ = stop.Stop();
                    }
                    result
                })),
                &mut token,
            )
            .map_err(step("external-scheme-handler"))?;
        installed.external = Some(token);
    }
    installed.armed = true;
    Ok(installed)
}
