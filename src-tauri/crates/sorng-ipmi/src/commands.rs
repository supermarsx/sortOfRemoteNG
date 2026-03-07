//! Tauri commands for the IPMI integration.
//!
//! Each command follows the pattern: acquire the `IpmiServiceState` lock,
//! delegate to the service method, and map errors to `String`.

use crate::service::IpmiServiceState;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ipmi_connect(
    state: tauri::State<'_, IpmiServiceState>,
    config: IpmiSessionConfig,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.connect(config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_disconnect(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_disconnect_all(
    state: tauri::State<'_, IpmiServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_all();
    Ok(())
}

#[tauri::command]
pub async fn ipmi_list_sessions(
    state: tauri::State<'_, IpmiServiceState>,
) -> Result<Vec<IpmiSessionInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions())
}

#[tauri::command]
pub async fn ipmi_get_session(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<IpmiSessionInfo, String> {
    let svc = state.lock().await;
    svc.get_session_info(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_ping(
    state: tauri::State<'_, IpmiServiceState>,
    host: String,
    port: Option<u16>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.ping(&host, port.unwrap_or(623), 5)
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Chassis
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ipmi_get_chassis_status(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<ChassisStatus, String> {
    let mut svc = state.lock().await;
    svc.get_chassis_status(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_chassis_control(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    action: ChassisControl,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.chassis_control(&session_id, action)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_power_on(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.power_on(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_power_off(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.power_off(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_power_cycle(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.power_cycle(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_hard_reset(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.hard_reset(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_soft_shutdown(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.soft_shutdown(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_chassis_identify(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    duration: Option<u8>,
    force: Option<bool>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.chassis_identify(&session_id, duration, force.unwrap_or(false))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_set_boot_device(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    device: BootDevice,
    persistent: Option<bool>,
    efi: Option<bool>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_boot_device(
        &session_id,
        device,
        persistent.unwrap_or(false),
        efi.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_get_device_id(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<IpmiDeviceId, String> {
    let mut svc = state.lock().await;
    svc.get_device_id(&session_id).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Sensors / SDR
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ipmi_get_all_sdr_records(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<Vec<SdrRecord>, String> {
    let mut svc = state.lock().await;
    svc.get_all_sdr_records(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_read_sensor(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    sensor: SdrFullSensor,
) -> Result<SensorReading, String> {
    let mut svc = state.lock().await;
    svc.read_sensor(&session_id, &sensor).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_get_sensor_thresholds(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    sensor_number: u8,
    sdr: SdrFullSensor,
) -> Result<SensorThresholds, String> {
    let mut svc = state.lock().await;
    svc.get_sensor_thresholds(&session_id, sensor_number, &sdr)
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// SEL
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ipmi_get_sel_info(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<SelInfo, String> {
    let mut svc = state.lock().await;
    svc.get_sel_info(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_get_all_sel_entries(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<Vec<SelEntry>, String> {
    let mut svc = state.lock().await;
    svc.get_all_sel_entries(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_clear_sel(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.clear_sel(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_delete_sel_entry(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    record_id: u16,
) -> Result<u16, String> {
    let mut svc = state.lock().await;
    svc.delete_sel_entry(&session_id, record_id)
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// FRU
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ipmi_get_fru_info(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    device_id: Option<u8>,
) -> Result<FruDeviceInfo, String> {
    let mut svc = state.lock().await;
    svc.get_fru_info(&session_id, device_id.unwrap_or(0))
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// SOL
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ipmi_get_sol_config(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    channel: Option<u8>,
) -> Result<SolConfig, String> {
    let mut svc = state.lock().await;
    svc.get_sol_config(&session_id, channel.unwrap_or(0x0E))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_activate_sol(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    instance: Option<u8>,
    encrypt: Option<bool>,
    auth: Option<bool>,
) -> Result<SolSession, String> {
    let mut svc = state.lock().await;
    svc.activate_sol(
        &session_id,
        instance.unwrap_or(1),
        encrypt.unwrap_or(true),
        auth.unwrap_or(true),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_deactivate_sol(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    instance: Option<u8>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.deactivate_sol(&session_id, instance.unwrap_or(1))
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Watchdog
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ipmi_get_watchdog_timer(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<WatchdogTimer, String> {
    let mut svc = state.lock().await;
    svc.get_watchdog_timer(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_reset_watchdog_timer(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.reset_watchdog_timer(&session_id).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// LAN
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ipmi_get_lan_config(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    channel: Option<u8>,
) -> Result<LanConfig, String> {
    let mut svc = state.lock().await;
    svc.get_lan_config(&session_id, channel.unwrap_or(1))
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ipmi_list_users(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    channel: Option<u8>,
) -> Result<Vec<IpmiUser>, String> {
    let mut svc = state.lock().await;
    svc.list_users(&session_id, channel.unwrap_or(1))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_set_user_name(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    user_id: u8,
    name: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_user_name(&session_id, user_id, &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_set_user_password(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    user_id: u8,
    password: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_user_password(&session_id, user_id, &password)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_enable_user(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    user_id: u8,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.enable_user(&session_id, user_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_disable_user(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    user_id: u8,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disable_user(&session_id, user_id).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Raw Commands
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ipmi_raw_command(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    netfn: u8,
    cmd: u8,
    data: Option<Vec<u8>>,
) -> Result<RawIpmiResponse, String> {
    let mut svc = state.lock().await;
    svc.raw_command(&session_id, netfn, cmd, &data.unwrap_or_default())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_bridged_command(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    target_channel: u8,
    target_address: u8,
    netfn: u8,
    cmd: u8,
    data: Option<Vec<u8>>,
) -> Result<RawIpmiResponse, String> {
    let mut svc = state.lock().await;
    svc.bridged_command(
        &session_id,
        target_channel,
        target_address,
        netfn,
        cmd,
        &data.unwrap_or_default(),
    )
    .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// PEF
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ipmi_get_pef_capabilities(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<PefCapabilities, String> {
    let mut svc = state.lock().await;
    svc.get_pef_capabilities(&session_id).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
// Channel
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn ipmi_get_channel_info(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    channel: u8,
) -> Result<ChannelInfo, String> {
    let mut svc = state.lock().await;
    svc.get_channel_info(&session_id, channel)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_list_channels(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
) -> Result<Vec<ChannelInfo>, String> {
    let mut svc = state.lock().await;
    svc.list_channels(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ipmi_get_channel_cipher_suites(
    state: tauri::State<'_, IpmiServiceState>,
    session_id: String,
    channel: u8,
) -> Result<Vec<CipherSuite>, String> {
    let mut svc = state.lock().await;
    svc.get_channel_cipher_suites(&session_id, channel)
        .map_err(|e| e.to_string())
}
