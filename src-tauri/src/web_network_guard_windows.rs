//! Windows-only frame navigation enforcement, shared with the isolated native
//! integration fixture. No Referer inference or JavaScript timing dependency.
//! Deliberately not described as a WebSocket/WebRTC/resource-request firewall.

use super::windows_api as windows61;
use std::sync::Arc;
use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows61::core::{Interface, HSTRING, PWSTR};

/// Event handlers capture the core for fail-closed Stop. Explicit removal is
/// therefore required to break the COM reference cycle before closing the view.
pub struct InstalledGuard {
    core: ICoreWebView2,
    frame: Option<i64>,
    popup: Option<i64>,
    external: Option<i64>,
    resource: Option<i64>,
    resource_filter: bool,
}

impl Drop for InstalledGuard {
    fn drop(&mut self) {
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

pub fn install(
    core: &ICoreWebView2,
    environment: &ICoreWebView2Environment,
    allows: Arc<dyn Fn(&str) -> bool + Send + Sync>,
    allows_document: Arc<dyn Fn(&str) -> bool + Send + Sync>,
    failed: Arc<dyn Fn() + Send + Sync>,
) -> windows61::core::Result<InstalledGuard> {
    let mut installed = InstalledGuard {
        core: core.clone(),
        frame: None,
        popup: None,
        external: None,
        resource: None,
        resource_filter: false,
    };
    let mut token = 0;
    let on_failure = failed.clone();
    let stop = core.clone();
    unsafe {
        // The older FrameNavigationStarting event can be too late to prevent
        // HTTP transmission. This filter observes all resource categories, but
        // enforcement remains DOCUMENT-only, including nested frames. Do not
        // use the deprecated filter that misses cross-origin iframes.
        core.cast::<ICoreWebView2_22>()?
            .AddWebResourceRequestedFilterWithRequestSourceKinds(
                &HSTRING::from("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            )?;
        installed.resource_filter = true;
        let environment = environment.clone();
        let resource_failed = failed.clone();
        let resource_stop = core.clone();
        core.add_WebResourceRequested(&WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
            let result = (|| {
                let args = args.ok_or_else(windows61::core::Error::from_win32)?;
                let mut context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
                args.ResourceContext(&mut context)?;
                let uri = (|| {
                    let request = args.Request().ok()?;
                    let mut uri = PWSTR::null();
                    request.Uri(&mut uri).ok()?;
                    Some(take_pwstr(uri))
                })();
                let blocked = context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT
                    && !uri.as_deref().is_some_and(|uri| allows_document(uri));
                // Best-effort global diagnostics have no frame/session identity.
                // Never read body/headers or mutate a non-document request.
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
                        &HSTRING::from("Blocked by application navigation policy"),
                        &HSTRING::from("Content-Length: 0\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'"))?;
                    args.SetResponse(&response)?;
                }
                Ok(())
            })();
            if result.is_err() { resource_failed(); let _ = resource_stop.Stop(); }
            result
        })), &mut token)?;
        installed.resource = Some(token);

        core.add_FrameNavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                let result = (|| {
                    let args = args.ok_or_else(|| windows61::core::Error::from_win32())?;
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
                if result.is_err() {
                    on_failure();
                    let _ = stop.Stop();
                }
                result
            })),
            &mut token,
        )?;
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
                if result.is_err() {
                    on_failure();
                    let _ = stop.Stop();
                }
                result
            })),
            &mut token,
        )?;
        installed.popup = Some(token);

        let stop = core.clone();
        core.cast::<ICoreWebView2_18>()?
            .add_LaunchingExternalUriScheme(
                &LaunchingExternalUriSchemeEventHandler::create(Box::new(move |_, args| {
                    let result = args
                        .ok_or_else(windows61::core::Error::from_win32)
                        .and_then(|args| args.SetCancel(true));
                    if result.is_err() {
                        failed();
                        let _ = stop.Stop();
                    }
                    result
                })),
                &mut token,
            )?;
        installed.external = Some(token);
    }
    Ok(installed)
}
