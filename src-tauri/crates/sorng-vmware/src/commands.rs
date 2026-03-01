//! Tauri command handlers for all VMware operations.
//!
//! Every command is `async`, takes `State<'_, VmwareServiceState>` and
//! returns `Result<T, String>` (Tauri requires `String` errors).

use crate::metrics::InventorySummary;
use crate::service::{VmwareServiceState, VsphereConfigSafe};
use crate::types::*;
use tauri::State;

// ── Connection ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmware_connect(
    state: State<'_, VmwareServiceState>,
    host: String,
    port: Option<u16>,
    username: String,
    password: String,
    insecure: Option<bool>,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    let config = VsphereConfig {
        host,
        port: port.unwrap_or(443),
        username,
        password,
        insecure: insecure.unwrap_or(true),
        timeout_secs: timeout_secs.unwrap_or(30),
    };
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_disconnect(
    state: State<'_, VmwareServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_check_session(
    state: State<'_, VmwareServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.check_session().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_is_connected(
    state: State<'_, VmwareServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected())
}

#[tauri::command]
pub async fn vmware_get_config(
    state: State<'_, VmwareServiceState>,
) -> Result<Option<VsphereConfigSafe>, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

// ── VM lifecycle ────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmware_list_vms(
    state: State<'_, VmwareServiceState>,
) -> Result<Vec<VmSummary>, String> {
    let svc = state.lock().await;
    svc.list_vms().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_list_running_vms(
    state: State<'_, VmwareServiceState>,
) -> Result<Vec<VmSummary>, String> {
    let svc = state.lock().await;
    svc.list_running_vms().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_get_vm(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
) -> Result<VmInfo, String> {
    let svc = state.lock().await;
    svc.get_vm(&vm_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_create_vm(
    state: State<'_, VmwareServiceState>,
    spec: VmCreateSpec,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.create_vm(&spec).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_delete_vm(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_vm(&vm_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_power_on(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.power_on_vm(&vm_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_power_off(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.power_off_vm(&vm_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_suspend(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.suspend_vm(&vm_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_reset(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.reset_vm(&vm_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_shutdown_guest(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.shutdown_guest(&vm_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_reboot_guest(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.reboot_guest(&vm_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_get_guest_identity(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
) -> Result<GuestIdentity, String> {
    let svc = state.lock().await;
    svc.get_guest_identity(&vm_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_update_cpu(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
    spec: VmCpuUpdate,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.update_vm_cpu(&vm_id, &spec)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_update_memory(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
    spec: VmMemoryUpdate,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.update_vm_memory(&vm_id, &spec)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_clone_vm(
    state: State<'_, VmwareServiceState>,
    spec: VmCloneSpec,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.clone_vm(&spec).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_relocate_vm(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
    spec: VmRelocateSpec,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.relocate_vm(&vm_id, &spec)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_find_vm_by_name(
    state: State<'_, VmwareServiceState>,
    name: String,
) -> Result<Option<VmSummary>, String> {
    let svc = state.lock().await;
    svc.find_vm_by_name(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_get_power_state(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
) -> Result<VmPowerState, String> {
    let svc = state.lock().await;
    svc.get_vm_power_state(&vm_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Snapshots ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmware_list_snapshots(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
) -> Result<Vec<SnapshotSummary>, String> {
    let svc = state.lock().await;
    svc.list_snapshots(&vm_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_create_snapshot(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
    spec: CreateSnapshotSpec,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.create_snapshot(&vm_id, &spec)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_revert_snapshot(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
    snapshot_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.revert_to_snapshot(&vm_id, &snapshot_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_delete_snapshot(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
    snapshot_id: String,
    children: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_snapshot(&vm_id, &snapshot_id, children.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_delete_all_snapshots(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_all_snapshots(&vm_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Network ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmware_list_networks(
    state: State<'_, VmwareServiceState>,
) -> Result<Vec<NetworkSummary>, String> {
    let svc = state.lock().await;
    svc.list_networks().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_get_network(
    state: State<'_, VmwareServiceState>,
    network_id: String,
) -> Result<NetworkInfo, String> {
    let svc = state.lock().await;
    svc.get_network(&network_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Storage ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmware_list_datastores(
    state: State<'_, VmwareServiceState>,
) -> Result<Vec<DatastoreSummary>, String> {
    let svc = state.lock().await;
    svc.list_datastores().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_get_datastore(
    state: State<'_, VmwareServiceState>,
    datastore_id: String,
) -> Result<DatastoreInfo, String> {
    let svc = state.lock().await;
    svc.get_datastore(&datastore_id)
        .await
        .map_err(|e| e.to_string())
}

// ── Hosts ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmware_list_hosts(
    state: State<'_, VmwareServiceState>,
) -> Result<Vec<HostSummary>, String> {
    let svc = state.lock().await;
    svc.list_hosts().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_get_host(
    state: State<'_, VmwareServiceState>,
    host_id: String,
) -> Result<HostInfo, String> {
    let svc = state.lock().await;
    svc.get_host(&host_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_disconnect_host(
    state: State<'_, VmwareServiceState>,
    host_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.disconnect_host(&host_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_reconnect_host(
    state: State<'_, VmwareServiceState>,
    host_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.reconnect_host(&host_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_list_clusters(
    state: State<'_, VmwareServiceState>,
) -> Result<Vec<ClusterSummary>, String> {
    let svc = state.lock().await;
    svc.list_clusters().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_list_datacenters(
    state: State<'_, VmwareServiceState>,
) -> Result<Vec<DatacenterSummary>, String> {
    let svc = state.lock().await;
    svc.list_datacenters().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_list_folders(
    state: State<'_, VmwareServiceState>,
) -> Result<Vec<FolderSummary>, String> {
    let svc = state.lock().await;
    svc.list_folders().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_list_resource_pools(
    state: State<'_, VmwareServiceState>,
) -> Result<Vec<ResourcePoolSummary>, String> {
    let svc = state.lock().await;
    svc.list_resource_pools()
        .await
        .map_err(|e| e.to_string())
}

// ── Metrics ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmware_get_vm_stats(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
) -> Result<VmQuickStats, String> {
    let svc = state.lock().await;
    svc.get_vm_quick_stats(&vm_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_get_all_vm_stats(
    state: State<'_, VmwareServiceState>,
) -> Result<Vec<VmQuickStats>, String> {
    let svc = state.lock().await;
    svc.get_all_vm_stats().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_get_inventory_summary(
    state: State<'_, VmwareServiceState>,
) -> Result<InventorySummary, String> {
    let svc = state.lock().await;
    svc.get_inventory_summary()
        .await
        .map_err(|e| e.to_string())
}

// ── Console (cross-platform, WebSocket) ─────────────────────────

#[tauri::command]
pub async fn vmware_acquire_console_ticket(
    state: State<'_, VmwareServiceState>,
    vm_id: String,
    ticket_type: Option<ConsoleTicketType>,
) -> Result<ConsoleTicket, String> {
    let svc = state.lock().await;
    svc.acquire_console_ticket(&vm_id, ticket_type.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_open_console(
    state: State<'_, VmwareServiceState>,
    req: OpenConsoleRequest,
) -> Result<ConsoleSession, String> {
    let svc = state.lock().await;
    svc.open_console(&req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_close_console(
    state: State<'_, VmwareServiceState>,
    session_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.close_console(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_close_all_consoles(
    state: State<'_, VmwareServiceState>,
) -> Result<u32, String> {
    let svc = state.lock().await;
    Ok(svc.close_all_consoles().await)
}

#[tauri::command]
pub async fn vmware_list_console_sessions(
    state: State<'_, VmwareServiceState>,
) -> Result<Vec<ConsoleSession>, String> {
    let svc = state.lock().await;
    Ok(svc.list_console_sessions().await)
}

#[tauri::command]
pub async fn vmware_get_console_session(
    state: State<'_, VmwareServiceState>,
    session_id: String,
) -> Result<ConsoleSession, String> {
    let svc = state.lock().await;
    svc.get_console_session(&session_id)
        .await
        .map_err(|e| e.to_string())
}

// ── VMRC / Horizon (binary fallback) ────────────────────────────────

#[tauri::command]
pub async fn vmware_launch_vmrc(
    state: State<'_, VmwareServiceState>,
    config: VmrcConnectionConfig,
) -> Result<VmrcSession, String> {
    let svc = state.lock().await;
    svc.launch_vmrc(&config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_list_vmrc_sessions(
    state: State<'_, VmwareServiceState>,
) -> Result<Vec<VmrcSession>, String> {
    let svc = state.lock().await;
    Ok(svc.list_vmrc_sessions().await)
}

#[tauri::command]
pub async fn vmware_close_vmrc_session(
    state: State<'_, VmwareServiceState>,
    session_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.close_vmrc_session(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmware_close_all_vmrc_sessions(
    state: State<'_, VmwareServiceState>,
) -> Result<u32, String> {
    let svc = state.lock().await;
    Ok(svc.close_all_vmrc_sessions().await)
}

#[tauri::command]
pub async fn vmware_is_vmrc_available(
    state: State<'_, VmwareServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_vmrc_available())
}

#[tauri::command]
pub async fn vmware_is_horizon_available(
    state: State<'_, VmwareServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_horizon_available())
}
