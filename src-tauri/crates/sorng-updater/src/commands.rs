//! Tauri command handlers for the updater.
//!
//! Each command follows the `updater_*` naming convention and delegates
//! to [`UpdaterService`].

use tauri::State;

use super::service::UpdaterServiceState;
use super::types::*;

/// Helper to map UpdateError → String for Tauri command results.
fn err_str(e: super::error::UpdateError) -> String {
    e.to_string()
}

// ─── Check ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn updater_check(state: State<'_, UpdaterServiceState>) -> Result<UpdateStatus, String> {
    let mut svc = state.lock().await;
    svc.check_for_updates().await.map_err(err_str)
}

// ─── Download ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn updater_download(state: State<'_, UpdaterServiceState>) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.download_update().await.map_err(err_str)
}

#[tauri::command]
pub async fn updater_cancel_download(state: State<'_, UpdaterServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.cancel_download();
    Ok(())
}

// ─── Install ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn updater_install(state: State<'_, UpdaterServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.install_update().await.map_err(err_str)
}

#[tauri::command]
pub async fn updater_schedule_install(state: State<'_, UpdaterServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.schedule_install_on_restart().await.map_err(err_str)
}

// ─── Status / info ──────────────────────────────────────────────────

#[tauri::command]
pub async fn updater_get_status(
    state: State<'_, UpdaterServiceState>,
) -> Result<UpdateStatus, String> {
    let svc = state.lock().await;
    Ok(svc.get_status())
}

#[tauri::command]
pub async fn updater_get_config(
    state: State<'_, UpdaterServiceState>,
) -> Result<UpdateConfig, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

#[tauri::command]
pub async fn updater_update_config(
    state: State<'_, UpdaterServiceState>,
    config: UpdateConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_config(config);
    Ok(())
}

#[tauri::command]
pub async fn updater_set_channel(
    state: State<'_, UpdaterServiceState>,
    channel: UpdateChannel,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_channel(channel);
    Ok(())
}

#[tauri::command]
pub async fn updater_get_version_info(
    state: State<'_, UpdaterServiceState>,
) -> Result<VersionInfo, String> {
    let svc = state.lock().await;
    Ok(svc.get_version_info())
}

// ─── History ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn updater_get_history(
    state: State<'_, UpdaterServiceState>,
) -> Result<Vec<UpdateHistory>, String> {
    let svc = state.lock().await;
    Ok(svc.get_history())
}

// ─── Rollback ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn updater_rollback(
    state: State<'_, UpdaterServiceState>,
    info: RollbackInfo,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rollback(&info).await.map_err(err_str)
}

#[tauri::command]
pub async fn updater_get_rollbacks(
    state: State<'_, UpdaterServiceState>,
) -> Result<Vec<RollbackInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.get_rollbacks().await)
}

// ─── Release notes ──────────────────────────────────────────────────

#[tauri::command]
pub async fn updater_get_release_notes(
    state: State<'_, UpdaterServiceState>,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    Ok(svc.get_release_notes())
}
