//! Native CEF child lifecycle. Creating this engineering host only loads the
//! inert about:blank bootstrap; it never reports NativeHostReadiness::Ready.
//! The runtime owner must pass containment and dark/login initialization gates
//! before enabling website navigation. No native handle or command is page IPC.

use crate::cef_context::{ContextError, PrivateRequestContext};
use crate::cef_requests::{navigation_allowed, request_handler_with_lifecycle, RequestLifecycle};
use crate::control::{BrowserControl, ControlError, Lifecycle, ViewportBounds};
use crate::domain_permissions::WebsitePermissionEngine;
use crate::native_automation::{
    wire as automation_wire, NativeAutomationAction, NativeAutomationCompletion,
    NativeAutomationFailure, NativeAutomationPermissions, NativeAutomationReply,
    AUTOMATION_TIMEOUT_MS,
};
use crate::native_capabilities::NativeBrowserCapabilities;
use crate::native_features::{
    https_origin, stage_allowed, LoginBudget, NativeCapabilityKind, NativeCapabilityRequest,
    NativeCertificateChallenge, NativeCertificateDecision, NativeCertificatePolicy,
    NativeFeatureStatus, NativeLoginAdapter, NativeLoginCredentials, NativeLoginRequest,
    NativeLoginStage, RendererFeatureGate, FEATURE_PROTOCOL_PIN,
};
use crate::native_media::{MediaPermissionDecision, NativeMediaChallenge};
#[cfg(target_os = "linux")]
use crate::platform::linux::NativeChildParent;
#[cfg(target_os = "macos")]
use crate::platform::macos::NativeChildParent;
#[cfg(target_os = "windows")]
use crate::platform::windows::NativeChildParent;
use cef::rc::Rc;
use cef::*;
use raw_window_handle::{HasDisplayHandle, HasWindowHandle};
use sorng_protocols::origin_browser::{
    BrowserIdentity, BrowserSessionStatus, OriginBrowserSession,
};
use std::collections::HashMap;
use std::marker::PhantomData;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::rc::Rc as ThreadBound;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

static NEXT_CERTIFICATE_REQUEST: AtomicU64 = AtomicU64::new(1);
static NEXT_AUTOMATION_REQUEST: AtomicU64 = AtomicU64::new(1);
static NEXT_MEDIA_REQUEST: AtomicU64 = AtomicU64::new(1);

fn login_form_options(adapter: NativeLoginAdapter, options: Option<&str>) -> Option<&str> {
    match (adapter, options) {
        (NativeLoginAdapter::ModularForm, None) => None,
        (NativeLoginAdapter::ModularForm, Some(options)) => Some(options),
        // Stage-specific providers must not accidentally receive an ordinary
        // form's extra-field values along with an identifier-only grant.
        (_, Some(_)) => None,
        (_, None) => Some(crate::cef_renderer::DEFAULT_FORM_OPTIONS),
    }
}

fn promptable_certificate_error(error: Errorcode, status: u32) -> bool {
    matches!(error, Errorcode::CERT_COMMON_NAME_INVALID | Errorcode::CERT_DATE_INVALID | Errorcode::CERT_AUTHORITY_INVALID)
        // Do not let an overridable headline hide revocation, weak crypto or
        // other unsupported failures in the certificate-status bit mask.
        && status != 0 && status & !7 == 0
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum BrowserError {
    #[error("Browser operation requires the CEF UI thread")]
    WrongThread,
    #[error("Browser parent or native child is unavailable")]
    NativeSurface,
    #[error("Browser creation failed")]
    CreationFailed,
    #[error("Browser attempt is unavailable")]
    SessionUnavailable,
    #[error("Browser native state is unavailable")]
    StateUnavailable,
    #[error("The selected application's native automatic-login adapter is not implemented")]
    UnsupportedLoginAdapter,
    #[error(
        "Native certificate policy requires verification unavailable in this CEF callback path"
    )]
    UnsupportedCertificatePolicy,
    #[error("Native certificate challenge is unavailable or expired")]
    CertificateChallengeUnavailable,
    #[error(transparent)]
    Context(#[from] ContextError),
    #[error(transparent)]
    Control(#[from] ControlError),
}

/// Never transports userinfo, a path, query values, fragment or an engine error
/// URL. Unknown/oversized/non-web values are represented without their contents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RedactedUrl {
    Bootstrap,
    Origin(String),
    Unavailable,
}

