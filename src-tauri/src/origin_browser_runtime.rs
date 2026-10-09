//! UI-thread native browser registry. No CEF object crosses a thread boundary.
//! A packaged runtime must install itself before requests are admitted. Native
//! policy readback is required; compiling the `native-browser` flag alone is
//! insufficient. Operational admission is not a production acceptance claim.

use crate::origin_browser_startup_diagnostics::{
    self as diagnostics, Failure, Stage, TimingStage, Trace,
};
use sorng_browser_host::{
    cef_browser::{BrowserEvent, BrowserEventSink, BrowserFault, CefBrowserHost},
    cef_context::{PreparationStatus, PrivateRequestContext},
    cef_runtime::{CefRuntime, RuntimeError, ScheduleWake, WakeUnavailable},
    cef_session_retention::{RetentionPolicy, SignInCookie},
    cef_tls_bridge::{self, NativeTlsBridge, NativeTlsConfig, PATCH_ID},
    control::Lifecycle,
    ipc::*,
    native_automation::{
        NativeAutomationAction, NativeAutomationFailure, NativeAutomationPermissions,
        NativeAutomationReply,
    },
};
use sorng_browser_host::ipc::OriginBrowserRuntimeFailureCode as RuntimeFailureCode;
use sorng_commands_core::origin_browser_authority::{self, NativeOwnerLease};
use sorng_encryption::EncryptionState;
use sorng_protocols::{
    origin_browser::{BrowserIdentity, BrowserSessionFailure, BrowserSessionFailureState, NativeHostReadiness, OriginBrowserSession},
    private_forward_proxy::ProxyLimits,
};
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, WebviewWindow};

#[path = "origin_browser_login.rs"]
mod login;

#[path = "origin_browser_runtime_observability.rs"]
pub(crate) mod observability;

#[path = "origin_browser_media.rs"]
mod media;

#[path = "origin_browser_tls.rs"]
mod tls;
#[path = "origin_browser_certificate_review.rs"]
pub(crate) mod certificate_review;

#[path = "origin_browser_runtime_flow.rs"]
mod flow;
#[path = "origin_browser_runtime_failure.rs"]
pub(crate) mod runtime_failure;

#[path = "origin_browser_display.rs"]
mod display;
#[path = "origin_browser_find.rs"]
mod find;

#[path = "origin_browser_close.rs"]
mod close_ack;

#[path = "origin_browser_downloads.rs"]
mod downloads;
#[path = "origin_browser_popup_runtime.rs"]
pub(crate) mod popups;
#[path = "origin_browser_page_menu.rs"]
pub(crate) mod page_menu;
#[path = "origin_browser_manual_input.rs"]
pub(crate) mod manual_input;
#[path = "origin_browser_recording_runtime.rs"]
pub(crate) mod recording;
#[path = "origin_browser_appearance.rs"]
pub(crate) mod appearance;
#[path = "origin_browser_diagnostics_probe.rs"]
pub(crate) mod diagnostics_probe;
#[path = "origin_browser_retention.rs"]
mod retention;
#[path = "origin_browser_retention_flow.rs"]
mod retention_flow;

const UNAVAILABLE: &str =
    "The packaged real-origin browser is unavailable; no direct-network fallback was used.";
const TLS_UNAVAILABLE: &str = "The loaded CEF runtime does not provide the required app certificate-verifier bridge. Install or rebuild the patched browser runtime; the saved trust policy was not changed.";
const STALE: &str = "This website's database or browser session is no longer available. Reopen it from its owning database.";
const MAX_ATTEMPTS: usize = 64;
const STARTUP_LIMIT: Duration = Duration::from_secs(20);
const DATA_DIRECTORY_FAILED: &str = "Native browser working-data preparation failed. Review Settings > Web Browser and restart if the working folder changed; the owning database and retained cookies were not changed.";
const PACKAGE_FAILED: &str = "Native browser package or runtime settings could not be prepared. Check the native startup diagnostics before retrying.";
const STARTUP_TIMED_OUT: &str = "Native browser initialization or policy readiness timed out. Check the native startup diagnostics and restart the app.";
const STARTUP_FAILED: &str = "Native browser initialization or policy readiness failed. Check the native startup diagnostics and restart the app.";
const PROXY_FAILED: &str = "Native browser private proxy could not start. Reopen the tab and check the native startup diagnostics; no direct-network fallback was used.";
const CONTEXT_FAILED: &str = "Native browser private context preparation failed. Check the native startup diagnostics for proxy, certificate or storage setup; this is not a saved-password rejection.";
const COOKIE_RESTORE_FAILED: &str = "Native browser cookie restoration failed. Reopen the tab and check the native startup diagnostics; no other connection's cookies were used.";
const VIEW_FAILED: &str = "Native browser embedded view creation failed. Reopen the tab and check the native startup diagnostics; this is not a website login failure.";
const RENDERER_FAILED: &str = "Native browser renderer setup failed. Reopen the tab and check the native startup diagnostics; the website was not navigated.";
const ZOOM_FAILED: &str = "Native browser initial zoom setup failed. Reopen the tab and check the native startup diagnostics; the website was not navigated.";
const NAVIGATION_FAILED: &str = "Native browser first navigation failed. Review this connection's destination permissions and network route, and check the native startup diagnostics.";
const VIEW_TIMED_OUT: &str = "Native browser tab preparation timed out. Reopen the tab and check the native startup diagnostics; the database was not locked by this timeout.";

fn view_failure(failure: Failure, message: &'static str) -> String {
    diagnostics::record(Stage::ViewFailed, Some(failure));
    log::error!("Native browser stage=view-creation failure={failure:?}");
    message.to_owned()
}

struct Attempt {
    timing: Trace,
    navigation_submitted: AtomicBool,
    identity: BrowserIdentity,
    window: String,
    document: Arc<flow::ShellDocument>,
    lease: NativeOwnerLease,
    session: Arc<Mutex<OriginBrowserSession>>,
    failure: BrowserSessionFailureState,
    failure_reported: AtomicBool,
    permissions: Arc<sorng_browser_host::domain_permissions::WebsitePermissionEngine>,
    diagnostics_busy: AtomicBool,
    snapshot: Mutex<OriginBrowserSnapshot>,
    cancelled: AtomicBool,
    // Receipt for synchronous capability/relay revocation, not CEF close or
    // OS socket teardown. A second revoke caller must not infer it from cancelled.
    revocation_complete: AtomicBool,
    login: Arc<login::LoginHooks>,
    downloads: Arc<downloads::DownloadOwner>,
    automation: Arc<origin_browser_authority::NativeAutomationAuthority>,
    preferences: origin_browser_authority::NativeBrowserPreferences,
    // Cookie-disabled attempts never acquire a retention owner: they cannot
    // load, checkpoint, clear or overwrite dormant encrypted DB cookie data.
    retention: Option<Arc<retention::NativeCookieRetention>>,
    ordinary_close: AtomicBool,
    load_started: Mutex<Option<Instant>>,
    closed: close_ack::CloseSignal,
}

impl Attempt {
    fn current(&self) -> bool {
        !self.cancelled.load(Ordering::Acquire)
            && self.document.current()
            && self.lease.is_current()
    }

    fn revoke(&self) {
        self.revoke_inner(None);
    }

    fn revoke_for(&self, reason: BrowserSessionFailure) {
        self.revoke_inner(Some(reason));
    }

    fn revoke_inner(&self, reason: Option<BrowserSessionFailure>) {
        // Retain explicit evidence before publishing cancellation: cleanup can
        // synchronously or concurrently report a secondary TLS/context fault.
        if let Some(reason) = reason {
            self.failure.record_first(reason);
        }
        if self.cancelled.swap(true, Ordering::AcqRel) {
            // Cancellation is one-shot; diagnostic evidence is not. A generic
            // earlier revoke must not hide a later fixed native fault. This
            // never repeats cleanup, waits on session state, or grants access.
            self.report_failure();
            return;
        }
        // Inspect owner evidence before cleanup itself revokes the lease.
        // Explicit watchdog/runtime evidence is not a database-unlock failure.
        let reason = reason.or_else(|| BrowserSessionFailure::owner_loss(
            self.document.current(), self.lease.is_current(), self.lease.is_temporary(),
        ));
        if let Some(reason) = reason {
            self.failure.record_first(reason);
        }
        display::scrub_retained(&self.snapshot);
        self.timing.finish(0);
        self.login.revoke();
        self.downloads.revoke();
        recording::revoke(&self.identity);
        self.lease.revoke();
        if !self.ordinary_close.load(Ordering::Acquire) {
            if let Some(retention) = &self.retention {
                retention.invalidate();
                // Native revocation is immediate; bounded ciphertext cleanup can
                // happen off the UI thread. The separate owner fence prevents IO
                // callbacks from borrowing a different database's unlock session.
                let retention = retention.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = retention.revoke();
                });
            }
        }
        let mut session = self
            .session
            .lock()
            .unwrap_or_else(|e| {
                self.failure.record_first(BrowserSessionFailure::NativeState);
                e.into_inner()
            });
        let revoked = match reason {
            Some(reason) => session.revoke_for(&self.identity, reason),
            None => session.revoke(&self.identity),
        };
        drop(session);
        if revoked.is_ok() {
            // Never publish on unwind or before the exact session's relay has
            // received its revocation signal. Async retention cleanup may remain.
            self.revocation_complete.store(true, Ordering::Release);
        }
        self.report_failure();
    }

    fn report_failure(&self) {
        if let Some(reason) = self.failure.get() {
            if !self.failure_reported.swap(true, Ordering::AcqRel) {
                diagnostics::navigation(diagnostics::Navigation::SessionFailed { reason });
            }
        }
    }
}

#[derive(Default)]
struct SharedRegistry {
    documents: flow::ShellDocuments,
    startup: flow::StartupGate,
    prewarm: origin_browser_authority::prewarm::PrewarmGate,
    admission: flow::RuntimeAdmission,
    runtime_failure: runtime_failure::RuntimeFailureStore,
    certificate_hooks: AtomicBool,
    attempts: Mutex<HashMap<String, Arc<Attempt>>>,
    closed: Mutex<close_ack::CloseReceipts>,
    exit_requested: Mutex<Option<i32>>,
}

