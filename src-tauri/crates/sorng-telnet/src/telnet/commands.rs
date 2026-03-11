// Tauri `#[tauri::command]` wrappers for the telnet service.
//
// These are compiled via include!() from the app layer where tauri is available.

use super::service::TelnetServiceState;
use super::types::{TelnetConfig, TelnetSession};

/// Connect to a telnet server.
#[tauri::command]
pub async fn connect_telnet(
    state: tauri::State<'_, TelnetServiceState>,
    config: TelnetConfig,
) -> Result<String, String> {
    state.connect(config).await
}

/// Disconnect a telnet session.
#[tauri::command]
pub async fn disconnect_telnet(
    state: tauri::State<'_, TelnetServiceState>,
    session_id: String,
) -> Result<(), String> {
    state.disconnect(&session_id).await
}

/// Send a text command to a telnet session.
#[tauri::command]
pub async fn send_telnet_command(
    state: tauri::State<'_, TelnetServiceState>,
    session_id: String,
    command: String,
) -> Result<(), String> {
    state.send_command(&session_id, &command).await
}

/// Send raw hex-encoded bytes to a telnet session.
#[tauri::command]
pub async fn send_telnet_raw(
    state: tauri::State<'_, TelnetServiceState>,
    session_id: String,
    hex_data: String,
) -> Result<(), String> {
    state.send_raw(&session_id, &hex_data).await
}

/// Send a BREAK signal to a telnet session.
#[tauri::command]
pub async fn send_telnet_break(
    state: tauri::State<'_, TelnetServiceState>,
    session_id: String,
) -> Result<(), String> {
    state.send_break(&session_id).await
}

/// Send Are-You-There to a telnet session.
#[tauri::command]
pub async fn send_telnet_ayt(
    state: tauri::State<'_, TelnetServiceState>,
    session_id: String,
) -> Result<(), String> {
    state.send_ayt(&session_id).await
}

/// Resize the terminal for a telnet session (sends NAWS sub-negotiation).
#[tauri::command]
pub async fn resize_telnet(
    state: tauri::State<'_, TelnetServiceState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize(&session_id, cols, rows).await
}

/// Get session info for a telnet session.
#[tauri::command]
pub async fn get_telnet_session_info(
    state: tauri::State<'_, TelnetServiceState>,
    session_id: String,
) -> Result<TelnetSession, String> {
    state.get_session_info(&session_id).await
}

/// List all active telnet sessions.
#[tauri::command]
pub async fn list_telnet_sessions(
    state: tauri::State<'_, TelnetServiceState>,
) -> Result<Vec<TelnetSession>, String> {
    Ok(state.list_sessions().await)
}

/// Disconnect all active telnet sessions.
#[tauri::command]
pub async fn disconnect_all_telnet(state: tauri::State<'_, TelnetServiceState>) -> Result<(), String> {
    state.disconnect_all().await
}

/// Check whether a telnet session is still connected.
#[tauri::command]
pub async fn is_telnet_connected(
    state: tauri::State<'_, TelnetServiceState>,
    session_id: String,
) -> Result<bool, String> {
    state.is_connected(&session_id).await
}
