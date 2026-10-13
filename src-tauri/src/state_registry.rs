use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

/// The shell shows this event as a toast (`useStartupFailureAlerts`).
const STARTUP_FAILURE_EVENT: &str = "startup-failure";

/// A startup failure the app survived, in the words the shell shows.
#[derive(Debug, PartialEq, Eq)]
struct StartupNotice {
    component: &'static str,
    message: String,
}

/// Startup has a handful of steps; held notices beyond this are dropped.
const HELD_NOTICE_LIMIT: usize = 16;

/// Failures the shell has not been told about. It cannot listen while setup
/// runs, so they are held until it reports ready and are then sent once.
struct StartupNotices {
    shell_ready: bool,
    held: Vec<StartupNotice>,
}

impl StartupNotices {
    const fn new() -> Self {
        Self {
            shell_ready: false,
            held: Vec::new(),
        }
    }

    /// The notice when the shell can take it now; otherwise it is held.
    fn report(&mut self, notice: StartupNotice) -> Option<StartupNotice> {
        if self.shell_ready {
            return Some(notice);
        }
        if self.held.len() < HELD_NOTICE_LIMIT {
            self.held.push(notice);
        }
        None
    }

    /// Everything held, exactly once. Later notices are due as they arrive.
    fn shell_ready(&mut self) -> Vec<StartupNotice> {
        self.shell_ready = true;
        std::mem::take(&mut self.held)
    }
}

static STARTUP_NOTICES: Mutex<StartupNotices> = Mutex::new(StartupNotices::new());

fn startup_notices() -> std::sync::MutexGuard<'static, StartupNotices> {
    STARTUP_NOTICES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn emit_startup_notice(app: &tauri::AppHandle, notice: &StartupNotice) {
    let payload = serde_json::json!({
        "component": notice.component,
        "message": notice.message,
    });
    if let Err(error) = app.emit(STARTUP_FAILURE_EVENT, payload) {
        log::warn!(
            "Startup notice component={} was not delivered: {error}",
            notice.component
        );
    }
}

/// Tell the user that `component` did not start and the app carried on. The
/// cause belongs in the log; `message` is the sentence the toast shows.
pub(crate) fn report_startup_failure(
    app: &tauri::AppHandle,
    component: &'static str,
    message: String,
) {
    let due = startup_notices().report(StartupNotice { component, message });
    if let Some(notice) = due {
        emit_startup_notice(app, &notice);
    }
}

/// The shell is listening: it closed the splash, which it does once ready.
pub(crate) fn shell_ready(app: &tauri::AppHandle) {
    let due = startup_notices().shell_ready();
    for notice in &due {
        emit_startup_notice(app, notice);
    }
}

/// Without a splash the shell has no window to close, so held notices are
/// released once a cold start has had time to mount its listeners.
pub(crate) fn shell_ready_after(app: &tauri::AppHandle, delay: std::time::Duration) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        shell_ready(&app);
    });
}

/// A setup step the app runs without. The cause is logged once, the value is
/// absent, and the feature that needs it refuses on its own.
pub(crate) fn recoverable<T, E: std::fmt::Display>(
    stage: &'static str,
    effect: &'static str,
    result: Result<T, E>,
) -> Option<T> {
    match result {
        Ok(value) => Some(value),
        Err(cause) => {
            log::error!("Startup stage={stage} unavailable cause={cause}; {effect}");
            None
        }
    }
}

/// A setup step the app cannot run without. Its cause goes to the log. The
/// user is shown these fixed words instead, because a cause can name the
/// profile folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FatalStep {
    AppData,
    #[cfg_attr(not(feature = "ops"), allow(dead_code))]
    CredentialLifecycle,
}

impl FatalStep {
    fn stage(self) -> &'static str {
        match self {
            Self::AppData => "app-data",
            Self::CredentialLifecycle => "credential-lifecycle",
        }
    }

    /// What happened and what to do next.
    fn message(self) -> String {
        let words = match self {
            Self::AppData => "The application data folder could not be opened. Check that the folder is reachable and writable, then start the application again.",
            Self::CredentialLifecycle => "The credential tracking file could not be read or created. An existing file was left unchanged. Check that credentials/tracker-state-v1.json in the application data folder is readable and writable, or restore it from a backup, then start the application again.",
        };
        format!("{words}\n\nStartup stage: {}", self.stage())
    }
}