/// Arbitrary page titles can contain credentials/tokens, even without a URL.
/// Diagnostics retain only presence; owner-window display is separate below.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RedactedTitle {
    Empty,
    Present,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowserFault {
    NativeSurface,
    Renderer,
    Load,
    Callback,
    Session,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserState {
    pub lifecycle: Lifecycle,
    pub url: RedactedUrl,
    pub title: RedactedTitle,
    pub loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub fault: Option<BrowserFault>,
}

/// Native only. The app owner chooses the eventual bounded IPC DTO and must
/// reject stale attempt IDs and non-increasing sequence numbers at its sink.
pub struct BrowserEvent {
    pub identity: BrowserIdentity,
    pub sequence: u64,
    pub state: BrowserState,
    /// Private owner-window UI data. NEVER diagnostics or broadcasts.
    pub display: BrowserDisplayState,
}

/// May contain page tokens/personal information. Deliberately no Debug/serde.
/// Only the authenticated owner window may receive these bounded UI strings.
#[derive(Default)]
pub struct BrowserDisplayState {
    pub url: String,
    pub title: String,
}

fn display_text_safe(value: &str, max: usize) -> bool {
    value.len() <= max
        && !value.chars().any(|c| {
            c.is_control() || matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
}

fn display_url(value: &str) -> String {
    if value == "about:blank" {
        return value.into();
    }
    if !display_text_safe(value, 16_384) || value.contains('\\') {
        return String::new();
    }
    let Ok(url) = url::Url::parse(value) else {
        return String::new();
    };
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return String::new();
    }
    let canonical = url.to_string();
    if canonical.len() <= 16_384 {
        canonical
    } else {
        String::new()
    }
}

/// Called without session/control locks. Implementations must enqueue bounded
/// work promptly. Panics revoke the attempt and never unwind through CEF.
pub trait BrowserEventSink: Send + Sync {
    fn on_event(&self, event: BrowserEvent);
}

/// Bounded native navigation diagnostics. No page-supplied strings, URLs or
/// request headers cross this hook, and observations never grant permission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeNavigationStatus {
    Requested,
    BeforeBrowse {
        allowed: bool,
        main_frame: bool,
    },
    LoadError {
        code: i32,
        main_frame: bool,
    },
    ResourceAdmission {
        resource_type: i32,
        is_navigation: i32,
        browser_present: bool,
        frame_present: bool,
        initiator_empty: bool,
        initiator_opaque: bool,
        default_disabled: bool,
    },
    AuthChallenge {
        proxy: bool,
        callback_present: bool,
    },
    AuthCompleted {
        handled: bool,
    },
}

/// Native owner callbacks. Notifications carry no secrets or frame handles;
/// credential delivery is a separate synchronous, consent-checked operation.
pub trait NativeDocumentHooks: Send + Sync {
    fn on_main_document(&self, identity: &BrowserIdentity, sequence: u64);

    /// Immutable saved-application policy, queried once during host creation.
    /// A known but unported application must return Unsupported, never Generic.
    fn login_adapter(&self) -> NativeLoginAdapter {
        NativeLoginAdapter::Unsupported
    }

    /// Native saved-profile data, not an IPC permission or page suggestion.
    /// Factory settings contain selectors/readiness only. Extra field values
    /// remain browser-process private until a credential grant is delivered.
    fn form_configuration(&self) -> Option<String> {
        None
    }

    /// Release optional extra-field values under the SAME native grant as the
    /// credentials. Default preserves existing non-modular adapters; a modular
    /// form requires an explicit options grant and will reject None.
    fn with_form_credentials(
        &self,
        request: &NativeLoginRequest<'_>,
        deliver: &mut dyn FnMut(NativeLoginCredentials<'_>, Option<&str>),
    ) {
        self.with_auto_login(request, &mut |credentials| deliver(credentials, None));
    }

    fn certificate_policy(&self) -> NativeCertificatePolicy {
        NativeCertificatePolicy::Strict
    }

    /// Return true only after enqueueing a bounded native-owner prompt. No
    /// blocking dialog here. Resolve on CEF UI thread by attempt + request ID.
    /// Default denial, false, panic, timeout and host revocation cancel it.
    fn on_certificate_challenge(&self, _challenge: NativeCertificateChallenge) -> bool {
        false
    }

    /// The request has already been denied; this notification grants nothing.
    fn on_capability_denied(&self, _request: NativeCapabilityRequest) {}

    /// The host retains the CEF callback and rechecks the current document.
    /// Dropping the completion (including the default implementation) denies.
    fn on_media_permission(
        &self,
        _challenge: crate::native_media::NativeMediaChallenge,
        _completion: crate::native_media::MediaPermissionCompletion,
    ) {
    }

    /// Recheck the live native owner/attempt when consuming asynchronous media
    /// approval. A dialog's earlier allow is not an enduring permission grant.
    fn media_permission_current(&self, _identity: &BrowserIdentity) -> bool {
        false
    }

    /// Engineering observation, not evidence of a successful page load.
    fn on_navigation_status(&self, _identity: &BrowserIdentity, _status: NativeNavigationStatus) {}

    /// Non-secret engineering observation. `origin` is canonical HTTPS or the
    /// inert bootstrap. Never interpret installation as production readiness,
    /// or adapter completion as successful authentication. Enqueue promptly.
    fn on_feature_status(
        &self,
        _identity: &BrowserIdentity,
        _origin: &str,
        _status: NativeFeatureStatus,
    ) {
    }

    /// Native registry integration point. Recheck unlocked owner, current
    /// attempt and explicit exact-origin disclosure/submission consent here.
    /// Invoke `deliver` synchronously at most once while that grant is valid.
    /// No grant is inferred from domain/network permissions. Default is deny.
    fn with_auto_login(
        &self,
        _request: &NativeLoginRequest<'_>,
        _deliver: &mut dyn FnMut(NativeLoginCredentials<'_>),
    ) {
    }
}

struct State {
    control: BrowserControl,
    browser_id: Option<i32>,
    sequence: u64,
    page: BrowserState,
    display: BrowserDisplayState,
    cleanup: CleanupProgress,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum CleanupProgress {
    #[default]
    Idle,
    CloseQueued,
    CloseIssued,
    DestroyQueued,
    DestroyIssued,
    Failed,
    Complete,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CleanupStage {
    Close,
    Destroy,
}

impl CleanupStage {
    fn queued(self) -> CleanupProgress {
        match self {
            Self::Close => CleanupProgress::CloseQueued,
            Self::Destroy => CleanupProgress::DestroyQueued,
        }
    }

    fn issued(self) -> CleanupProgress {
        match self {
            Self::Close => CleanupProgress::CloseIssued,
            Self::Destroy => CleanupProgress::DestroyIssued,
        }
    }
}

impl State {
    fn cleanup_matches(&self, identity: &BrowserIdentity, browser_id: i32) -> bool {
        self.control.identity() == identity
            && self.browser_id == Some(browser_id)
            && matches!(
                self.control.lifecycle(),
                Lifecycle::Faulted | Lifecycle::Closing
            )
    }

    fn queue_cleanup(
        &mut self,
        identity: &BrowserIdentity,
        browser_id: i32,
        stage: CleanupStage,
    ) -> bool {
        if !self.cleanup_matches(identity, browser_id) {
            return false;
        }
        let available = match stage {
            CleanupStage::Close => self.cleanup == CleanupProgress::Idle,
            // CEF can initiate DoClose without an application close request.
            CleanupStage::Destroy => matches!(
                self.cleanup,
                CleanupProgress::Idle | CleanupProgress::CloseQueued | CleanupProgress::CloseIssued
            ),
        };
        if available {
            self.cleanup = stage.queued();
        }
        available
    }

    fn claim_cleanup(
        &mut self,
        identity: &BrowserIdentity,
        browser_id: i32,
        stage: CleanupStage,
    ) -> bool {
        if !self.cleanup_matches(identity, browser_id) || self.cleanup != stage.queued() {
            return false;
        }
        self.cleanup = stage.issued();
        true
    }
}

struct Shared {
    session: Arc<Mutex<OriginBrowserSession>>,
    identity: BrowserIdentity,
    permissions: Arc<WebsitePermissionEngine>,
    state: Arc<Mutex<State>>,
    sink: Arc<dyn BrowserEventSink>,
    hooks: Option<Arc<dyn NativeDocumentHooks>>,
    login_budget: Mutex<LoginBudget>,
    feature_gate: Mutex<RendererFeatureGate>,
    login_adapter: NativeLoginAdapter,
    certificate_policy: NativeCertificatePolicy,
    certificate_pending: Mutex<Option<PendingCertificate>>,
    automation: Mutex<AutomationState>,
    capabilities: NativeBrowserCapabilities,
    // Native handles are inspected/completed only on the CEF UI thread. The
    // native owner receives only a pure challenge and one-shot decision token.
    media_pending: Mutex<Option<PendingMedia>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct MediaDocumentFence {
    generation: u64,
    origin: String,
    frame_id: String,
    frame_url: String,
    main_frame_id: String,
    main_frame_url: String,
}

struct PendingMedia {
    request_id: u64,
    browser: Browser,
    fence: MediaDocumentFence,
    requested: u32,
    decision: MediaPermissionDecision,
    callback: MediaAccessCallback,
}

fn device_media_permissions(requested: u32) -> bool {
    // CEF_MEDIA_PERMISSION_DEVICE_AUDIO_CAPTURE | DEVICE_VIDEO_CAPTURE.
    // Desktop/screen capture and unknown/future capabilities are never granted.
    requested != 0 && requested & !3 == 0
}

fn media_permissions_for_document(
    requested: u32,
    decision: &MediaPermissionDecision,
    expected: &MediaDocumentFence,
    current: Option<&MediaDocumentFence>,
    owner_current: bool,
    now: Instant,
) -> u32 {
    if owner_current
        && device_media_permissions(requested)
        && current == Some(expected)
        && decision.decision(now) == Some(true)
    {
        requested
    } else {
        0
    }
}

#[derive(Default)]
struct AutomationState {
    generation: u64,
    invalidating: usize,
    navigating: bool,
    document: Option<AutomationDocumentReceipt>,
    pending: HashMap<String, PendingAutomation>,
}

struct AutomationDocumentReceipt {
    token: String,
    renderer_token: String,
    origin: String,
    frame: String,
    url: String,
}

struct PendingAutomation {
    generation: u64,
    token: Option<String>,
    origin: String,
    request: String,
    frame: String,
    url: String,
    stop: bool,
    deadline: Instant,
    completion: NativeAutomationCompletion,
}

struct AutomationResponse {
    serial: String,
    token: String,
    origin: String,
    request: String,
    status: String,
    steps: Vec<crate::native_automation::NativeAutomationStep>,
    truncated: bool,
}

fn complete_automation(completion: NativeAutomationCompletion, reply: NativeAutomationReply) {
    // Owner callback panics must not unwind through a CEF native callback.
    let _ = catch_unwind(AssertUnwindSafe(|| completion(reply)));
}

impl AutomationState {
    fn available(&self) -> bool {
        self.invalidating == 0 && !self.navigating && self.generation != u64::MAX
    }

    fn invalidate(&mut self) -> HashMap<String, PendingAutomation> {
        self.generation = self.generation.saturating_add(1);
        self.document = None;
        std::mem::take(&mut self.pending)
    }

    fn matches(&self, token: &str, origin: &str, frame: &str, url: &str) -> bool {
        self.document.as_ref().is_some_and(|doc| {
            doc.token == token && doc.origin == origin && doc.frame == frame && doc.url == url
        })
    }

    fn dispatch_failure(
        &self,
        action: &NativeAutomationAction,
        frame: &str,
        url: &str,
    ) -> Option<NativeAutomationFailure> {
        // Retired cleanup is already satisfied even while the successor is
        // loading. Preserve that distinction for the client's cancellation
        // barrier without permitting operations on a replacement document.
        if action
            .scope()
            .is_some_and(|(token, origin, _)| !self.matches(token, origin, frame, url))
        {
            return Some(NativeAutomationFailure::StaleDocument);
        }
        (!self.available()).then_some(NativeAutomationFailure::Unavailable)
    }

    fn finish(
        &mut self,
        frame: &str,
        url: &str,
        response: AutomationResponse,
        now: Instant,
    ) -> Option<(NativeAutomationCompletion, NativeAutomationReply)> {
        let AutomationResponse {
            serial,
            token,
            origin,
            request,
            status,
            steps,
            truncated,
        } = response;
        let pending = self.pending.get(&serial)?;
        if !self.available()
            || pending.generation != self.generation
            || pending.frame != frame
            || pending.url != url
            || pending.request != request
        {
            return None;
        }
        let failed = status == "stale" || status == "failed";
        if !failed && (origin != pending.origin || token.is_empty()) {
            return None;
        }
        if let Some(expected) = &pending.token {
            if !self
                .document
                .as_ref()
                .is_some_and(|doc| doc.renderer_token == token)
                || origin != pending.origin
                || !self.matches(expected, &origin, frame, url)
            {
                return None;
            }
        }
        let reply = if now >= pending.deadline {
            NativeAutomationReply::Failed {
                reason: NativeAutomationFailure::TimedOut,
            }
        } else if failed {
            NativeAutomationReply::Failed {
                reason: if status == "stale" {
                    NativeAutomationFailure::StaleDocument
                } else {
                    NativeAutomationFailure::ExecutionFailed
                },
            }
        } else if pending.token.is_none() && status == "document" && steps.is_empty() {
            let public_token = format!("{}:{}", self.generation, token);
            if public_token.len() > 80 {
                return None;
            }
            self.document = Some(AutomationDocumentReceipt {
                token: public_token.clone(),
                renderer_token: token,
                origin: origin.clone(),
                frame: frame.to_owned(),
                url: url.to_owned(),
            });
            NativeAutomationReply::Document {
                document_token: public_token,
                origin,
            }
        } else if pending.stop && status == "stopped" {
            NativeAutomationReply::RecordingStopped {
                request_id: request,
                steps,
                truncated,
            }
        } else if pending.token.is_some() && !pending.stop && status == "ok" && steps.is_empty() {
            NativeAutomationReply::Completed {
                request_id: request,
            }
        } else {
            return None;
        };
        self.pending
            .remove(&serial)
            .map(|pending| (pending.completion, reply))
    }
}

struct PendingCertificate {
    request_id: u64,
    origin: String,
    expires_at: Instant,
    callback: Box<dyn CertificateCompletion>,
}

trait CertificateCompletion: Send + Sync {
    fn continue_request(&self);
    fn cancel_request(&self);
}

impl CertificateCompletion for Callback {
    fn continue_request(&self) {
        self.cont();
    }
    fn cancel_request(&self) {
        self.cancel();
    }
}

// Only UI-thread callbacks inspect this slot. Atomic ownership allows CEF's
// final client release on another thread without a non-atomic Rc teardown.
// No Send/Sync implementation is added for Browser or the host.
type BrowserSlot = Arc<Mutex<Option<Browser>>>;

trait ParentWindow: HasWindowHandle + HasDisplayHandle {}
impl<W: HasWindowHandle + HasDisplayHandle> ParentWindow for W {}

enum ParentLifetime<'a> {
    Borrowed { _parent: NativeChildParent<'a> },
    Owned { _parent: Arc<dyn ParentWindow> },
}

fn emit_state(
    state: &Mutex<State>,
    identity: &BrowserIdentity,
    sink: &dyn BrowserEventSink,
) -> bool {
    let event = {
        let Ok(mut state) = state.lock() else {
            return false;
        };
        state.sequence = state.sequence.saturating_add(1);
        state.page.lifecycle = state.control.lifecycle();
        BrowserEvent {
            identity: identity.clone(),
            sequence: state.sequence,
            state: state.page.clone(),
            display: BrowserDisplayState {
                url: state.display.url.clone(),
                title: state.display.title.clone(),
            },
        }
    };
    catch_unwind(AssertUnwindSafe(|| sink.on_event(event))).is_ok()
}

#[derive(Clone)]
struct CleanupOwner {
    state: Arc<Mutex<State>>,
    session: Arc<Mutex<OriginBrowserSession>>,
    identity: BrowserIdentity,
    sink: Arc<dyn BrowserEventSink>,
}

impl CleanupOwner {
    // Revocation authorizes cleanup, not navigation. Never use Shared::current()
    // here: every legitimate fault/close has already revoked this same attempt.
    fn revoked_attempt(&self) -> bool {
        self.session.lock().is_ok_and(|session| {
            session.policy().identity() == &self.identity
                && session.status() == BrowserSessionStatus::Revoked
        })
    }

    fn queue(&self, browser_id: i32, stage: CleanupStage) -> bool {
        self.revoked_attempt()
            && self
                .state
                .lock()
                .is_ok_and(|mut state| state.queue_cleanup(&self.identity, browser_id, stage))
    }

    fn claim(&self, browser_id: i32, stage: CleanupStage) -> bool {
        self.revoked_attempt()
            && self
                .state
                .lock()
                .is_ok_and(|mut state| state.claim_cleanup(&self.identity, browser_id, stage))
    }

    fn issued(&self, browser: &Browser, browser_id: i32, stage: CleanupStage) -> bool {
        // These two browser methods remain permitted after OnBeforeClose.
        browser.is_valid() == 1
            && browser.identifier() == browser_id
            && self.revoked_attempt()
            && self.state.lock().is_ok_and(|state| {
                state.cleanup_matches(&self.identity, browser_id) && state.cleanup == stage.issued()
            })
    }

    fn failed(&self, browser_id: i32, stage: CleanupStage) {
        let changed = self.state.lock().is_ok_and(|mut state| {
            if !state.cleanup_matches(&self.identity, browser_id)
                || !matches!(state.cleanup, value if value == stage.queued() || value == stage.issued())
            {
                return false;
            }
            state.cleanup = CleanupProgress::Failed;
            let _ = state.control.fault(&self.identity);
            state.page.fault = Some(BrowserFault::NativeSurface);
            state.page.loading = false;
            state.page.can_go_back = false;
            state.page.can_go_forward = false;
            true
        });
        if changed {
            // No retry/inline destruction/parent close fallback, even if the
            // sink panics. The failed, revoked attempt remains observable.
            let _ = emit_state(&self.state, &self.identity, self.sink.as_ref());
        }
    }

    fn execute(&self, browser: &Browser, browser_id: i32, stage: CleanupStage) {
        if currently_on(ThreadId::UI) != 1 {
            self.failed(browser_id, stage);
            return;
        }
        if !self.claim(browser_id, stage) || !self.issued(browser, browser_id, stage) {
            return;
        }
        if stage == CleanupStage::Close {
            browser.stop_load();
            if !self.issued(browser, browser_id, stage) {
                return;
            }
        }
        let Some(host) = browser.host() else {
            self.failed(browser_id, stage);
            return;
        };
        if !self.issued(browser, browser_id, stage) {
            return;
        }
        if stage == CleanupStage::Close {
            host.set_focus(0);
            if !self.issued(browser, browser_id, stage) {
                return;
            }
        }
        let window = host.window_handle();
        if !self.issued(browser, browser_id, stage) {
            return;
        }
        match stage {
            CleanupStage::Close => {
                // A hide failure must not prevent attempting the queued close.
                let _ = native_surface::visible(window, false);
                if !self.issued(browser, browser_id, stage) {
                    return;
                }
                host.close_browser(1);
                // Alloy may synchronously invoke DoClose. No more native calls.
            }
            CleanupStage::Destroy => {
                let destroyed = native_surface::destroy(window).is_ok();
                // DestroyWindow may synchronously run OnBeforeClose. Never
                // inspect browser/host/window again, including the error path.
                if !destroyed {
                    self.failed(browser_id, stage);
                }
            }
        }
    }
}

wrap_task! {
    struct DeferredCleanup { owner: CleanupOwner, browser: Browser, browser_id: i32, stage: CleanupStage }
    impl Task {
        fn execute(&self) {
            self.owner.execute(&self.browser, self.browser_id, self.stage);
        }
    }
}

fn redact_url(value: &str) -> RedactedUrl {
    if value == "about:blank" {
        return RedactedUrl::Bootstrap;
    }
    if value.len() > 16_384 {
        return RedactedUrl::Unavailable;
    }
    let Ok(url) = url::Url::parse(value) else {
        return RedactedUrl::Unavailable;
    };
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() {
        return RedactedUrl::Unavailable;
    }
    let origin = url.origin().ascii_serialization();
    if origin.len() > 1024 {
        RedactedUrl::Unavailable
    } else {
        RedactedUrl::Origin(origin)
    }
}

impl Shared {
    fn media_owner_current(&self) -> bool {
        self.capabilities.media_stream_enabled
            && self.current()
            && self.hooks.as_ref().is_some_and(|hooks| {
                catch_unwind(AssertUnwindSafe(|| {
                    hooks.media_permission_current(&self.identity)
                }))
                .unwrap_or(false)
            })
    }

    // Safe from non-UI revocation paths: change only the pure decision token.
    // The bounded UI poll owns callback completion. Navigation/close also drain
    // the callback synchronously while already on the UI thread.
    fn cancel_media(&self) {
        if let Some(pending) = self
            .media_pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            pending.decision.deny();
        }
    }

    fn deny_media_on_ui(&self, request_id: Option<u64>) {
        let pending = {
            let mut slot = self.media_pending.lock().unwrap_or_else(|e| e.into_inner());
            if request_id.is_some_and(|id| slot.as_ref().is_none_or(|p| p.request_id != id)) {
                return;
            }
            slot.take()
        };
        if let Some(pending) = pending {
            pending.decision.deny();
            pending.callback.cont(0);
        }
    }

    fn media_document(
        &self,
        browser: &Browser,
        frame_id: &str,
        origin: &str,
    ) -> Option<MediaDocumentFence> {
        if !self.media_owner_current() || !self.accepts(Some(browser)) {
            return None;
        }
        let frame = browser.frame_by_identifier(Some(&CefString::from(frame_id)))?;
        let main = browser.main_frame()?;
        if frame.is_valid() != 1
            || main.is_valid() != 1
            || main.is_main() != 1
            || frame
                .browser()
                .is_none_or(|owner| owner.identifier() != browser.identifier())
        {
            return None;
        }
        let frame_url = CefString::from(&frame.url()).to_string();
        let main_frame_url = CefString::from(&main.url()).to_string();
        if https_origin(&frame_url).as_deref() != Some(origin)
            || https_origin(&main_frame_url).as_deref() != Some(origin)
        {
            return None;
        }
        if !self.session.lock().is_ok_and(|session| {
            session.status() == BrowserSessionStatus::Ready
                && session
                    .authorize_navigation(&self.identity, &frame_url)
                    .is_ok()
                && session
                    .authorize_navigation(&self.identity, &main_frame_url)
                    .is_ok()
        }) {
            return None;
        }
        let state = self.automation.lock().ok()?;
        if !state.available() {
            return None;
        }
        Some(MediaDocumentFence {
            generation: state.generation,
            origin: origin.to_owned(),
            frame_id: CefString::from(&frame.identifier()).to_string(),
            frame_url,
            main_frame_id: CefString::from(&main.identifier()).to_string(),
            main_frame_url,
        })
    }

    fn request_media(
        self: &Arc<Self>,
        browser: Option<&Browser>,
        frame: Option<&Frame>,
        origin: Option<&CefString>,
        requested: u32,
        callback: Option<&MediaAccessCallback>,
    ) -> bool {
        if !device_media_permissions(requested) || !self.media_owner_current() {
            return false;
        }
        let (Some(browser), Some(frame), Some(origin), Some(callback), Some(hooks)) =
            (browser, frame, origin, callback, self.hooks.as_ref())
        else {
            return false;
        };
        if frame.is_valid() != 1 || !origin.as_slice().is_some_and(|s| s.len() <= 1024) {
            return false;
        }
        let Ok(origin) =
            crate::domain_permissions::canonical_website_permission_origin(&origin.to_string())
        else {
            return false;
        };
        let frame_id = CefString::from(&frame.identifier()).to_string();
        let Some(fence) = self.media_document(browser, &frame_id, &origin) else {
            return false;
        };
        if frame
            .browser()
            .is_none_or(|owner| owner.identifier() != browser.identifier())
            || CefString::from(&frame.url()).to_string() != fence.frame_url
        {
            return false;
        }
        let Ok(request_id) =
            NEXT_MEDIA_REQUEST
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
        else {
            return false;
        };
        let expires_at = Instant::now() + Duration::from_secs(60);
        let (decision, completion) = MediaPermissionDecision::pending(expires_at);
        {
            let Ok(mut slot) = self.media_pending.lock() else {
                return false;
            };
            if slot.is_some() {
                return false;
            }
            *slot = Some(PendingMedia {
                request_id,
                browser: browser.clone(),
                fence,
                requested,
                decision,
                callback: callback.clone(),
            });
        }
        let mut poll = MediaPoll::new(Arc::downgrade(self), request_id);
        if post_delayed_task(ThreadId::UI, Some(&mut poll), 10) != 1 {
            self.deny_media_on_ui(Some(request_id));
            return true;
        }
        let challenge = NativeMediaChallenge {
            identity: self.identity.clone(),
            origin,
            audio: requested & 1 != 0,
            video: requested & 2 != 0,
            expires_at,
        };
        if catch_unwind(AssertUnwindSafe(|| {
            hooks.on_media_permission(challenge, completion)
        }))
        .is_err()
        {
            self.deny_media_on_ui(Some(request_id));
        }
        true
    }

    fn poll_media(self: &Arc<Self>, request_id: u64) {
        // Copy only for UI-thread validation, with no mutex held over native or
        // owner calls. The slot retains the cancellation token until completion.
        let snapshot = self.media_pending.lock().ok().and_then(|slot| {
            slot.as_ref()
                .filter(|p| p.request_id == request_id)
                .map(|p| {
                    (
                        p.browser.clone(),
                        p.fence.clone(),
                        p.decision.decision(Instant::now()),
                    )
                })
        });
        let Some((browser, fence, decision)) = snapshot else {
            self.deny_media_on_ui(Some(request_id));
            return;
        };
        if decision == Some(false)
            || self
                .media_document(&browser, &fence.frame_id, &fence.origin)
                .as_ref()
                != Some(&fence)
        {
            self.deny_media_on_ui(Some(request_id));
            return;
        }
        if decision.is_none() {
            let mut poll = MediaPoll::new(Arc::downgrade(self), request_id);
            if post_delayed_task(ThreadId::UI, Some(&mut poll), 100) != 1 {
                self.deny_media_on_ui(Some(request_id));
            }
            return;
        }
        let pending = {
            let mut slot = self.media_pending.lock().unwrap_or_else(|e| e.into_inner());
            if slot.as_ref().is_none_or(|p| p.request_id != request_id) {
                return;
            }
            slot.take().unwrap()
        };
        // Final consumption rechecks expiration, native document generation,
        // exact frame/main URLs and the current owner/attempt. Never cache allow.
        let current = self.media_document(&browser, &fence.frame_id, &fence.origin);
        let allowed = media_permissions_for_document(
            pending.requested,
            &pending.decision,
            &fence,
            current.as_ref(),
            self.media_owner_current(),
            Instant::now(),
        );
        pending.decision.deny();
        pending.callback.cont(allowed);
    }

    fn clear_automation(&self) {
        self.cancel_media();
        let pending = {
            let mut state = self
                .automation
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            state.invalidating += 1;
            state.invalidate()
        };
        for (_, pending) in pending {
            complete_automation(
                pending.completion,
                NativeAutomationReply::Failed {
                    reason: NativeAutomationFailure::StaleDocument,
                },
            );
        }
        self.automation
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .invalidating -= 1;
    }

    fn expire_automation(&self, serial: &str) {
        let pending = self
            .automation
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .pending
            .remove(serial);
        if let Some(pending) = pending {
            complete_automation(
                pending.completion,
                NativeAutomationReply::Failed {
                    reason: NativeAutomationFailure::TimedOut,
                },
            );
        }
    }

    fn automation_message(
        &self,
        browser: &Browser,
        frame: &Frame,
        source: ProcessId,
        message: &ProcessMessage,
    ) -> i32 {
        if source != ProcessId::RENDERER
            || CefString::from(&message.name()).to_string() != automation_wire::REPLY
        {
            return 0;
        }
        if !self.current()
            || !self.accepts(Some(browser))
            || frame.is_main() != 1
            || frame.is_valid() != 1
        {
            return 1;
        }
        let Some(main) = browser.main_frame() else {
            return 1;
        };
        let frame_id = CefString::from(&frame.identifier()).to_string();
        if CefString::from(&main.identifier()).to_string() != frame_id {
            return 1;
        }
        let Some(args) = message
            .argument_list()
            .filter(|args| args.size() >= 7 && args.size() <= 607)
        else {
            return 1;
        };
        let (Some(serial), Some(token), Some(origin), Some(request), Some(status)) = (
            automation_wire::text(&args, 0, 32),
            automation_wire::text(&args, 1, 80),
            automation_wire::text(&args, 2, 1024),
            automation_wire::text(&args, 3, 128),
            automation_wire::text(&args, 4, 16),
        ) else {
            return 1;
        };
        let Some(steps) = automation_wire::steps(&args) else {
            return 1;
        };
        if args.get_type(5) != ValueType::BOOL {
            return 1;
        }
        let url = CefString::from(&frame.url()).to_string();
        let result = {
            let mut state = self
                .automation
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            state.finish(
                &frame_id,
                &url,
                AutomationResponse {
                    serial,
                    token,
                    origin,
                    request,
                    status,
                    steps,
                    truncated: args.bool(5) == 1,
                },
                Instant::now(),
            )
        };
        if let Some((completion, reply)) = result {
            complete_automation(completion, reply);
        }
        1
    }

    fn navigation_status(&self, status: NativeNavigationStatus) {
        if !self.current() {
            return;
        }
        if let Some(hooks) = &self.hooks {
            if catch_unwind(AssertUnwindSafe(|| {
                hooks.on_navigation_status(&self.identity, status);
            }))
            .is_err()
            {
                self.revoke();
            }
        }
    }

    fn cancel_certificate(&self, request_id: Option<u64>) {
        let pending = {
            let mut slot = self
                .certificate_pending
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if request_id
                .is_some_and(|id| slot.as_ref().is_none_or(|pending| pending.request_id != id))
            {
                return;
            }
            slot.take()
        };
        if let Some(pending) = pending {
            pending.callback.cancel_request();
        }
    }

    fn capability_denied(
        &self,
        browser: Option<&Browser>,
        origin: Option<&CefString>,
        target: Option<&CefString>,
        kind: NativeCapabilityKind,
        user_gesture: Option<bool>,
    ) {
        if !self.current() || !self.accepts(browser) {
            return;
        }
        let bounded_origin = |value: Option<&CefString>| {
            value
                .filter(|value| value.as_slice().is_some_and(|s| s.len() <= 16_384))
                .and_then(|value| https_origin(&value.to_string()))
        };
        if let Some(hooks) = &self.hooks {
            let request = NativeCapabilityRequest {
                identity: self.identity.clone(),
                origin: bounded_origin(origin),
                target_origin: bounded_origin(target),
                kind,
                user_gesture,
            };
            if catch_unwind(AssertUnwindSafe(|| hooks.on_capability_denied(request))).is_err() {
                self.fault(browser, BrowserFault::Callback);
            }
        }
    }

    fn certificate_error(
        self: &Arc<Self>,
        browser: Option<&Browser>,
        error: Errorcode,
        request_url: Option<&CefString>,
        ssl_info: Option<&Sslinfo>,
        callback: Option<&Callback>,
    ) -> i32 {
        if self.certificate_policy != NativeCertificatePolicy::PromptInvalidCertificate
            || !self.current()
            || !self.accepts(browser)
            || !matches!(
                error,
                Errorcode::CERT_COMMON_NAME_INVALID
                    | Errorcode::CERT_DATE_INVALID
                    | Errorcode::CERT_AUTHORITY_INVALID
            )
        {
            return 0;
        }
        let (Some(hooks), Some(ssl_info), Some(callback), Some(request_url)) =
            (&self.hooks, ssl_info, callback, request_url)
        else {
            return 0;
        };
        let certificate_status = cef::sys::cef_cert_status_t::from(ssl_info.cert_status()) as u32;
        if !promptable_certificate_error(error, certificate_status) {
            return 0;
        }
        if !request_url
            .as_slice()
            .is_some_and(|value| value.len() <= 16_384)
        {
            return 0;
        }
        let Some(origin) = https_origin(&request_url.to_string()) else {
            return 0;
        };
        if !self.session.lock().is_ok_and(|session| {
            navigation_allowed(&session, &self.identity, &self.permissions, &origin, true)
        }) {
            return 0;
        }
        let Some(binary) = ssl_info
            .x509_certificate()
            .and_then(|cert| cert.derencoded())
        else {
            return 0;
        };
        let size = binary.size();
        if size == 0 || size > 65_536 {
            return 0;
        }
        let mut leaf_der = vec![0; size];
        if binary.data(Some(&mut leaf_der), 0) != size {
            return 0;
        }
        let request_id = NEXT_CERTIFICATE_REQUEST.fetch_add(1, Ordering::Relaxed);
        let expires_at = Instant::now() + Duration::from_secs(30);
        {
            let Ok(mut slot) = self.certificate_pending.lock() else {
                return 0;
            };
            if slot.is_some() {
                return 0;
            }
            *slot = Some(PendingCertificate {
                request_id,
                origin: origin.clone(),
                expires_at,
                callback: Box::new(callback.clone()),
            });
        }
        let mut timeout = CertificateTimeout::new(Arc::downgrade(self), request_id);
        if post_delayed_task(ThreadId::UI, Some(&mut timeout), 30_000) != 1 {
            self.cancel_certificate(Some(request_id));
            return 1;
        }
        let challenge = NativeCertificateChallenge {
            identity: self.identity.clone(),
            request_id,
            origin,
            expires_at,
            leaf_der,
            error_code: cef::sys::cef_errorcode_t::from(error) as i32,
            certificate_status,
        };
        if !catch_unwind(AssertUnwindSafe(|| {
            hooks.on_certificate_challenge(challenge)
        }))
        .unwrap_or(false)
        {
            self.cancel_certificate(Some(request_id));
        }
        1
    }
    fn feature_message(
        &self,
        browser: Option<&Browser>,
        frame: Option<&Frame>,
        source: ProcessId,
        message: Option<&ProcessMessage>,
    ) -> i32 {
        use crate::cef_renderer::{message_text, FEATURE_STATUS};
        let Some(message) = message else {
            return 0;
        };
        if source != ProcessId::RENDERER
            || CefString::from(&message.name()).to_string() != FEATURE_STATUS
        {
            return 0;
        }
        let (Some(browser), Some(frame)) = (browser, frame) else {
            return 1;
        };
        if !self.accepts(Some(browser))
            || !self.current()
            || frame.is_main() != 1
            || frame.is_valid() != 1
        {
            return 1;
        }
        let Some(main) = browser.main_frame() else {
            return 1;
        };
        if CefString::from(&main.identifier()).to_string()
            != CefString::from(&frame.identifier()).to_string()
        {
            return 1;
        }
        let url = CefString::from(&frame.url()).to_string();
        let origin = if url == "about:blank" {
            url
        } else {
            let Some(origin) = https_origin(&url) else {
                return 1;
            };
            origin
        };
        let Some(args) = message.argument_list().filter(|args| args.size() == 3) else {
            return 1;
        };
        if message_text(&args, 0, 1024).as_deref() != Some(&origin) {
            return 1;
        }
        let Some(pin) = message_text(&args, 2, 80) else {
            return 1;
        };
        let status = match message_text(&args, 1, 40).as_deref() {
            Some("installed") => NativeFeatureStatus::RendererInstalled,
            Some("installation-failed") => NativeFeatureStatus::RendererInstallationFailed,
            Some("login-completed") => NativeFeatureStatus::LoginAdapterCompleted,
            Some("login-rejected") => NativeFeatureStatus::LoginAdapterRejected,
            _ => return 1,
        };
        let valid = self
            .feature_gate
            .lock()
            .is_ok_and(|mut gate| gate.observe(&origin, &pin, status));
        if !valid {
            self.fault(Some(browser), BrowserFault::Renderer);
            return 1;
        }
        self.feature_event(Some(browser), &origin, status);
        1
    }

    fn feature_event(&self, browser: Option<&Browser>, origin: &str, status: NativeFeatureStatus) {
        if let Some(hooks) = &self.hooks {
            if catch_unwind(AssertUnwindSafe(|| {
                hooks.on_feature_status(&self.identity, origin, status)
            }))
            .is_err()
            {
                self.fault(browser, BrowserFault::Callback);
            }
        }
    }

    fn login_message(
        &self,
        browser: Option<&Browser>,
        frame: Option<&Frame>,
        source: ProcessId,
        message: Option<&ProcessMessage>,
    ) -> i32 {
        use crate::cef_renderer::{
            message_text, LOGIN_DELIVERY, LOGIN_DELIVERY_STATUS, LOGIN_REQUEST,
        };
        use crate::native_features::NativeLoginDeliveryStatus as Delivery;
        let Some(message) = message else {
            return 0;
        };
        let name = CefString::from(&message.name()).to_string();
        if source != ProcessId::RENDERER
            || !matches!(name.as_str(), LOGIN_REQUEST | LOGIN_DELIVERY_STATUS)
        {
            return 0;
        }
        let (Some(browser), Some(frame)) = (browser, frame) else {
            return 1;
        };
        if !self.accepts(Some(browser))
            || !self.current()
            || frame.is_main() != 1
            || frame.is_valid() != 1
        {
            return 1;
        }
        let Some(main) = browser.main_frame() else {
            return 1;
        };
        if CefString::from(&main.identifier()).to_string()
            != CefString::from(&frame.identifier()).to_string()
        {
            return 1;
        }
        let url = CefString::from(&frame.url()).to_string();
        let Some(origin) = https_origin(&url) else {
            return 1;
        };
        let Some(args) = message.argument_list().filter(|args| args.size() == 3) else {
            return 1;
        };
        if name == LOGIN_DELIVERY_STATUS {
            if message_text(&args, 0, 1024).as_deref() == Some(&origin)
                && message_text(&args, 1, 80).as_deref()
                    == Some(crate::native_features::FEATURE_PROTOCOL_PIN)
                && args.get_type(2) == ValueType::INT
            {
                if let Some(status) = Delivery::from_renderer_wire(args.int(2)) {
                    self.feature_event(
                        Some(browser),
                        &origin,
                        NativeFeatureStatus::LoginDelivery(status),
                    );
                }
            }
            // Observations grant nothing and never enter the credential hook.
            return 1;
        }
        let Some(nonce) = message_text(&args, 0, 80).filter(|nonce| !nonce.is_empty()) else {
            return 1;
        };
        if message_text(&args, 1, 1024).as_deref() != Some(&origin) {
            return 1;
        }
        let Some(stage) =
            message_text(&args, 2, 16).and_then(|value| NativeLoginStage::parse(&value))
        else {
            return 1;
        };
        if !stage_allowed(self.login_adapter, stage, &url) {
            return 1;
        }
        let Some(hooks) = &self.hooks else {
            return 1;
        };
        self.feature_event(
            Some(browser),
            &origin,
            NativeFeatureStatus::LoginFormDetected,
        );
        if !self.current() {
            return 1;
        }
        let request = NativeLoginRequest {
            identity: &self.identity,
            origin: &origin,
            adapter: self.login_adapter,
            stage,
        };
        let mut outcome = Delivery::NativeNotDelivered;
        let mut deliver = |credentials: NativeLoginCredentials<'_>, form_options: Option<&str>| {
            outcome = Delivery::NativeRejectedGrant;
            let Some(form_options) = login_form_options(self.login_adapter, form_options) else {
                return;
            };
            if crate::cef_renderer::parse_login_configuration(form_options).is_none() {
                return;
            }
            outcome = Delivery::NativeRejectedCurrent;
            if !self.current()
                || !self.accepts(Some(browser))
                || https_origin(&CefString::from(&frame.url()).to_string()).as_deref()
                    != Some(&origin)
                || !stage_allowed(
                    self.login_adapter,
                    stage,
                    &CefString::from(&frame.url()).to_string(),
                )
            {
                return;
            }
            let Ok(session) = self.session.lock() else {
                return;
            };
            outcome = Delivery::NativeRejectedNavigation;
            if !navigation_allowed(&session, &self.identity, &self.permissions, &url, true) {
                return;
            }
            let Ok(mut budget) = self.login_budget.lock() else {
                return;
            };
            outcome = Delivery::NativeRejectedGrant;
            if !budget.reserve(&request, &credentials) {
                return;
            }
            outcome = Delivery::NativeMessageFailed;
            let Some(mut response) = process_message_create(Some(&CefString::from(LOGIN_DELIVERY)))
            else {
                return;
            };
            let Some(values) = response.argument_list() else {
                return;
            };
            // Bound in-flight lifetime as well as checking native consent.
            let ttl = credentials
                .valid_until
                .saturating_duration_since(std::time::Instant::now())
                .min(std::time::Duration::from_secs(2));
            let Ok(deadline) =
                (std::time::SystemTime::now() + ttl).duration_since(std::time::UNIX_EPOCH)
            else {
                return;
            };
            let (username, password) = stage.fields(&credentials);
            if values.set_string(0, Some(&CefString::from(nonce.as_str()))) != 1
                || values.set_string(1, Some(&CefString::from(origin.as_str()))) != 1
                || values.set_string(2, Some(&CefString::from(username))) != 1
                || values.set_string(3, Some(&CefString::from(password))) != 1
                || values.set_bool(4, i32::from(credentials.auto_submit)) != 1
                || values.set_double(5, deadline.as_millis() as f64) != 1
                || values.set_string(6, Some(&CefString::from(stage.wire()))) != 1
                || values.set_string(7, Some(&CefString::from(form_options))) != 1
            {
                return;
            }
            frame.send_process_message(ProcessId::RENDERER, Some(&mut response));
            outcome = Delivery::NativeSent;
        };
        if catch_unwind(AssertUnwindSafe(|| {
            hooks.with_form_credentials(&request, &mut deliver)
        }))
        .is_err()
        {
            self.fault(Some(browser), BrowserFault::Callback);
        } else {
            // No session/budget locks or borrowed credentials survive here.
            self.feature_event(
                Some(browser),
                &origin,
                NativeFeatureStatus::LoginDelivery(outcome),
            );
        }
        1
    }

    fn revoke(&self) {
        self.cancel_certificate(None);
        let mut session = self
            .session
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let _ = session.revoke(&self.identity);
        drop(session);
        self.clear_automation();
    }

    fn current(&self) -> bool {
        let session = match self.session.lock() {
            Ok(session) => session,
            Err(poisoned) => {
                let _ = poisoned.into_inner().revoke(&self.identity);
                return false;
            }
        };
        session.policy().identity() == &self.identity
            && matches!(
                session.status(),
                BrowserSessionStatus::NotReady | BrowserSessionStatus::Ready
            )
    }

    fn accepts(&self, browser: Option<&Browser>) -> bool {
        let Some(browser) = browser else {
            return false;
        };
        let Ok(state) = self.state.lock() else {
            self.revoke();
            return false;
        };
        state.browser_id == Some(browser.identifier())
            && matches!(
                state.control.lifecycle(),
                Lifecycle::Attached | Lifecycle::Hidden
            )
            && browser.is_valid() == 1
    }

    fn emit(&self) -> bool {
        if !emit_state(&self.state, &self.identity, self.sink.as_ref()) {
            self.revoke();
            if let Ok(mut state) = self.state.lock() {
                let _ = state.control.fault(&self.identity);
                state.page.fault = Some(BrowserFault::Callback);
            }
            return false;
        }
        true
    }

    fn cleanup_owner(&self) -> CleanupOwner {
        CleanupOwner {
            state: self.state.clone(),
            session: self.session.clone(),
            identity: self.identity.clone(),
            sink: self.sink.clone(),
        }
    }

    fn schedule_cleanup(&self, browser: Option<&Browser>, stage: CleanupStage) {
        let Some(browser) = browser.filter(|browser| browser.is_valid() == 1) else {
            if stage == CleanupStage::Destroy {
                if let Ok(mut state) = self.state.lock() {
                    if state.control.lifecycle() != Lifecycle::Closed {
                        state.cleanup = CleanupProgress::Failed;
                        state.page.fault = Some(BrowserFault::NativeSurface);
                    }
                }
                self.emit();
            }
            return;
        };
        let browser_id = browser.identifier();
        let owner = self.cleanup_owner();
        if !owner.queue(browser_id, stage) {
            return;
        }
        let mut task = DeferredCleanup::new(owner.clone(), browser.clone(), browser_id, stage);
        if post_task(ThreadId::UI, Some(&mut task)) != 1 {
            owner.failed(browser_id, stage);
        }
    }

    fn fault(&self, browser: Option<&Browser>, reason: BrowserFault) {
        self.revoke();
        {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            let _ = state.control.fault(&self.identity);
            state.page.fault = Some(reason);
            state.page.loading = false;
            state.page.can_go_back = false;
            state.page.can_go_forward = false;
        }
        self.emit();
        self.schedule_cleanup(browser, CleanupStage::Close);
    }

    fn publish(&self, browser: Option<&Browser>) {
        if !self.emit() {
            self.schedule_cleanup(browser, CleanupStage::Close);
        }
    }

    fn update(&self, browser: Option<&Browser>, update: impl FnOnce(&mut BrowserState)) {
        self.update_state(browser, |state| update(&mut state.page));
    }

    fn update_state(&self, browser: Option<&Browser>, update: impl FnOnce(&mut State)) {
        if !self.accepts(browser) {
            return;
        }
        if !self.current() {
            self.fault(browser, BrowserFault::Session);
            return;
        }
        {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(poisoned) => {
                    drop(poisoned.into_inner());
                    self.fault(browser, BrowserFault::Session);
                    return;
                }
            };
            update(&mut state);
        }
        self.publish(browser);
    }
}

impl RequestLifecycle for Shared {
    fn renderer_fault(&self, browser: Option<&Browser>) {
        self.fault(browser, BrowserFault::Renderer);
    }

    fn main_document_available(&self, browser: Option<&Browser>) {
        if !self.accepts(browser) || !self.current() {
            return;
        }
        // about:blank never requests login/dark feature work. This hook is not
        // a pre-paint readiness claim and must not grant credentials itself.
        let Some(frame) = browser.and_then(ImplBrowser::main_frame) else {
            return;
        };
        let url = CefString::from(&frame.url()).to_string();
        let allowed = self
            .session
            .lock()
            .ok()
            .is_some_and(|session| session.authorize_navigation(&self.identity, &url).is_ok());
        if !allowed {
            return;
        }
        if let Some(hooks) = &self.hooks {
            let sequence = self.state.lock().map(|state| state.sequence).unwrap_or(0);
            if catch_unwind(AssertUnwindSafe(|| {
                hooks.on_main_document(&self.identity, sequence)
            }))
            .is_err()
            {
                self.fault(browser, BrowserFault::Callback);
            }
        }
    }
}

fn ui_thread() -> Result<(), BrowserError> {
    if currently_on(ThreadId::UI) == 1 {
        Ok(())
    } else {
        Err(BrowserError::WrongThread)
    }
}

fn native_bounds(bounds: ViewportBounds, scale: f64) -> Result<Rect, BrowserError> {
    // AppKit coordinates are points, not backing pixels. The caller still
    // supplies the actual scale to reject invalid toolkit geometry.
    if !scale.is_finite() || !(0.25..=8.0).contains(&scale) {
        return Err(ControlError::InvalidBounds.into());
    }
    let factor = if cfg!(target_os = "macos") {
        1.0
    } else {
        scale
    };
    let values = [bounds.x(), bounds.y(), bounds.width(), bounds.height()]
        .map(|value| (value * factor).round());
    if values
        .iter()
        .any(|value| !value.is_finite() || *value < 0.0 || *value > i32::MAX as f64)
        || values[2] < 1.0
        || values[3] < 1.0
        || values[2] * values[3] > crate::control::MAX_VIEWPORT_AREA
    {
        return Err(ControlError::InvalidBounds.into());
    }
    Ok(Rect {
        x: values[0] as i32,
        y: values[1] as i32,
        width: values[2] as i32,
        height: values[3] as i32,
    })
}

/// UI-thread owner of one private native child. Keep this and the toolkit
/// parent alive while pumping CEF until `lifecycle() == Closed`, then shut down.
/// Dropping early revokes transport and initiates closure, but cannot pump CEF.
pub struct CefBrowserHost<'a> {
    browser: BrowserSlot,
    shared: Arc<Shared>,
    _context: PrivateRequestContext,
    _parent: ParentLifetime<'a>,
    _ui_thread: PhantomData<ThreadBound<()>>,
}

impl<'a> CefBrowserHost<'a> {
    /// Native-only checkpoint accessor. Capture before revoking the attempt or
    /// closing the host, poll the returned operation while pumping CEF, then
    /// save through the owning database's native retention backend.
    pub fn capture_sign_in_cookies(
        &self,
        owner: Arc<dyn crate::cef_session_retention::CookieOwner>,
    ) -> Result<
        crate::cef_session_retention::CookieCapture,
        crate::cef_session_retention::RetentionError,
    > {
        self._context.capture_sign_in_cookies(owner)
    }

    /// Creates only a hidden, inert bootstrap. The private fixed proxy MUST have
    /// reached ProxyConfigured before this call; preparation is asynchronous.
    ///
    /// # Safety
    /// The runtime owner must initialize CEF with its reviewed platform sandbox,
    /// subprocess and message-pump setup. CEF and the native parent must outlive
    /// the child's OnBeforeClose callback (even on error/early drop). On macOS
    /// this requires the CEF NSApplication bridge on macOS 14+; Linux requires
    /// X11/XWayland. This engineering entry point proves none of those gates.
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn create_engineering_probe<W: HasWindowHandle + HasDisplayHandle + ?Sized>(
        parent: &'a W,
        context: PrivateRequestContext,
        session: Arc<Mutex<OriginBrowserSession>>,
        identity: BrowserIdentity,
        bounds: ViewportBounds,
        scale: f64,
        sink: Arc<dyn BrowserEventSink>,
        hooks: Option<Arc<dyn NativeDocumentHooks>>,
    ) -> Result<Self, BrowserError> {
        ui_thread()?;
        let parent =
            NativeChildParent::from_window(parent).map_err(|_| BrowserError::NativeSurface)?;
        let rect = native_bounds(bounds, scale)?;
        let mut info = parent
            .window_info(&rect)
            .map_err(|_| BrowserError::NativeSurface)?;
        native_surface::prepare(&mut info)?;
        Self::create_child(
            ParentLifetime::Borrowed { _parent: parent },
            info,
            context,
            session,
            identity,
            bounds,
            sink,
            hooks,
        )
    }

    #[allow(clippy::too_many_arguments)]
    unsafe fn create_child(
        parent: ParentLifetime<'a>,
        info: WindowInfo,
        mut context: PrivateRequestContext,
        session: Arc<Mutex<OriginBrowserSession>>,
        identity: BrowserIdentity,
        bounds: ViewportBounds,
        sink: Arc<dyn BrowserEventSink>,
        hooks: Option<Arc<dyn NativeDocumentHooks>>,
    ) -> Result<Self, BrowserError> {
        let permissions = context.permissions();
        let login_adapter = catch_unwind(AssertUnwindSafe(|| {
            hooks
                .as_ref()
                .map(|hooks| hooks.login_adapter())
                .unwrap_or_default()
        }))
        .map_err(|_| BrowserError::StateUnavailable)?;
        let login_configuration = catch_unwind(AssertUnwindSafe(|| {
            hooks.as_ref().and_then(|hooks| hooks.form_configuration())
        }))
        .map_err(|_| BrowserError::StateUnavailable)?;
        if login_adapter == NativeLoginAdapter::ModularForm && login_configuration.is_none() {
            return Err(BrowserError::StateUnavailable);
        }
        let login_factory_json = login_configuration.unwrap_or_else(|| "{}".into());
        if crate::cef_renderer::parse_login_configuration(&login_factory_json).is_none() {
            return Err(BrowserError::StateUnavailable);
        }
        let certificate_policy = catch_unwind(AssertUnwindSafe(|| {
            hooks
                .as_ref()
                .map(|hooks| hooks.certificate_policy())
                .unwrap_or_default()
        }))
        .map_err(|_| BrowserError::StateUnavailable)?;
        if !certificate_policy.supported() {
            return Err(BrowserError::UnsupportedCertificatePolicy);
        }
        let capabilities = context.capabilities();
        let shared = Arc::new(Shared {
            session: session.clone(),
            identity: identity.clone(),
            permissions: permissions.clone(),
            sink,
            hooks,
            login_budget: Mutex::new(LoginBudget::default()),
            feature_gate: Mutex::new(RendererFeatureGate::default()),
            login_adapter,
            certificate_policy,
            certificate_pending: Mutex::new(None),
            automation: Mutex::new(AutomationState::default()),
            capabilities,
            media_pending: Mutex::new(None),
            state: Arc::new(Mutex::new(State {
                control: BrowserControl::new(identity.clone(), bounds),
                browser_id: None,
                cleanup: CleanupProgress::Idle,
                sequence: 0,
                display: BrowserDisplayState::default(),
                page: BrowserState {
                    lifecycle: Lifecycle::Starting,
                    url: RedactedUrl::Bootstrap,
                    title: RedactedTitle::Empty,
                    loading: false,
                    can_go_back: false,
                    can_go_forward: false,
                    fault: None,
                },
            })),
        });
        let request = request_handler_with_lifecycle(
            session.clone(),
            identity.clone(),
            permissions,
            Some(shared.clone()),
        );
        let browser_slot = Arc::new(Mutex::new(None));
        let mut client = NativeClient::new(shared.clone(), request, browser_slot.clone());
        let settings = BrowserSettings {
            background_color: 0xff121212,
            local_storage: if capabilities.local_storage_enabled {
                cef::State::ENABLED
            } else {
                cef::State::DISABLED
            },
            javascript_access_clipboard: cef::State::DISABLED,
            javascript_dom_paste: cef::State::DISABLED,
            chrome_status_bubble: cef::State::DISABLED,
            chrome_zoom_bubble: cef::State::DISABLED,
            ..Default::default()
        };
        let native_context = context.for_browser_creation(&session, &identity)?;
        let mut extra_info = dictionary_value_create().ok_or(BrowserError::CreationFailed)?;
        extra_info.set_string(
            Some(&CefString::from("feature-pin")),
            Some(&CefString::from(FEATURE_PROTOCOL_PIN)),
        );
        extra_info.set_string(
            Some(&CefString::from("login-adapter")),
            Some(&CefString::from(login_adapter.wire())),
        );
        extra_info.set_string(
            Some(&CefString::from("login-factory-json")),
            Some(&CefString::from(login_factory_json.as_str())),
        );
        let Some(browser) = browser_host_create_browser_sync(
            Some(&info),
            Some(&mut client),
            Some(&CefString::from("about:blank")),
            Some(&settings),
            Some(&mut extra_info),
            Some(native_context),
        ) else {
            shared.fault(None, BrowserFault::NativeSurface);
            return Err(BrowserError::CreationFailed);
        };
        if !shared.accepts(Some(&browser)) || !shared.current() {
            shared.fault(Some(&browser), BrowserFault::NativeSurface);
            return Err(BrowserError::CreationFailed);
        }
        // Blank documents can lazily create their V8 context. Force only that
        // inert context to exist so renderer installation can acknowledge
        // before the owner admits the first website navigation.
        if let Some(frame) = browser.main_frame() {
            frame.execute_java_script(
                Some(&CefString::from("void 0;")),
                Some(&CefString::from("about:blank")),
                0,
            );
        }
        Ok(Self {
            browser: browser_slot,
            shared,
            _context: context,
            _parent: parent,
            _ui_thread: PhantomData,
        })
    }

    pub fn identity(&self) -> &BrowserIdentity {
        &self.shared.identity
    }

    /// Queue owner-authorized automation. Ok means queued, NOT completed.
    /// Completion is bounded by 15 seconds and invalidated by navigation or
    /// revocation. A timed-out page script is not forcibly interrupted.
    pub fn automation(
        &self,
        identity: &BrowserIdentity,
        action: NativeAutomationAction,
        permissions: NativeAutomationPermissions,
        completion: NativeAutomationCompletion,
    ) -> Result<(), BrowserError> {
        let browser = self.check(identity)?;
        if let Err(reason) = action.validate(permissions) {
            complete_automation(completion, NativeAutomationReply::Failed { reason });
            return Ok(());
        }
        let cleanup = matches!(action, NativeAutomationAction::Cancel { .. });
        if !cleanup {
            self.authorize_current(identity)?;
        }
        let frame = browser
            .main_frame()
            .filter(|frame| frame.is_main() == 1 && frame.is_valid() == 1)
            .ok_or(BrowserError::StateUnavailable)?;
        let url = CefString::from(&frame.url()).to_string();
        let Some(origin) = https_origin(&url) else {
            complete_automation(
                completion,
                NativeAutomationReply::Failed {
                    reason: NativeAutomationFailure::Unavailable,
                },
            );
            return Ok(());
        };
        if !cleanup && browser.is_loading() == 1 {
            complete_automation(
                completion,
                NativeAutomationReply::Failed {
                    reason: NativeAutomationFailure::Unavailable,
                },
            );
            return Ok(());
        }
        let frame_id = CefString::from(&frame.identifier()).to_string();
        let serial = NEXT_AUTOMATION_REQUEST
            .fetch_add(1, Ordering::Relaxed)
            .to_string();
        let mut message = process_message_create(Some(&CefString::from(automation_wire::REQUEST)))
            .ok_or(BrowserError::StateUnavailable)?;
        let args = message
            .argument_list()
            .ok_or(BrowserError::StateUnavailable)?;
        let (token, request) = action
            .scope()
            .map(|(token, _, request)| (Some(token.to_owned()), request.to_owned()))
            .unwrap_or_default();
        let mut state = self
            .shared
            .automation
            .lock()
            .map_err(|_| BrowserError::StateUnavailable)?;
        let reason = state.dispatch_failure(&action, &frame_id, &url);
        let reason = reason.or_else(|| {
            (!cleanup
                && (state.pending.len() >= 4
                    || (!request.is_empty()
                        && state
                            .pending
                            .values()
                            .any(|pending| pending.request == request))))
            .then_some(NativeAutomationFailure::Busy)
        });
        if let Some(reason) = reason {
            drop(state);
            complete_automation(completion, NativeAutomationReply::Failed { reason });
            return Ok(());
        }
        let generation = state.generation;
        automation_wire::encode_action(&args, &serial, &action, generation);
        if token.is_some() {
            let Some(document) = state.document.as_ref() else {
                return Err(BrowserError::StateUnavailable);
            };
            automation_wire::string(&args, 2, &document.renderer_token);
        }
        let cancelled = if cleanup {
            state.invalidating += 1;
            std::mem::take(&mut state.pending)
        } else {
            HashMap::new()
        };
        state.pending.insert(
            serial.clone(),
            PendingAutomation {
                generation,
                token,
                origin,
                request,
                frame: frame_id,
                url,
                stop: matches!(action, NativeAutomationAction::RecordStop { .. }),
                deadline: Instant::now() + Duration::from_millis(AUTOMATION_TIMEOUT_MS as u64),
                completion,
            },
        );
        drop(state);
        for (_, pending) in cancelled {
            complete_automation(
                pending.completion,
                NativeAutomationReply::Failed {
                    reason: NativeAutomationFailure::StaleDocument,
                },
            );
        }
        if cleanup {
            self.shared
                .automation
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .invalidating -= 1;
        }
        let mut timeout = AutomationTimeout::new(Arc::downgrade(&self.shared), serial.clone());
        if post_delayed_task(ThreadId::UI, Some(&mut timeout), AUTOMATION_TIMEOUT_MS) != 1 {
            self.shared.expire_automation(&serial);
            return Ok(());
        }
        // A completion above may reenter the owner and revoke the attempt.
        if !self.shared.current() || !self.shared.accepts(Some(&browser)) {
            self.shared.clear_automation();
            return Ok(());
        }
        // A cancelled completion can reenter navigation without revoking the
        // session. Never send the now-stale operation to its former frame.
        if !self.shared.automation.lock().is_ok_and(|state| {
            state.available()
                && state.generation == generation
                && state.pending.contains_key(&serial)
        }) {
            return Ok(());
        }
        frame.send_process_message(ProcessId::RENDERER, Some(&mut message));
        Ok(())
    }

    /// True only after the pinned renderer factory executes in the inert
    /// bootstrap. This is a prerequisite, not a Ready/containment/paint proof.
    pub fn features_ready(&self, identity: &BrowserIdentity) -> Result<bool, BrowserError> {
        self.check(identity)?;
        if !self.shared.login_adapter.supported() {
            return Err(BrowserError::UnsupportedLoginAdapter);
        }
        self.shared
            .feature_gate
            .lock()
            .map(|gate| gate.ready())
            .map_err(|_| BrowserError::StateUnavailable)
    }

    pub fn auto_login_supported(&self, identity: &BrowserIdentity) -> Result<bool, BrowserError> {
        self.check(identity)?;
        Ok(self.shared.login_adapter.supported()
            && self.shared.login_adapter != NativeLoginAdapter::Manual)
    }

    /// UI-thread native owner only. Recheck native prompt ownership/consent
    /// before calling. A challenge is consumed once, bound to this attempt's
    /// captured origin/certificate/error, and invalidated on navigation/close.
    pub fn resolve_certificate_challenge(
        &self,
        identity: &BrowserIdentity,
        request_id: u64,
        decision: NativeCertificateDecision,
    ) -> Result<(), BrowserError> {
        self.check(identity)?;
        let pending = {
            let mut slot = self
                .shared
                .certificate_pending
                .lock()
                .map_err(|_| BrowserError::StateUnavailable)?;
            if slot
                .as_ref()
                .is_none_or(|pending| pending.request_id != request_id)
            {
                return Err(BrowserError::CertificateChallengeUnavailable);
            }
            slot.take()
                .ok_or(BrowserError::CertificateChallengeUnavailable)?
        };
        let valid = self.shared.certificate_policy
            == NativeCertificatePolicy::PromptInvalidCertificate
            && pending.expires_at > Instant::now()
            && self.shared.session.lock().is_ok_and(|session| {
                navigation_allowed(
                    &session,
                    identity,
                    &self.shared.permissions,
                    &pending.origin,
                    true,
                )
            });
        if valid && decision == NativeCertificateDecision::AllowForAttempt {
            pending.callback.continue_request();
        } else {
            pending.callback.cancel_request();
        }
        if valid {
            Ok(())
        } else {
            Err(BrowserError::CertificateChallengeUnavailable)
        }
    }

    pub fn lifecycle(&self) -> Lifecycle {
        self.shared
            .state
            .lock()
            .map(|state| state.control.lifecycle())
            .unwrap_or(Lifecycle::Faulted)
    }

    fn check(&self, identity: &BrowserIdentity) -> Result<Browser, BrowserError> {
        ui_thread()?;
        if identity != self.identity() {
            return Err(ControlError::StaleIdentity.into());
        }
        let browser = self
            .browser
            .lock()
            .map_err(|_| BrowserError::StateUnavailable)?
            .clone();
        if !self.shared.current() {
            self.shared.fault(browser.as_ref(), BrowserFault::Session);
            return Err(BrowserError::SessionUnavailable);
        }
        if !self.shared.accepts(browser.as_ref()) {
            if self.shared.state.is_poisoned() {
                self.shared.fault(browser.as_ref(), BrowserFault::Session);
            }
            return Err(BrowserError::StateUnavailable);
        }
        browser.ok_or(BrowserError::StateUnavailable)
    }

    fn authorize(&self, identity: &BrowserIdentity, url: &str) -> Result<Browser, BrowserError> {
        let browser = self.check(identity)?;
        if !self.shared.login_adapter.supported() {
            return Err(BrowserError::UnsupportedLoginAdapter);
        }
        if !self
            .shared
            .feature_gate
            .lock()
            .is_ok_and(|gate| gate.ready())
        {
            return Err(BrowserError::StateUnavailable);
        }
        let session = self
            .shared
            .session
            .lock()
            .map_err(|_| BrowserError::SessionUnavailable)?;
        let state = self
            .shared
            .state
            .lock()
            .map_err(|_| BrowserError::StateUnavailable)?;
        state
            .control
            .authorize_navigation(identity, &session, url)?;
        if !navigation_allowed(&session, identity, &self.shared.permissions, url, true) {
            return Err(ControlError::NavigationUnavailable.into());
        }
        Ok(browser)
    }

    pub fn navigate(&self, identity: &BrowserIdentity, url: &str) -> Result<(), BrowserError> {
        if url.len() > 16_384 {
            return Err(ControlError::NavigationUnavailable.into());
        }
        let browser = self.authorize(identity, url)?;
        let frame = browser.main_frame().ok_or(BrowserError::StateUnavailable)?;
        self.shared
            .navigation_status(NativeNavigationStatus::Requested);
        // Observers cannot keep a revoked attempt alive, including when a
        // callback panics or the owner locks during the notification.
        self.check(identity)?;
        frame.load_url(Some(&CefString::from(url)));
        Ok(())
    }

    fn authorize_current(&self, identity: &BrowserIdentity) -> Result<Browser, BrowserError> {
        let browser = self.check(identity)?;
        let frame = browser.main_frame().ok_or(BrowserError::StateUnavailable)?;
        self.authorize(identity, &CefString::from(&frame.url()).to_string())
    }

    pub fn back(&self, identity: &BrowserIdentity) -> Result<(), BrowserError> {
        let browser = self.authorize_current(identity)?;
        // The attempted history destination is admitted again by OnBeforeBrowse.
        if browser.can_go_back() == 1 {
            browser.go_back();
        }
        Ok(())
    }

    pub fn forward(&self, identity: &BrowserIdentity) -> Result<(), BrowserError> {
        let browser = self.authorize_current(identity)?;
        if browser.can_go_forward() == 1 {
            browser.go_forward();
        }
        Ok(())
    }

    pub fn reload(&self, identity: &BrowserIdentity) -> Result<(), BrowserError> {
        self.authorize_current(identity)?.reload();
        Ok(())
    }

    pub fn stop(&self, identity: &BrowserIdentity) -> Result<(), BrowserError> {
        self.check(identity)?.stop_load();
        Ok(())
    }

    pub fn zoom(&self, identity: &BrowserIdentity, percent: f64) -> Result<(), BrowserError> {
        let level = crate::ipc::zoom_level_for_percent(percent)
            .map_err(|_| BrowserError::StateUnavailable)?;
        let browser = self.check(identity)?;
        if self.lifecycle() != Lifecycle::Attached {
            return Err(ControlError::InvalidTransition.into());
        }
        self.native_host(&browser)?.set_zoom_level(level);
        Ok(())
    }

    pub fn find(
        &self,
        identity: &BrowserIdentity,
        text: &str,
        forward: bool,
        match_case: bool,
        find_next: bool,
    ) -> Result<(), BrowserError> {
        crate::ipc::validate_find_text(text).map_err(|_| BrowserError::StateUnavailable)?;
        let browser = self.check(identity)?;
        if self.lifecycle() != Lifecycle::Attached {
            return Err(ControlError::InvalidTransition.into());
        }
        self.native_host(&browser)?.find(
            Some(&CefString::from(text)),
            i32::from(forward),
            i32::from(match_case),
            i32::from(find_next),
        );
        Ok(())
    }

    pub fn stop_find(
        &self,
        identity: &BrowserIdentity,
        clear_selection: bool,
    ) -> Result<(), BrowserError> {
        let browser = self.check(identity)?;
        if self.lifecycle() != Lifecycle::Attached {
            return Err(ControlError::InvalidTransition.into());
        }
        self.native_host(&browser)?
            .stop_finding(i32::from(clear_selection));
        Ok(())
    }

    fn visibility(&self, identity: &BrowserIdentity, visible: bool) -> Result<(), BrowserError> {
        let browser = self.check(identity)?;
        {
            let mut state = self
                .shared
                .state
                .lock()
                .map_err(|_| BrowserError::StateUnavailable)?;
            if visible {
                state.control.show(identity)?;
            } else {
                state.control.hide(identity)?;
            }
        }
        let host = self.native_host(&browser)?;
        if !visible {
            host.set_focus(0);
        }
        if native_surface::visible(host.window_handle(), visible).is_err() {
            self.shared
                .fault(Some(&browser), BrowserFault::NativeSurface);
            return Err(BrowserError::NativeSurface);
        }
        if !self.shared.emit() {
            self.shared
                .schedule_cleanup(Some(&browser), CleanupStage::Close);
            return Err(BrowserError::StateUnavailable);
        }
        Ok(())
    }

    pub fn show(&self, identity: &BrowserIdentity) -> Result<(), BrowserError> {
        self.visibility(identity, true)
    }
    pub fn hide(&self, identity: &BrowserIdentity) -> Result<(), BrowserError> {
        self.visibility(identity, false)
    }

    pub fn resize(
        &self,
        identity: &BrowserIdentity,
        bounds: ViewportBounds,
        scale: f64,
    ) -> Result<(), BrowserError> {
        let browser = self.check(identity)?;
        let rect = native_bounds(bounds, scale)?;
        {
            let mut state = self
                .shared
                .state
                .lock()
                .map_err(|_| BrowserError::StateUnavailable)?;
            state.control.resize(identity, bounds)?;
        }
        let host = self.native_host(&browser)?;
        host.notify_move_or_resize_started();
        if native_surface::resize(host.window_handle(), &rect).is_err() {
            self.shared
                .fault(Some(&browser), BrowserFault::NativeSurface);
            return Err(BrowserError::NativeSurface);
        }
        Ok(())
    }

    pub fn focus(&self, identity: &BrowserIdentity) -> Result<(), BrowserError> {
        let browser = self.check(identity)?;
        if self.lifecycle() != Lifecycle::Attached {
            return Err(ControlError::InvalidTransition.into());
        }
        self.native_host(&browser)?.set_focus(1);
        Ok(())
    }

    fn native_host(&self, browser: &Browser) -> Result<BrowserHost, BrowserError> {
        browser.host().ok_or_else(|| {
            self.shared
                .fault(Some(browser), BrowserFault::NativeSurface);
            BrowserError::NativeSurface
        })
    }

    /// Synchronously revoke the relay before invoking any asynchronous CEF close
    /// behavior. Closed is reported only by the native OnBeforeClose callback.
    pub fn close(&self, identity: &BrowserIdentity) -> Result<(), BrowserError> {
        ui_thread()?;
        if identity != self.identity() {
            return Err(ControlError::StaleIdentity.into());
        }
        self.shared.revoke();
        let close = {
            let mut state = self
                .shared
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            state.control.begin_close(identity)?
        };
        if close {
            let browser = self
                .browser
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clone();
            self.shared
                .schedule_cleanup(browser.as_ref(), CleanupStage::Close);
            self.shared.publish(browser.as_ref());
        }
        Ok(())
    }
}

impl CefBrowserHost<'static> {
    /// Registry-friendly form retaining the trusted toolkit window owner. The
    /// host remains !Send/!Sync. Explicit toolkit window destruction must still
    /// wait for OnBeforeClose; an Arc cannot prevent such destruction.
    ///
    /// # Safety
    /// Same initialized runtime, parent and shutdown requirements as
    /// [`Self::create_engineering_probe`]. This grants no website readiness.
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn create_owned_engineering_probe<
        W: HasWindowHandle + HasDisplayHandle + 'static,
    >(
        parent: Arc<W>,
        context: PrivateRequestContext,
        session: Arc<Mutex<OriginBrowserSession>>,
        identity: BrowserIdentity,
        bounds: ViewportBounds,
        scale: f64,
        sink: Arc<dyn BrowserEventSink>,
        hooks: Option<Arc<dyn NativeDocumentHooks>>,
    ) -> Result<Self, BrowserError> {
        ui_thread()?;
        let rect = native_bounds(bounds, scale)?;
        let mut info = {
            let borrowed = NativeChildParent::from_window(parent.as_ref())
                .map_err(|_| BrowserError::NativeSurface)?;
            borrowed
                .window_info(&rect)
                .map_err(|_| BrowserError::NativeSurface)?
        };
        native_surface::prepare(&mut info)?;
        Self::create_child(
            ParentLifetime::Owned { _parent: parent },
            info,
            context,
            session,
            identity,
            bounds,
            sink,
            hooks,
        )
    }
}

impl Drop for CefBrowserHost<'_> {
    fn drop(&mut self) {
        // !Send/!Sync, initialized runtime required by the creation contract.
        let _ = self.close(self.identity());
    }
}

