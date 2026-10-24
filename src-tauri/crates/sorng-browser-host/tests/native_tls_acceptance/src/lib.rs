//! Opt-in patched-engine fixture. No system trust edits or acceptance grants.
use cef::{rc::Rc, *};
use sorng_browser_host::{
    bootstrap_platform::{BootstrapError, BundlePaths, RuntimeBootstrap},
    cef_browser::{BrowserEvent, BrowserEventSink, CefBrowserHost, NativeDocumentHooks},
    cef_context::{PreparationStatus, PrivateRequestContext},
    cef_runtime::{self, CefRuntime},
    cef_tls_bridge::{
        self, NativeTlsBridge, NativeTlsCaMode, NativeTlsCompletion, NativeTlsConfig,
        NativeTlsDecision, NativeTlsEvidence, NativeTlsHooks,
    },
    control::{Lifecycle, ViewportBounds},
    domain_permissions::{WebsitePermissionDecision, WebsitePermissionEngine, WebsiteRequestClass},
    native_features::{
        NativeFeatureStatus, NativeLoginAdapter, NativeLoginCredentials, NativeLoginDeliveryStatus,
        NativeLoginRequest, NativeLoginStage,
    },
};
use sorng_protocols::{
    origin_browser::{
        BrowserIdentity, NativeHostReadiness, OriginBrowserPolicy, OriginBrowserSession,
    },
    private_forward_proxy::{Authority, BoxedStream, DialFuture, ProxyLimits, RouteDialer},
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tao::{
    event::Event,
    event_loop::{ControlFlow, EventLoop},
    platform::run_return::EventLoopExtRunReturn,
    window::WindowBuilder,
};
mod fixture;
mod ledger;
#[cfg(any(target_os = "windows", test))]
mod private_parent;
mod registry_retirement_fixture;
mod static_document;
mod storage;
use ledger::{Decision, Ledger};
type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
// The caller supplies the exact revision already verified by NativeTlsBridge.
// Registry ABI2 and the bounded-retirement contract are shared by revisions4/5.
fn registration_retirement_for_revision<T>(
    patch_id: &str,
    run: impl FnOnce() -> Result<T>,
) -> Option<Result<T>> {
    match patch_id {
        cef_tls_bridge::PATCH_ID | cef_tls_bridge::HTTP3_PATCH_ID => Some(run()),
        cef_tls_bridge::LEGACY_PATCH_ID
        | cef_tls_bridge::HTTP2_PATCH_ID
        | cef_tls_bridge::PROXY_APPLIED_PATCH_ID => None,
        _ => Some(Err("unsupported registry fixture bridge revision".into())),
    }
}

// The reviewed staged adapter requires this exact origin. The route dialer
// below maps it only to a numeric loopback listener; no public provider call.
const ORIGIN: &str = "https://accounts.google.com";
const CASES: &[&str] = &[
    "manual",
    "staged",
    "reject",
    "cancel",
    "wrong-host",
    "wrong-port",
    "wrong-certificate",
    "revoke-pending",
    "successor",
];

#[cfg(windows)]
#[no_mangle]
pub unsafe extern "C" fn RunWinMain(
    instance: cef::sys::HINSTANCE,
    _: *mut u16,
    _: i32,
    sandbox: *mut std::ffi::c_void,
    version: *const sorng_browser_host::platform::windows::BootstrapVersionInfo,
) -> i32 {
    std::panic::catch_unwind(|| unsafe {
        sorng_browser_host::bootstrap_platform::run_windows_entry(instance, sandbox, version, run)
    })
    .unwrap_or(2)
}

// Only log collection is added to the production App. In particular there is
// no certificate bypass, replacement process handler, resolver, or UA override.
wrap_app! {
    struct LoggingApp { inner: App, netlog: String }
    impl App {
        fn browser_process_handler(&self)->Option<BrowserProcessHandler>{self.inner.browser_process_handler()}
        fn render_process_handler(&self)->Option<RenderProcessHandler>{self.inner.render_process_handler()}
        fn on_before_command_line_processing(&self,kind:Option<&CefString>,command:Option<&mut CommandLine>){
            if let Some(command)=command {
                self.inner.on_before_command_line_processing(kind,Some(command));
                command.append_switch_with_value(Some(&CefString::from("log-net-log")),Some(&CefString::from(self.netlog.as_str())));
            }
        }
    }
}
struct LoggingBootstrap<'a> {
    inner: &'a mut dyn RuntimeBootstrap,
    netlog: String,
}
impl RuntimeBootstrap for LoggingBootstrap<'_> {
    unsafe fn initialize_native(
        &mut self,
        settings: &Settings,
        app: &mut App,
    ) -> std::result::Result<(), BootstrapError> {
        let mut logged = LoggingApp::new(app.clone(), self.netlog.clone());
        unsafe { self.inner.initialize_native(settings, &mut logged) }
    }
    unsafe fn shutdown_native(&mut self) -> std::result::Result<(), BootstrapError> {
        unsafe { self.inner.shutdown_native() }
    }
}

struct Pending {
    socket_id: u64,
    evidence: NativeTlsEvidence,
    completion: NativeTlsCompletion,
    since: Instant,
}