/// Captured by synchronous shell IPC admission, before Tauri queues the task.
/// This is native lifetime metadata, never a renderer-supplied authority token.
pub(crate) struct StartupDocument(Arc<flow::ShellDocument>);

pub(crate) fn capture_startup_document(label: &str) -> StartupDocument {
    StartupDocument(shared().documents.current(label))
}

fn shared() -> &'static SharedRegistry {
    static REGISTRY: OnceLock<SharedRegistry> = OnceLock::new();
    REGISTRY.get_or_init(SharedRegistry::default)
}

pub(crate) fn retention_available() -> bool {
    // This command describes compiled retention support for settings. Runtime
    // readiness is separately reported by status and enforced on every create.
    true
}

pub(crate) fn cancel_prewarm(label: &str) {
    if label == "main" {
        shared().prewarm.cancel();
    }
}

/// Best-effort engine startup only. No Attempt, private context, relay, browser,
/// cookie retention, URL navigation or login authority is created here.
pub(crate) async fn prewarm(
    window: WebviewWindow,
    state: &EncryptionState,
    request: origin_browser_authority::prewarm::PrewarmRequest,
    document: StartupDocument,
) -> Result<(), String> {
    let document = document.0;
    document
        .run(prewarm_document(window, state, request, &document))
        .await
        .ok_or_else(|| STALE.to_owned())?
}

async fn prewarm_document(
    window: WebviewWindow,
    state: &EncryptionState,
    request: origin_browser_authority::prewarm::PrewarmRequest,
    document: &Arc<flow::ShellDocument>,
) -> Result<(), String> {
    request.validate().map_err(|error| error.to_string())?;
    if window.label() != "main" {
        return Err(STALE.to_owned());
    }
    if !shared().prewarm.begin() {
        return Ok(());
    }
    let timing = Trace::startup(true);
    timing.mark(TimingStage::CommandValidated);
    let interrupted = flow::RevokeOnDrop::new(|| timing.finish(0));
    let _finish = flow::RevokeOnDrop::new(|| shared().prewarm.cancel());
    let owner = tokio::time::timeout(
        STARTUP_LIMIT,
        origin_browser_authority::prewarm::authorize(&window, state, &request),
    )
    .await
    .map_err(|_| STARTUP_TIMED_OUT.to_owned())?
    .map_err(|error| error.to_string())?;
    timing.mark(TimingStage::Authorized);
    ensure_runtime(
        &window,
        state,
        &owner.lease,
        Some((&shared().prewarm, &owner)),
        &timing,
        document,
    )
    .await?;
    timing.mark(TimingStage::CommandCompleted);
    timing.finish(1);
    interrupted.disarm();
    Ok(())
}

async fn recheck_startup(
    window: &WebviewWindow,
    state: &EncryptionState,
    lease: &NativeOwnerLease,
    prewarm: Option<(
        &origin_browser_authority::prewarm::PrewarmGate,
        &origin_browser_authority::prewarm::AuthorizedPrewarm,
    )>,
) -> Result<Option<origin_browser_authority::prewarm::SavedSettingsFence>, String> {
    if let Some((gate, owner)) = prewarm {
        if !gate.current() {
            return Err(STALE.to_owned());
        }
        let settings = origin_browser_authority::prewarm::recheck(window, state, owner)
            .await
            .map_err(|error| error.to_string())?;
        if !gate.current() {
            return Err(STALE.to_owned());
        }
        return Ok(Some(settings));
    } else {
        lease
            .recheck(window, state)
            .await
            .map_err(|_| STALE.to_owned())?;
    }
    Ok(None)
}

