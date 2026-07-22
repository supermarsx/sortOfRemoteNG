// L2TP/IPsec Tauri command shims.
//
// Threading model (per global rule in `.orchestration/plans/t1.md`):
// - Every command is `async` and returns quickly to the Tauri command thread.
// - Service methods use native RAS on Windows. Other platforms fail closed
//   until an isolated strongSwan + xl2tpd/pppd data plane is available.
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
) -> Result<L2TPConnectionView, String> {
    let service = state.lock().await;
    Ok(service
        .get_connection(&connection_id)
        .await?
        .into_redacted_view())
}

#[tauri::command]
pub async fn get_l2tp_status(
    connection_id: String,
    state: tauri::State<'_, L2TPServiceState>,
) -> Result<L2TPStatus, String> {
    let service = state.lock().await;
    service.get_status(&connection_id).await
}

#[tauri::command]
pub async fn list_l2tp_connections(
    state: tauri::State<'_, L2TPServiceState>,
) -> Result<Vec<L2TPConnectionView>, String> {
    let service = state.lock().await;
    Ok(service
        .list_connections()
        .await
        .into_iter()
        .map(L2TPConnection::into_redacted_view)
        .collect())
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
    secret_mutation: Option<L2TPSecretMutation>,
    state: tauri::State<'_, L2TPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service
        .update_connection_from_ipc(
            &connection_id,
            name,
            config,
            secret_mutation.unwrap_or_default(),
        )
        .await
}