wrap_task! {
    struct AutomationTimeout { shared: std::sync::Weak<Shared>, serial: String }
    impl Task {
        fn execute(&self) { if let Some(shared) = self.shared.upgrade() { shared.expire_automation(&self.serial); } }
    }
}

wrap_task! {
    struct MediaPoll { shared: std::sync::Weak<Shared>, request_id: u64 }
    impl Task {
        fn execute(&self) {
            if let Some(shared) = self.shared.upgrade() { shared.poll_media(self.request_id); }
        }
    }
}

wrap_task! {
    struct CertificateTimeout { shared: std::sync::Weak<Shared>, request_id: u64 }
    impl Task {
        fn execute(&self) {
            if let Some(shared) = self.shared.upgrade() {shared.cancel_certificate(Some(self.request_id));}
        }
    }
}

// Keep the existing route/auth/resource handler authoritative. Every overridden
// callback there is delegated unchanged; this wrapper only adds native trust.
wrap_request_handler! {
    struct NativeRequests { shared: Arc<Shared>, inner: RequestHandler }
    impl RequestHandler {
        fn on_certificate_error(&self, browser: Option<&mut Browser>, cert_error: Errorcode,
            request_url: Option<&CefString>, ssl_info: Option<&mut Sslinfo>, callback: Option<&mut Callback>) -> i32 {
            self.shared.certificate_error(browser.as_deref(), cert_error, request_url, ssl_info.as_deref(), callback.as_deref())
        }
        fn on_before_browse(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>,
            request: Option<&mut Request>, user_gesture: i32, is_redirect: i32) -> i32 {
            // Includes same-origin subframe reloads: an old document's consent
            // must never be applied to a replacement using the same frame ID.
            self.shared.deny_media_on_ui(None);
            let main_frame = frame.as_ref().is_some_and(|frame| frame.is_main() == 1);
            if main_frame {
                self.shared.automation.lock().unwrap_or_else(|error| error.into_inner()).navigating = true;
                self.shared.cancel_certificate(None); self.shared.clear_automation();
            }
            let decision = self.inner.on_before_browse(browser, frame, request, user_gesture, is_redirect);
            if main_frame && decision != 0 {
                self.shared.automation.lock().unwrap_or_else(|error| error.into_inner()).navigating = false;
            }
            self.shared.navigation_status(NativeNavigationStatus::BeforeBrowse { allowed: decision == 0, main_frame });
            if self.shared.current() { decision } else { 1 }
        }
        fn on_open_urlfrom_tab(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>,
            target_url: Option<&CefString>, target_disposition: WindowOpenDisposition, user_gesture: i32) -> i32 {
            let origin = frame.as_ref().map(|frame| CefString::from(&frame.url()));
            self.shared.capability_denied(browser.as_deref(), origin.as_ref(), target_url, NativeCapabilityKind::Popup, Some(user_gesture == 1));
            self.inner.on_open_urlfrom_tab(browser, frame, target_url, target_disposition, user_gesture)
        }
        fn resource_request_handler(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>,
            request: Option<&mut Request>, is_navigation: i32, is_download: i32, request_initiator: Option<&CefString>,
            disable_default_handling: Option<&mut i32>) -> Option<ResourceRequestHandler> {
            let mut disable_default_handling = disable_default_handling;
            let resource_type = request.as_ref().map(|request| cef_dll_sys::cef_resource_type_t::from(request.resource_type()) as i32).unwrap_or(-1);
            let browser_present = browser.is_some();
            let frame_present = frame.is_some();
            let initiator_empty = request_initiator.and_then(CefString::as_slice).is_none_or(|value| value.is_empty());
            let initiator_opaque = request_initiator.and_then(CefString::as_slice).is_some_and(|value| value == [110, 117, 108, 108]);
            let handler = self.inner.resource_request_handler(browser, frame, request, is_navigation, is_download, request_initiator, disable_default_handling.as_deref_mut());
            self.shared.navigation_status(NativeNavigationStatus::ResourceAdmission {
                resource_type, is_navigation, browser_present, frame_present, initiator_empty, initiator_opaque,
                default_disabled: disable_default_handling.as_deref().is_none_or(|value| *value != 0),
            });
            handler
        }
        fn auth_credentials(&self, browser: Option<&mut Browser>, origin_url: Option<&CefString>, is_proxy: i32,
            host: Option<&CefString>, port: i32, realm: Option<&CefString>, scheme: Option<&CefString>, callback: Option<&mut AuthCallback>) -> i32 {
            self.shared.navigation_status(NativeNavigationStatus::AuthChallenge { proxy: is_proxy == 1, callback_present: callback.is_some() });
            let decision = self.inner.auth_credentials(browser, origin_url, is_proxy, host, port, realm, scheme, callback);
            self.shared.navigation_status(NativeNavigationStatus::AuthCompleted { handled: decision == 1 });
            decision
        }
        fn on_select_client_certificate(&self, browser: Option<&mut Browser>, is_proxy: i32,
            host: Option<&CefString>, port: i32, certificates: Option<&[Option<X509Certificate>]>, callback: Option<&mut SelectClientCertificateCallback>) -> i32 {
            self.inner.on_select_client_certificate(browser, is_proxy, host, port, certificates, callback)
        }
        fn on_render_process_terminated(&self, browser: Option<&mut Browser>, status: TerminationStatus,
            error_code: i32, error_string: Option<&CefString>) {
            self.inner.on_render_process_terminated(browser, status, error_code, error_string);
        }
        fn on_render_process_unresponsive(&self, browser: Option<&mut Browser>, callback: Option<&mut UnresponsiveProcessCallback>) -> i32 {
            self.inner.on_render_process_unresponsive(browser, callback)
        }
        fn on_document_available_in_main_frame(&self, browser: Option<&mut Browser>) {
            self.inner.on_document_available_in_main_frame(browser);
        }
    }
}

