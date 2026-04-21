// ── Tauri command shims ──────────────────────────────────────────────────────
//
// Each `#[tauri::command]` function is a thin wrapper around the
// `SmbService` state. They are `async`, take `tauri::State`, acquire the
// service mutex briefly, and delegate to the backend (which does its
// own `spawn_blocking` for blocking work). Commands return
// `Result<T, String>` so the frontend invoke sees a string error.
//
// Command list (also captured in `.orchestration/logs/e05-smb-commands.md`):
//   • smb_connect              — establish a new session, returns SmbSessionInfo
//   • smb_disconnect           — close one session
//   • smb_disconnect_all       — close everything (rarely called)
//   • smb_list_sessions        — enumerate active sessions
//   • smb_get_session_info     — single-session metadata
//   • smb_list_shares          — enumerate shares on the server
//   • smb_list_directory       — list a directory inside a share
//   • smb_stat                 — metadata for one file/dir
//   • smb_read_file            — read a file into base64 (for small files)
//   • smb_write_file           — write base64 bytes to a file
//   • smb_download_file        — stream a remote file to local disk
//   • smb_upload_file          — stream a local file to the share
//   • smb_mkdir                — create a directory
//   • smb_rmdir                — remove a directory (optionally recursive)
//   • smb_delete_file          — delete one file
//   • smb_rename               — rename / move within a share

use super::service::SmbServiceState;
use super::types::*;

#[tauri::command]
pub async fn smb_connect(
    state: tauri::State<'_, SmbServiceState>,
    config: SmbConnectionConfig,
) -> Result<SmbSessionInfo, String> {
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(Into::into)
}

#[tauri::command]
pub async fn smb_disconnect(
    state: tauri::State<'_, SmbServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn smb_disconnect_all(state: tauri::State<'_, SmbServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_all().await.map_err(Into::into)
}

#[tauri::command]
pub async fn smb_list_sessions(
    state: tauri::State<'_, SmbServiceState>,
) -> Result<Vec<SmbSessionInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions().await)
}

#[tauri::command]
pub async fn smb_get_session_info(
    state: tauri::State<'_, SmbServiceState>,
    session_id: String,
) -> Result<SmbSessionInfo, String> {
    let svc = state.lock().await;
    svc.get_session_info(&session_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn smb_list_shares(
    state: tauri::State<'_, SmbServiceState>,
    session_id: String,
) -> Result<Vec<SmbShareInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_shares(&session_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn smb_list_directory(
    state: tauri::State<'_, SmbServiceState>,
    session_id: String,
    share: String,
    path: String,
) -> Result<Vec<SmbDirEntry>, String> {
    let mut svc = state.lock().await;
    svc.list_directory(&session_id, &share, &path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn smb_stat(
    state: tauri::State<'_, SmbServiceState>,
    session_id: String,
    share: String,
    path: String,
) -> Result<SmbStat, String> {
    let mut svc = state.lock().await;
    svc.stat(&session_id, &share, &path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn smb_read_file(
    state: tauri::State<'_, SmbServiceState>,
    session_id: String,
    share: String,
    path: String,
    max_bytes: Option<u64>,
) -> Result<SmbReadResult, String> {
    let mut svc = state.lock().await;
    svc.read_file(&session_id, &share, &path, max_bytes)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn smb_write_file(
    state: tauri::State<'_, SmbServiceState>,
    session_id: String,
    share: String,
    path: String,
    content_b64: String,
    overwrite: Option<bool>,
) -> Result<SmbWriteResult, String> {
    let mut svc = state.lock().await;
    svc.write_file(
        &session_id,
        &share,
        &path,
        &content_b64,
        overwrite.unwrap_or(true),
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn smb_download_file(
    state: tauri::State<'_, SmbServiceState>,
    session_id: String,
    share: String,
    remote_path: String,
    local_path: String,
) -> Result<SmbTransferResult, String> {
    let mut svc = state.lock().await;
    svc.download_file(&session_id, &share, &remote_path, &local_path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn smb_upload_file(
    state: tauri::State<'_, SmbServiceState>,
    session_id: String,
    share: String,
    local_path: String,
    remote_path: String,
) -> Result<SmbTransferResult, String> {
    let mut svc = state.lock().await;
    svc.upload_file(&session_id, &share, &local_path, &remote_path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn smb_mkdir(
    state: tauri::State<'_, SmbServiceState>,
    session_id: String,
    share: String,
    path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.mkdir(&session_id, &share, &path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn smb_rmdir(
    state: tauri::State<'_, SmbServiceState>,
    session_id: String,
    share: String,
    path: String,
    recursive: Option<bool>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rmdir(&session_id, &share, &path, recursive.unwrap_or(false))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn smb_delete_file(
    state: tauri::State<'_, SmbServiceState>,
    session_id: String,
    share: String,
    path: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_file(&session_id, &share, &path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn smb_rename(
    state: tauri::State<'_, SmbServiceState>,
    session_id: String,
    share: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.rename(&session_id, &share, &from, &to)
        .await
        .map_err(Into::into)
}
