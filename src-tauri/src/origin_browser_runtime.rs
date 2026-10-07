//! UI-thread native browser registry. No CEF object crosses a thread boundary.
//! A packaged runtime must install itself before requests are admitted. Native
//! policy readback is required; compiling the `native-browser` flag alone is
//! insufficient. Operational admission is not a production acceptance claim.

use sorng_browser_host::{
    cef_browser::{BrowserEvent, BrowserEventSink, CefBrowserHost},
    cef_context::{PreparationStatus, PrivateRequestContext},
    cef_runtime::{CefRuntime, ScheduleWake, WakeUnavailable},
    cef_session_retention::{RetentionPolicy, SignInCookie},
    cef_tls_bridge::{self, NativeTlsBridge, NativeTlsConfig, PATCH_ID},
    control::Lifecycle,
    ipc::*,
    native_automation::{
        NativeAutomationAction, NativeAutomationFailure, NativeAutomationPermissions,
        NativeAutomationReply,
    },
};
use sorng_commands_core::origin_browser_authority::{self, NativeOwnerLease};
use sorng_encryption::EncryptionState;
use sorng_protocols::{
    origin_browser::{BrowserIdentity, NativeHostReadiness, OriginBrowserSession},
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

#[path = "origin_browser_media.rs"]
mod media;

#[path = "origin_browser_tls.rs"]
mod tls;

#[path = "origin_browser_runtime_flow.rs"]
mod flow;

#[path = "origin_browser_display.rs"]
mod display;

#[path = "origin_browser_retention.rs"]
mod retention;
#[path = "origin_browser_retention_flow.rs"]
mod retention_flow;

const UNAVAILABLE: &str =
    "The packaged real-origin browser is unavailable; no direct-network fallback was used.";
const TLS_UNAVAILABLE: &str = "The loaded CEF runtime does not provide the required app certificate-verifier bridge. Install or rebuild the patched browser runtime; the saved trust policy was not changed.";
const STALE: &str = "This website's database or browser session is no longer available. Reopen it from its owning database.";
const MAX_ATTEMPTS: usize = 64;

struct Attempt {
    identity: BrowserIdentity,
    window: String,
    lease: NativeOwnerLease,
    session: Arc<Mutex<OriginBrowserSession>>,
    snapshot: Mutex<OriginBrowserSnapshot>,
    cancelled: AtomicBool,
    login: Arc<login::LoginHooks>,
    automation: Arc<origin_browser_authority::NativeAutomationAuthority>,
    preferences: origin_browser_authority::NativeBrowserPreferences,
    // Cookie-disabled attempts never acquire a retention owner: they cannot
    // load, checkpoint, clear or overwrite dormant encrypted DB cookie data.
    retention: Option<Arc<retention::NativeCookieRetention>>,
    ordinary_close: AtomicBool,
    load_started: Mutex<Option<Instant>>,
}

impl Attempt {
    fn current(&self) -> bool {
        !self.cancelled.load(Ordering::Acquire) && self.lease.is_current()
    }

    fn revoke(&self) {
        if self.cancelled.swap(true, Ordering::AcqRel) {
            return;
        }
        display::scrub_retained(&self.snapshot);
        self.login.revoke();
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
        let _ = self
            .session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .revoke(&self.identity);
    }
}

#[derive(Default)]
struct SharedRegistry {
    admission: flow::RuntimeAdmission,
    certificate_hooks: AtomicBool,
    attempts: Mutex<HashMap<String, Arc<Attempt>>>,
    exit_requested: Mutex<Option<i32>>,
}

fn shared() -> &'static SharedRegistry {
    static REGISTRY: OnceLock<SharedRegistry> = OnceLock::new();
    REGISTRY.get_or_init(SharedRegistry::default)
}

pub(crate) fn retention_available() -> bool {
    shared().admission.ready() && shared().certificate_hooks.load(Ordering::Acquire)
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
    host: CefBrowserHost<'static>,
    attempt: Arc<Attempt>,
    window: WebviewWindow,
    presentation: u64,
    visible: bool,
    start: Option<Start>,
    checkpoint: retention_flow::Checkpoint,
}