/// Called only after saved connection / native DB lease authorization. Neither
/// status nor a settings capability probe can prepare paths or initialize CEF.
async fn ensure_runtime(
    window: &WebviewWindow,
    state: &EncryptionState,
    lease: &NativeOwnerLease,
    prewarm: Option<(
        &'static origin_browser_authority::prewarm::PrewarmGate,
        &origin_browser_authority::prewarm::AuthorizedPrewarm,
    )>,
    timing: &Trace,
    document: &Arc<flow::ShellDocument>,
) -> Result<(), String> {
    timing.mark(TimingStage::RuntimeRequested);
    let deadline = Instant::now() + STARTUP_LIMIT;
    let startup_claim = Arc::new(flow::StartupClaim::default());
    // Dropping an in-flight command also cancels a queued native callback.
    let cancelled = flow::RevokeOnDrop::new(|| {
        cancel_startup(startup_claim.cancel_abandoned(document), Failure::Policy);
    });
    let prewarm_gate = prewarm.map(|(gate, _)| gate);
    let result = tokio::time::timeout(STARTUP_LIMIT, async {
        loop {
            if !document.current()
                || !lease.is_current()
                || prewarm_gate.is_some_and(|gate| !gate.current())
            {
                return Err(STALE.to_owned());
            }
            if shared().admission.revoked() {
                return Err(STARTUP_FAILED.to_owned());
            }
            if shared().admission.ready() {
                recheck_startup(window, state, lease, prewarm).await?;
                return if shared().certificate_hooks.load(Ordering::Acquire) {
                    Ok(())
                } else {
                    Err(TLS_UNAVAILABLE.to_owned())
                };
            }
            if let Some(permit) = shared().startup.prepare() {
                let runtime_failure = shared().runtime_failure.begin();
                timing.mark(TimingStage::PreflightEntered);
                recheck_startup(window, state, lease, prewarm).await?;
                // Engine-wide preferences are loaded only for first startup,
                // never from IPC or once per tab. Changes require app restart.
                let settings = crate::app_settings_commands::read_app_settings_inner(
                    lease.profile_root(),
                    state,
                )
                .await
                .map_err(|_| "Saved browser application settings could not be read.")?;
                let xslt_enabled = match settings
                    .as_ref()
                    .and_then(|s| s.pointer("/webBrowser/xsltEnabled"))
                {
                    None => true,
                    Some(serde_json::Value::Bool(enabled)) => *enabled,
                    _ => return Err("Native rejected settings.webBrowser.xsltEnabled: must be a boolean. Review Enable XSLT in Settings > Web Browser.".to_owned()),
                };
                let app = window.app_handle().clone();
                let prepared = tauri::async_runtime::spawn_blocking(move || {
                    // Preserve the native working-data fallback and root lock.
                    let alternatives = [app.path().app_cache_dir(), app.path().app_data_dir()]
                        .into_iter()
                        .filter_map(Result::ok)
                        .collect::<Vec<_>>();
                    app.path()
                        .app_local_data_dir()
                        .ok()
                        .or_else(|| alternatives.first().cloned())
                        .ok_or_else(|| DATA_DIRECTORY_FAILED.to_owned())
                        .and_then(|path| {
                            sorng_commands_core::browser_data_commands::prepare_for_startup(
                                &path,
                                &app.config().identifier,
                                &alternatives,
                            )
                        })
                })
                .await;
                let mut prepared = match prepared {
                    Ok(Ok(prepared)) => prepared,
                    _ => {
                        runtime_failure.record(RuntimeFailureCode::DataDirectory);
                        diagnostics::record(Stage::Failed, Some(Failure::DataDirectory));
                        log::error!(
                            "Native browser stage=preparing error=working-data-unavailable"
                        );
                        return Err(DATA_DIRECTORY_FAILED.to_owned());
                    }
                };
                let root = prepared.root().to_path_buf();
                timing.mark(TimingStage::DataPrepared);
                // Until native entry, cancellation drops the provisional root
                // lock, including a detached blocking worker's late result.
                // Disk work may race database lock, revision or unlock changes.
                let settings_fence = recheck_startup(window, state, lease, prewarm).await?;
                let queued_lease = lease.clone();
                let queued_document = document.clone();
                let queued_startup_claim = startup_claim.clone();
                let queued_timing = timing.clone();
                let app = window.app_handle().clone();
                let (sender, receiver) = tokio::sync::oneshot::channel();
                timing.mark(TimingStage::EngineUiQueued);
                window
                    .run_on_main_thread(move || {
                        queued_timing.mark(TimingStage::EngineUiEntered);
                        if sender.is_closed()
                            || !queued_document.current()
                            || Instant::now() >= deadline
                            || !queued_lease.is_current()
                            || prewarm_gate.is_some_and(|gate| !gate.current())
                            || settings_fence
                                .as_ref()
                                .is_some_and(|fence| !fence.with_current(|| true))
                            || shared().admission.revoked()
                        {
                            // Drop the permit without consuming the native provider.
                            drop(permit);
                            let _ = sender.send(Err(STALE.to_owned()));
                            return;
                        }
                        diagnostics::begin(&root);
                        diagnostics::record(Stage::Preparing, None);
                        let (wake, pump) = pump_channel();
                        let result = crate::origin_browser_entry::install(wake, &root, xslt_enabled, &queued_timing, runtime_failure, || {
                            let mut begin = || {
                                !sender.is_closed()
                                    && queued_document.current()
                                    && Instant::now() < deadline
                                    && queued_lease.is_current()
                                    && prewarm_gate.is_none_or(|gate| gate.current())
                                    && !shared().admission.revoked()
                                    && {
                                        // Linearize entry against cancellation. A cancelled
                                        // caller cannot claim; a claimed caller's cancellation
                                        // revokes pending admission even before begin_native.
                                        queued_startup_claim.claim_native()
                                            && permit.begin_native()
                                            && prepared.commit().map_err(|_| {
                                                runtime_failure.record(RuntimeFailureCode::DataDirectory);
                                            }).is_ok()
                                    }
                            };
                            match settings_fence.as_ref() {
                                Some(fence) => fence.with_current(begin),
                                None => begin(),
                            }
                        });
                        let result = match result {
                            Ok(()) => {
                                start_pump(app, pump);
                                if shared().certificate_hooks.load(Ordering::Acquire) {
                                    Ok(())
                                } else {
                                    diagnostics::record(Stage::Failed, Some(Failure::Policy));
                                    revoke_all();
                                    shared().runtime_failure.record_current(RuntimeFailureCode::CertificateBridge);
                                    Err(TLS_UNAVAILABLE.to_owned())
                                }
                            }
                            Err(error) => {
                                // EntryError retains the typed RuntimeError / BootstrapError.
                                // They contain only native fixed messages and numeric codes.
                                log::error!("Native browser stage=preparing error={error}");
                                diagnostics::record(Stage::Failed, Some(Failure::Package));
                                if shared().startup.started() {
                                    revoke_all();
                                }
                                Err(PACKAGE_FAILED.to_owned())
                            }
                        };
                        drop(permit);
                        let _ = sender.send(result);
                    })
                    .map_err(|_| {
                        runtime_failure.record(RuntimeFailureCode::UiDispatch);
                        PACKAGE_FAILED.to_owned()
                    })?;
                receiver.await.map_err(|_| {
                    runtime_failure.record(RuntimeFailureCode::UiDispatch);
                    STARTUP_FAILED.to_owned()
                })??;
            }
            // Concurrent authorized creates share the one startup and actual
            // policy readback. No ready response is inferred from installation.
            flow::wait_for_readiness(
                deadline.saturating_duration_since(Instant::now()),
                || {
                    if !document.current()
                        || !lease.is_current()
                        || prewarm_gate.is_some_and(|gate| !gate.current())
                    {
                        return Err(STALE.to_owned());
                    }
                    if shared().admission.revoked() {
                        return Err(STARTUP_FAILED.to_owned());
                    }
                    // A retryable preflight failure releases its permit. Let
                    // this independently authorized caller claim the next turn.
                    Ok(shared().admission.ready() || shared().startup.deferred())
                },
                || STARTUP_TIMED_OUT.to_owned(),
            )
            .await?;
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    let result = match result {
        Ok(Err(error)) if error == STARTUP_TIMED_OUT => {
            cancel_startup(startup_claim.cancel(), Failure::Timeout);
            Err(error)
        }
        Ok(result) => result,
        Err(_) => {
            cancel_startup(startup_claim.cancel(), Failure::Timeout);
            Err(STARTUP_TIMED_OUT.to_owned())
        }
    };
    if result.is_ok() {
        timing.mark(TimingStage::RuntimeReady);
        cancelled.disarm();
    }
    result
}

fn cancel_startup(owned_native_start: bool, failure: Failure) {
    if shared().admission.timeout_owned_startup(owned_native_start) {
        // Owner/document cancellation is not evidence of an engine defect.
        if matches!(failure, Failure::Timeout) {
            shared().runtime_failure.record_current(RuntimeFailureCode::StartupTimeout);
        }
        diagnostics::record(Stage::Failed, Some(failure));
        // A timeout cannot cancel an in-progress native call. Never retry it or
        // let a late policy callback restore traffic admission.
        revoke_all();
    }
}

struct Pending {
    context: PrivateRequestContext,
    attempt: Arc<Attempt>,
    window: WebviewWindow,
    bounds: OriginBrowserBounds,
    deadline: Instant,
    response: tokio::sync::oneshot::Sender<Result<(), String>>,
    cookies: Option<Vec<SignInCookie>>,
}

struct View {
    popups: popups::Selection,
    host: CefBrowserHost<'static>,
    attempt: Arc<Attempt>,
    window: WebviewWindow,
    presentation: u64,
    visible: bool,
    input_blocked: bool,
    presentation_bounds: Option<(sorng_browser_host::ipc::OriginBrowserBounds, f64)>,
    start: Option<Start>,
    checkpoint: retention_flow::Checkpoint,
}

fn begin_normal_close(view: &mut View) {
    popups::hide_selected(view);
    if view.attempt.current() && !view.attempt.ordinary_close.swap(true, Ordering::AcqRel) {
        let _ = view.host.hide(&view.attempt.identity);
        if let Some(retention) = &view.attempt.retention {
            view.checkpoint.begin_close(&view.host, retention);
        }
    }
    view.attempt.revoke();
}

struct Start {
    deadline: Instant,
    response: tokio::sync::oneshot::Sender<Result<(), String>>,
}

struct UiRegistry {
    runtime: CefRuntime<'static>,
    closing: bool,
    tls: Option<NativeTlsBridge>,
    pending: Vec<Pending>,
    views: HashMap<String, View>,
    closing_windows: HashMap<String, WebviewWindow>,
}

thread_local! {
    static UI: RefCell<Option<UiRegistry>> = const { RefCell::new(None) };
}

/// A bounded wake channel: native callbacks never run the pump inline (CEF can
/// schedule more work reentrantly), and a busy UI cannot accumulate callbacks.
pub(crate) fn pump_channel() -> (ScheduleWake, tokio::sync::mpsc::Receiver<()>) {
    let (sender, receiver) = tokio::sync::mpsc::channel(1);
    let wake = Arc::new(move || match sender.try_send(()) {
        Ok(()) | Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => Ok(()),
        Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => Err(WakeUnavailable),
    });
    (wake, receiver)
}

/// Runtime-only reporting around the flow token's atomic abandonment fence.
/// No CEF work, registry walk or attempt lock is safe in this destructor.
struct PumpSupervisorRecovery(Option<flow::PumpRecovery<'static>>);

impl PumpSupervisorRecovery {
    fn complete(mut self, healthy: bool) -> bool {
        // Remove the diagnostic guard before the token can publish READY.
        self.0.take().is_some_and(|recovery| recovery.complete(healthy))
    }

    fn incomplete_revocation(mut self) {
        if self.0.as_mut().is_some_and(|recovery| recovery.abandon()) {
            // The captured attempts were already cancelled. Do not re-enter
            // their possibly blocked revokers after this bounded async wait.
            shared().runtime_failure.record_current(RuntimeFailureCode::UiDispatch);
            log::error!("Native browser watchdog capability revocation did not complete before deadline");
        }
    }
}

impl Drop for PumpSupervisorRecovery {
    fn drop(&mut self) {
        if self.0.as_mut().is_some_and(|recovery| recovery.abandon()) {
            // fail_runtime would miss this evidence after the successful CAS,
            // and would take attempt locks. Preserve the store's first cause.
            shared().runtime_failure.record_current(RuntimeFailureCode::UiDispatch);
            log::error!("Native browser watchdog recovery supervisor abandoned");
        }
    }
}

pub(crate) fn start_pump(app: tauri::AppHandle, mut wake: tokio::sync::mpsc::Receiver<()>) {
    // This worker is independent of Views and the CEF/UI pump. A database may
    // lock after its last website has closed, or while UI work is stalled.
    // Sequential awaiting coalesces slow IO instead of stacking cleanup jobs.
    tauri::async_runtime::spawn(async {
        let mut failure_reported = false;
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let cleaned = tauri::async_runtime::spawn_blocking(
                retention::NativeCookieRetention::housekeeping,
            )
            .await;
            let failed = !matches!(cleaned, Ok(Ok(_)));
            if failed && !failure_reported {
                log::warn!("Retained browser cookie cleanup failed; retrying on this device");
            }
            failure_reported = failed;
        }
    });
    tauri::async_runtime::spawn(async move {
        let mut deadline = Instant::now();
        loop {
            tokio::select! {
                signal = wake.recv() => if signal.is_none() { break; },
                _ = tokio::time::sleep_until(deadline.into()) => (),
            }
            let (sender, receiver) = tokio::sync::oneshot::channel();
            if app
                .run_on_main_thread(move || {
                    tick();
                    let completion = UI.with(|slot| {
                        let slot = slot.borrow();
                        let ui = slot.as_ref()?;
                        let deadline = match ui.runtime.deadline() {
                            Ok(deadline) => deadline,
                            Err(error) => {
                                runtime_failed(error);
                                None
                            }
                        };
                        // This evidence belongs to this exact queued callback,
                        // after its pump/cleanup work, never an earlier tick.
                        let healthy = match ui.runtime.network_policy_configured() {
                            Ok(true) => !ui.closing
                                && ui.tls.is_some()
                                && !shared().admission.revoked(),
                            Ok(false) => {
                                if shared().admission.ready() || shared().admission.suspended() {
                                    fail_runtime(RuntimeFailureCode::RuntimePolicy);
                                }
                                false
                            }
                            Err(error) => {
                                runtime_failed(error);
                                false
                            }
                        };
                        Some((deadline, healthy))
                    });
                    let _ = sender.send(completion);
                })
                .is_err()
            {
                fail_runtime(RuntimeFailureCode::UiDispatch);
                break;
            }
            // A timer alone suspends a ready host, without poisoning CEF's
            // scheduler. Keep this callback's token local and finish revoking
            // every captured attempt before its completion can restore READY.
            let mut recovery = None;
            let mut revoked_attempts = Vec::new();
            let Ok(next) = flow::wait_for_pump(receiver, Duration::from_secs(5), || {
                recovery = shared().admission.suspend_for_watchdog()
                    .map(|token| PumpSupervisorRecovery(Some(token)));
                if recovery.is_some() {
                    log::warn!("Native browser watchdog suspended admission awaiting UI callback");
                    revoked_attempts = flow::snapshot_attempts(&shared().attempts);
                    for attempt in &revoked_attempts {
                        attempt.revoke_for(BrowserSessionFailure::Watchdog);
                    }
                } else {
                    // Startup timeouts, lost dispatch and real runtime faults
                    // remain terminal. Never reinitialize the native engine.
                    fail_runtime(RuntimeFailureCode::UiDispatch);
                }
            }).await
            else {
                fail_runtime(RuntimeFailureCode::UiDispatch);
                break;
            };
            // Shutdown has removed the UI registry: never pump a stopped CEF.
            let Some((next, healthy)) = next else {
                if recovery.is_some() {
                    fail_runtime(RuntimeFailureCode::UiDispatch);
                }
                break;
            };
            if let Some(recovery) = recovery {
                if !healthy {
                    fail_runtime(RuntimeFailureCode::RuntimePolicy);
                }
                // A prior caller may still own a revoker after cancelled=true.
                // Wait only here, off UI and after the exact callback returns;
                // retain the captured Arcs even if the map removes/replaces them.
                let revocations_complete = healthy && flow::wait_for_readiness(
                    Duration::from_secs(5),
                    || {
                        if shared().admission.revoked() {
                            return Err(());
                        }
                        Ok(revoked_attempts.iter().all(|attempt| {
                            attempt.revocation_complete.load(Ordering::Acquire)
                        }))
                    },
                    || (),
                ).await.is_ok();
                if healthy && !revocations_complete {
                    recovery.incomplete_revocation();
                } else if recovery.complete(healthy) {
                    shared().runtime_failure.ready_if(|| shared().admission.ready());
                    log::info!("Native browser watchdog recovered admission after verified UI callback");
                }
            }
            let exit_code = *shared()
                .exit_requested
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(code) = exit_code {
                let app = app.clone();
                if app
                    .clone()
                    .run_on_main_thread(move || {
                        if shutdown().is_ok() {
                            app.exit(code);
                        }
                    })
                    .is_err()
                {
                    revoke_all();
                    break;
                }
            }
            let housekeeping = Instant::now() + Duration::from_millis(100);
            deadline = next.map_or(housekeeping, |next| next.min(housekeeping));
        }
    });
}

/// Native startup only, after package/bootstrap and all required runtime gates.
/// Never expose an equivalent readiness operation through an IPC command.
/// All CEF references must be drained by `shutdown` before the bootstrap exits.
pub(crate) fn install(runtime: CefRuntime<'static>) -> Result<(), String> {
    UI.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.is_some() {
            return Err(UNAVAILABLE.into());
        }
        // Probe actual exports/build pins on CEF UI. A compile flag or package
        // manifest alone cannot activate saved TOFU/pins/custom trust policies.
        let tls = match unsafe { NativeTlsBridge::from_loaded(PATCH_ID) } {
            Ok(bridge) if bridge.supports_scoped_exceptions() && bridge.supports_custom_ca() => {
                Some(bridge)
            }
            Ok(_) => {
                log::error!(
                    "Native browser stage=policy error=certificate-bridge-capabilities-missing"
                );
                None
            }
            Err(error) => {
                // This enum contains fixed messages, not certificate/page data.
                log::error!("Native browser stage=policy error={error}");
                None
            }
        };
        shared()
            .certificate_hooks
            .store(tls.is_some(), Ordering::Release);
        *slot = Some(UiRegistry {
            runtime,
            closing: false,
            tls,
            pending: Vec::new(),
            views: HashMap::new(),
            closing_windows: HashMap::new(),
        });
        // OnContextInitialized can be asynchronous. Stay pending until the
        // production main-loop pump verifies the actual native policy.
        Ok(())
    })
}

/// Safe on a failing scheduler thread. Network revocation does not depend on
/// scheduling another UI callback. Native surfaces are closed on the next tick.
pub(crate) fn revoke_all() {
    shared().prewarm.cancel();
    shared().startup.fail();
    shared().admission.revoke();
    revoke_attempts();
}

fn revoke_attempts() {
    flow::visit_attempt_snapshot(&shared().attempts, |attempt| {
        attempt.revoke_for(BrowserSessionFailure::RuntimeUnavailable);
    });
}

/// Runtime callback, unlike owner lock/close: retain its fixed engine cause.
pub(crate) fn runtime_failed(error: RuntimeError) {
    fail_runtime(match error {
        RuntimeError::SchedulerUnavailable | RuntimeError::WrongThread => RuntimeFailureCode::UiDispatch,
        RuntimeError::NetworkPolicyUnavailable => RuntimeFailureCode::RuntimePolicy,
        RuntimeError::AlreadyStarted => RuntimeFailureCode::RuntimeInitialization,
        RuntimeError::Bootstrap(_) | RuntimeError::InvalidPackagePath => RuntimeFailureCode::RuntimePackage,
    });
}

fn fail_runtime(code: RuntimeFailureCode) {
    let was_revoked = shared().admission.revoked();
    revoke_all();
    if !was_revoked {
        shared().runtime_failure.record_current(code);
    }
}

pub(crate) fn revoke_window(label: &str) {
    shared().documents.revoke(label);
    cancel_prewarm(label);
    revoke_stale_window(label);
}

/// Only the trusted Tauri shell invokes this hook, not a CEF page navigation.
pub(crate) fn shell_document_started(label: &str) {
    // Initial shell loading has no old epoch. In particular it must not consume
    // the once-per-process prewarm gate before any command has used it.
    if shared().documents.revoke(label) {
        cancel_prewarm(label);
        revoke_stale_window(label);
    }
}

fn revoke_stale_window(label: &str) {
    flow::visit_attempt_snapshot(&shared().attempts, |attempt| {
        // A replacement document may already be admitting its own attempt.
        if attempt.window == label && !attempt.document.current() {
            attempt.revoke();
        }
    });
}

pub(crate) fn on_event(app: &tauri::AppHandle, event: &tauri::RunEvent) {
    match event {
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } => {
            UI.with(|slot| {
                if let Some(ui) = slot.borrow_mut().as_mut() {
                    for view in ui
                        .views
                        .values_mut()
                        .filter(|view| view.attempt.window == *label)
                    {
                        begin_normal_close(view);
                    }
                }
            });
            revoke_window(label);
            let defer = UI.with(|slot| {
                let mut slot = slot.borrow_mut();
                let Some(ui) = slot.as_mut() else {
                    return false;
                };
                let has_children = ui.views.values().any(|view| view.attempt.window == *label)
                    || ui
                        .pending
                        .iter()
                        .any(|pending| pending.attempt.window == *label);
                if has_children {
                    if let Some(window) = app.get_webview_window(label) {
                        ui.closing_windows.insert(label.clone(), window);
                    }
                }
                has_children
            });
            if defer {
                api.prevent_close();
            }
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } => revoke_window(label),
        tauri::RunEvent::ExitRequested { code, api, .. } => {
            if shutdown().is_err() {
                *shared()
                    .exit_requested
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = Some(code.unwrap_or(0));
                api.prevent_exit();
            }
        }
        tauri::RunEvent::Exit => {
            revoke_all();
            let _ = shutdown();
        }
        _ => (),
    }
}

