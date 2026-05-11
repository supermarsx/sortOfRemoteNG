use tauri::{AppHandle, State};

use crate::{
    service::UpdaterServiceState,
    types::{UpdaterCheckResult, UpdaterSettings, UpdaterSettingsPatch, UpdaterStatusSnapshot},
};

#[tauri::command]
pub fn updater_get_settings(
    state: State<'_, UpdaterServiceState>,
) -> Result<UpdaterSettings, String> {
    state.get_settings().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn updater_save_settings(
    state: State<'_, UpdaterServiceState>,
    patch: UpdaterSettingsPatch,
) -> Result<UpdaterSettings, String> {
    state
        .save_settings(patch)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn updater_get_status(
    state: State<'_, UpdaterServiceState>,
) -> Result<UpdaterStatusSnapshot, String> {
    state.get_status().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn updater_check(
    app: AppHandle,
    state: State<'_, UpdaterServiceState>,
    force: Option<bool>,
) -> Result<UpdaterCheckResult, String> {
    state
        .check(&app, force.unwrap_or(false))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn updater_download_and_install(
    app: AppHandle,
    state: State<'_, UpdaterServiceState>,
    version: Option<String>,
) -> Result<UpdaterStatusSnapshot, String> {
    state
        .download_and_install(&app, version)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn updater_relaunch(
    app: AppHandle,
    state: State<'_, UpdaterServiceState>,
) -> Result<(), String> {
    state.relaunch(&app);
    Ok(())
}
