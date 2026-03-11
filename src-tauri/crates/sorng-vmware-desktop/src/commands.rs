// Tauri command handlers for all VMware Desktop operations.
//
// Every command is `async`, takes `State<'_, VmwDesktopServiceState>` and
// returns `Result<T, String>`. All prefixed with `vmwd_`.

use super::service::VmwDesktopServiceState;
use super::types::*;
use tauri::State;

// ── Connection ──────────────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn vmwd_connect(
    state: State<'_, VmwDesktopServiceState>,
    vmrun_path: Option<String>,
    vmrest_host: Option<String>,
    vmrest_port: Option<u16>,
    vmrest_username: Option<String>,
    vmrest_password: Option<String>,
    auto_start_vmrest: Option<bool>,
    timeout_secs: Option<u64>,
) -> Result<VmwConnectionSummary, String> {
    let config = VmwDesktopConfig {
        vmrun_path,
        vmrest_host,
        vmrest_port,
        vmrest_username,
        vmrest_password,
        auto_start_vmrest: auto_start_vmrest.unwrap_or(false),
        timeout_secs: timeout_secs.unwrap_or(60),
    };
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_disconnect(state: State<'_, VmwDesktopServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_is_connected(state: State<'_, VmwDesktopServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected())
}

#[tauri::command]
pub async fn vmwd_connection_summary(
    state: State<'_, VmwDesktopServiceState>,
) -> Result<VmwConnectionSummary, String> {
    let svc = state.lock().await;
    Ok(svc.connection_summary())
}

#[tauri::command]
pub async fn vmwd_host_info(
    state: State<'_, VmwDesktopServiceState>,
) -> Result<VmwHostInfo, String> {
    let svc = state.lock().await;
    svc.host_info().map_err(|e| e.to_string())
}

