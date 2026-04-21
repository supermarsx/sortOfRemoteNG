// Tauri command handlers for portable mode.
//
// Each command follows the `portable_*` naming convention and delegates
// to [`PortableService`].

use tauri::State;

use super::service::PortableServiceState;
use super::types::*;

/// Helper to map PortableError → String for Tauri command results.
fn err_str(e: super::error::PortableError) -> String {
    e.to_string()
}

// ─── Commands ───────────────────────────────────────────────────────

/// Detect the current operating mode (portable or installed).
#[tauri::command]
pub async fn portable_detect_mode(
    state: State<'_, PortableServiceState>,
) -> Result<PortableMode, String> {
    let svc = state.lock().await;
    Ok(svc.detect_mode())
}

/// Get runtime status of the portable environment.
#[tauri::command]
pub async fn portable_get_status(
    state: State<'_, PortableServiceState>,
) -> Result<PortableStatus, String> {
    let svc = state.lock().await;
    svc.get_status().map_err(err_str)
}

/// Get resolved data paths.
#[tauri::command]
pub async fn portable_get_paths(
    state: State<'_, PortableServiceState>,
) -> Result<PortablePaths, String> {
    let svc = state.lock().await;
    Ok(svc.get_paths())
}

/// Get the current portable configuration.
#[tauri::command]
pub async fn portable_get_config(
    state: State<'_, PortableServiceState>,
) -> Result<PortableConfig, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

/// Update the portable configuration.
#[tauri::command]
pub async fn portable_update_config(
    state: State<'_, PortableServiceState>,
    config: PortableConfig,
    exe_dir: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_config(config, &exe_dir);
    Ok(())
}

/// Migrate from installed mode to portable mode.
#[tauri::command]
pub async fn portable_migrate_to_portable(
    state: State<'_, PortableServiceState>,
    exe_dir: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.migrate_to_portable(&exe_dir).map_err(err_str)
}

/// Migrate from portable mode to installed mode.
#[tauri::command]
pub async fn portable_migrate_to_installed(
    state: State<'_, PortableServiceState>,
    exe_dir: String,
    data_dir: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.migrate_to_installed(&exe_dir, &data_dir)
        .map_err(err_str)
}

/// Create the .portable marker file.
#[tauri::command]
pub async fn portable_create_marker(state: State<'_, PortableServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.create_marker().map_err(err_str)
}

/// Remove the .portable marker file.
#[tauri::command]
pub async fn portable_remove_marker(state: State<'_, PortableServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_marker().map_err(err_str)
}

/// Validate the portable directory structure.
#[tauri::command]
pub async fn portable_validate(
    state: State<'_, PortableServiceState>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.validate())
}

/// Get drive information for the data directory.
#[tauri::command]
pub async fn portable_get_drive_info(
    state: State<'_, PortableServiceState>,
) -> Result<Option<DriveInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.get_drive_info())
}
