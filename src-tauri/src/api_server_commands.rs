//! Runtime control surface for the external REST API server (t41).
//!
//! This file owns the [`ApiServerController`] — the managed Tauri state that
//! drives the axum server's lifecycle — plus the `api_server_{start,stop,
//! restart,status}` and `api_regenerate_key` Tauri commands the frontend
//! (Settings → API) invokes.
//!
//! ## Why the controller does not call `api::start_server` directly
//!
//! Exactly like `api_capability_commands.rs`, this source file is
//! `#[path]`-included into `sorng-commands-core` for the Tauri command
//! registration (see `core_handler.rs`). That crate deliberately does **not**
//! contain `api.rs` / `api_config.rs` / `state_registry.rs` — those live only
//! in the main `app` crate. So the controller cannot name
//! `api::start_server` or `api_config::ApiRuntimeConfig`.
//!
//! Instead it holds an [`ApiServerLauncher`] — a boxed async closure the main
//! app crate registers at startup (`state_registry`) that captures the real
//! backend `ApiService`, resolves the current [`ApiRuntimeConfig`] from
//! settings, spawns `api::start_server(config, services, shutdown_rx)`, and
//! reports back a join handle + a secret-free status snapshot. This mirrors
//! the `DisabledCapsSetter` bridge already used for live capability updates,
//! and keeps the resolve-config-and-spawn logic (which needs app-crate types)
//! on the app-crate side of the boundary.
//!
//! [`ApiRuntimeConfig`]: crate::api_config::ApiRuntimeConfig

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

/// How long `stop`/`restart` wait for a graceful shutdown before aborting the
/// server task outright. Generous enough for in-flight requests to drain, but
/// bounded so the UI never hangs on a wedged server.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

/// Number of random bytes for a regenerated API key. 32 bytes = 256 bits,
/// matching the entropy the config resolver uses for auto-generated secrets.
const API_KEY_BYTES: usize = 32;

/// Secret-free status snapshot returned by `api_server_status` and by the
/// start/restart commands.
///
/// Deliberately carries **no** `api_key` / `jwt_secret`: the controller never
/// stores secret material, so it can never be logged or leaked to the
/// frontend through this struct (§6 hard invariant).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiServerStatus {
    /// Whether the server task is currently running.
    pub running: bool,
    /// Resolved bind address, e.g. `"127.0.0.1:9876"`. Empty before first start.
    pub bind_addr: String,
    /// Configured port. `0` when an OS-assigned ephemeral port was requested
    /// and the real value is not yet known to the controller.
    pub port: u16,
    /// Whether callers must authenticate (forced on for remote exposure).
    pub auth_required: bool,
}

/// The outcome of one successful server launch, handed back to the controller
/// by the app-crate [`ApiServerLauncher`].
pub struct ServerLaunch {
    /// Join handle of the spawned axum server task. Completes when the server
    /// stops (graceful shutdown, bind failure, or panic).
    pub join: JoinHandle<()>,
    /// Resolved bind address for the status snapshot (`ip:port`).
    pub bind_addr: String,
    /// Resolved/configured port for the status snapshot.
    pub port: u16,
    /// Whether authentication is required for this run.
    pub auth_required: bool,
}

/// Boxed future returned by an [`ApiServerLauncher`] invocation.
pub type LaunchFuture = Pin<Box<dyn Future<Output = Result<ServerLaunch, String>> + Send>>;

/// Bridge the main app crate registers so this crate-agnostic controller can
/// spawn the real (app-crate) axum server without depending on `api.rs`.
///
/// The closure receives the shutdown `Receiver` for this run and must:
/// resolve the current config from settings, spawn
/// `api::start_server(config, services, shutdown_rx)`, and return the join
/// handle + a secret-free [`ServerLaunch`]. Returning `Err(reason)` (e.g. a
/// fail-closed "auth required but no key" refusal) surfaces to the caller and
/// leaves the controller stopped.
///
/// Registered in Tauri state by `state_registry` as
/// `sorng_commands_core::api_server_commands::ApiServerLauncher` so the
/// concrete type matches the one this crate's commands read (Tauri state is
/// keyed by `TypeId`).
#[derive(Clone)]
pub struct ApiServerLauncher(pub Arc<dyn Fn(oneshot::Receiver<()>) -> LaunchFuture + Send + Sync>);

