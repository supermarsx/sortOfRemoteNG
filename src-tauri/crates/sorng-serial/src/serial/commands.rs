//! Tauri command wrappers for the serial service.
//!
//! Each command is a thin wrapper that delegates to the `SerialService`.

use crate::serial::types::LogConfig;
use crate::serial::modem::{ModemInfo, SignalQuality};
use crate::serial::port_scanner::ScanOptions;
use crate::serial::service::SerialServiceState;
use crate::serial::types::*;
use tauri::State;

// ── Port scanning ─────────────────────────────────────────────────

#[tauri::command]
pub async fn serial_scan_ports(
    service: State<'_, SerialServiceState>,
    options: Option<ScanOptions>,
) -> Result<crate::serial::port_scanner::ScanResult, String> {
    service.scan_ports(options.unwrap_or_default()).await
}

// ── Connection management ─────────────────────────────────────────

#[tauri::command]
pub async fn serial_connect<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    service: State<'_, SerialServiceState>,
    config: SerialConfig,
) -> Result<SerialSession, String> {
    service.connect_with_events(app, config).await
}

#[tauri::command]
pub async fn serial_disconnect(
    service: State<'_, SerialServiceState>,
    session_id: String,
) -> Result<(), String> {
    service.disconnect(&session_id).await
}

#[tauri::command]
pub async fn serial_disconnect_all(
    service: State<'_, SerialServiceState>,
) -> Result<Vec<String>, String> {
    service.disconnect_all().await
}

// ── Data transmission ─────────────────────────────────────────────

#[tauri::command]
pub async fn serial_send_raw(
    service: State<'_, SerialServiceState>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    service.send_raw(&session_id, data).await
}

#[tauri::command]
pub async fn serial_send_line(
    service: State<'_, SerialServiceState>,
    session_id: String,
    line: String,
) -> Result<(), String> {
    service.send_line(&session_id, line).await
}

#[tauri::command]
pub async fn serial_send_char(
    service: State<'_, SerialServiceState>,
    session_id: String,
    ch: u8,
) -> Result<(), String> {
    service.send_char(&session_id, ch).await
}

#[tauri::command]
pub async fn serial_send_hex(
    service: State<'_, SerialServiceState>,
    session_id: String,
    hex: String,
) -> Result<(), String> {
    let data = crate::serial::transport::hex_to_bytes(&hex)?;
    service.send_raw(&session_id, data).await
}

// ── Control signals ───────────────────────────────────────────────

#[tauri::command]
pub async fn serial_send_break(
    service: State<'_, SerialServiceState>,
    session_id: String,
    duration_ms: Option<u32>,
) -> Result<(), String> {
    service
        .send_break(&session_id, duration_ms.unwrap_or(250))
        .await
}

#[tauri::command]
pub async fn serial_set_dtr(
    service: State<'_, SerialServiceState>,
    session_id: String,
    state: bool,
) -> Result<(), String> {
    service.set_dtr(&session_id, state).await
}

#[tauri::command]
pub async fn serial_set_rts(
    service: State<'_, SerialServiceState>,
    session_id: String,
    state: bool,
) -> Result<(), String> {
    service.set_rts(&session_id, state).await
}

#[tauri::command]
pub async fn serial_read_control_lines(
    service: State<'_, SerialServiceState>,
    session_id: String,
) -> Result<ControlLines, String> {
    service.read_control_lines(&session_id).await
}

// ── Configuration ─────────────────────────────────────────────────

#[tauri::command]
pub async fn serial_reconfigure(
    service: State<'_, SerialServiceState>,
    session_id: String,
    config: SerialConfig,
) -> Result<(), String> {
    service.reconfigure(&session_id, config).await
}

#[tauri::command]
pub async fn serial_set_line_ending(
    service: State<'_, SerialServiceState>,
    session_id: String,
    line_ending: LineEnding,
) -> Result<(), String> {
    service.set_line_ending(&session_id, line_ending).await
}

#[tauri::command]
pub async fn serial_set_local_echo(
    service: State<'_, SerialServiceState>,
    session_id: String,
    echo: bool,
) -> Result<(), String> {
    service.set_local_echo(&session_id, echo).await
}

#[tauri::command]
pub async fn serial_flush(
    service: State<'_, SerialServiceState>,
    session_id: String,
) -> Result<(), String> {
    service.flush(&session_id).await
}

// ── Session info ──────────────────────────────────────────────────

#[tauri::command]
pub async fn serial_get_session_info(
    service: State<'_, SerialServiceState>,
    session_id: String,
) -> Result<SerialSession, String> {
    service.get_session_info(&session_id).await
}

#[tauri::command]
pub async fn serial_list_sessions(
    service: State<'_, SerialServiceState>,
) -> Result<Vec<SerialSession>, String> {
    Ok(service.list_sessions().await)
}

#[tauri::command]
pub async fn serial_get_stats(
    service: State<'_, SerialServiceState>,
    session_id: String,
) -> Result<SessionStats, String> {
    service.get_stats(&session_id).await
}

// ── Modem / AT commands ───────────────────────────────────────────

#[tauri::command]
pub async fn serial_send_at_command(
    service: State<'_, SerialServiceState>,
    session_id: String,
    command: String,
    timeout_ms: Option<u64>,
) -> Result<AtCommandResult, String> {
    service
        .send_at_command(&session_id, &command, timeout_ms.unwrap_or(5000))
        .await
}

#[tauri::command]
pub async fn serial_get_modem_info(
    service: State<'_, SerialServiceState>,
    session_id: String,
) -> Result<ModemInfo, String> {
    service.get_modem_info(&session_id).await
}

#[tauri::command]
pub async fn serial_get_signal_quality(
    service: State<'_, SerialServiceState>,
    session_id: String,
) -> Result<SignalQuality, String> {
    service.get_signal_quality(&session_id).await
}

#[tauri::command]
pub async fn serial_modem_init(
    service: State<'_, SerialServiceState>,
    session_id: String,
    profile: Option<ModemProfile>,
) -> Result<AtCommandResult, String> {
    service.modem_init(&session_id, profile).await
}

#[tauri::command]
pub async fn serial_modem_dial(
    service: State<'_, SerialServiceState>,
    session_id: String,
    number: String,
) -> Result<AtCommandResult, String> {
    service.modem_dial(&session_id, &number).await
}

#[tauri::command]
pub async fn serial_modem_hangup(
    service: State<'_, SerialServiceState>,
    session_id: String,
) -> Result<AtCommandResult, String> {
    service.modem_hangup(&session_id).await
}

#[tauri::command]
pub async fn serial_get_modem_profiles() -> Result<Vec<ModemProfile>, String> {
    Ok(crate::serial::modem::preset_profiles())
}

// ── Logging ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn serial_start_logging(
    service: State<'_, SerialServiceState>,
    session_id: String,
    config: LogConfig,
) -> Result<(), String> {
    service.start_logging(&session_id, config).await
}

#[tauri::command]
pub async fn serial_stop_logging(
    service: State<'_, SerialServiceState>,
    session_id: String,
) -> Result<(), String> {
    service.stop_logging(&session_id).await
}

// ── Utilities ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn serial_get_baud_rates() -> Result<Vec<u32>, String> {
    Ok(BaudRate::standard_rates())
}

#[tauri::command]
pub async fn serial_hex_to_bytes(hex: String) -> Result<Vec<u8>, String> {
    crate::serial::transport::hex_to_bytes(&hex)
}

#[tauri::command]
pub async fn serial_bytes_to_hex(data: Vec<u8>) -> Result<String, String> {
    Ok(crate::serial::transport::bytes_to_hex(&data))
}