// Fixture observations only: no callback strings or credential values enter
// this bounded, closed vocabulary. Times share one monotonic case-local clock.
const LOGIN_DIAGNOSTIC_LIMIT: usize = 256;
#[derive(Clone, Copy)]
enum LoginPhase {
    CaseCreated,
    MainDocument,
    FeaturesReady,
    NavigationDispatched,
    StaticCompleted,
    IdentifierNavigationDispatched,
    GrantChecked,
    GrantCreated,
}
impl LoginPhase {
    fn label(self) -> &'static str {
        match self {
            Self::CaseCreated => "case-created",
            Self::MainDocument => "main-document",
            Self::FeaturesReady => "features-ready",
            Self::NavigationDispatched => "navigation-dispatched",
            Self::StaticCompleted => "static-completed",
            Self::IdentifierNavigationDispatched => "identifier-navigation-dispatched",
            Self::GrantChecked => "grant-checked",
            Self::GrantCreated => "grant-created",
        }
    }
}
struct LoginDiagnostics {
    started: Instant,
    rows: Vec<(u64, &'static str, Option<&'static str>)>,
    dropped: usize,
}
impl LoginDiagnostics {
    fn new() -> Self {
        let mut value = Self {
            started: Instant::now(),
            rows: vec![],
            dropped: 0,
        };
        value.phase(LoginPhase::CaseCreated, None);
        value
    }
    fn record(&mut self, event: &'static str, stage: Option<&'static str>) {
        if self.rows.len() == LOGIN_DIAGNOSTIC_LIMIT {
            self.dropped = self.dropped.saturating_add(1);
            return;
        }
        self.rows.push((
            self.started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            event,
            stage,
        ));
    }
    fn phase(&mut self, phase: LoginPhase, stage: Option<NativeLoginStage>) {
        let stage = stage.map(|stage| match stage {
            NativeLoginStage::Form => "form",
            NativeLoginStage::FormPrepare => "form-prepare",
            NativeLoginStage::FormSubmit => "form-submit",
            NativeLoginStage::Identifier => "identifier",
            NativeLoginStage::IdentifierSubmit => "identifier-submit",
            NativeLoginStage::Password => "password",
            NativeLoginStage::PasswordSubmit => "password-submit",
            NativeLoginStage::BoundPassword => "bound-password",
            NativeLoginStage::ScmConsent => "scm-consent",
        });
        self.record(phase.label(), stage);
    }
    fn feature(&mut self, status: NativeFeatureStatus) {
        use NativeFeatureStatus as Feature;
        use NativeLoginDeliveryStatus as Delivery;
        let label = match status {
            Feature::RendererInstalled => "renderer-installed",
            Feature::RendererInstallationFailed => "renderer-installation-failed",
            Feature::LoginFormDetected => "login-form-detected",
            Feature::LoginAdapterCompleted => "login-adapter-completed",
            Feature::LoginAdapterRejected => "login-adapter-rejected",
            Feature::LoginDelivery(status) => match status {
                Delivery::NativeNotDelivered => "native-not-delivered",
                Delivery::NativeRejectedCurrent => "native-rejected-current",
                Delivery::NativeRejectedNavigation => "native-rejected-navigation",
                Delivery::NativeRejectedGrant => "native-rejected-grant",
                Delivery::NativeMessageFailed => "native-message-failed",
                Delivery::NativeSent => "native-sent",
                Delivery::RendererReceived => "renderer-received",
                Delivery::RendererRejectedFrame => "renderer-rejected-frame",
                Delivery::RendererRejectedPayload => "renderer-rejected-payload",
                Delivery::RendererRejectedDocument => "renderer-rejected-document",
                Delivery::RendererRejectedContext => "renderer-rejected-context",
                Delivery::RendererExecuting => "renderer-executing",
                Delivery::RendererAccepted => "renderer-accepted",
                Delivery::RendererRejected => "renderer-rejected",
                Delivery::RendererMissingDocument => "renderer-missing-document",
                Delivery::RendererNonceMismatch => "renderer-nonce-mismatch",
                Delivery::RendererOriginMismatch => "renderer-origin-mismatch",
                Delivery::RendererStageNotRequested => "renderer-stage-not-requested",
                Delivery::RendererStageNotAllowed => "renderer-stage-not-allowed",
                Delivery::RendererReplay => "renderer-replay",
            },
            _ => "other-feature",
        };
        self.record(label, None);
    }
    fn report(&self) -> serde_json::Value {
        serde_json::json!({"limit":LOGIN_DIAGNOSTIC_LIMIT,"dropped":self.dropped,
            "events":self.rows.iter().map(|(at,event,stage)|serde_json::json!({"elapsedMs":at,"event":event,"stage":stage})).collect::<Vec<_>>()})
    }
}
struct NonblockingLoginDiagnostics {
    buffer: Mutex<LoginDiagnostics>,
    contention_dropped: AtomicUsize,
}
impl NonblockingLoginDiagnostics {
    fn new() -> Self {
        Self {
            buffer: Mutex::new(LoginDiagnostics::new()),
            contention_dropped: AtomicUsize::new(0),
        }
    }
    fn record(&self, observe: impl FnOnce(&mut LoginDiagnostics)) {
        if let Ok(mut buffer) = self.buffer.try_lock() {
            observe(&mut buffer);
        } else {
            let _ = self.contention_dropped.fetch_update(
                Ordering::Relaxed,
                Ordering::Relaxed,
                |count| Some(count.saturating_add(1)),
            );
        }
    }
    fn phase(&self, phase: LoginPhase, stage: Option<NativeLoginStage>) {
        self.record(|buffer| buffer.phase(phase, stage));
    }
    fn feature(&self, status: NativeFeatureStatus) {
        self.record(|buffer| buffer.feature(status));
    }
    fn report(&self) -> serde_json::Value {
        let contention = self.contention_dropped.load(Ordering::Relaxed);
        match self.buffer.try_lock() {
            Ok(buffer) => {
                let mut report = buffer.report();
                report["contentionDropped"] = contention.into();
                report["dropped"] = buffer.dropped.saturating_add(contention).into();
                report["snapshotUnavailable"] = false.into();
                report
            }
            Err(_) => {
                serde_json::json!({"limit":LOGIN_DIAGNOSTIC_LIMIT,"events":[],"contentionDropped":contention,"snapshotUnavailable":true})
            }
        }
    }
}
struct State {
    name: &'static str,
    pending: Vec<Pending>,
    context_token: u64,
    challenges: usize,
    held_ms: u128,
    decisions: usize,
    ledger: Ledger,
    task_errors: usize,
    collector_drained: bool,
    overlap_peer_token: u64,
    predecessor_pending_at_successor: usize,
    route_dials: usize,
    http_requests: usize,
    pulse_requests: usize,
    revoked: bool,
    unexpected_route: bool,
    proxy_authorization_leaked: bool,
    sni_exact: bool,
    host_header_exact: bool,
    evidence_exact: bool,
    policy_mismatch: bool,
    stale_completion_attempted: bool,
    grants: Vec<String>,
    proof: Option<serde_json::Value>,
    initial_cookie_empty: Option<bool>,
    revoke_observed_ms: u128,
    first_decision: Option<Instant>,
    storage: Option<Arc<Mutex<storage::Evidence>>>,
    static_document: Option<Arc<Mutex<static_document::Evidence>>>,
    login_diagnostics: Arc<NonblockingLoginDiagnostics>,
}
impl State {
    fn new(name: &'static str) -> Self {
        Self {
            name,
            pending: vec![],
            context_token: 0,
            challenges: 0,
            held_ms: 0,
            decisions: 0,
            ledger: Ledger::default(),
            task_errors: 0,
            collector_drained: false,
            overlap_peer_token: 0,
            predecessor_pending_at_successor: 0,
            route_dials: 0,
            http_requests: 0,
            pulse_requests: 0,
            revoked: false,
            unexpected_route: false,
            proxy_authorization_leaked: false,
            sni_exact: true,
            host_header_exact: true,
            evidence_exact: true,
            policy_mismatch: false,
            stale_completion_attempted: false,
            grants: vec![],
            proof: None,
            initial_cookie_empty: None,
            revoke_observed_ms: 0,
            first_decision: None,
            storage: None,
            static_document: (name == "staged")
                .then(|| Arc::new(Mutex::new(static_document::Evidence::default()))),
            login_diagnostics: Arc::new(NonblockingLoginDiagnostics::new()),
        }
    }
    fn report(&self, installed: bool, closed: bool, rejected: bool) -> serde_json::Value {
        let sockets:Vec<_>=self.ledger.sockets.iter().map(|s|serde_json::json!({
            "id":s.id,"challenge":s.challenge.map(|(context,generation,challenge)|serde_json::json!({"context":context,"generation":generation,"id":challenge})),
            "decision":s.decision.label(),"tlsCompleted":s.tls_completed,"httpBytes":s.http_bytes,
            "httpBeforeAdmission":s.before_decision_bytes,"postRevokeBytes":s.post_revoke_bytes,
            "outcome":s.outcome.map(|o|o.label())})).collect();
        serde_json::json!({"name":self.name,"contextToken":self.context_token,"challenges":self.challenges,
            "heldMs":self.held_ms,"decisions":self.decisions,"allowDecisionsSubmitted":self.ledger.sockets.iter().filter(|s|s.decision==Decision::AllowSubmitted).count(),"routeDials":self.route_dials,
            "tlsHandshakes":self.ledger.sockets.iter().filter(|s|s.tls_completed).count(),"httpRequests":self.http_requests,"pulseRequests":self.pulse_requests,
            "httpBytes":self.ledger.sockets.iter().map(|s|s.http_bytes).sum::<usize>(),
            "httpBeforeAdmission":self.ledger.sockets.iter().map(|s|s.before_decision_bytes).sum::<usize>(),
            "postRevokeBytes":self.ledger.sockets.iter().map(|s|s.post_revoke_bytes).sum::<usize>(),
            "sockets":sockets,"correlation":"unique-leaf-der-per-accepted-socket",
            "correlationErrors":self.ledger.errors,"taskErrors":self.task_errors,"collectorDrained":self.collector_drained,
            "overlapPeerToken":self.overlap_peer_token,"predecessorPendingAtSuccessor":self.predecessor_pending_at_successor,
            "unexpectedRoute":self.unexpected_route,"proxyAuthorizationLeaked":self.proxy_authorization_leaked,
            "sniExact":self.sni_exact,"hostHeaderExact":self.host_header_exact,"evidenceExact":self.evidence_exact,
            "policyMismatch":self.policy_mismatch,"staleCompletionAttempted":self.stale_completion_attempted,
            "initialCookieEmpty":self.initial_cookie_empty,"revokeObservedMs":self.revoke_observed_ms,
            "grants":self.grants,"proof":self.proof,"tlsInstalled":installed,"closed":closed,"revokedNavigationRejected":rejected,
            "staticDocument":self.static_document.as_ref().map(|e|e.lock().unwrap().report()),
            "loginDiagnostics":self.login_diagnostics.report()})
    }
}
struct Hooks {
    state: Arc<Mutex<State>>,
    identity: BrowserIdentity,
    current: AtomicBool,
}
// Storage keeps the original Hooks type/behavior. Only the main TLS cases opt
// into observations, whose callbacks never acquire that control State mutex.
struct LoginDiagnosticHooks {
    inner: Arc<Hooks>,
    diagnostics: Arc<NonblockingLoginDiagnostics>,
}
impl NativeDocumentHooks for LoginDiagnosticHooks {
    fn on_main_document(&self, identity: &BrowserIdentity, _: u64) {
        if identity == &self.inner.identity && self.inner.current.load(Ordering::Acquire) {
            self.diagnostics.phase(LoginPhase::MainDocument, None);
        }
    }
    fn on_feature_status(&self, identity: &BrowserIdentity, _: &str, status: NativeFeatureStatus) {
        if identity == &self.inner.identity && self.inner.current.load(Ordering::Acquire) {
            self.diagnostics.feature(status);
        }
    }
    fn login_adapter(&self) -> NativeLoginAdapter {
        self.inner.login_adapter()
    }
    fn with_auto_login(
        &self,
        request: &NativeLoginRequest<'_>,
        deliver: &mut dyn FnMut(NativeLoginCredentials<'_>),
    ) {
        if request.identity == &self.inner.identity && self.inner.current.load(Ordering::Acquire) {
            self.diagnostics
                .phase(LoginPhase::GrantChecked, Some(request.stage));
        }
        self.inner.with_auto_login(request, &mut |credentials| {
            self.diagnostics
                .phase(LoginPhase::GrantCreated, Some(request.stage));
            deliver(credentials);
        });
    }
}
impl NativeTlsHooks for Hooks {
    fn on_evidence(&self, evidence: NativeTlsEvidence, completion: NativeTlsCompletion) {
        let mut s = self.state.lock().unwrap();
        s.challenges += 1;
        if s.context_token == 0 {
            s.context_token = evidence.context_token;
        }
        s.evidence_exact &= s.context_token == evidence.context_token && evidence.generation > 0;
        let socket_id = evidence.peer_chain.first().and_then(|leaf| {
            s.ledger.bind(
                leaf,
                (
                    evidence.context_token,
                    evidence.generation,
                    evidence.challenge,
                ),
            )
        });
        let Some(socket_id) = socket_id else {
            s.evidence_exact = false;
            return;
        };
        if s.pending.len() < 32 {
            s.pending.push(Pending {
                socket_id,
                evidence,
                completion,
                since: Instant::now(),
            });
        } else {
            s.evidence_exact = false;
        } // dropped completion denies the overflow
    }
    fn is_current(&self) -> bool {
        self.current.load(Ordering::Acquire)
    }
    fn on_failure(&self) {
        self.current.store(false, Ordering::Release);
    }
}
impl BrowserEventSink for Hooks {
    fn on_event(&self, event: BrowserEvent) {
        if event.identity != self.identity || !self.current.load(Ordering::Acquire) {
            return;
        }
        if let Some(evidence) = &self.state.lock().unwrap().static_document {
            evidence.lock().unwrap().observe(&event);
        }
    }
}
impl NativeDocumentHooks for Hooks {
    fn on_main_document(&self, _: &BrowserIdentity, _: u64) {}
    fn login_adapter(&self) -> NativeLoginAdapter {
        let state = self.state.lock().unwrap();
        if state.name == "manual" || state.storage.is_some() {
            NativeLoginAdapter::Manual
        } else {
            NativeLoginAdapter::Google
        }
    }
    fn with_auto_login(
        &self,
        request: &NativeLoginRequest<'_>,
        deliver: &mut dyn FnMut(NativeLoginCredentials<'_>),
    ) {
        if !self.current.load(Ordering::Acquire)
            || request.identity != &self.identity
            || request.origin != ORIGIN
        {
            return;
        }
        let mut s = self.state.lock().unwrap();
        if !["staged", "successor"].contains(&s.name) || s.revoked {
            return;
        }
        s.grants.push(format!("{:?}", request.stage));
        drop(s);
        deliver(NativeLoginCredentials {
            identity: &self.identity,
            origin: ORIGIN,
            valid_until: Instant::now() + Duration::from_secs(2),
            username: "synthetic@example.test",
            password: "synthetic-local-only",
            auto_submit: true,
        });
    }
}

fn decide(
    state: &Arc<Mutex<State>>,
    cert: &fixture::Certificates,
    session: &Arc<Mutex<OriginBrowserSession>>,
    identity: &BrowserIdentity,
) -> Result {
    let mut s = state.lock().unwrap();
    let mut pending = Vec::new();
    for item in std::mem::take(&mut s.pending) {
        if item.since.elapsed() < Duration::from_millis(350) {
            pending.push(item);
            continue;
        }
        let ms = item.since.elapsed().as_millis();
        s.held_ms = if s.held_ms == 0 {
            ms
        } else {
            s.held_ms.min(ms)
        };
        let e = &item.evidence;
        let exact = e.hostname == "accounts.google.com"
            && e.port == 443
            && e.origin == ORIGIN
            && s.ledger.sockets.iter().any(|socket| {
                socket.id == item.socket_id
                    && socket.challenge == Some((e.context_token, e.generation, e.challenge))
            })
            && e.ca_mode == NativeTlsCaMode::CustomOnly
            && e.native_error == 0
            && e.certificate_status == 0
            && !e.fatal_error;
        s.evidence_exact &= exact;
        let policy_match = match s.name {
            "wrong-host" => e.hostname == "other.fixture.test",
            "wrong-port" => e.port == 444,
            "wrong-certificate" => e.peer_chain.first() == Some(&cert.decoy),
            _ => true,
        };
        s.policy_mismatch |= !policy_match;
        s.decisions += 1;
        s.first_decision.get_or_insert_with(Instant::now);
        if s.name == "revoke-pending" {
            // Queue an otherwise valid answer AFTER synchronous owner revocation.
            // The bridge must reject that stale completion and emit no HTTP.
            session.lock().unwrap().revoke(identity)?;
            s.revoked = true;
            s.stale_completion_attempted = true;
            s.ledger.decide(item.socket_id, Decision::StaleAttempt);
            item.completion.complete(NativeTlsDecision::AdmitNative);
        } else if s.name == "cancel" {
            s.ledger.decide(item.socket_id, Decision::Cancel);
            drop(item.completion);
        } else if !exact || !policy_match || s.name == "reject" || s.revoked {
            s.ledger.decide(item.socket_id, Decision::Deny);
            item.completion.complete(NativeTlsDecision::Deny);
        } else {
            s.ledger.decide(item.socket_id, Decision::AllowSubmitted);
            item.completion.complete(NativeTlsDecision::AdmitNative);
        }
    }
    s.pending = pending;
    Ok(())
}

struct Predecessor {
    browser: CefBrowserHost<'static>,
    fixture: fixture::Fixture,
    session: Arc<Mutex<OriginBrowserSession>>,
    identity: BrowserIdentity,
    hooks: Arc<Hooks>,
    state: Arc<Mutex<State>>,
    installed: bool,
    revoked_at: Option<Instant>,
    close_sent: bool,
    closed: bool,
    navigation_rejected: bool,
}
impl Predecessor {
    fn advance(
        &mut self,
        successor: &Arc<Mutex<State>>,
        certificates: &fixture::Certificates,
    ) -> Result {
        if self.revoked_at.is_none() {
            let (token, successor_pending) = {
                let s = successor.lock().unwrap();
                (s.context_token, !s.pending.is_empty())
            };
            if token > 0 && successor_pending {
                let (old_token, count) = {
                    let s = self.state.lock().unwrap();
                    (s.context_token, s.pending.len())
                };
                if count == 0 || old_token == token {
                    return Err(
                        "overlap requires distinct live contexts and pending predecessor".into(),
                    );
                }
                {
                    let mut s = self.state.lock().unwrap();
                    s.overlap_peer_token = token;
                    s.predecessor_pending_at_successor = count;
                }
                {
                    let mut s = successor.lock().unwrap();
                    s.overlap_peer_token = old_token;
                    s.predecessor_pending_at_successor = count;
                }
                // The successor has now produced real native evidence while
                // predecessor completions and its browser are still retained.
                decide(&self.state, certificates, &self.session, &self.identity)?;
                self.hooks.current.store(false, Ordering::Release);
                self.navigation_rejected = self
                    .browser
                    .navigate(&self.identity, &format!("{ORIGIN}/pulse"))
                    .is_err();
                self.revoked_at = Some(Instant::now());
            }
        }
        if let Some(at) = self.revoked_at {
            decide(&self.state, certificates, &self.session, &self.identity)?;
            if at.elapsed() >= Duration::from_millis(750) {
                if !self.close_sent {
                    if self.browser.lifecycle() != Lifecycle::Closed {
                        self.browser.close(&self.identity)?;
                    }
                    self.close_sent = true;
                }
                if self.browser.lifecycle() == Lifecycle::Closed {
                    self.closed = true;
                    self.state.lock().unwrap().revoke_observed_ms = at.elapsed().as_millis();
                }
            }
        }
        Ok(())
    }
}

pub fn run(bootstrap: &mut dyn RuntimeBootstrap, paths: &BundlePaths) -> i32 {
    match execute(bootstrap, paths) {
        Ok(()) => 0,
        Err(error) => {
            if let Some(dir) = std::env::var_os("SORNG_CEF_ACCEPTANCE_OUTPUT") {
                let _ = std::fs::write(PathBuf::from(dir).join("error.txt"), error.to_string());
            }
            eprintln!("native TLS fixture: {error}");
            1
        }
    }
}
fn execute(bootstrap: &mut dyn RuntimeBootstrap, paths: &BundlePaths) -> Result {
    let output = PathBuf::from(
        std::env::var_os("SORNG_CEF_ACCEPTANCE_OUTPUT").ok_or("disposable output required")?,
    );
    let run_id = std::env::var("SORNG_CEF_ACCEPTANCE_RUN_ID")?;
    let manual_requested = std::env::var("SORNG_CEF_TLS_MANUAL").as_deref() == Ok("true");
    if !output.is_absolute()
        || !output.is_dir()
        || std::fs::read_dir(&output)?.next().is_some()
        || run_id.is_empty()
    {
        return Err("fresh absolute output and run ID required".into());
    }
    let asynchronous = tokio::runtime::Runtime::new()?;
    let _entered = asynchronous.enter();
    let certificates = Arc::new(fixture::Certificates::generate()?);
    let mut provider = LoggingBootstrap {
        inner: bootstrap,
        netlog: output.join("netlog.json").to_string_lossy().into(),
    };
    let mut events = EventLoop::new();
    let parent = Arc::new(
        WindowBuilder::new()
            .with_title("Local patched CEF TLS fixture")
            .with_visible(manual_requested)
            .with_inner_size(tao::dpi::LogicalSize::new(800., 600.))
            .build(&events)?,
    );
    // Unattended Windows fixtures show only their attested non-input private
    // parent without activation, matching selected-tab presentation.
    #[cfg(target_os = "windows")]
    let private_parent_visibility = if manual_requested {
        None
    } else {
        Some(private_parent::show(&parent)?)
    };
    #[cfg(not(target_os = "windows"))]
    let private_parent_visibility: Option<serde_json::Value> = None;
    let mut settings = cef_runtime::native_settings(&paths.helper, &paths.resources)?;
    settings.root_cache_path =
        CefString::from(output.join("profile").to_str().ok_or("profile path")?);
    settings.log_file = CefString::from(output.join("cef.log").to_str().ok_or("log path")?);
    let proxy = events.create_proxy();
    let runtime = unsafe {
        CefRuntime::initialize(
            &mut provider,
            &settings,
            Arc::new(move || {
                proxy
                    .send_event(())
                    .map_err(|_| cef_runtime::WakeUnavailable)
            }),
            Arc::new(|_| {}),
        )?
    };
    let mut report = serde_json::json!({"schema":2,"engine":"cef","bindingPin":"154.3.0","evidenceKind":"native-cef-local-fixture",
        "patchId":null,"runId":run_id,"platform":std::env::consts::OS,"productionReady":false,"publicProviderAcceptance":false,
        "loadedBridgeVerified":false,"securitySwitchesClean":false,"networkPolicyConfigured":false,"shutdownComplete":false,"cases":[],"failures":[],
        "manualRequested":manual_requested,"manualStatus":if manual_requested {"pending"} else {"not-run"},
        "storageIsolation":{"status":"not-run"},
        "remainingGates":["OS socket/DNS containment","native first paint","public provider acceptance","other platform runtime","app trust authority integration","AIA/OCSP/CRL runtime","HTTP keep-alive runtime"]});
    if let Some(evidence) = private_parent_visibility {
        report["privateParentVisibility"] = evidence;
    }
    let mut failures: Vec<String> = vec![];
    let bridge = unsafe { NativeTlsBridge::from_loaded_supported() };
    let bridge = match bridge {
        Ok(b) => b,
        Err(e) => {
            failures.push(e.to_string());
            unsafe {
                runtime.shutdown()?;
                cef_tls_bridge::after_cef_shutdown();
                registry_retirement_fixture::after_shutdown();
            }
            report["shutdownComplete"] = true.into();
            report["failures"] = serde_json::json!(failures);
            std::fs::write(
                output.join("native-report.json"),
                serde_json::to_vec_pretty(&report)?,
            )?;
            return Err("loaded engine lacks frozen V2 ABI; stock CEF cannot run this gate".into());
        }
    };
    report["loadedBridgeVerified"] = true.into();
    report["patchId"] = bridge.patch_id().into();
    let security = command_line_get_global().is_some_and(|command| {
        [
            "no-sandbox",
            "disable-web-security",
            "ignore-certificate-errors",
            "ignore-certificate-errors-spki-list",
            "allow-insecure-localhost",
            "disable-site-isolation-trials",
            "user-agent",
        ]
        .iter()
        .all(|s| command.has_switch(Some(&CefString::from(*s))) == 0)
    });
    report["securitySwitchesClean"] = security.into();
    if !security {
        failures.push("forbidden native command-line override".into());
    }
    if !bridge.supports_custom_ca() {
        failures.push("loaded bridge lacks custom CA support".into());
    }
    if failures.is_empty() {
        let mut predecessor: Option<Predecessor> = None;
        for &name in CASES {
            if name == "manual" && !manual_requested {
                continue;
            }
            let state = Arc::new(Mutex::new(State::new(name)));
            let fixture = asynchronous
                .block_on(fixture::Fixture::start(certificates.clone(), state.clone()))?;
            let address = fixture.address;
            let dial_state = state.clone();
            let dialer: Arc<dyn RouteDialer> =
                Arc::new(move |authority: Authority| -> DialFuture {
                    let state = dial_state.clone();
                    Box::pin(async move {
                        {
                            let mut s = state.lock().unwrap();
                            s.route_dials += 1;
                            if authority.host() != "accounts.google.com" || authority.port() != 443
                            {
                                s.unexpected_route = true;
                                return Err(std::io::Error::other("fixture-only route"));
                            }
                        }
                        Ok(Box::new(tokio::net::TcpStream::connect(address).await?) as BoxedStream)
                    })
                });
            let policy = OriginBrowserPolicy::new_with_allowed_origins(
                "tls-fixture",
                if ["revoke-pending", "successor"].contains(&name) {
                    "overlap"
                } else {
                    name
                },
                if ["revoke-pending", "successor"].contains(&name) {
                    "overlap"
                } else {
                    name
                },
                ORIGIN,
                &[],
            )?;
            let identity = policy.identity().clone();
            let session = Arc::new(Mutex::new(asynchronous.block_on(
                OriginBrowserSession::start(policy, dialer, ProxyLimits::default()),
            )?));
            let hooks = Arc::new(Hooks {
                state: state.clone(),
                identity: identity.clone(),
                current: AtomicBool::new(true),
            });
            let diagnostics = state.lock().unwrap().login_diagnostics.clone();
            let login_hooks = Arc::new(LoginDiagnosticHooks {
                inner: hooks.clone(),
                diagnostics: diagnostics.clone(),
            });
            let defaults = [
                "navigation",
                "frame",
                "script",
                "stylesheet",
                "image-media",
                "font",
                "fetch-xhr",
                "websocket",
            ]
            .into_iter()
            .filter_map(|s| {
                WebsiteRequestClass::parse(s).map(|c| (c, WebsitePermissionDecision::Allow))
            })
            .collect();
            let permissions = Arc::new(WebsitePermissionEngine::new(None, None, &defaults)?);
            let config = NativeTlsConfig {
                ca_mode: NativeTlsCaMode::CustomOnly,
                trust_anchors: vec![certificates.root.clone()],
                require_scoped_exceptions: false,
            };
            let mut context: Option<PrivateRequestContext> = None;
            let mut browser: Option<CefBrowserHost<'static>> = None;
            let mut installed = false;
            let mut navigated = false;
            let mut static_probe: Option<static_document::Probe> = None;
            let mut static_completed = false;
            let mut closing: Option<Instant> = None;
            let mut close_sent = false;
            let mut closed = false;
            let mut revoked_rejected = false;
            let began = Instant::now();
            let deadline = match name {
                "manual" => 120,
                "staged" => 40,
                _ => 20,
            };
            let mut case_error = None;
            let mut parked = false;
            events.run_return(|event, _, flow| {
                *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(5));
                if !matches!(event, Event::MainEventsCleared) {
                    return;
                }
                let step = (|| -> Result {
                    runtime.work()?;
                    cef_tls_bridge::pump_tls()?;
                    if let Some(old) = predecessor.as_mut() {
                        old.advance(&state, &certificates)?;
                        cef_tls_bridge::pump_tls()?;
                    }
                    if context.is_none()
                        && browser.is_none()
                        && closing.is_none()
                        && runtime.network_policy_configured()?
                    {
                        report["networkPolicyConfigured"] = true.into();
                        context = Some(unsafe {
                            PrivateRequestContext::create_with_tls(
                                session.clone(),
                                identity.clone(),
                                permissions.clone(),
                                &bridge,
                                &config,
                                hooks.clone(),
                            )?
                        });
                    }
                    if let Some(c) = &context {
                        if matches!(
                            c.status(),
                            PreparationStatus::Failed(_) | PreparationStatus::Revoked
                        ) {
                            return Err("native TLS context preparation failed".into());
                        }
                        if c.status() == PreparationStatus::ProxyConfigured {
                            installed = c.tls_hooks_installed();
                            if !installed {
                                return Err("native TLS installation unacknowledged".into());
                            }
                            browser = Some(unsafe {
                                CefBrowserHost::create_owned_engineering_probe(
                                    parent.clone(),
                                    context.take().unwrap(),
                                    session.clone(),
                                    identity.clone(),
                                    ViewportBounds::new(0., 0., 800., 600.)?,
                                    parent.scale_factor(),
                                    hooks.clone(),
                                    Some(login_hooks.clone()),
                                )?
                            });
                        }
                    }
                    if let Some(browser) = &browser {
                        if !navigated && closing.is_none() && browser.features_ready(&identity)? {
                            diagnostics.phase(LoginPhase::FeaturesReady, None);
                            // Attempt-local readiness follows actual engine installation,
                            // proxy readback, browser creation and renderer acknowledgment.
                            // This does not modify the application's production Ready gate.
                            let mut owner = session.lock().unwrap();
                            let ready = NativeHostReadiness::Ready {
                                profile_key: owner.policy().profile_key().into(),
                                proxy_endpoint: owner.proxy_endpoint(),
                            };
                            owner.report_host(&identity, ready)?;
                            drop(owner);
                            // Match app startup: default zoom is applied while the
                            // attached view is still hidden, before first navigation.
                            // Requiring visibility here aborts every new app tab.
                            browser.zoom(&identity, 100.0)?;
                            browser.navigate(
                                &identity,
                                &format!(
                                    "{ORIGIN}{}",
                                    if name == "manual" {
                                        "/manual"
                                    } else if name == "staged" {
                                        static_document::PATH
                                    } else {
                                        "/v3/signin/identifier"
                                    }
                                ),
                            )?;
                            diagnostics.phase(LoginPhase::NavigationDispatched, None);
                            if let Some(evidence) = &state.lock().unwrap().static_document {
                                static_probe = Some(static_document::Probe::new(evidence.clone()));
                            }
                            // Production credential typing intentionally rejects
                            // Hidden views. Attach positive login cases like a
                            // selected tab. The unattended Windows parent is shown
                            // only on its attested non-input desktop without activation.
                            // Child show still requests no native focus.
                            if manual_requested || matches!(name, "staged" | "successor") {
                                browser.show(&identity)?;
                            }
                            if manual_requested {
                                browser.focus(&identity)?;
                            }
                            navigated = true;
                        }
                        if name == "revoke-pending" {
                            let pending = state
                                .lock()
                                .unwrap()
                                .pending
                                .iter()
                                .any(|p| p.since.elapsed() >= Duration::from_millis(350));
                            if pending {
                                parked = true;
                                *flow = ControlFlow::Exit;
                                return Ok(());
                            }
                        } else {
                            decide(&state, &certificates, &session, &identity)?;
                        }
                        cef_tls_bridge::pump_tls()?;
                        if closing.is_none() && !static_completed {
                            if let Some(probe) = static_probe.as_mut().filter(|p| !p.failed()) {
                                match probe.advance(browser, &identity) {
                                    Ok(true) => {
                                        static_completed = true;
                                        diagnostics.phase(LoginPhase::StaticCompleted, None);
                                        browser.navigate(
                                            &identity,
                                            &format!("{ORIGIN}/v3/signin/identifier"),
                                        )?;
                                        diagnostics.phase(
                                            LoginPhase::IdentifierNavigationDispatched,
                                            None,
                                        );
                                    }
                                    Ok(false) => {}
                                    Err(error) => {
                                        failures.push(format!("{name}: {error}"));
                                        probe.fail(error.to_string());
                                    }
                                }
                            }
                        }
                        let positive = ["manual", "staged", "successor"].contains(&name);
                        let done = {
                            let s = state.lock().unwrap();
                            if static_probe.as_ref().is_some_and(|p| p.failed()) {
                                true // Failure still follows the normal revoke/close/drain path.
                            } else if positive {
                                s.proof.is_some() && s.pulse_requests > 0
                            } else {
                                s.first_decision
                                    .is_some_and(|t| t.elapsed() > Duration::from_millis(750))
                            }
                        };
                        if closing.is_none()
                            && (done || began.elapsed() > Duration::from_secs(deadline))
                        {
                            if !done {
                                failures.push(format!("{name}: completion deadline"));
                            }
                            {
                                let mut s = state.lock().unwrap();
                                s.revoked = true;
                                session.lock().unwrap().revoke(&identity)?;
                            }
                            hooks.current.store(false, Ordering::Release);
                            revoked_rejected = browser
                                .navigate(&identity, &format!("{ORIGIN}/pulse"))
                                .is_err();
                            cef_tls_bridge::pump_tls()?;
                            closing = Some(Instant::now());
                        }
                        if closing.is_some_and(|t| t.elapsed() > Duration::from_millis(750))
                            && !close_sent
                        {
                            if browser.lifecycle() != Lifecycle::Closed {
                                browser.close(&identity)?;
                            }
                            close_sent = true;
                        }
                        if browser.lifecycle() == Lifecycle::Closed
                            && close_sent
                            && predecessor.as_ref().is_none_or(|old| old.closed)
                        {
                            state.lock().unwrap().revoke_observed_ms =
                                closing.unwrap().elapsed().as_millis();
                            closed = true;
                            *flow = ControlFlow::Exit;
                        }
                    }
                    if began.elapsed() > Duration::from_secs(deadline + 5) {
                        return Err("native lifecycle deadline".into());
                    }
                    Ok(())
                })();
                if let Err(error) = step {
                    case_error = Some(error.to_string());
                    *flow = ControlFlow::Exit;
                }
            });
            if let Some(error) = case_error {
                failures.push(format!("{name}: {error}"));
            }
            if name == "manual" {
                report["manualStatus"] = if closed && state.lock().unwrap().proof.is_some() {
                    "observed"
                } else {
                    "failed"
                }
                .into();
            }
            if parked {
                predecessor = Some(Predecessor {
                    browser: browser.take().unwrap(),
                    fixture,
                    session,
                    identity,
                    hooks,
                    state,
                    installed,
                    revoked_at: None,
                    close_sent: false,
                    closed: false,
                    navigation_rejected: false,
                });
                continue;
            }
            if (!closed && browser.is_some()) || predecessor.as_ref().is_some_and(|old| !old.closed)
            {
                report["cases"]
                    .as_array_mut()
                    .unwrap()
                    .push(
                        state
                            .lock()
                            .unwrap()
                            .report(installed, closed, revoked_rejected),
                    );
                if let Some(old) = &predecessor {
                    report["cases"]
                        .as_array_mut()
                        .unwrap()
                        .push(old.state.lock().unwrap().report(
                            old.installed,
                            old.closed,
                            old.navigation_rejected,
                        ));
                }
                report["failures"] = serde_json::json!(failures);
                std::fs::write(
                    output.join("native-report.json"),
                    serde_json::to_vec_pretty(&report)?,
                )?;
                std::process::exit(3);
            }
            drop(browser);
            drop(context);
            drop(hooks);
            cef_tls_bridge::pump_tls()?;
            asynchronous.block_on(session.lock().unwrap().stop())?;
            asynchronous.block_on(fixture.stop())?;
            if let Some(old) = predecessor.take() {
                drop(old.browser);
                drop(old.hooks);
                cef_tls_bridge::pump_tls()?;
                asynchronous.block_on(old.session.lock().unwrap().stop())?;
                asynchronous.block_on(old.fixture.stop())?;
                report["cases"]
                    .as_array_mut()
                    .unwrap()
                    .push(old.state.lock().unwrap().report(
                        old.installed,
                        old.closed,
                        old.navigation_rejected,
                    ));
            }
            report["cases"]
                .as_array_mut()
                .unwrap()
                .push(
                    state
                        .lock()
                        .unwrap()
                        .report(installed, closed, revoked_rejected),
                );
            report["failures"] = serde_json::json!(failures);
            std::fs::write(
                output.join("native-progress.json"),
                serde_json::to_vec_pretty(&report)?,
            )?;
            if !closed {
                break;
            }
        }
        // Additional same-origin probes use the same loaded TLS bridge, custom
        // CA validation and per-socket ledger as the cases above. No SPKI bypass.
        if failures.is_empty() {
            let isolation = storage::run(
                &runtime,
                &bridge,
                certificates.clone(),
                &asynchronous,
                &mut events,
                parent.clone(),
                &output,
                &run_id,
            );
            match isolation {
                Ok(isolation) => {
                    if isolation["status"] != "completed" {
                        failures.push("same-origin storage isolation probe failed".into());
                    }
                    report["storageIsolation"] = isolation;
                }
                Err(error) => {
                    // storage::run never returns with live native owners. Even
                    // checkpoint I/O failure must still reach ordered shutdown.
                    failures.push(format!("storage probe reporting failed: {error}"));
                    report["storageIsolation"] = serde_json::json!({"status":"failed"});
                }
            }
        }
    }
    if let Some(retirement) = registration_retirement_for_revision(bridge.patch_id(), || {
        registry_retirement_fixture::run(
            &mut || registry_retirement_fixture::pump(&runtime, &mut events),
            &certificates.root,
        )
    }) {
        report["registrationRetirementCases"] = match retirement {
            Ok(value) => value,
            Err(error) => {
                failures.push(format!("registry-retirement: {error}"));
                serde_json::json!({"ok":false})
            }
        };
    }
    drop(bridge);
    unsafe {
        runtime.shutdown()?;
        cef_tls_bridge::after_cef_shutdown();
        registry_retirement_fixture::after_shutdown();
    }
    report["shutdownComplete"] = true.into();
    report["failures"] = serde_json::json!(failures);
    std::fs::write(
        output.join("native-report.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    if failures.is_empty() {
        Ok(())
    } else {
        Err("native fixture gates failed; inspect native-report.json".into())
    }
}

#[cfg(test)]
mod login_diagnostic_tests {
    use super::*;

