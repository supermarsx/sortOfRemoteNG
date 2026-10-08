//! Native request admission for one immutable browser attempt.
//!
//! These handlers neither establish proxy containment nor report host readiness.
//! The owner must install the private proxy before browser creation and retain
//! it for the entire context lifetime. Only native CEF callbacks may supply the
//! challenge metadata below; no page/IPC-provided authentication is accepted.

use crate::domain_permissions::{
    canonical_browser_request_origin, EffectiveWebsitePermission, WebsitePermissionDecision,
    WebsitePermissionEngine, WebsitePermissionQuery,
};
use cef::rc::Rc;
use cef::*;
use sorng_protocols::origin_browser::{
    BrowserIdentity, BrowserSessionStatus, NativeProxyChallenge, OriginBrowserSession,
};
use std::os::raw::c_int;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, MutexGuard,
};

#[path = "native_recording.rs"]
pub mod recording;
#[path = "cef_recording.rs"]
mod recording_callbacks;

/// Create once for a newly created native browser whose initial URL is the
/// host-generated literal `about:blank`. Do not share this handler between
/// browsers or attach it to an already navigated browser. Only that initial,
/// empty main-frame navigation has a one-use bootstrap exception.
/// This compatibility constructor denies all network requests. Native hosts
/// reuse the explicit snapshot installed in their PrivateRequestContext.
pub fn request_handler(
    session: Arc<Mutex<OriginBrowserSession>>,
    identity: BrowserIdentity,
) -> RequestHandler {
    request_handler_with_lifecycle(session, identity, deny_permissions(), None)
}

/// Compatibility constructors must never become a policy-free admission path.
pub(crate) fn deny_permissions() -> Arc<WebsitePermissionEngine> {
    Arc::new(
        WebsitePermissionEngine::new(None, None, &Default::default())
            .expect("the empty native permission snapshot is valid"),
    )
}

/// Native UI-thread notifications only. These callbacks cannot grant readiness
/// or alter request admission. They receive no credentials or page strings.
pub(crate) trait RequestLifecycle: Send + Sync {
    fn renderer_fault(&self, browser: Option<&Browser>);
    fn main_document_available(&self, browser: Option<&Browser>);
}

pub(crate) fn request_handler_with_lifecycle(
    session: Arc<Mutex<OriginBrowserSession>>,
    identity: BrowserIdentity,
    permissions: Arc<WebsitePermissionEngine>,
    lifecycle: Option<Arc<dyn RequestLifecycle>>,
) -> RequestHandler {
    SessionRequestHandler::new(
        session,
        identity,
        Arc::new(AtomicBool::new(true)),
        permissions,
        lifecycle,
    )
}

fn renderer_failed(
    session: &Mutex<OriginBrowserSession>,
    identity: &BrowserIdentity,
    lifecycle: Option<&dyn RequestLifecycle>,
    browser: Option<&Browser>,
) {
    // Revoke even when CEF supplies no browser, before any user/native callback.
    revoke_attempt(session, identity);
    if let Some(lifecycle) = lifecycle {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            lifecycle.renderer_fault(browser);
        }));
    }
    // The lifecycle owner queues fenced native cleanup. Never perform a second
    // inline close here: Alloy can synchronously reenter DoClose/destruction.
    // Without an owner (or if it panics), stay revoked; do not close an unknown
    // parent or bypass the owner's cleanup sequencing as a fallback.
}

/// Create a fresh handler for EACH request, including request-context callbacks
/// for service workers without a browser or frame. There is no blank-page or
/// worker exception to the exact-origin resource policy. This compatibility
/// constructor lacks trusted native metadata and therefore always denies.
///
/// Callbacks carrying request/download metadata must use
/// [`context_resource_handler`] instead, to retain their initial denial state.
/// The host separately authorizes downloads discovered from response headers
/// through its owner-bound DownloadHandler and native Save dialog. Request
/// admission never authorizes a filesystem write or changes the network route.
pub fn resource_handler(
    session: Arc<Mutex<OriginBrowserSession>>,
    identity: BrowserIdentity,
) -> ResourceRequestHandler {
    resource_handler_with_denial(session, identity, deny_permissions(), None, true)
}

/// Shared admission for browser and request-context callbacks. Browser/frame
/// absence is valid for worker requests, but missing request/disable metadata
/// is not. Always returns a handler, including an irrevocably denied handler
/// when CEF supplies no writable disable flag. Never falls through to a default
/// loader or another context's policy.
#[allow(clippy::too_many_arguments)]
pub(crate) fn context_resource_handler(
    session: Arc<Mutex<OriginBrowserSession>>,
    identity: BrowserIdentity,
    permissions: Arc<WebsitePermissionEngine>,
    request: Option<&Request>,
    is_navigation: c_int,
    is_download: c_int,
    request_initiator: Option<&CefString>,
    worker_context: bool,
    verified_navigation_frame: bool,
    disable_default_handling: Option<&mut c_int>,
) -> ResourceRequestHandler {
    let scope = request.and_then(|request| {
        ResourceScope::from_native(
            request.resource_type(),
            is_navigation,
            request_initiator,
            worker_context,
            verified_navigation_frame,
        )
    });
    let allowed =
        scoped_request_allowed(&session, &identity, &permissions, scope.as_ref(), request);
    // Download navigation still needs the same origin/class/route approval.
    // File writes are separately admitted by the owner-bound DownloadHandler;
    // blanket cancellation here used to prevent that handler from running.
    let denied = !matches!(is_download, 0 | 1)
        || !matches!(is_navigation, 0 | 1)
        || disable_default_handling.is_none()
        || !allowed;
    if denied {
        if let Some(disable) = disable_default_handling {
            *disable = 1;
        }
    }
    // Do not reset an already-set disable flag for an approved request.
    resource_handler_with_denial(session, identity, permissions, scope, denied)
}

fn resource_handler_with_denial(
    session: Arc<Mutex<OriginBrowserSession>>,
    identity: BrowserIdentity,
    permissions: Arc<WebsitePermissionEngine>,
    scope: Option<ResourceScope>,
    denied: bool,
) -> ResourceRequestHandler {
    SessionResourceRequestHandler::new(
        session,
        identity,
        permissions,
        scope,
        Arc::new(AtomicBool::new(denied)),
        Arc::new(Mutex::new(None)),
    )
}

/// The only resource classification boundary. Labels are derived from native
/// CEF enums, never headers, URLs, file extensions, request bodies or page IPC.
/// Unmapped transports (including WebSocket), plugins, prefetch and navigation
/// preload remain denied until their distinct native coverage is reviewed.
fn native_request_class(kind: ResourceType) -> Option<&'static str> {
    match kind {
        ResourceType::MAIN_FRAME => Some("navigation"),
        ResourceType::SUB_FRAME => Some("frame"),
        ResourceType::SCRIPT => Some("script"),
        ResourceType::STYLESHEET => Some("stylesheet"),
        ResourceType::FONT_RESOURCE => Some("font"),
        ResourceType::IMAGE | ResourceType::MEDIA | ResourceType::FAVICON => Some("image-media"),
        ResourceType::XHR => Some("fetch-xhr"),
        ResourceType::WORKER | ResourceType::SHARED_WORKER | ResourceType::SERVICE_WORKER => {
            Some("worker")
        }
        _ => None,
    }
}

/// Frozen metadata for one native resource and its redirects. No raw URL, page
/// strings, credentials or global/renderer policy registry is retained here.
#[derive(Clone)]
struct ResourceScope {
    kind: ResourceType,
    initiator: Option<String>,
    worker_context: bool,
    // CEF's navigation-loader factory uses an opaque origin, not the
    // requesting document's origin. Never treat it as a first-party origin.
    navigation_factory: bool,
}

pub(crate) fn verified_navigation_frame(
    browser: Option<&Browser>,
    frame: Option<&Frame>,
    request: Option<&Request>,
    is_navigation: c_int,
) -> bool {
    let (Some(browser), Some(frame), Some(request)) = (browser, frame, request) else {
        return false;
    };
    is_navigation == 1
        && browser.is_valid() == 1
        && frame.is_valid() == 1
        && frame
            .browser()
            .is_some_and(|owner| owner.identifier() == browser.identifier())
        && matches!(
            (request.resource_type(), frame.is_main()),
            (ResourceType::MAIN_FRAME, 1) | (ResourceType::SUB_FRAME, 0)
        )
}

impl ResourceScope {
    fn from_native(
        kind: ResourceType,
        is_navigation: c_int,
        initiator: Option<&CefString>,
        worker_context: bool,
        verified_navigation_frame: bool,
    ) -> Option<Self> {
        let class = native_request_class(kind)?;
        if !matches!(is_navigation, 0 | 1)
            || (is_navigation == 1) != matches!(class, "navigation" | "frame")
        {
            return None;
        }
        // Bound native-to-Rust string allocation before converting. In pinned
        // CEF, the navigation-loader factory serializes url::Origin() as
        // "null" even for ordinary HTTPS navigation. This is NOT document
        // provenance. Permit that native navigation under the same explicit
        // destination/class policy as OnBeforeBrowse, never as a script/worker
        // origin or as evidence of user gesture, host initiation or consent.
        let navigation_factory = !worker_context
            && verified_navigation_frame
            && is_navigation == 1
            && matches!(class, "navigation" | "frame")
            && initiator
                .and_then(CefString::as_slice)
                .is_some_and(|value| value == [110, 117, 108, 108]);
        let initiator = match initiator.and_then(CefString::as_slice) {
            None | Some([]) => None,
            Some(_) if navigation_factory => None,
            Some(value) if value.len() <= 2048 => {
                Some(canonical_browser_request_origin(&String::from_utf16(value).ok()?).ok()?)
            }
            _ => return None,
        };
        Some(Self {
            kind,
            initiator,
            worker_context,
            navigation_factory,
        })
    }
}