fn lookup(
    window: &WebviewWindow,
    identity: &OriginBrowserIdentity,
) -> Result<Arc<Attempt>, String> {
    let attempts = shared().attempts.lock().map_err(|_| STALE.to_owned())?;
    let attempt = attempts.get(&identity.attempt_id).ok_or(STALE)?;
    if attempt.window != window.label() || identity.validate_matches(&attempt.identity).is_err() {
        return Err(STALE.into());
    }
    Ok(attempt.clone())
}

pub(crate) fn status(
    window: &WebviewWindow,
    request: &OriginBrowserStatusRequest,
) -> Result<OriginBrowserStatusResult, String> {
    if request.identity.is_none() && !shared().admission.ready() && !shared().admission.revoked() {
        return OriginBrowserStatusResult::from_native(
            request,
            OriginBrowserCapability::Deferred,
            None,
        )
        .map(|status| status.with_runtime_failure(shared().runtime_failure.snapshot()))
        .map_err(|e| e.to_string());
    }
    if !shared().admission.ready() || !shared().certificate_hooks.load(Ordering::Acquire) {
        return Ok(
            OriginBrowserStatusResult::unavailable(OriginBrowserUnavailableReason::PolicyUnavailable)
                .with_runtime_failure(shared().runtime_failure.snapshot()),
        );
    }
    let snapshot = match &request.identity {
        None => None,
        Some(identity) => {
            let attempt = lookup(window, identity)?;
            if !attempt.current() {
                attempt.revoke();
                return Ok(OriginBrowserStatusResult::unavailable(
                    OriginBrowserUnavailableReason::OwnerUnavailable,
                ));
            }
            let result = attempt.snapshot.lock().map_err(|_| STALE)?.clone();
            Some(result)
        }
    };
    OriginBrowserStatusResult::from_native(request, OriginBrowserCapability::Available, snapshot)
        .map_err(|e| e.to_string())
}

