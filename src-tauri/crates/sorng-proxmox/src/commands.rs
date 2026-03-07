//! Tauri command handlers for all Proxmox VE operations.
//!
//! Every command is `async`, takes `State<'_, ProxmoxServiceState>` and
//! returns `Result<T, String>` (Tauri requires `String` errors).

use crate::service::ProxmoxServiceState;
use crate::types::*;
use tauri::State;

// ── Connection ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_connect(
    state: State<'_, ProxmoxServiceState>,
    host: String,
    port: Option<u16>,
    username: String,
    password: Option<String>,
    token_id: Option<String>,
    token_secret: Option<String>,
    insecure: Option<bool>,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    let auth = if let (Some(tid), Some(sec)) = (token_id, token_secret) {
        ProxmoxAuthMethod::ApiToken { token_id: tid, secret: sec }
    } else {
        ProxmoxAuthMethod::Password {
            username: username.clone(),
            password: password.unwrap_or_default(),
            realm: "pam".into(),
            otp: None,
        }
    };
    let config = ProxmoxConfig {
        host,
        port: port.unwrap_or(8006),
        auth,
        insecure: insecure.unwrap_or(true),
        timeout_secs: timeout_secs.unwrap_or(30),
        fingerprint: None,
    };
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_disconnect(
    state: State<'_, ProxmoxServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_check_session(
    state: State<'_, ProxmoxServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.check_session().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_is_connected(
    state: State<'_, ProxmoxServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected())
}