wrap_client! {
    struct NativeClient { shared: Arc<Shared>, request: RequestHandler, browser: BrowserSlot }
    impl Client {
        fn request_handler(&self) -> Option<RequestHandler> { Some(NativeRequests::new(self.shared.clone(), self.request.clone())) }
        fn life_span_handler(&self) -> Option<LifeSpanHandler> { Some(NativeLife::new(self.shared.clone(), self.browser.clone())) }
        fn display_handler(&self) -> Option<DisplayHandler> { Some(NativeDisplay::new(self.shared.clone())) }
        fn load_handler(&self) -> Option<LoadHandler> { Some(NativeLoad::new(self.shared.clone())) }
        fn focus_handler(&self) -> Option<FocusHandler> { Some(NativeFocus::new(self.shared.clone())) }
        fn dialog_handler(&self) -> Option<DialogHandler> { Some(DenyFileDialog::new()) }
        fn jsdialog_handler(&self) -> Option<JsdialogHandler> { Some(DenyJsDialog::new()) }
        fn permission_handler(&self) -> Option<PermissionHandler> { Some(NativePermissions::new(self.shared.clone())) }
        fn download_handler(&self) -> Option<DownloadHandler> { Some(NativeDownloads::new(self.shared.clone())) }
        fn drag_handler(&self) -> Option<DragHandler> { Some(DenyDrag::new()) }
        fn context_menu_handler(&self) -> Option<ContextMenuHandler> { Some(DenyContextMenu::new()) }
        fn command_handler(&self) -> Option<CommandHandler> { Some(DenyCommands::new()) }
        fn on_process_message_received(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>,
            source_process: ProcessId, message: Option<&mut ProcessMessage>) -> i32 {
            if let (Some(browser), Some(frame), Some(message)) = (browser.as_deref(), frame.as_deref(), message.as_deref()) {
                let owner = self.browser.lock().ok().and_then(|slot| slot.clone());
                if owner.is_some_and(|owner| owner.is_same(Some(&mut browser.clone())) == 1)
                    && self.shared.automation_message(browser, frame, source_process, message) == 1 { return 1; }
            }
            if self.shared.feature_message(browser.as_deref(), frame.as_deref(), source_process, message.as_deref()) == 1 { return 1; }
            self.shared.login_message(browser.as_deref(), frame.as_deref(), source_process, message.as_deref())
        }
    }
}

