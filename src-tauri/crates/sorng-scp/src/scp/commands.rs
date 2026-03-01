// ── Tauri command bindings ────────────────────────────────────────────────────
//
// Thin wrappers that take `State<ScpServiceState>`, lock the mutex, and
// delegate to the service methods.  Every command returns `Result<T, String>`.

use crate::scp::history::ScpHistoryStats;
use crate::scp::types::*;

// ── Connection / session ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn scp_connect(
    state: tauri::State<'_, ScpServiceState>,
    config: ScpConnectionConfig,
) -> Result<ScpSessionInfo, String> {
    let mut svc = state.lock().await;
    svc.connect(config).await
}

#[tauri::command]
pub async fn scp_disconnect(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await
}

#[tauri::command]
pub async fn scp_disconnect_all(
    state: tauri::State<'_, ScpServiceState>,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    svc.disconnect_all().await
}

#[tauri::command]
pub async fn scp_get_session_info(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
) -> Result<ScpSessionInfo, String> {
    let svc = state.lock().await;
    svc.get_session_info(&session_id).await
}

#[tauri::command]
pub async fn scp_list_sessions(
    state: tauri::State<'_, ScpServiceState>,
) -> Result<Vec<ScpSessionInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions().await)
}

#[tauri::command]
pub async fn scp_ping(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.ping(&session_id).await
}

// ── Remote filesystem helpers ────────────────────────────────────────────────

#[tauri::command]
pub async fn scp_remote_exists(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
    path: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.remote_exists(&session_id, &path)
}

#[tauri::command]
pub async fn scp_remote_is_dir(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
    path: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.remote_is_dir(&session_id, &path)
}

#[tauri::command]
pub async fn scp_remote_file_size(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
    path: String,
) -> Result<u64, String> {
    let svc = state.lock().await;
    svc.remote_file_size(&session_id, &path)
}

#[tauri::command]
pub async fn scp_remote_mkdir_p(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remote_mkdir_p(&session_id, &path)
}

#[tauri::command]
pub async fn scp_remote_rm(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remote_rm(&session_id, &path)
}

#[tauri::command]
pub async fn scp_remote_rm_rf(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remote_rm_rf(&session_id, &path)
}

#[tauri::command]
pub async fn scp_remote_ls(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
    path: String,
) -> Result<Vec<ScpRemoteDirEntry>, String> {
    let svc = state.lock().await;
    svc.remote_ls(&session_id, &path)
}

#[tauri::command]
pub async fn scp_remote_stat(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
    path: String,
) -> Result<ScpRemoteFileInfo, String> {
    let svc = state.lock().await;
    svc.remote_stat(&session_id, &path)
}

#[tauri::command]
pub async fn scp_remote_checksum(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.remote_checksum(&session_id, &path)
}

#[tauri::command]
pub async fn scp_local_checksum(
    path: String,
) -> Result<String, String> {
    crate::scp::service::ScpService::local_checksum(&path)
}

// ── Single-file transfers ────────────────────────────────────────────────────

#[tauri::command]
pub async fn scp_upload(
    state: tauri::State<'_, ScpServiceState>,
    request: ScpTransferRequest,
) -> Result<ScpTransferResult, String> {
    let mut svc = state.lock().await;
    svc.upload(request).await
}

#[tauri::command]
pub async fn scp_download(
    state: tauri::State<'_, ScpServiceState>,
    request: ScpTransferRequest,
) -> Result<ScpTransferResult, String> {
    let mut svc = state.lock().await;
    svc.download(request).await
}

// ── Batch transfers ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn scp_batch_transfer(
    state: tauri::State<'_, ScpServiceState>,
    request: ScpBatchTransferRequest,
) -> Result<ScpBatchTransferResult, String> {
    let mut svc = state.lock().await;
    svc.batch_transfer(request).await
}

// ── Directory transfers ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn scp_upload_directory(
    state: tauri::State<'_, ScpServiceState>,
    request: ScpDirectoryTransferRequest,
) -> Result<ScpDirectoryTransferResult, String> {
    let mut svc = state.lock().await;
    svc.upload_directory(request).await
}

#[tauri::command]
pub async fn scp_download_directory(
    state: tauri::State<'_, ScpServiceState>,
    request: ScpDirectoryTransferRequest,
) -> Result<ScpDirectoryTransferResult, String> {
    let mut svc = state.lock().await;
    svc.download_directory(request).await
}

// ── Transfer progress ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn scp_get_transfer_progress(
    state: tauri::State<'_, ScpServiceState>,
    transfer_id: String,
) -> Result<ScpTransferProgress, String> {
    let svc = state.lock().await;
    svc.get_transfer_progress(&transfer_id)
}