    #[test]
    fn login_diagnostic_callback_does_not_wait_for_control_state() {
        let policy = OriginBrowserPolicy::new_with_allowed_origins(
            "diagnostic-owner",
            "diagnostic-connection",
            "diagnostic-session",
            ORIGIN,
            &[],
        )
        .unwrap();
        let state = Arc::new(Mutex::new(State::new("staged")));
        let diagnostics = state.lock().unwrap().login_diagnostics.clone();
        let hooks = Arc::new(LoginDiagnosticHooks {
            inner: Arc::new(Hooks {
                state: state.clone(),
                identity: policy.identity().clone(),
                current: AtomicBool::new(true),
            }),
            diagnostics: diagnostics.clone(),
        });
        let held = state.lock().unwrap();
        let (finished, received) = std::sync::mpsc::channel();
        let observing = hooks.clone();
        let worker = std::thread::spawn(move || {
            observing.on_feature_status(
                &observing.inner.identity,
                "ignored",
                NativeFeatureStatus::RendererInstalled,
            );
            observing.on_main_document(&observing.inner.identity, 0);
            finished.send(()).unwrap();
        });
        let completed_while_held = received.recv_timeout(Duration::from_millis(250)).is_ok();
        // A failing regression must still release and join its own worker.
        drop(held);
        worker.join().unwrap();
        assert!(
            completed_while_held,
            "diagnostic callback waited for control State"
        );

        let held = diagnostics.buffer.lock().unwrap();
        let (finished, received) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            hooks.on_feature_status(
                &hooks.inner.identity,
                "ignored",
                NativeFeatureStatus::RendererInstalled,
            );
            hooks.on_main_document(&hooks.inner.identity, 0);
            finished.send(()).unwrap();
        });
        let completed_while_held = received.recv_timeout(Duration::from_millis(250)).is_ok();
        drop(held);
        worker.join().unwrap();
        assert!(
            completed_while_held,
            "diagnostic callback waited for diagnostic buffer"
        );
        assert_eq!(diagnostics.report()["contentionDropped"], 2);
    }