wrap_life_span_handler! {
    struct NativeLife { shared: Arc<Shared>, browser: BrowserSlot }
    impl LifeSpanHandler {
        fn on_before_popup(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>,
            _popup_id: i32, target_url: Option<&CefString>, _target_frame_name: Option<&CefString>,
            _target_disposition: WindowOpenDisposition, user_gesture: i32, _popup_features: Option<&PopupFeatures>,
            _window_info: Option<&mut WindowInfo>, _client: Option<&mut Option<Client>>,
            _settings: Option<&mut BrowserSettings>, _extra_info: Option<&mut Option<DictionaryValue>>,
            _no_javascript_access: Option<&mut i32>) -> i32 {
                let origin = frame.as_ref().map(|frame| CefString::from(&frame.url()));
                self.shared.capability_denied(browser.as_deref(), origin.as_ref(), target_url, NativeCapabilityKind::Popup, Some(user_gesture == 1));
                1
            }

        fn on_after_created(&self, browser: Option<&mut Browser>) {
            let Some(browser) = browser else { self.shared.fault(None, BrowserFault::NativeSurface); return; };
            let attached = {
                let mut state = self.shared.state.lock().unwrap_or_else(|error| error.into_inner());
                if state.browser_id.is_some() { false } else {
                    state.browser_id = Some(browser.identifier());
                    state.control.attached(&self.shared.identity).and_then(|_| state.control.hide(&self.shared.identity)).is_ok()
                }
            };
            if !attached || !self.shared.current() {
                self.shared.fault(Some(browser), BrowserFault::Session); return;
            }
            *self.browser.lock().unwrap_or_else(|error| error.into_inner()) = Some(browser.clone());
            let hidden = browser.host().is_some_and(|host| {
                host.set_focus(0);
                native_surface::visible(host.window_handle(), false).is_ok()
            });
            if !hidden { self.shared.fault(Some(browser), BrowserFault::NativeSurface); return; }
            self.shared.publish(Some(browser));
        }

        fn do_close(&self, browser: Option<&mut Browser>) -> i32 {
            self.shared.revoke();
            self.shared.deny_media_on_ui(None);
            {
                let mut state = self.shared.state.lock().unwrap_or_else(|error| error.into_inner());
                let _ = state.control.begin_close(&self.shared.identity);
            }
            // Pinned CEF 682c378 alloy_browser_host_impl.cc: CloseBrowser may
            // call DoClose synchronously; CloseContents resumes state handling
            // after it returns. WM_NCDESTROY reenters WindowDestroyed/close.
            // Queue a SECOND UI turn, never destroy inside this callback or
            // return false (which can close the application's top-level parent).
            self.shared.schedule_cleanup(browser.as_deref(), CleanupStage::Destroy);
            1
        }

        fn on_before_close(&self, _browser: Option<&mut Browser>) {
            self.shared.revoke();
            self.shared.deny_media_on_ui(None);
            {
                let mut state = self.shared.state.lock().unwrap_or_else(|error| error.into_inner());
                let _ = state.control.begin_close(&self.shared.identity);
                let _ = state.control.closed(&self.shared.identity);
                state.cleanup = CleanupProgress::Complete;
                state.page.loading = false;
                state.page.can_go_back = false;
                state.page.can_go_forward = false;
            }
            // Break client/browser ownership while CEF still considers the
            // callback valid. Registry methods now find no native reference.
            let browser = self.browser.lock().unwrap_or_else(|error| error.into_inner()).take();
            drop(browser);
            self.shared.emit();
        }
    }
}

wrap_display_handler! {
    struct NativeDisplay { shared: Arc<Shared> }
    impl DisplayHandler {
        fn on_address_change(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>, url: Option<&CefString>) {
            // Same-document URL transitions are fences too, in every frame.
            self.shared.deny_media_on_ui(None);
            let (Some(browser), Some(frame), Some(url)) = (browser, frame, url) else { return; };
            let Some(main) = browser.main_frame() else { return; };
            if frame.is_valid() != 1 || frame.is_main() != 1
                || CefString::from(&frame.identifier()).to_string() != CefString::from(&main.identifier()).to_string() { return; }
            if !url.as_slice().is_some_and(|value| value.len() <= 16_384) {
                self.shared.update_state(Some(browser), |state| {
                    state.page.url = RedactedUrl::Unavailable;
                    state.page.title = RedactedTitle::Empty;
                    state.display = BrowserDisplayState::default();
                });
                return;
            }
            let native_url = CefString::from(&frame.url()).to_string();
            if native_url != url.to_string() { return; }
            let changed = self.shared.automation.lock().is_ok_and(|state|
                state.document.as_ref().is_some_and(|doc| doc.url != native_url)
                || state.pending.values().any(|pending| pending.url != native_url));
            if changed { self.shared.clear_automation(); }
            self.shared.update_state(Some(browser), |state| {
                state.page.url = redact_url(&native_url);
                state.page.title = RedactedTitle::Empty;
                state.display.url = display_url(&native_url);
                state.display.title.clear();
            });
        }
        fn on_title_change(&self, browser: Option<&mut Browser>, title: Option<&CefString>) {
            let Some(browser) = browser else { return; };
            let Some(frame) = browser.main_frame().filter(|frame| frame.is_valid() == 1 && frame.is_main() == 1) else { return; };
            let native_url = display_url(&CefString::from(&frame.url()).to_string());
            // Bound allocation before copying arbitrary page strings.
            let bounded = title.filter(|title| title.as_slice().is_some_and(|s| s.len() <= 512))
                .map(ToString::to_string).filter(|value| display_text_safe(value, 512)).unwrap_or_default();
            self.shared.update_state(Some(browser), |state| {
                if native_url.is_empty() || native_url != state.display.url { return; }
                state.page.title = if bounded.is_empty() { RedactedTitle::Empty } else { RedactedTitle::Present };
                state.display.title = bounded;
            });
        }
        fn on_console_message(&self, _browser: Option<&mut Browser>, _level: LogSeverity,
            _message: Option<&CefString>, _source: Option<&CefString>, _line: i32) -> i32 { 1 }
        fn on_tooltip(&self, _browser: Option<&mut Browser>, _text: Option<&mut CefString>) -> i32 { 1 }
        fn on_auto_resize(&self, _browser: Option<&mut Browser>, _new_size: Option<&Size>) -> i32 { 1 }
        fn on_contents_bounds_change(&self, _browser: Option<&mut Browser>, _new_bounds: Option<&Rect>) -> i32 { 1 }
        fn on_fullscreen_mode_change(&self, browser: Option<&mut Browser>, fullscreen: i32) {
            if fullscreen != 0 { if let Some(host) = browser.and_then(|browser| browser.host()) { host.exit_fullscreen(0); } }
        }
    }
}

wrap_load_handler! {
    struct NativeLoad { shared: Arc<Shared> }
    impl LoadHandler {
        fn on_loading_state_change(&self, browser: Option<&mut Browser>, is_loading: i32, can_go_back: i32, can_go_forward: i32) {
            if self.shared.accepts(browser.as_deref()) && self.shared.current() {
                self.shared.automation.lock().unwrap_or_else(|error| error.into_inner()).navigating = is_loading == 1;
            }
            self.shared.update(browser.as_deref(), |page| {
                page.loading = is_loading == 1;
                page.can_go_back = can_go_back == 1;
                page.can_go_forward = can_go_forward == 1;
            });
        }
        fn on_load_error(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>,
            error_code: Errorcode, _error_text: Option<&CefString>, _failed_url: Option<&CefString>) {
            let main_frame = frame.as_ref().is_some_and(|frame| frame.is_main() == 1);
            self.shared.navigation_status(NativeNavigationStatus::LoadError { code: cef_dll_sys::cef_errorcode_t::from(error_code) as i32, main_frame });
            // Stop and superseded navigations report ABORTED, not host failure.
            if error_code != Errorcode::ABORTED && main_frame
                && self.shared.accepts(browser.as_deref()) {
                self.shared.fault(browser.as_deref(), BrowserFault::Load);
            }
        }
    }
}

