// Tauri command handlers for all HP iLO operations.
//
// Every command is `async`, takes `State<'_, IloServiceState>` and
// returns `Result<T, String>` (Tauri requires `String` errors).

use super::service::IloServiceState;
use super::types::*;
use tauri::State;

// ── Connection ──────────────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ilo_connect(
    state: State<'_, IloServiceState>,
    host: String,
    port: Option<u16>,
    username: String,
    password: String,
    auth_method: Option<String>,
    protocol: Option<String>,
    insecure: Option<bool>,
    timeout_secs: Option<u64>,
    ipmi_port: Option<u16>,
    generation: Option<String>,
) -> Result<String, String> {
    let auth = match auth_method.as_deref() {
        Some("session") => IloAuthMethod::Session,
        _ => IloAuthMethod::Basic,
    };
    let proto = match protocol.as_deref() {
        Some("redfish") => Some(IloProtocol::Redfish),
        Some("ribcl") => Some(IloProtocol::Ribcl),
        Some("ipmi") => Some(IloProtocol::Ipmi),
        _ => None, // auto-detect
    };
    let _gen = match generation.as_deref() {
        Some("ilo1") | Some("1") => Some(IloGeneration::Ilo1),
        Some("ilo2") | Some("2") => Some(IloGeneration::Ilo2),
        Some("ilo3") | Some("3") => Some(IloGeneration::Ilo3),
        Some("ilo4") | Some("4") => Some(IloGeneration::Ilo4),
        Some("ilo5") | Some("5") => Some(IloGeneration::Ilo5),
        Some("ilo6") | Some("6") => Some(IloGeneration::Ilo6),
        Some("ilo7") | Some("7") => Some(IloGeneration::Ilo7),
        _ => None, // auto-detect
    };
    let config = IloConfig {
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
pub async fn ilo_disconnect(state: State<'_, IloServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_check_session(state: State<'_, IloServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.check_session().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_is_connected(state: State<'_, IloServiceState>) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected())
}

#[tauri::command]
pub async fn ilo_get_config(
    state: State<'_, IloServiceState>,
) -> Result<Option<IloConfigSafe>, String> {
    let svc = state.lock().await;
    Ok(svc.get_config())
}

// ── System ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_system_info(
    state: State<'_, IloServiceState>,
) -> Result<BmcSystemInfo, String> {
    let svc = state.lock().await;
    svc.get_system_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_get_ilo_info(state: State<'_, IloServiceState>) -> Result<IloInfo, String> {
    let svc = state.lock().await;
    svc.get_ilo_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_set_asset_tag(
    state: State<'_, IloServiceState>,
    tag: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_asset_tag(&tag).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_set_indicator_led(
    state: State<'_, IloServiceState>,
    led_state: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_indicator_led(&led_state)
        .await
        .map_err(|e| e.to_string())
}

// ── Power ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_power_action(
    state: State<'_, IloServiceState>,
    action: String,
) -> Result<(), String> {
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
pub async fn ilo_get_power_state(state: State<'_, IloServiceState>) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_power_state().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_get_power_metrics(
    state: State<'_, IloServiceState>,
) -> Result<BmcPowerMetrics, String> {
    let svc = state.lock().await;
    svc.get_power_metrics().await.map_err(|e| e.to_string())
}

// ── Thermal ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_thermal_data(
    state: State<'_, IloServiceState>,
) -> Result<BmcThermalData, String> {
    let svc = state.lock().await;
    svc.get_thermal_data().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_get_thermal_summary(
    state: State<'_, IloServiceState>,
) -> Result<ThermalSummary, String> {
    let svc = state.lock().await;
    svc.get_thermal_summary().await.map_err(|e| e.to_string())
}

// ── Hardware ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_processors(
    state: State<'_, IloServiceState>,
) -> Result<Vec<BmcProcessor>, String> {
    let svc = state.lock().await;
    svc.get_processors().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_get_memory(
    state: State<'_, IloServiceState>,
) -> Result<Vec<BmcMemoryDimm>, String> {
    let svc = state.lock().await;
    svc.get_memory().await.map_err(|e| e.to_string())
}

// ── Storage ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_storage_controllers(
    state: State<'_, IloServiceState>,
) -> Result<Vec<BmcStorageController>, String> {
    let svc = state.lock().await;
    svc.get_storage_controllers()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_get_virtual_disks(
    state: State<'_, IloServiceState>,
) -> Result<Vec<BmcVirtualDisk>, String> {
    let svc = state.lock().await;
    svc.get_virtual_disks().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_get_physical_disks(
    state: State<'_, IloServiceState>,
) -> Result<Vec<BmcPhysicalDisk>, String> {
    let svc = state.lock().await;
    svc.get_physical_disks().await.map_err(|e| e.to_string())
}

// ── Network ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_network_adapters(
    state: State<'_, IloServiceState>,
) -> Result<Vec<BmcNetworkAdapter>, String> {
    let svc = state.lock().await;
    svc.get_network_adapters().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_get_ilo_network(
    state: State<'_, IloServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.get_ilo_network().await.map_err(|e| e.to_string())
}

// ── Firmware ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_firmware_inventory(
    state: State<'_, IloServiceState>,
) -> Result<Vec<BmcFirmwareItem>, String> {
    let svc = state.lock().await;
    svc.get_firmware_inventory()
        .await
        .map_err(|e| e.to_string())
}

// ── Virtual Media ───────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_virtual_media_status(
    state: State<'_, IloServiceState>,
) -> Result<Vec<BmcVirtualMedia>, String> {
    let svc = state.lock().await;
    svc.get_virtual_media_status()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_insert_virtual_media(
    state: State<'_, IloServiceState>,
    url: String,
    media_id: Option<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.insert_virtual_media(&url, media_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_eject_virtual_media(
    state: State<'_, IloServiceState>,
    media_id: Option<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.eject_virtual_media(media_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_set_vm_boot_once(state: State<'_, IloServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_vm_boot_once().await.map_err(|e| e.to_string())
}

// ── Virtual Console ─────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_console_info(
    state: State<'_, IloServiceState>,
) -> Result<IloConsoleInfo, String> {
    let svc = state.lock().await;
    svc.get_console_info().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_get_html5_launch_url(state: State<'_, IloServiceState>) -> Result<String, String> {
    let svc = state.lock().await;
    svc.get_html5_launch_url().await.map_err(|e| e.to_string())
}

// ── Event Logs ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_iml(
    state: State<'_, IloServiceState>,
) -> Result<Vec<BmcEventLogEntry>, String> {
    let svc = state.lock().await;
    svc.get_iml().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_get_ilo_event_log(
    state: State<'_, IloServiceState>,
) -> Result<Vec<BmcEventLogEntry>, String> {
    let svc = state.lock().await;
    svc.get_ilo_event_log().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_clear_iml(state: State<'_, IloServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.clear_iml().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_clear_ilo_event_log(state: State<'_, IloServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.clear_ilo_event_log().await.map_err(|e| e.to_string())
}

// ── Users ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_users(state: State<'_, IloServiceState>) -> Result<Vec<BmcUser>, String> {
    let svc = state.lock().await;
    svc.get_users().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_create_user(
    state: State<'_, IloServiceState>,
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
pub async fn ilo_update_password(
    state: State<'_, IloServiceState>,
    user_id: String,
    new_password: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.update_password(&user_id, &new_password)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_delete_user(
    state: State<'_, IloServiceState>,
    user_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_user(&user_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_set_user_enabled(
    state: State<'_, IloServiceState>,
    user_id: String,
    enabled: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_user_enabled(&user_id, enabled)
        .await
        .map_err(|e| e.to_string())
}

// ── BIOS ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_bios_attributes(
    state: State<'_, IloServiceState>,
) -> Result<Vec<BiosAttribute>, String> {
    let svc = state.lock().await;
    svc.get_bios_attributes().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_set_bios_attributes(
    state: State<'_, IloServiceState>,
    attributes: serde_json::Value,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_bios_attributes(&attributes)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_get_boot_config(state: State<'_, IloServiceState>) -> Result<BootConfig, String> {
    let svc = state.lock().await;
    svc.get_boot_config().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_set_boot_override(
    state: State<'_, IloServiceState>,
    target: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_boot_override(&target)
        .await
        .map_err(|e| e.to_string())
}

// ── Certificates ────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_certificate(
    state: State<'_, IloServiceState>,
) -> Result<IloCertificate, String> {
    let svc = state.lock().await;
    svc.get_certificate().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_generate_csr(
    state: State<'_, IloServiceState>,
    common_name: String,
    country: String,
    state_name: String,
    city: String,
    organization: String,
    organizational_unit: Option<String>,
) -> Result<String, String> {
    let params = CsrParams {
        common_name,
        country,
        state: Some(state_name),
        city: Some(city),
        organization,
        organizational_unit,
    };
    let svc = state.lock().await;
    svc.generate_csr(&params).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_import_certificate(
    state: State<'_, IloServiceState>,
    cert_pem: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.import_certificate(&cert_pem)
        .await
        .map_err(|e| e.to_string())
}

// ── Health ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_health_rollup(
    state: State<'_, IloServiceState>,
) -> Result<BmcHealthRollup, String> {
    let svc = state.lock().await;
    svc.get_health_rollup().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_get_dashboard(state: State<'_, IloServiceState>) -> Result<IloDashboard, String> {
    let svc = state.lock().await;
    svc.get_dashboard().await.map_err(|e| e.to_string())
}

// ── License ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_license(state: State<'_, IloServiceState>) -> Result<IloLicense, String> {
    let svc = state.lock().await;
    svc.get_license().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_activate_license(
    state: State<'_, IloServiceState>,
    key: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.activate_license(&key).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_deactivate_license(state: State<'_, IloServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.deactivate_license().await.map_err(|e| e.to_string())
}

// ── Security ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_security_status(
    state: State<'_, IloServiceState>,
) -> Result<IloSecurityStatus, String> {
    let svc = state.lock().await;
    svc.get_security_status().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_set_min_tls_version(
    state: State<'_, IloServiceState>,
    version: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_min_tls_version(&version)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_set_ipmi_over_lan(
    state: State<'_, IloServiceState>,
    enabled: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_ipmi_over_lan(enabled)
        .await
        .map_err(|e| e.to_string())
}

// ── Federation ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_get_federation_groups(
    state: State<'_, IloServiceState>,
) -> Result<Vec<IloFederationGroup>, String> {
    let svc = state.lock().await;
    svc.get_federation_groups().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_get_federation_peers(
    state: State<'_, IloServiceState>,
) -> Result<Vec<IloFederationPeer>, String> {
    let svc = state.lock().await;
    svc.get_federation_peers().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_add_federation_group(
    state: State<'_, IloServiceState>,
    name: String,
    key: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.add_federation_group(&name, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ilo_remove_federation_group(
    state: State<'_, IloServiceState>,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_federation_group(&name)
        .await
        .map_err(|e| e.to_string())
}

// ── iLO Reset ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn ilo_reset(state: State<'_, IloServiceState>) -> Result<(), String> {
    let svc = state.lock().await;
    svc.reset_ilo().await.map_err(|e| e.to_string())
}