    #[test]
    fn login_diagnostic_wrapper_preserves_grants_and_releases_all_guards_before_delivery() {
        let policy = OriginBrowserPolicy::new_with_allowed_origins(
            "owner",
            "connection",
            "session",
            ORIGIN,
            &[],
        )
        .unwrap();
        let state = Arc::new(Mutex::new(State::new("staged")));
        let diagnostics = state.lock().unwrap().login_diagnostics.clone();
        let hooks = LoginDiagnosticHooks {
            inner: Arc::new(Hooks {
                state: state.clone(),
                identity: policy.identity().clone(),
                current: AtomicBool::new(true),
            }),
            diagnostics: diagnostics.clone(),
        };
        assert_eq!(hooks.login_adapter(), NativeLoginAdapter::Google);
        let mut request = NativeLoginRequest {
            identity: policy.identity(),
            origin: ORIGIN,
            adapter: NativeLoginAdapter::Google,
            stage: NativeLoginStage::Identifier,
            path: "/v3/signin/identifier",
            frame: None,
        };
        let mut delivered = 0;
        hooks.with_auto_login(&request, &mut |credentials| {
            delivered += 1;
            assert!(state.try_lock().is_ok());
            assert!(diagnostics.buffer.try_lock().is_ok());
            assert_eq!(credentials.username, "synthetic@example.test");
            assert_eq!(credentials.password, "synthetic-local-only");
            assert!(credentials.valid_until > Instant::now());
            assert!(credentials.valid_until <= Instant::now() + Duration::from_secs(2));
            assert!(credentials.auto_submit);
        });
        assert_eq!(delivered, 1);
        let before = diagnostics.report()["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|row| row["event"] == "grant-created")
            .count();
        request.origin = "https://foreign.invalid";
        hooks.with_auto_login(&request, &mut |_| panic!("foreign origin grant"));
        let after = diagnostics.report()["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|row| row["event"] == "grant-created")
            .count();
        assert_eq!(before, after);
    }

    #[test]
    fn login_diagnostics_keep_ordered_monotonic_phases_and_are_bounded() {
        let mut diagnostics = LoginDiagnostics::new();
        diagnostics.phase(LoginPhase::StaticCompleted, None);
        diagnostics.phase(LoginPhase::IdentifierNavigationDispatched, None);
        diagnostics.phase(LoginPhase::GrantChecked, Some(NativeLoginStage::Identifier));
        diagnostics.phase(LoginPhase::GrantCreated, Some(NativeLoginStage::Identifier));
        let report = diagnostics.report();
        let events = report["events"].as_array().unwrap();
        assert_eq!(events[1]["event"], "static-completed");
        assert_eq!(events[2]["event"], "identifier-navigation-dispatched");
        assert_eq!(events[3]["stage"], "identifier");
        assert_eq!(events[4]["event"], "grant-created");
        assert!(events
            .windows(2)
            .all(|pair| pair[0]["elapsedMs"].as_u64().unwrap()
                <= pair[1]["elapsedMs"].as_u64().unwrap()));
        for _ in 0..LOGIN_DIAGNOSTIC_LIMIT {
            diagnostics.feature(NativeFeatureStatus::LoginDelivery(
                NativeLoginDeliveryStatus::RendererAccepted,
            ));
        }
        let bounded = diagnostics.report();
        assert_eq!(
            bounded["events"].as_array().unwrap().len(),
            LOGIN_DIAGNOSTIC_LIMIT
        );
        assert_eq!(bounded["dropped"], 5);
    }

    #[test]
    fn login_diagnostic_hook_discards_strings_and_foreign_or_revoked_callbacks() {
        let policy = OriginBrowserPolicy::new_with_allowed_origins(
            "diagnostic-owner",
            "diagnostic-connection",
            "diagnostic-session",
            ORIGIN,
            &[],
        )
        .unwrap();
        let foreign = OriginBrowserPolicy::new_with_allowed_origins(
            "foreign-owner",
            "foreign-connection",
            "foreign-session",
            ORIGIN,
            &[],
        )
        .unwrap();
        let state = Arc::new(Mutex::new(State::new("staged")));
        let diagnostics = state.lock().unwrap().login_diagnostics.clone();
        let hooks = LoginDiagnosticHooks {
            inner: Arc::new(Hooks {
                state: state.clone(),
                identity: policy.identity().clone(),
                current: AtomicBool::new(true),
            }),
            diagnostics: diagnostics.clone(),
        };
        let sentinel =
            "https://secret.invalid/path?password=PRIVATE_SENTINEL\ninput[value=PRIVATE_SENTINEL]";
        hooks.on_feature_status(
            policy.identity(),
            sentinel,
            NativeFeatureStatus::LoginDelivery(NativeLoginDeliveryStatus::RendererRejectedDocument),
        );
        hooks.on_feature_status(
            policy.identity(),
            sentinel,
            NativeFeatureStatus::LoginChallengeWaiting,
        );
        let before = diagnostics.report()["events"].as_array().unwrap().len();
        hooks.on_feature_status(
            foreign.identity(),
            sentinel,
            NativeFeatureStatus::LoginAdapterCompleted,
        );
        hooks.on_main_document(foreign.identity(), u64::MAX);
        hooks.inner.current.store(false, Ordering::Release);
        hooks.on_feature_status(
            policy.identity(),
            sentinel,
            NativeFeatureStatus::LoginAdapterCompleted,
        );
        hooks.on_main_document(policy.identity(), u64::MAX);
        assert_eq!(
            diagnostics.report()["events"].as_array().unwrap().len(),
            before
        );
        let report = diagnostics.report().to_string();
        assert!(report.contains("renderer-rejected-document"));
        assert!(report.contains("other-feature"));
        for private in [
            sentinel,
            "PRIVATE_SENTINEL",
            "secret.invalid",
            ORIGIN,
            "diagnostic-owner",
            "foreign-owner",
        ] {
            assert!(!report.contains(private));
        }
    }
}

#[cfg(test)]
mod retirement_revision_tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn current_retirement_revisions_run_once_and_preserve_results() {
        for revision in [cef_tls_bridge::PATCH_ID, cef_tls_bridge::HTTP3_PATCH_ID] {
            let calls = Cell::new(0);
            let result = registration_retirement_for_revision(revision, || {
                calls.set(calls.get() + 1);
                Ok(1025)
            })
            .expect("retirement evidence is mandatory")
            .unwrap();
            assert_eq!(result, 1025);
            assert_eq!(calls.get(), 1);
            let failure = registration_retirement_for_revision::<()>(revision, || {
                calls.set(calls.get() + 1);
                Err("controlled registry proof failure".into())
            })
            .expect("failure must be reported")
            .unwrap_err();
            assert_eq!(failure.to_string(), "controlled registry proof failure");
            assert_eq!(calls.get(), 2);
        }
    }

    #[test]
    fn legacy_skips_and_unknown_rejects_without_invoking_registry() {
        for revision in [
            cef_tls_bridge::LEGACY_PATCH_ID,
            cef_tls_bridge::HTTP2_PATCH_ID,
            cef_tls_bridge::PROXY_APPLIED_PATCH_ID,
        ] {
            assert!(
                registration_retirement_for_revision::<()>(revision, || panic!(
                    "legacy registry invocation"
                ))
                .is_none()
            );
        }
        for revision in ["", "sorng-tls-v2-682c378-6", "sorng-tls-v2-682c378-5-extra"] {
            let result = registration_retirement_for_revision::<()>(revision, || {
                panic!("unknown registry invocation")
            });
            assert_eq!(
                result.unwrap().unwrap_err().to_string(),
                "unsupported registry fixture bridge revision"
            );
        }
    }
}