/// Log the cause of a fatal step and name the step. The cause is flushed here
/// because the process ends before anything else is written.
fn fatal<T, E: std::fmt::Display>(step: FatalStep, result: Result<T, E>) -> Result<T, FatalStep> {
    result.map_err(|cause| {
        log::error!(
            "Startup stage={} failed cause={cause}; the application cannot start",
            step.stage()
        );
        log::logger().flush();
        step
    })
}

/// How a failed start ends.
#[derive(Debug, PartialEq, Eq)]
enum FailedStartEnding {
    /// A person is watching: one dialog, then exit when it is dismissed.
    Dialog,
    /// A harness is: it would wait on a dialog for ever.
    ExitNow,
}

fn failed_start_ending(harness_run: bool) -> FailedStartEnding {
    if harness_run {
        FailedStartEnding::ExitNow
    } else {
        FailedStartEnding::Dialog
    }
}

/// Exit status of a start that ended at a fatal step (`EX_SOFTWARE`, as the
/// profile guard uses for its own failures).
const FAILED_START_EXIT_CODE: i32 = 70;
const FAILED_START_TITLE: &str = "sortOfRemoteNG could not start";

fn exit_failed_start(step: FatalStep) -> ! {
    eprintln!(
        "{FAILED_START_TITLE}. {}",
        step.message().replace("\n\n", " ")
    );
    std::process::exit(FAILED_START_EXIT_CODE)
}

/// The dialog a failure is announced with, unless a harness runs the app: it
/// would wait on a dialog for ever. The e2e and CI harness sets this variable
/// for every app it launches, and `app_profile` treats it as a harness run too.
fn failure_dialog<M: Manager<tauri::Wry>>(
    app: &M,
) -> Option<tauri::State<'_, tauri_plugin_dialog::Dialog<tauri::Wry>>> {
    let harness_run =
        std::env::var_os(sorng_core::app_identity::EXPECT_ISOLATED_PROFILE_ENV).is_some();
    app.try_state::<tauri_plugin_dialog::Dialog<tauri::Wry>>()
        .filter(|_| failed_start_ending(harness_run) == FailedStartEnding::Dialog)
}

/// End a start that reached a fatal step, visibly instead of with nothing on
/// screen. Nothing of the app is reachable while the dialog is up: this runs
/// inside setup on the main thread, where closing a webview takes effect at
/// once, so every webview is gone before the event loop turns again, and a
/// webview that cannot be closed ends the process instead. Without a webview
/// there is no shell and no caller for any command, and the caller skips the
/// rest of setup, so the REST API and the splash never start.
pub(crate) fn fail_start(app: &tauri::App<tauri::Wry>, step: FatalStep) {
    let Some(dialog) = failure_dialog(app) else {
        exit_failed_start(step);
    };
    // The navigation guard's handlers hold the main webview; release them
    // before it goes.
    crate::web_network_guard::close();
    for window in app.webview_windows().into_values() {
        let webview: &tauri::Webview<tauri::Wry> = window.as_ref();
        if webview.close().is_err() {
            exit_failed_start(step);
        }
        let _ = window.hide();
    }
    dialog
        .message(step.message())
        .title(FAILED_START_TITLE)
        .kind(tauri_plugin_dialog::MessageDialogKind::Error)
        .show(|_| std::process::exit(FAILED_START_EXIT_CODE));
}

/// The end of the process after the native browser's engine failed in a way
/// that obliges it: CEF's contract after a failed Initialize is to exit
/// without calling any other CEF function.
#[cfg(feature = "native-browser")]
mod engine_failure {
    /// Exit status of that end (`EX_OSERR`), apart from a failed start's.
    const EXIT_CODE: i32 = 71;
    const TITLE: &str = "sortOfRemoteNG has to close";