#[tauri::command]
pub async fn proxmox_get_config(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Option<ProxmoxConfigSafe>, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

#[tauri::command]
pub async fn proxmox_get_version(
    state: State<'_, ProxmoxServiceState>,
) -> Result<PveVersion, String> {
    let svc = state.lock().await;
    svc.get_version().await.map_err(|e| e.to_string())
}

// ── Nodes ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_list_nodes(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<NodeSummary>, String> {
    let svc = state.lock().await;
    svc.list_nodes().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_get_node_status(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<NodeStatus, String> {
    let svc = state.lock().await;
    svc.get_node_status(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_node_services(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<Vec<NodeService>, String> {
    let svc = state.lock().await;
    svc.list_node_services(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_start_node_service(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    service: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.start_node_service(&node, &service).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_stop_node_service(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    service: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.stop_node_service(&node, &service).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_restart_node_service(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    service: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.restart_node_service(&node, &service).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_get_node_dns(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<NodeDns, String> {
    let svc = state.lock().await;
    svc.get_node_dns(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_get_node_syslog(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    start: Option<u64>,
    limit: Option<u64>,
    since: Option<String>,
    until: Option<String>,
    service: Option<String>,
) -> Result<Vec<SyslogEntry>, String> {
    let svc = state.lock().await;
    svc.get_node_syslog(
        &node, start, limit,
        since.as_deref(), until.as_deref(), service.as_deref(),
    ).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_apt_updates(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<Vec<AptUpdate>, String> {
    let svc = state.lock().await;
    svc.list_apt_updates(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_reboot_node(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.reboot_node(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_shutdown_node(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.shutdown_node(&node).await.map_err(|e| e.to_string())
}

// ── QEMU VMs ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_list_qemu_vms(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<Vec<QemuVmSummary>, String> {
    let svc = state.lock().await;
    svc.list_qemu_vms(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_get_qemu_status(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<QemuStatusCurrent, String> {
    let svc = state.lock().await;
    svc.get_qemu_status(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_get_qemu_config(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<QemuConfig, String> {
    let svc = state.lock().await;
    svc.get_qemu_config(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_create_qemu_vm(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    params: QemuCreateParams,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.create_qemu_vm(&node, &params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_delete_qemu_vm(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    purge: Option<bool>,
    destroy_unreferenced: Option<bool>,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.delete_qemu_vm(&node, vmid, purge.unwrap_or(false), destroy_unreferenced.unwrap_or(false))
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_start_qemu_vm(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.start_qemu_vm(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_stop_qemu_vm(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.stop_qemu_vm(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_shutdown_qemu_vm(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    force: Option<bool>,
    timeout: Option<u64>,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.shutdown_qemu_vm(&node, vmid, force.unwrap_or(false), timeout)
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_reboot_qemu_vm(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    timeout: Option<u64>,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.reboot_qemu_vm(&node, vmid, timeout).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_suspend_qemu_vm(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    to_disk: Option<bool>,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.suspend_qemu_vm(&node, vmid, to_disk.unwrap_or(false))
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_resume_qemu_vm(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.resume_qemu_vm(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_reset_qemu_vm(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.reset_qemu_vm(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_resize_qemu_disk(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    params: DiskResizeParams,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.resize_qemu_disk(&node, vmid, &params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_clone_qemu_vm(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    params: QemuCloneParams,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.clone_qemu_vm(&node, vmid, &params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_migrate_qemu_vm(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    params: QemuMigrateParams,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.migrate_qemu_vm(&node, vmid, &params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_convert_qemu_to_template(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.convert_qemu_to_template(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_qemu_agent_exec(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    command: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.qemu_agent_exec(&node, vmid, &command).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_qemu_agent_network(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<QemuAgentInfo, String> {
    let svc = state.lock().await;
    svc.qemu_agent_network(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_qemu_agent_osinfo(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<QemuAgentInfo, String> {
    let svc = state.lock().await;
    svc.qemu_agent_osinfo(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_get_next_vmid(
    state: State<'_, ProxmoxServiceState>,
) -> Result<u64, String> {
    let svc = state.lock().await;
    svc.get_next_vmid().await.map_err(|e| e.to_string())
}

// ── LXC Containers ─────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_list_lxc_containers(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<Vec<LxcSummary>, String> {
    let svc = state.lock().await;
    svc.list_lxc_containers(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_get_lxc_status(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<LxcStatusCurrent, String> {
    let svc = state.lock().await;
    svc.get_lxc_status(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_get_lxc_config(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<LxcConfig, String> {
    let svc = state.lock().await;
    svc.get_lxc_config(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_create_lxc_container(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    params: LxcCreateParams,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.create_lxc_container(&node, &params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_delete_lxc_container(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    purge: Option<bool>,
    force: Option<bool>,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.delete_lxc_container(&node, vmid, purge.unwrap_or(false), force.unwrap_or(false))
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_start_lxc_container(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.start_lxc_container(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_stop_lxc_container(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.stop_lxc_container(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_shutdown_lxc_container(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    force: Option<bool>,
    timeout: Option<u64>,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.shutdown_lxc_container(&node, vmid, force.unwrap_or(false), timeout)
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_reboot_lxc_container(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    timeout: Option<u64>,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.reboot_lxc_container(&node, vmid, timeout).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_clone_lxc_container(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    params: LxcCloneParams,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.clone_lxc_container(&node, vmid, &params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_migrate_lxc_container(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    params: LxcMigrateParams,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.migrate_lxc_container(&node, vmid, &params).await.map_err(|e| e.to_string())
}

// ── Storage ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_list_storage(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<Vec<StorageSummary>, String> {
    let svc = state.lock().await;
    svc.list_storage(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_storage_content(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    storage: String,
    content_type: Option<String>,
    vmid: Option<u64>,
) -> Result<Vec<StorageContent>, String> {
    let svc = state.lock().await;
    svc.list_storage_content(&node, &storage, content_type.as_deref(), vmid)
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_delete_storage_volume(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    storage: String,
    volume: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.delete_storage_volume(&node, &storage, &volume).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_download_to_storage(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    storage: String,
    url: String,
    content: String,
    filename: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.download_to_storage(&node, &storage, &url, &content, &filename)
        .await.map_err(|e| e.to_string())
}

// ── Network ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_list_network_interfaces(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<Vec<NetworkInterface>, String> {
    let svc = state.lock().await;
    svc.list_network_interfaces(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_get_network_interface(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    iface: String,
) -> Result<NetworkInterface, String> {
    let svc = state.lock().await;
    svc.get_network_interface(&node, &iface).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_create_network_interface(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    params: CreateNetworkParams,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.create_network_interface(&node, &params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_delete_network_interface(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    iface: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.delete_network_interface(&node, &iface).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_apply_network_changes(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.apply_network_changes(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_revert_network_changes(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.revert_network_changes(&node).await.map_err(|e| e.to_string())
}

// ── Cluster ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_get_cluster_status(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<ClusterStatus>, String> {
    let svc = state.lock().await;
    svc.get_cluster_status().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_cluster_resources(
    state: State<'_, ProxmoxServiceState>,
    resource_type: Option<String>,
) -> Result<Vec<ClusterResource>, String> {
    let svc = state.lock().await;
    svc.list_cluster_resources(resource_type.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_get_cluster_next_id(
    state: State<'_, ProxmoxServiceState>,
) -> Result<u64, String> {
    let svc = state.lock().await;
    svc.get_cluster_next_id().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_users(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<PveUser>, String> {
    let svc = state.lock().await;
    svc.list_users().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_roles(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<PveRole>, String> {
    let svc = state.lock().await;
    svc.list_roles().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_groups(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<PveGroup>, String> {
    let svc = state.lock().await;
    svc.list_groups().await.map_err(|e| e.to_string())
}

// ── Tasks ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_list_tasks(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    start: Option<u64>,
    limit: Option<u64>,
    vmid: Option<u64>,
    type_filter: Option<String>,
    status_filter: Option<String>,
) -> Result<Vec<TaskSummary>, String> {
    let svc = state.lock().await;
    svc.list_tasks(&node, start, limit, vmid, type_filter.as_deref(), status_filter.as_deref())
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_get_task_status(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    upid: String,
) -> Result<TaskStatus, String> {
    let svc = state.lock().await;
    svc.get_task_status(&node, &upid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_get_task_log(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    upid: String,
    start: Option<u64>,
    limit: Option<u64>,
) -> Result<Vec<TaskLogLine>, String> {
    let svc = state.lock().await;
    svc.get_task_log(&node, &upid, start, limit).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_stop_task(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    upid: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.stop_task(&node, &upid).await.map_err(|e| e.to_string())
}

// ── Backups ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_list_backup_jobs(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<BackupJobConfig>, String> {
    let svc = state.lock().await;
    svc.list_backup_jobs().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_vzdump(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    params: VzdumpParams,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.vzdump(&node, &params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_restore_backup(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    archive: String,
    storage: Option<String>,
    force: Option<bool>,
    unique: Option<bool>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.restore_backup(&node, vmid, &archive, storage.as_deref(), force.unwrap_or(false), unique.unwrap_or(false))
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_backups(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    storage: String,
    vmid: Option<u64>,
) -> Result<Vec<StorageContent>, String> {
    let svc = state.lock().await;
    svc.list_backups(&node, &storage, vmid).await.map_err(|e| e.to_string())
}

// ── Firewall ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_get_cluster_firewall_options(
    state: State<'_, ProxmoxServiceState>,
) -> Result<FirewallOptions, String> {
    let svc = state.lock().await;
    svc.get_cluster_firewall_options().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_cluster_firewall_rules(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<FirewallRule>, String> {
    let svc = state.lock().await;
    svc.list_cluster_firewall_rules().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_security_groups(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<FirewallSecurityGroup>, String> {
    let svc = state.lock().await;
    svc.list_security_groups().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_firewall_aliases(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<FirewallAlias>, String> {
    let svc = state.lock().await;
    svc.list_firewall_aliases().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_firewall_ipsets(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<FirewallIpSet>, String> {
    let svc = state.lock().await;
    svc.list_firewall_ipsets().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_guest_firewall_rules(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    guest_type: String,
    vmid: u64,
) -> Result<Vec<FirewallRule>, String> {
    let svc = state.lock().await;
    svc.list_guest_firewall_rules(&node, &guest_type, vmid).await.map_err(|e| e.to_string())
}

// ── Pools ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_list_pools(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<PoolSummary>, String> {
    let svc = state.lock().await;
    svc.list_pools().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_get_pool(
    state: State<'_, ProxmoxServiceState>,
    poolid: String,
) -> Result<PoolInfo, String> {
    let svc = state.lock().await;
    svc.get_pool(&poolid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_create_pool(
    state: State<'_, ProxmoxServiceState>,
    poolid: String,
    comment: Option<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.create_pool(&poolid, comment.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_delete_pool(
    state: State<'_, ProxmoxServiceState>,
    poolid: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.delete_pool(&poolid).await.map_err(|e| e.to_string())
}

// ── HA ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_list_ha_resources(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<HaResource>, String> {
    let svc = state.lock().await;
    svc.list_ha_resources().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_ha_groups(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<HaGroup>, String> {
    let svc = state.lock().await;
    svc.list_ha_groups().await.map_err(|e| e.to_string())
}

// ── Ceph ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_get_ceph_status(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<CephStatus, String> {
    let svc = state.lock().await;
    svc.get_ceph_status(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_ceph_pools(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<Vec<CephPool>, String> {
    let svc = state.lock().await;
    svc.list_ceph_pools(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_ceph_monitors(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<Vec<CephMonitor>, String> {
    let svc = state.lock().await;
    svc.list_ceph_monitors(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_ceph_osds(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.list_ceph_osds(&node).await.map_err(|e| e.to_string())
}

// ── SDN ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_list_sdn_zones(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<SdnZone>, String> {
    let svc = state.lock().await;
    svc.list_sdn_zones().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_sdn_vnets(
    state: State<'_, ProxmoxServiceState>,
) -> Result<Vec<SdnVnet>, String> {
    let svc = state.lock().await;
    svc.list_sdn_vnets().await.map_err(|e| e.to_string())
}

// ── Console ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_qemu_vnc_proxy(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<VncTicket, String> {
    let svc = state.lock().await;
    svc.qemu_vnc_proxy(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_qemu_spice_proxy(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<SpiceTicket, String> {
    let svc = state.lock().await;
    svc.qemu_spice_proxy(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_qemu_termproxy(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<TermProxyTicket, String> {
    let svc = state.lock().await;
    svc.qemu_termproxy(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_lxc_vnc_proxy(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<VncTicket, String> {
    let svc = state.lock().await;
    svc.lxc_vnc_proxy(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_lxc_spice_proxy(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<SpiceTicket, String> {
    let svc = state.lock().await;
    svc.lxc_spice_proxy(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_lxc_termproxy(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<TermProxyTicket, String> {
    let svc = state.lock().await;
    svc.lxc_termproxy(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_node_termproxy(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<TermProxyTicket, String> {
    let svc = state.lock().await;
    svc.node_termproxy(&node).await.map_err(|e| e.to_string())
}

// ── Snapshots ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_list_qemu_snapshots(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<Vec<SnapshotSummary>, String> {
    let svc = state.lock().await;
    svc.list_qemu_snapshots(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_create_qemu_snapshot(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    params: CreateSnapshotParams,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.create_qemu_snapshot(&node, vmid, &params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_rollback_qemu_snapshot(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    snapname: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.rollback_qemu_snapshot(&node, vmid, &snapname).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_delete_qemu_snapshot(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    snapname: String,
    force: Option<bool>,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.delete_qemu_snapshot(&node, vmid, &snapname, force.unwrap_or(false))
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_lxc_snapshots(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
) -> Result<Vec<SnapshotSummary>, String> {
    let svc = state.lock().await;
    svc.list_lxc_snapshots(&node, vmid).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_create_lxc_snapshot(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    params: CreateSnapshotParams,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.create_lxc_snapshot(&node, vmid, &params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_rollback_lxc_snapshot(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    snapname: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.rollback_lxc_snapshot(&node, vmid, &snapname).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_delete_lxc_snapshot(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    snapname: String,
    force: Option<bool>,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.delete_lxc_snapshot(&node, vmid, &snapname, force.unwrap_or(false))
        .await.map_err(|e| e.to_string())
}

// ── Metrics / RRD ───────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_node_rrd(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    timeframe: String,
    cf: Option<String>,
) -> Result<Vec<RrdDataPoint>, String> {
    let svc = state.lock().await;
    svc.node_rrd(&node, &timeframe, cf.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_qemu_rrd(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    timeframe: String,
    cf: Option<String>,
) -> Result<Vec<RrdDataPoint>, String> {
    let svc = state.lock().await;
    svc.qemu_rrd(&node, vmid, &timeframe, cf.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_lxc_rrd(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    vmid: u64,
    timeframe: String,
    cf: Option<String>,
) -> Result<Vec<RrdDataPoint>, String> {
    let svc = state.lock().await;
    svc.lxc_rrd(&node, vmid, &timeframe, cf.as_deref()).await.map_err(|e| e.to_string())
}

// ── Templates ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxmox_list_appliance_templates(
    state: State<'_, ProxmoxServiceState>,
    node: String,
) -> Result<Vec<ApplianceTemplate>, String> {
    let svc = state.lock().await;
    svc.list_appliance_templates(&node).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_download_appliance(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    storage: String,
    template: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.download_appliance(&node, &storage, &template).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_isos(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    storage: String,
) -> Result<Vec<StorageContent>, String> {
    let svc = state.lock().await;
    svc.list_isos(&node, &storage).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxmox_list_container_templates(
    state: State<'_, ProxmoxServiceState>,
    node: String,
    storage: String,
) -> Result<Vec<StorageContent>, String> {
    let svc = state.lock().await;
    svc.list_container_templates(&node, &storage).await.map_err(|e| e.to_string())
}
