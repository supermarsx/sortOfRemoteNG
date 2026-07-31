use tauri::State;

use super::service::SecureClipServiceState;
use super::types::*;

async fn native_app_is_locked(state: &State<'_, super::auto_lock::AutoLockServiceState>) -> bool {
    let service = state.lock().await;
    matches!(
        service.get_lock_state().await,
        super::auto_lock::LockState::Locked
    )
}

// ═══════════════════════════════════════════════════════════════════
//  Copy commands
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn secure_clip_copy(
    state: State<'_, SecureClipServiceState>,
    auto_lock_state: State<'_, super::auto_lock::AutoLockServiceState>,
    request: CopyRequest,
) -> Result<ClipEntryDisplay, String> {
    let locked = native_app_is_locked(&auto_lock_state).await;
    let mut svc = state.write().await;
    svc.synchronize_lock_state(locked).await?;
    svc.copy(&request).await
}

#[tauri::command]
pub async fn secure_clip_copy_password(
    state: State<'_, SecureClipServiceState>,
    auto_lock_state: State<'_, super::auto_lock::AutoLockServiceState>,
    connection_id: String,
    connection_name: String,
    password: String,
) -> Result<ClipEntryDisplay, String> {
    let locked = native_app_is_locked(&auto_lock_state).await;
    let mut svc = state.write().await;
    svc.synchronize_lock_state(locked).await?;
    svc.copy_connection_password(&connection_id, &connection_name, password)
        .await
}

#[tauri::command]
pub async fn secure_clip_copy_totp(
    state: State<'_, SecureClipServiceState>,
    auto_lock_state: State<'_, super::auto_lock::AutoLockServiceState>,
    connection_id: Option<String>,
    code: String,
) -> Result<ClipEntryDisplay, String> {
    let locked = native_app_is_locked(&auto_lock_state).await;
    let mut svc = state.write().await;
    svc.synchronize_lock_state(locked).await?;
    svc.copy_totp(connection_id.as_deref(), code).await
}

#[tauri::command]
pub async fn secure_clip_copy_username(
    state: State<'_, SecureClipServiceState>,
    auto_lock_state: State<'_, super::auto_lock::AutoLockServiceState>,
    connection_id: Option<String>,
    username: String,
) -> Result<ClipEntryDisplay, String> {
    let locked = native_app_is_locked(&auto_lock_state).await;
    let mut svc = state.write().await;
    svc.synchronize_lock_state(locked).await?;
    svc.copy_username(connection_id.as_deref(), username).await
}

#[tauri::command]
pub async fn secure_clip_copy_passphrase(
    state: State<'_, SecureClipServiceState>,
    auto_lock_state: State<'_, super::auto_lock::AutoLockServiceState>,
    connection_id: Option<String>,
    passphrase: String,
) -> Result<ClipEntryDisplay, String> {
    let locked = native_app_is_locked(&auto_lock_state).await;
    let mut svc = state.write().await;
    svc.synchronize_lock_state(locked).await?;
    svc.copy_passphrase(connection_id.as_deref(), passphrase)
        .await
}

#[tauri::command]
pub async fn secure_clip_copy_api_key(
    state: State<'_, SecureClipServiceState>,
    auto_lock_state: State<'_, super::auto_lock::AutoLockServiceState>,
    label: Option<String>,
    key: String,
) -> Result<ClipEntryDisplay, String> {
    let locked = native_app_is_locked(&auto_lock_state).await;
    let mut svc = state.write().await;
    svc.synchronize_lock_state(locked).await?;
    svc.copy_api_key(label.as_deref(), key).await
}

// ═══════════════════════════════════════════════════════════════════
//  Paste commands
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn secure_clip_paste(
    state: State<'_, SecureClipServiceState>,
    auto_lock_state: State<'_, super::auto_lock::AutoLockServiceState>,
) -> Result<String, String> {
    let locked = native_app_is_locked(&auto_lock_state).await;
    let mut svc = state.write().await;
    svc.synchronize_lock_state(locked).await?;
    svc.paste().await
}

#[tauri::command]
pub async fn secure_clip_paste_by_id(
    state: State<'_, SecureClipServiceState>,
    auto_lock_state: State<'_, super::auto_lock::AutoLockServiceState>,
    entry_id: String,
) -> Result<String, String> {
    let locked = native_app_is_locked(&auto_lock_state).await;
    let mut svc = state.write().await;
    svc.synchronize_lock_state(locked).await?;
    svc.paste_by_id(&entry_id).await
}

/// Consume one policy-authorized paste and queue the secret directly to the
/// native SSH shell. The response contains metadata only, never plaintext.
#[tauri::command]
pub async fn secure_clip_paste_to_terminal(
    state: State<'_, SecureClipServiceState>,
    auto_lock_state: State<'_, super::auto_lock::AutoLockServiceState>,
    ssh_state: State<'_, super::ssh::types::SshServiceState>,
    request: PasteToTerminalRequest,
) -> Result<PasteToTerminalResponse, String> {
    if request.session_id.trim().is_empty() || request.session_id.len() > 256 {
        return Err("SSH session ID is invalid".to_string());
    }
    if request.simulate_typing {
        return Err("Simulated typing is unavailable for secure terminal paste".to_string());
    }

    let locked = native_app_is_locked(&auto_lock_state).await;
    let mut svc = state.write().await;
    svc.synchronize_lock_state(locked).await?;
    let paste = svc
        .consume_terminal_paste(request.entry_id.as_deref())
        .await?;
    drop(svc);

    let mut ssh = ssh_state.lock().await;
    ssh.send_shell_secret_input(&request.session_id, paste.value)
        .await?;
    Ok(paste.response)
}

// ═══════════════════════════════════════════════════════════════════
//  Clear commands
// ═══════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn secure_clip_clear(state: State<'_, SecureClipServiceState>) -> Result<bool, String> {
    let mut svc = state.write().await;
    svc.clear().await
}

#[tauri::command]
pub async fn secure_clip_on_app_lock(
    state: State<'_, SecureClipServiceState>,
) -> Result<bool, String> {
    let mut svc = state.write().await;
    svc.clear_on_lock().await
}

#[tauri::command]
pub async fn secure_clip_on_app_unlock(
    state: State<'_, SecureClipServiceState>,
) -> Result<(), String> {
    let mut svc = state.write().await;
    svc.on_app_unlock();
    Ok(())
}

#[tauri::command]
pub async fn secure_clip_on_app_exit(
    state: State<'_, SecureClipServiceState>,
) -> Result<bool, String> {
    let mut svc = state.write().await;
    svc.clear_on_exit().await
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
    auto_lock_state: State<'_, super::auto_lock::AutoLockServiceState>,
    config: SecureClipConfig,
) -> Result<(), String> {
    let locked = native_app_is_locked(&auto_lock_state).await;
    let mut svc = state.write().await;
    svc.synchronize_lock_state(locked).await?;
    svc.update_config(config).await
}

/// Raw OS clipboard reads are deliberately unavailable to the renderer.
///
/// Leaving the registered command fail-closed avoids turning a renderer
/// compromise into an unrestricted clipboard exfiltration primitive while
/// preserving compatibility with the existing command registry.
#[tauri::command]
pub async fn secure_clip_read_os_clipboard() -> Result<String, String> {
    Err("Direct OS clipboard reads are disabled".to_string())
}