    /// The running app, for a failure met outside any command or event.
    pub(super) static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

    /// What the user is told. Fixed words and CEF's numeric code only.
    pub(super) fn message(cef_code: Option<i32>) -> String {
        let code = cef_code
            .map(|code| format!(", code {code}"))
            .unwrap_or_default();
        format!(
            "The built-in browser could not start, and the application has to close because of it. Open sessions stay connected until you close this message and end when you do. Start sortOfRemoteNG again afterwards.\n\nNative browser stage: initializing{code}"
        )
    }

    pub(super) fn end(cef_code: Option<i32>) {
        let message = message(cef_code);
        let app = APP.get();
        let Some((app, dialog)) = app.and_then(|app| Some((app, super::failure_dialog(app)?)))
        else {
            eprintln!("{TITLE}. {}", message.replace("\n\n", " "));
            if let Some(app) = app {
                super::clear_secure_clipboard_on_exit(app);
            }
            std::process::exit(EXIT_CODE);
        };
        let app = app.clone();
        dialog
            .message(message)
            .title(TITLE)
            .kind(tauri_plugin_dialog::MessageDialogKind::Error)
            .show(move |_| {
                super::clear_secure_clipboard_on_exit(&app);
                std::process::exit(EXIT_CODE)
            });
    }
}

/// Announce that the process has to end because of the native browser's
/// engine, instead of letting every window vanish, and call no CEF function
/// doing it. With a person watching: one dialog, and the process ends when it
/// is dismissed, so sessions the user is in the middle of stay connected until
/// then; this returns meanwhile. Under a harness, or with no dialog to show:
/// a line on stderr and the end at once. Either way the secure clipboard is
/// released first, because this exit skips the run events.
#[cfg(feature = "native-browser")]
pub(crate) fn end_for_engine_failure(cef_code: Option<i32>) {
    engine_failure::end(cef_code);
}

/// Saved-route services for website tabs in the native browser. Recoverable:
/// their only consumer (`origin_browser_routes::expand`) refuses a saved
/// connection chain while they are absent and needs them for nothing else.
#[cfg(feature = "native-browser")]
mod native_browser_routes {
    use sorng_commands_core::origin_browser_authority::NativeBrowserRouteServices;
    use tauri::Manager;

    const STAGE: &str = "native-browser-routes";
    const EFFECT: &str = "website tabs that use a saved connection chain are refused until restart";
    const NOTICE: &str = "Saved connection chains are unavailable for website tabs until the application restarts: their route service could not start. Other connections are not affected. If this happens again, check that the application data folder is accessible.";

    /// Why the services are absent. Fixed words and an `io::ErrorKind` only:
    /// never a path.
    #[derive(Debug)]
    pub(super) enum Failure {
        EncryptionStateMissing,
        ChainingStateMissing,
        ProfileRootUnavailable(Option<std::io::ErrorKind>),
    }

    impl std::fmt::Display for Failure {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            match self {
                Self::EncryptionStateMissing => f.write_str("encryption-state-missing"),
                Self::ChainingStateMissing => f.write_str("chaining-state-missing"),
                Self::ProfileRootUnavailable(Some(kind)) => {
                    write!(f, "profile-root-unavailable kind={kind:?}")
                }
                Self::ProfileRootUnavailable(None) => f.write_str("profile-root-unavailable"),
            }
        }
    }

    fn services(
        app: &tauri::App<tauri::Wry>,
        app_dir: &std::path::Path,
    ) -> Result<NativeBrowserRouteServices, Failure> {
        // The process profile was verified before this registrar. Bind the
        // exact infrastructure encryption owner and connectivity chain service;
        // never create a second service or resolve a default profile here.
        let encryption = app
            .try_state::<sorng_encryption::EncryptionState>()
            .ok_or(Failure::EncryptionStateMissing)?;
        let chains = app
            .try_state::<sorng_commands_core::chaining::ChainingServiceState>()
            .ok_or(Failure::ChainingStateMissing)?;
        NativeBrowserRouteServices::new(app_dir, encryption.inner(), chains.inner().clone())
            // The constructor fails only when the profile root cannot be
            // resolved; ask again for the kind its error does not carry.
            .map_err(|_| {
                Failure::ProfileRootUnavailable(
                    app_dir.canonicalize().err().map(|error| error.kind()),
                )
            })
    }

    pub(super) fn bind(app: &mut tauri::App<tauri::Wry>, app_dir: &std::path::Path) {
        let Some(routes) = super::recoverable(STAGE, EFFECT, services(app, app_dir)) else {
            super::report_startup_failure(app.handle(), "native_browser_routes", NOTICE.to_owned());
            return;
        };
        if !app.manage(routes) {
            // Not a second service: this one is dropped and the first stays,
            // and it checks its encryption owner and profile root on every use.
            log::error!(
                "Startup stage={STAGE} cause=already-registered; keeping the first registration"
            );
        }
    }
}

