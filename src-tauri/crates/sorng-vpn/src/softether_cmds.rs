// Threading model: every command below returns quickly. Service mutations
// acquire the `SoftEtherServiceState` tokio mutex briefly; long-lived
// protocol work runs in the task spawned from `SoftEtherService::connect`
// (see softether.rs). Per the global threading requirement in
// `.orchestration/plans/t1.md`, no VPN protocol I/O runs on the Tauri
// command thread.

use super::softether::*;

#[tauri::command]
pub async fn create_softether_connection(
    name: String,
    config: SoftEtherConfig,
    state: tauri::State<'_, SoftEtherServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_softether(
    connection_id: String,
    state: tauri::State<'_, SoftEtherServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_softether(
    connection_id: String,
    state: tauri::State<'_, SoftEtherServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_softether_connection(
    connection_id: String,
    state: tauri::State<'_, SoftEtherServiceState>,
) -> Result<SoftEtherConnection, String> {
    let service = state.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_softether_connections(
    state: tauri::State<'_, SoftEtherServiceState>,
) -> Result<Vec<SoftEtherConnection>, String> {
    let service = state.lock().await;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_softether_connection(
    connection_id: String,
    state: tauri::State<'_, SoftEtherServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_connection(&connection_id).await
}

#[tauri::command]
pub async fn update_softether_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<SoftEtherConfig>,
    state: tauri::State<'_, SoftEtherServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.update_connection(&connection_id, name, config).await
}