struct Sink {
    window: WebviewWindow,
    attempt: Arc<Attempt>,
}
impl BrowserEventSink for Sink {
    fn on_event(&self, event: BrowserEvent) {
        if event.identity != self.attempt.identity {
            return;
        }
        if !self.attempt.cancelled.load(Ordering::Acquire) {
            if let Some(failure) = event.state.load_failure {
                // Diagnostics must never wait for, repair, or revoke a session.
                // Drop the guard before enqueueing the fixed journal snapshot.
                let relay = self
                    .attempt
                    .session
                    .try_lock()
                    .ok()
                    .map(|session| session.proxy_diagnostics());
                if let Some(relay) = relay {
                    self.attempt.timing.relay_load_error(failure.code, relay);
                }
            }
        }
        let mut finished_load = false;
        if let Ok(mut started) = self.attempt.load_started.lock() {
            if event.state.loading {
                started.get_or_insert_with(Instant::now);
            } else {
                finished_load = started.take().is_some();
            }
        }
        let phase = match event.state.lifecycle {
            Lifecycle::Starting => OriginBrowserPhase::Starting,
            Lifecycle::Attached | Lifecycle::Hidden => OriginBrowserPhase::Attached,
            Lifecycle::Closing => OriginBrowserPhase::Closing,
            Lifecycle::Closed => OriginBrowserPhase::Closed,
            Lifecycle::Faulted => OriginBrowserPhase::Failed,
        };
        if matches!(phase, OriginBrowserPhase::Failed)
            && matches!(event.state.fault, Some(BrowserFault::Renderer))
            && !self.attempt.cancelled.load(Ordering::Acquire)
        {
            // Renderer lifecycle/bridge failure, not a GPU capability warning.
            // The queue accepts fixed enums only; no page or native error text.
            diagnostics::record(Stage::RuntimeFault, Some(Failure::RendererFault));
        }
        if matches!(phase, OriginBrowserPhase::Attached) {
            self.attempt.timing.mark(TimingStage::BrowserAttached);
            if self.attempt.navigation_submitted.load(Ordering::Acquire)
                && finished_load
                && !event.state.loading
                && event.state.load_failure.is_none()
                && event.display.url != "about:blank"
                && !event.display.url.is_empty()
            {
                // Document completion is observable here; this is not a paint
                // or successful login claim. No URL enters timing diagnostics.
                self.attempt.timing.mark(TimingStage::FirstDocumentComplete);
                self.attempt.timing.finish(2);
            }
        }
        if matches!(
            phase,
            OriginBrowserPhase::Closing | OriginBrowserPhase::Closed | OriginBrowserPhase::Failed
        ) {
            self.attempt.revoke();
        }
        let failure_reason = match event.state.fault {
            Some(BrowserFault::Renderer) => Some(OriginBrowserFailureReason::Renderer),
            // This cause was retained before session/relay cleanup. A request
            // callback holding the session mutex must not erase it from the
            // first terminal snapshot (the frontend closes on that snapshot).
            Some(BrowserFault::Session) => Some(self.attempt.failure.get().map(Into::into)
                .unwrap_or(OriginBrowserFailureReason::Session)),
            Some(BrowserFault::Callback) => Some(OriginBrowserFailureReason::Callback),
            Some(BrowserFault::NativeSurface) => Some(OriginBrowserFailureReason::NativeSurface),
            Some(BrowserFault::Load) => Some(OriginBrowserFailureReason::Load),
            None => None,
        };
        let page = OriginBrowserPageState {
            // Address-bar state is emitted only to this trusted owning
            // window. Diagnostics keep using event.state's redacted data.
            url: if event.display.url == "about:blank" {
                ""
            } else {
                &event.display.url
            },
            title: &event.display.title,
            loading: event.state.loading,
            can_go_back: event.state.can_go_back,
            can_go_forward: event.state.can_go_forward,
        };
        let current = || self.attempt.current();
        // No snapshot lock is held across the owner-window emitter.
        let emit = |next| self.window.emit(ORIGIN_BROWSER_STATE_EVENT, next).is_ok();
        let publication = if event.state.load_failure.is_some() {
            display::publish_with_load_failure(
                &self.attempt.snapshot,
                &event.identity,
                event.sequence,
                (phase, failure_reason),
                event.state.load_failure,
                page,
                current,
                emit,
            )
        } else if failure_reason.is_some() {
            display::publish_with_reason(
                &self.attempt.snapshot,
                &event.identity,
                event.sequence,
                (phase, failure_reason),
                page,
                current,
                emit,
            )
        } else {
            display::publish(
                &self.attempt.snapshot,
                &event.identity,
                event.sequence,
                phase,
                page,
                current,
                emit,
            )
        };
        if matches!(
            publication,
            display::Publication::OwnerUnavailable | display::Publication::Failed
        ) {
            self.attempt.revoke();
        }
    }
}

pub(crate) async fn create(
    window: WebviewWindow,
    state: &EncryptionState,
    request: OriginBrowserCreateRequest,
    timing: Trace,
    document: StartupDocument,
) -> Result<OriginBrowserCreateResult, String> {
    let document = document.0;
    document
        .run(create_document(
            window,
            state,
            request,
            timing,
            document.clone(),
        ))
        .await
        .ok_or_else(|| STALE.to_owned())?
}

async fn create_document(
    window: WebviewWindow,
    state: &EncryptionState,
    request: OriginBrowserCreateRequest,
    timing: Trace,
    document: Arc<flow::ShellDocument>,
) -> Result<OriginBrowserCreateResult, String> {
    // Explicitly finish even if an abandoned UI/native callback retains a clone.
    let interrupted = flow::RevokeOnDrop::new(|| timing.finish(0));
    // Validate the real saved owner/source before any filesystem preparation or
    // CEF startup. This selects policy, but grants no runtime/network readiness.
    let authorized =
        origin_browser_authority::authorize_create_with_certificate_hooks(&window, state, &request)
            .await
            .map_err(|e| e.to_string())?;
    timing.mark(TimingStage::Authorized);
    let preparing_lease = authorized.lease.clone();
    let owner_setup = flow::RevokeOnDrop::new(move || preparing_lease.revoke());
    ensure_runtime(&window, state, &authorized.lease, None, &timing, &document).await?;
    authorized
        .lease
        .recheck(&window, state)
        .await
        .map_err(|_| STALE.to_owned())?;
    timing.mark(TimingStage::InitialOwnerChecked);
    let identity = authorized.policy.identity().clone();
    let retention_policy: RetentionPolicy =
        serde_json::from_value(authorized.preferences.retention.clone())
            .map_err(|_| "Saved browser session retention settings are invalid.".to_owned())?;
    // Quick Connect owns only an ephemeral CEF context. Never read, restore or
    // checkpoint another database's cookies even when global retention is on.
    let retention = if authorized.preferences.capabilities.cookies_enabled
        && !authorized.lease.is_temporary()
    {
        Some(
            retention::NativeCookieRetention::prepare(
                &window,
                state,
                &authorized.lease,
                &authorized.policy,
                retention_policy,
            )
            .await
            .map_err(|_| {
                "Sign-in cookie retention could not be prepared for this database.".to_owned()
            })?,
        )
    } else {
        None
    };
    timing.mark(TimingStage::RetentionPrepared);
    let preparing = retention.clone();
    let retention_setup = flow::RevokeOnDrop::new(move || {
        if let Some(preparing) = preparing {
            preparing.invalidate();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = preparing.revoke();
            });
        }
    });
    let cookies = if let Some(load) = retention.clone() {
        tauri::async_runtime::spawn_blocking(move || load.load())
            .await
            .map_err(|_| "Sign-in cookies could not be read.".to_owned())?
            .map_err(|_| {
                "Sign-in cookies could not be read for this unlocked database.".to_owned()
            })?
    } else {
        Vec::new()
    };
    timing.mark(TimingStage::CookiesLoaded);
    let login = login::LoginHooks::prepare(
        &window,
        &identity,
        authorized.login,
        authorized.lease.clone(),
        authorized.basic_auth,
    )
    .await?;
    login.set_appearance_configuration(authorized.preferences.appearance.clone())?;
    timing.mark(TimingStage::LoginPrepared);
    // Retention/setup may race database edits or locking. Recheck the native
    // authority before starting any website network activity.
    authorized
        .lease
        .recheck(&window, state)
        .await
        .map_err(|_| {
            login.revoke();
            STALE.to_owned()
        })?;
    timing.mark(TimingStage::OwnerCheckedBeforeProxy);
    let session = OriginBrowserSession::start(authorized.policy, authorized.route, ProxyLimits::default())
            .await
            .map_err(|_| view_failure(Failure::PrivateProxy, PROXY_FAILED))?;
    let failure = session.failure_state();
    let session = Arc::new(Mutex::new(session));
    timing.mark(TimingStage::ProxyReady);
    let attempt = Arc::new(Attempt {
        timing: timing.clone(),
        navigation_submitted: AtomicBool::new(false),
        downloads: downloads::DownloadOwner::new(
            window.clone(),
            identity.clone(),
            authorized.lease.clone(),
            authorized.preferences.allow_downloads,
        ),
        snapshot: Mutex::new(
            OriginBrowserSnapshot::new(
                &identity,
                0,
                OriginBrowserPhase::Starting,
                OriginBrowserPageState {
                    url: "",
                    title: "",
                    loading: false,
                    can_go_back: false,
                    can_go_forward: false,
                },
            )
            .map_err(|e| e.to_string())?,
        ),
        identity,
        window: window.label().into(),
        document,
        lease: authorized.lease,
        session,
        failure,
        failure_reported: AtomicBool::new(false),
        permissions: authorized.permissions.clone(),
        diagnostics_busy: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
        revocation_complete: AtomicBool::new(false),
        login,
        automation: authorized.automation,
        preferences: authorized.preferences,
        retention,
        ordinary_close: AtomicBool::new(false),
        load_started: Mutex::new(None),
        closed: close_ack::CloseSignal::default(),
    });
    let abandoned = attempt.clone();
    let creation = flow::RevokeOnDrop::new(move || abandoned.revoke());
    retention_setup.disarm();
    attempt.lease.recheck(&window, state).await.map_err(|_| {
        attempt.revoke();
        STALE.to_owned()
    })?;
    attempt.timing.mark(TimingStage::OwnerCheckedBeforeContext);
    {
        let mut attempts = shared().attempts.lock().map_err(|_| STALE)?;
        if !shared().admission.ready() || !attempt.current() {
            drop(attempts);
            attempt.revoke();
            return Err(UNAVAILABLE.into());
        }
        if attempts.len() >= MAX_ATTEMPTS
            || attempts.values().any(|other| {
                other.window == window.label()
                    && request.owner.matches_native(&other.identity)
                    && other.current()
            })
        {
            drop(attempts);
            attempt.revoke();
            return Err("A browser attempt already exists for this tab, or the native browser limit was reached.".into());
        }
        attempts.insert(attempt.identity.attempt_id().to_string(), attempt.clone());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let queued = attempt.clone();
    let request_id = request.request_id.clone();
    let permissions = authorized.permissions;
    let initial_url = authorized.initial_url;
    let owner_window = window.clone();
    let certificate_hooks =
        tls::CertificateHooks::new(&attempt, authorized.certificates, window.clone());
    attempt.timing.mark(TimingStage::ViewUiQueued);
    let result = window.clone().run_on_main_thread(move || {
        queued.timing.mark(TimingStage::UiEntered);
        UI.with(|slot| {
            let mut slot = slot.borrow_mut();
            let Some(ui) = slot.as_mut() else {
                queued.revoke();
                let _ = sender.send(Err(UNAVAILABLE.into()));
                return;
            };
            if !shared().admission.ready() || !queued.current() {
                queued.revoke();
                let _ = sender.send(Err(STALE.into()));
                return;
            }
            let Some(bridge) = ui.tls.as_ref() else {
                queued.revoke();
                let _ = sender.send(Err(TLS_UNAVAILABLE.into()));
                return;
            };
            // SAFETY: runtime is owned by this registry on the native UI thread.
            match unsafe {
                PrivateRequestContext::create_with_tls_capabilities(
                    queued.session.clone(),
                    queued.identity.clone(),
                    permissions,
                    bridge,
                    &NativeTlsConfig {
                        require_scoped_exceptions: true,
                        ..NativeTlsConfig::default()
                    },
                    certificate_hooks,
                    queued.preferences.capabilities,
                )
            } {
                Ok(context) => {
                    queued.timing.mark(TimingStage::ContextCreated);
                    ui.pending.push(Pending {
                        context,
                        attempt: queued.clone(),
                        window,
                        bounds: request.bounds,
                        deadline: Instant::now()
                            + Duration::from_secs(queued.preferences.initial_load_timeout_seconds),
                        response: sender,
                        cookies: queued.retention.as_ref().map(|_| cookies),
                    })
                }
                Err(error) => {
                    log::error!("Native browser stage=context-create error={error}");
                    queued.revoke();
                    let _ = sender.send(Err(view_failure(Failure::PrivateContext, CONTEXT_FAILED)));
                }
            }
        });
    });
    if result.is_err() {
        attempt.revoke();
    }
    // Keep preparation, the disk-backed recheck, and final UI admission under
    // one deadline. No CEF object or UI borrow crosses the recheck's await.
    let result = tokio::time::timeout(
        Duration::from_secs(attempt.preferences.initial_load_timeout_seconds + 5),
        flow::admit_prepared(
            async { receiver.await.map_err(|_| UNAVAILABLE.to_owned())? },
            || async {
                attempt
                    .lease
                    .recheck(&owner_window, state)
                    .await
                    .map_err(|_| STALE.to_owned())
            },
            || async {
                attempt.timing.mark(TimingStage::FinalOwnerChecked);
                operate(
                    owner_window.clone(),
                    attempt.clone(),
                    Operation::InitialNavigate(initial_url),
                )
                .await?;
                attempt
                    .snapshot
                    .lock()
                    .map_err(|_| STALE.to_owned())
                    .map(|snapshot| snapshot.clone())
            },
        ),
    )
    .await
    .map_err(|_| view_failure(Failure::Timeout, VIEW_TIMED_OUT))
    .and_then(|v| v);
    match result {
        Ok(snapshot) => {
            let result =
                OriginBrowserCreateResult::new(&request_id, snapshot).map_err(|e| e.to_string())?;
            // No await after releasing cancellation protection. Only a fully
            // completed creation hands ownership to the persistent registry.
            creation.disarm();
            owner_setup.disarm();
            timing.mark(TimingStage::CommandCompleted);
            interrupted.disarm();
            Ok(result)
        }
        Err(error) => {
            attempt.revoke();
            Err(error)
        }
    }
}

