// L2TP/IPsec Tauri command shims.
//
// Threading model (per global rule in `.orchestration/plans/t1.md`):
// - Every command is `async` and returns quickly to the Tauri command thread.
// - Service methods use `tokio::process::Command` (RAS on Windows, strongSwan
//   + xl2tpd on Linux). xl2tpd runs as a detached child process.
// - State is guarded by the service-level `tokio::sync::Mutex`.
//
// NOTE: kept as regular `//` — file is `include!()`ed into
// `src-tauri/src/l2tp_commands.rs`; inner doc (`//!`) not allowed inside
// a module body.

use super::l2tp::*;

#[tauri::command]
pub async fn create_l2tp_connection(
    name: String,
    config: L2TPConfig,
    state: tauri::State<'_, L2TPServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_l2tp(
    connection_id: String,
    state: tauri::State<'_, L2TPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_l2tp(
    connection_id: String,
    state: tauri::State<'_, L2TPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_l2tp_connection(
    connection_id: String,
    state: tauri::State<'_, L2TPServiceState>,
) -> Result<L2TPConnection, String> {
    let service = state.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_l2tp_connections(
    state: tauri::State<'_, L2TPServiceState>,
) -> Result<Vec<L2TPConnection>, String> {
    let service = state.lock().await;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_l2tp_connection(
    connection_id: String,
    state: tauri::State<'_, L2TPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_connection(&connection_id).await
}

#[tauri::command]
pub async fn update_l2tp_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<L2TPConfig>,
    state: tauri::State<'_, L2TPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.update_connection(&connection_id, name, config).await
}
