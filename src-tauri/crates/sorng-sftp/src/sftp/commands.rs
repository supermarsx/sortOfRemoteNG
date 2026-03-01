// ── Tauri command bindings ────────────────────────────────────────────────────
//
// Thin wrappers that take `State<SftpServiceState>`, lock the mutex, and
// delegate to the service methods.  Every command returns `Result<T, String>`.

use crate::sftp::dir_ops::DiskUsageResult;
use crate::sftp::types::*;
use crate::sftp::watch::{SyncResult, WatchInfo};

// ── Connection / session ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_connect(
    state: tauri::State<'_, SftpServiceState>,
    config: SftpConnectionConfig,
) -> Result<SftpSessionInfo, String> {
    let mut svc = state.lock().await;
    svc.connect(config).await
}

#[tauri::command]
pub async fn sftp_disconnect(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await
}

#[tauri::command]
pub async fn sftp_get_session_info(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
) -> Result<SftpSessionInfo, String> {
    let svc = state.lock().await;
    svc.get_session_info(&session_id).await
}

#[tauri::command]
pub async fn sftp_list_sessions(
    state: tauri::State<'_, SftpServiceState>,
) -> Result<Vec<SftpSessionInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions().await)
}

#[tauri::command]
pub async fn sftp_ping(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.ping(&session_id).await
}