fn resolve_resource(
    session: &OriginBrowserSession,
    identity: &BrowserIdentity,
    permissions: &WebsitePermissionEngine,
    scope: &ResourceScope,
    url: &str,
) -> EffectiveWebsitePermission {
    let class = native_request_class(scope.kind).unwrap_or("");
    let destination = session.authorize_navigation(identity, url).ok();
    let destination_origin = destination
        .as_ref()
        .map(|url| url.origin().ascii_serialization());
    let website = session.policy().source_origin();
    let initiator_allowed = if scope.navigation_factory {
        !scope.worker_context
            && scope.initiator.is_none()
            && matches!(class, "navigation" | "frame")
    } else {
        match scope.initiator.as_deref() {
            Some(origin) => session.authorize_navigation(identity, origin).is_ok(),
            None => class == "navigation" && !scope.worker_context,
        }
    };
    let is_worker = class == "worker" || scope.worker_context;
    // Network/frame/script allowances never imply permission to start a worker
    // for a third-party origin. Browser-less callbacks also need an explicit
    // first-party worker grant in addition to their own resource class.
    let worker_allowed = !is_worker
        || (scope.initiator.as_deref() == Some(website)
            && (class != "worker" || destination_origin.as_deref() == Some(website))
            && permissions
                .resolve(WebsitePermissionQuery {
                    website_origin: website,
                    destination_origin: website,
                    request_class: "worker",
                    native_denied: destination.is_none() || !initiator_allowed,
                })
                .decision
                == WebsitePermissionDecision::Allow);
    permissions.resolve(WebsitePermissionQuery {
        website_origin: website,
        destination_origin: destination_origin.as_deref().unwrap_or(""),
        request_class: class,
        native_denied: destination.is_none() || !initiator_allowed || !worker_allowed,
    })
}

fn scoped_request_allowed(
    session: &Mutex<OriginBrowserSession>,
    identity: &BrowserIdentity,
    permissions: &WebsitePermissionEngine,
    scope: Option<&ResourceScope>,
    request: Option<&Request>,
) -> bool {
    let Some(session) = lock_attempt(session, identity) else {
        return false;
    };
    let (Some(scope), Some(request)) = (scope, request) else {
        return false;
    };
    scope.kind == request.resource_type()
        && resolve_resource(
            &session,
            identity,
            permissions,
            scope,
            &CefString::from(&request.url()).to_string(),
        )
        .decision
            == WebsitePermissionDecision::Allow
}

/// UI-thread navigation uses native main/sub-frame identity: CEF resource_type
/// is only authoritative on the IO thread. Its later resource callback must
/// independently pass the stricter initiator/class/worker checks above.
pub(crate) fn navigation_allowed(
    session: &OriginBrowserSession,
    identity: &BrowserIdentity,
    permissions: &WebsitePermissionEngine,
    url: &str,
    main_frame: bool,
) -> bool {
    let destination = session.authorize_navigation(identity, url).ok();
    let origin = destination
        .as_ref()
        .map(|url| url.origin().ascii_serialization());
    permissions
        .resolve(WebsitePermissionQuery {
            website_origin: session.policy().source_origin(),
            destination_origin: origin.as_deref().unwrap_or(""),
            request_class: if main_frame { "navigation" } else { "frame" },
            native_denied: destination.is_none(),
        })
        .decision
        == WebsitePermissionDecision::Allow
}

#[cfg(test)]
fn url_allowed(
    session: &Mutex<OriginBrowserSession>,
    identity: &BrowserIdentity,
    url: &str,
) -> bool {
    lock_attempt(session, identity)
        .is_some_and(|session| session.authorize_navigation(identity, url).is_ok())
}

/// Poison denies the operation AND terminates the matching attempt's retained
/// transport. Recovery is only for revocation, never admission or credential
/// release. Reuse this recovered guard; locking again would deadlock. Leave
/// poison set and let identity fencing protect a successor from stale callbacks.
fn lock_attempt<'a>(
    session: &'a Mutex<OriginBrowserSession>,
    identity: &BrowserIdentity,
) -> Option<MutexGuard<'a, OriginBrowserSession>> {
    match session.lock() {
        Ok(session) => Some(session),
        Err(poisoned) => {
            let mut session = poisoned.into_inner();
            let _ = session.revoke(identity);
            None
        }
    }
}

#[cfg(test)]
fn request_allowed(
    session: &Mutex<OriginBrowserSession>,
    identity: &BrowserIdentity,
    request: Option<&Request>,
) -> bool {
    let Some(session) = lock_attempt(session, identity) else {
        return false;
    };
    request.is_some_and(|request| {
        session
            .authorize_navigation(identity, &CefString::from(&request.url()).to_string())
            .is_ok()
    })
}

fn take_bootstrap(
    session: &Mutex<OriginBrowserSession>,
    identity: &BrowserIdentity,
    pending: &AtomicBool,
    is_local_empty_main_frame: bool,
) -> bool {
    // Consume even a rejected first navigation. A later page cannot acquire a
    // blank-page exception by returning to an empty URL or failing admission.
    let initial = pending.swap(false, Ordering::AcqRel);
    lock_attempt(session, identity).is_some_and(|session| {
        initial
            && is_local_empty_main_frame
            && session.policy().identity() == identity
            && session.status() == BrowserSessionStatus::NotReady
    })
}

fn revoke_attempt(session: &Mutex<OriginBrowserSession>, identity: &BrowserIdentity) {
    // A poisoned lock must never authorize traffic or credentials. Recover it
    // ONLY to close this same attempt; a stale identity cannot revoke a successor.
    let mut session = match session.lock() {
        Ok(session) => session,
        Err(poisoned) => poisoned.into_inner(),
    };
    let _ = session.revoke(identity);
}

/// Retain native argument validity before narrowing CEF integers or strings.
/// In particular, a negative/overflowing port must not wrap to the relay port.
struct AuthMetadata<'a> {
    is_proxy: c_int,
    host: Option<&'a str>,
    port: c_int,
    realm: Option<&'a str>,
    scheme: Option<&'a str>,
}

impl<'a> AuthMetadata<'a> {
    fn challenge(self) -> Option<NativeProxyChallenge<'a>> {
        if self.is_proxy != 1 {
            return None;
        }
        let port = u16::try_from(self.port).ok().filter(|port| *port != 0)?;
        Some(NativeProxyChallenge {
            is_proxy: true,
            host: self.host.filter(|value| !value.is_empty())?,
            port,
            realm: self.realm.filter(|value| !value.is_empty())?,
            scheme: self.scheme.filter(|value| !value.is_empty())?,
        })
    }
}

// Keep completion separate from CEF allocation so the actual single-completion
// path can be tested without initializing a native engine or fabricating FFI
// callback pointers. Implementations must never store or log the credentials.
trait AuthCompletion {
    fn continue_with(&self, username: &str, password: &str);
    fn cancel(&self);
}

impl AuthCompletion for AuthCallback {
    fn continue_with(&self, username: &str, password: &str) {
        self.cont(
            Some(&CefString::from(username)),
            Some(&CefString::from(password)),
        );
    }

    fn cancel(&self) {
        ImplAuthCallback::cancel(self);
    }
}

fn complete_auth(
    session: &Mutex<OriginBrowserSession>,
    identity: &BrowserIdentity,
    metadata: AuthMetadata<'_>,
    callback: Option<&impl AuthCompletion>,
) -> c_int {
    let answered = {
        // Check poison even when callback/challenge metadata is absent. Drop
        // the guard before cancellation; no nested callback can retain it.
        let session = lock_attempt(session, identity);
        callback.is_some_and(|callback| {
            metadata.challenge().is_some_and(|challenge| {
                session.as_ref().is_some_and(|session| {
                    // Sole credential release path. Keep the healthy guard
                    // until native completion; never retain credentials across
                    // a task or release them from recovered poisoned state.
                    session
                        .answer_proxy_challenge(identity, challenge, |user, password| {
                            callback.continue_with(user, password);
                        })
                        .is_some()
                })
            })
        })
    };
    let Some(callback) = callback else {
        return 0;
    };
    if !answered {
        callback.cancel();
    }
    // Completed exactly once, including explicit cancellation. Only a missing
    // callback uses CEF's immediate return-false cancellation.
    1
}

