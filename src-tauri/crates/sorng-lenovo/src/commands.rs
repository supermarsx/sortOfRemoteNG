//! Tauri command handlers for all Lenovo XCC/IMM operations.

use crate::service::LenovoServiceState;
use crate::types::*;
use tauri::State;

// ── Connection ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_connect(
    state: State<'_, LenovoServiceState>,
    host: String,
    port: Option<u16>,
    username: String,
    password: String,
    protocol: Option<String>,
    insecure: Option<bool>,
    timeout_secs: Option<u64>,
    ipmi_port: Option<u16>,
    generation: Option<String>,
) -> Result<String, String> {
    let proto = match protocol.as_deref() {
        Some("redfish") => Some(LenovoProtocol::Redfish),
        Some("legacyRest") | Some("legacy_rest") => Some(LenovoProtocol::LegacyRest),
        Some("ipmi") => Some(LenovoProtocol::Ipmi),
        _ => None,
    };
    let gen = match generation.as_deref() {
        Some("xcc2") | Some("Xcc2") => Some(XccGeneration::Xcc2),
        Some("xcc") | Some("Xcc") => Some(XccGeneration::Xcc),
        Some("imm2") | Some("Imm2") => Some(XccGeneration::Imm2),
        Some("imm") | Some("Imm") => Some(XccGeneration::Imm),
        _ => None,
    };
    let config = LenovoConfig {
        host,
        port: port.unwrap_or(443),
        username,
        password,
        auth_method: LenovoAuthMethod::Session,
        protocol: proto,
        insecure: insecure.unwrap_or(true),
        timeout_secs: timeout_secs.unwrap_or(30),
        ipmi_port: ipmi_port.unwrap_or(623),
        generation: gen,
    };
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_disconnect(state: State<'_, LenovoServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_check_session(state: State<'_, LenovoServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.check_session().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_is_connected(state: State<'_, LenovoServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected())
}

#[tauri::command]
pub async fn lenovo_get_config(state: State<'_, LenovoServiceState>) -> Result<LenovoConfigSafe, String> {
    let svc = state.lock().await;
    svc.get_config().map_err(|e| e.to_string())
}

// ── System ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_system_info(state: State<'_, LenovoServiceState>) -> Result<BmcSystemInfo, String> {
    let svc = state.lock().await;
    svc.get_system_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_get_xcc_info(state: State<'_, LenovoServiceState>) -> Result<XccInfo, String> {
    let svc = state.lock().await;
    svc.get_xcc_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_set_asset_tag(state: State<'_, LenovoServiceState>, tag: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_asset_tag(&tag).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_set_indicator_led(state: State<'_, LenovoServiceState>, led_state: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_indicator_led(&led_state).await.map_err(|e| e.to_string())
}

// ── Power ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_power_action(state: State<'_, LenovoServiceState>, action: String) -> Result<(), String> {
    let pa = match action.as_str() {
        "on" => PowerAction::On,
        "forceOff" => PowerAction::ForceOff,
        "gracefulShutdown" => PowerAction::GracefulShutdown,
        "gracefulRestart" => PowerAction::GracefulRestart,
        "forceRestart" => PowerAction::ForceRestart,
        "nmi" => PowerAction::Nmi,
        "pushPowerButton" => PowerAction::PushPowerButton,
        "powerCycle" => PowerAction::PowerCycle,
        _ => return Err(format!("Unknown power action: {action}")),
    };
    let svc = state.lock().await;
    svc.power_action(&pa).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_get_power_state(state: State<'_, LenovoServiceState>) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_power_state().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_get_power_metrics(state: State<'_, LenovoServiceState>) -> Result<BmcPowerMetrics, String> {
    let svc = state.lock().await;
    svc.get_power_metrics().await.map_err(|e| e.to_string())
}

// ── Thermal ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_thermal_data(state: State<'_, LenovoServiceState>) -> Result<BmcThermalData, String> {
    let svc = state.lock().await;
    svc.get_thermal_data().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_get_thermal_summary(state: State<'_, LenovoServiceState>) -> Result<ThermalSummary, String> {
    let svc = state.lock().await;
    svc.get_thermal_summary().await.map_err(|e| e.to_string())
}

// ── Hardware ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_processors(state: State<'_, LenovoServiceState>) -> Result<Vec<BmcProcessor>, String> {
    let svc = state.lock().await;
    svc.get_processors().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_get_memory(state: State<'_, LenovoServiceState>) -> Result<Vec<BmcMemoryDimm>, String> {
    let svc = state.lock().await;
    svc.get_memory().await.map_err(|e| e.to_string())
}

// ── Storage ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_storage_controllers(state: State<'_, LenovoServiceState>) -> Result<Vec<BmcStorageController>, String> {
    let svc = state.lock().await;
    svc.get_storage_controllers().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_get_virtual_disks(state: State<'_, LenovoServiceState>) -> Result<Vec<BmcVirtualDisk>, String> {
    let svc = state.lock().await;
    svc.get_virtual_disks().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_get_physical_disks(state: State<'_, LenovoServiceState>) -> Result<Vec<BmcPhysicalDisk>, String> {
    let svc = state.lock().await;
    svc.get_physical_disks().await.map_err(|e| e.to_string())
}

// ── Network ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_network_adapters(state: State<'_, LenovoServiceState>) -> Result<Vec<BmcNetworkAdapter>, String> {
    let svc = state.lock().await;
    svc.get_network_adapters().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_get_xcc_network(state: State<'_, LenovoServiceState>) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.get_xcc_network().await.map_err(|e| e.to_string())
}

// ── Firmware ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_firmware_inventory(state: State<'_, LenovoServiceState>) -> Result<Vec<BmcFirmwareItem>, String> {
    let svc = state.lock().await;
    svc.get_firmware_inventory().await.map_err(|e| e.to_string())
}

// ── Virtual Media ───────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_virtual_media_status(state: State<'_, LenovoServiceState>) -> Result<Vec<BmcVirtualMedia>, String> {
    let svc = state.lock().await;
    svc.get_virtual_media_status().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_insert_virtual_media(state: State<'_, LenovoServiceState>, slot: String, image_url: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.insert_virtual_media(&slot, &image_url).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_eject_virtual_media(state: State<'_, LenovoServiceState>, slot: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.eject_virtual_media(&slot).await.map_err(|e| e.to_string())
}

// ── Virtual Console ─────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_console_info(state: State<'_, LenovoServiceState>) -> Result<XccConsoleInfo, String> {
    let svc = state.lock().await;
    svc.get_console_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_get_html5_launch_url(state: State<'_, LenovoServiceState>) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_html5_launch_url().await.map_err(|e| e.to_string())
}

// ── Event Log ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_event_log(state: State<'_, LenovoServiceState>) -> Result<Vec<BmcEventLogEntry>, String> {
    let svc = state.lock().await;
    svc.get_event_log().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_get_audit_log(state: State<'_, LenovoServiceState>) -> Result<Vec<BmcEventLogEntry>, String> {
    let svc = state.lock().await;
    svc.get_audit_log().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_clear_event_log(state: State<'_, LenovoServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.clear_event_log().await.map_err(|e| e.to_string())
}

// ── Users ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_users(state: State<'_, LenovoServiceState>) -> Result<Vec<BmcUser>, String> {
    let svc = state.lock().await;
    svc.get_users().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_create_user(state: State<'_, LenovoServiceState>, username: String, password: String, role: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.create_user(&username, &password, &role).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_update_password(state: State<'_, LenovoServiceState>, user_id: String, password: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.update_password(&user_id, &password).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_delete_user(state: State<'_, LenovoServiceState>, user_id: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_user(&user_id).await.map_err(|e| e.to_string())
}

// ── BIOS ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_bios_attributes(state: State<'_, LenovoServiceState>) -> Result<Vec<BiosAttribute>, String> {
    let svc = state.lock().await;
    svc.get_bios_attributes().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_set_bios_attributes(state: State<'_, LenovoServiceState>, attributes: serde_json::Value) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_bios_attributes(&attributes).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_get_boot_config(state: State<'_, LenovoServiceState>) -> Result<BootConfig, String> {
    let svc = state.lock().await;
    svc.get_boot_config().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_set_boot_override(state: State<'_, LenovoServiceState>, target: String, mode: Option<String>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_boot_override(&target, mode.as_deref()).await.map_err(|e| e.to_string())
}

// ── Certificates ────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_certificate(state: State<'_, LenovoServiceState>) -> Result<XccCertificate, String> {
    let svc = state.lock().await;
    svc.get_certificate().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_generate_csr(state: State<'_, LenovoServiceState>, params: CsrParams) -> Result<String, String> {
    let svc = state.lock().await;
    svc.generate_csr(&params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_import_certificate(state: State<'_, LenovoServiceState>, cert_pem: String) -> Result<(), String> {
    let svc = state.lock().await;
    svc.import_certificate(&cert_pem).await.map_err(|e| e.to_string())
}

// ── Health ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_health_rollup(state: State<'_, LenovoServiceState>) -> Result<BmcHealthRollup, String> {
    let svc = state.lock().await;
    svc.get_health_rollup().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lenovo_get_dashboard(state: State<'_, LenovoServiceState>) -> Result<XccDashboard, String> {
    let svc = state.lock().await;
    svc.get_dashboard().await.map_err(|e| e.to_string())
}

// ── License ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_get_license(state: State<'_, LenovoServiceState>) -> Result<XccLicense, String> {
    // This is handled at the service level via Redfish — add service method
    Err("License management not yet exposed via service facade — use dashboard".to_string())
}

// ── OneCLI ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_onecli_execute(state: State<'_, LenovoServiceState>, command: String) -> Result<OnecliResult, String> {
    let svc = state.lock().await;
    svc.onecli_execute(&command).await.map_err(|e| e.to_string())
}

// ── Reset ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lenovo_reset_controller(state: State<'_, LenovoServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.reset_controller().await.map_err(|e| e.to_string())
}