wrap_focus_handler! {
    struct NativeFocus { shared: Arc<Shared> }
    impl FocusHandler {
        fn on_set_focus(&self, browser: Option<&mut Browser>, _source: FocusSource) -> i32 {
            let visible = self.shared.state.lock().is_ok_and(|state| state.control.lifecycle() == Lifecycle::Attached);
            i32::from(!visible || !self.shared.current() || !self.shared.accepts(browser.as_deref()))
        }
    }
}

wrap_dialog_handler! {
    struct DenyFileDialog;
    impl DialogHandler {
        fn on_file_dialog(&self, _browser: Option<&mut Browser>, _mode: FileDialogMode,
            _title: Option<&CefString>, _default_file_path: Option<&CefString>,
            _accept_filters: Option<&mut CefStringList>, _accept_extensions: Option<&mut CefStringList>,
            _accept_descriptions: Option<&mut CefStringList>, callback: Option<&mut FileDialogCallback>) -> i32 {
            if let Some(callback) = callback { callback.cancel(); }
            1
        }
    }
}

wrap_jsdialog_handler! {
    struct DenyJsDialog;
    impl JsdialogHandler {
        fn on_jsdialog(&self, _browser: Option<&mut Browser>, _origin_url: Option<&CefString>,
            _dialog_type: JsdialogType, _message_text: Option<&CefString>, _default_prompt_text: Option<&CefString>,
            callback: Option<&mut JsdialogCallback>, suppress_message: Option<&mut i32>) -> i32 {
            if let Some(callback) = callback { callback.cont(0, None); 1 }
            else { if let Some(suppress) = suppress_message { *suppress = 1; } 0 }
        }
        fn on_before_unload_dialog(&self, _browser: Option<&mut Browser>, _message_text: Option<&CefString>,
            _is_reload: i32, callback: Option<&mut JsdialogCallback>) -> i32 {
            // A denied prompt must never prevent the owner's forced close.
            if let Some(callback) = callback { callback.cont(1, None); }
            1
        }
    }
}

wrap_permission_handler! {
    struct NativePermissions { shared: Arc<Shared> }
    impl PermissionHandler {
        fn on_request_media_access_permission(&self, browser: Option<&mut Browser>, frame: Option<&mut Frame>,
            requesting_origin: Option<&CefString>, requested_permissions: u32, callback: Option<&mut MediaAccessCallback>) -> i32 {
            if self.shared.request_media(browser.as_deref(), frame.as_deref(), requesting_origin, requested_permissions, callback.as_deref()) {
                return 1;
            }
            self.shared.capability_denied(browser.as_deref(), requesting_origin, None, NativeCapabilityKind::Media {requested: requested_permissions}, None);
            DenyPermissions::new().on_request_media_access_permission(browser, frame, requesting_origin, requested_permissions, callback)
        }
        fn on_show_permission_prompt(&self, browser: Option<&mut Browser>, prompt_id: u64,
            requesting_origin: Option<&CefString>, requested_permissions: u32, callback: Option<&mut PermissionPromptCallback>) -> i32 {
            self.shared.capability_denied(browser.as_deref(), requesting_origin, None, NativeCapabilityKind::Permission {requested: requested_permissions}, None);
            DenyPermissions::new().on_show_permission_prompt(browser, prompt_id, requesting_origin, requested_permissions, callback)
        }
    }
}

wrap_download_handler! {
    struct NativeDownloads { shared: Arc<Shared> }
    impl DownloadHandler {
        fn can_download(&self, browser: Option<&mut Browser>, url: Option<&CefString>, request_method: Option<&CefString>) -> i32 {
            let origin = browser.as_ref().and_then(|browser| browser.main_frame()).map(|frame| CefString::from(&frame.url()));
            self.shared.capability_denied(browser.as_deref(), origin.as_ref(), url, NativeCapabilityKind::Download, None);
            DenyDownloads::new().can_download(browser, url, request_method)
        }
        fn on_before_download(&self, browser: Option<&mut Browser>, download_item: Option<&mut DownloadItem>,
            suggested_name: Option<&CefString>, callback: Option<&mut BeforeDownloadCallback>) -> i32 {
            DenyDownloads::new().on_before_download(browser, download_item, suggested_name, callback)
        }
        fn on_download_updated(&self, browser: Option<&mut Browser>, download_item: Option<&mut DownloadItem>, callback: Option<&mut DownloadItemCallback>) {
            DenyDownloads::new().on_download_updated(browser, download_item, callback);
        }
    }
}

wrap_permission_handler! {
    struct DenyPermissions;
    impl PermissionHandler {
        fn on_request_media_access_permission(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            _requesting_origin: Option<&CefString>, _requested_permissions: u32, callback: Option<&mut MediaAccessCallback>) -> i32 {
            if let Some(callback) = callback { callback.cont(0); }
            1
        }
        fn on_show_permission_prompt(&self, _browser: Option<&mut Browser>, _prompt_id: u64,
            _requesting_origin: Option<&CefString>, _requested_permissions: u32, callback: Option<&mut PermissionPromptCallback>) -> i32 {
            if let Some(callback) = callback { callback.cont(PermissionRequestResult::DENY); }
            1
        }
    }
}

wrap_download_handler! {
    struct DenyDownloads;
    impl DownloadHandler {
        fn can_download(&self, _browser: Option<&mut Browser>, _url: Option<&CefString>, _request_method: Option<&CefString>) -> i32 { 0 }
        fn on_before_download(&self, _browser: Option<&mut Browser>, _download_item: Option<&mut DownloadItem>,
            _suggested_name: Option<&CefString>, _callback: Option<&mut BeforeDownloadCallback>) -> i32 {
            // Alloy cancels when the client handles without continuing.
            1
        }
        fn on_download_updated(&self, _browser: Option<&mut Browser>, _download_item: Option<&mut DownloadItem>,
            callback: Option<&mut DownloadItemCallback>) { if let Some(callback) = callback { callback.cancel(); } }
    }
}

wrap_drag_handler! {
    struct DenyDrag;
    impl DragHandler {
        fn on_drag_enter(&self, _browser: Option<&mut Browser>, _drag_data: Option<&mut DragData>, _mask: DragOperationsMask) -> i32 { 1 }
    }
}

wrap_command_handler! {
    struct DenyCommands;
    impl CommandHandler {
        fn on_chrome_command(&self, _browser: Option<&mut Browser>, _command_id: i32, _disposition: WindowOpenDisposition) -> i32 { 1 }
    }
}

wrap_context_menu_handler! {
    struct DenyContextMenu;
    impl ContextMenuHandler {
        fn on_before_context_menu(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            _params: Option<&mut ContextMenuParams>, model: Option<&mut MenuModel>) { if let Some(model) = model { model.clear(); } }
        fn run_context_menu(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            _params: Option<&mut ContextMenuParams>, _model: Option<&mut MenuModel>, callback: Option<&mut RunContextMenuCallback>) -> i32 {
            if let Some(callback) = callback { callback.cancel(); } 1
        }
        fn on_context_menu_command(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            _params: Option<&mut ContextMenuParams>, _command_id: i32, _event_flags: EventFlags) -> i32 { 1 }
        fn run_quick_menu(&self, _browser: Option<&mut Browser>, _frame: Option<&mut Frame>,
            _location: Option<&Point>, _size: Option<&Size>, _edit_state_flags: QuickMenuEditStateFlags,
            callback: Option<&mut RunQuickMenuCallback>) -> i32 { if let Some(callback) = callback { callback.cancel(); } 1 }
    }
}

