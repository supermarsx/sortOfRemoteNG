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

/// List all backups (flat, newest first, across every enabled
/// destination). Preserved for back-compat — new callers should
/// prefer `backup_list_all_targets` for per-source badges.
#[tauri::command]
pub async fn backup_list(
    state: tauri::State<'_, BackupServiceState>,
) -> Result<Vec<BackupListItem>, String> {
    let service = state.lock().await;
    service.list_backups().await
}

/// Per-destination listing of available backups. Powers the restore
/// picker's merged timeline + destination sidebar.
#[tauri::command]
pub async fn backup_list_all_targets(
    state: tauri::State<'_, BackupServiceState>,
) -> Result<Vec<DestinationListing>, String> {
    let service = state.lock().await;
    service.list_backups_all_targets().await
}

/// Restore from a backup. When `target_id` is `None` the first
/// matching file across every enabled destination is used (legacy
/// behaviour). When set, the restore reads from that destination
/// only so the user controls which copy gets restored when the same
/// backup ID exists at multiple destinations.
#[tauri::command]
pub async fn backup_restore(
    state: tauri::State<'_, BackupServiceState>,
    backup_id: String,
    target_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let service = state.lock().await;
    service
        .restore_backup_from_target(&backup_id, target_id.as_deref())
        .await
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

