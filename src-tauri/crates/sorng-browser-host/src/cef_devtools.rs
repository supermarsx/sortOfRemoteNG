//! Local inspector for an explicit trusted-shell action. No TCP debugger or
//! renderer command bridge; CEF owns the separate DevTools window lifecycle.
use super::*;
use crate::cef_devtools_policy::{
    bootstrap_document, bundled_document, inspector_resource, BootstrapRequest,
};
use std::sync::Weak;
use std::time::{Duration, Instant};

/// CEF starts the inspector document before attaching its browser/client. The
/// private request context therefore receives its first request without either
/// a browser or a frame. Do not grant a scheme-wide context exemption: an
/// explicit, authenticated inspector action arms one short-lived local request.
#[derive(Default)]
pub(crate) struct BootstrapGate(Mutex<Vec<PendingBootstrap>>);

#[derive(Clone)]
struct PendingBootstrap {
    owner: Weak<Shared>,
    expires: Instant,
    cancelled: Arc<AtomicBool>,
}

impl PendingBootstrap {
    fn pending(&self, now: Instant) -> bool {
        now < self.expires
            && !self.cancelled.load(Ordering::Acquire)
            && self.owner.strong_count() != 0
    }

    fn current(&self, now: Instant) -> bool {
        self.pending(now) && self.owner.upgrade().is_some_and(|owner| owner.current())
    }
}

impl BootstrapGate {
    fn arm(&self, owner: &Arc<Shared>, now: Instant) -> Result<Arc<AtomicBool>, BrowserError> {
        let mut pending = self.0.lock().map_err(|_| BrowserError::StateUnavailable)?;
        pending.retain(|entry| entry.pending(now));
        let cancelled = Arc::new(AtomicBool::new(false));
        pending.push(PendingBootstrap {
            owner: Arc::downgrade(owner),
            expires: now + Duration::from_secs(10),
            cancelled: cancelled.clone(),
        });
        Ok(cancelled)
    }