/// The Wake-on-LAN scheduler. Recoverable: its consumers are the `sched_*`
/// commands, which answer an error while its state is absent, and the exit
/// hook, which looks the state up. A scheduler that cannot load is skipped for
/// this run. Nothing then holds its path, so the saved schedule is neither
/// reset nor rewritten and can be inspected or repaired.
#[cfg(feature = "ops")]
mod scheduler_startup {
    const STAGE: &str = "scheduler";
    const EFFECT: &str =
        "scheduled tasks do not run in this session and the saved schedule is left unchanged";

    /// Why scheduled tasks are not running, in the words the toast shows.
    /// `register_scheduler` reports saved state it cannot load as invalid data.
    pub(super) fn notice(cause: Option<std::io::ErrorKind>) -> &'static str {
        match cause {
            Some(std::io::ErrorKind::InvalidData) => "Scheduled tasks are not running: the saved schedule could not be read. The file (scheduler-wol-state-v1.json in the application data folder) was left unchanged, so nothing is lost. Repair or remove it, then restart the application.",
            _ => "Scheduled tasks are not running: the scheduler could not be started. The saved schedule was left unchanged. Restart the application to try again.",
        }
    }

    pub(super) fn settle(app: &tauri::AppHandle, started: tauri::Result<()>) {
        let cause = match &started {
            Err(tauri::Error::Io(error)) => Some(error.kind()),
            _ => None,
        };
        if super::recoverable(STAGE, EFFECT, started).is_none() {
            super::report_startup_failure(app, "scheduler", notice(cause).to_owned());
        }
    }
}

/// Clear-on-exit for the secure clipboard.
#[cfg(any(feature = "collab", feature = "platform"))]
mod exit_clear {
    use tauri::Manager;

    /// One line for what the clear did. `cleared` is the service's answer:
    /// whether an owned entry was retired, or its fixed refusal code.
    pub(super) fn report<C: std::fmt::Display>(cleared: Result<bool, C>) {
        match cleared {
            // The owned entry is gone, and with it its value on the OS
            // clipboard when that value was still there.
            Ok(true) => log::info!("Secure clipboard: the owned entry was released on exit"),
            // Nothing owned, or clear-on-exit is switched off.
            Ok(false) => {}
            Err(code) => log::warn!(
                "Secure clipboard: clear on exit failed cause={code}; an owned secret may remain on the OS clipboard"
            ),
        }
    }

    pub(super) fn run(app: &tauri::AppHandle) {
        let Some(state) = app.try_state::<crate::secure_clip::SecureClipServiceState>() else {
            return;
        };
        // The service's own exit entry: synchronous, so no async runtime is
        // entered on the way out, and bounded, so a clipboard command still
        // in flight delays the exit briefly and is then reported as `busy`.
        report(crate::secure_clip::service::clear_on_exit_blocking(
            state.inner(),
        ));
    }
}

/// Release what the secure clipboard owns before the process ends. The engine
/// clears only a value it wrote and that is still on the OS clipboard; with no
/// owned entry it does not open the clipboard at all.
pub(crate) fn clear_secure_clipboard_on_exit(app: &tauri::AppHandle) {
    #[cfg(any(feature = "collab", feature = "platform"))]
    exit_clear::run(app);
    #[cfg(not(any(feature = "collab", feature = "platform")))]
    let _ = app;
}

