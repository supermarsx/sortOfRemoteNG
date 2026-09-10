// Tauri command handlers for Synology NAS management.
//
// All commands are prefixed `syn_` and use `State<'_, SynologyServiceState>`.

use super::service::{synology_command_error, SynologyServiceState};
use super::types::*;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

// ─── Scoped File Station explorer ─────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn syn_fs_connect(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    request_id: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    use_https: bool,
    otp_code: Option<String>,
) -> Result<FileStationLogin, String> {
    let config = SynologyConfig {
        host,
        port,
        username,
        password,
        use_https,
        insecure: false,
        timeout_secs: 30,
        otp_code,
        device_token: None,
        access_token: None,
    };
    state.connect(&instance_id, &request_id, config).await
}

#[tauri::command]
pub async fn syn_fs_disconnect(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
) -> Result<bool, String> {
    state.disconnect(&instance_id, &expected_session_id)
}

#[tauri::command]
pub fn syn_fs_session_health(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
) -> Result<sorng_synology::instances::FileSessionHealth, String> {
    state.session_health(&instance_id, &expected_session_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Existing IPC fields plus mandatory scope.
pub async fn syn_fs_list(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
    folder_path: Option<String>,
    offset: u64,
    limit: u64,
    sort_by: String,
    sort_direction: String,
) -> Result<FileListResult, String> {
    {
        let svc = state
            .resolve(Some(&instance_id), Some(&expected_session_id))
            .await?;
        let result = svc
            .fs_list(
                &expected_session_id,
                folder_path.as_deref(),
                offset,
                limit,
                &sort_by,
                &sort_direction,
            )
            .await;
        svc.finish(result)
    }
}

#[tauri::command]
pub async fn syn_fs_create_folder(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
    folder_path: String,
    name: String,
) -> Result<(), String> {
    {
        let svc = state
            .resolve(Some(&instance_id), Some(&expected_session_id))
            .await?;
        let result = svc
            .fs_create_folder(&expected_session_id, &folder_path, &name)
            .await;
        svc.finish(result)
    }
}

#[tauri::command]
pub async fn syn_fs_rename(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
    path: String,
    name: String,
) -> Result<(), String> {
    {
        let svc = state
            .resolve(Some(&instance_id), Some(&expected_session_id))
            .await?;
        let result = svc.fs_rename(&expected_session_id, &path, &name).await;
        svc.finish(result)
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn syn_fs_start_task(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
    operation: FileOperation,
    paths: Vec<String>,
    destination: Option<String>,
    pattern: Option<String>,
    overwrite: Option<bool>,
) -> Result<FileTaskReceipt, String> {
    {
        let mut svc = state
            .resolve(Some(&instance_id), Some(&expected_session_id))
            .await?;
        let result = svc
            .fs_start_task(
                &expected_session_id,
                operation,
                paths,
                destination,
                pattern,
                overwrite,
            )
            .await;
        svc.finish(result)
    }
}

#[tauri::command]
pub async fn syn_fs_task_status(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
    task_id: String,
    offset: Option<u64>,
    limit: Option<u64>,
) -> Result<FileTaskStatus, String> {
    {
        let mut svc = state
            .resolve(Some(&instance_id), Some(&expected_session_id))
            .await?;
        let result = svc
            .fs_task_status(
                &expected_session_id,
                &task_id,
                offset.unwrap_or(0),
                limit.unwrap_or(100),
            )
            .await;
        svc.finish(result)
    }
}

#[tauri::command]
pub async fn syn_fs_stop_task(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
    task_id: String,
) -> Result<(), String> {
    {
        let mut svc = state
            .resolve(Some(&instance_id), Some(&expected_session_id))
            .await?;
        let result = svc.fs_stop_task(&expected_session_id, &task_id).await;
        svc.finish(result)
    }
}

#[tauri::command]
pub async fn syn_fs_upload(
    window: tauri::WebviewWindow,
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
    folder_path: String,
    overwrite: Option<bool>,
) -> Result<FileTransferOutcome, String> {
    state
        .resolve(Some(&instance_id), Some(&expected_session_id))
        .await?
        .fs_assert_session(&expected_session_id)
        .map_err(synology_command_error)?;
    let (send, receive) = tokio::sync::oneshot::channel();
    window
        .dialog()
        .file()
        .set_title("Upload to Synology File Station")
        .set_parent(&window)
        .pick_file(move |file| {
            let _ = send.send(file);
        });
    let selected = receive
        .await
        .map_err(|_| "File selection was cancelled".to_string())?;
    let context = state
        .resolve(Some(&instance_id), Some(&expected_session_id))
        .await?
        .fs_transfer_context(&expected_session_id)
        .map_err(synology_command_error)?;
    let Some(selected) = selected else {
        return Ok(FileTransferOutcome::cancelled());
    };
    let path = selected
        .into_path()
        .map_err(|_| "Choose a local file, not a URL".to_string())?;
    context
        .upload_selected(&path, &folder_path, overwrite)
        .await
        .map_err(synology_command_error)
}

#[tauri::command]
pub async fn syn_fs_download(
    window: tauri::WebviewWindow,
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
    path: String,
) -> Result<FileTransferOutcome, String> {
    state
        .resolve(Some(&instance_id), Some(&expected_session_id))
        .await?
        .fs_assert_session(&expected_session_id)
        .map_err(synology_command_error)?;
    let name = path
        .rsplit('/')
        .next()
        .filter(|n| {
            !n.is_empty() && n.len() <= 255 && !n.chars().any(|c| c.is_control() || c == '\\')
        })
        .ok_or_else(|| "Select a file to download".to_string())?;
    let (send, receive) = tokio::sync::oneshot::channel();
    window
        .dialog()
        .file()
        .set_title("Save File Station download (choose a new filename)")
        .set_file_name(name)
        .set_parent(&window)
        .save_file(move |file| {
            let _ = send.send(file);
        });
    let selected = receive
        .await
        .map_err(|_| "File selection was cancelled".to_string())?;
    let context = state
        .resolve(Some(&instance_id), Some(&expected_session_id))
        .await?
        .fs_transfer_context(&expected_session_id)
        .map_err(synology_command_error)?;
    let Some(selected) = selected else {
        return Ok(FileTransferOutcome::cancelled());
    };
    let local_path = selected
        .into_path()
        .map_err(|_| "Choose a local destination, not a URL".to_string())?;
    context
        .download_selected(&path, &local_path)
        .await
        .map_err(synology_command_error)
}

#[tauri::command]
pub async fn syn_fs_cancel_connect(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    request_id: String,
) -> Result<bool, String> {
    state.cancel_connect(&instance_id, &request_id)
}

// ─── Connection ──────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_fs_create_share_link(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
    path: String,
    password: Option<String>,
    expire_date: Option<String>,
) -> Result<FileShareLink, String> {
    let svc = state
        .resolve(Some(&instance_id), Some(&expected_session_id))
        .await?;
    let result = svc
        .fs_create_share_link(
            &expected_session_id,
            &path,
            password.as_deref(),
            expire_date.as_deref(),
        )
        .await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_fs_list_share_links(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
    offset: u64,
    limit: u64,
) -> Result<FileShareList, String> {
    let svc = state
        .resolve(Some(&instance_id), Some(&expected_session_id))
        .await?;
    let result = svc
        .fs_list_share_links(&expected_session_id, offset, limit)
        .await;
    svc.finish(result)
}
#[tauri::command]
pub async fn syn_fs_delete_share_links(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
    ids: Vec<String>,
) -> Result<(), String> {
    let svc = state
        .resolve(Some(&instance_id), Some(&expected_session_id))
        .await?;
    let result = svc.fs_delete_share_links(&expected_session_id, &ids).await;
    svc.finish(result)
}
#[tauri::command]
pub async fn syn_fs_camera_snapshot(
    state: State<'_, SynologyServiceState>,
    instance_id: String,
    expected_session_id: String,
    cam_id: String,
) -> Result<CameraSnapshot, String> {
    let svc = state
        .resolve(Some(&instance_id), Some(&expected_session_id))
        .await?;
    let result = svc.fs_camera_snapshot(&expected_session_id, &cam_id).await;
    svc.finish(result)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn syn_connect(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    host: String,
    port: u16,
    username: String,
    password: String,
    use_https: bool,
    insecure: bool,
    otp_code: Option<String>,
    access_token: Option<String>,
) -> Result<String, String> {
    let config = SynologyConfig {
        host,
        port,
        username,
        password,
        use_https,
        insecure,
        timeout_secs: 30,
        otp_code,
        device_token: None,
        access_token,
    };
    if instance_id.is_some() || expected_session_id.is_some() {
        return Err("Use syn_fs_connect for a named Synology instance".into());
    }
    let mut svc = state.resolve(None, None).await?;
    let result = svc.connect(config).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_disconnect(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<(), String> {
    if let (Some(instance), Some(expected)) =
        (instance_id.as_deref(), expected_session_id.as_deref())
    {
        return state.disconnect(instance, expected).map(|_| ());
    }
    let mut svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.disconnect().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_is_connected(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<bool, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = Ok(svc.is_connected());
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_check_session(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<bool, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.check_session().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_config(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Option<SynologyConfigSafe>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = Ok(svc.get_config());
    svc.finish(result)
}

// ─── System ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_system_info(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<DsmInfo, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_system_info().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_utilization(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<SystemUtilization, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_utilization().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_processes(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<ProcessInfo>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_processes().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_reboot(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.reboot().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_shutdown(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.shutdown().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_check_update(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.check_update().await;
    svc.finish(result)
}

// ─── Storage ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_storage_overview(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<StorageOverview, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_storage_overview().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_disks(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<DiskInfo>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_disks().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_volumes(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<VolumeInfo>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_volumes().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_smart_info(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    disk_id: String,
) -> Result<SmartInfo, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_smart_info(&disk_id).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_iscsi_luns(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<IscsiLun>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_iscsi_luns().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_iscsi_targets(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<IscsiTarget>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_iscsi_targets().await;
    svc.finish(result)
}

// ─── File Station ────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_file_station_info(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<FileStationInfo, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_file_station_info().await;
    svc.finish(result)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Legacy IPC shape plus optional exact scope pair.
pub async fn syn_list_files(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    folder_path: String,
    offset: u64,
    limit: u64,
    sort_by: String,
    sort_direction: String,
) -> Result<FileListResult, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc
        .list_files(&folder_path, offset, limit, &sort_by, &sort_direction)
        .await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_file_shared_folders(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<FileListResult, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_file_shared_folders().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_search_files(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    folder_path: String,
    pattern: String,
) -> Result<serde_json::Value, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.search_files(&folder_path, &pattern).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_upload_file(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    dest_folder: String,
    file_name: String,
    content: Vec<u8>,
    overwrite: bool,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc
        .upload_file(&dest_folder, &file_name, content, overwrite)
        .await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_download_file(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    file_path: String,
) -> Result<Vec<u8>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.download_file(&file_path).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_create_folder(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    folder_path: String,
    name: String,
    force_parent: bool,
) -> Result<serde_json::Value, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.create_folder(&folder_path, &name, force_parent).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_delete_files(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    paths: Vec<String>,
    recursive: bool,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    let result = svc.delete_files(&path_refs, recursive).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_rename_file(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    path: String,
    new_name: String,
) -> Result<serde_json::Value, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.rename_file(&path, &new_name).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_create_share_link(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    path: String,
    password: Option<String>,
    expire_days: Option<u32>,
) -> Result<ShareLinkInfo, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc
        .create_share_link(&path, password.as_deref(), expire_days)
        .await;
    svc.finish(result)
}

// ─── Shared Folders ──────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_shared_folders(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<SharedFolder>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_shared_folders().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_share_permissions(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    name: String,
) -> Result<Vec<SharePermission>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_share_permissions(&name).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_create_shared_folder(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    name: String,
    vol_path: String,
    desc: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.create_shared_folder(&name, &vol_path, &desc).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_delete_shared_folder(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    name: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.delete_shared_folder(&name).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_mount_encrypted_share(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    name: String,
    password: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.mount_encrypted_share(&name, &password).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_unmount_encrypted_share(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    name: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.unmount_encrypted_share(&name).await;
    svc.finish(result)
}

// ─── Network ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_network_overview(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<NetworkOverview, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_network_overview().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_network_interfaces(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<NetworkInterface>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_network_interfaces().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_firewall_rules(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<FirewallRule>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_firewall_rules().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_dhcp_leases(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<DhcpLease>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_dhcp_leases().await;
    svc.finish(result)
}

// ─── Users ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_users(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<SynoUser>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_users().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_create_user(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    name: String,
    password: String,
    description: Option<String>,
    email: Option<String>,
) -> Result<(), String> {
    let params = CreateUserParams {
        name,
        password,
        description,
        email,
        send_notification: None,
        expired: None,
        cannot_change_password: false,
    };
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.create_user(&params).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_delete_user(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    name: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.delete_user(&name).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_groups(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<SynoGroup>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_groups().await;
    svc.finish(result)
}

// ─── Packages ────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_packages(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<PackageInfo>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_packages().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_start_package(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    id: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.start_package(&id).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_stop_package(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    id: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.stop_package(&id).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_install_package(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    id: String,
    volume: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.install_package(&id, &volume).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_uninstall_package(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    id: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.uninstall_package(&id).await;
    svc.finish(result)
}

// ─── Services ────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_services(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<ServiceStatus>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_services().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_smb_config(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<SmbConfig, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_smb_config().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_nfs_config(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<NfsConfig, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_nfs_config().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_ssh_config(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<SshConfig, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_ssh_config().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_set_ssh_enabled(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.set_ssh_enabled(enabled).await;
    svc.finish(result)
}

// ─── Docker ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_docker_containers(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<DockerContainer>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_docker_containers().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_start_docker_container(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    name: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.start_docker_container(&name).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_stop_docker_container(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    name: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.stop_docker_container(&name).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_restart_docker_container(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    name: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.restart_docker_container(&name).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_delete_docker_container(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    name: String,
    force: bool,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.delete_docker_container(&name, force).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_docker_images(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<DockerImage>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_docker_images().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_pull_docker_image(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    repository: String,
    tag: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.pull_docker_image(&repository, &tag).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_docker_networks(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<DockerNetwork>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_docker_networks().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_docker_projects(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<DockerProject>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_docker_projects().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_start_docker_project(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    name: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.start_docker_project(&name).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_stop_docker_project(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    name: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.stop_docker_project(&name).await;
    svc.finish(result)
}

// ─── Virtual Machines ────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_vms(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<VmGuest>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_vms().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_vm_power_on(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    guest_id: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.vm_power_on(&guest_id).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_vm_shutdown(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    guest_id: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.vm_shutdown(&guest_id).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_vm_force_shutdown(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    guest_id: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.vm_force_shutdown(&guest_id).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_vm_snapshots(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    guest_id: String,
) -> Result<Vec<VmSnapshot>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_vm_snapshots(&guest_id).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_take_vm_snapshot(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    guest_id: String,
    description: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.take_vm_snapshot(&guest_id, &description).await;
    svc.finish(result)
}

// ─── Download Station ────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_download_station_info(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<DownloadStationInfo, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_download_station_info().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_download_tasks(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<DownloadTask>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_download_tasks().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_create_download_task(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    uri: String,
    destination: Option<String>,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.create_download_task(&uri, destination.as_deref()).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_pause_download(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    task_id: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.pause_download(&task_id).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_resume_download(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    task_id: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.resume_download(&task_id).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_delete_download(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    task_id: String,
    force: bool,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.delete_download(&task_id, force).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_download_stats(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<DownloadStationStats, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_download_stats().await;
    svc.finish(result)
}

// ─── Surveillance Station ────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_surveillance_info(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<SurveillanceInfo, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_surveillance_info().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_cameras(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<Camera>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_cameras().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_camera_snapshot(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    cam_id: String,
) -> Result<Vec<u8>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_camera_snapshot(&cam_id).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_recordings(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    cam_id: String,
    offset: u64,
    limit: u64,
) -> Result<Vec<Recording>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_recordings(&cam_id, offset, limit).await;
    svc.finish(result)
}

// ─── Backup ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_backup_tasks(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<BackupTaskInfo>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_backup_tasks().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_start_backup_task(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    task_id: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.start_backup_task(&task_id).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_cancel_backup_task(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    task_id: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.cancel_backup_task(&task_id).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_backup_versions(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    task_id: String,
) -> Result<Vec<BackupVersion>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_backup_versions(&task_id).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_active_backup_devices(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<ActiveBackupDevice>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_active_backup_devices().await;
    svc.finish(result)
}

// ─── Security ────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_security_overview(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<SecurityOverview, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_security_overview().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_blocked_ips(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<BlockedIp>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_blocked_ips().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_unblock_ip(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    ip: String,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.unblock_ip(&ip).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_list_certificates(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<CertificateInfo>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.list_certificates().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_auto_block_config(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<AutoBlockConfig, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_auto_block_config().await;
    svc.finish(result)
}

// ─── Hardware ────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_hardware_info(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<HardwareInfo, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_hardware_info().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_ups_info(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<UpsInfo, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_ups_info().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_power_schedule(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<PowerSchedule, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_power_schedule().await;
    svc.finish(result)
}

// ─── Logs ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_system_logs(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    offset: u64,
    limit: u64,
) -> Result<Vec<LogEntry>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_system_logs(offset, limit).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_connection_logs(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
    offset: u64,
    limit: u64,
) -> Result<Vec<ConnectionEntry>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_connection_logs(offset, limit).await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_get_active_connections(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<Vec<ConnectionEntry>, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_active_connections().await;
    svc.finish(result)
}

// ─── Notifications ───────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_notification_config(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<NotificationConfig, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_notification_config().await;
    svc.finish(result)
}

#[tauri::command]
pub async fn syn_test_email_notification(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<(), String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.test_email_notification().await;
    svc.finish(result)
}

// ─── Dashboard ───────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_dashboard(
    state: State<'_, SynologyServiceState>,
    instance_id: Option<String>,
    expected_session_id: Option<String>,
) -> Result<SynologyDashboard, String> {
    let svc = state
        .resolve(instance_id.as_deref(), expected_session_id.as_deref())
        .await?;
    let result = svc.get_dashboard().await;
    svc.finish(result)
}