impl ApiServerLauncher {
    /// Convenience constructor from a plain closure.
    pub fn new<F>(f: F) -> Self
    where
        F: Fn(oneshot::Receiver<()>) -> LaunchFuture + Send + Sync + 'static,
    {
        ApiServerLauncher(Arc::new(f))
    }
}

/// Mutable interior of the controller, guarded by a std `Mutex`. The lock is
/// only ever held for brief field swaps — never across an `.await`.
struct ControllerState {
    /// Join handle of the running server task, if any.
    join: Option<JoinHandle<()>>,
    /// Shutdown signaler for the running server task, if any.
    shutdown: Option<oneshot::Sender<()>>,
    /// Last-known status snapshot (secret-free).
    status: ApiServerStatus,
}

/// Managed Tauri state driving the REST API server lifecycle.
///
/// Registered once at startup by `state_registry`; the `api_server_*` commands
/// pull it out of Tauri state and delegate to its methods.
pub struct ApiServerController {
    state: Mutex<ControllerState>,
    launcher: ApiServerLauncher,
}

impl ApiServerController {
    /// Build a controller around the app-crate-provided launcher bridge.
    pub fn new(launcher: ApiServerLauncher) -> Self {
        ApiServerController {
            state: Mutex::new(ControllerState {
                join: None,
                shutdown: None,
                status: ApiServerStatus::default(),
            }),
            launcher,
        }
    }

    /// True when a server task is present and has not yet finished.
    fn is_running(state: &ControllerState) -> bool {
        match &state.join {
            Some(join) => !join.is_finished(),
            None => false,
        }
    }

    /// Start the server. Returns the resulting status, or an error if the
    /// server is already running or the launcher refused (fail-closed).
    pub async fn start(&self) -> Result<ApiServerStatus, String> {
        // Double-start guard (peek only; do not hold the lock across the await).
        {
            let state = self.state.lock().unwrap();
            if Self::is_running(&state) {
                return Err("REST API server is already running".to_string());
            }
        }

        let (tx, rx) = oneshot::channel();
        let launch = (self.launcher.0)(rx).await?;
        let status = ApiServerStatus {
            running: true,
            bind_addr: launch.bind_addr,
            port: launch.port,
            auth_required: launch.auth_required,
        };

        let mut state = self.state.lock().unwrap();
        // Re-check after the await: another task may have won the race while
        // we were launching. If so, abort the server we just spawned so we
        // never leak two concurrent listeners.
        if Self::is_running(&state) {
            launch.join.abort();
            return Err("REST API server is already running".to_string());
        }
        state.join = Some(launch.join);
        state.shutdown = Some(tx);
        state.status = status.clone();
        Ok(status)
    }

    /// Stop the server gracefully, aborting if it does not drain within
    /// [`SHUTDOWN_GRACE`]. Idempotent: stopping an already-stopped server is a
    /// no-op success.
    pub async fn stop(&self) -> Result<(), String> {
        let (shutdown, join) = {
            let mut state = self.state.lock().unwrap();
            (state.shutdown.take(), state.join.take())
        };

        if let Some(shutdown) = shutdown {
            // A dropped receiver just means the task already ended — ignore.
            let _ = shutdown.send(());
        }

        if let Some(join) = join {
            let abort = join.abort_handle();
            if tokio::time::timeout(SHUTDOWN_GRACE, join).await.is_err() {
                abort.abort();
                log::warn!(
                    "REST API server did not shut down within {SHUTDOWN_GRACE:?}; aborted"
                );
            }
        }

        let mut state = self.state.lock().unwrap();
        state.status.running = false;
        Ok(())
    }

    /// Stop (if running) then start with freshly-resolved config. Used when the
    /// user changes settings that only take effect on a listener restart.
    pub async fn restart(&self) -> Result<ApiServerStatus, String> {
        self.stop().await?;
        self.start().await
    }

    /// Current status snapshot. Reconciles the `running` flag if the server
    /// task ended on its own (bind failure / panic) since the last operation.
    pub fn status(&self) -> ApiServerStatus {
        let mut state = self.state.lock().unwrap();
        if state.status.running && !Self::is_running(&state) {
            state.status.running = false;
        }
        state.status.clone()
    }
}