// ── VM Lifecycle ────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmwd_list_vms(
    state: State<'_, VmwDesktopServiceState>,
) -> Result<Vec<VmSummary>, String> {
    let svc = state.lock().await;
    svc.list_vms().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_get_vm(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<VmDetail, String> {
    let svc = state.lock().await;
    svc.get_vm(&vmx_path).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn vmwd_create_vm(
    state: State<'_, VmwDesktopServiceState>,
    name: String,
    guest_os: String,
    num_cpus: Option<u32>,
    memory_mb: Option<u64>,
    disk_size_mb: Option<u64>,
    disk_type: Option<String>,
    iso_path: Option<String>,
    network_type: Option<String>,
    firmware: Option<String>,
    target_dir: Option<String>,
) -> Result<VmDetail, String> {
    let req = CreateVmRequest {
        name,
        guest_os,
        num_cpus,
        cores_per_socket: None,
        memory_mb,
        disk_size_mb,
        disk_type,
        iso_path,
        network_type,
        firmware,
        hardware_version: None,
        target_dir,
        auto_install: None,
        annotation: None,
    };
    let svc = state.lock().await;
    svc.create_vm(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn vmwd_update_vm(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    name: Option<String>,
    num_cpus: Option<u32>,
    cores_per_socket: Option<u32>,
    memory_mb: Option<u64>,
    annotation: Option<String>,
    firmware: Option<String>,
    nested_virt: Option<bool>,
    side_channel_mitigations: Option<bool>,
    uefi_secure_boot: Option<bool>,
    vtpm: Option<bool>,
) -> Result<(), String> {
    let req = UpdateVmRequest {
        vmx_path,
        name,
        num_cpus,
        cores_per_socket,
        memory_mb,
        annotation,
        firmware,
        nested_virt,
        side_channel_mitigations,
        uefi_secure_boot,
        vtpm,
    };
    let svc = state.lock().await;
    svc.update_vm(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_delete_vm(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_vm(&vmx_path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_clone_vm(
    state: State<'_, VmwDesktopServiceState>,
    source_vmx: String,
    dest_name: String,
    clone_type: String,
    snapshot_name: Option<String>,
    dest_dir: Option<String>,
) -> Result<VmDetail, String> {
    let req = CloneVmRequest {
        source_vmx,
        dest_name,
        clone_type,
        snapshot_name,
        dest_dir,
    };
    let svc = state.lock().await;
    svc.clone_vm(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_register_vm(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.register_vm(&vmx_path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_unregister_vm(
    state: State<'_, VmwDesktopServiceState>,
    id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.unregister_vm(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn vmwd_configure_nic(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    nic_index: u32,
    network_type: Option<String>,
    adapter_type: Option<String>,
    mac_address: Option<String>,
    vnet: Option<String>,
    connected: Option<bool>,
    start_connected: Option<bool>,
) -> Result<(), String> {
    let req = ConfigureNicRequest {
        vmx_path,
        nic_index,
        network_type,
        adapter_type,
        mac_address,
        vnet,
        connected,
        start_connected,
    };
    let svc = state.lock().await;
    svc.configure_nic(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_remove_nic(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    nic_index: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_nic(&vmx_path, nic_index)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_configure_cdrom(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    cdrom_index: u32,
    device_type: String,
    file_name: Option<String>,
    connected: Option<bool>,
) -> Result<(), String> {
    let req = ConfigureCdromRequest {
        vmx_path,
        cdrom_index,
        device_type,
        file_name,
        connected,
    };
    let svc = state.lock().await;
    svc.configure_cdrom(req).await.map_err(|e| e.to_string())
}

// ── Power ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmwd_start_vm(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    gui: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.start_vm(&vmx_path, gui.unwrap_or(true))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_stop_vm(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    hard: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.stop_vm(&vmx_path, hard.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_reset_vm(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    hard: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.reset_vm(&vmx_path, hard.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_suspend_vm(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    hard: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.suspend_vm(&vmx_path, hard.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_pause_vm(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.pause_vm(&vmx_path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_unpause_vm(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.unpause_vm(&vmx_path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_get_power_state(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<VmPowerState, String> {
    let svc = state.lock().await;
    svc.get_power_state(&vmx_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_batch_power(
    state: State<'_, VmwDesktopServiceState>,
    vmx_paths: Vec<String>,
    action: PowerAction,
) -> Result<BatchPowerResult, String> {
    let svc = state.lock().await;
    svc.batch_power(&vmx_paths, action)
        .await
        .map_err(|e| e.to_string())
}

// ── Snapshots ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmwd_list_snapshots(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<Vec<SnapshotInfo>, String> {
    let svc = state.lock().await;
    svc.list_snapshots(&vmx_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_get_snapshot_tree(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<SnapshotTree, String> {
    let svc = state.lock().await;
    svc.get_snapshot_tree(&vmx_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_create_snapshot(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    name: String,
    description: Option<String>,
    capture_memory: Option<bool>,
    quiesce_filesystem: Option<bool>,
) -> Result<(), String> {
    let req = CreateSnapshotRequest {
        vmx_path: vmx_path.clone(),
        name,
        description,
        capture_memory: capture_memory.unwrap_or(true),
        quiesce_filesystem: quiesce_filesystem.unwrap_or(false),
    };
    let svc = state.lock().await;
    svc.create_snapshot(&vmx_path, req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_delete_snapshot(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    name: String,
    delete_children: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_snapshot(&vmx_path, &name, delete_children.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_revert_to_snapshot(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.revert_to_snapshot(&vmx_path, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_get_snapshot(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    name: String,
) -> Result<SnapshotInfo, String> {
    let svc = state.lock().await;
    svc.get_snapshot(&vmx_path, &name)
        .await
        .map_err(|e| e.to_string())
}

// ── Guest Operations ────────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn vmwd_exec_in_guest(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    program: String,
    arguments: Vec<String>,
    wait: Option<bool>,
    interactive: Option<bool>,
) -> Result<GuestExecResult, String> {
    let req = GuestExecRequest {
        vmx_path: vmx_path.clone(),
        guest_user: guest_user.clone(),
        guest_password: guest_pass.clone(),
        program,
        arguments: if arguments.is_empty() {
            None
        } else {
            Some(arguments.join(" "))
        },
        no_wait: !wait.unwrap_or(true),
        interactive: interactive.unwrap_or(false),
    };
    let svc = state.lock().await;
    svc.exec_in_guest(&vmx_path, &guest_user, &guest_pass, req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_run_script_in_guest(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    interpreter: String,
    script_text: String,
) -> Result<GuestExecResult, String> {
    let req = GuestScriptRequest {
        vmx_path: vmx_path.clone(),
        guest_user: guest_user.clone(),
        guest_password: guest_pass.clone(),
        interpreter,
        script_text,
        no_wait: false,
    };
    let svc = state.lock().await;
    svc.run_script_in_guest(&vmx_path, &guest_user, &guest_pass, req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_copy_to_guest(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    host_path: String,
    guest_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.copy_to_guest(&vmx_path, &guest_user, &guest_pass, &host_path, &guest_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_copy_from_guest(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    guest_path: String,
    host_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.copy_from_guest(&vmx_path, &guest_user, &guest_pass, &guest_path, &host_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_create_directory_in_guest(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    dir_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.create_directory_in_guest(&vmx_path, &guest_user, &guest_pass, &dir_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_delete_directory_in_guest(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    dir_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_directory_in_guest(&vmx_path, &guest_user, &guest_pass, &dir_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_delete_file_in_guest(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    file_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_file_in_guest(&vmx_path, &guest_user, &guest_pass, &file_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_file_exists_in_guest(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    file_path: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.file_exists_in_guest(&vmx_path, &guest_user, &guest_pass, &file_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_directory_exists_in_guest(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    dir_path: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.directory_exists_in_guest(&vmx_path, &guest_user, &guest_pass, &dir_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_rename_file_in_guest(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.rename_file_in_guest(&vmx_path, &guest_user, &guest_pass, &old_path, &new_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_list_directory_in_guest(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    dir_path: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.list_directory_in_guest(&vmx_path, &guest_user, &guest_pass, &dir_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_list_processes_in_guest(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
) -> Result<Vec<GuestProcess>, String> {
    let svc = state.lock().await;
    svc.list_processes_in_guest(&vmx_path, &guest_user, &guest_pass)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_kill_process_in_guest(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    pid: u64,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.kill_process_in_guest(&vmx_path, &guest_user, &guest_pass, pid)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_read_variable(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    var_type: String,
    name: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.read_variable(&vmx_path, &guest_user, &guest_pass, &var_type, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_write_variable(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
    var_type: String,
    name: String,
    value: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.write_variable(
        &vmx_path,
        &guest_user,
        &guest_pass,
        &var_type,
        &name,
        &value,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_list_env_vars(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    guest_user: String,
    guest_pass: String,
) -> Result<Vec<GuestEnvVar>, String> {
    let svc = state.lock().await;
    svc.list_env_vars(&vmx_path, &guest_user, &guest_pass)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_get_tools_status(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<ToolsStatus, String> {
    let svc = state.lock().await;
    svc.get_tools_status(&vmx_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_install_tools(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.install_tools(&vmx_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_get_ip_address(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_ip_address(&vmx_path)
        .await
        .map_err(|e| e.to_string())
}

// ── Shared Folders ──────────────────────────────────────────────────

#[tauri::command]
pub async fn vmwd_enable_shared_folders(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.enable_shared_folders(&vmx_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_disable_shared_folders(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.disable_shared_folders(&vmx_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_list_shared_folders(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<Vec<SharedFolder>, String> {
    let svc = state.lock().await;
    svc.list_shared_folders(&vmx_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_add_shared_folder(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    name: String,
    host_path: String,
    writable: Option<bool>,
) -> Result<(), String> {
    let req = SharedFolderRequest {
        vmx_path: vmx_path.clone(),
        name,
        host_path,
        writable,
        enabled: Some(true),
    };
    let svc = state.lock().await;
    svc.add_shared_folder(&vmx_path, req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_remove_shared_folder(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_shared_folder(&vmx_path, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_set_shared_folder_state(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    name: String,
    host_path: String,
    writable: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_shared_folder_state(&vmx_path, &name, &host_path, writable)
        .await
        .map_err(|e| e.to_string())
}

// ── Networking ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmwd_list_networks(
    state: State<'_, VmwDesktopServiceState>,
) -> Result<Vec<VirtualNetwork>, String> {
    let svc = state.lock().await;
    svc.list_networks().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_get_network(
    state: State<'_, VmwDesktopServiceState>,
    name: String,
) -> Result<VirtualNetwork, String> {
    let svc = state.lock().await;
    svc.get_network(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_create_network(
    state: State<'_, VmwDesktopServiceState>,
    name: String,
    network_type: String,
    subnet: Option<String>,
    mask: Option<String>,
) -> Result<VirtualNetwork, String> {
    let req = CreateNetworkRequest {
        name,
        network_type,
        subnet,
        subnet_mask: mask,
        dhcp_enabled: None,
        nat_enabled: None,
    };
    let svc = state.lock().await;
    svc.create_network(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_update_network(
    state: State<'_, VmwDesktopServiceState>,
    name: String,
    network_type: String,
    subnet: Option<String>,
    mask: Option<String>,
) -> Result<VirtualNetwork, String> {
    let svc = state.lock().await;
    svc.update_network(&name, &network_type, subnet.as_deref(), mask.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_delete_network(
    state: State<'_, VmwDesktopServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_network(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_list_port_forwards(
    state: State<'_, VmwDesktopServiceState>,
    network: String,
) -> Result<Vec<NatPortForward>, String> {
    let svc = state.lock().await;
    svc.list_port_forwards(&network)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_set_port_forward(
    state: State<'_, VmwDesktopServiceState>,
    network: String,
    protocol: String,
    host_port: u16,
    guest_ip: String,
    guest_port: u16,
    description: Option<String>,
) -> Result<(), String> {
    let req = AddPortForwardRequest {
        network: network.clone(),
        protocol,
        host_port,
        guest_ip,
        guest_port,
        description,
    };
    let svc = state.lock().await;
    svc.set_port_forward(&network, req)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_delete_port_forward(
    state: State<'_, VmwDesktopServiceState>,
    network: String,
    protocol: String,
    host_port: u16,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_port_forward(&network, &protocol, host_port)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_get_dhcp_leases(
    state: State<'_, VmwDesktopServiceState>,
    network: String,
) -> Result<Vec<DhcpLease>, String> {
    let svc = state.lock().await;
    svc.get_dhcp_leases(&network)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_read_networking_config(
    state: State<'_, VmwDesktopServiceState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let svc = state.lock().await;
    svc.read_networking_config().map_err(|e| e.to_string())
}

// ── VMDK ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmwd_create_vmdk(
    state: State<'_, VmwDesktopServiceState>,
    path: String,
    size_mb: u64,
    disk_type: Option<String>,
    adapter_type: Option<String>,
) -> Result<VmdkInfo, String> {
    let req = CreateVmdkRequest {
        path,
        size_mb,
        disk_type,
        adapter_type,
    };
    let svc = state.lock().await;
    svc.create_vmdk(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_get_vmdk_info(
    state: State<'_, VmwDesktopServiceState>,
    path: String,
) -> Result<VmdkInfo, String> {
    let svc = state.lock().await;
    svc.get_vmdk_info(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_defragment_vmdk(
    state: State<'_, VmwDesktopServiceState>,
    path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.defragment_vmdk(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_shrink_vmdk(
    state: State<'_, VmwDesktopServiceState>,
    path: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.shrink_vmdk(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_expand_vmdk(
    state: State<'_, VmwDesktopServiceState>,
    path: String,
    new_size_mb: u64,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.expand_vmdk(&path, new_size_mb)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_convert_vmdk(
    state: State<'_, VmwDesktopServiceState>,
    source: String,
    disk_type: String,
    dest: Option<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.convert_vmdk(&source, &disk_type, dest.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_rename_vmdk(
    state: State<'_, VmwDesktopServiceState>,
    source: String,
    dest: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.rename_vmdk(&source, &dest)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_add_disk_to_vm(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    vmdk_path: String,
    controller_type: Option<String>,
    _bus_number: Option<u32>,
    _unit_number: Option<u32>,
    mode: Option<String>,
) -> Result<(), String> {
    let req = AddDiskRequest {
        vmx_path,
        size_mb: 0,
        disk_type: mode,
        controller_type,
        file_name: Some(vmdk_path),
    };
    let svc = state.lock().await;
    svc.add_disk_to_vm(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_remove_disk_from_vm(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    controller_type: String,
    bus: u32,
    unit: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_disk_from_vm(&vmx_path, &controller_type, bus, unit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_list_vm_disks(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<Vec<VmDisk>, String> {
    let svc = state.lock().await;
    svc.list_vm_disks(&vmx_path).map_err(|e| e.to_string())
}

// ── OVF ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmwd_import_ovf(
    state: State<'_, VmwDesktopServiceState>,
    source_path: String,
    dest_dir: String,
    name: Option<String>,
) -> Result<String, String> {
    let req = OvfImportRequest {
        source_path,
        target_dir: Some(dest_dir),
        name,
        accept_eula: false,
    };
    let svc = state.lock().await;
    svc.import_ovf(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_export_ovf(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    dest_path: String,
    format: Option<String>,
) -> Result<(), String> {
    let req = OvfExportRequest {
        vmx_path,
        target_path: dest_path,
        format,
        include_isos: false,
    };
    let svc = state.lock().await;
    svc.export_ovf(req).await.map_err(|e| e.to_string())
}

// ── VMX ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmwd_parse_vmx(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
) -> Result<VmxFile, String> {
    let svc = state.lock().await;
    svc.parse_vmx(&vmx_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_update_vmx_keys(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    updates: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.update_vmx_keys(&vmx_path, &updates)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_remove_vmx_keys(
    state: State<'_, VmwDesktopServiceState>,
    vmx_path: String,
    keys: Vec<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_vmx_keys(&vmx_path, &keys)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_discover_vmx_files(
    state: State<'_, VmwDesktopServiceState>,
    dir: String,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    svc.discover_vmx_files(&dir).map_err(|e| e.to_string())
}

// ── Preferences ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn vmwd_read_preferences(
    state: State<'_, VmwDesktopServiceState>,
) -> Result<VmwPreferences, String> {
    let svc = state.lock().await;
    svc.read_preferences().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vmwd_get_default_vm_dir(
    state: State<'_, VmwDesktopServiceState>,
) -> Result<String, String> {
    let svc = state.lock().await;
    Ok(svc.get_default_vm_dir())
}

#[tauri::command]
pub async fn vmwd_set_preference(
    state: State<'_, VmwDesktopServiceState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_preference(&key, &value).map_err(|e| e.to_string())
}