fn begin_normal_close(view: &mut View) {
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
                    let deadline = UI.with(|slot| {
                        slot.borrow()
                            .as_ref()
                            .map(|ui| ui.runtime.deadline().ok().flatten())
                    });
                    let _ = sender.send(deadline);
                })
                .is_err()
            {
                revoke_all();
                break;
            }
            // A stalled callback retains its queue slot. Revoke admission at
            // five seconds, then resume cleanup ticks when that callback returns.
            let Ok(next) = flow::wait_for_pump(receiver, Duration::from_secs(5), revoke_all).await
            else {
                revoke_all();
                break;
            };
            // Shutdown has removed the UI registry: never pump a stopped CEF.
            let Some(next) = next else {
                break;
            };
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
        let tls = unsafe { NativeTlsBridge::from_loaded(PATCH_ID) }
            .ok()
            .filter(|bridge| bridge.supports_scoped_exceptions() && bridge.supports_custom_ca());
        shared()
            .certificate_hooks
            .store(tls.is_some(), Ordering::Release);
        *slot = Some(UiRegistry {
            runtime,
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
    shared().admission.revoke();
    for attempt in shared()
        .attempts
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .values()
    {
        attempt.revoke();
    }
}

pub(crate) fn revoke_window(label: &str) {
    for attempt in shared()
        .attempts
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .values()
    {
        if attempt.window == label {
            attempt.revoke();
        }
    }
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
    if !shared().admission.ready() || !shared().certificate_hooks.load(Ordering::Acquire) {
        return Ok(OriginBrowserStatusResult::unavailable(
            OriginBrowserUnavailableReason::PolicyUnavailable,
        ));
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
        if let Ok(mut started) = self.attempt.load_started.lock() {
            if event.state.loading {
                started.get_or_insert_with(Instant::now);
            } else {
                *started = None;
            }
        }
        let phase = match event.state.lifecycle {
            Lifecycle::Starting => OriginBrowserPhase::Starting,
            Lifecycle::Attached | Lifecycle::Hidden => OriginBrowserPhase::Attached,
            Lifecycle::Closing => OriginBrowserPhase::Closing,
            Lifecycle::Closed => OriginBrowserPhase::Closed,
            Lifecycle::Faulted => OriginBrowserPhase::Failed,
        };
        if matches!(
            phase,
            OriginBrowserPhase::Closing | OriginBrowserPhase::Closed | OriginBrowserPhase::Failed
        ) {
            self.attempt.revoke();
        }
        let publication = display::publish(
            &self.attempt.snapshot,
            &event.identity,
            event.sequence,
            phase,
            OriginBrowserPageState {
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
            },
            || self.attempt.current(),
            // No snapshot lock is held across the owner-window emitter.
            |next| self.window.emit(ORIGIN_BROWSER_STATE_EVENT, next).is_ok(),
        );
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
) -> Result<OriginBrowserCreateResult, String> {
    if !shared().admission.ready() {
        return Err(UNAVAILABLE.into());
    }
    if !shared().certificate_hooks.load(Ordering::Acquire) {
        return Err(TLS_UNAVAILABLE.into());
    }
    let authorized =
        origin_browser_authority::authorize_create_with_certificate_hooks(&window, state, &request)
            .await
            .map_err(|e| e.to_string())?;
    let identity = authorized.policy.identity().clone();
    let retention_policy: RetentionPolicy =
        serde_json::from_value(authorized.preferences.retention.clone())
            .map_err(|_| "Saved browser session retention settings are invalid.".to_owned())?;
    let retention = if authorized.preferences.capabilities.cookies_enabled {
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
    let login = login::LoginHooks::prepare(
        &window,
        &identity,
        authorized.login,
        authorized.lease.clone(),
    )
    .await?;
    // Consent may remain open while the database changes or is locked. Reload
    // the native authority before starting any website network activity.
    authorized
        .lease
        .recheck(&window, state)
        .await
        .map_err(|_| {
            login.revoke();
            STALE.to_owned()
        })?;
    let session = Arc::new(Mutex::new(
        OriginBrowserSession::start(authorized.policy, authorized.route, ProxyLimits::default())
            .await
            .map_err(|_| UNAVAILABLE)?,
    ));
    let attempt = Arc::new(Attempt {
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
        lease: authorized.lease,
        session,
        cancelled: AtomicBool::new(false),
        login,
        automation: authorized.automation,
        preferences: authorized.preferences,
        retention,
        ordinary_close: AtomicBool::new(false),
        load_started: Mutex::new(None),
    });
    let abandoned = attempt.clone();
    let creation = flow::RevokeOnDrop::new(move || abandoned.revoke());
    retention_setup.disarm();
    attempt.lease.recheck(&window, state).await.map_err(|_| {
        attempt.revoke();
        STALE.to_owned()
    })?;
    {
        let mut attempts = shared().attempts.lock().map_err(|_| STALE)?;
        if !shared().admission.ready() {
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
    let result = window.clone().run_on_main_thread(move || {
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
                Ok(context) => ui.pending.push(Pending {
                    context,
                    attempt: queued.clone(),
                    window,
                    bounds: request.bounds,
                    deadline: Instant::now()
                        + Duration::from_secs(queued.preferences.initial_load_timeout_seconds),
                    response: sender,
                    cookies: queued.retention.as_ref().map(|_| cookies),
                }),
                Err(_) => {
                    queued.revoke();
                    let _ = sender.send(Err(UNAVAILABLE.into()));
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
    .map_err(|_| UNAVAILABLE.to_owned())
    .and_then(|v| v);
    match result {
        Ok(snapshot) => {
            let result =
                OriginBrowserCreateResult::new(&request_id, snapshot).map_err(|e| e.to_string())?;
            // No await after releasing cancellation protection. Only a fully
            // completed creation hands ownership to the persistent registry.
            creation.disarm();
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
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let retained = attempt.clone();
    let is_close = matches!(operation, Operation::Close);
    let abandoned = attempt.clone();
    let handoff = flow::RevokeOnDrop::new(move || {
        if !is_close {
            abandoned.revoke();
        }
    });
    window
        .run_on_main_thread(move || {
            // Cancellation can happen while this callback is queued. Never
            // navigate or change presentation for an abandoned operation;
            // explicit close still runs so native resources can drain.
            if sender.is_closed() && !is_close {
                attempt.revoke();
                return;
            }
            let result = UI.with(|slot| {
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
                let result = match operation {
                    Operation::InitialNavigate(url) => {
                        // This private operation is reachable only after the
                        // post-preparation NativeOwnerLease::recheck succeeds.
                        if !view.host.features_ready(id).map_err(|_| UNAVAILABLE)? {
                            return Err(UNAVAILABLE.into());
                        }
                        {
                            let mut session = attempt.session.lock().map_err(|_| STALE)?;
                            let report = NativeHostReadiness::Ready {
                                profile_key: session.policy().profile_key().into(),
                                proxy_endpoint: session.proxy_endpoint(),
                            };
                            session.report_host(id, report).map_err(|_| UNAVAILABLE)?;
                        }
                        view.host
                            .zoom(id, attempt.preferences.default_zoom_percent as f64)
                            .and_then(|()| view.host.navigate(id, &url))
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
                            if presentation_revision != view.presentation || !view.visible {
                                return Ok(());
                            }
                            view.host.zoom(id, percent)
                        }
                        OriginBrowserAction::Find {
                            text,
                            forward,
                            match_case,
                            find_next,
                            presentation_revision,
                        } => {
                            if presentation_revision != view.presentation || !view.visible {
                                return Ok(());
                            }
                            view.host.find(id, &text, forward, match_case, find_next)
                        }
                        OriginBrowserAction::StopFind {
                            clear_selection,
                            presentation_revision,
                        } => {
                            if presentation_revision != view.presentation || !view.visible {
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
                            if presentation_revision != view.presentation || !view.visible {
                                return Ok(());
                            }
                            view.host.focus(id)
                        }
                        OriginBrowserAction::Presentation {
                            revision,
                            bounds,
                            visible,
                        } => {
                            if revision <= view.presentation {
                                return Ok(());
                            }
                            view.presentation = revision;
                            if let Some(bounds) = bounds {
                                view.host
                                    .resize(
                                        id,
                                        bounds.to_native().map_err(|e| e.to_string())?,
                                        view.window.scale_factor().map_err(|_| UNAVAILABLE)?,
                                    )
                                    .map_err(|_| UNAVAILABLE)?;
                            }
                            view.visible = visible;
                            if visible {
                                view.host.show(id)
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
    if result.is_ok() {
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
    let attempt = lookup(&window, &request.identity)?;
    operate(window, attempt, Operation::Close).await
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

/// Main-loop callback. Work is scheduled by CEF, while owner revocation and
/// pending context completion are checked even when no page is painting.
pub(crate) fn tick() {
    UI.with(|slot| {
        let mut slot = slot.borrow_mut();
        let Some(ui) = slot.as_mut() else {
            return;
        };
        // On watchdog/shutdown recovery this is a cleanup-only tick. Revoke
        // before CEF callbacks run, including creates queued before the timeout.
        if shared().admission.revoked() {
            revoke_all();
            // The normal scheduler may be terminally stopped after a policy
            // failure. CEF still needs pump opportunities for queued CloseBrowser
            // tasks and OnBeforeClose; no network admission is restored.
            let _ = ui.runtime.cleanup_only_work();
        } else if ui.runtime.work().is_err() {
            revoke_all();
        }
        match ui.runtime.network_policy_configured() {
            Ok(configured) => shared().admission.observe_policy(configured),
            Err(_) => revoke_all(),
        }
        if shared().admission.revoked() {
            revoke_all();
        }
        if ui.tls.is_some() && cef_tls_bridge::pump_tls().is_err() {
            revoke_all();
        }
        let mut waiting = Vec::new();
        for mut pending in ui.pending.drain(..) {
            if !shared().admission.ready()
                || !pending.attempt.current()
                || Instant::now() >= pending.deadline
                || pending.response.is_closed()
            {
                pending.attempt.revoke();
                let _ = pending.response.send(Err(STALE.into()));
                continue;
            }
            match pending.context.status() {
                PreparationStatus::Initializing => {
                    waiting.push(pending);
                    continue;
                }
                PreparationStatus::ProxyConfigured => (),
                _ => {
                    pending.attempt.revoke();
                    let _ = pending.response.send(Err(UNAVAILABLE.into()));
                    continue;
                }
            }
            if let Some(cookies) = pending.cookies.take() {
                let Some(retention) = pending.attempt.retention.as_ref() else {
                    pending.attempt.revoke();
                    let _ = pending.response.send(Err(UNAVAILABLE.into()));
                    continue;
                };
                if pending
                    .context
                    .import_sign_in_cookies(retention.clone(), cookies)
                    .is_err()
                {
                    pending.attempt.revoke();
                    let _ = pending.response.send(Err(
                        "Retained sign-in cookies could not be restored safely.".into(),
                    ));
                    continue;
                }
                // Import completion is asynchronous, even for the empty jar.
                // Never create or navigate a page until native readback passes.
                waiting.push(pending);
                continue;
            }
            let attempt = pending.attempt;
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
                    ui.views.insert(
                        attempt.identity.attempt_id().to_string(),
                        View {
                            host,
                            attempt: attempt.clone(),
                            window: pending.window,
                            presentation: 0,
                            visible: false,
                            start: Some(Start {
                                deadline: pending.deadline,
                                response: pending.response,
                            }),
                            checkpoint: retention_flow::Checkpoint::new(),
                        },
                    );
                }
                Err(_) => {
                    attempt.revoke();
                    let _ = pending.response.send(Err(UNAVAILABLE.into()));
                }
            }
        }
        ui.pending = waiting;
        ui.views.retain(|_, view| {
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
                    || Instant::now() >= start.deadline
                {
                    view.attempt.revoke();
                    let _ = start.response.send(Err(STALE.into()));
                } else {
                    match view.host.features_ready(&view.attempt.identity) {
                        Ok(false) => view.start = Some(start),
                        Err(_) => {
                            view.attempt.revoke();
                            let _ = start.response.send(Err(UNAVAILABLE.into()));
                        }
                        Ok(true) => {
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
            view.host.lifecycle() != Lifecycle::Closed || view.checkpoint.draining()
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
                ui.runtime.shutdown().map_err(|_| UNAVAILABLE.to_owned())?;
                cef_tls_bridge::after_cef_shutdown();
            }
            shared().certificate_hooks.store(false, Ordering::Release);
        }
        Ok(())
    })
}