#[cfg(target_os = "windows")]
mod native_surface {
    use super::*;
    use std::ffi::c_void;
    #[link(name = "user32")]
    extern "system" {
        fn IsWindow(window: *mut c_void) -> i32;
        fn ShowWindow(window: *mut c_void, command: i32) -> i32;
        fn EnableWindow(window: *mut c_void, enable: i32) -> i32;
        fn DestroyWindow(window: *mut c_void) -> i32;
        fn SetWindowPos(
            window: *mut c_void,
            after: *mut c_void,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
    }
    pub fn prepare(info: &mut WindowInfo) -> Result<(), BrowserError> {
        info.style &= !0x10000000; // WS_VISIBLE: hidden before first native paint.
        info.ex_style |= 0x08000000; // WS_EX_NOACTIVATE during CEF child creation.
        Ok(())
    }
    pub fn visible(
        window: cef::sys::cef_window_handle_t,
        visible: bool,
    ) -> Result<(), BrowserError> {
        let window = window.0.cast();
        // CEF owns this HWND on this same UI thread; parent lifetime is borrowed.
        unsafe {
            if IsWindow(window) == 0 {
                return Err(BrowserError::NativeSurface);
            }
            // SW_SHOWNOACTIVATE / SW_HIDE. ShowWindow returns previous state.
            EnableWindow(window, i32::from(visible));
            ShowWindow(window, if visible { 4 } else { 0 });
        }
        Ok(())
    }
    pub fn resize(window: cef::sys::cef_window_handle_t, rect: &Rect) -> Result<(), BrowserError> {
        // SWP_NOZORDER | SWP_NOACTIVATE; never promote hidden tabs or steal focus.
        let success = unsafe {
            SetWindowPos(
                window.0.cast(),
                std::ptr::null_mut(),
                rect.x,
                rect.y,
                rect.width,
                rect.height,
                0x0014,
            )
        };
        if success == 0 {
            Err(BrowserError::NativeSurface)
        } else {
            Ok(())
        }
    }
    pub fn destroy(window: cef::sys::cef_window_handle_t) -> Result<(), BrowserError> {
        // No ancestor lookup or posted WM_CLOSE: only the CEF-owned child.
        if unsafe { DestroyWindow(window.0.cast()) } == 0 {
            Err(BrowserError::NativeSurface)
        } else {
            Ok(())
        }
    }
}

#[cfg(target_os = "linux")]
mod native_surface {
    use super::*;
    use std::ffi::{c_int, c_uint, c_ulong, c_void};
    #[link(name = "X11")]
    extern "C" {
        fn XMapWindow(display: *mut c_void, window: c_ulong) -> c_int;
        fn XUnmapWindow(display: *mut c_void, window: c_ulong) -> c_int;
        fn XMoveResizeWindow(
            display: *mut c_void,
            window: c_ulong,
            x: c_int,
            y: c_int,
            width: c_uint,
            height: c_uint,
        ) -> c_int;
        fn XFlush(display: *mut c_void) -> c_int;
        fn XDestroyWindow(display: *mut c_void, window: c_ulong) -> c_int;
    }
    pub fn prepare(_info: &mut WindowInfo) -> Result<(), BrowserError> {
        Ok(())
    }
    pub fn visible(
        window: cef::sys::cef_window_handle_t,
        visible: bool,
    ) -> Result<(), BrowserError> {
        let display = get_xdisplay().cast();
        if display.is_null() || window == 0 {
            return Err(BrowserError::NativeSurface);
        }
        // Use CEF's X connection on the CEF UI thread. X errors are asynchronous;
        // the runtime owner must retain its display/parent until OnBeforeClose.
        unsafe {
            if visible {
                XMapWindow(display, window);
            } else {
                XUnmapWindow(display, window);
            }
            XFlush(display);
        }
        Ok(())
    }
    pub fn resize(window: cef::sys::cef_window_handle_t, rect: &Rect) -> Result<(), BrowserError> {
        let display = get_xdisplay().cast();
        if display.is_null() || window == 0 {
            return Err(BrowserError::NativeSurface);
        }
        unsafe {
            XMoveResizeWindow(
                display,
                window,
                rect.x,
                rect.y,
                rect.width as u32,
                rect.height as u32,
            );
            XFlush(display);
        }
        Ok(())
    }
    pub fn destroy(window: cef::sys::cef_window_handle_t) -> Result<(), BrowserError> {
        let display = get_xdisplay().cast();
        if display.is_null() || window == 0 {
            return Err(BrowserError::NativeSurface);
        }
        unsafe {
            XDestroyWindow(display, window);
            XFlush(display);
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod native_surface {
    use super::*;
    use std::ffi::{c_char, c_void};
    #[repr(C)]
    struct Point {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    struct Size {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    struct Frame {
        origin: Point,
        size: Size,
    }
    // Objective-C BOOL is signed char on Intel macOS, but C++ bool on ARM.
    // Never read an Intel return value directly into Rust's two-value bool.
    #[cfg(target_arch = "x86_64")]
    type CocoaBool = i8;
    #[cfg(target_arch = "aarch64")]
    type CocoaBool = bool;
    #[link(name = "objc")]
    extern "C" {
        fn sel_registerName(name: *const c_char) -> *mut c_void;
        fn objc_msgSend();
        #[cfg(target_arch = "x86_64")]
        fn objc_msgSend_stret();
    }
    unsafe fn parent_rect(parent: *mut c_void, rect: &Rect) -> Result<Frame, BrowserError> {
        if parent.is_null() {
            return Err(BrowserError::NativeSurface);
        }
        let send_bool: unsafe extern "C" fn(*mut c_void, *mut c_void) -> CocoaBool =
            std::mem::transmute(objc_msgSend as *const ());
        let flipped =
            send_bool(parent, sel_registerName(c"isFlipped".as_ptr())) != CocoaBool::from(false);
        #[cfg(target_arch = "aarch64")]
        let bounds = {
            let send: unsafe extern "C" fn(*mut c_void, *mut c_void) -> Frame =
                std::mem::transmute(objc_msgSend as *const ());
            send(parent, sel_registerName(c"bounds".as_ptr()))
        };
        #[cfg(target_arch = "x86_64")]
        let bounds = {
            let mut result = std::mem::MaybeUninit::<Frame>::uninit();
            let send: unsafe extern "C" fn(*mut Frame, *mut c_void, *mut c_void) =
                std::mem::transmute(objc_msgSend_stret as *const ());
            send(
                result.as_mut_ptr(),
                parent,
                sel_registerName(c"bounds".as_ptr()),
            );
            result.assume_init()
        };
        let y = bounds.origin.y
            + if flipped {
                rect.y as f64
            } else {
                bounds.size.height - rect.y as f64 - rect.height as f64
            };
        let x = bounds.origin.x + rect.x as f64;
        if ![x, y, bounds.size.height].into_iter().all(f64::is_finite) {
            return Err(BrowserError::NativeSurface);
        }
        Ok(Frame {
            origin: Point { x, y },
            size: Size {
                width: rect.width as f64,
                height: rect.height as f64,
            },
        })
    }
    pub fn prepare(info: &mut WindowInfo) -> Result<(), BrowserError> {
        info.hidden = 1;
        // CEF expects parent NSView coordinates; app viewports use top-left.
        let rect = unsafe { parent_rect(info.parent_view.cast(), &info.bounds)? };
        if rect.origin.y < i32::MIN as f64
            || rect.origin.y > i32::MAX as f64
            || rect.origin.x < i32::MIN as f64
            || rect.origin.x > i32::MAX as f64
        {
            return Err(BrowserError::NativeSurface);
        }
        info.bounds.x = rect.origin.x.round() as i32;
        info.bounds.y = rect.origin.y.round() as i32;
        Ok(())
    }
    pub fn visible(view: cef::sys::cef_window_handle_t, visible: bool) -> Result<(), BrowserError> {
        if view.is_null() {
            return Err(BrowserError::NativeSurface);
        }
        // CEF's native handle is its child NSView. AppKit is confined to main.
        unsafe {
            let selector = sel_registerName(c"setHidden:".as_ptr());
            let send: unsafe extern "C" fn(*mut c_void, *mut c_void, CocoaBool) =
                std::mem::transmute(objc_msgSend as *const ());
            send(view.cast(), selector, CocoaBool::from(!visible));
        }
        Ok(())
    }
    pub fn resize(view: cef::sys::cef_window_handle_t, rect: &Rect) -> Result<(), BrowserError> {
        if view.is_null() {
            return Err(BrowserError::NativeSurface);
        }
        // Arguments (not return values) use the ordinary objc_msgSend ABI on
        // both supported 64-bit architectures; no stret return is involved.
        unsafe {
            let object: unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void =
                std::mem::transmute(objc_msgSend as *const ());
            let parent = object(view.cast(), sel_registerName(c"superview".as_ptr()));
            let frame = parent_rect(parent, rect)?;
            let selector = sel_registerName(c"setFrame:".as_ptr());
            let send: unsafe extern "C" fn(*mut c_void, *mut c_void, Frame) =
                std::mem::transmute(objc_msgSend as *const ());
            send(view.cast(), selector, frame);
        }
        Ok(())
    }
    pub fn destroy(view: cef::sys::cef_window_handle_t) -> Result<(), BrowserError> {
        if view.is_null() {
            return Err(BrowserError::NativeSurface);
        }
        // Releasing the superview's child ownership runs CefBrowserHostView's
        // dealloc/WindowDestroyed path. Never close the containing NSWindow.
        unsafe {
            let send: unsafe extern "C" fn(*mut c_void, *mut c_void) =
                std::mem::transmute(objc_msgSend as *const ());
            send(
                view.cast(),
                sel_registerName(c"removeFromSuperview".as_ptr()),
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_protocols::origin_browser::OriginBrowserPolicy;
    use sorng_protocols::private_forward_proxy::{Authority, DialFuture, ProxyLimits};

    struct Sink(Mutex<Vec<BrowserEvent>>);

    fn media_fence() -> MediaDocumentFence {
        MediaDocumentFence {
            generation: 8,
            origin: "https://fixture.invalid".into(),
            frame_id: "frame-1".into(),
            frame_url: "https://fixture.invalid/call".into(),
            main_frame_id: "main-1".into(),
            main_frame_url: "https://fixture.invalid/main".into(),
        }
    }

    #[test]
    fn media_device_allow_requires_live_owner_exact_document_and_unexpired_decision() {
        let now = Instant::now();
        let fence = media_fence();
        let (decision, completion) =
            MediaPermissionDecision::pending(now + Duration::from_secs(60));
        assert_eq!(
            media_permissions_for_document(3, &decision, &fence, Some(&fence), true, now),
            0
        );
        completion.complete(true);
        for mask in [1, 2, 3] {
            assert_eq!(
                media_permissions_for_document(mask, &decision, &fence, Some(&fence), true, now),
                mask
            );
        }
        for mask in [0, 4, 8, 5, 7, 15, u32::MAX] {
            assert_eq!(
                media_permissions_for_document(mask, &decision, &fence, Some(&fence), true, now),
                0
            );
        }
        assert_eq!(
            media_permissions_for_document(3, &decision, &fence, Some(&fence), false, now),
            0
        );
        assert_eq!(
            media_permissions_for_document(3, &decision, &fence, None, true, now),
            0
        );
        assert_eq!(
            media_permissions_for_document(
                3,
                &decision,
                &fence,
                Some(&fence),
                true,
                now + Duration::from_secs(60)
            ),
            0
        );
        for field in 0..6 {
            let mut changed = fence.clone();
            match field {
                0 => changed.generation += 1,
                1 => changed.origin = "https://other.invalid".into(),
                2 => changed.frame_id.push('2'),
                3 => changed.frame_url.push_str("#changed"),
                4 => changed.main_frame_id.push('2'),
                _ => changed.main_frame_url.push_str("?new"),
            }
            assert_eq!(
                media_permissions_for_document(3, &decision, &fence, Some(&changed), true, now),
                0
            );
        }
        decision.deny();
        assert_eq!(
            media_permissions_for_document(3, &decision, &fence, Some(&fence), true, now),
            0
        );
    }

    #[test]
    fn cancelled_or_dropped_media_prompt_cannot_authorize_a_later_document() {
        let now = Instant::now();
        let fence = media_fence();
        let (decision, completion) =
            MediaPermissionDecision::pending(now + Duration::from_secs(60));
        decision.deny();
        completion.complete(true);
        assert_eq!(
            media_permissions_for_document(1, &decision, &fence, Some(&fence), true, now),
            0
        );
        let (decision, completion) =
            MediaPermissionDecision::pending(now + Duration::from_secs(60));
        drop(completion);
        assert_eq!(
            media_permissions_for_document(2, &decision, &fence, Some(&fence), true, now),
            0
        );
        struct Hooks;
        impl NativeDocumentHooks for Hooks {
            fn on_main_document(&self, _: &BrowserIdentity, _: u64) {}
        }
        let identity =
            OriginBrowserPolicy::new("owner", "connection", "tab", "https://fixture.invalid")
                .unwrap()
                .identity()
                .clone();
        assert!(!Hooks.media_permission_current(&identity));
    }

    #[test]
    fn native_login_modular_options_require_explicit_same_grant_delivery() {
        assert!(login_form_options(NativeLoginAdapter::ModularForm, None).is_none());
        let options = crate::cef_renderer::DEFAULT_FORM_OPTIONS;
        assert_eq!(
            login_form_options(NativeLoginAdapter::ModularForm, Some(options)),
            Some(options)
        );
        assert_eq!(
            login_form_options(NativeLoginAdapter::Generic, None),
            Some(options)
        );
        assert_eq!(
            login_form_options(NativeLoginAdapter::Google, None),
            Some(options)
        );
        assert!(login_form_options(NativeLoginAdapter::Google, Some(options)).is_none());
        assert!(login_form_options(NativeLoginAdapter::Generic, Some(options)).is_none());
    }

    #[test]
    fn native_login_combined_hook_defaults_preserve_legacy_consent_without_options() {
        struct Hooks;
        impl NativeDocumentHooks for Hooks {
            fn on_main_document(&self, _: &BrowserIdentity, _: u64) {}
            fn with_auto_login(
                &self,
                request: &NativeLoginRequest<'_>,
                deliver: &mut dyn FnMut(NativeLoginCredentials<'_>),
            ) {
                deliver(NativeLoginCredentials {
                    identity: request.identity,
                    origin: request.origin,
                    valid_until: Instant::now() + Duration::from_secs(1),
                    username: "synthetic",
                    password: "synthetic-only",
                    auto_submit: false,
                });
            }
        }
        let policy =
            OriginBrowserPolicy::new("owner", "connection", "tab", "https://fixture.invalid")
                .unwrap();
        let request = NativeLoginRequest {
            identity: policy.identity(),
            origin: "https://fixture.invalid",
            adapter: NativeLoginAdapter::Generic,
            stage: NativeLoginStage::Form,
        };
        let mut count = 0;
        Hooks.with_form_credentials(&request, &mut |credentials, options| {
            assert!(credentials.identity == request.identity);
            assert_eq!(credentials.origin, request.origin);
            assert!(!credentials.auto_submit);
            assert!(options.is_none());
            count += 1;
        });
        assert_eq!(count, 1);
        assert!(Hooks.form_configuration().is_none());
    }

    fn automation_pending(
        generation: u64,
        token: Option<&str>,
        request: &str,
    ) -> PendingAutomation {
        PendingAutomation {
            generation,
            token: token.map(str::to_owned),
            origin: "https://fixture.test".into(),
            request: request.into(),
            frame: "main-frame".into(),
            url: "https://fixture.test/page".into(),
            stop: false,
            deadline: Instant::now() + Duration::from_secs(15),
            completion: Box::new(|_| {}),
        }
    }

    fn automation_response(status: &str, request: &str) -> AutomationResponse {
        AutomationResponse {
            serial: "1".into(),
            token: "123:7".into(),
            origin: "https://fixture.test".into(),
            request: request.into(),
            status: status.into(),
            steps: vec![],
            truncated: false,
        }
    }

    fn acquire_automation_receipt(state: &mut AutomationState) -> String {
        state
            .pending
            .insert("1".into(), automation_pending(state.generation, None, ""));
        let (_, reply) = state
            .finish(
                "main-frame",
                "https://fixture.test/page",
                automation_response("document", ""),
                Instant::now(),
            )
            .unwrap();
        let NativeAutomationReply::Document { document_token, .. } = reply else {
            panic!("expected native receipt");
        };
        document_token
    }

    #[test]
    fn native_automation_same_url_history_return_cannot_restore_old_receipt() {
        let mut state = AutomationState::default();
        let previous = acquire_automation_receipt(&mut state);
        assert!(state.matches(
            &previous,
            "https://fixture.test",
            "main-frame",
            "https://fixture.test/page"
        ));
        state.invalidate(); // away, possibly within the same V8 context
        state.invalidate(); // return to precisely the same native URL/frame
        let successor = acquire_automation_receipt(&mut state);
        assert_ne!(previous, successor);
        assert!(!state.matches(
            &previous,
            "https://fixture.test",
            "main-frame",
            "https://fixture.test/page"
        ));
        assert!(state.matches(
            &successor,
            "https://fixture.test",
            "main-frame",
            "https://fixture.test/page"
        ));
    }

    #[test]
    fn native_automation_retired_cancel_is_stale_even_while_successor_loads() {
        let mut state = AutomationState::default();
        let token = acquire_automation_receipt(&mut state);
        let cancel = NativeAutomationAction::Cancel {
            document_token: token,
            origin: "https://fixture.test".into(),
            request_id: "cleanup-1".into(),
        };
        state.navigating = true;
        state.invalidate();
        assert_eq!(
            state.dispatch_failure(&cancel, "main-frame", "https://fixture.test/page"),
            Some(NativeAutomationFailure::StaleDocument)
        );
        assert_eq!(
            state.dispatch_failure(
                &NativeAutomationAction::Document {},
                "main-frame",
                "https://fixture.test/page"
            ),
            Some(NativeAutomationFailure::Unavailable)
        );
        state.navigating = false;
        let replacement = acquire_automation_receipt(&mut state);
        assert_eq!(
            state.dispatch_failure(&cancel, "main-frame", "https://fixture.test/page"),
            Some(NativeAutomationFailure::StaleDocument)
        );
        assert!(state.matches(
            &replacement,
            "https://fixture.test",
            "main-frame",
            "https://fixture.test/page"
        ));
    }

    #[test]
    fn native_automation_reply_requires_requested_kind_exact_native_scope_and_one_shot() {
        let mut state = AutomationState::default();
        assert!(state
            .finish(
                "main-frame",
                "https://fixture.test/page",
                automation_response("document", ""),
                Instant::now()
            )
            .is_none());
        let token = acquire_automation_receipt(&mut state);
        state
            .pending
            .insert("1".into(), automation_pending(0, Some(&token), "request-1"));
        for (frame, url) in [
            ("iframe", "https://fixture.test/page"),
            ("main-frame", "https://fixture.test/other"),
        ] {
            assert!(state
                .finish(
                    frame,
                    url,
                    automation_response("ok", "request-1"),
                    Instant::now()
                )
                .is_none());
        }
        for field in ["origin", "token", "request", "status"] {
            let mut response = automation_response("ok", "request-1");
            match field {
                "origin" => response.origin = "https://other.test".into(),
                "token" => response.token = "old-renderer-document".into(),
                "request" => response.request = "unsolicited".into(),
                _ => response.status = "document".into(),
            }
            assert!(state
                .finish(
                    "main-frame",
                    "https://fixture.test/page",
                    response,
                    Instant::now()
                )
                .is_none());
        }
        let (_, reply) = state
            .finish(
                "main-frame",
                "https://fixture.test/page",
                automation_response("ok", "request-1"),
                Instant::now(),
            )
            .unwrap();
        assert_eq!(
            reply,
            NativeAutomationReply::Completed {
                request_id: "request-1".into()
            }
        );
        assert!(state
            .finish(
                "main-frame",
                "https://fixture.test/page",
                automation_response("ok", "request-1"),
                Instant::now()
            )
            .is_none());
    }

    #[test]
    fn native_automation_generation_loading_and_deadline_fail_closed() {
        let mut state = AutomationState::default();
        let token = acquire_automation_receipt(&mut state);
        state
            .pending
            .insert("1".into(), automation_pending(0, Some(&token), "request-1"));
        state.navigating = true;
        assert!(!state.available());
        assert!(state
            .finish(
                "main-frame",
                "https://fixture.test/page",
                automation_response("ok", "request-1"),
                Instant::now()
            )
            .is_none());
        state.navigating = false;
        state.generation = 1;
        assert!(state
            .finish(
                "main-frame",
                "https://fixture.test/page",
                automation_response("ok", "request-1"),
                Instant::now()
            )
            .is_none());
        state.generation = 0;
        let (_, reply) = state
            .finish(
                "main-frame",
                "https://fixture.test/page",
                automation_response("ok", "request-1"),
                Instant::now() + Duration::from_secs(30),
            )
            .unwrap();
        assert_eq!(
            reply,
            NativeAutomationReply::Failed {
                reason: NativeAutomationFailure::TimedOut
            }
        );
        state.generation = u64::MAX;
        state.invalidate();
        assert!(!state.available());
    }

    #[tokio::test]
    async fn native_automation_invalidation_blocks_reentrant_dispatch_and_completes_once() {
        let shared = Arc::new(fixture(Arc::new(Sink(Mutex::new(vec![])))).await);
        let completed = Arc::new(AtomicU64::new(0));
        let mut pending = automation_pending(0, None, "");
        let callback_owner = Arc::downgrade(&shared);
        let count = completed.clone();
        pending.completion = Box::new(move |reply| {
            let owner = callback_owner.upgrade().unwrap();
            assert!(!owner.automation.lock().unwrap().available());
            // No automation mutex is held across a callback, including nested cleanup.
            owner.clear_automation();
            assert!(!owner.automation.lock().unwrap().available());
            assert_eq!(
                reply,
                NativeAutomationReply::Failed {
                    reason: NativeAutomationFailure::StaleDocument
                }
            );
            count.fetch_add(1, Ordering::Relaxed);
        });
        shared
            .automation
            .lock()
            .unwrap()
            .pending
            .insert("1".into(), pending);
        shared.clear_automation();
        assert_eq!(completed.load(Ordering::Relaxed), 1);
        assert!(shared.automation.lock().unwrap().available());
        shared.expire_automation("1");
        assert_eq!(completed.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn native_automation_revoke_is_visible_before_completion_and_timeout_is_one_shot() {
        let shared = Arc::new(fixture(Arc::new(Sink(Mutex::new(vec![])))).await);
        let count = Arc::new(AtomicU64::new(0));
        let owner = Arc::downgrade(&shared);
        let observed = count.clone();
        let mut pending = automation_pending(0, None, "");
        pending.completion = Box::new(move |_| {
            assert!(!owner.upgrade().unwrap().current());
            observed.fetch_add(1, Ordering::Relaxed);
        });
        shared
            .automation
            .lock()
            .unwrap()
            .pending
            .insert("1".into(), pending);
        shared.revoke();
        shared.expire_automation("1");
        assert_eq!(count.load(Ordering::Relaxed), 1);
        let observed = count.clone();
        let mut pending = automation_pending(0, None, "");
        pending.completion = Box::new(move |reply| {
            assert_eq!(
                reply,
                NativeAutomationReply::Failed {
                    reason: NativeAutomationFailure::TimedOut
                }
            );
            observed.fetch_add(1, Ordering::Relaxed);
        });
        shared
            .automation
            .lock()
            .unwrap()
            .pending
            .insert("2".into(), pending);
        shared.expire_automation("2");
        shared.expire_automation("2");
        assert_eq!(count.load(Ordering::Relaxed), 2);
    }

    struct TestCertificateCompletion {
        allowed: Arc<AtomicU64>,
        denied: Arc<AtomicU64>,
    }
    impl CertificateCompletion for TestCertificateCompletion {
        fn continue_request(&self) {
            self.allowed.fetch_add(1, Ordering::Relaxed);
        }
        fn cancel_request(&self) {
            self.denied.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[test]
    fn certificate_modes_fail_closed_and_prompt_cannot_mask_revocation() {
        assert_eq!(
            NativeCertificatePolicy::default(),
            NativeCertificatePolicy::Strict
        );
        assert!(NativeCertificatePolicy::Strict.supported());
        assert!(NativeCertificatePolicy::PromptInvalidCertificate.supported());
        assert!(!NativeCertificatePolicy::Pinned.supported());
        assert!(!NativeCertificatePolicy::TrustOnFirstUse.supported());
        assert!(promptable_certificate_error(
            Errorcode::CERT_AUTHORITY_INVALID,
            4
        ));
        assert!(promptable_certificate_error(
            Errorcode::CERT_DATE_INVALID,
            7
        ));
        for status in [0, 8, 64, 68, u32::MAX] {
            assert!(!promptable_certificate_error(
                Errorcode::CERT_AUTHORITY_INVALID,
                status
            ));
        }
        assert!(!promptable_certificate_error(Errorcode::CERT_REVOKED, 4));
    }

    #[tokio::test]
    async fn native_certificate_wrapper_denies_missing_owner_and_cancels_pending_once() {
        let shared = Arc::new(fixture(Arc::new(Sink(Mutex::new(Vec::new())))).await);
        let inner = request_handler_with_lifecycle(
            shared.session.clone(),
            shared.identity.clone(),
            shared.permissions.clone(),
            Some(shared.clone()),
        );
        let handler = NativeRequests::new(shared.clone(), inner);
        let allowed = Arc::new(AtomicU64::new(0));
        let denied = Arc::new(AtomicU64::new(0));
        let callback = TestCertificateCompletion {
            allowed: allowed.clone(),
            denied: denied.clone(),
        };
        assert_eq!(
            handler.on_certificate_error(
                None,
                Errorcode::CERT_AUTHORITY_INVALID,
                Some(&CefString::from("https://fixture.invalid/")),
                None,
                None
            ),
            0
        );
        assert_eq!(allowed.load(Ordering::Relaxed), 0);
        *shared.certificate_pending.lock().unwrap() = Some(PendingCertificate {
            request_id: 42,
            origin: "https://fixture.invalid".into(),
            expires_at: Instant::now(),
            callback: Box::new(callback),
        });
        shared.cancel_certificate(Some(41));
        assert!(shared.certificate_pending.lock().unwrap().is_some());
        CertificateTimeout::new(Arc::downgrade(&shared), 42).execute();
        assert!(shared.certificate_pending.lock().unwrap().is_none());
        shared.cancel_certificate(Some(42));
        shared.revoke();
        assert_eq!(denied.load(Ordering::Relaxed), 1);
        assert_eq!(allowed.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn native_request_wrapper_preserves_every_existing_route_callback() {
        let source = include_str!("cef_requests.rs");
        let request_impl = source
            .split("struct SessionRequestHandler")
            .nth(1)
            .unwrap()
            .split("wrap_resource_request_handler!")
            .next()
            .unwrap();
        let native = include_str!("cef_browser.rs")
            .split("struct NativeRequests")
            .nth(1)
            .unwrap()
            .split("wrap_client!")
            .next()
            .unwrap();
        for line in request_impl.lines() {
            if let Some(name) = line
                .trim_start()
                .strip_prefix("fn ")
                .and_then(|rest| rest.split('(').next())
            {
                assert!(
                    native.contains(&format!("self.inner.{name}(")),
                    "missing route delegation: {name}"
                );
            }
        }
    }
    impl BrowserEventSink for Sink {
        fn on_event(&self, event: BrowserEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    async fn fixture(sink: Arc<dyn BrowserEventSink>) -> Shared {
        let policy =
            OriginBrowserPolicy::new("owner", "connection", "tab", "https://fixture.invalid")
                .unwrap();
        let identity = policy.identity().clone();
        let session = OriginBrowserSession::start(
            policy,
            Arc::new(|_: Authority| -> DialFuture { panic!("lifecycle fixture must not dial") }),
            ProxyLimits::default(),
        )
        .await
        .unwrap();
        let mut control = BrowserControl::new(
            identity.clone(),
            ViewportBounds::new(0.0, 0.0, 640.0, 480.0).unwrap(),
        );
        control.attached(&identity).unwrap();
        Shared {
            session: Arc::new(Mutex::new(session)),
            identity,
            permissions: crate::cef_requests::deny_permissions(),
            sink,
            hooks: None,
            login_budget: Mutex::new(LoginBudget::default()),
            feature_gate: Mutex::new(RendererFeatureGate::default()),
            login_adapter: NativeLoginAdapter::Generic,
            certificate_policy: NativeCertificatePolicy::Strict,
            certificate_pending: Mutex::new(None),
            automation: Mutex::new(AutomationState::default()),
            capabilities: NativeBrowserCapabilities::default(),
            media_pending: Mutex::new(None),
            state: Arc::new(Mutex::new(State {
                control,
                browser_id: None,
                cleanup: CleanupProgress::Idle,
                sequence: 0,
                display: BrowserDisplayState::default(),
                page: BrowserState {
                    lifecycle: Lifecycle::Attached,
                    url: RedactedUrl::Bootstrap,
                    title: RedactedTitle::Empty,
                    loading: false,
                    can_go_back: false,
                    can_go_forward: false,
                    fault: None,
                },
            })),
        }
    }

    #[test]
    fn owner_display_keeps_full_native_url_without_changing_diagnostics() {
        let url = "https://fixture.invalid/path?q=private#fragment";
        assert_eq!(display_url(url), url);
        assert_eq!(
            redact_url(url),
            RedactedUrl::Origin("https://fixture.invalid".into())
        );
        assert_eq!(display_url("about:blank"), "about:blank");
        for value in [
            "https://user:secret@fixture.invalid/path",
            "javascript:alert(1)",
            "data:text/html,x",
            "https://fixture.invalid/\npath",
            "https://fixture.invalid/\\path",
            "https://fixture.invalid/\u{202e}path",
        ] {
            assert!(display_url(value).is_empty());
        }
        assert!(display_url(&format!("https://fixture.invalid/{}", "x".repeat(16384))).is_empty());
        assert!(display_text_safe("Inbox – example", 512));
        assert!(!display_text_safe("spoof\u{2066}title", 512));
        assert!(!display_text_safe(&"x".repeat(513), 512));
    }

    #[test]
    fn urls_never_forward_secrets_or_engine_diagnostics() {
        assert_eq!(
            redact_url(
                "https://user:password@fixture.invalid/private/token?access_token=secret#password"
            ),
            RedactedUrl::Origin("https://fixture.invalid".into())
        );
        for value in [
            "file:///private/key",
            "data:text/html,secret",
            "javascript:secret",
            "chrome://settings",
            "about:blank#secret",
            "not a URL",
        ] {
            assert_eq!(redact_url(value), RedactedUrl::Unavailable);
        }
        assert_eq!(
            redact_url(&format!("https://fixture.invalid/?{}", "a".repeat(16_384))),
            RedactedUrl::Unavailable
        );
        assert_eq!(redact_url("about:blank"), RedactedUrl::Bootstrap);
    }

    #[test]
    fn dpi_conversion_bounds_allocations_and_rejects_bad_scale() {
        let bounds = ViewportBounds::new(1.5, 2.0, 640.0, 480.0).unwrap();
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY, 8.01] {
            assert!(native_bounds(bounds, scale).is_err());
        }
        let rect = native_bounds(bounds, 2.0).unwrap();
        assert_eq!(
            rect.width,
            if cfg!(target_os = "macos") { 640 } else { 1280 }
        );
        if !cfg!(target_os = "macos") {
            assert!(
                native_bounds(ViewportBounds::new(0.0, 0.0, 8192.0, 8192.0).unwrap(), 2.0).is_err()
            );
        }
    }

    #[tokio::test]
    async fn renderer_fault_revokes_before_event_and_never_reports_ready() {
        let sink = Arc::new(Sink(Mutex::new(Vec::new())));
        let shared = fixture(sink.clone()).await;
        assert!(shared.current());
        assert_eq!(
            shared.session.lock().unwrap().status(),
            BrowserSessionStatus::NotReady
        );
        shared.renderer_fault(None);
        assert_eq!(
            shared.session.lock().unwrap().status(),
            BrowserSessionStatus::Revoked
        );
        assert!(shared
            .session
            .lock()
            .unwrap()
            .with_proxy_credentials(|_, _| ())
            .is_none());
        let events = sink.0.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].state.lifecycle, Lifecycle::Faulted);
        assert_eq!(events[0].state.fault, Some(BrowserFault::Renderer));
        assert!(events[0].identity == shared.identity);
    }

    #[tokio::test]
    async fn sink_panic_revokes_without_unwinding_or_reentering_sink() {
        struct Panics;
        impl BrowserEventSink for Panics {
            fn on_event(&self, _: BrowserEvent) {
                panic!("sink failed");
            }
        }
        let shared = fixture(Arc::new(Panics)).await;
        assert!(!shared.emit());
        assert_eq!(
            shared.session.lock().unwrap().status(),
            BrowserSessionStatus::Revoked
        );
        assert_eq!(
            shared.state.lock().unwrap().control.lifecycle(),
            Lifecycle::Faulted
        );
    }

    #[tokio::test]
    async fn navigation_observation_cannot_grant_readiness_or_outlive_attempt() {
        #[derive(Default)]
        struct Observations(Mutex<Vec<NativeNavigationStatus>>);
        impl NativeDocumentHooks for Observations {
            fn on_main_document(&self, _: &BrowserIdentity, _: u64) {}
            fn on_navigation_status(&self, _: &BrowserIdentity, status: NativeNavigationStatus) {
                self.0.lock().unwrap().push(status);
            }
        }
        let mut shared = fixture(Arc::new(Sink(Mutex::new(Vec::new())))).await;
        let observations = Arc::new(Observations::default());
        shared.hooks = Some(observations.clone());
        shared.navigation_status(NativeNavigationStatus::Requested);
        assert_eq!(
            shared.session.lock().unwrap().status(),
            BrowserSessionStatus::NotReady
        );
        shared.revoke();
        shared.navigation_status(NativeNavigationStatus::Requested);
        assert_eq!(
            *observations.0.lock().unwrap(),
            [NativeNavigationStatus::Requested]
        );
    }

    #[tokio::test]
    async fn navigation_observer_panic_revokes_without_unwinding_through_cef() {
        struct Panics;
        impl NativeDocumentHooks for Panics {
            fn on_main_document(&self, _: &BrowserIdentity, _: u64) {}
            fn on_navigation_status(&self, _: &BrowserIdentity, _: NativeNavigationStatus) {
                panic!("observer failed");
            }
        }
        let mut shared = fixture(Arc::new(Sink(Mutex::new(Vec::new())))).await;
        shared.hooks = Some(Arc::new(Panics));
        shared.navigation_status(NativeNavigationStatus::Requested);
        assert_eq!(
            shared.session.lock().unwrap().status(),
            BrowserSessionStatus::Revoked
        );
    }

    #[tokio::test]
    async fn stale_fault_cannot_revoke_a_successor_and_events_keep_old_identity() {
        let sink = Arc::new(Sink(Mutex::new(Vec::new())));
        let mut stale = fixture(sink.clone()).await;
        let replacement = fixture(sink.clone()).await;
        stale.session = replacement.session.clone();
        stale.renderer_fault(None);
        assert_eq!(
            replacement.session.lock().unwrap().status(),
            BrowserSessionStatus::NotReady
        );
        assert!(sink.0.lock().unwrap()[0].identity == stale.identity);
    }

    #[tokio::test]
    async fn native_close_denies_parent_default_and_only_completion_marks_closed() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        let sink = Arc::new(Sink(Mutex::new(Vec::new())));
        let shared = Arc::new(fixture(sink.clone()).await);
        let life = NativeLife::new(shared.clone(), Arc::new(Mutex::new(None)));
        assert_eq!(
            life.do_close(None),
            1,
            "must suppress CEF top-level parent close"
        );
        assert_eq!(
            shared.session.lock().unwrap().status(),
            BrowserSessionStatus::Revoked
        );
        assert_eq!(
            shared.state.lock().unwrap().control.lifecycle(),
            Lifecycle::Closing
        );
        life.on_before_close(None);
        assert_eq!(
            shared.state.lock().unwrap().control.lifecycle(),
            Lifecycle::Closed
        );
        assert_eq!(
            sink.0.lock().unwrap().last().unwrap().state.lifecycle,
            Lifecycle::Closed
        );
        life.on_before_close(None);
        assert_eq!(
            shared.state.lock().unwrap().control.lifecycle(),
            Lifecycle::Closed
        );
    }

    async fn cleanup_fixture() -> (Shared, Arc<Sink>) {
        let sink = Arc::new(Sink(Mutex::new(Vec::new())));
        let shared = fixture(sink.clone()).await;
        shared.state.lock().unwrap().browser_id = Some(17);
        (shared, sink)
    }

    #[tokio::test]
    async fn deferred_cleanup_requires_revoked_attempt_and_terminal_intent() {
        let (shared, _) = cleanup_fixture().await;
        let owner = shared.cleanup_owner();
        assert!(!owner.queue(17, CleanupStage::Close));
        shared.revoke();
        assert!(!owner.queue(17, CleanupStage::Close));
        shared
            .state
            .lock()
            .unwrap()
            .control
            .fault(&shared.identity)
            .unwrap();
        assert!(!shared.current());
        assert!(owner.queue(17, CleanupStage::Close));
        assert_eq!(
            shared.state.lock().unwrap().cleanup,
            CleanupProgress::CloseQueued
        );
        assert!(owner.claim(17, CleanupStage::Close));
    }

    #[tokio::test]
    async fn deferred_cleanup_two_stages_deduplicate_and_do_not_destroy_on_close_claim() {
        let (shared, _) = cleanup_fixture().await;
        shared.fault(None, BrowserFault::Load);
        let owner = shared.cleanup_owner();
        assert!(owner.queue(17, CleanupStage::Close));
        assert!(!owner.queue(17, CleanupStage::Close));
        assert!(!owner.claim(17, CleanupStage::Destroy));
        assert!(owner.claim(17, CleanupStage::Close));
        assert!(!owner.claim(17, CleanupStage::Close));
        assert_eq!(
            shared.state.lock().unwrap().cleanup,
            CleanupProgress::CloseIssued
        );
        shared
            .state
            .lock()
            .unwrap()
            .control
            .begin_close(&shared.identity)
            .unwrap();
        assert!(owner.queue(17, CleanupStage::Destroy));
        assert!(!owner.queue(17, CleanupStage::Destroy));
        assert!(!owner.queue(17, CleanupStage::Close));
        assert_eq!(
            shared.state.lock().unwrap().cleanup,
            CleanupProgress::DestroyQueued
        );
        assert!(owner.claim(17, CleanupStage::Destroy));
        assert!(!owner.claim(17, CleanupStage::Destroy));
        assert_eq!(
            shared.state.lock().unwrap().control.lifecycle(),
            Lifecycle::Closing
        );
    }

    #[tokio::test]
    async fn deferred_cleanup_native_close_supersedes_pending_first_stage() {
        for queue_close in [false, true] {
            let (shared, _) = cleanup_fixture().await;
            shared.revoke();
            shared
                .state
                .lock()
                .unwrap()
                .control
                .begin_close(&shared.identity)
                .unwrap();
            let owner = shared.cleanup_owner();
            if queue_close {
                assert!(owner.queue(17, CleanupStage::Close));
            }
            assert!(owner.queue(17, CleanupStage::Destroy));
            assert!(!owner.claim(17, CleanupStage::Close));
            assert!(owner.claim(17, CleanupStage::Destroy));
        }
    }

    #[tokio::test]
    async fn deferred_cleanup_rejects_stale_identity_browser_and_replaced_session() {
        let (shared, _) = cleanup_fixture().await;
        shared.fault(None, BrowserFault::Load);
        let owner = shared.cleanup_owner();
        assert!(!owner.queue(18, CleanupStage::Close));
        assert!(owner.queue(17, CleanupStage::Close));
        assert!(!owner.claim(18, CleanupStage::Close));
        let (replacement, _) = cleanup_fixture().await;
        replacement.revoke();
        let mut stale = owner.clone();
        stale.identity = replacement.identity.clone();
        assert!(!stale.claim(17, CleanupStage::Close));
        stale = owner.clone();
        stale.session = replacement.session.clone();
        assert!(!stale.claim(17, CleanupStage::Close));
        stale = owner.clone();
        stale.state = replacement.state.clone();
        assert!(!stale.claim(17, CleanupStage::Close));
        assert_eq!(
            replacement.state.lock().unwrap().cleanup,
            CleanupProgress::Idle
        );
        shared.state.lock().unwrap().browser_id = Some(18);
        assert!(!owner.claim(17, CleanupStage::Close));
        owner.failed(17, CleanupStage::Close);
        assert_eq!(
            shared.state.lock().unwrap().cleanup,
            CleanupProgress::CloseQueued
        );
    }

    #[tokio::test]
    async fn deferred_cleanup_closed_callback_invalidates_both_pending_stages() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        for stage in [CleanupStage::Close, CleanupStage::Destroy] {
            let (shared, sink) = cleanup_fixture().await;
            shared.fault(None, BrowserFault::Load);
            let owner = shared.cleanup_owner();
            assert!(owner.queue(17, stage));
            let shared = Arc::new(shared);
            NativeLife::new(shared.clone(), Arc::new(Mutex::new(None))).on_before_close(None);
            assert!(!owner.claim(17, stage));
            assert!(!owner.queue(17, CleanupStage::Close));
            assert!(!owner.queue(17, CleanupStage::Destroy));
            let event_count = sink.0.lock().unwrap().len();
            owner.failed(17, stage);
            assert_eq!(sink.0.lock().unwrap().len(), event_count);
            assert_eq!(
                shared.state.lock().unwrap().cleanup,
                CleanupProgress::Complete
            );
        }
    }

    #[tokio::test]
    async fn deferred_cleanup_post_or_surface_failure_is_terminal_and_observable() {
        for stage in [CleanupStage::Close, CleanupStage::Destroy] {
            for issued in [false, true] {
                let (shared, sink) = cleanup_fixture().await;
                shared.fault(None, BrowserFault::Load);
                let owner = shared.cleanup_owner();
                assert!(owner.queue(17, stage));
                if issued {
                    assert!(owner.claim(17, stage));
                }
                owner.failed(17, stage);
                let state = shared.state.lock().unwrap();
                assert_eq!(state.cleanup, CleanupProgress::Failed);
                assert_ne!(state.control.lifecycle(), Lifecycle::Closed);
                assert_eq!(state.page.fault, Some(BrowserFault::NativeSurface));
                drop(state);
                assert_eq!(
                    shared.session.lock().unwrap().status(),
                    BrowserSessionStatus::Revoked
                );
                assert_eq!(
                    sink.0.lock().unwrap().last().unwrap().state.fault,
                    Some(BrowserFault::NativeSurface)
                );
                assert!(!owner.claim(17, stage));
                assert!(!owner.queue(17, CleanupStage::Close));
                assert!(!owner.queue(17, CleanupStage::Destroy));
                let event_count = sink.0.lock().unwrap().len();
                owner.failed(17, stage);
                assert_eq!(sink.0.lock().unwrap().len(), event_count);
            }
        }
    }

    #[tokio::test]
    async fn poisoned_owner_and_control_cannot_keep_the_relay_alive() {
        for poison_session in [false, true] {
            let shared = fixture(Arc::new(Sink(Mutex::new(Vec::new())))).await;
            let _ = catch_unwind(AssertUnwindSafe(|| {
                if poison_session {
                    let _guard = shared.session.lock().unwrap();
                    panic!("owner fixture");
                } else {
                    let _guard = shared.state.lock().unwrap();
                    panic!("control fixture");
                }
            }));
            if poison_session {
                assert!(!shared.current());
            } else {
                assert!(!shared.emit());
            }
            shared.fault(None, BrowserFault::Session);
            let session = shared
                .session
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            assert_eq!(session.status(), BrowserSessionStatus::Revoked);
            assert!(session.with_proxy_credentials(|_, _| ()).is_none());
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn win32_child_hide_resize_and_destroy_never_destroy_its_parent() {
        use std::ffi::c_void;
        #[repr(C)]
        struct WinRect {
            left: i32,
            top: i32,
            right: i32,
            bottom: i32,
        }
        #[link(name = "user32")]
        extern "system" {
            fn CreateWindowExW(
                ex_style: u32,
                class: *const u16,
                name: *const u16,
                style: u32,
                x: i32,
                y: i32,
                width: i32,
                height: i32,
                parent: *mut c_void,
                menu: *mut c_void,
                instance: *mut c_void,
                parameter: *mut c_void,
            ) -> *mut c_void;
            fn DestroyWindow(window: *mut c_void) -> i32;
            fn IsWindow(window: *mut c_void) -> i32;
            fn IsWindowEnabled(window: *mut c_void) -> i32;
            fn GetWindowLongW(window: *mut c_void, index: i32) -> i32;
            fn GetWindowRect(window: *mut c_void, rect: *mut WinRect) -> i32;
        }
        struct Window(*mut c_void);
        impl Drop for Window {
            fn drop(&mut self) {
                unsafe {
                    DestroyWindow(self.0);
                }
            }
        }
        let class: Vec<_> = "STATIC\0".encode_utf16().collect();
        let empty = [0_u16];
        let null = std::ptr::null_mut();
        // Real hidden native windows owned by this test thread; no CEF process
        // or desktop-visible window is started for this OS-operation fixture.
        let parent = Window(unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                empty.as_ptr(),
                0,
                0,
                0,
                640,
                480,
                null,
                null,
                null,
                null,
            )
        });
        assert!(!parent.0.is_null());
        let child = Window(unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                empty.as_ptr(),
                0x50000000,
                0,
                0,
                100,
                100,
                parent.0,
                null,
                null,
                null,
            )
        });
        assert!(!child.0.is_null());
        let handle = cef::sys::HWND(child.0.cast());
        native_surface::visible(handle, false).unwrap();
        assert_eq!(unsafe { IsWindowEnabled(child.0) }, 0);
        assert_eq!(unsafe { GetWindowLongW(child.0, -16) } & 0x10000000, 0);
        native_surface::resize(
            handle,
            &Rect {
                x: 12,
                y: 34,
                width: 320,
                height: 200,
            },
        )
        .unwrap();
        let mut rect = WinRect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        assert_ne!(unsafe { GetWindowRect(child.0, &mut rect) }, 0);
        assert_eq!((rect.right - rect.left, rect.bottom - rect.top), (320, 200));
        // Resizing must not unhide/re-enable or focus a background tab.
        assert_eq!(unsafe { IsWindowEnabled(child.0) }, 0);
        assert_eq!(unsafe { GetWindowLongW(child.0, -16) } & 0x10000000, 0);
        native_surface::visible(handle, true).unwrap();
        assert_ne!(unsafe { IsWindowEnabled(child.0) }, 0);
        assert_ne!(unsafe { GetWindowLongW(child.0, -16) } & 0x10000000, 0);
        native_surface::destroy(handle).unwrap();
        assert_eq!(unsafe { IsWindow(child.0) }, 0);
        assert_ne!(unsafe { IsWindow(parent.0) }, 0);
    }

    #[test]
    fn review_handlers_explicitly_deny_native_defaults_without_runtime() {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        assert_eq!(DenyDownloads::new().can_download(None, None, None), 0);
        assert_eq!(
            DenyDownloads::new().on_before_download(None, None, None, None),
            1
        );
        assert_eq!(
            DenyFileDialog::new().on_file_dialog(
                None,
                FileDialogMode::default(),
                None,
                None,
                None,
                None,
                None,
                None
            ),
            1
        );
        assert_eq!(
            DenyPermissions::new().on_request_media_access_permission(
                None,
                None,
                None,
                u32::MAX,
                None
            ),
            1
        );
        assert_eq!(
            DenyPermissions::new().on_show_permission_prompt(None, 1, None, u32::MAX, None),
            1
        );
        assert_eq!(
            DenyDrag::new().on_drag_enter(None, None, DragOperationsMask::default()),
            1
        );
        let mut suppressed = 0;
        assert_eq!(
            DenyJsDialog::new().on_jsdialog(
                None,
                None,
                JsdialogType::default(),
                None,
                None,
                None,
                Some(&mut suppressed)
            ),
            0
        );
        assert_eq!(suppressed, 1);
    }
}
