// ── sorng-voip-phone/src/commands.rs ─────────────────────────────────────────
// Tauri commands – thin wrappers around `VoipPhoneService`.
// NOT a module of this crate: `include!`d by the command aggregator
// (`sorng-commands-ops/src/voip_phone_commands.rs`), which provides
// `super::service` / `super::types` re-export modules in scope.

use super::service::VoipPhoneServiceState;
use super::types::*;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Detect the firmware generation only — sends no credentials.
#[tauri::command]
pub async fn voip_phone_probe(
    state: State<'_, VoipPhoneServiceState>,
    config: VoipPhoneConnectionConfig,
) -> CmdResult<VoipPhoneProbeResult> {
    state.lock().await.probe(config).await.map_err(map_err)
}

#[tauri::command]
pub async fn voip_phone_connect(
    state: State<'_, VoipPhoneServiceState>,
    id: String,
    config: VoipPhoneConnectionConfig,
) -> CmdResult<VoipPhoneSessionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn voip_phone_disconnect(
    state: State<'_, VoipPhoneServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn voip_phone_list(
    state: State<'_, VoipPhoneServiceState>,
) -> CmdResult<Vec<VoipPhoneSessionSummary>> {
    Ok(state.lock().await.list())
}

#[tauri::command]
pub async fn voip_phone_get_config(
    state: State<'_, VoipPhoneServiceState>,
    id: String,
) -> CmdResult<VoipPhoneConfigSafe> {
    state.lock().await.get_config_safe(&id).map_err(map_err)
}

#[tauri::command]
pub async fn voip_phone_get_status(
    state: State<'_, VoipPhoneServiceState>,
    id: String,
) -> CmdResult<VoipPhoneStatus> {
    state.lock().await.status(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn voip_phone_reboot(
    state: State<'_, VoipPhoneServiceState>,
    id: String,
) -> CmdResult<VoipRebootResult> {
    state.lock().await.reboot(&id).await.map_err(map_err)
}

#[tauri::command]
pub async fn voip_phone_web_login_hint(
    state: State<'_, VoipPhoneServiceState>,
    id: String,
) -> CmdResult<WebLoginHint> {
    state.lock().await.web_login_hint(&id).map_err(map_err)
}
