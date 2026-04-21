// PPTP Tauri command shims.
//
// Threading model (per global rule in `.orchestration/plans/t1.md`):
// - Every command is `async` and returns quickly to the Tauri command thread.
// - Service methods use `tokio::process::Command` (RAS on Windows, `pptp` on
//   Linux). The pptp client is spawned as a detached child process.
// - State is guarded by the service-level `tokio::sync::Mutex`.
//
// NOTE: kept as regular `//` — file is `include!()`ed into
// `src-tauri/src/pptp_commands.rs`; inner doc (`//!`) not allowed.

use super::pptp::*;

#[tauri::command]
pub async fn create_pptp_connection(
    name: String,
    config: PPTPConfig,
    state: tauri::State<'_, PPTPServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_pptp(
    connection_id: String,
    state: tauri::State<'_, PPTPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_pptp(
    connection_id: String,
    state: tauri::State<'_, PPTPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_pptp_connection(
    connection_id: String,
    state: tauri::State<'_, PPTPServiceState>,
) -> Result<PPTPConnection, String> {
    let service = state.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_pptp_connections(
    state: tauri::State<'_, PPTPServiceState>,
) -> Result<Vec<PPTPConnection>, String> {
    let service = state.lock().await;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_pptp_connection(
    connection_id: String,
    state: tauri::State<'_, PPTPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_connection(&connection_id).await
}

#[tauri::command]
pub async fn update_pptp_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<PPTPConfig>,
    state: tauri::State<'_, PPTPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.update_connection(&connection_id, name, config).await
}
