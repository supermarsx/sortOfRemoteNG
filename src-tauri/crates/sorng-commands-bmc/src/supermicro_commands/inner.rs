// Tauri command handlers for Supermicro BMC management.

use super::service::SmcServiceState;
use super::types::*;
use sorng_bmc_common::power::PowerAction;
use tauri::State;

// ── Connection ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_connect(
    state: State<'_, SmcServiceState>,
    config: SmcConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_disconnect(state: State<'_, SmcServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_check_session(state: State<'_, SmcServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.check_session().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_is_connected(state: State<'_, SmcServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected())
}

#[tauri::command]
pub async fn smc_get_config(state: State<'_, SmcServiceState>) -> Result<SmcConfigSafe, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

// ── System ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_system_info(state: State<'_, SmcServiceState>) -> Result<SystemInfo, String> {
    let svc = state.lock().await;
    svc.get_system_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_get_bmc_info(state: State<'_, SmcServiceState>) -> Result<SmcBmcInfo, String> {
    let svc = state.lock().await;
    svc.get_bmc_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_set_asset_tag(
    state: State<'_, SmcServiceState>,
    tag: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_asset_tag(&tag).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_set_indicator_led(
    state: State<'_, SmcServiceState>,
    led_state: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_indicator_led(&led_state)
        .await
        .map_err(|e| e.to_string())
}

// ── Power ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_power_action(
    state: State<'_, SmcServiceState>,
    action: PowerAction,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.power_action(&action).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_get_power_state(state: State<'_, SmcServiceState>) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_power_state().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_get_power_metrics(
    state: State<'_, SmcServiceState>,
) -> Result<PowerMetrics, String> {
    let svc = state.lock().await;
    svc.get_power_metrics().await.map_err(|e| e.to_string())
}

// ── Thermal ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_thermal_data(
    state: State<'_, SmcServiceState>,
) -> Result<ThermalData, String> {
    let svc = state.lock().await;
    svc.get_thermal_data().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_get_thermal_summary(
    state: State<'_, SmcServiceState>,
) -> Result<ThermalSummary, String> {
    let svc = state.lock().await;
    svc.get_thermal_summary().await.map_err(|e| e.to_string())
}

// ── Hardware ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_processors(
    state: State<'_, SmcServiceState>,
) -> Result<Vec<ProcessorInfo>, String> {
    let svc = state.lock().await;
    svc.get_processors().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_get_memory(state: State<'_, SmcServiceState>) -> Result<Vec<MemoryInfo>, String> {
    let svc = state.lock().await;
    svc.get_memory().await.map_err(|e| e.to_string())
}

// ── Storage ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_storage_controllers(
    state: State<'_, SmcServiceState>,
) -> Result<Vec<StorageController>, String> {
    let svc = state.lock().await;
    svc.get_storage_controllers()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_get_virtual_disks(
    state: State<'_, SmcServiceState>,
) -> Result<Vec<VirtualDisk>, String> {
    let svc = state.lock().await;
    svc.get_virtual_disks().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_get_physical_disks(
    state: State<'_, SmcServiceState>,
) -> Result<Vec<PhysicalDisk>, String> {
    let svc = state.lock().await;
    svc.get_physical_disks().await.map_err(|e| e.to_string())
}

// ── Network ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_network_adapters(
    state: State<'_, SmcServiceState>,
) -> Result<Vec<NetworkAdapter>, String> {
    let svc = state.lock().await;
    svc.get_network_adapters().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_get_bmc_network(
    state: State<'_, SmcServiceState>,
) -> Result<Vec<NetworkAdapter>, String> {
    let svc = state.lock().await;
    svc.get_bmc_network().await.map_err(|e| e.to_string())
}

// ── Firmware ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_firmware_inventory(
    state: State<'_, SmcServiceState>,
) -> Result<Vec<FirmwareInfo>, String> {
    let svc = state.lock().await;
    svc.get_firmware_inventory()
        .await
        .map_err(|e| e.to_string())
}

// ── Virtual media ───────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_virtual_media_status(
    state: State<'_, SmcServiceState>,
) -> Result<Vec<VirtualMediaStatus>, String> {
    let svc = state.lock().await;
    svc.get_virtual_media_status()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_insert_virtual_media(
    state: State<'_, SmcServiceState>,
    slot: String,
    image_url: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.insert_virtual_media(&slot, &image_url)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_eject_virtual_media(
    state: State<'_, SmcServiceState>,
    slot: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.eject_virtual_media(&slot)
        .await
        .map_err(|e| e.to_string())
}

// ── Console / iKVM ──────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_console_info(
    state: State<'_, SmcServiceState>,
) -> Result<SmcConsoleInfo, String> {
    let svc = state.lock().await;
    svc.get_console_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_get_html5_ikvm_url(state: State<'_, SmcServiceState>) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_html5_ikvm_url().await.map_err(|e| e.to_string())
}

// ── Event log ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_event_log(
    state: State<'_, SmcServiceState>,
) -> Result<Vec<EventLogEntry>, String> {
    let svc = state.lock().await;
    svc.get_event_log().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_get_audit_log(
    state: State<'_, SmcServiceState>,
) -> Result<Vec<EventLogEntry>, String> {
    let svc = state.lock().await;
    svc.get_audit_log().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_clear_event_log(state: State<'_, SmcServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.clear_event_log().await.map_err(|e| e.to_string())
}

// ── Users ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_users(state: State<'_, SmcServiceState>) -> Result<Vec<UserAccount>, String> {
    let svc = state.lock().await;
    svc.get_users().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_create_user(
    state: State<'_, SmcServiceState>,
    username: String,
    password: String,
    role: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.create_user(&username, &password, &role)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_update_password(
    state: State<'_, SmcServiceState>,
    user_id: String,
    new_password: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.update_password(&user_id, &new_password)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_delete_user(
    state: State<'_, SmcServiceState>,
    user_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_user(&user_id).await.map_err(|e| e.to_string())
}

// ── BIOS ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_bios_attributes(
    state: State<'_, SmcServiceState>,
) -> Result<Vec<BiosAttribute>, String> {
    let svc = state.lock().await;
    svc.get_bios_attributes().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_set_bios_attributes(
    state: State<'_, SmcServiceState>,
    attributes: serde_json::Value,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_bios_attributes(&attributes)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_get_boot_config(state: State<'_, SmcServiceState>) -> Result<BootConfig, String> {
    let svc = state.lock().await;
    svc.get_boot_config().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_set_boot_override(
    state: State<'_, SmcServiceState>,
    target: String,
    mode: Option<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_boot_override(&target, mode.as_deref())
        .await
        .map_err(|e| e.to_string())
}

// ── Certificates ────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_certificate(
    state: State<'_, SmcServiceState>,
) -> Result<SmcCertificate, String> {
    let svc = state.lock().await;
    svc.get_certificate().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_generate_csr(
    state: State<'_, SmcServiceState>,
    params: CsrParams,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.generate_csr(&params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_import_certificate(
    state: State<'_, SmcServiceState>,
    cert_pem: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.import_certificate(&cert_pem)
        .await
        .map_err(|e| e.to_string())
}

// ── Health ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_health_rollup(
    state: State<'_, SmcServiceState>,
) -> Result<HealthRollup, String> {
    let svc = state.lock().await;
    svc.get_health_rollup().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_get_dashboard(state: State<'_, SmcServiceState>) -> Result<SmcDashboard, String> {
    let svc = state.lock().await;
    svc.get_dashboard().await.map_err(|e| e.to_string())
}

// ── Security ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_security_status(
    state: State<'_, SmcServiceState>,
) -> Result<SmcSecurityStatus, String> {
    let svc = state.lock().await;
    svc.get_security_status().await.map_err(|e| e.to_string())
}

// ── License ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_licenses(
    state: State<'_, SmcServiceState>,
) -> Result<Vec<SmcLicense>, String> {
    let svc = state.lock().await;
    svc.get_licenses().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_activate_license(
    state: State<'_, SmcServiceState>,
    product_key: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.activate_license(&product_key)
        .await
        .map_err(|e| e.to_string())
}

// ── Node Manager ────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_get_node_manager_policies(
    state: State<'_, SmcServiceState>,
) -> Result<Vec<NodeManagerPolicy>, String> {
    let svc = state.lock().await;
    svc.get_node_manager_policies()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn smc_get_node_manager_stats(
    state: State<'_, SmcServiceState>,
    domain: NodeManagerDomain,
) -> Result<NodeManagerStats, String> {
    let svc = state.lock().await;
    svc.get_node_manager_stats(&domain)
        .await
        .map_err(|e| e.to_string())
}

// ── BMC reset ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn smc_reset_bmc(state: State<'_, SmcServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.reset_bmc().await.map_err(|e| e.to_string())
}