wrap_request_handler! {
    struct SessionRequestHandler {
        session: Arc<Mutex<OriginBrowserSession>>,
        identity: BrowserIdentity,
        bootstrap_pending: Arc<AtomicBool>,
        permissions: Arc<WebsitePermissionEngine>,
        lifecycle: Option<Arc<dyn RequestLifecycle>>,
    }

    impl RequestHandler {
        fn on_open_urlfrom_tab(
            &self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            _target_url: Option<&CefString>, _target_disposition: WindowOpenDisposition,
            _user_gesture: c_int,
        ) -> c_int { 1 }

        fn on_select_client_certificate(
            &self, _browser: Option<&mut Browser>, _is_proxy: c_int,
            _host: Option<&CefString>, _port: c_int,
            _certificates: Option<&[Option<X509Certificate>]>,
            callback: Option<&mut SelectClientCertificateCallback>,
        ) -> c_int {
            if let Some(callback) = callback { callback.select(None); }
            1
        }

        fn on_render_process_terminated(
            &self, browser: Option<&mut Browser>, _status: TerminationStatus,
            _error_code: c_int, _error_string: Option<&CefString>,
        ) {
            renderer_failed(&self.session, &self.identity, self.lifecycle.as_deref(), browser.as_deref());
        }

        fn on_render_process_unresponsive(
            &self, browser: Option<&mut Browser>, callback: Option<&mut UnresponsiveProcessCallback>,
        ) -> c_int {
            renderer_failed(&self.session, &self.identity, self.lifecycle.as_deref(), browser.as_deref());
            if let Some(callback) = callback { callback.terminate(); }
            1
        }

        fn on_document_available_in_main_frame(&self, browser: Option<&mut Browser>) {
            if let Some(lifecycle) = self.lifecycle.as_deref() {
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    lifecycle.main_document_available(browser.as_deref());
                })).is_err() {
                    renderer_failed(&self.session, &self.identity, Some(lifecycle), browser.as_deref());
                }
            }
        }

        fn on_before_browse(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            request: Option<&mut Request>,
            user_gesture: c_int,
            is_redirect: c_int,
        ) -> c_int {
            let (Some(browser), Some(frame), Some(request)) = (browser, frame, request) else {
                self.bootstrap_pending.store(false, Ordering::Release);
                drop(lock_attempt(&self.session, &self.identity));
                return 1;
            };
            let url = CefString::from(&request.url()).to_string();
            let is_local_empty_main_frame = browser.is_valid() == 1
                && frame.is_valid() == 1
                && frame.is_main() == 1
                && browser.has_document() == 0
                && matches!(CefString::from(&frame.url()).to_string().as_str(), "" | "about:blank")
                && url == "about:blank"
                && CefString::from(&request.method()).to_string() == "GET"
                && CefString::from(&request.referrer_url()).to_string().is_empty()
                && request.post_data().is_none()
                && user_gesture == 0
                && is_redirect == 0;
            if take_bootstrap(
                &self.session,
                &self.identity,
                &self.bootstrap_pending,
                is_local_empty_main_frame,
            ) {
                return 0;
            }
            if browser.is_valid() != 1
                || frame.is_valid() != 1
                || !matches!(frame.is_main(), 0 | 1)
                || !matches!(user_gesture, 0 | 1)
                || !matches!(is_redirect, 0 | 1)
            {
                return 1;
            }
            c_int::from(!lock_attempt(&self.session, &self.identity).is_some_and(|session| {
                navigation_allowed(&session, &self.identity, &self.permissions, &url, frame.is_main() == 1)
            }))
        }

        fn resource_request_handler(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            request: Option<&mut Request>,
            is_navigation: c_int,
            is_download: c_int,
            request_initiator: Option<&CefString>,
            disable_default_handling: Option<&mut c_int>,
        ) -> Option<ResourceRequestHandler> {
            // Never return None: that would opt into default/context handling.
            let navigation_frame = verified_navigation_frame(browser.as_deref(), frame.as_deref(), request.as_deref(), is_navigation);
            Some(context_resource_handler(
                self.session.clone(), self.identity.clone(), self.permissions.clone(), request.as_deref(),
                is_navigation, is_download, request_initiator, browser.is_none() || frame.is_none(), navigation_frame, disable_default_handling,
            ))
        }

        fn auth_credentials(
            &self,
            _browser: Option<&mut Browser>,
            _origin_url: Option<&CefString>,
            is_proxy: c_int,
            host: Option<&CefString>,
            port: c_int,
            realm: Option<&CefString>,
            scheme: Option<&CefString>,
            callback: Option<&mut AuthCallback>,
        ) -> c_int {
            let host = host.map(ToString::to_string);
            let realm = realm.map(ToString::to_string);
            let scheme = scheme.map(ToString::to_string);
            let metadata = AuthMetadata {
                is_proxy, host: host.as_deref(), port,
                realm: realm.as_deref(), scheme: scheme.as_deref(),
            };
            complete_auth(&self.session, &self.identity, metadata, callback.as_deref())
        }
    }
}

