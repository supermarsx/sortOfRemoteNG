use super::backup::*;

/// Update backup configuration
#[tauri::command]
pub async fn backup_update_config(
    state: tauri::State<'_, BackupServiceState>,
    config: BackupConfig,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.update_config(config);
    Ok(())
}

/// Get current backup configuration
#[tauri::command]
pub async fn backup_get_config(
    state: tauri::State<'_, BackupServiceState>,
) -> Result<BackupConfig, String> {
    let service = state.lock().await;
    Ok(service.get_config())
}

/// Get current backup status
#[tauri::command]
pub async fn backup_get_status(
    state: tauri::State<'_, BackupServiceState>,
) -> Result<BackupStatus, String> {
    let service = state.lock().await;
    Ok(service.get_status())
}

/// Run a backup now
#[tauri::command]
pub async fn backup_run_now(
    state: tauri::State<'_, BackupServiceState>,
    backup_type: String,
    data: serde_json::Value,
) -> Result<BackupMetadata, String> {
    let mut service = state.lock().await;
    service.run_backup(&backup_type, &data).await
}

/// List all backups
#[tauri::command]
pub async fn backup_list(
    state: tauri::State<'_, BackupServiceState>,
) -> Result<Vec<BackupListItem>, String> {
    let service = state.lock().await;
    service.list_backups().await
}

/// Restore from a backup
#[tauri::command]
pub async fn backup_restore(
    state: tauri::State<'_, BackupServiceState>,
    backup_id: String,
) -> Result<serde_json::Value, String> {
    let service = state.lock().await;
    service.restore_backup(&backup_id).await
}

/// Delete a backup
#[tauri::command]
pub async fn backup_delete(
    state: tauri::State<'_, BackupServiceState>,
    backup_id: String,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_backup(&backup_id).await
}

