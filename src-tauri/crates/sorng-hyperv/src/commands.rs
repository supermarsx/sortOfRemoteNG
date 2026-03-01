//! Tauri command handlers for the Hyper-V management crate.
//!
//! Each command acquires the `HyperVServiceState` lock and delegates to
//! the service. Commands are prefixed with `hyperv_`.

use crate::service::HyperVServiceState;
use crate::types::*;
use tauri::State;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Config / Module
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn hyperv_check_module(
    state: State<'_, HyperVServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.check_module().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_get_config(
    state: State<'_, HyperVServiceState>,
) -> Result<HyperVConfig, String> {
    let svc = state.lock().await;
    Ok(svc.config().clone())
}

#[tauri::command]
pub async fn hyperv_set_config(
    state: State<'_, HyperVServiceState>,
    config: HyperVConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_config(config);
    Ok(())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  VM Lifecycle
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn hyperv_list_vms(
    state: State<'_, HyperVServiceState>,
) -> Result<Vec<VmInfo>, String> {
    let svc = state.lock().await;
    svc.list_vms().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_list_vms_summary(
    state: State<'_, HyperVServiceState>,
) -> Result<Vec<VmSummary>, String> {
    let svc = state.lock().await;
    svc.list_vms_summary().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_get_vm(
    state: State<'_, HyperVServiceState>,
    name: String,
) -> Result<VmInfo, String> {
    let svc = state.lock().await;
    svc.get_vm(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_get_vm_by_id(
    state: State<'_, HyperVServiceState>,
    id: String,
) -> Result<VmInfo, String> {
    let svc = state.lock().await;
    svc.get_vm_by_id(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_create_vm(
    state: State<'_, HyperVServiceState>,
    config: VmCreateConfig,
) -> Result<VmInfo, String> {
    let svc = state.lock().await;
    svc.create_vm(&config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_start_vm(
    state: State<'_, HyperVServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.start_vm(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_stop_vm(
    state: State<'_, HyperVServiceState>,
    name: String,
    #[allow(unused_variables)] force: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.stop_vm(&name, force.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_restart_vm(
    state: State<'_, HyperVServiceState>,
    name: String,
    force: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.restart_vm(&name, force.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_pause_vm(
    state: State<'_, HyperVServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.pause_vm(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_resume_vm(
    state: State<'_, HyperVServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.resume_vm(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_save_vm(
    state: State<'_, HyperVServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.save_vm(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_remove_vm(
    state: State<'_, HyperVServiceState>,
    name: String,
    delete_files: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_vm(&name, delete_files.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_update_vm(
    state: State<'_, HyperVServiceState>,
    name: String,
    config: VmUpdateConfig,
) -> Result<VmInfo, String> {
    let svc = state.lock().await;
    svc.update_vm(&name, &config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_rename_vm(
    state: State<'_, HyperVServiceState>,
    name: String,
    new_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.rename_vm(&name, &new_name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_export_vm(
    state: State<'_, HyperVServiceState>,
    name: String,
    config: VmExportConfig,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.export_vm(&name, &config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_import_vm(
    state: State<'_, HyperVServiceState>,
    config: VmImportConfig,
) -> Result<VmInfo, String> {
    let svc = state.lock().await;
    svc.import_vm(&config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_live_migrate(
    state: State<'_, HyperVServiceState>,
    name: String,
    config: LiveMigrationConfig,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.live_migrate(&name, &config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_get_integration_services(
    state: State<'_, HyperVServiceState>,
    name: String,
) -> Result<Vec<IntegrationServiceInfo>, String> {
    let svc = state.lock().await;
    svc.get_integration_services(&name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_set_integration_service(
    state: State<'_, HyperVServiceState>,
    name: String,
    service_name: String,
    enabled: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_integration_service(&name, &service_name, enabled)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_add_dvd_drive(
    state: State<'_, HyperVServiceState>,
    name: String,
    iso_path: Option<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.add_dvd_drive(&name, iso_path.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_set_dvd_drive(
    state: State<'_, HyperVServiceState>,
    name: String,
    controller_number: u32,
    controller_location: u32,
    iso_path: Option<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_dvd_drive(&name, controller_number, controller_location, iso_path.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_remove_dvd_drive(
    state: State<'_, HyperVServiceState>,
    name: String,
    controller_number: u32,
    controller_location: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_dvd_drive(&name, controller_number, controller_location)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_add_hard_drive(
    state: State<'_, HyperVServiceState>,
    name: String,
    vhd_path: String,
    controller_type: String,
    controller_number: u32,
    controller_location: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.add_hard_drive(&name, &vhd_path, &controller_type, controller_number, controller_location)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_remove_hard_drive(
    state: State<'_, HyperVServiceState>,
    name: String,
    controller_type: String,
    controller_number: u32,
    controller_location: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_hard_drive(&name, &controller_type, controller_number, controller_location)
        .await
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Snapshots / Checkpoints
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn hyperv_list_checkpoints(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<Vec<CheckpointInfo>, String> {
    let svc = state.lock().await;
    svc.list_checkpoints(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_get_checkpoint(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    checkpoint_name: String,
) -> Result<CheckpointInfo, String> {
    let svc = state.lock().await;
    svc.get_checkpoint(&vm_name, &checkpoint_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_create_checkpoint(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    config: CreateCheckpointConfig,
) -> Result<CheckpointInfo, String> {
    let svc = state.lock().await;
    svc.create_checkpoint(&vm_name, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_restore_checkpoint(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    checkpoint_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.restore_checkpoint(&vm_name, &checkpoint_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_restore_checkpoint_by_id(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    checkpoint_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.restore_checkpoint_by_id(&vm_name, &checkpoint_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_remove_checkpoint(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    checkpoint_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_checkpoint(&vm_name, &checkpoint_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_remove_checkpoint_tree(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    checkpoint_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_checkpoint_tree(&vm_name, &checkpoint_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_remove_all_checkpoints(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<u32, String> {
    let svc = state.lock().await;
    svc.remove_all_checkpoints(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_rename_checkpoint(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.rename_checkpoint(&vm_name, &old_name, &new_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_export_checkpoint(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    checkpoint_name: String,
    destination_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.export_checkpoint(&vm_name, &checkpoint_name, &destination_path)
        .await
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Networking
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn hyperv_list_switches(
    state: State<'_, HyperVServiceState>,
) -> Result<Vec<VirtualSwitchInfo>, String> {
    let svc = state.lock().await;
    svc.list_switches().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_get_switch(
    state: State<'_, HyperVServiceState>,
    name: String,
) -> Result<VirtualSwitchInfo, String> {
    let svc = state.lock().await;
    svc.get_switch(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_create_switch(
    state: State<'_, HyperVServiceState>,
    config: CreateSwitchConfig,
) -> Result<VirtualSwitchInfo, String> {
    let svc = state.lock().await;
    svc.create_switch(&config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_remove_switch(
    state: State<'_, HyperVServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_switch(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_rename_switch(
    state: State<'_, HyperVServiceState>,
    name: String,
    new_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.rename_switch(&name, &new_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_list_physical_adapters(
    state: State<'_, HyperVServiceState>,
) -> Result<Vec<PhysicalAdapterInfo>, String> {
    let svc = state.lock().await;
    svc.list_physical_adapters()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_list_vm_adapters(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<Vec<VmNetworkAdapterInfo>, String> {
    let svc = state.lock().await;
    svc.list_vm_adapters(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_add_vm_adapter(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    config: AddNetworkAdapterConfig,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.add_vm_adapter(&vm_name, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_remove_vm_adapter(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    adapter_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_vm_adapter(&vm_name, &adapter_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_connect_adapter(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    adapter_name: String,
    switch_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.connect_adapter(&vm_name, &adapter_name, &switch_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_disconnect_adapter(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    adapter_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.disconnect_adapter(&vm_name, &adapter_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_set_adapter_vlan(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    adapter_name: String,
    vlan_id: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_adapter_vlan(&vm_name, &adapter_name, vlan_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_set_adapter_vlan_trunk(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    adapter_name: String,
    native_vlan_id: u32,
    allowed_vlan_list: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_adapter_vlan_trunk(&vm_name, &adapter_name, native_vlan_id, &allowed_vlan_list)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_remove_adapter_vlan(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    adapter_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_adapter_vlan(&vm_name, &adapter_name)
        .await
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Storage (VHD/VHDX)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn hyperv_get_vhd(
    state: State<'_, HyperVServiceState>,
    path: String,
) -> Result<VhdInfo, String> {
    let svc = state.lock().await;
    svc.get_vhd(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_test_vhd(
    state: State<'_, HyperVServiceState>,
    path: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.test_vhd(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_create_vhd(
    state: State<'_, HyperVServiceState>,
    config: VhdCreateConfig,
) -> Result<VhdInfo, String> {
    let svc = state.lock().await;
    svc.create_vhd(&config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_resize_vhd(
    state: State<'_, HyperVServiceState>,
    config: VhdResizeConfig,
) -> Result<VhdInfo, String> {
    let svc = state.lock().await;
    svc.resize_vhd(&config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_convert_vhd(
    state: State<'_, HyperVServiceState>,
    config: VhdConvertConfig,
) -> Result<VhdInfo, String> {
    let svc = state.lock().await;
    svc.convert_vhd(&config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_compact_vhd(
    state: State<'_, HyperVServiceState>,
    path: String,
) -> Result<VhdInfo, String> {
    let svc = state.lock().await;
    svc.compact_vhd(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_optimize_vhd(
    state: State<'_, HyperVServiceState>,
    path: String,
) -> Result<VhdInfo, String> {
    let svc = state.lock().await;
    svc.optimize_vhd(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_merge_vhd(
    state: State<'_, HyperVServiceState>,
    path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.merge_vhd(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_mount_vhd(
    state: State<'_, HyperVServiceState>,
    path: String,
    read_only: Option<bool>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.mount_vhd(&path, read_only.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_dismount_vhd(
    state: State<'_, HyperVServiceState>,
    path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.dismount_vhd(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_delete_vhd(
    state: State<'_, HyperVServiceState>,
    path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_vhd(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_list_vm_hard_drives(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<Vec<VmHardDriveInfo>, String> {
    let svc = state.lock().await;
    svc.list_vm_hard_drives(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Metrics / Monitoring
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn hyperv_get_vm_metrics(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<VmMetrics, String> {
    let svc = state.lock().await;
    svc.get_vm_metrics(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_get_all_vm_metrics(
    state: State<'_, HyperVServiceState>,
) -> Result<Vec<VmMetrics>, String> {
    let svc = state.lock().await;
    svc.get_all_vm_metrics().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_enable_metering(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.enable_metering(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_disable_metering(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.disable_metering(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_reset_metering(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.reset_metering(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_get_metering_report(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.get_metering_report(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_get_host_info(
    state: State<'_, HyperVServiceState>,
) -> Result<HostInfo, String> {
    let svc = state.lock().await;
    svc.get_host_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_get_events(
    state: State<'_, HyperVServiceState>,
    max_events: Option<u32>,
    log_name: Option<String>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.get_hyperv_events(max_events.unwrap_or(50), log_name.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_set_host_paths(
    state: State<'_, HyperVServiceState>,
    vm_path: Option<String>,
    vhd_path: Option<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_host_paths(vm_path.as_deref(), vhd_path.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_set_live_migration(
    state: State<'_, HyperVServiceState>,
    enabled: bool,
    max_migrations: Option<u32>,
    max_storage_migrations: Option<u32>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_live_migration(enabled, max_migrations, max_storage_migrations)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_set_numa_spanning(
    state: State<'_, HyperVServiceState>,
    enabled: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_numa_spanning(enabled)
        .await
        .map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Replication
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn hyperv_get_replication(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<VmReplicationInfo, String> {
    let svc = state.lock().await;
    svc.get_replication(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_list_replicated_vms(
    state: State<'_, HyperVServiceState>,
) -> Result<Vec<VmReplicationInfo>, String> {
    let svc = state.lock().await;
    svc.list_replicated_vms().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_enable_replication(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    config: EnableReplicationConfig,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.enable_replication(&vm_name, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_disable_replication(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.disable_replication(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_start_initial_replication(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.start_initial_replication(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_suspend_replication(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.suspend_replication(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_resume_replication(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.resume_replication(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_planned_failover(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.planned_failover(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_unplanned_failover(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.unplanned_failover(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_complete_failover(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.complete_failover(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_cancel_failover(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.cancel_failover(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_reverse_replication(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.reverse_replication(&vm_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_start_test_failover(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
    switch_name: Option<String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.start_test_failover(&vm_name, switch_name.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hyperv_stop_test_failover(
    state: State<'_, HyperVServiceState>,
    vm_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.stop_test_failover(&vm_name)
        .await
        .map_err(|e| e.to_string())
}
