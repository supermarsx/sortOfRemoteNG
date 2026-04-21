// SSTP Tauri command shims.
//
// Threading model (per global rule in `.orchestration/plans/t1.md`):
// - Every command is `async` and returns quickly to the Tauri command thread.
// - Service methods use `tokio::process::Command` (RAS on Windows, `sstpc` on
//   Linux). Long-lived tunnel processes run as spawned children, not inline.
// - State is guarded by the service-level `tokio::sync::Mutex`.
//
// NOTE: kept as regular `//` — file is `include!()`ed into
// `src-tauri/src/sstp_commands.rs`; inner doc (`//!`) not allowed.

use super::sstp::*;

#[tauri::command]
pub async fn create_sstp_connection(
    name: String,
    config: SSTPConfig,
    state: tauri::State<'_, SSTPServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_sstp(
    connection_id: String,
    state: tauri::State<'_, SSTPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_sstp(
    connection_id: String,
    state: tauri::State<'_, SSTPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_sstp_connection(
    connection_id: String,
    state: tauri::State<'_, SSTPServiceState>,
) -> Result<SSTPConnection, String> {
    let service = state.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_sstp_connections(
    state: tauri::State<'_, SSTPServiceState>,
) -> Result<Vec<SSTPConnection>, String> {
    let service = state.lock().await;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_sstp_connection(
    connection_id: String,
    state: tauri::State<'_, SSTPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_connection(&connection_id).await
}

#[tauri::command]
pub async fn update_sstp_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<SSTPConfig>,
    state: tauri::State<'_, SSTPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.update_connection(&connection_id, name, config).await
}