enum Operation {
    InitialNavigate(String),
    Navigate(String),
    Control(OriginBrowserAction),
    Close,
}

async fn operate(
    window: WebviewWindow,
    attempt: Arc<Attempt>,
    operation: Operation,
) -> Result<(), String> {
    if matches!(&operation, Operation::InitialNavigate(_)) {
        attempt.timing.mark(TimingStage::InitialNavigationQueued);
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let retained = attempt.clone();
    let is_close = matches!(operation, Operation::Close);
    let is_devtools = matches!(operation, Operation::Control(OriginBrowserAction::Devtools { .. }));
    let abandoned = attempt.clone();
    let handoff = flow::RevokeOnDrop::new(move || {
        if !is_close {
            abandoned.revoke();
        }
    });
    window
        .run_on_main_thread(move || {
            if matches!(&operation, Operation::InitialNavigate(_)) {
                attempt.timing.mark(TimingStage::InitialNavigationEntered);
            }
            // Cancellation can happen while this callback is queued. Never
            // navigate or change presentation for an abandoned operation;
            // explicit close still runs so native resources can drain.
            if sender.is_closed() && !is_close {
                attempt.revoke();
                return;
            }
            let result = UI.with(|slot| {
                // The housekeeping tick can finish cleanup between lookup and
                // this queued callback. Only an acknowledged exact attempt may
                // turn a repeated close into success.
                if is_close && attempt.closed.completed() {
                    return Ok(());
                }
                let mut slot = slot.borrow_mut();
                let ui = slot.as_mut().ok_or(UNAVAILABLE)?;
                let view = ui
                    .views
                    .get_mut(&attempt.identity.attempt_id().to_string())
                    .ok_or(STALE)?;
                if !Arc::ptr_eq(&view.attempt, &attempt) {
                    return Err(STALE.to_owned());
                }
                if !matches!(operation, Operation::Close)
                    && (!shared().admission.ready() || !attempt.current())
                {
                    attempt.revoke();
                    let _ = view.host.close(&attempt.identity);
                    return Err(STALE.into());
                }
                let id = &attempt.identity;
                if let Operation::Control(OriginBrowserAction::Presentation {
                    revision, bounds, visible, occlusions, input_blocked,
                }) = &operation {
                    return popups::present(view, *revision, *bounds, *visible, occlusions, *input_blocked);
                }
                if view.popups.selected.is_some()
                    && matches!(operation, Operation::Navigate(_) | Operation::Control(_)) {
                    return Err("The requested root view is not selected.".into());
                }
                let result = match operation {
                    Operation::InitialNavigate(url) => {
                        // This private operation is reachable only after the
                        // post-preparation NativeOwnerLease::recheck succeeds.
                        if !view.host.features_ready(id).map_err(|error| {
                            log::error!("Native browser stage=renderer-setup error={error}");
                            view_failure(Failure::RendererSetup, RENDERER_FAILED)
                        })? {
                            return Err(view_failure(Failure::RendererSetup, RENDERER_FAILED));
                        }
                        {
                            let mut session = attempt.session.lock().map_err(|_| STALE)?;
                            let report = NativeHostReadiness::Ready {
                                profile_key: session.policy().profile_key().into(),
                                proxy_endpoint: session.proxy_endpoint(),
                            };
                            session.report_host(id, report).map_err(|_| {
                                view_failure(Failure::InitialNavigation, NAVIGATION_FAILED)
                            })?;
                        }
                        view.host
                            .zoom(id, attempt.preferences.default_zoom_percent as f64)
                            .map_err(|error| {
                                log::error!("Native browser stage=initial-zoom error={error}");
                                view_failure(Failure::InitialZoom, ZOOM_FAILED)
                            })?;
                        attempt.navigation_submitted.store(true, Ordering::Release);
                        view.host.navigate(id, &url).map_err(|error| {
                            log::error!("Native browser stage=initial-navigation error={error}");
                            view_failure(Failure::InitialNavigation, NAVIGATION_FAILED)
                        })?;
                        attempt.timing.mark(TimingStage::NavigationSubmitted);
                        Ok(())
                    }
                    Operation::Navigate(url) => view.host.navigate(id, &url),
                    Operation::Close => {
                        begin_normal_close(view);
                        if view.checkpoint.draining() {
                            Ok(())
                        } else {
                            view.host.close(id)
                        }
                    }
                    Operation::Control(action) => match action {
                        OriginBrowserAction::Zoom {
                            percent,
                            presentation_revision,
                        } => {
                            if presentation_revision != view.presentation
                                || !view.visible
                                || view.input_blocked
                            {
                                return Ok(());
                            }
                            view.host.zoom(id, percent)
                        }
                        OriginBrowserAction::Find {
                            request_id,
                            text,
                            forward,
                            match_case,
                            find_next,
                            presentation_revision,
                        } => {
                            if presentation_revision != view.presentation
                                || !view.visible
                                || view.input_blocked
                            {
                                return Ok(());
                            }
                            find::start(view, &view.host, None, request_id.as_deref(), &text, forward, match_case, find_next)
                        }
                        OriginBrowserAction::StopFind {
                            clear_selection,
                            presentation_revision,
                        } => {
                            if presentation_revision != view.presentation
                                || !view.visible
                                || view.input_blocked
                            {
                                return Ok(());
                            }
                            view.host.stop_find(id, clear_selection)
                        }
                        OriginBrowserAction::Back {} => view.host.back(id),
                        OriginBrowserAction::Forward {} => view.host.forward(id),
                        OriginBrowserAction::Reload {} => view.host.reload(id),
                        OriginBrowserAction::Stop {} => view.host.stop(id),
                        OriginBrowserAction::Focus {
                            presentation_revision,
                        } => {
                            if presentation_revision != view.presentation
                                || !view.visible
                                || view.input_blocked
                            {
                                return Ok(());
                            }
                            view.host.focus(id)
                        }
                        OriginBrowserAction::Devtools {
                            presentation_revision,
                        } => {
                            if presentation_revision != view.presentation
                                || !view.visible
                                || view.input_blocked
                            {
                                return Err("The website presentation changed.".into());
                            }
                            view.host.open_devtools(id)
                        }
                        OriginBrowserAction::Presentation {
                            revision,
                            bounds,
                            visible,
                            occlusions,
                            input_blocked,
                        } => {
                            if revision <= view.presentation {
                                return Ok(());
                            }
                            view.presentation = revision;
                            let scale = view.window.scale_factor().map_err(|_| UNAVAILABLE)?;
                            if let Some(bounds) = bounds {
                                if view.presentation_bounds != Some((bounds, scale)) {
                                    view.host
                                        .resize(
                                            id,
                                            bounds.to_native().map_err(|e| e.to_string())?,
                                            scale,
                                        )
                                        .map_err(|_| UNAVAILABLE)?;
                                    view.presentation_bounds = Some((bounds, scale));
                                }
                            }
                            let was_visible = view.visible;
                            view.visible = visible;
                            view.input_blocked = input_blocked;
                            if visible {
                                // Install the region before revealing a previously
                                // hidden child, then apply input blocking after
                                // show (which enables native input by default).
                                let bounds = bounds.ok_or(UNAVAILABLE)?;
                                view.host
                                    .occlude(id, bounds, &occlusions, scale, input_blocked)
                                    .map_err(|_| UNAVAILABLE)?;
                                if !was_visible {
                                    view.host.show(id).map_err(|_| UNAVAILABLE)?;
                                    view.host
                                        .occlude(id, bounds, &occlusions, scale, input_blocked)
                                } else {
                                    Ok(())
                                }
                            } else {
                                view.host.hide(id)
                            }
                        }
                    },
                };
                result.map_err(|_| UNAVAILABLE.to_owned())
            });
            let _ = sender.send(result);
        })
        .map_err(|_| {
            retained.revoke();
            UNAVAILABLE.to_owned()
        })?;
    let result = tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| {
            retained.revoke();
            UNAVAILABLE.to_owned()
        })?
        .map_err(|_| UNAVAILABLE.to_owned())?;
    if result.is_ok() || is_devtools {
        handoff.disarm();
    }
    result
}

