use std::sync::Arc;
use tauri::{Emitter, Manager};

pub(crate) fn register(app: &mut tauri::App<tauri::Wry>) -> tauri::Result<()> {
    let infrastructure = sorng_app_startup_state::register_infrastructure_prefix(
        app,
        resolve_user_store_path,
        crate::event_bridge::from_app_handle,
    )?;
    let app_dir = infrastructure.app_dir;
    let auth_service = infrastructure.auth_service;
    let ssh_service = infrastructure.ssh_service;
    let emitter = infrastructure.emitter;

    let api_handles =
        sorng_app_startup_connectivity::register(app, ssh_service.clone(), emitter.clone());
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
    #[cfg(feature = "ops")]
    sorng_app_domains::ops_startup_state::register(app, &app_dir);

    // t40-f2: recover crash-orphaned in-flight terminal recordings. f2's
    // incremental-flush writer persists a crash snapshot under
    // `<root>/inflight/` on every append; a power-loss or hard-kill during
    // an active session leaves that snapshot un-finalised. Run recovery once
    // here (the recording state was just managed in `collab::register`, with
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
    let settings_value =
        tauri::async_runtime::block_on(read_api_settings_snapshot(app.app_handle(), &app_dir))
            .unwrap_or_else(|| serde_json::json!({}));

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
    // persists any freshly-generated secrets, spawns the axum server, and hands
    // back a secret-free launch snapshot. Mirrors the DisabledCapsSetter bridge
    // used for live capability updates above.
    let services_for_launcher = Arc::new(api_service.clone());
    let app_handle_for_launcher = app.app_handle().clone();
    let launcher = sorng_commands_core::api_server_commands::ApiServerLauncher::new(
        move |shutdown_rx| {
            let services = services_for_launcher.clone();
            let app_handle = app_handle_for_launcher.clone();
            Box::pin(async move {
                let app_dir = app_handle
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
                let settings = read_api_settings_snapshot(&app_handle, &app_dir)
                    .await
                    .unwrap_or_else(|| serde_json::json!({}));
                let config = crate::api_config::ApiRuntimeConfig::resolve(&settings, &app_dir);

                // Fail closed (§6): never expose the API when auth is required
                // but no key resolved. The resolver auto-generates a key when
                // none is supplied, so this is defense in depth.
                if config.auth_required && config.api_key.trim().is_empty() {
                    return Err(
                        "REST API refused to start: authentication is required but no API key is configured"
                            .to_string(),
                    );
                }

                // Persist auto-generated key/secret so they stay stable across
                // restarts and the API key is retrievable in Settings → API.
                // Best-effort: a write failure must not block startup.
                if config.api_key_generated || config.jwt_secret_generated {
                    if let Err(e) =
                        persist_generated_api_secrets(&app_handle, &app_dir, &config).await
                    {
                        log::warn!("Could not persist generated REST API secrets: {e}");
                    }
                }

                let bind_addr = config.bind_addr().to_string();
                let port = config.port;
                let auth_required = config.auth_required;

                let join = tokio::spawn(async move {
                    if let Err(err) = crate::api::start_server(config, services, shutdown_rx).await
                    {
                        log::error!("REST API server exited with error: {err}");
                    }
                });

                Ok(sorng_commands_core::api_server_commands::ServerLaunch {
                    join,
                    bind_addr,
                    port,
                    auth_required,
                })
            }) as sorng_commands_core::api_server_commands::LaunchFuture
        },
    );

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
    // non-fatal `startup-failure` alert the stopgap used.
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
                let _ = app_handle_for_start.emit(
                    "startup-failure",
                    serde_json::json!({
                        "component": "rest_api_server",
                        "message": format!("Failed to start REST API server: {err}"),
                    }),
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
        .unwrap_or_else(|| serde_json::json!({}));
    crate::api_config::ApiRuntimeConfig::resolve(&settings, app_dir).user_store_path
}

/// Read the persisted app settings as raw JSON, or `None` when the encryption
/// state is unavailable/locked or no settings exist yet. Shared by the REST API
/// startup path so config is resolved from the same store the UI writes to.
async fn read_api_settings_snapshot(
    app_handle: &tauri::AppHandle,
    app_dir: &std::path::Path,
) -> Option<serde_json::Value> {
    let enc_state = app_handle.try_state::<sorng_encryption::EncryptionState>()?;
    crate::app_settings_commands::read_app_settings_inner(app_dir, &enc_state)
        .await
        .ok()
        .flatten()
}

/// Persist freshly auto-generated REST API secrets back into `settings.restApi`
/// so they remain stable across restarts (and the API key is retrievable in
/// Settings → API). Read-modify-write preserves sibling `restApi` fields.
/// Never logs the secret material (§6 invariant).
async fn persist_generated_api_secrets(
    app_handle: &tauri::AppHandle,
    app_dir: &std::path::Path,
    config: &crate::api_config::ApiRuntimeConfig,
) -> Result<(), String> {
    let enc_state = app_handle
        .try_state::<sorng_encryption::EncryptionState>()
        .ok_or_else(|| "encryption state unavailable".to_string())?;
    let current = crate::app_settings_commands::read_app_settings_inner(app_dir, &enc_state)
        .await?
        .unwrap_or_else(|| serde_json::json!({}));
    let mut rest = current
        .get("restApi")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    if config.api_key_generated {
        rest.insert(
            "apiKey".to_string(),
            serde_json::Value::String(config.api_key.clone()),
        );
    }
    if config.jwt_secret_generated {
        rest.insert(
            "jwtSecret".to_string(),
            serde_json::Value::String(config.jwt_secret.clone()),
        );
    }
    let patch = serde_json::json!({ "restApi": serde_json::Value::Object(rest) });
    crate::app_settings_commands::write_app_settings_inner(app_dir, &enc_state, patch).await
}