    fn take(
        &self,
        session: &Arc<Mutex<OriginBrowserSession>>,
        identity: &BrowserIdentity,
        now: Instant,
    ) -> Option<PendingBootstrap> {
        loop {
            let permit = {
                let mut pending = self.0.lock().ok()?;
                pending.retain(|entry| entry.pending(now));
                let index = pending.iter().position(|entry| {
                    entry.owner.upgrade().is_some_and(|owner| {
                        Arc::ptr_eq(&owner.session, session) && &owner.identity == identity
                    })
                })?;
                pending.remove(index)
            };
            // Do not acquire the session lock while holding the gate lock.
            if permit.current(now) {
                return Some(permit);
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn handler(
        &self,
        session: &Arc<Mutex<OriginBrowserSession>>,
        identity: &BrowserIdentity,
        no_browser: bool,
        no_frame: bool,
        request: Option<&Request>,
        is_navigation: i32,
        is_download: i32,
        initiator: Option<&CefString>,
    ) -> Option<ResourceRequestHandler> {
        let request = request?;
        let url = CefString::from(&request.url()).to_string();
        // Exact native metadata observed for Chrome's inspector bootstrap.
        // Website navigations, subframes, workers and downloads cannot consume
        // this permission, even if they use a lookalike local URL.
        let method = CefString::from(&request.method()).to_string();
        let initiator = initiator.map(|value| value.to_string()).unwrap_or_default();
        if !(BootstrapRequest {
            no_browser,
            no_frame,
            navigation: is_navigation,
            download: is_download,
            main_frame: request.resource_type() == ResourceType::MAIN_FRAME,
            method: &method,
            initiator: &initiator,
            url: &url,
        })
        .eligible()
        {
            return None;
        }
        self.take(session, identity, Instant::now())
            .map(|permit| BootstrapResource::new(permit, url, Arc::new(AtomicBool::new(false))))
    }
}

wrap_resource_request_handler! {
    struct BootstrapResource { permit: PendingBootstrap, url: String, used: Arc<AtomicBool> }
    impl ResourceRequestHandler {
        fn on_before_resource_load(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            request: Option<&mut Request>, _callback: Option<&mut Callback>) -> ReturnValue {
            if !self.used.swap(true, Ordering::AcqRel) && self.permit.current(Instant::now())
                && request.is_some_and(|request| {
                    CefString::from(&request.url()).to_string() == self.url
                        && bootstrap_document(&self.url)
                        && CefString::from(&request.method()).to_string() == "GET"
                }) {
                ReturnValue::CONTINUE
            } else { ReturnValue::CANCEL }
        }
    }
}

#[cfg(test)]
mod bootstrap_tests {
    use super::*;
    struct Sink;
    impl BrowserEventSink for Sink {
        fn on_event(&self, _event: BrowserEvent) {}
    }

    #[tokio::test]
    async fn bootstrap_requires_explicit_action_and_is_one_shot_per_context() {
        let owner = Arc::new(super::super::tests::fixture(Arc::new(Sink)).await);
        let other = Arc::new(super::super::tests::fixture(Arc::new(Sink)).await);
        let gate = BootstrapGate::default();
        let now = Instant::now();
        assert!(gate.take(&owner.session, &owner.identity, now).is_none());
        gate.arm(&owner, now).unwrap();
        assert!(gate.take(&other.session, &owner.identity, now).is_none());
        assert!(gate.take(&owner.session, &other.identity, now).is_none());
        assert!(gate.take(&owner.session, &owner.identity, now).is_some());
        assert!(gate.take(&owner.session, &owner.identity, now).is_none());
    }

    #[tokio::test]
    async fn expired_cancelled_revoked_or_dropped_owners_cannot_bootstrap() {
        let owner = Arc::new(super::super::tests::fixture(Arc::new(Sink)).await);
        let gate = BootstrapGate::default();
        let now = Instant::now();
        gate.arm(&owner, now)
            .unwrap()
            .store(true, Ordering::Release);
        assert!(gate.take(&owner.session, &owner.identity, now).is_none());
        gate.arm(&owner, now).unwrap();
        assert!(gate
            .take(
                &owner.session,
                &owner.identity,
                now + Duration::from_secs(10)
            )
            .is_none());
        gate.arm(&owner, now).unwrap();
        let permit = gate.take(&owner.session, &owner.identity, now).unwrap();
        owner
            .session
            .lock()
            .unwrap()
            .revoke(&owner.identity)
            .unwrap();
        assert!(!permit.current(now));
        let owner = Arc::new(super::super::tests::fixture(Arc::new(Sink)).await);
        gate.arm(&owner, now).unwrap();
        let session = owner.session.clone();
        let identity = owner.identity.clone();
        drop(owner);
        assert!(gate.take(&session, &identity, now).is_none());
    }
}

impl CefBrowserHost<'_> {
    /// Inspect this exact visible native view, including a failed/loading page.
    /// The caller must authenticate the app window and current presentation.
    /// Repeated calls focus CEF's existing inspector instead of toggling it off.
    pub fn open_devtools(&self, identity: &BrowserIdentity) -> Result<(), BrowserError> {
        let browser = self.check(identity)?;
        if !self.shared.focus_allowed(Some(&browser)) {
            return Err(ControlError::InvalidTransition.into());
        }
        let host = self.native_host(&browser)?;
        let mut client = InspectorClient::new(Arc::downgrade(&self.shared));
        let pending = if host.has_dev_tools() == 0 {
            Some(
                self.shared
                    .inspector_bootstrap
                    .arm(&self.shared, Instant::now())?,
            )
        } else {
            None
        };
        host.show_dev_tools(
            Some(&WindowInfo::default()),
            Some(&mut client),
            Some(&BrowserSettings::default()),
            None,
        );
        // Pinned CEF creates its DevTools host synchronously on the UI thread.
        if host.has_dev_tools() != 1 {
            if let Some(pending) = pending {
                pending.store(true, Ordering::Release);
            }
            return Err(BrowserError::StateUnavailable);
        }
        Ok(())
    }
}

/// CEF otherwise copies the inspected browser's extra_info and may reuse its
/// client. Neither the renderer feature configuration nor NativeLife (which
/// manages the embedded child and its owner session) belongs to the inspector.
pub(super) fn prepare_popup(
    shared: &Arc<Shared>,
    client: Option<&mut Option<Client>>,
    extra_info: Option<&mut Option<DictionaryValue>>,
    use_default_window: Option<&mut i32>,
) {
    if let Some(extra_info) = extra_info {
        *extra_info = None;
    }
    if let Some(client) = client {
        *client = Some(InspectorClient::new(Arc::downgrade(shared)));
    }
    if let Some(use_default_window) = use_default_window {
        *use_default_window = 1;
    }
}

wrap_client! {
    struct InspectorClient { owner: Weak<Shared> }
    impl Client {
        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(InspectorLife::new(self.owner.clone()))
        }
        fn request_handler(&self) -> Option<RequestHandler> {
            Some(InspectorRequests::new(self.owner.clone()))
        }
        fn command_handler(&self) -> Option<CommandHandler> { Some(DenyCommands::new()) }
        // No page process-message, login, permission, or automation handlers.
    }
}

wrap_life_span_handler! {
    struct InspectorLife { owner: Weak<Shared> }
    impl LifeSpanHandler {
        fn on_after_created(&self, browser: Option<&mut Browser>) {
            // Closing/locking the owner cannot leave a late inspector alive.
            let allowed = self.owner.upgrade().is_some_and(|owner| {
                owner.current()
                    && !owner.input_blocked.load(Ordering::Acquire)
                    && owner.state.lock().is_ok_and(|state| state.control.lifecycle() == Lifecycle::Attached)
            });
            if !allowed {
                if let Some(host) = browser.and_then(|browser| browser.host()) {
                    host.close_browser(1);
                }
            }
        }
        fn on_before_popup(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            _popup_id: i32, _target_url: Option<&CefString>, _target_frame_name: Option<&CefString>,
            _target_disposition: WindowOpenDisposition, _user_gesture: i32, _popup_features: Option<&PopupFeatures>,
            _window_info: Option<&mut WindowInfo>, _client: Option<&mut Option<Client>>,
            _settings: Option<&mut BrowserSettings>, _extra_info: Option<&mut Option<DictionaryValue>>,
            _no_javascript_access: Option<&mut i32>) -> i32 { 1 }
    }
}

wrap_request_handler! {
    struct InspectorRequests { owner: Weak<Shared> }
    impl RequestHandler {
        fn on_before_browse(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            request: Option<&mut Request>, _user_gesture: i32, _is_redirect: i32) -> i32 {
            // The inspector is not an uncontained general-purpose browser.
            i32::from(!request.is_some_and(|request| {
                let url = CefString::from(&request.url()).to_string();
                bundled_document(&url)
            }))
        }
        fn resource_request_handler(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            request: Option<&mut Request>, _is_navigation: i32, _is_download: i32,
            _request_initiator: Option<&CefString>, _disable_default_handling: Option<&mut i32>) -> Option<ResourceRequestHandler> {
            // Only this isolated inspector client can load CEF's bundled UI
            // and Chromium's local theme stylesheet.
            // Returning None for other URLs preserves the owning request
            // context's existing origin, proxy and revocation checks.
            request.filter(|request| inspector_resource(&CefString::from(&request.url()).to_string()))
                .map(|_| InspectorResources::new(self.owner.clone()))
        }
        fn on_open_urlfrom_tab(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            _target_url: Option<&CefString>, _target_disposition: WindowOpenDisposition,
            _user_gesture: i32) -> i32 { 1 }
    }
}

wrap_resource_request_handler! {
    struct InspectorResources { owner: Weak<Shared> }
    impl ResourceRequestHandler {
        fn on_before_resource_load(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            request: Option<&mut Request>, _callback: Option<&mut Callback>) -> ReturnValue {
            if self.owner.upgrade().is_some_and(|owner| owner.current())
                && request.is_some_and(|request| inspector_resource(&CefString::from(&request.url()).to_string())) {
                ReturnValue::CONTINUE
            } else {
                ReturnValue::CANCEL
            }
        }
    }
}
