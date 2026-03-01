//! Tauri command bindings for the FTP crate.
//!
//! Thin wrappers that take `State<FtpServiceState>`, lock the mutex, and
//! delegate to the service.  Every command returns `Result<T, String>`.

use crate::ftp::service::FtpServiceState;
use crate::ftp::types::*;

// ── Connection / session ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn ftp_connect(
    state: tauri::State<'_, FtpServiceState>,
    config: FtpConnectionConfig,
) -> Result<FtpSessionInfo, String> {
    let mut svc = state.lock().await;
    svc.connect(config).await
}

#[tauri::command]
pub async fn ftp_disconnect(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await
}

#[tauri::command]
pub async fn ftp_disconnect_all(
    state: tauri::State<'_, FtpServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_all().await
}

#[tauri::command]
pub async fn ftp_get_session_info(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
) -> Result<FtpSessionInfo, String> {
    let svc = state.lock().await;
    svc.get_session_info(&session_id).await
}

#[tauri::command]
pub async fn ftp_list_sessions(
    state: tauri::State<'_, FtpServiceState>,
) -> Result<Vec<FtpSessionInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions().await)
}

#[tauri::command]
pub async fn ftp_ping(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.ping(&session_id).await
}

// ── Directory operations ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn ftp_list_directory(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    path: Option<String>,
    options: Option<ListOptions>,
) -> Result<Vec<FtpEntry>, String> {
    let mut svc = state.lock().await;
    svc.list_directory(&session_id, path.as_deref(), options)
        .await
}

#[tauri::command]
pub async fn ftp_set_directory(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.set_directory(&session_id, &path).await
}

#[tauri::command]
pub async fn ftp_get_current_directory(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.get_current_directory(&session_id).await
}

#[tauri::command]
pub async fn ftp_mkdir(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.mkdir(&session_id, &path).await
}

#[tauri::command]
pub async fn ftp_mkdir_all(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.mkdir_all(&session_id, &path).await
}

#[tauri::command]
pub async fn ftp_rmdir(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rmdir(&session_id, &path).await
}

#[tauri::command]
pub async fn ftp_rmdir_recursive(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rmdir_recursive(&session_id, &path).await
}

#[tauri::command]
pub async fn ftp_rename(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rename(&session_id, &from, &to).await
}

#[tauri::command]
pub async fn ftp_delete_file(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_file(&session_id, &path).await
}

#[tauri::command]
pub async fn ftp_chmod(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    path: String,
    mode: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.chmod(&session_id, &path, &mode).await
}

// ── File info ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ftp_get_file_size(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    path: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.get_file_size(&session_id, &path).await
}

#[tauri::command]
pub async fn ftp_get_modified_time(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.get_modified_time(&session_id, &path).await
}

#[tauri::command]
pub async fn ftp_stat_entry(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    path: String,
) -> Result<FtpEntry, String> {
    let mut svc = state.lock().await;
    svc.stat_entry(&session_id, &path).await
}

// ── Transfers ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ftp_upload_file(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.upload(&session_id, &local_path, &remote_path).await
}

#[tauri::command]
pub async fn ftp_download_file(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.download(&session_id, &remote_path, &local_path).await
}

#[tauri::command]
pub async fn ftp_append_file(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.append(&session_id, &local_path, &remote_path).await
}

#[tauri::command]
pub async fn ftp_resume_upload(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.resume_upload(&session_id, &local_path, &remote_path)
        .await
}

#[tauri::command]
pub async fn ftp_resume_download(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.resume_download(&session_id, &remote_path, &local_path)
        .await
}

// ── Transfer queue ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ftp_enqueue_transfer(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    direction: TransferDirection,
    local_path: String,
    remote_path: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    Ok(svc.enqueue_transfer(&session_id, direction, &local_path, &remote_path))
}

#[tauri::command]
pub async fn ftp_cancel_transfer(
    state: tauri::State<'_, FtpServiceState>,
    transfer_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.cancel_transfer(&transfer_id)
}

#[tauri::command]
pub async fn ftp_list_transfers(
    state: tauri::State<'_, FtpServiceState>,
) -> Result<Vec<TransferItem>, String> {
    let svc = state.lock().await;
    Ok(svc.list_transfers())
}

#[tauri::command]
pub async fn ftp_get_transfer_progress(
    state: tauri::State<'_, FtpServiceState>,
    transfer_id: String,
) -> Result<Option<TransferProgress>, String> {
    let svc = state.lock().await;
    Ok(svc.get_transfer_progress(&transfer_id))
}

#[tauri::command]
pub async fn ftp_get_all_progress(
    state: tauri::State<'_, FtpServiceState>,
) -> Result<Vec<TransferProgress>, String> {
    let svc = state.lock().await;
    Ok(svc.get_all_progress())
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ftp_get_diagnostics(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
) -> Result<FtpDiagnostics, String> {
    let svc = state.lock().await;
    svc.get_diagnostics(&session_id)
}

#[tauri::command]
pub async fn ftp_get_pool_stats(
    state: tauri::State<'_, FtpServiceState>,
) -> Result<PoolStats, String> {
    let svc = state.lock().await;
    Ok(svc.get_pool_stats())
}

// ── Bookmarks ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ftp_list_bookmarks(
    state: tauri::State<'_, FtpServiceState>,
) -> Result<Vec<FtpBookmark>, String> {
    let svc = state.lock().await;
    Ok(svc.list_bookmarks())
}

#[tauri::command]
pub async fn ftp_add_bookmark(
    state: tauri::State<'_, FtpServiceState>,
    bookmark: FtpBookmark,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    Ok(svc.add_bookmark(bookmark))
}

#[tauri::command]
pub async fn ftp_remove_bookmark(
    state: tauri::State<'_, FtpServiceState>,
    bookmark_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.remove_bookmark(&bookmark_id)
}

#[tauri::command]
pub async fn ftp_update_bookmark(
    state: tauri::State<'_, FtpServiceState>,
    bookmark: FtpBookmark,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_bookmark(bookmark)
}

// ── Raw / SITE ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ftp_site_command(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    args: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.site_command(&session_id, &args).await
}

#[tauri::command]
pub async fn ftp_raw_command(
    state: tauri::State<'_, FtpServiceState>,
    session_id: String,
    command: String,
) -> Result<FtpResponse, String> {
    let mut svc = state.lock().await;
    svc.raw_command(&session_id, &command).await
}
