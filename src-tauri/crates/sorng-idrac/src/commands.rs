//! Tauri command handlers for all Dell iDRAC operations.
//!
//! Every command is `async`, takes `State<'_, IdracServiceState>` and
//! returns `Result<T, String>` (Tauri requires `String` errors).

use crate::service::IdracServiceState;
use crate::types::*;
use tauri::State;

// ── Connection ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_connect(
    state: State<'_, IdracServiceState>,
    host: String,
    port: Option<u16>,
    username: String,
    password: String,
    auth_method: Option<String>,
    protocol: Option<String>,
    insecure: Option<bool>,
    timeout_secs: Option<u64>,
    ipmi_port: Option<u16>,
) -> Result<String, String> {
    let auth = match auth_method.as_deref() {
        Some("session") => IdracAuthMethod::Session,
        _ => IdracAuthMethod::Basic,
    };
    let proto = match protocol.as_deref() {
        Some("redfish") => Some(IdracProtocol::Redfish),
        Some("wsman") => Some(IdracProtocol::Wsman),
        Some("ipmi") => Some(IdracProtocol::Ipmi),
        _ => None, // auto-detect
    };
    let config = IdracConfig {
        host,
        port: port.unwrap_or(443),
        username,
        password,
        auth_method: auth,
        protocol: proto,
        insecure: insecure.unwrap_or(true),
        timeout_secs: timeout_secs.unwrap_or(30),
        ipmi_port: ipmi_port.unwrap_or(623),
    };
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_disconnect(state: State<'_, IdracServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_check_session(state: State<'_, IdracServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.check_session().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_is_connected(state: State<'_, IdracServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected())
}

#[tauri::command]
pub async fn idrac_get_config(state: State<'_, IdracServiceState>) -> Result<Option<IdracConfigSafe>, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

// ── System ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_get_system_info(state: State<'_, IdracServiceState>) -> Result<SystemInfo, String> {
    let svc = state.lock().await;
    svc.get_system_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_idrac_info(state: State<'_, IdracServiceState>) -> Result<IdracInfo, String> {
    let svc = state.lock().await;
    svc.get_idrac_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_set_asset_tag(state: State<'_, IdracServiceState>, tag: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_asset_tag(&tag).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_set_indicator_led(state: State<'_, IdracServiceState>, led_state: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_indicator_led(&led_state).await.map_err(|e| e.to_string())
}

// ── Power ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_power_action(state: State<'_, IdracServiceState>, action: String) -> Result<(), String> {
    let pa = match action.to_lowercase().as_str() {
        "on" => PowerAction::On,
        "forceoff" | "force_off" => PowerAction::ForceOff,
        "gracefulshutdown" | "graceful_shutdown" => PowerAction::GracefulShutdown,
        "gracefulrestart" | "graceful_restart" => PowerAction::GracefulRestart,
        "forcerestart" | "force_restart" => PowerAction::ForceRestart,
        "nmi" => PowerAction::Nmi,
        "powercycle" | "power_cycle" => PowerAction::PowerCycle,
        "pushpowerbutton" | "push_power_button" => PowerAction::PushPowerButton,
        _ => return Err(format!("Unknown power action: {}", action)),
    };
    let svc = state.lock().await;
    svc.power_action(pa).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_power_state(state: State<'_, IdracServiceState>) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_power_state().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_power_metrics(state: State<'_, IdracServiceState>) -> Result<PowerMetrics, String> {
    let svc = state.lock().await;
    svc.get_power_metrics().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_list_power_supplies(state: State<'_, IdracServiceState>) -> Result<Vec<PowerSupply>, String> {
    let svc = state.lock().await;
    svc.list_power_supplies().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_set_power_cap(state: State<'_, IdracServiceState>, watts: f64) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_power_cap(watts).await.map_err(|e| e.to_string())
}

// ── Thermal ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_get_thermal_data(state: State<'_, IdracServiceState>) -> Result<ThermalData, String> {
    let svc = state.lock().await;
    svc.get_thermal_data().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_thermal_summary(state: State<'_, IdracServiceState>) -> Result<ThermalSummary, String> {
    let svc = state.lock().await;
    svc.get_thermal_summary().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_set_fan_offset(state: State<'_, IdracServiceState>, offset: i32) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_fan_offset(offset).await.map_err(|e| e.to_string())
}

// ── Hardware ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_list_processors(state: State<'_, IdracServiceState>) -> Result<Vec<Processor>, String> {
    let svc = state.lock().await;
    svc.list_processors().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_list_memory(state: State<'_, IdracServiceState>) -> Result<Vec<MemoryDimm>, String> {
    let svc = state.lock().await;
    svc.list_memory().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_list_pcie_devices(state: State<'_, IdracServiceState>) -> Result<Vec<PcieDevice>, String> {
    let svc = state.lock().await;
    svc.list_pcie_devices().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_total_memory(state: State<'_, IdracServiceState>) -> Result<u64, String> {
    let svc = state.lock().await;
    svc.get_total_memory_mb().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_processor_count(state: State<'_, IdracServiceState>) -> Result<u32, String> {
    let svc = state.lock().await;
    svc.get_processor_count().await.map_err(|e| e.to_string())
}

// ── Storage ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_list_storage_controllers(state: State<'_, IdracServiceState>) -> Result<Vec<StorageController>, String> {
    let svc = state.lock().await;
    svc.list_storage_controllers().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_list_virtual_disks(state: State<'_, IdracServiceState>, controller_id: Option<String>) -> Result<Vec<VirtualDisk>, String> {
    let svc = state.lock().await;
    svc.list_virtual_disks(controller_id.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_list_physical_disks(state: State<'_, IdracServiceState>, controller_id: Option<String>) -> Result<Vec<PhysicalDisk>, String> {
    let svc = state.lock().await;
    svc.list_physical_disks(controller_id.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_list_enclosures(state: State<'_, IdracServiceState>) -> Result<Vec<StorageEnclosure>, String> {
    let svc = state.lock().await;
    svc.list_enclosures().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_create_virtual_disk(
    state: State<'_, IdracServiceState>,
    controller_id: String,
    raid_level: String,
    physical_disk_ids: Vec<String>,
    name: Option<String>,
    stripe_size_bytes: Option<u64>,
    capacity_bytes: Option<u64>,
) -> Result<String, String> {
    let params = CreateVirtualDiskParams {
        controller_id,
        raid_level,
        physical_disk_ids,
        name,
        stripe_size_bytes,
        capacity_bytes,
    };
    let svc = state.lock().await;
    svc.create_virtual_disk(params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_delete_virtual_disk(state: State<'_, IdracServiceState>, controller_id: String, volume_id: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_virtual_disk(&controller_id, &volume_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_assign_hotspare(
    state: State<'_, IdracServiceState>,
    controller_id: String,
    disk_id: String,
    hotspare_type: String,
    target_volume_id: Option<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.assign_hotspare(&controller_id, &disk_id, &hotspare_type, target_volume_id.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_initialize_virtual_disk(
    state: State<'_, IdracServiceState>,
    controller_id: String,
    volume_id: String,
    init_type: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.initialize_virtual_disk(&controller_id, &volume_id, &init_type).await.map_err(|e| e.to_string())
}

// ── Network ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_list_network_adapters(state: State<'_, IdracServiceState>) -> Result<Vec<NetworkAdapter>, String> {
    let svc = state.lock().await;
    svc.list_network_adapters().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_list_network_ports(state: State<'_, IdracServiceState>) -> Result<Vec<NetworkPort>, String> {
    let svc = state.lock().await;
    svc.list_network_ports().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_network_config(state: State<'_, IdracServiceState>) -> Result<IdracNetworkConfig, String> {
    let svc = state.lock().await;
    svc.get_idrac_network_config().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_update_network_config(
    state: State<'_, IdracServiceState>,
    ipv4_address: Option<String>,
    ipv4_subnet: Option<String>,
    ipv4_gateway: Option<String>,
    dhcp_enabled: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.update_idrac_network_config(
        ipv4_address.as_deref(),
        ipv4_subnet.as_deref(),
        ipv4_gateway.as_deref(),
        dhcp_enabled,
    ).await.map_err(|e| e.to_string())
}

// ── Firmware ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_list_firmware(state: State<'_, IdracServiceState>) -> Result<Vec<FirmwareInventory>, String> {
    let svc = state.lock().await;
    svc.list_firmware().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_update_firmware(
    state: State<'_, IdracServiceState>,
    image_uri: String,
    targets: Option<Vec<String>>,
    transfer_protocol: Option<String>,
) -> Result<String, String> {
    let params = FirmwareUpdateParams {
        image_uri,
        targets,
        transfer_protocol,
    };
    let svc = state.lock().await;
    svc.update_firmware(params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_component_version(state: State<'_, IdracServiceState>, component_name: String) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.get_component_version(&component_name).await.map_err(|e| e.to_string())
}

// ── Lifecycle ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_list_jobs(state: State<'_, IdracServiceState>) -> Result<Vec<LifecycleJob>, String> {
    let svc = state.lock().await;
    svc.list_jobs().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_job(state: State<'_, IdracServiceState>, job_id: String) -> Result<LifecycleJob, String> {
    let svc = state.lock().await;
    svc.get_job(&job_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_delete_job(state: State<'_, IdracServiceState>, job_id: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_job(&job_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_purge_job_queue(state: State<'_, IdracServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.purge_job_queue().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_export_scp(
    state: State<'_, IdracServiceState>,
    target: Option<String>,
    format: Option<String>,
    export_use: Option<String>,
    include_in_export: Option<String>,
) -> Result<String, String> {
    let params = ScpExportParams {
        target,
        format,
        export_use,
        include_in_export,
    };
    let svc = state.lock().await;
    svc.export_scp(params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_import_scp(
    state: State<'_, IdracServiceState>,
    import_buffer: Option<String>,
    target: Option<String>,
    shutdown_type: Option<String>,
    host_power_state: Option<String>,
) -> Result<String, String> {
    let params = ScpImportParams {
        import_buffer,
        target,
        shutdown_type,
        host_power_state,
    };
    let svc = state.lock().await;
    svc.import_scp(params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_lc_status(state: State<'_, IdracServiceState>) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_lc_status().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_wait_for_job(
    state: State<'_, IdracServiceState>,
    job_id: String,
    timeout_secs: Option<u64>,
    poll_interval_secs: Option<u64>,
) -> Result<LifecycleJob, String> {
    let svc = state.lock().await;
    svc.wait_for_job(&job_id, timeout_secs.unwrap_or(600), poll_interval_secs.unwrap_or(10)).await.map_err(|e| e.to_string())
}

// ── Virtual Media ───────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_list_virtual_media(state: State<'_, IdracServiceState>) -> Result<Vec<VirtualMediaStatus>, String> {
    let svc = state.lock().await;
    svc.list_virtual_media().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_mount_virtual_media(
    state: State<'_, IdracServiceState>,
    image_uri: String,
    media_id: Option<String>,
    username: Option<String>,
    password: Option<String>,
    transfer_protocol: Option<String>,
) -> Result<(), String> {
    let params = VirtualMediaMountParams {
        image_uri,
        media_id,
        username,
        password,
        transfer_protocol,
    };
    let svc = state.lock().await;
    svc.mount_virtual_media(params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_unmount_virtual_media(state: State<'_, IdracServiceState>, media_id: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.unmount_virtual_media(&media_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_boot_from_virtual_cd(state: State<'_, IdracServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.boot_from_virtual_cd().await.map_err(|e| e.to_string())
}

// ── Virtual Console ─────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_get_console_info(state: State<'_, IdracServiceState>) -> Result<ConsoleInfo, String> {
    let svc = state.lock().await;
    svc.get_console_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_set_console_enabled(state: State<'_, IdracServiceState>, enabled: bool) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_console_enabled(enabled).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_set_console_type(state: State<'_, IdracServiceState>, plugin_type: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_console_type(&plugin_type).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_set_vnc_enabled(state: State<'_, IdracServiceState>, enabled: bool) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_vnc_enabled(enabled).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_set_vnc_password(state: State<'_, IdracServiceState>, password: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_vnc_password(&password).await.map_err(|e| e.to_string())
}

// ── Event Log ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_get_sel_entries(state: State<'_, IdracServiceState>, max_entries: Option<u32>) -> Result<Vec<SelEntry>, String> {
    let svc = state.lock().await;
    svc.get_sel_entries(max_entries).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_lc_log_entries(state: State<'_, IdracServiceState>, max_entries: Option<u32>) -> Result<Vec<LcLogEntry>, String> {
    let svc = state.lock().await;
    svc.get_lc_log_entries(max_entries).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_clear_sel(state: State<'_, IdracServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.clear_sel().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_clear_lc_log(state: State<'_, IdracServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.clear_lc_log().await.map_err(|e| e.to_string())
}

// ── Users ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_list_users(state: State<'_, IdracServiceState>) -> Result<Vec<IdracUser>, String> {
    let svc = state.lock().await;
    svc.list_users().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_create_or_update_user(
    state: State<'_, IdracServiceState>,
    slot_id: String,
    user_name: String,
    password: Option<String>,
    role_id: Option<String>,
    enabled: Option<bool>,
) -> Result<(), String> {
    let params = IdracUserParams {
        slot_id,
        user_name,
        password,
        role_id,
        enabled,
    };
    let svc = state.lock().await;
    svc.create_or_update_user(params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_delete_user(state: State<'_, IdracServiceState>, slot_id: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_user(&slot_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_unlock_user(state: State<'_, IdracServiceState>, slot_id: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.unlock_user(&slot_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_change_user_password(state: State<'_, IdracServiceState>, slot_id: String, new_password: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.change_user_password(&slot_id, &new_password).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_ldap_config(state: State<'_, IdracServiceState>) -> Result<LdapConfig, String> {
    let svc = state.lock().await;
    svc.get_ldap_config().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_ad_config(state: State<'_, IdracServiceState>) -> Result<ActiveDirectoryConfig, String> {
    let svc = state.lock().await;
    svc.get_ad_config().await.map_err(|e| e.to_string())
}

// ── BIOS ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_get_bios_attributes(state: State<'_, IdracServiceState>) -> Result<Vec<BiosAttribute>, String> {
    let svc = state.lock().await;
    svc.get_bios_attributes().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_bios_attribute(state: State<'_, IdracServiceState>, name: String) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.get_bios_attribute(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_set_bios_attributes(
    state: State<'_, IdracServiceState>,
    attributes: std::collections::HashMap<String, String>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.set_bios_attributes(&attributes).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_boot_order(state: State<'_, IdracServiceState>) -> Result<BootConfig, String> {
    let svc = state.lock().await;
    svc.get_boot_order().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_set_boot_order(state: State<'_, IdracServiceState>, boot_order: Vec<String>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_boot_order(&boot_order).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_set_boot_once(state: State<'_, IdracServiceState>, target: String, mode: Option<String>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_boot_once(&target, mode.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_set_boot_mode(state: State<'_, IdracServiceState>, mode: String) -> Result<String, String> {
    let svc = state.lock().await;
    svc.set_boot_mode(&mode).await.map_err(|e| e.to_string())
}

// ── Certificates ────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_list_certificates(state: State<'_, IdracServiceState>) -> Result<Vec<IdracCertificate>, String> {
    let svc = state.lock().await;
    svc.list_certificates().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_generate_csr(
    state: State<'_, IdracServiceState>,
    common_name: String,
    organization: String,
    country: String,
    state_name: String,
    city: String,
    organizational_unit: Option<String>,
    alternative_names: Option<Vec<String>>,
    key_algorithm: Option<String>,
    key_bit_length: Option<u32>,
) -> Result<String, String> {
    let params = CsrParams {
        common_name,
        organization,
        country,
        state: state_name,
        city,
        organizational_unit,
        alternative_names,
        key_algorithm,
        key_bit_length,
    };
    let svc = state.lock().await;
    svc.generate_csr(params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_import_certificate(state: State<'_, IdracServiceState>, cert_pem: String, cert_type: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.import_certificate(&cert_pem, &cert_type).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_delete_certificate(state: State<'_, IdracServiceState>, cert_id: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_certificate(&cert_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_replace_ssl_certificate(state: State<'_, IdracServiceState>, cert_pem: String, key_pem: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.replace_ssl_certificate(&cert_pem, &key_pem).await.map_err(|e| e.to_string())
}

// ── Health ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_get_health_rollup(state: State<'_, IdracServiceState>) -> Result<ServerHealthRollup, String> {
    let svc = state.lock().await;
    svc.get_health_rollup().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_component_health(state: State<'_, IdracServiceState>) -> Result<Vec<(String, ComponentHealth)>, String> {
    let svc = state.lock().await;
    svc.get_component_health().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_is_healthy(state: State<'_, IdracServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.is_healthy().await.map_err(|e| e.to_string())
}

// ── Telemetry ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_get_power_telemetry(state: State<'_, IdracServiceState>) -> Result<PowerTelemetry, String> {
    let svc = state.lock().await;
    svc.get_power_telemetry().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_thermal_telemetry(state: State<'_, IdracServiceState>) -> Result<ThermalTelemetry, String> {
    let svc = state.lock().await;
    svc.get_thermal_telemetry().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_list_telemetry_reports(state: State<'_, IdracServiceState>) -> Result<Vec<TelemetryReport>, String> {
    let svc = state.lock().await;
    svc.list_telemetry_reports().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_telemetry_report(state: State<'_, IdracServiceState>, report_id: String) -> Result<Vec<TelemetryDataPoint>, String> {
    let svc = state.lock().await;
    svc.get_telemetry_report(&report_id).await.map_err(|e| e.to_string())
}

// ── RACADM ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_racadm_execute(state: State<'_, IdracServiceState>, command: String) -> Result<RacadmResult, String> {
    let svc = state.lock().await;
    svc.racadm_execute(&command).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_reset(state: State<'_, IdracServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.reset_idrac().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_get_attribute(state: State<'_, IdracServiceState>, name: String) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    svc.get_idrac_attribute(&name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn idrac_set_attribute(state: State<'_, IdracServiceState>, name: String, value: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_idrac_attribute(&name, &value).await.map_err(|e| e.to_string())
}

// ── Dashboard ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn idrac_get_dashboard(state: State<'_, IdracServiceState>) -> Result<IdracDashboard, String> {
    let svc = state.lock().await;
    svc.get_dashboard().await.map_err(|e| e.to_string())
}