#[tauri::command]
pub async fn scp_list_active_transfers(
    state: tauri::State<'_, ScpServiceState>,
) -> Result<Vec<ScpTransferProgress>, String> {
    let svc = state.lock().await;
    Ok(svc.list_active_transfers())
}

#[tauri::command]
pub async fn scp_cancel_transfer(
    state: tauri::State<'_, ScpServiceState>,
    transfer_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.cancel_transfer(&transfer_id)
}

#[tauri::command]
pub async fn scp_clear_completed_transfers(
    state: tauri::State<'_, ScpServiceState>,
) -> Result<u32, String> {
    let svc = state.lock().await;
    Ok(svc.clear_completed_transfers())
}

// ── Queue management ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn scp_queue_add(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
    local_path: String,
    remote_path: String,
    direction: ScpTransferDirection,
    file_mode: Option<i32>,
    priority: Option<u32>,
) -> Result<ScpQueueEntry, String> {
    let mut svc = state.lock().await;
    svc.queue_add(session_id, local_path, remote_path, direction, file_mode, priority)
}

#[tauri::command]
pub async fn scp_queue_remove(
    state: tauri::State<'_, ScpServiceState>,
    entry_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.queue_remove(&entry_id)
}

#[tauri::command]
pub async fn scp_queue_list(
    state: tauri::State<'_, ScpServiceState>,
) -> Result<Vec<ScpQueueEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.queue_list())
}

#[tauri::command]
pub async fn scp_queue_status(
    state: tauri::State<'_, ScpServiceState>,
) -> Result<ScpQueueSummary, String> {
    let svc = state.lock().await;
    Ok(svc.queue_status())
}

#[tauri::command]
pub async fn scp_queue_start(
    state: tauri::State<'_, ScpServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.queue_start().await
}

#[tauri::command]
pub async fn scp_queue_stop(
    state: tauri::State<'_, ScpServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.queue_stop()
}

#[tauri::command]
pub async fn scp_queue_retry_failed(
    state: tauri::State<'_, ScpServiceState>,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    Ok(svc.queue_retry_failed())
}

#[tauri::command]
pub async fn scp_queue_clear_done(
    state: tauri::State<'_, ScpServiceState>,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    Ok(svc.queue_clear_done())
}

#[tauri::command]
pub async fn scp_queue_clear_all(
    state: tauri::State<'_, ScpServiceState>,
) -> Result<u32, String> {
    let mut svc = state.lock().await;
    Ok(svc.queue_clear_all())
}

#[tauri::command]
pub async fn scp_queue_set_priority(
    state: tauri::State<'_, ScpServiceState>,
    entry_id: String,
    priority: u32,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.queue_set_priority(&entry_id, priority)
}

#[tauri::command]
pub async fn scp_queue_pause(
    state: tauri::State<'_, ScpServiceState>,
    entry_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.queue_pause(&entry_id)
}

#[tauri::command]
pub async fn scp_queue_resume(
    state: tauri::State<'_, ScpServiceState>,
    entry_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.queue_resume(&entry_id)
}

// ── Transfer history ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn scp_get_history(
    state: tauri::State<'_, ScpServiceState>,
    session_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ScpTransferRecord>, String> {
    let svc = state.lock().await;
    Ok(svc.get_history(session_id.as_deref(), limit))
}

#[tauri::command]
pub async fn scp_clear_history(
    state: tauri::State<'_, ScpServiceState>,
) -> Result<u32, String> {
    let svc = state.lock().await;
    Ok(svc.clear_history())
}

#[tauri::command]
pub async fn scp_history_stats(
    state: tauri::State<'_, ScpServiceState>,
) -> Result<ScpHistoryStats, String> {
    let svc = state.lock().await;
    Ok(svc.history_stats())
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn scp_diagnose(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
) -> Result<ScpDiagnosticResult, String> {
    let mut svc = state.lock().await;
    svc.diagnose(&session_id).await
}

#[tauri::command]
pub async fn scp_diagnose_connection(
    state: tauri::State<'_, ScpServiceState>,
    config: ScpConnectionConfig,
) -> Result<ScpDiagnosticResult, String> {
    let svc = state.lock().await;
    svc.diagnose_connection(config).await
}

// ── Remote exec (generic helper for frontend) ────────────────────────────────

#[tauri::command]
pub async fn scp_exec_remote(
    state: tauri::State<'_, ScpServiceState>,
    session_id: String,
    command: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.exec_remote(&session_id, &command)
}