#[tauri::command]
pub async fn sftp_set_directory(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.set_current_directory(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_realpath(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.realpath(&session_id, &path).await
}

// ── Directory operations ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_list_directory(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
    options: Option<SftpListOptions>,
) -> Result<Vec<SftpDirEntry>, String> {
    let mut svc = state.lock().await;
    let opts = options.unwrap_or(SftpListOptions {
        include_hidden: true,
        sort_by: SftpSortField::Name,
        ascending: true,
        filter_glob: None,
        filter_type: None,
        recursive: false,
        max_depth: None,
    });
    svc.list_directory(&session_id, &path, opts).await
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
    mode: Option<u32>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.mkdir(&session_id, &path, mode).await
}

#[tauri::command]
pub async fn sftp_mkdir_p(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
    mode: Option<u32>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.mkdir_p(&session_id, &path, mode).await
}

#[tauri::command]
pub async fn sftp_rmdir(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rmdir(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_disk_usage(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
) -> Result<DiskUsageResult, String> {
    let mut svc = state.lock().await;
    svc.disk_usage(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_search(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    root: String,
    pattern: String,
    max_results: Option<usize>,
) -> Result<Vec<SftpDirEntry>, String> {
    let mut svc = state.lock().await;
    svc.search(&session_id, &root, &pattern, max_results).await
}

// ── File operations ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_stat(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
) -> Result<SftpFileStat, String> {
    let mut svc = state.lock().await;
    svc.stat(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_lstat(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
) -> Result<SftpFileStat, String> {
    let mut svc = state.lock().await;
    svc.lstat(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_rename(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    old_path: String,
    new_path: String,
    overwrite: Option<bool>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rename(&session_id, &old_path, &new_path, overwrite.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn sftp_delete_file(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_file(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_delete_recursive(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.delete_recursive(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_chmod(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    request: SftpChmodRequest,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.chmod(&session_id, request).await
}

#[tauri::command]
pub async fn sftp_chown(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    request: SftpChownRequest,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.chown(&session_id, request).await
}

#[tauri::command]
pub async fn sftp_create_symlink(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    target: String,
    link_path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.create_symlink(&session_id, &target, &link_path).await
}

#[tauri::command]
pub async fn sftp_read_link(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.read_link(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_touch(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.touch(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_truncate(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
    size: u64,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.truncate(&session_id, &path, size).await
}

#[tauri::command]
pub async fn sftp_read_text_file(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
    max_bytes: Option<u64>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.read_text_file(&session_id, &path, max_bytes).await
}

#[tauri::command]
pub async fn sftp_write_text_file(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
    content: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.write_text_file(&session_id, &path, &content).await
}

#[tauri::command]
pub async fn sftp_checksum(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.checksum(&session_id, &path).await
}

#[tauri::command]
pub async fn sftp_exists(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    path: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    svc.exists(&session_id, &path).await
}

// ── Transfer ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_upload(
    state: tauri::State<'_, SftpServiceState>,
    request: SftpTransferRequest,
) -> Result<TransferResult, String> {
    let mut svc = state.lock().await;
    svc.upload(request).await
}

#[tauri::command]
pub async fn sftp_download(
    state: tauri::State<'_, SftpServiceState>,
    request: SftpTransferRequest,
) -> Result<TransferResult, String> {
    let mut svc = state.lock().await;
    svc.download(request).await
}

#[tauri::command]
pub async fn sftp_batch_transfer(
    state: tauri::State<'_, SftpServiceState>,
    batch: SftpBatchTransfer,
) -> Result<BatchTransferResult, String> {
    let mut svc = state.lock().await;
    svc.batch_transfer(batch).await
}

#[tauri::command]
pub async fn sftp_get_transfer_progress(
    state: tauri::State<'_, SftpServiceState>,
    transfer_id: String,
) -> Result<Option<TransferProgress>, String> {
    let svc = state.lock().await;
    Ok(svc.get_transfer_progress(&transfer_id))
}

#[tauri::command]
pub async fn sftp_list_active_transfers(
    state: tauri::State<'_, SftpServiceState>,
) -> Result<Vec<TransferProgress>, String> {
    let svc = state.lock().await;
    Ok(svc.list_active_transfers())
}

#[tauri::command]
pub async fn sftp_cancel_transfer(
    state: tauri::State<'_, SftpServiceState>,
    transfer_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.cancel_transfer(&transfer_id)
}

#[tauri::command]
pub async fn sftp_pause_transfer(
    state: tauri::State<'_, SftpServiceState>,
    transfer_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.pause_transfer(&transfer_id)
}

#[tauri::command]
pub async fn sftp_clear_completed_transfers(
    state: tauri::State<'_, SftpServiceState>,
) -> Result<usize, String> {
    let svc = state.lock().await;
    Ok(svc.clear_completed_transfers())
}

// ── Queue ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_queue_add(
    state: tauri::State<'_, SftpServiceState>,
    request: SftpTransferRequest,
    priority: Option<i32>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.queue_add(request, priority).await
}

#[tauri::command]
pub async fn sftp_queue_remove(
    state: tauri::State<'_, SftpServiceState>,
    queue_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.queue_remove(&queue_id).await
}

#[tauri::command]
pub async fn sftp_queue_list(
    state: tauri::State<'_, SftpServiceState>,
) -> Result<Vec<QueueEntry>, String> {
    let svc = state.lock().await;
    Ok(svc.queue_list().await)
}

#[tauri::command]
pub async fn sftp_queue_status(
    state: tauri::State<'_, SftpServiceState>,
) -> Result<QueueStatus, String> {
    let svc = state.lock().await;
    Ok(svc.queue_status().await)
}

#[tauri::command]
pub async fn sftp_queue_start(
    state: tauri::State<'_, SftpServiceState>,
) -> Result<usize, String> {
    let mut svc = state.lock().await;
    svc.queue_start().await
}

#[tauri::command]
pub async fn sftp_queue_stop(
    state: tauri::State<'_, SftpServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.queue_stop().await;
    Ok(())
}

#[tauri::command]
pub async fn sftp_queue_retry_failed(
    state: tauri::State<'_, SftpServiceState>,
) -> Result<usize, String> {
    let mut svc = state.lock().await;
    Ok(svc.queue_retry_failed().await)
}

#[tauri::command]
pub async fn sftp_queue_clear_done(
    state: tauri::State<'_, SftpServiceState>,
) -> Result<usize, String> {
    let mut svc = state.lock().await;
    Ok(svc.queue_clear_done().await)
}

#[tauri::command]
pub async fn sftp_queue_set_priority(
    state: tauri::State<'_, SftpServiceState>,
    queue_id: String,
    priority: i32,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.queue_set_priority(&queue_id, priority).await
}

// ── Watch / Sync ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_watch_start(
    state: tauri::State<'_, SftpServiceState>,
    config: WatchConfig,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.watch_start(config).await
}

#[tauri::command]
pub async fn sftp_watch_stop(
    state: tauri::State<'_, SftpServiceState>,
    watch_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.watch_stop(&watch_id).await
}

#[tauri::command]
pub async fn sftp_watch_list(
    state: tauri::State<'_, SftpServiceState>,
) -> Result<Vec<WatchInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.watch_list().await)
}

#[tauri::command]
pub async fn sftp_sync_pull(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<SyncResult, String> {
    let mut svc = state.lock().await;
    svc.sync_pull(&session_id, &remote_path, &local_path).await
}

#[tauri::command]
pub async fn sftp_sync_push(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<SyncResult, String> {
    let mut svc = state.lock().await;
    svc.sync_push(&session_id, &local_path, &remote_path).await
}

// ── Bookmarks ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_bookmark_add(
    state: tauri::State<'_, SftpServiceState>,
    bookmark: SftpBookmark,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.bookmark_add(bookmark).await
}

#[tauri::command]
pub async fn sftp_bookmark_remove(
    state: tauri::State<'_, SftpServiceState>,
    bookmark_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.bookmark_remove(&bookmark_id).await
}

#[tauri::command]
pub async fn sftp_bookmark_update(
    state: tauri::State<'_, SftpServiceState>,
    bookmark: SftpBookmark,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.bookmark_update(bookmark).await
}

#[tauri::command]
pub async fn sftp_bookmark_list(
    state: tauri::State<'_, SftpServiceState>,
    group: Option<String>,
) -> Result<Vec<SftpBookmark>, String> {
    let svc = state.lock().await;
    Ok(svc.bookmark_list(group).await)
}

#[tauri::command]
pub async fn sftp_bookmark_touch(
    state: tauri::State<'_, SftpServiceState>,
    bookmark_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.bookmark_touch(&bookmark_id).await
}

#[tauri::command]
pub async fn sftp_bookmark_import(
    state: tauri::State<'_, SftpServiceState>,
    json: String,
) -> Result<usize, String> {
    let mut svc = state.lock().await;
    svc.bookmark_import(&json).await
}

#[tauri::command]
pub async fn sftp_bookmark_export(
    state: tauri::State<'_, SftpServiceState>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.bookmark_export().await
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_diagnose(
    state: tauri::State<'_, SftpServiceState>,
    session_id: String,
) -> Result<SftpDiagnosticReport, String> {
    let mut svc = state.lock().await;
    svc.diagnose(&session_id).await
}