pub(crate) async fn navigate(
    window: WebviewWindow,
    state: &EncryptionState,
    request: OriginBrowserNavigateRequest,
) -> Result<(), String> {
    let attempt = lookup(&window, &request.identity)?;
    attempt.lease.recheck(&window, state).await.map_err(|_| {
        attempt.revoke();
        STALE.to_owned()
    })?;
    operate(window, attempt, Operation::Navigate(request.url)).await
}

pub(crate) async fn control(
    window: WebviewWindow,
    state: &EncryptionState,
    request: OriginBrowserControlRequest,
) -> Result<(), String> {
    let attempt = lookup(&window, &request.identity)?;
    // Navigation rechecks saved authority. Geometry/focus are memory-only so a
    // ResizeObserver cannot repeatedly decrypt the database on the UI path.
    // Every operation still checks the live native lease on the UI thread.
    if matches!(
        request.action,
        OriginBrowserAction::Back {}
            | OriginBrowserAction::Forward {}
            | OriginBrowserAction::Reload {}
            | OriginBrowserAction::Devtools { .. }
    ) {
        attempt.lease.recheck(&window, state).await.map_err(|_| {
            attempt.revoke();
            STALE.to_owned()
        })?;
    }
    operate(window, attempt, Operation::Control(request.action)).await
}

pub(crate) async fn close(
    window: WebviewWindow,
    request: OriginBrowserCloseRequest,
) -> Result<(), String> {
    let key = close_ack::CloseKey::new(
        window.label(),
        &request.identity.owner_database_id,
        &request.identity.connection_id,
        &request.identity.session_id,
        &request.identity.attempt_id,
    );
    let attempt = match lookup(&window, &request.identity) {
        Ok(attempt) => attempt,
        Err(error) => {
            return if shared()
                .closed
                .lock()
                .map_err(|_| STALE)?
                .contains(&key, Instant::now())
            {
                Ok(())
            } else {
                Err(error)
            };
        }
    };
    operate(window, attempt.clone(), Operation::Close).await?;
    // Requesting CloseBrowser is not acknowledgment. Wait for OnBeforeClose
    // and the retention checkpoint drain observed by the housekeeping tick.
    tokio::time::timeout(Duration::from_secs(20), attempt.closed.wait())
        .await
        .map_err(|_| "Native browser cleanup is still pending.".to_owned())
}

pub(crate) async fn automation(
    window: WebviewWindow,
    state: &EncryptionState,
    request: OriginBrowserAutomationRequest,
) -> Result<NativeAutomationReply, String> {
    let attempt = lookup(&window, &request.identity)?;
    let cleanup = matches!(request.operation, NativeAutomationAction::Cancel { .. });
    let permissions = if cleanup {
        // This can only discard pending work/recorded steps. Permission
        // revocation must not prevent cleanup; owner/attempt checks still apply.
        NativeAutomationPermissions::default()
    } else {
        let (scripts, macros) = attempt
            .automation
            .permissions(&window, state)
            .await
            .map_err(|_| {
                attempt.revoke();
                STALE.to_owned()
            })?;
        NativeAutomationPermissions { scripts, macros }
    };
    if let Err(reason) = request.operation.validate(permissions) {
        return Ok(NativeAutomationReply::Failed { reason });
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let queued = attempt.clone();
    let abandoned = attempt.clone();
    let handoff = flow::RevokeOnDrop::new(move || abandoned.revoke());
    window
        .run_on_main_thread(move || {
            if sender.is_closed() {
                queued.revoke();
                return;
            }
            // A host may complete synchronously (validation), asynchronously
            // (renderer reply), or reject dispatch. All paths settle once.
            let response = Arc::new(Mutex::new(Some(sender)));
            let reply = response.clone();
            let result = UI.with(|slot| {
                let slot = slot.borrow();
                let ui = slot.as_ref().ok_or(UNAVAILABLE)?;
                let view = ui
                    .views
                    .get(&queued.identity.attempt_id().to_string())
                    .ok_or(STALE)?;
                if !Arc::ptr_eq(&view.attempt, &queued)
                    || !shared().admission.ready()
                    || !queued.current()
                {
                    queued.revoke();
                    return Err(STALE);
                }
                let completing = queued.clone();
                if view.popups.selected.is_some() && !cleanup {
                    if let Some(sender) = response.lock().unwrap_or_else(|e| e.into_inner()).take() {
                        let _ = sender.send(Ok(NativeAutomationReply::Failed { reason: NativeAutomationFailure::Unavailable }));
                    }
                    return Ok(());
                }
                view.host
                    .automation(
                        &queued.identity,
                        request.operation,
                        permissions,
                        Box::new(move |result| {
                            let result = if completing.current() {
                                result
                            } else {
                                NativeAutomationReply::Failed {
                                    reason: NativeAutomationFailure::StaleDocument,
                                }
                            };
                            if let Some(sender) =
                                reply.lock().unwrap_or_else(|e| e.into_inner()).take()
                            {
                                let _ = sender.send(Ok(result));
                            }
                        }),
                    )
                    .map_err(|_| UNAVAILABLE)
            });
            if let Err(error) = result {
                if let Some(sender) = response.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    let _ = sender.send(Err(error.to_owned()));
                }
            }
        })
        .map_err(|_| UNAVAILABLE.to_owned())?;
    let reply = tokio::time::timeout(Duration::from_secs(20), receiver)
        .await
        .map_err(|_| "Website automation did not complete in time.".to_owned())?
        .map_err(|_| UNAVAILABLE.to_owned())??;
    if !cleanup {
        attempt
            .lease
            .recheck(&window, state)
            .await
            .map_err(|_| STALE.to_owned())?;
    }
    if !attempt.current() {
        return Err(STALE.to_owned());
    }
    handoff.disarm();
    Ok(reply)
}

pub(crate) fn extensions(
    window: WebviewWindow,
    request: sorng_browser_host::native_extensions::NativeBrowserExtensionRequest,
) -> Result<sorng_browser_host::native_extensions::NativeBrowserExtensionReceipt, String> {
    let attempt = lookup(&window, &request.identity)?;
    // A read-only receipt describes the already installed attempt gates, not
    // a grant. Do not decrypt the database again just to draw toolbar controls.
    if !attempt.current()
        || !shared().admission.ready()
        || !shared().certificate_hooks.load(Ordering::Acquire)
        || !matches!(
            attempt.snapshot.lock().map_err(|_| STALE)?.phase(),
            OriginBrowserPhase::Attached
        )
    {
        return Err(STALE.to_owned());
    }
    sorng_browser_host::native_extensions::NativeExtensionGate::new(
        attempt.identity.clone(),
        attempt.preferences.capabilities.website_extensions_enabled,
    )
    .receipt(&attempt.identity)
    .map_err(|_| STALE.to_owned())
}

/// Read or control only the already-authorized native download. No renderer
/// path or URL is accepted and no second HTTP request is made.
async fn download_operation(
    window: WebviewWindow,
    identity: OriginBrowserIdentity,
    action: Option<sorng_browser_host::native_downloads::DownloadControlRequest>,
) -> Result<Vec<sorng_browser_host::native_downloads::DownloadSnapshot>, String> {
    let attempt = lookup(&window, &identity)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            if sender.is_closed() {
                return;
            }
            let result = UI.with(|slot| {
                let slot = slot.borrow();
                let ui = slot.as_ref().ok_or(UNAVAILABLE)?;
                let view = ui
                    .views
                    .get(&attempt.identity.attempt_id().to_string())
                    .ok_or(STALE)?;
                if !Arc::ptr_eq(&view.attempt, &attempt)
                    || !shared().admission.ready()
                    || !attempt.current()
                {
                    return Err(STALE.to_owned());
                }
                if let Some(request) = action {
                    view.host.control_download_across_views(&request).map_err(|_| {
                        "The download action is unavailable for its current state.".to_owned()
                    })?;
                }
                view.host
                    .downloads_across_views(&attempt.identity)
                    .map_err(|_| "Downloads are unavailable for this browser session.".to_owned())
            });
            let _ = sender.send(result);
        })
        .map_err(|_| UNAVAILABLE.to_owned())?;
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| "Download controls did not respond in time.".to_owned())?
        .map_err(|_| UNAVAILABLE.to_owned())?
}

pub(crate) async fn downloads(
    window: WebviewWindow,
    request: sorng_browser_host::native_downloads::DownloadListRequest,
) -> Result<Vec<sorng_browser_host::native_downloads::DownloadSnapshot>, String> {
    download_operation(window, request.identity, None).await
}

pub(crate) async fn download_control(
    window: WebviewWindow,
    request: sorng_browser_host::native_downloads::DownloadControlRequest,
) -> Result<(), String> {
    download_operation(window, request.identity.clone(), Some(request))
        .await
        .map(|_| ())
}