/// The signed Windows update install ends the process from inside the updater
/// plugin, so that route reaches neither run event. The updater runs this
/// before it hands over.
fn hand_exit_clear_to_updater(app: &tauri::App<tauri::Wry>) {
    let Some(updater) = app.try_state::<crate::updater::service::UpdaterServiceState>() else {
        return;
    };
    let handle = app.handle().clone();
    updater.set_before_exit(move || clear_secure_clipboard_on_exit(&handle));
}

pub(crate) fn register(app: &mut tauri::App<tauri::Wry>) -> Result<(), FatalStep> {
    #[cfg(feature = "native-browser")]
    let _ = engine_failure::APP.set(app.handle().clone());
    // Fatal by design: every key, store and log lives under the app data
    // directory, and this fails only when that directory cannot be resolved.
    let infrastructure = fatal(
        FatalStep::AppData,
        sorng_app_startup_state::register_infrastructure_prefix(
            app,
            resolve_user_store_path,
            crate::event_bridge::from_app_handle,
        ),
    )?;
    let app_dir = infrastructure.app_dir;
    let auth_service = infrastructure.auth_service;
    let ssh_service = infrastructure.ssh_service;
    let emitter = infrastructure.emitter;
    hand_exit_clear_to_updater(app);

    let api_handles =
        sorng_app_startup_connectivity::register(app, ssh_service.clone(), emitter.clone());
    #[cfg(feature = "native-browser")]
    native_browser_routes::bind(app, &app_dir);
    sorng_app_startup_state::register_security_data(
        app,
        &app_dir,
        emitter,
        crate::event_bridge::from_app_handle,
    );

    sorng_app_startup_state::register_access(app);

    #[cfg(any(feature = "ops", feature = "collab", feature = "platform"))]
    sorng_app_startup_state::register_platform(app);
    #[cfg(any(feature = "collab", feature = "platform"))]
    sorng_app_startup_state::register_collab(app, &app_dir);
    // Fatal as its registrar wrote it: a credential tracker snapshot that is
    // corrupt or unsafe aborts startup instead of being silently reset.
    #[cfg(feature = "ops")]
    fatal(
        FatalStep::CredentialLifecycle,
        sorng_app_domains::ops_startup_state::register(app, &app_dir),
    )?;
    #[cfg(feature = "ops")]
    {
        let scheduler = sorng_app_domains::ops_startup_state::register_scheduler(app, &app_dir);
        scheduler_startup::settle(app.handle(), scheduler);
    }

    // t40-f2: recover crash-orphaned in-flight terminal recordings. f2's
    // incremental-flush writer persists a crash snapshot under
    // `<root>/inflight/` on every append; a power-loss or hard-kill during
    // an active session leaves that snapshot un-finalised. Run recovery once
    // here (the recording state was managed in the always-on security/data registrar, with
    // its encryption handle already injected) so orphaned snapshots are
    // decoded and saved into the library. Best-effort and self-healing: the
    // service SKIPS encrypted snapshots while the key is locked and they are
    // retried when the frontend re-invokes the `rec_recover_crashed` command
    // after unlock — the same fail-open pattern as the capability priming
    // below. Vault-mode installs are already unlocked at this point, so their
    // snapshots recover on this pass.
    #[cfg(any(feature = "collab", feature = "platform"))]
    if let Some(rec_state) = app.try_state::<crate::recording::RecordingServiceState>() {
        let rec = rec_state.inner().clone();
        tauri::async_runtime::block_on(async move {
            let svc = rec.lock().await;
            match svc.recover_crashed_terminal_recordings().await {
                Ok(n) if n > 0 => log::info!(
                    "Recording crash-recovery: finalised {n} orphaned in-flight terminal recording(s)."
                ),
                Ok(_) => {}
                Err(e) => log::warn!("Recording crash-recovery failed at startup: {e}"),
            }
        });
    }

    let api_service = sorng_app_startup_state::register_api_service(
        app,
        auth_service.clone(),
        ssh_service.clone(),
        &api_handles,
    );

    // Read the persisted settings once: (1) prime the disabled-capability set
    // so the capability gate is enforced from the very first request, not just
    // after the user opens Settings → API, and (2) resolve the REST API runtime
    // config that governs boot-time startup and the launcher below. Uses the
    // v0/v2-dispatching reader — the silent vault unlock above means the
    // encrypted form is readable for vault-mode installs. Password / hybrid
    // installs surface "locked" and fall through to safe defaults (API stays
    // off); the capabilities load anyway as soon as the user unlocks.
    let settings_value = match tauri::async_runtime::block_on(read_api_settings_snapshot(
        app.app_handle(),
        &app_dir,
    )) {
        Ok(Some(settings)) => settings,
        Ok(None) => serde_json::json!({}),
        Err(error) => {
            log::warn!("REST API settings were unavailable; startup remains disabled: {error}");
            serde_json::json!({})
        }
    };

    if let Some(list) = settings_value
        .get("restApi")
        .and_then(|r| r.get("disabledCapabilities"))
        .and_then(|d| d.as_array())
    {
        let ids: Vec<String> = list
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !ids.is_empty() {
            api_service.set_disabled_capabilities(ids);
        }
    }

    // t41-e5: resolve the REST API runtime config (bind addr, auth, TLS, key,
    // store path — env overrides settings per Decision D2) for the boot-time
    // auto-start decision, then register the lifecycle controller + launcher so
    // Settings → API can start/stop/restart the server at runtime regardless of
    // whether it auto-starts now.
    let boot_config = crate::api_config::ApiRuntimeConfig::resolve(&settings_value, &app_dir);

    // The launcher bridge: the crate-agnostic `ApiServerController` (compiled
    // into sorng-commands-core, where `api::start_server` / `api_config` are
    // NOT nameable) receives this closure from the app crate. On each start it
    // re-resolves the CURRENT settings+env (so a Settings change followed by a
    // restart takes effect), fails closed if auth is required without a key,
    // persists any freshly-generated secrets, validates TLS and pre-binds the
    // listener, then spawns the ready axum server and hands back its actual
    // secret-free launch snapshot. Mirrors the DisabledCapsSetter bridge used
    // for live capability updates above.
    let services_for_launcher = Arc::new(api_service.clone());
    let app_handle_for_launcher = app.app_handle().clone();
    let launcher =
        sorng_commands_core::api_server_commands::ApiServerLauncher::new(move |shutdown_rx| {
            let services = services_for_launcher.clone();
            let app_handle = app_handle_for_launcher.clone();
            Box::pin(async move {
                let app_dir = app_handle
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
                let settings = read_api_settings_snapshot(&app_handle, &app_dir)
                    .await?
                    .unwrap_or_else(|| serde_json::json!({}));
                let env_api_key = std::env::var("API_KEY")
                    .ok()
                    .filter(|value| !value.trim().is_empty());
                let env_jwt_secret = std::env::var("JWT_SECRET")
                    .ok()
                    .filter(|value| !value.trim().is_empty());
                let vault_secrets = if env_api_key.is_none() || env_jwt_secret.is_none() {
                    Some(crate::app_settings_commands::ensure_rest_api_runtime_secrets().await?)
                } else {
                    None
                };
                let config = crate::api_config::ApiRuntimeConfig::resolve_with_native_secrets(
                    &settings,
                    &app_dir,
                    vault_secrets
                        .as_ref()
                        .map(|secrets| secrets.api_key.as_str()),
                    vault_secrets
                        .as_ref()
                        .map(|secrets| secrets.jwt_secret.as_str()),
                );
                config.validate_for_start()?;

                let auth_required = config.auth_required;
                let server = crate::api::prepare_server(config, services, shutdown_rx)
                    .await
                    .map_err(|err| format!("failed to prepare REST API server: {err}"))?;
                let local_addr = server.local_addr();

                let join = tokio::spawn(async move {
                    if let Err(err) = server.serve().await {
                        log::error!("REST API server exited with error: {err}");
                    }
                });

                Ok(sorng_commands_core::api_server_commands::ServerLaunch {
                    join,
                    bind_addr: local_addr.to_string(),
                    port: local_addr.port(),
                    auth_required,
                })
            }) as sorng_commands_core::api_server_commands::LaunchFuture
        });

    // Register the controller under the CONCRETE sorng-commands-core type so
    // the `api_server_*` Tauri commands (which read
    // `State<'_, ApiServerController>` from that crate) resolve it — Tauri state
    // is keyed by TypeId, the same gotcha as DisabledCapsSetter above.
    sorng_app_startup_state::register_api_server_controller(app, launcher);

    // Boot-time auto-start decision (Decision D1: default OFF). Auto-start only
    // when the opt-in master switch AND startOnLaunch are set;
    // `SORNG_ENABLE_REST_API` is the headless/automation escape hatch that
    // forces a start regardless of persisted settings. When neither applies the
    // server stays stopped but fully controllable from Settings → API.
    let env_force_enable = std::env::var("SORNG_ENABLE_REST_API")
        .map(|v| {
            let v = v.trim().to_ascii_lowercase();
            v == "1" || v == "true" || v == "yes" || v == "on"
        })
        .unwrap_or(false);
    let should_auto_start =
        env_force_enable || (boot_config.enabled && boot_config.start_on_launch);

    if !should_auto_start {
        log::info!(
            "REST API server not auto-starting (enabled={}, startOnLaunch={}, env_force={}). \
             Start it from Settings → API when needed.",
            boot_config.enabled,
            boot_config.start_on_launch,
            env_force_enable
        );
        return Ok(());
    }

    log::info!(
        "REST API server auto-starting on launch ({}).",
        if env_force_enable {
            "SORNG_ENABLE_REST_API env override"
        } else {
            "restApi.enabled + startOnLaunch"
        }
    );

    // Drive the initial start through the managed controller so its status
    // snapshot and shutdown handle track the auto-started server (a later
    // Settings → API stop/restart then works). Spawned because `register` is
    // sync and `start()` is async; a bind/config failure surfaces the same
    // non-fatal `startup-failure` alert the stopgap used, held until the
    // shell listens: a bind usually fails long before the shell has loaded.
    let app_handle_for_start = app.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        let controller = app_handle_for_start
            .state::<sorng_commands_core::api_server_commands::ApiServerController>();
        match controller.start().await {
            Ok(status) => {
                log::info!(
                    "REST API server started on {} (auth_required={}).",
                    status.bind_addr,
                    status.auth_required
                );
            }
            Err(err) => {
                log::error!("Failed to auto-start REST API server: {err}");
                report_startup_failure(
                    &app_handle_for_start,
                    "rest_api_server",
                    format!("Failed to start REST API server: {err}"),
                );
            }
        }
    });

    Ok(())
}

fn resolve_user_store_path(
    app_handle: &tauri::AppHandle,
    app_dir: &std::path::Path,
) -> std::path::PathBuf {
    let settings = tauri::async_runtime::block_on(read_api_settings_snapshot(app_handle, app_dir))
        .ok()
        .flatten()
        .unwrap_or_else(|| serde_json::json!({}));
    crate::api_config::ApiRuntimeConfig::resolve(&settings, app_dir).user_store_path
}

/// Read the persisted app settings as raw JSON, or `None` when the encryption
/// state is unavailable/locked or no settings exist yet. Shared by the REST API
/// startup path so config is resolved from the same store the UI writes to.
async fn read_api_settings_snapshot(
    app_handle: &tauri::AppHandle,
    app_dir: &std::path::Path,
) -> Result<Option<serde_json::Value>, String> {
    let enc_state = app_handle
        .try_state::<sorng_encryption::EncryptionState>()
        .ok_or_else(|| "encryption state unavailable".to_string())?;
    crate::app_settings_commands::read_app_settings_secure_inner(app_dir, &enc_state).await
}
