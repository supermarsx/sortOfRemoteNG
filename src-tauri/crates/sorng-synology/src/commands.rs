// Tauri command handlers for Synology NAS management.
//
// All commands are prefixed `syn_` and use `State<'_, SynologyServiceState>`.

use super::service::SynologyServiceState;
use super::types::*;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

// ─── Scoped File Station explorer ─────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn syn_fs_connect(
    state: State<'_, SynologyServiceState>,
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
    state
        .lock()
        .await
        .fs_connect(config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_fs_disconnect(
    state: State<'_, SynologyServiceState>,
    expected_session_id: String,
) -> Result<bool, String> {
    state
        .lock()
        .await
        .fs_disconnect(&expected_session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_fs_list(
    state: State<'_, SynologyServiceState>,
    expected_session_id: String,
    folder_path: Option<String>,
    offset: u64,
    limit: u64,
    sort_by: String,
    sort_direction: String,
) -> Result<FileListResult, String> {
    state
        .lock()
        .await
        .fs_list(
            &expected_session_id,
            folder_path.as_deref(),
            offset,
            limit,
            &sort_by,
            &sort_direction,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_fs_create_folder(
    state: State<'_, SynologyServiceState>,
    expected_session_id: String,
    folder_path: String,
    name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .fs_create_folder(&expected_session_id, &folder_path, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_fs_rename(
    state: State<'_, SynologyServiceState>,
    expected_session_id: String,
    path: String,
    name: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .fs_rename(&expected_session_id, &path, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn syn_fs_start_task(
    state: State<'_, SynologyServiceState>,
    expected_session_id: String,
    operation: FileOperation,
    paths: Vec<String>,
    destination: Option<String>,
    pattern: Option<String>,
    overwrite: Option<bool>,
) -> Result<FileTaskReceipt, String> {
    state
        .lock()
        .await
        .fs_start_task(
            &expected_session_id,
            operation,
            paths,
            destination,
            pattern,
            overwrite,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_fs_task_status(
    state: State<'_, SynologyServiceState>,
    expected_session_id: String,
    task_id: String,
    offset: Option<u64>,
    limit: Option<u64>,
) -> Result<FileTaskStatus, String> {
    state
        .lock()
        .await
        .fs_task_status(
            &expected_session_id,
            &task_id,
            offset.unwrap_or(0),
            limit.unwrap_or(100),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_fs_stop_task(
    state: State<'_, SynologyServiceState>,
    expected_session_id: String,
    task_id: String,
) -> Result<(), String> {
    state
        .lock()
        .await
        .fs_stop_task(&expected_session_id, &task_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_fs_upload(
    window: tauri::WebviewWindow,
    state: State<'_, SynologyServiceState>,
    expected_session_id: String,
    folder_path: String,
    overwrite: Option<bool>,
) -> Result<FileTransferOutcome, String> {
    state
        .lock()
        .await
        .fs_assert_session(&expected_session_id)
        .map_err(|e| e.to_string())?;
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
        .lock()
        .await
        .fs_transfer_context(&expected_session_id)
        .map_err(|e| e.to_string())?;
    let Some(selected) = selected else {
        return Ok(FileTransferOutcome::cancelled());
    };
    let path = selected
        .into_path()
        .map_err(|_| "Choose a local file, not a URL".to_string())?;
    context
        .upload_selected(&path, &folder_path, overwrite)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_fs_download(
    window: tauri::WebviewWindow,
    state: State<'_, SynologyServiceState>,
    expected_session_id: String,
    path: String,
) -> Result<FileTransferOutcome, String> {
    state
        .lock()
        .await
        .fs_assert_session(&expected_session_id)
        .map_err(|e| e.to_string())?;
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
        .lock()
        .await
        .fs_transfer_context(&expected_session_id)
        .map_err(|e| e.to_string())?;
    let Some(selected) = selected else {
        return Ok(FileTransferOutcome::cancelled());
    };
    let local_path = selected
        .into_path()
        .map_err(|_| "Choose a local destination, not a URL".to_string())?;
    context
        .download_selected(&path, &local_path)
        .await
        .map_err(|e| e.to_string())
}

// ─── Connection ──────────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn syn_connect(
    state: State<'_, SynologyServiceState>,
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
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_disconnect(state: State<'_, SynologyServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_is_connected(state: State<'_, SynologyServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected())
}

#[tauri::command]
pub async fn syn_check_session(state: State<'_, SynologyServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.check_session().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_config(
    state: State<'_, SynologyServiceState>,
) -> Result<Option<SynologyConfigSafe>, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

// ─── System ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_system_info(
    state: State<'_, SynologyServiceState>,
) -> Result<DsmInfo, String> {
    let svc = state.lock().await;
    svc.get_system_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_utilization(
    state: State<'_, SynologyServiceState>,
) -> Result<SystemUtilization, String> {
    let svc = state.lock().await;
    svc.get_utilization().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_processes(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<ProcessInfo>, String> {
    let svc = state.lock().await;
    svc.list_processes().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_reboot(state: State<'_, SynologyServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.reboot().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_shutdown(state: State<'_, SynologyServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.shutdown().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_check_update(
    state: State<'_, SynologyServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.check_update().await.map_err(|e| e.to_string())
}

// ─── Storage ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_storage_overview(
    state: State<'_, SynologyServiceState>,
) -> Result<StorageOverview, String> {
    let svc = state.lock().await;
    svc.get_storage_overview().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_disks(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<DiskInfo>, String> {
    let svc = state.lock().await;
    svc.list_disks().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_volumes(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<VolumeInfo>, String> {
    let svc = state.lock().await;
    svc.list_volumes().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_smart_info(
    state: State<'_, SynologyServiceState>,
    disk_id: String,
) -> Result<SmartInfo, String> {
    let svc = state.lock().await;
    svc.get_smart_info(&disk_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_iscsi_luns(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<IscsiLun>, String> {
    let svc = state.lock().await;
    svc.list_iscsi_luns().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_iscsi_targets(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<IscsiTarget>, String> {
    let svc = state.lock().await;
    svc.list_iscsi_targets().await.map_err(|e| e.to_string())
}

// ─── File Station ────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_file_station_info(
    state: State<'_, SynologyServiceState>,
) -> Result<FileStationInfo, String> {
    let svc = state.lock().await;
    svc.get_file_station_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_files(
    state: State<'_, SynologyServiceState>,
    folder_path: String,
    offset: u64,
    limit: u64,
    sort_by: String,
    sort_direction: String,
) -> Result<FileListResult, String> {
    let svc = state.lock().await;
    svc.list_files(&folder_path, offset, limit, &sort_by, &sort_direction)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_file_shared_folders(
    state: State<'_, SynologyServiceState>,
) -> Result<FileListResult, String> {
    let svc = state.lock().await;
    svc.list_file_shared_folders()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_search_files(
    state: State<'_, SynologyServiceState>,
    folder_path: String,
    pattern: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.search_files(&folder_path, &pattern)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_upload_file(
    state: State<'_, SynologyServiceState>,
    dest_folder: String,
    file_name: String,
    content: Vec<u8>,
    overwrite: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.upload_file(&dest_folder, &file_name, content, overwrite)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_download_file(
    state: State<'_, SynologyServiceState>,
    file_path: String,
) -> Result<Vec<u8>, String> {
    let svc = state.lock().await;
    svc.download_file(&file_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_create_folder(
    state: State<'_, SynologyServiceState>,
    folder_path: String,
    name: String,
    force_parent: bool,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.create_folder(&folder_path, &name, force_parent)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_delete_files(
    state: State<'_, SynologyServiceState>,
    paths: Vec<String>,
    recursive: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    svc.delete_files(&path_refs, recursive)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_rename_file(
    state: State<'_, SynologyServiceState>,
    path: String,
    new_name: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.rename_file(&path, &new_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_create_share_link(
    state: State<'_, SynologyServiceState>,
    path: String,
    password: Option<String>,
    expire_days: Option<u32>,
) -> Result<ShareLinkInfo, String> {
    let svc = state.lock().await;
    svc.create_share_link(&path, password.as_deref(), expire_days)
        .await
        .map_err(|e| e.to_string())
}

// ─── Shared Folders ──────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_shared_folders(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<SharedFolder>, String> {
    let svc = state.lock().await;
    svc.list_shared_folders().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_share_permissions(
    state: State<'_, SynologyServiceState>,
    name: String,
) -> Result<Vec<SharePermission>, String> {
    let svc = state.lock().await;
    svc.get_share_permissions(&name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_create_shared_folder(
    state: State<'_, SynologyServiceState>,
    name: String,
    vol_path: String,
    desc: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.create_shared_folder(&name, &vol_path, &desc)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_delete_shared_folder(
    state: State<'_, SynologyServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_shared_folder(&name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_mount_encrypted_share(
    state: State<'_, SynologyServiceState>,
    name: String,
    password: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.mount_encrypted_share(&name, &password)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_unmount_encrypted_share(
    state: State<'_, SynologyServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.unmount_encrypted_share(&name)
        .await
        .map_err(|e| e.to_string())
}

// ─── Network ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_network_overview(
    state: State<'_, SynologyServiceState>,
) -> Result<NetworkOverview, String> {
    let svc = state.lock().await;
    svc.get_network_overview().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_network_interfaces(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<NetworkInterface>, String> {
    let svc = state.lock().await;
    svc.list_network_interfaces()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_firewall_rules(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<FirewallRule>, String> {
    let svc = state.lock().await;
    svc.list_firewall_rules().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_dhcp_leases(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<DhcpLease>, String> {
    let svc = state.lock().await;
    svc.list_dhcp_leases().await.map_err(|e| e.to_string())
}

// ─── Users ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_users(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<SynoUser>, String> {
    let svc = state.lock().await;
    svc.list_users().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_create_user(
    state: State<'_, SynologyServiceState>,
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
    let svc = state.lock().await;
    svc.create_user(&params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_delete_user(
    state: State<'_, SynologyServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_user(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_groups(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<SynoGroup>, String> {
    let svc = state.lock().await;
    svc.list_groups().await.map_err(|e| e.to_string())
}

// ─── Packages ────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_packages(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<PackageInfo>, String> {
    let svc = state.lock().await;
    svc.list_packages().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_start_package(
    state: State<'_, SynologyServiceState>,
    id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.start_package(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_stop_package(
    state: State<'_, SynologyServiceState>,
    id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.stop_package(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_install_package(
    state: State<'_, SynologyServiceState>,
    id: String,
    volume: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.install_package(&id, &volume)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_uninstall_package(
    state: State<'_, SynologyServiceState>,
    id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.uninstall_package(&id).await.map_err(|e| e.to_string())
}

// ─── Services ────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_services(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<ServiceStatus>, String> {
    let svc = state.lock().await;
    svc.list_services().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_smb_config(
    state: State<'_, SynologyServiceState>,
) -> Result<SmbConfig, String> {
    let svc = state.lock().await;
    svc.get_smb_config().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_nfs_config(
    state: State<'_, SynologyServiceState>,
) -> Result<NfsConfig, String> {
    let svc = state.lock().await;
    svc.get_nfs_config().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_ssh_config(
    state: State<'_, SynologyServiceState>,
) -> Result<SshConfig, String> {
    let svc = state.lock().await;
    svc.get_ssh_config().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_set_ssh_enabled(
    state: State<'_, SynologyServiceState>,
    enabled: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_ssh_enabled(enabled)
        .await
        .map_err(|e| e.to_string())
}

// ─── Docker ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_docker_containers(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<DockerContainer>, String> {
    let svc = state.lock().await;
    svc.list_docker_containers()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_start_docker_container(
    state: State<'_, SynologyServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.start_docker_container(&name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_stop_docker_container(
    state: State<'_, SynologyServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.stop_docker_container(&name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_restart_docker_container(
    state: State<'_, SynologyServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.restart_docker_container(&name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_delete_docker_container(
    state: State<'_, SynologyServiceState>,
    name: String,
    force: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_docker_container(&name, force)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_docker_images(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<DockerImage>, String> {
    let svc = state.lock().await;
    svc.list_docker_images().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_pull_docker_image(
    state: State<'_, SynologyServiceState>,
    repository: String,
    tag: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.pull_docker_image(&repository, &tag)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_docker_networks(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<DockerNetwork>, String> {
    let svc = state.lock().await;
    svc.list_docker_networks().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_docker_projects(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<DockerProject>, String> {
    let svc = state.lock().await;
    svc.list_docker_projects().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_start_docker_project(
    state: State<'_, SynologyServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.start_docker_project(&name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_stop_docker_project(
    state: State<'_, SynologyServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.stop_docker_project(&name)
        .await
        .map_err(|e| e.to_string())
}

// ─── Virtual Machines ────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_vms(state: State<'_, SynologyServiceState>) -> Result<Vec<VmGuest>, String> {
    let svc = state.lock().await;
    svc.list_vms().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_vm_power_on(
    state: State<'_, SynologyServiceState>,
    guest_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.vm_power_on(&guest_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_vm_shutdown(
    state: State<'_, SynologyServiceState>,
    guest_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.vm_shutdown(&guest_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_vm_force_shutdown(
    state: State<'_, SynologyServiceState>,
    guest_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.vm_force_shutdown(&guest_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_vm_snapshots(
    state: State<'_, SynologyServiceState>,
    guest_id: String,
) -> Result<Vec<VmSnapshot>, String> {
    let svc = state.lock().await;
    svc.list_vm_snapshots(&guest_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_take_vm_snapshot(
    state: State<'_, SynologyServiceState>,
    guest_id: String,
    description: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.take_vm_snapshot(&guest_id, &description)
        .await
        .map_err(|e| e.to_string())
}

// ─── Download Station ────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_download_station_info(
    state: State<'_, SynologyServiceState>,
) -> Result<DownloadStationInfo, String> {
    let svc = state.lock().await;
    svc.get_download_station_info()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_download_tasks(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<DownloadTask>, String> {
    let svc = state.lock().await;
    svc.list_download_tasks().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_create_download_task(
    state: State<'_, SynologyServiceState>,
    uri: String,
    destination: Option<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.create_download_task(&uri, destination.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_pause_download(
    state: State<'_, SynologyServiceState>,
    task_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.pause_download(&task_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_resume_download(
    state: State<'_, SynologyServiceState>,
    task_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.resume_download(&task_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_delete_download(
    state: State<'_, SynologyServiceState>,
    task_id: String,
    force: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_download(&task_id, force)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_download_stats(
    state: State<'_, SynologyServiceState>,
) -> Result<DownloadStationStats, String> {
    let svc = state.lock().await;
    svc.get_download_stats().await.map_err(|e| e.to_string())
}

// ─── Surveillance Station ────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_surveillance_info(
    state: State<'_, SynologyServiceState>,
) -> Result<SurveillanceInfo, String> {
    let svc = state.lock().await;
    svc.get_surveillance_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_cameras(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<Camera>, String> {
    let svc = state.lock().await;
    svc.list_cameras().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_camera_snapshot(
    state: State<'_, SynologyServiceState>,
    cam_id: String,
) -> Result<Vec<u8>, String> {
    let svc = state.lock().await;
    svc.get_camera_snapshot(&cam_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_recordings(
    state: State<'_, SynologyServiceState>,
    cam_id: String,
    offset: u64,
    limit: u64,
) -> Result<Vec<Recording>, String> {
    let svc = state.lock().await;
    svc.list_recordings(&cam_id, offset, limit)
        .await
        .map_err(|e| e.to_string())
}

// ─── Backup ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_list_backup_tasks(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<BackupTaskInfo>, String> {
    let svc = state.lock().await;
    svc.list_backup_tasks().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_start_backup_task(
    state: State<'_, SynologyServiceState>,
    task_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.start_backup_task(&task_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_cancel_backup_task(
    state: State<'_, SynologyServiceState>,
    task_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.cancel_backup_task(&task_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_backup_versions(
    state: State<'_, SynologyServiceState>,
    task_id: String,
) -> Result<Vec<BackupVersion>, String> {
    let svc = state.lock().await;
    svc.list_backup_versions(&task_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_active_backup_devices(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<ActiveBackupDevice>, String> {
    let svc = state.lock().await;
    svc.list_active_backup_devices()
        .await
        .map_err(|e| e.to_string())
}

// ─── Security ────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_security_overview(
    state: State<'_, SynologyServiceState>,
) -> Result<SecurityOverview, String> {
    let svc = state.lock().await;
    svc.get_security_overview().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_blocked_ips(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<BlockedIp>, String> {
    let svc = state.lock().await;
    svc.list_blocked_ips().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_unblock_ip(
    state: State<'_, SynologyServiceState>,
    ip: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.unblock_ip(&ip).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_list_certificates(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<CertificateInfo>, String> {
    let svc = state.lock().await;
    svc.list_certificates().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_auto_block_config(
    state: State<'_, SynologyServiceState>,
) -> Result<AutoBlockConfig, String> {
    let svc = state.lock().await;
    svc.get_auto_block_config().await.map_err(|e| e.to_string())
}

// ─── Hardware ────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_hardware_info(
    state: State<'_, SynologyServiceState>,
) -> Result<HardwareInfo, String> {
    let svc = state.lock().await;
    svc.get_hardware_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_ups_info(state: State<'_, SynologyServiceState>) -> Result<UpsInfo, String> {
    let svc = state.lock().await;
    svc.get_ups_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_power_schedule(
    state: State<'_, SynologyServiceState>,
) -> Result<PowerSchedule, String> {
    let svc = state.lock().await;
    svc.get_power_schedule().await.map_err(|e| e.to_string())
}

// ─── Logs ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_system_logs(
    state: State<'_, SynologyServiceState>,
    offset: u64,
    limit: u64,
) -> Result<Vec<LogEntry>, String> {
    let svc = state.lock().await;
    svc.get_system_logs(offset, limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_connection_logs(
    state: State<'_, SynologyServiceState>,
    offset: u64,
    limit: u64,
) -> Result<Vec<ConnectionEntry>, String> {
    let svc = state.lock().await;
    svc.get_connection_logs(offset, limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_get_active_connections(
    state: State<'_, SynologyServiceState>,
) -> Result<Vec<ConnectionEntry>, String> {
    let svc = state.lock().await;
    svc.get_active_connections()
        .await
        .map_err(|e| e.to_string())
}

// ─── Notifications ───────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_notification_config(
    state: State<'_, SynologyServiceState>,
) -> Result<NotificationConfig, String> {
    let svc = state.lock().await;
    svc.get_notification_config()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn syn_test_email_notification(
    state: State<'_, SynologyServiceState>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.test_email_notification()
        .await
        .map_err(|e| e.to_string())
}

// ─── Dashboard ───────────────────────────────────────────────────

#[tauri::command]
pub async fn syn_get_dashboard(
    state: State<'_, SynologyServiceState>,
) -> Result<SynologyDashboard, String> {
    let svc = state.lock().await;
    svc.get_dashboard().await.map_err(|e| e.to_string())
}