/// Generate a fresh hex-encoded CSPRNG API key (`API_KEY_BYTES` bytes).
fn generate_api_key() -> String {
    use rand::rngs::OsRng;
    use rand::RngCore;
    let mut buf = [0u8; API_KEY_BYTES];
    OsRng.fill_bytes(&mut buf);
    hex::encode(buf)
}

// ── Tauri commands ───────────────────────────────────────────────────────

/// Start the REST API server. No-op error if already running.
#[tauri::command]
pub async fn api_server_start(
    controller: tauri::State<'_, ApiServerController>,
) -> Result<ApiServerStatus, String> {
    controller.start().await
}

/// Stop the REST API server (graceful, with an abort fallback).
#[tauri::command]
pub async fn api_server_stop(
    controller: tauri::State<'_, ApiServerController>,
) -> Result<(), String> {
    controller.stop().await
}

/// Restart the REST API server, re-resolving config from settings.
#[tauri::command]
pub async fn api_server_restart(
    controller: tauri::State<'_, ApiServerController>,
) -> Result<ApiServerStatus, String> {
    controller.restart().await
}

/// Report the live server status (running, bind address, port, auth-required).
#[tauri::command]
pub fn api_server_status(
    controller: tauri::State<'_, ApiServerController>,
) -> ApiServerStatus {
    controller.status()
}