wrap_resource_request_handler! {
    struct SessionResourceRequestHandler {
        session: Arc<Mutex<OriginBrowserSession>>,
        identity: BrowserIdentity,
        permissions: Arc<WebsitePermissionEngine>,
        scope: Option<ResourceScope>,
        denied: Arc<AtomicBool>,
        recording: Arc<Mutex<Option<recording::Capture>>>,
    }

    impl ResourceRequestHandler {
        fn on_before_resource_load(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            request: Option<&mut Request>,
            callback: Option<&mut Callback>,
        ) -> ReturnValue {
            let allowed = scoped_request_allowed(&self.session, &self.identity, &self.permissions, self.scope.as_ref(), request.as_deref());
            if self.denied.load(Ordering::Acquire)
                || callback.is_none()
                || !allowed
            {
                self.denied.store(true, Ordering::Release);
                ReturnValue::CANCEL
            } else {
                recording_callbacks::start(&self.recording, &self.identity, request.as_deref());
                // Synchronous decision; never invoke the async callback too.
                ReturnValue::CONTINUE
            }
        }

        fn on_resource_redirect(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            request: Option<&mut Request>,
            response: Option<&mut Response>,
            new_url: Option<&mut CefString>,
        ) {
            let allowed = !self.denied.load(Ordering::Acquire)
                && response.is_some()
                && scoped_request_allowed(&self.session, &self.identity, &self.permissions, self.scope.as_ref(), request.as_deref())
                && new_url.as_deref().is_some_and(|url| {
                    lock_attempt(&self.session, &self.identity).is_some_and(|session| {
                        self.scope.as_ref().is_some_and(|scope| {
                            resolve_resource(&session, &self.identity, &self.permissions, scope, &url.to_string()).decision
                                == WebsitePermissionDecision::Allow
                        })
                    })
                });
            recording_callbacks::redirect(&self.recording, request.as_deref(), response.as_deref(), new_url.as_deref(), allowed);
            if !allowed {
                self.denied.store(true, Ordering::Release);
                // CEF has no cancel return for this callback. Revoke transport
                // even if the mutable URL argument is absent/unwritable. This
                // also covers an ungranted scheme on an otherwise granted port.
                revoke_attempt(&self.session, &self.identity);
                if let Some(url) = new_url {
                    let _ = url.try_set("about:blank#blocked-native-request");
                }
            }
        }

        fn on_resource_load_complete(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _request: Option<&mut Request>,
            response: Option<&mut Response>,
            status: UrlrequestStatus,
            received_content_length: i64,
        ) {
            recording_callbacks::complete(&self.recording, response.as_deref(), status, received_content_length);
        }

        fn on_protocol_execution(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _request: Option<&mut Request>,
            allow_os_execution: Option<&mut c_int>,
        ) {
            drop(lock_attempt(&self.session, &self.identity));
            if let Some(allow) = allow_os_execution {
                *allow = 0;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    include!("cef_recording_tests.rs");
    use crate::domain_permissions::{
        WebsiteDestinationPermissions, WebsiteDomainPermissionsSettings, WebsiteOriginPermissions,
        WebsitePermissionSetting, WebsitePermissionSource, WebsiteRequestClass,
    };
    use base64::Engine;
    use sorng_protocols::origin_browser::{NativeHostReadiness, OriginBrowserPolicy};
    use sorng_protocols::private_forward_proxy::{Authority, BoxedStream, DialFuture, ProxyLimits};
    use std::cell::Cell;
    use std::io;
    use std::time::Duration;
    use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt, DuplexStream};
    use tokio::net::TcpStream;
    use tokio::time::timeout;
    use zeroize::Zeroizing;

    #[derive(Default)]
    struct Completion {
        continued: Cell<usize>,
        cancelled: Cell<usize>,
        nonempty_credentials: Cell<bool>,
    }

    impl AuthCompletion for Completion {
        fn continue_with(&self, username: &str, password: &str) {
            self.continued.set(self.continued.get() + 1);
            self.nonempty_credentials
                .set(!username.is_empty() && !password.is_empty());
        }

        fn cancel(&self) {
            self.cancelled.set(self.cancelled.get() + 1);
        }
    }

    async fn session() -> (Mutex<OriginBrowserSession>, BrowserIdentity) {
        session_with_origins(&[]).await
    }

    async fn session_with_origins(
        origins: &[&str],
    ) -> (Mutex<OriginBrowserSession>, BrowserIdentity) {
        let policy = OriginBrowserPolicy::new_with_allowed_origins(
            "cef-owner",
            "cef-connection",
            "cef-tab",
            "https://fixture.invalid",
            origins,
        )
        .unwrap();
        let identity = policy.identity().clone();
        let session = OriginBrowserSession::start(
            policy,
            Arc::new(|_: Authority| -> DialFuture {
                panic!("request-policy unit tests must not dial a destination")
            }),
            ProxyLimits::default(),
        )
        .await
        .unwrap();
        (Mutex::new(session), identity)
    }

    fn report_synthetic_ready(session: &mut OriginBrowserSession, identity: &BrowserIdentity) {
        // Pure admission fixture, NEVER evidence of live containment/readiness.
        let report = NativeHostReadiness::Ready {
            profile_key: session.policy().profile_key().to_owned(),
            proxy_endpoint: session.proxy_endpoint(),
        };
        session.report_host(identity, report).unwrap();
    }

    fn script_policy(
        class: WebsitePermissionSetting,
        destination: WebsitePermissionSetting,
    ) -> WebsiteDomainPermissionsSettings {
        WebsiteDomainPermissionsSettings {
            version: 1,
            websites: vec![WebsiteOriginPermissions {
                origin: "https://fixture.invalid".into(),
                request_classes: [(WebsiteRequestClass::Script, class)].into(),
                destinations: vec![WebsiteDestinationPermissions {
                    origin: "https://cdn.invalid".into(),
                    request_classes: [(WebsiteRequestClass::Script, destination)].into(),
                }],
            }],
        }
    }

    fn allow_classes(classes: &[WebsiteRequestClass]) -> WebsitePermissionEngine {
        WebsitePermissionEngine::new(
            None,
            None,
            &classes
                .iter()
                .map(|class| (*class, WebsitePermissionDecision::Allow))
                .collect(),
        )
        .unwrap()
    }

    fn first_party_scope(kind: ResourceType) -> ResourceScope {
        ResourceScope {
            kind,
            initiator: Some("https://fixture.invalid".into()),
            worker_context: false,
            navigation_factory: false,
        }
    }

    // Library-owned interfaces have no wrap_browser!/wrap_frame!/wrap_request!
    // macros in cef-rs. These private test vtables use its own allocator and
    // wrappers; no CEF browser, renderer, profile or destination is created.
    mod navigation_mocks {
        use super::*;
        use cef::rc::{ConvertReturnValue, RcImpl};
        use cef::sys::{_cef_browser_t, _cef_frame_t, _cef_request_t};

        pub(super) fn browser(valid_value: c_int, identifier_value: c_int) -> Browser {
            extern "C" fn valid(this: *mut _cef_browser_t) -> c_int {
                RcImpl::<_cef_browser_t, (c_int, c_int)>::get(this)
                    .interface
                    .0
            }
            extern "C" fn identifier(this: *mut _cef_browser_t) -> c_int {
                RcImpl::<_cef_browser_t, (c_int, c_int)>::get(this)
                    .interface
                    .1
            }
            fn wrap(valid_value: c_int, identifier_value: c_int) -> Browser {
                let raw = _cef_browser_t {
                    is_valid: Some(valid),
                    get_identifier: Some(identifier),
                    // SAFETY: CEF vtables contain integers and nullable pointers.
                    // RcImpl installs the base refcount callbacks before wrapping.
                    ..unsafe { std::mem::zeroed() }
                };
                let raw: *mut _cef_browser_t =
                    RcImpl::new(raw, (valid_value, identifier_value)).cast();
                raw.wrap_result()
            }
            wrap(valid_value, identifier_value)
        }

        pub(super) fn frame(
            valid_value: c_int,
            main_value: c_int,
            owner: Option<Browser>,
        ) -> Frame {
            type State = (c_int, c_int, Option<Browser>);
            extern "C" fn valid(this: *mut _cef_frame_t) -> c_int {
                RcImpl::<_cef_frame_t, State>::get(this).interface.0
            }
            extern "C" fn main(this: *mut _cef_frame_t) -> c_int {
                RcImpl::<_cef_frame_t, State>::get(this).interface.1
            }
            extern "C" fn browser(this: *mut _cef_frame_t) -> *mut _cef_browser_t {
                RcImpl::<_cef_frame_t, State>::get(this)
                    .interface
                    .2
                    .clone()
                    .map(Into::into)
                    .unwrap_or_default()
            }
            fn wrap(valid_value: c_int, main_value: c_int, owner: Option<Browser>) -> Frame {
                let raw = _cef_frame_t {
                    is_valid: Some(valid),
                    is_main: Some(main),
                    get_browser: Some(browser),
                    // SAFETY: Nullable unused entries; RcImpl supplies ownership.
                    ..unsafe { std::mem::zeroed() }
                };
                let raw: *mut _cef_frame_t =
                    RcImpl::new(raw, (valid_value, main_value, owner)).cast();
                raw.wrap_result()
            }
            wrap(valid_value, main_value, owner)
        }

        pub(super) fn request(resource_kind: ResourceType) -> Request {
            extern "C" fn kind(this: *mut _cef_request_t) -> cef::sys::cef_resource_type_t {
                RcImpl::<_cef_request_t, ResourceType>::get(this)
                    .interface
                    .into()
            }
            extern "C" fn url(_this: *mut _cef_request_t) -> cef::sys::cef_string_userfree_t {
                let text: Vec<u16> = "https://fixture.invalid/navigation"
                    .encode_utf16()
                    .collect();
                // SAFETY: CEF's unversioned string allocator matches the wrapper's
                // userfree destructor. Copy the buffer; never return a borrowed pointer.
                unsafe {
                    let output = cef::sys::cef_string_userfree_utf16_alloc();
                    if !output.is_null()
                        && cef::sys::cef_string_utf16_set(text.as_ptr(), text.len(), output, 1) == 0
                    {
                        cef::sys::cef_string_userfree_utf16_free(output);
                        return std::ptr::null_mut();
                    }
                    output
                }
            }
            fn wrap(resource_kind: ResourceType) -> Request {
                let raw = _cef_request_t {
                    get_resource_type: Some(kind),
                    get_url: Some(url),
                    // SAFETY: Nullable unused entries; RcImpl supplies ownership.
                    ..unsafe { std::mem::zeroed() }
                };
                let raw: *mut _cef_request_t = RcImpl::new(raw, resource_kind).cast();
                raw.wrap_result()
            }
            wrap(resource_kind)
        }

        pub(super) fn response() -> Response {
            // SAFETY: This callback only checks presence; unused vtable entries
            // are nullable. RcImpl installs the base reference-counting callbacks.
            let raw: *mut cef::sys::_cef_response_t = RcImpl::new(
                unsafe { std::mem::zeroed::<cef::sys::_cef_response_t>() },
                (),
            )
            .cast();
            raw.wrap_result()
        }

        pub(super) fn callback() -> (Callback, Arc<std::sync::atomic::AtomicUsize>) {
            use cef::sys::_cef_callback_t;
            use std::sync::atomic::AtomicUsize;
            extern "C" fn invoked(this: *mut _cef_callback_t) {
                RcImpl::<_cef_callback_t, Arc<AtomicUsize>>::get(this)
                    .interface
                    .fetch_add(1, Ordering::Relaxed);
            }
            let calls = Arc::new(AtomicUsize::new(0));
            let raw = _cef_callback_t {
                cont: Some(invoked),
                cancel: Some(invoked),
                // SAFETY: RcImpl initializes the remaining base refcount entries.
                ..unsafe { std::mem::zeroed() }
            };
            let raw: *mut _cef_callback_t = RcImpl::new(raw, calls.clone()).cast();
            (raw.wrap_result(), calls)
        }
    }

    #[test]
    fn native_navigation_frame_verifier_checks_real_wrapper_metadata() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        let owner = navigation_mocks::browser(1, 41);
        let foreign = navigation_mocks::browser(1, 42);
        let invalid_browser = navigation_mocks::browser(0, 41);
        for (kind, main) in [(ResourceType::MAIN_FRAME, 1), (ResourceType::SUB_FRAME, 0)] {
            let request = navigation_mocks::request(kind);
            let frame = navigation_mocks::frame(1, main, Some(owner.clone()));
            assert!(verified_navigation_frame(
                Some(&owner),
                Some(&frame),
                Some(&request),
                1
            ));
            for navigation in [-1, 0, 2] {
                assert!(!verified_navigation_frame(
                    Some(&owner),
                    Some(&frame),
                    Some(&request),
                    navigation
                ));
            }
            for browser in [None, Some(&foreign), Some(&invalid_browser)] {
                assert!(!verified_navigation_frame(
                    browser,
                    Some(&frame),
                    Some(&request),
                    1
                ));
            }
            assert!(!verified_navigation_frame(
                Some(&owner),
                None,
                Some(&request),
                1
            ));
            assert!(!verified_navigation_frame(
                Some(&owner),
                Some(&frame),
                None,
                1
            ));
            for rejected in [
                navigation_mocks::frame(0, main, Some(owner.clone())),
                navigation_mocks::frame(2, main, Some(owner.clone())),
                navigation_mocks::frame(1, 1 - main, Some(owner.clone())),
                navigation_mocks::frame(1, 2, Some(owner.clone())),
                navigation_mocks::frame(1, main, Some(foreign.clone())),
                navigation_mocks::frame(1, main, None),
            ] {
                assert!(!verified_navigation_frame(
                    Some(&owner),
                    Some(&rejected),
                    Some(&request),
                    1
                ));
            }
            for non_navigation in [
                ResourceType::SCRIPT,
                ResourceType::XHR,
                ResourceType::WORKER,
                ResourceType::SUB_RESOURCE,
            ] {
                let request = navigation_mocks::request(non_navigation);
                assert!(!verified_navigation_frame(
                    Some(&owner),
                    Some(&frame),
                    Some(&request),
                    1
                ));
            }
        }
    }

    #[tokio::test]
    async fn downloads_keep_navigation_permissions_and_reject_invalid_metadata() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        for (download, allow_navigation, expected) in [
            (1, true, ReturnValue::CONTINUE),
            (1, false, ReturnValue::CANCEL),
            (-1, true, ReturnValue::CANCEL),
            (2, true, ReturnValue::CANCEL),
        ] {
            let (session, identity) = session().await;
            report_synthetic_ready(&mut session.lock().unwrap(), &identity);
            let session = Arc::new(session);
            let mut browser = navigation_mocks::browser(1, 41);
            let mut frame = navigation_mocks::frame(1, 1, Some(browser.clone()));
            let mut request = navigation_mocks::request(ResourceType::MAIN_FRAME);
            let mut disabled = 0;
            let policy = if allow_navigation {
                Arc::new(allow_classes(&[WebsiteRequestClass::Navigation]))
            } else {
                deny_permissions()
            };
            let handler = context_resource_handler(
                session,
                identity,
                policy,
                Some(&request),
                1,
                download,
                Some(&CefString::from("null")),
                false,
                true,
                Some(&mut disabled),
            );
            let (mut callback, _) = navigation_mocks::callback();
            assert_eq!(
                handler.on_before_resource_load(
                    Some(&mut browser),
                    Some(&mut frame),
                    Some(&mut request),
                    Some(&mut callback),
                ),
                expected
            );
            assert_eq!(disabled, i32::from(expected == ReturnValue::CANCEL));
        }
    }

    #[tokio::test]
    async fn native_navigation_factory_redirect_callback_revokes_denied_destination() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        for (kind, main, class) in [
            (ResourceType::MAIN_FRAME, 1, WebsiteRequestClass::Navigation),
            (ResourceType::SUB_FRAME, 0, WebsiteRequestClass::Frame),
        ] {
            for denied_target in [
                Some("https://ungranted.invalid/"),
                Some("http://fixture.invalid/"),
                None,
            ] {
                let (session, identity) = session().await;
                report_synthetic_ready(&mut session.lock().unwrap(), &identity);
                let session = Arc::new(session);
                let mut browser = navigation_mocks::browser(1, 41);
                let mut frame = navigation_mocks::frame(1, main, Some(browser.clone()));
                let mut request = navigation_mocks::request(kind);
                let verified =
                    verified_navigation_frame(Some(&browser), Some(&frame), Some(&request), 1);
                assert!(verified);
                let mut disabled = 0;
                let handler = context_resource_handler(
                    session.clone(),
                    identity.clone(),
                    Arc::new(allow_classes(&[class])),
                    Some(&request),
                    1,
                    0,
                    Some(&CefString::from("null")),
                    false,
                    verified,
                    Some(&mut disabled),
                );
                assert_eq!(disabled, 0);
                let (mut callback, callback_calls) = navigation_mocks::callback();
                assert_eq!(
                    handler.on_before_resource_load(
                        Some(&mut browser),
                        Some(&mut frame),
                        Some(&mut request),
                        Some(&mut callback)
                    ),
                    ReturnValue::CONTINUE
                );
                let mut response = navigation_mocks::response();
                let mut allowed = CefString::from("https://fixture.invalid/next");
                handler.on_resource_redirect(
                    Some(&mut browser),
                    Some(&mut frame),
                    Some(&mut request),
                    Some(&mut response),
                    Some(&mut allowed),
                );
                assert_eq!(
                    session.lock().unwrap().status(),
                    BrowserSessionStatus::Ready
                );
                assert!(allowed.to_string() == "https://fixture.invalid/next");
                let mut denied = denied_target.map(CefString::from);
                handler.on_resource_redirect(
                    Some(&mut browser),
                    Some(&mut frame),
                    Some(&mut request),
                    Some(&mut response),
                    denied.as_mut(),
                );
                assert_eq!(
                    session.lock().unwrap().status(),
                    BrowserSessionStatus::Revoked
                );
                assert!(session
                    .lock()
                    .unwrap()
                    .with_proxy_credentials(|_, _| ())
                    .is_none());
                if let Some(denied) = denied {
                    assert!(denied.to_string() == "about:blank#blocked-native-request");
                }
                assert_eq!(
                    handler.on_before_resource_load(
                        Some(&mut browser),
                        Some(&mut frame),
                        Some(&mut request),
                        Some(&mut callback)
                    ),
                    ReturnValue::CANCEL
                );
                assert_eq!(callback_calls.load(Ordering::Relaxed), 0);
            }
        }
    }

    #[test]
    fn native_classification_denies_unknown_or_contradictory_metadata() {
        for (kind, expected) in [
            (ResourceType::MAIN_FRAME, "navigation"),
            (ResourceType::SUB_FRAME, "frame"),
            (ResourceType::SCRIPT, "script"),
            (ResourceType::STYLESHEET, "stylesheet"),
            (ResourceType::FONT_RESOURCE, "font"),
            (ResourceType::IMAGE, "image-media"),
            (ResourceType::MEDIA, "image-media"),
            (ResourceType::FAVICON, "image-media"),
            (ResourceType::XHR, "fetch-xhr"),
            (ResourceType::WORKER, "worker"),
            (ResourceType::SHARED_WORKER, "worker"),
            (ResourceType::SERVICE_WORKER, "worker"),
        ] {
            assert_eq!(native_request_class(kind), Some(expected));
            let navigation = i32::from(matches!(expected, "navigation" | "frame"));
            assert!(ResourceScope::from_native(kind, navigation, None, false, false).is_some());
            for wrong in [-1, 2, 1 - navigation] {
                assert!(ResourceScope::from_native(kind, wrong, None, false, false).is_none());
            }
        }
        for unknown in [
            ResourceType::SUB_RESOURCE,
            ResourceType::OBJECT,
            ResourceType::PREFETCH,
            ResourceType::PING,
            ResourceType::CSP_REPORT,
            ResourceType::PLUGIN_RESOURCE,
            ResourceType::NAVIGATION_PRELOAD_MAIN_FRAME,
            ResourceType::NAVIGATION_PRELOAD_SUB_FRAME,
            ResourceType::NUM_VALUES,
        ] {
            assert!(native_request_class(unknown).is_none());
            assert!(ResourceScope::from_native(unknown, 0, None, false, false).is_none());
        }
    }

    #[test]
    fn native_initiator_is_bounded_and_opaque_origins_never_become_empty() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        let valid = CefString::from("https://FIXTURE.invalid:443/");
        let scope = ResourceScope::from_native(ResourceType::SCRIPT, 0, Some(&valid), false, false)
            .unwrap();
        assert_eq!(scope.initiator.as_deref(), Some("https://fixture.invalid"));
        let empty = CefString::from("");
        assert!(ResourceScope::from_native(
            ResourceType::MAIN_FRAME,
            1,
            Some(&empty),
            false,
            false
        )
        .unwrap()
        .initiator
        .is_none());
        for invalid in [
            "null",
            "file:///test",
            "https://user@fixture.invalid",
            "https://fixture.invalid/path",
        ] {
            let value = CefString::from(invalid);
            assert!(ResourceScope::from_native(
                ResourceType::SCRIPT,
                0,
                Some(&value),
                false,
                false
            )
            .is_none());
        }
        let oversized = CefString::from("a".repeat(2049).as_str());
        assert!(ResourceScope::from_native(
            ResourceType::SCRIPT,
            0,
            Some(&oversized),
            false,
            false
        )
        .is_none());
    }

    #[tokio::test]
    async fn native_navigation_factory_uses_destination_policy_not_document_provenance() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        let opaque = CefString::from("null");
        let (session, identity) = session_with_origins(&["https://cdn.invalid"]).await;
        let mut session = session.lock().unwrap();
        report_synthetic_ready(&mut session, &identity);
        let navigate = allow_classes(&[WebsiteRequestClass::Navigation]);
        let embed = allow_classes(&[WebsiteRequestClass::Frame]);
        for (kind, allowed, denied) in [
            (ResourceType::MAIN_FRAME, &navigate, &embed),
            (ResourceType::SUB_FRAME, &embed, &navigate),
        ] {
            let scope = ResourceScope::from_native(kind, 1, Some(&opaque), false, true).unwrap();
            assert!(scope.navigation_factory);
            assert!(scope.initiator.is_none(), "never invent a document origin");
            for target in ["https://fixture.invalid/", "https://cdn.invalid/redirect"] {
                assert_eq!(
                    resolve_resource(&session, &identity, allowed, &scope, target).decision,
                    WebsitePermissionDecision::Allow
                );
                assert_eq!(
                    resolve_resource(&session, &identity, denied, &scope, target).decision,
                    WebsitePermissionDecision::Deny
                );
            }
            assert_eq!(
                resolve_resource(
                    &session,
                    &identity,
                    allowed,
                    &scope,
                    "https://ungranted.invalid/"
                )
                .source,
                WebsitePermissionSource::NativeConstraint
            );
            // The native frame must be verified; workers never use this path.
            assert!(ResourceScope::from_native(kind, 1, Some(&opaque), false, false).is_none());
            assert!(ResourceScope::from_native(kind, 1, Some(&opaque), true, true).is_none());
        }
        for kind in [
            ResourceType::SCRIPT,
            ResourceType::XHR,
            ResourceType::WORKER,
            ResourceType::SHARED_WORKER,
            ResourceType::SERVICE_WORKER,
        ] {
            assert!(ResourceScope::from_native(kind, 0, Some(&opaque), false, true).is_none());
            assert!(ResourceScope::from_native(kind, 1, Some(&opaque), false, true).is_none());
        }
        let scope =
            ResourceScope::from_native(ResourceType::MAIN_FRAME, 1, Some(&opaque), false, true)
                .unwrap();
        session.revoke(&identity).unwrap();
        assert_eq!(
            resolve_resource(
                &session,
                &identity,
                &navigate,
                &scope,
                "https://fixture.invalid/"
            )
            .source,
            WebsitePermissionSource::NativeConstraint
        );
    }

    #[tokio::test]
    async fn native_resource_policy_obeys_all_precedence_levels_and_is_immutable() {
        use WebsitePermissionSetting::{Allow, Deny, Inherit};
        use WebsitePermissionSource::*;
        let (session, identity) = session_with_origins(&["https://cdn.invalid"]).await;
        let mut session = session.lock().unwrap();
        report_synthetic_ready(&mut session, &identity);
        let scope = first_party_scope(ResourceType::SCRIPT);
        for (own_destination, own_class, shared_destination, shared_class, source, decision) in [
            (
                Allow,
                Deny,
                Deny,
                Deny,
                ConnectionDestination,
                WebsitePermissionDecision::Allow,
            ),
            (
                Deny,
                Allow,
                Allow,
                Allow,
                ConnectionDestination,
                WebsitePermissionDecision::Deny,
            ),
            (
                Inherit,
                Deny,
                Allow,
                Allow,
                ConnectionClass,
                WebsitePermissionDecision::Deny,
            ),
            (
                Inherit,
                Inherit,
                Deny,
                Allow,
                SharedDestination,
                WebsitePermissionDecision::Deny,
            ),
            (
                Inherit,
                Inherit,
                Inherit,
                Deny,
                SharedClass,
                WebsitePermissionDecision::Deny,
            ),
            (
                Inherit,
                Inherit,
                Inherit,
                Inherit,
                ApplicationDefault,
                WebsitePermissionDecision::Deny,
            ),
        ] {
            let mut shared = script_policy(shared_class, shared_destination);
            let mut connection = script_policy(own_class, own_destination);
            let engine =
                WebsitePermissionEngine::new(Some(&shared), Some(&connection), &Default::default())
                    .unwrap();
            shared.websites.clear();
            connection.websites.clear();
            assert_eq!(
                resolve_resource(
                    &session,
                    &identity,
                    &engine,
                    &scope,
                    "https://cdn.invalid/code.js"
                ),
                EffectiveWebsitePermission { decision, source }
            );
        }
    }

    #[tokio::test]
    async fn permission_allow_never_overrides_readiness_routes_identity_or_unknown_class() {
        let (session, identity) = session().await;
        let mut session = session.lock().unwrap();
        let engine = allow_classes(&[
            WebsiteRequestClass::Script,
            WebsiteRequestClass::Navigation,
            WebsiteRequestClass::Websocket,
        ]);
        let scope = first_party_scope(ResourceType::SCRIPT);
        assert_eq!(
            resolve_resource(
                &session,
                &identity,
                &engine,
                &scope,
                "https://fixture.invalid/code.js"
            )
            .source,
            WebsitePermissionSource::NativeConstraint
        );
        assert!(!navigation_allowed(
            &session,
            &identity,
            &engine,
            "https://fixture.invalid/",
            true
        ));
        report_synthetic_ready(&mut session, &identity);
        assert_eq!(
            resolve_resource(
                &session,
                &identity,
                &engine,
                &scope,
                "https://fixture.invalid/code.js"
            )
            .decision,
            WebsitePermissionDecision::Allow
        );
        assert_eq!(
            resolve_resource(
                &session,
                &identity,
                &deny_permissions(),
                &scope,
                "https://fixture.invalid/code.js"
            )
            .decision,
            WebsitePermissionDecision::Deny
        );
        assert!(navigation_allowed(
            &session,
            &identity,
            &engine,
            "https://fixture.invalid/",
            true
        ));
        assert!(!navigation_allowed(
            &session,
            &identity,
            &engine,
            "https://fixture.invalid/",
            false
        ));
        for denied in [
            "https://cdn.invalid/code.js",
            "http://fixture.invalid:443/",
            "wss://fixture.invalid/socket",
            "file:///test",
            "https://user@fixture.invalid/",
        ] {
            let result = resolve_resource(&session, &identity, &engine, &scope, denied);
            assert_eq!(result.decision, WebsitePermissionDecision::Deny);
            assert_eq!(result.source, WebsitePermissionSource::NativeConstraint);
            assert!(!navigation_allowed(
                &session, &identity, &engine, denied, true
            ));
        }
        let unknown = first_party_scope(ResourceType::SUB_RESOURCE);
        assert_eq!(
            resolve_resource(
                &session,
                &identity,
                &engine,
                &unknown,
                "https://fixture.invalid/code.js"
            )
            .decision,
            WebsitePermissionDecision::Deny
        );
        let stale =
            OriginBrowserPolicy::new("other", "connection", "tab", "https://fixture.invalid")
                .unwrap();
        assert_eq!(
            resolve_resource(
                &session,
                stale.identity(),
                &engine,
                &scope,
                "https://fixture.invalid/"
            )
            .source,
            WebsitePermissionSource::NativeConstraint
        );
        session.revoke(&identity).unwrap();
        assert_eq!(
            resolve_resource(
                &session,
                &identity,
                &engine,
                &scope,
                "https://fixture.invalid/"
            )
            .source,
            WebsitePermissionSource::NativeConstraint
        );
    }

    #[tokio::test]
    async fn redirects_and_initiators_keep_the_original_class_and_route_constraints() {
        let (session, identity) = session_with_origins(&["https://cdn.invalid"]).await;
        let mut session = session.lock().unwrap();
        report_synthetic_ready(&mut session, &identity);
        let shared = script_policy(
            WebsitePermissionSetting::Allow,
            WebsitePermissionSetting::Deny,
        );
        let engine =
            WebsitePermissionEngine::new(Some(&shared), None, &Default::default()).unwrap();
        let mut scope = first_party_scope(ResourceType::SCRIPT);
        assert_eq!(
            resolve_resource(
                &session,
                &identity,
                &engine,
                &scope,
                "https://fixture.invalid/script"
            )
            .decision,
            WebsitePermissionDecision::Allow
        );
        // Redirect destination remains a script, even when its URL looks like an image.
        assert_eq!(
            resolve_resource(
                &session,
                &identity,
                &engine,
                &scope,
                "https://cdn.invalid/image.png"
            )
            .source,
            WebsitePermissionSource::SharedDestination
        );
        assert_eq!(
            resolve_resource(
                &session,
                &identity,
                &engine,
                &scope,
                "https://cdn.invalid/image.png"
            )
            .decision,
            WebsitePermissionDecision::Deny
        );
        for initiator in [None, Some("https://ungranted.invalid".into())] {
            scope.initiator = initiator;
            assert_eq!(
                resolve_resource(
                    &session,
                    &identity,
                    &engine,
                    &scope,
                    "https://fixture.invalid/script"
                )
                .source,
                WebsitePermissionSource::NativeConstraint
            );
        }
        let navigation = ResourceScope {
            kind: ResourceType::MAIN_FRAME,
            initiator: None,
            worker_context: false,
            navigation_factory: false,
        };
        let engine = allow_classes(&[WebsiteRequestClass::Navigation]);
        assert_eq!(
            resolve_resource(
                &session,
                &identity,
                &engine,
                &navigation,
                "https://fixture.invalid/"
            )
            .decision,
            WebsitePermissionDecision::Allow
        );
        let frame = ResourceScope {
            kind: ResourceType::SUB_FRAME,
            ..navigation
        };
        assert_eq!(
            resolve_resource(
                &session,
                &identity,
                &engine,
                &frame,
                "https://fixture.invalid/"
            )
            .source,
            WebsitePermissionSource::NativeConstraint
        );
    }

    #[tokio::test]
    async fn worker_paths_require_explicit_first_party_grant_and_resource_permission() {
        let (session, identity) = session_with_origins(&["https://cdn.invalid"]).await;
        let mut session = session.lock().unwrap();
        report_synthetic_ready(&mut session, &identity);
        let resource_only = allow_classes(&[
            WebsiteRequestClass::Script,
            WebsiteRequestClass::Frame,
            WebsiteRequestClass::FetchXhr,
        ]);
        let worker_only = allow_classes(&[WebsiteRequestClass::Worker]);
        let both = allow_classes(&[WebsiteRequestClass::Worker, WebsiteRequestClass::FetchXhr]);
        for kind in [
            ResourceType::WORKER,
            ResourceType::SHARED_WORKER,
            ResourceType::SERVICE_WORKER,
        ] {
            let mut scope = first_party_scope(kind);
            assert_eq!(
                resolve_resource(
                    &session,
                    &identity,
                    &resource_only,
                    &scope,
                    "https://fixture.invalid/worker.js"
                )
                .decision,
                WebsitePermissionDecision::Deny
            );
            assert_eq!(
                resolve_resource(
                    &session,
                    &identity,
                    &worker_only,
                    &scope,
                    "https://fixture.invalid/worker.js"
                )
                .decision,
                WebsitePermissionDecision::Allow
            );
            assert_eq!(
                resolve_resource(
                    &session,
                    &identity,
                    &worker_only,
                    &scope,
                    "https://cdn.invalid/worker.js"
                )
                .source,
                WebsitePermissionSource::NativeConstraint
            );
            scope.initiator = Some("https://cdn.invalid".into());
            assert_eq!(
                resolve_resource(
                    &session,
                    &identity,
                    &worker_only,
                    &scope,
                    "https://fixture.invalid/worker.js"
                )
                .source,
                WebsitePermissionSource::NativeConstraint
            );
        }
        // Browser/frame-less requests cannot silently become ordinary fetches.
        let mut scope = ResourceScope {
            worker_context: true,
            ..first_party_scope(ResourceType::XHR)
        };
        for engine in [&resource_only, &worker_only] {
            assert_eq!(
                resolve_resource(
                    &session,
                    &identity,
                    engine,
                    &scope,
                    "https://cdn.invalid/data"
                )
                .decision,
                WebsitePermissionDecision::Deny
            );
        }
        assert_eq!(
            resolve_resource(
                &session,
                &identity,
                &both,
                &scope,
                "https://cdn.invalid/data"
            )
            .decision,
            WebsitePermissionDecision::Allow
        );
        for initiator in [None, Some("https://cdn.invalid".into())] {
            scope.initiator = initiator;
            assert_eq!(
                resolve_resource(
                    &session,
                    &identity,
                    &both,
                    &scope,
                    "https://cdn.invalid/data"
                )
                .source,
                WebsitePermissionSource::NativeConstraint
            );
        }
    }

    #[tokio::test]
    async fn compatibility_resource_constructor_has_no_policy_free_bypass() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        let (session, identity) = session().await;
        report_synthetic_ready(&mut session.lock().unwrap(), &identity);
        let session = Arc::new(session);
        let handler = resource_handler(session.clone(), identity.clone());
        assert_eq!(
            handler.on_before_resource_load(None, None, None, None),
            ReturnValue::CANCEL
        );
        let mut disabled = 0;
        let handler = context_resource_handler(
            session.clone(),
            identity.clone(),
            Arc::new(allow_classes(&[WebsiteRequestClass::Worker])),
            None,
            0,
            0,
            None,
            true,
            false,
            Some(&mut disabled),
        );
        assert_eq!(disabled, 1);
        assert_eq!(
            handler.on_before_resource_load(None, None, None, None),
            ReturnValue::CANCEL
        );
        let mut redirected = CefString::from("https://fixture.invalid");
        handler.on_resource_redirect(None, None, None, None, Some(&mut redirected));
        assert_eq!(
            session.lock().unwrap().status(),
            BrowserSessionStatus::Revoked
        );
        assert_eq!(redirected.to_string(), "about:blank#blocked-native-request");
    }

    async fn established_tunnel() -> (
        Mutex<OriginBrowserSession>,
        BrowserIdentity,
        TcpStream,
        DuplexStream,
    ) {
        timeout(Duration::from_secs(5), async {
            let policy = OriginBrowserPolicy::new(
                "cef-owner", "cef-connection", "cef-tab", "https://fixture.invalid",
            )
            .unwrap();
            let identity = policy.identity().clone();
            let (relay, upstream) = tokio::io::duplex(1024);
            let relay = Arc::new(Mutex::new(Some(relay)));
            let session = OriginBrowserSession::start(
                policy,
                Arc::new(move |authority: Authority| -> DialFuture {
                    assert_eq!(authority, Authority::parse("fixture.invalid:443").unwrap());
                    let stream = relay.lock().unwrap().take().unwrap();
                    Box::pin(async move { Ok(Box::new(stream) as BoxedStream) })
                }),
                ProxyLimits::default(),
            )
            .await
            .unwrap();
            let endpoint = session.proxy_endpoint();
            let host = endpoint.ip().to_string();
            let authorization = session.answer_proxy_challenge(
                &identity,
                NativeProxyChallenge {
                    is_proxy: true,
                    host: &host,
                    port: endpoint.port(),
                    scheme: "basic",
                    realm: "private-forward-proxy",
                },
                |username, password| {
                    let credentials = Zeroizing::new(format!("{username}:{password}"));
                    Zeroizing::new(base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes()))
                },
            )
            .unwrap();
            let mut client = TcpStream::connect(endpoint).await.unwrap();
            let request = Zeroizing::new(format!(
                "CONNECT fixture.invalid:443 HTTP/1.1\r\nHost: fixture.invalid:443\r\nProxy-Authorization: Basic {}\r\n\r\n",
                authorization.as_str()
            ));
            client.write_all(request.as_bytes()).await.unwrap();
            drop(request);
            drop(authorization);
            let mut response = Vec::new();
            while !response.ends_with(b"\r\n\r\n") {
                assert!(response.len() < 1024);
                response.push(client.read_u8().await.unwrap());
            }
            assert!(response.starts_with(b"HTTP/1.1 200 "));
            (Mutex::new(session), identity, client, upstream)
        })
        .await
        .expect("authenticated local tunnel setup timed out")
    }

    async fn roundtrip(client: &mut TcpStream, upstream: &mut DuplexStream) {
        timeout(Duration::from_secs(2), async {
            client.write_all(b"ping").await.unwrap();
            let mut bytes = [0; 4];
            upstream.read_exact(&mut bytes).await.unwrap();
            assert_eq!(&bytes, b"ping");
            upstream.write_all(b"pong").await.unwrap();
            client.read_exact(&mut bytes).await.unwrap();
            assert_eq!(&bytes, b"pong");
        })
        .await
        .expect("established tunnel stopped forwarding");
    }

    async fn assert_stream_closed(stream: &mut (impl AsyncRead + Unpin)) {
        let result = timeout(Duration::from_secs(2), stream.read(&mut [0; 1]))
            .await
            .expect("poison observation must terminate the established tunnel");
        match result {
            Ok(0) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::ConnectionReset
                        | io::ErrorKind::ConnectionAborted
                        | io::ErrorKind::BrokenPipe
                ) => {}
            _ => panic!("revoked tunnel remained readable"),
        }
    }

    #[tokio::test]
    async fn native_crash_and_unresponsive_callbacks_close_established_tunnels() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        for unresponsive in [false, true] {
            let (session, identity, mut client, mut upstream) = established_tunnel().await;
            roundtrip(&mut client, &mut upstream).await;
            let session = Arc::new(session);
            let handler = request_handler(session.clone(), identity);
            if unresponsive {
                assert_eq!(handler.on_render_process_unresponsive(None, None), 1);
            } else {
                handler.on_render_process_terminated(None, TerminationStatus::default(), 0, None);
            }
            assert_eq!(
                session.lock().unwrap().status(),
                BrowserSessionStatus::Revoked
            );
            assert!(session
                .lock()
                .unwrap()
                .with_proxy_credentials(|_, _| ())
                .is_none());
            assert_stream_closed(&mut client).await;
            assert_stream_closed(&mut upstream).await;
        }
    }

    #[tokio::test]
    async fn native_renderer_fault_revokes_before_even_a_panicking_notification() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        struct Notification {
            session: Arc<Mutex<OriginBrowserSession>>,
            observed: AtomicBool,
        }
        impl RequestLifecycle for Notification {
            fn renderer_fault(&self, _: Option<&Browser>) {
                self.observed.store(
                    self.session.lock().unwrap().status() == BrowserSessionStatus::Revoked,
                    Ordering::Release,
                );
                panic!("native sink failure");
            }
            fn main_document_available(&self, _: Option<&Browser>) {}
        }
        let (session, identity) = session().await;
        let session = Arc::new(session);
        let notification = Arc::new(Notification {
            session: session.clone(),
            observed: AtomicBool::new(false),
        });
        let handler = request_handler_with_lifecycle(
            session.clone(),
            identity,
            deny_permissions(),
            Some(notification.clone()),
        );
        handler.on_render_process_terminated(None, TerminationStatus::default(), 0, None);
        assert!(notification.observed.load(Ordering::Acquire));
        assert_eq!(
            session.lock().unwrap().status(),
            BrowserSessionStatus::Revoked
        );
    }

    fn poison(session: &Mutex<OriginBrowserSession>) {
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = session.lock().unwrap();
            panic!("poison fixture");
        }))
        .is_err());
        assert!(session.is_poisoned());
    }

    // Exercise each admission path independently: a prior callback must not be
    // responsible for making a later callback appear to revoke correctly.
    fn observe_poison(session: &Mutex<OriginBrowserSession>, identity: &BrowserIdentity, path: u8) {
        match path {
            0 => assert!(!url_allowed(session, identity, "https://fixture.invalid/")),
            1 => assert!(!take_bootstrap(
                session,
                identity,
                &AtomicBool::new(true),
                true
            )),
            2 => {
                let endpoint = session
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .proxy_endpoint();
                let host = endpoint.ip().to_string();
                let completion = Completion::default();
                assert_eq!(
                    complete_auth(
                        session,
                        identity,
                        AuthMetadata {
                            is_proxy: 1,
                            host: Some(&host),
                            port: c_int::from(endpoint.port()),
                            realm: Some("private-forward-proxy"),
                            scheme: Some("basic"),
                        },
                        Some(&completion)
                    ),
                    1
                );
                assert_eq!(completion.continued.get(), 0);
                assert_eq!(completion.cancelled.get(), 1);
            }
            3 => assert!(!scoped_request_allowed(
                session,
                identity,
                &deny_permissions(),
                None,
                None
            )),
            _ => unreachable!(),
        }
    }

    #[tokio::test]
    async fn poison_observation_terminates_established_authenticated_tunnels() {
        for path in 0..4 {
            let (session, identity, mut client, mut upstream) = established_tunnel().await;
            roundtrip(&mut client, &mut upstream).await;
            poison(&session);
            observe_poison(&session, &identity, path);
            assert!(session.is_poisoned(), "admission must never clear poison");
            {
                let guard = session.lock().unwrap_or_else(|p| p.into_inner());
                assert_eq!(guard.status(), BrowserSessionStatus::Revoked, "path {path}");
                assert!(guard.with_proxy_credentials(|_, _| ()).is_none());
            }
            assert_stream_closed(&mut client).await;
            assert_stream_closed(&mut upstream).await;
            let mut session = session.into_inner().unwrap_or_else(|p| p.into_inner());
            session.stop().await.unwrap();
        }
    }

    #[tokio::test]
    async fn poisoned_stale_callbacks_leave_successor_tunnel_untouched() {
        let (session, identity, mut client, mut upstream) = established_tunnel().await;
        let stale = OriginBrowserPolicy::new(
            "cef-owner",
            "cef-connection",
            "cef-tab",
            "https://fixture.invalid",
        )
        .unwrap()
        .identity()
        .clone();
        assert!(stale != identity);
        roundtrip(&mut client, &mut upstream).await;
        poison(&session);
        for path in 0..4 {
            observe_poison(&session, &stale, path);
            assert!(session.is_poisoned());
            {
                let guard = session.lock().unwrap_or_else(|p| p.into_inner());
                assert_eq!(guard.status(), BrowserSessionStatus::NotReady);
                assert!(guard.with_proxy_credentials(|_, _| ()).is_some());
            }
            roundtrip(&mut client, &mut upstream).await;
        }
        // The current owner still revokes without clearing poison.
        observe_poison(&session, &identity, 0);
        assert!(session.is_poisoned());
        assert_stream_closed(&mut client).await;
        assert_stream_closed(&mut upstream).await;
        let mut session = session.into_inner().unwrap_or_else(|p| p.into_inner());
        session.stop().await.unwrap();
    }

    #[tokio::test]
    async fn authentication_completes_once_and_stops_after_owner_revocation() {
        let (session, identity) = session().await;
        let endpoint = session.lock().unwrap().proxy_endpoint();
        let host = endpoint.ip().to_string();
        let metadata = || AuthMetadata {
            is_proxy: 1,
            host: Some(&host),
            port: c_int::from(endpoint.port()),
            realm: Some("private-forward-proxy"),
            scheme: Some("Basic"),
        };
        let completion = Completion::default();
        assert_eq!(
            complete_auth(&session, &identity, metadata(), Some(&completion)),
            1
        );
        assert_eq!(completion.continued.get(), 1);
        assert_eq!(completion.cancelled.get(), 0);
        assert!(completion.nonempty_credentials.get());
        assert_eq!(
            session.lock().unwrap().status(),
            BrowserSessionStatus::NotReady
        );
        revoke_attempt(&session, &identity);
        assert_eq!(
            complete_auth(&session, &identity, metadata(), Some(&completion)),
            1
        );
        assert_eq!(completion.continued.get(), 1);
        assert_eq!(completion.cancelled.get(), 1);
    }

    #[tokio::test]
    async fn invalid_auth_metadata_or_owner_cancels_without_credentials() {
        let (session, identity) = session().await;
        let endpoint = session.lock().unwrap().proxy_endpoint();
        let host = endpoint.ip().to_string();
        let metadata = || AuthMetadata {
            is_proxy: 1,
            host: Some(&host),
            port: c_int::from(endpoint.port()),
            realm: Some("private-forward-proxy"),
            scheme: Some("basic"),
        };
        let invalid = [
            AuthMetadata {
                is_proxy: 0,
                ..metadata()
            },
            AuthMetadata {
                is_proxy: 2,
                ..metadata()
            },
            AuthMetadata {
                host: None,
                ..metadata()
            },
            AuthMetadata {
                host: Some("localhost"),
                ..metadata()
            },
            AuthMetadata {
                host: Some("fixture.invalid"),
                ..metadata()
            },
            AuthMetadata {
                host: Some("127.0.0.2"),
                ..metadata()
            },
            AuthMetadata {
                port: -1,
                ..metadata()
            },
            AuthMetadata {
                port: 65536 + c_int::from(endpoint.port()),
                ..metadata()
            },
            AuthMetadata {
                realm: None,
                ..metadata()
            },
            AuthMetadata {
                realm: Some("website"),
                ..metadata()
            },
            AuthMetadata {
                scheme: None,
                ..metadata()
            },
            AuthMetadata {
                scheme: Some("digest"),
                ..metadata()
            },
        ];
        for metadata in invalid {
            let completion = Completion::default();
            assert_eq!(
                complete_auth(&session, &identity, metadata, Some(&completion)),
                1
            );
            assert_eq!(completion.continued.get(), 0);
            assert_eq!(completion.cancelled.get(), 1);
        }
        assert_eq!(
            complete_auth(&session, &identity, metadata(), None::<&Completion>),
            0
        );
        let (_, stale) = self::session().await;
        let completion = Completion::default();
        assert_eq!(
            complete_auth(&session, &stale, metadata(), Some(&completion)),
            1
        );
        assert_eq!(completion.continued.get(), 0);
        assert_eq!(completion.cancelled.get(), 1);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = session.lock().unwrap();
            panic!("poison fixture");
        }));
        assert_eq!(
            complete_auth(&session, &identity, metadata(), Some(&completion)),
            1
        );
        assert_eq!(completion.continued.get(), 0);
        assert_eq!(completion.cancelled.get(), 2);
        revoke_attempt(&session, &identity);
    }

    #[test]
    fn native_challenge_arguments_do_not_wrap_or_default() {
        let metadata = || AuthMetadata {
            is_proxy: 1,
            host: Some("127.0.0.1"),
            port: 32123,
            realm: Some("private-forward-proxy"),
            scheme: Some("Basic"),
        };
        let valid = metadata().challenge().unwrap();
        assert_eq!(valid.port, 32123);
        assert_eq!(valid.scheme, "Basic");
        for port in [-65536, -1, 0, 65536, c_int::MAX] {
            assert!(AuthMetadata { port, ..metadata() }.challenge().is_none());
        }
        for is_proxy in [-1, 0, 2] {
            assert!(AuthMetadata {
                is_proxy,
                ..metadata()
            }
            .challenge()
            .is_none());
        }
        for missing in [None, Some("")] {
            assert!(AuthMetadata {
                host: missing,
                ..metadata()
            }
            .challenge()
            .is_none());
            assert!(AuthMetadata {
                realm: missing,
                ..metadata()
            }
            .challenge()
            .is_none());
            assert!(AuthMetadata {
                scheme: missing,
                ..metadata()
            }
            .challenge()
            .is_none());
        }
    }

    #[tokio::test]
    async fn bootstrap_is_one_use_and_does_not_report_ready() {
        let (session, identity) = session().await;
        let pending = AtomicBool::new(true);
        assert!(take_bootstrap(&session, &identity, &pending, true));
        assert!(!take_bootstrap(&session, &identity, &pending, true));
        assert_eq!(
            session.lock().unwrap().status(),
            BrowserSessionStatus::NotReady
        );
        assert!(!url_allowed(
            &session,
            &identity,
            "https://fixture.invalid/"
        ));
    }

    #[tokio::test]
    async fn rejected_initial_navigation_consumes_bootstrap() {
        let (session, identity) = session().await;
        let pending = AtomicBool::new(true);
        assert!(!take_bootstrap(&session, &identity, &pending, false));
        assert!(!take_bootstrap(&session, &identity, &pending, true));
    }

    #[tokio::test]
    async fn stale_attempt_cannot_bootstrap_or_revoke_successor() {
        let (session, identity) = session().await;
        let (_, stale) = self::session().await;
        assert!(!take_bootstrap(
            &session,
            &stale,
            &AtomicBool::new(true),
            true
        ));
        revoke_attempt(&session, &stale);
        assert_eq!(
            session.lock().unwrap().status(),
            BrowserSessionStatus::NotReady
        );
        revoke_attempt(&session, &identity);
        assert!(!take_bootstrap(
            &session,
            &identity,
            &AtomicBool::new(true),
            true
        ));
        assert_eq!(
            session.lock().unwrap().status(),
            BrowserSessionStatus::Revoked
        );
    }

    #[tokio::test]
    async fn ready_resources_still_use_strict_scheme_and_origin_policy() {
        let (session, identity) = session().await;
        {
            let mut session = session.lock().unwrap();
            let report = NativeHostReadiness::Ready {
                profile_key: session.policy().profile_key().to_owned(),
                proxy_endpoint: session.proxy_endpoint(),
            };
            // Synthetic policy fixture only, not evidence of CEF containment.
            session.report_host(&identity, report).unwrap();
        }
        assert!(url_allowed(
            &session,
            &identity,
            "https://fixture.invalid/path"
        ));
        assert!(!take_bootstrap(
            &session,
            &identity,
            &AtomicBool::new(true),
            true
        ));
        for url in [
            "about:blank",
            "about:blank#blocked-native-request",
            "file:///tmp/test",
            "data:text/plain,test",
            "javascript:alert(1)",
            "http://fixture.invalid:443/",
            "https://other.invalid/",
            "https://user@fixture.invalid/",
            "",
        ] {
            assert!(!url_allowed(&session, &identity, url));
        }
        assert!(!request_allowed(&session, &identity, None));
        revoke_attempt(&session, &identity);
        assert!(!url_allowed(
            &session,
            &identity,
            "https://fixture.invalid/path"
        ));
    }

    #[tokio::test]
    async fn poisoned_state_never_authorizes_and_can_only_be_closed() {
        let (session, identity) = session().await;
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = session.lock().unwrap();
            panic!("poison fixture");
        }));
        assert!(!take_bootstrap(
            &session,
            &identity,
            &AtomicBool::new(true),
            true
        ));
        assert!(!url_allowed(
            &session,
            &identity,
            "https://fixture.invalid/"
        ));
        revoke_attempt(&session, &identity);
        let Err(poisoned) = session.lock() else {
            panic!("revoking must not silently clear the poisoned state");
        };
        assert_eq!(
            poisoned.into_inner().status(),
            BrowserSessionStatus::Revoked
        );
    }
}
