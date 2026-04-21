// IPsec Tauri command shims.
//
// Threading model (per global rule in `.orchestration/plans/t1.md`):
// - Every command is `async` and returns quickly to the Tauri command thread.
// - Service methods delegated here use `tokio::process::Command` (RAS on
//   Windows, strongSwan `ipsec up/down` on Linux) — non-blocking async I/O.
// - State is guarded by the service-level `tokio::sync::Mutex`.
//
// NOTE: kept as regular `//` because this file is `include!()`ed into
// `src-tauri/src/ipsec_commands.rs`; inner doc (`//!`) is not allowed
// inside a module body.

use super::ipsec::*;

#[tauri::command]
pub async fn create_ipsec_connection(
    name: String,
    config: IPsecConfig,
    state: tauri::State<'_, IPsecServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_ipsec(
    connection_id: String,
    state: tauri::State<'_, IPsecServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_ipsec(
    connection_id: String,
    state: tauri::State<'_, IPsecServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_ipsec_connection(
    connection_id: String,
    state: tauri::State<'_, IPsecServiceState>,
) -> Result<IPsecConnection, String> {
    let service = state.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_ipsec_connections(
    state: tauri::State<'_, IPsecServiceState>,
) -> Result<Vec<IPsecConnection>, String> {
    let service = state.lock().await;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_ipsec_connection(
    connection_id: String,
    state: tauri::State<'_, IPsecServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_connection(&connection_id).await
}

#[tauri::command]
pub async fn update_ipsec_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<IPsecConfig>,
    state: tauri::State<'_, IPsecServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.update_connection(&connection_id, name, config).await
}