/// Generate a new API key, persist it to `settings.restApi.apiKey`, and return
/// it to the caller (once). The running server keeps its current key until it
/// is restarted — the frontend is expected to prompt for / trigger a restart.
///
/// Security: the new key is written to the encrypted settings store and
/// returned exactly once; it is **never** logged.
#[tauri::command]
pub async fn api_regenerate_key(
    app: tauri::AppHandle,
    enc_state: tauri::State<'_, sorng_encryption::EncryptionState>,
) -> Result<String, String> {
    use tauri::Manager;

    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // Read the current settings so we can preserve every sibling `restApi`
    // field — `write_app_settings_inner` shallow-merges at the *root*, so a
    // bare `{ "restApi": { "apiKey": ... } }` patch would otherwise clobber
    // the rest of the object.
    let current = crate::app_settings_commands::read_app_settings_inner(&dir, &enc_state)
        .await?
        .unwrap_or_else(|| serde_json::json!({}));

    let mut rest = current
        .get("restApi")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    let new_key = generate_api_key();
    rest.insert(
        "apiKey".to_string(),
        serde_json::Value::String(new_key.clone()),
    );

    let patch = serde_json::json!({ "restApi": serde_json::Value::Object(rest) });
    crate::app_settings_commands::write_app_settings_inner(&dir, &enc_state, patch).await?;

    // NOTE: never log `new_key`.
    Ok(new_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A launcher whose spawned "server" simply blocks until the shutdown
    /// signal arrives, so the controller sees a task that stays `running`
    /// until `stop()`. Records how many times it was invoked.
    fn blocking_launcher(
        bind_addr: &str,
        port: u16,
        auth_required: bool,
        calls: Arc<AtomicUsize>,
    ) -> ApiServerLauncher {
        let bind_addr = bind_addr.to_string();
        ApiServerLauncher::new(move |rx: oneshot::Receiver<()>| {
            let bind_addr = bind_addr.clone();
            let calls = calls.clone();
            Box::pin(async move {
                calls.fetch_add(1, Ordering::SeqCst);
                let join = tokio::spawn(async move {
                    // Stay alive until the controller signals shutdown.
                    let _ = rx.await;
                });
                Ok(ServerLaunch {
                    join,
                    bind_addr,
                    port,
                    auth_required,
                })
            }) as LaunchFuture
        })
    }

    /// A launcher that always refuses to start (fail-closed simulation).
    fn failing_launcher(reason: &'static str) -> ApiServerLauncher {
        ApiServerLauncher::new(move |_rx: oneshot::Receiver<()>| {
            Box::pin(async move { Err(reason.to_string()) }) as LaunchFuture
        })
    }

    /// A launcher whose task finishes immediately (simulates a server that
    /// died on its own, e.g. a bind failure).
    fn self_terminating_launcher() -> ApiServerLauncher {
        ApiServerLauncher::new(move |_rx: oneshot::Receiver<()>| {
            Box::pin(async move {
                let join = tokio::spawn(async move { /* returns at once */ });
                Ok(ServerLaunch {
                    join,
                    bind_addr: "127.0.0.1:9876".to_string(),
                    port: 9876,
                    auth_required: false,
                })
            }) as LaunchFuture
        })
    }

    #[tokio::test]
    async fn start_sets_running_and_reflects_config() {
        let calls = Arc::new(AtomicUsize::new(0));
        let ctrl = ApiServerController::new(blocking_launcher(
            "0.0.0.0:1234",
            1234,
            true,
            calls.clone(),
        ));

        let status = ctrl.start().await.expect("start should succeed");
        assert!(status.running);
        assert_eq!(status.bind_addr, "0.0.0.0:1234");
        assert_eq!(status.port, 1234);
        assert!(status.auth_required);
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        // status() mirrors the running server.
        let live = ctrl.status();
        assert!(live.running);
        assert_eq!(live.port, 1234);
    }

    #[tokio::test]
    async fn double_start_is_rejected() {
        let calls = Arc::new(AtomicUsize::new(0));
        let ctrl =
            ApiServerController::new(blocking_launcher("127.0.0.1:9876", 9876, false, calls.clone()));

        ctrl.start().await.expect("first start");
        let err = ctrl.start().await.expect_err("second start must fail");
        assert!(err.contains("already running"), "got: {err}");
        // The launcher must not have been invoked a second time.
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn stop_clears_running_state() {
        let calls = Arc::new(AtomicUsize::new(0));
        let ctrl =
            ApiServerController::new(blocking_launcher("127.0.0.1:9876", 9876, false, calls));

        ctrl.start().await.expect("start");
        assert!(ctrl.status().running);

        ctrl.stop().await.expect("stop");
        assert!(!ctrl.status().running);
    }

    #[tokio::test]
    async fn stop_when_never_started_is_ok() {
        let ctrl = ApiServerController::new(failing_launcher("unused"));
        // Idempotent: no server was ever started.
        ctrl.stop().await.expect("stop on idle controller is a no-op");
        assert!(!ctrl.status().running);
    }

    #[tokio::test]
    async fn restart_stops_then_starts_again() {
        let calls = Arc::new(AtomicUsize::new(0));
        let ctrl = ApiServerController::new(blocking_launcher(
            "127.0.0.1:9876",
            9876,
            false,
            calls.clone(),
        ));

        ctrl.start().await.expect("start");
        let status = ctrl.restart().await.expect("restart");
        assert!(status.running);
        // Launched twice: once for start, once for the restart's re-start.
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert!(ctrl.status().running);
    }

    #[tokio::test]
    async fn restart_from_stopped_just_starts() {
        let calls = Arc::new(AtomicUsize::new(0));
        let ctrl = ApiServerController::new(blocking_launcher(
            "127.0.0.1:9876",
            9876,
            false,
            calls.clone(),
        ));
        // Never started; restart should behave like a plain start.
        let status = ctrl.restart().await.expect("restart from stopped");
        assert!(status.running);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn launcher_failure_propagates_and_leaves_stopped() {
        let ctrl = ApiServerController::new(failing_launcher("auth required but no key"));
        let err = ctrl.start().await.expect_err("start must surface the refusal");
        assert!(err.contains("auth required"), "got: {err}");
        assert!(!ctrl.status().running);
    }

    #[tokio::test]
    async fn status_reconciles_when_server_task_ends() {
        let ctrl = ApiServerController::new(self_terminating_launcher());
        let status = ctrl.start().await.expect("start");
        // At the instant of start we reported running=true...
        assert!(status.running);

        // ...but the task returns immediately. Give the runtime a chance to
        // complete it, then status() must reconcile to running=false.
        for _ in 0..100 {
            if !ctrl.status().running {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(
            !ctrl.status().running,
            "status must reflect a server that ended on its own"
        );
    }

    #[test]
    fn generated_api_key_is_256_bit_hex() {
        let a = generate_api_key();
        let b = generate_api_key();
        assert_eq!(a.len(), API_KEY_BYTES * 2);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        // Overwhelmingly likely to differ — guards against a constant.
        assert_ne!(a, b);
    }
}