/// Main-loop callback. Work is scheduled by CEF, while owner revocation and
/// pending context completion are checked even when no page is painting.
pub(crate) fn tick() {
    recording::reap();
    UI.with(|cell| {
        // Deferred CEF replies run inside work(). Their owner/selected-view
        // guards must be able to read this registry during that callback.
        // A mutable borrow here rejects every otherwise-current history reply.
        let slot = cell.borrow();
        let Some(ui) = slot.as_ref() else {
            return;
        };
        let was_ready = shared().admission.ready();
        let was_verified = was_ready || shared().admission.suspended();
        let was_revoked = shared().admission.revoked();
        // Hard failures/shutdown need cleanup-only work. A transient watchdog
        // suspension must use the healthy scheduler so its callback can prove
        // recovery; old attempts stay revoked and new admission stays closed.
        if shared().admission.revoked() {
            revoke_all();
            // The normal scheduler may be terminally stopped after a policy
            // failure. CEF still needs pump opportunities for queued CloseBrowser
            // tasks and OnBeforeClose; no network admission is restored.
            let _ = ui.runtime.cleanup_only_work();
        } else if let Err(error) = ui.runtime.work() {
            log::error!("Native browser stage=policy error={error}");
            runtime_failed(error);
        }
        drop(slot);
        let mut slot = cell.borrow_mut();
        let Some(ui) = slot.as_mut() else {
            return;
        };
        match ui.runtime.network_policy_configured() {
            Ok(configured) if ui.tls.is_some() => {
                shared().admission.observe_policy(configured);
                if !configured && was_verified && !was_revoked {
                    shared().runtime_failure.record_current(RuntimeFailureCode::RuntimePolicy);
                }
            }
            Ok(_) => {
                revoke_all();
                if !was_revoked {
                    shared().runtime_failure.record_current(RuntimeFailureCode::CertificateBridge);
                }
            }
            Err(error) => {
                if !was_revoked {
                    log::error!("Native browser stage=policy error={error}");
                }
                runtime_failed(error);
            }
        }
        if shared().admission.revoked() {
            revoke_all();
        }
        if ui.tls.is_some() {
            if let Err(error) = cef_tls_bridge::pump_tls() {
                if !was_revoked {
                    log::error!("Native browser stage=policy error={error}");
                }
                fail_runtime(RuntimeFailureCode::CertificateBridge);
            }
        }
        if !was_revoked && shared().admission.revoked() {
            diagnostics::record(Stage::Failed, Some(Failure::Policy));
        } else if !was_ready && shared().admission.ready() {
            shared().runtime_failure.ready_if(|| shared().admission.ready());
            diagnostics::record(Stage::Ready, None);
        }
        let mut waiting = Vec::new();
        for mut pending in ui.pending.drain(..) {
            if !shared().admission.ready()
                || !pending.attempt.current()
                || pending.response.is_closed()
            {
                pending.attempt.revoke();
                let _ = pending.response.send(Err(STALE.into()));
                continue;
            }
            if Instant::now() >= pending.deadline {
                pending.attempt.revoke();
                let _ = pending
                    .response
                    .send(Err(view_failure(Failure::Timeout, VIEW_TIMED_OUT)));
                continue;
            }
            match pending.context.status() {
                PreparationStatus::Initializing => {
                    waiting.push(pending);
                    continue;
                }
                PreparationStatus::ProxyConfigured => (),
                status => {
                    log::error!("Native browser stage=context-prepare status={status:?}");
                    pending.attempt.revoke();
                    let _ = pending
                        .response
                        .send(Err(view_failure(Failure::PrivateContext, CONTEXT_FAILED)));
                    continue;
                }
            }
            if let Some(cookies) = pending.cookies.take() {
                let Some(retention) = pending.attempt.retention.as_ref() else {
                    pending.attempt.revoke();
                    let _ = pending.response.send(Err(UNAVAILABLE.into()));
                    continue;
                };
                if let Err(error) = pending
                    .context
                    .import_sign_in_cookies(retention.clone(), cookies)
                {
                    log::error!("Native browser stage=cookie-restore error={error:?}");
                    pending.attempt.revoke();
                    let _ = pending.response.send(Err(view_failure(
                        Failure::CookieRestore,
                        COOKIE_RESTORE_FAILED,
                    )));
                    continue;
                }
                // Import completion is asynchronous, even for the empty jar.
                // Never create or navigate a page until native readback passes.
                waiting.push(pending);
                continue;
            }
            let attempt = pending.attempt;
            attempt.timing.mark(TimingStage::ContextReady);
            let scale = pending.window.scale_factor().unwrap_or(1.0);
            let sink = Arc::new(Sink {
                window: pending.window.clone(),
                attempt: attempt.clone(),
            });
            // Runtime, context and toolkit parent are retained until OnBeforeClose.
            let created = unsafe {
                CefBrowserHost::create_owned_engineering_probe(
                    Arc::new(pending.window.clone()),
                    pending.context,
                    attempt.session.clone(),
                    attempt.identity.clone(),
                    pending.bounds.to_native().expect("validated bounds"),
                    scale,
                    sink,
                    Some(attempt.login.clone()),
                )
            };
            match created {
                Ok(host) => {
                    if host.enable_downloads(attempt.downloads.clone()).is_err()
                        || host.enable_popup_downloads(attempt.downloads.clone()).is_err()
                        || host.configure_popup_policy(attempt.preferences.popup_policy).is_err() {
                        attempt.revoke();
                        let _ = host.close(&attempt.identity);
                        // Retain the host/context until OnBeforeClose. The
                        // ordinary startup drain reports failure below.
                        log::error!("Native browser download policy setup failed");
                    }
                    ui.views.insert(
                        attempt.identity.attempt_id().to_string(),
                        View {
                            popups: popups::Selection::default(),
                            host,
                            attempt: attempt.clone(),
                            window: pending.window,
                            presentation: 0,
                            visible: false,
                            input_blocked: false,
                            presentation_bounds: None,
                            start: Some(Start {
                                deadline: pending.deadline,
                                response: pending.response,
                            }),
                            checkpoint: retention_flow::Checkpoint::new(),
                        },
                    );
                }
                Err(error) => {
                    log::error!("Native browser stage=view-create error={error}");
                    attempt.revoke();
                    let _ = pending
                        .response
                        .send(Err(view_failure(Failure::NativeSurface, VIEW_FAILED)));
                }
            }
        }
        ui.pending = waiting;
        ui.views.retain(|_, view| {
            popups::poll(view);
            if let Some(retention) = &view.attempt.retention {
                view.checkpoint
                    .tick(&view.host, retention, view.attempt.current());
            }
            if view.checkpoint.take_failure().is_some() {
                let _ = view.window.emit(
                    "origin-browser-notice",
                    serde_json::json!({
                        "identity": OriginBrowserIdentity::from_native(&view.attempt.identity),
                        "kind": "cookie-retention-failed",
                    }),
                );
            }
            let load_expired = {
                let mut started = view
                    .attempt
                    .load_started
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if started.is_some_and(|start| {
                    start.elapsed()
                        >= Duration::from_secs(
                            view.attempt.preferences.document_ready_timeout_seconds,
                        )
                }) {
                    *started = None;
                    true
                } else {
                    false
                }
            };
            if load_expired && view.attempt.current() {
                // Abort only this unfinished document, not its owning database
                // or browser session. The user can retry using Reload.
                let _ = view.host.stop(&view.attempt.identity);
                let _ = view.window.emit(
                    "origin-browser-notice",
                    serde_json::json!({
                        "identity": OriginBrowserIdentity::from_native(&view.attempt.identity),
                        "kind": "document-load-timeout",
                    }),
                );
            }
            if let Some(start) = view.start.take() {
                if !shared().admission.ready()
                    || !view.attempt.current()
                    || start.response.is_closed()
                {
                    view.attempt.revoke();
                    let _ = start.response.send(Err(STALE.into()));
                } else if Instant::now() >= start.deadline {
                    view.attempt.revoke();
                    let _ = start
                        .response
                        .send(Err(view_failure(Failure::Timeout, VIEW_TIMED_OUT)));
                } else {
                    match view.host.features_ready(&view.attempt.identity) {
                        Ok(false) => view.start = Some(start),
                        Err(error) => {
                            log::error!("Native browser stage=renderer-setup error={error}");
                            view.attempt.revoke();
                            let _ = start
                                .response
                                .send(Err(view_failure(Failure::RendererSetup, RENDERER_FAILED)));
                        }
                        Ok(true) => {
                            view.attempt.timing.mark(TimingStage::RendererReady);
                            // Signal preparation only. The async create path
                            // must recheck saved authority before reporting the
                            // host ready and issuing initial navigation.
                            if start.response.send(Ok(())).is_err() {
                                view.attempt.revoke();
                            }
                        }
                    }
                }
            }
            if !view.attempt.current() && !view.checkpoint.draining() {
                let _ = view.host.close(&view.attempt.identity);
            }
            let keep = view.host.lifecycle() != Lifecycle::Closed || view.checkpoint.draining();
            if !keep {
                let id = &view.attempt.identity;
                shared()
                    .closed
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(
                        close_ack::CloseKey::new(
                            &view.attempt.window,
                            id.owner_database_id(),
                            id.connection_id(),
                            id.session_id(),
                            &id.attempt_id().to_string(),
                        ),
                        Instant::now(),
                    );
                view.attempt.closed.complete();
            }
            keep
        });
        shared()
            .attempts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|key, attempt| {
                attempt.current()
                    || ui.views.contains_key(key)
                    || ui.pending.iter().any(|p| Arc::ptr_eq(&p.attempt, attempt))
            });
        ui.closing_windows.retain(|label, window| {
            let pending = ui.views.values().any(|view| &view.attempt.window == label)
                || ui
                    .pending
                    .iter()
                    .any(|pending| &pending.attempt.window == label);
            if !pending {
                let _ = window.destroy();
            }
            pending
        });
    });
}

pub(crate) fn shutdown() -> Result<(), String> {
    UI.with(|slot| {
        if let Some(ui) = slot.borrow_mut().as_mut() {
            if !ui.closing {
                ui.closing = true;
                diagnostics::record(Stage::Closing, None);
            }
            for view in ui.views.values_mut() {
                begin_normal_close(view);
            }
        }
    });
    revoke_all();
    tick();
    UI.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot
            .as_ref()
            .is_some_and(|ui| !ui.views.is_empty() || !ui.pending.is_empty())
        {
            return Err("Native website views are still closing".into());
        }
        if let Some(ui) = slot.take() {
            // No remaining hosts, pending contexts or callbacks in the registry.
            unsafe {
                ui.runtime.shutdown().map_err(|error| {
                    diagnostics::record(Stage::Failed, Some(Failure::Shutdown));
                    log::error!("Native browser stage=shutdown error={error}");
                    UNAVAILABLE.to_owned()
                })?;
                cef_tls_bridge::after_cef_shutdown();
            }
            shared().certificate_hooks.store(false, Ordering::Release);
            diagnostics::record(Stage::Closed, None);
        }
        Ok(())
    })
}
