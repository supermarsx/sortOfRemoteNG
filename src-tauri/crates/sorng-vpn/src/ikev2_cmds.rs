// IKEv2 Tauri command shims.
//
// Threading model (per global rule in `.orchestration/plans/t1.md`):
// - Every command is `async` and returns quickly to the Tauri command thread.
// - Service methods delegated here use `tokio::process::Command` (RAS on
//   Windows / strongSwan on Linux) which is non-blocking.
// - No blocking I/O or CPU-bound loops run synchronously on the command
//   thread; protocol state is guarded by the service-level `tokio::sync::Mutex`.
//
// NOTE: kept as regular `//` (not `///` or `//!`) because this file is
// `include!()`ed into the aggregator wrapper module at
// `src-tauri/src/ikev2_commands.rs`, and inner-doc (`//!`) is not allowed
// inside a module body.

use super::ikev2::*;

#[tauri::command]
pub async fn create_ikev2_connection(
    name: String,
    config: IKEv2Config,
    state: tauri::State<'_, IKEv2ServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_ikev2(
    connection_id: String,
    state: tauri::State<'_, IKEv2ServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_ikev2(
    connection_id: String,
    state: tauri::State<'_, IKEv2ServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_ikev2_connection(
    connection_id: String,
    state: tauri::State<'_, IKEv2ServiceState>,
) -> Result<IKEv2Connection, String> {
    let service = state.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_ikev2_connections(
    state: tauri::State<'_, IKEv2ServiceState>,
) -> Result<Vec<IKEv2Connection>, String> {
    let service = state.lock().await;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_ikev2_connection(
    connection_id: String,
    state: tauri::State<'_, IKEv2ServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_connection(&connection_id).await
}

#[tauri::command]
pub async fn update_ikev2_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<IKEv2Config>,
    state: tauri::State<'_, IKEv2ServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.update_connection(&connection_id, name, config).await
}
