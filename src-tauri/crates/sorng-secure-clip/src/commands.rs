use tauri::State;

use super::service::SecureClipServiceState;
use super::types::*;

// ═══════════════════════════════════════════════════════════════════
//  Copy commands
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn secure_clip_copy(
    state: State<'_, SecureClipServiceState>,
    request: CopyRequest,
) -> Result<ClipEntryDisplay, String> {
    let mut svc = state.write().await;
    svc.copy(&request).await
}

#[tauri::command]
pub async fn secure_clip_copy_password(
    state: State<'_, SecureClipServiceState>,
    connection_id: String,
    connection_name: String,
    password: String,
) -> Result<ClipEntryDisplay, String> {
    let mut svc = state.write().await;
    svc.copy_connection_password(&connection_id, &connection_name, &password)
        .await
}

#[tauri::command]
pub async fn secure_clip_copy_totp(
    state: State<'_, SecureClipServiceState>,
    connection_id: Option<String>,
    code: String,
) -> Result<ClipEntryDisplay, String> {
    let mut svc = state.write().await;
    svc.copy_totp(connection_id.as_deref(), &code).await
}

#[tauri::command]
pub async fn secure_clip_copy_username(
    state: State<'_, SecureClipServiceState>,
    connection_id: Option<String>,
    username: String,
) -> Result<ClipEntryDisplay, String> {
    let mut svc = state.write().await;
    svc.copy_username(connection_id.as_deref(), &username).await
}

#[tauri::command]
pub async fn secure_clip_copy_passphrase(
    state: State<'_, SecureClipServiceState>,
    connection_id: Option<String>,
    passphrase: String,
) -> Result<ClipEntryDisplay, String> {
    let mut svc = state.write().await;
    svc.copy_passphrase(connection_id.as_deref(), &passphrase)
        .await
}

#[tauri::command]
pub async fn secure_clip_copy_api_key(
    state: State<'_, SecureClipServiceState>,
    label: Option<String>,
    key: String,
) -> Result<ClipEntryDisplay, String> {
    let mut svc = state.write().await;
    svc.copy_api_key(label.as_deref(), &key).await
}

// ═══════════════════════════════════════════════════════════════════
//  Paste commands
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn secure_clip_paste(state: State<'_, SecureClipServiceState>) -> Result<String, String> {
    let mut svc = state.write().await;
    svc.paste().await
}

#[tauri::command]
pub async fn secure_clip_paste_by_id(
    state: State<'_, SecureClipServiceState>,
    entry_id: String,
) -> Result<String, String> {
    let mut svc = state.write().await;
    svc.paste_by_id(&entry_id).await
}

/// Retrieve the current clipboard value intended for terminal paste.
/// Returns `{ entry_id, value }` so the frontend can inject into the
/// terminal and then call `secure_clip_record_terminal_paste`.
#[tauri::command]
pub async fn secure_clip_paste_to_terminal(
    state: State<'_, SecureClipServiceState>,
) -> Result<PasteToTerminalResponse, String> {
    let svc = state.read().await;
    let (entry_id, value) = svc.get_for_terminal().await?;
    Ok(PasteToTerminalResponse { entry_id, value })
}

#[tauri::command]
pub async fn secure_clip_record_terminal_paste(
    state: State<'_, SecureClipServiceState>,
    entry_id: String,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.record_terminal_paste(&entry_id).await;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════
//  Clear commands
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn secure_clip_clear(state: State<'_, SecureClipServiceState>) -> Result<bool, String> {
    let mut svc = state.write().await;
    Ok(svc.clear().await)
}

#[tauri::command]
pub async fn secure_clip_on_app_lock(
    state: State<'_, SecureClipServiceState>,
) -> Result<bool, String> {
    let mut svc = state.write().await;
    Ok(svc.clear_on_lock().await)
}

#[tauri::command]
pub async fn secure_clip_on_app_exit(
    state: State<'_, SecureClipServiceState>,
) -> Result<bool, String> {
    let mut svc = state.write().await;
    Ok(svc.clear_on_exit().await)
}

// ═══════════════════════════════════════════════════════════════════
//  Query commands
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn secure_clip_get_current(
    state: State<'_, SecureClipServiceState>,
) -> Result<Option<ClipEntryDisplay>, String> {
    let svc = state.read().await;
    Ok(svc.current().await)
}

#[tauri::command]
pub async fn secure_clip_has_entry(
    state: State<'_, SecureClipServiceState>,
) -> Result<bool, String> {
    let svc = state.read().await;
    Ok(svc.has_entry().await)
}

#[tauri::command]
pub async fn secure_clip_get_stats(
    state: State<'_, SecureClipServiceState>,
) -> Result<SecureClipStats, String> {
    let svc = state.read().await;
    Ok(svc.stats().await)
}

// ═══════════════════════════════════════════════════════════════════
//  History commands
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn secure_clip_get_history(
    state: State<'_, SecureClipServiceState>,
) -> Result<Vec<ClipHistoryEntry>, String> {
    let svc = state.read().await;
    Ok(svc.get_history().await)
}

#[tauri::command]
pub async fn secure_clip_get_history_for_connection(
    state: State<'_, SecureClipServiceState>,
    connection_id: String,
) -> Result<Vec<ClipHistoryEntry>, String> {
    let svc = state.read().await;
    Ok(svc.get_connection_history(&connection_id).await)
}

#[tauri::command]
pub async fn secure_clip_clear_history(
    state: State<'_, SecureClipServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.clear_history().await;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════
//  Config commands
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn secure_clip_get_config(
    state: State<'_, SecureClipServiceState>,
) -> Result<SecureClipConfig, String> {
    let svc = state.read().await;
    Ok(svc.get_config())
}

#[tauri::command]
pub async fn secure_clip_update_config(
    state: State<'_, SecureClipServiceState>,
    config: SecureClipConfig,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.update_config(config).await;
    Ok(())
}

/// Read the raw OS clipboard text (for debugging / diagnostics).
#[tauri::command]
pub async fn secure_clip_read_os_clipboard() -> Result<String, String> {
    super::engine::ClipEngine::read_os_clipboard_static()
}
