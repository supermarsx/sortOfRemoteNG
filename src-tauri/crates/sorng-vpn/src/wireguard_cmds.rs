use super::wireguard::*;

#[tauri::command]
pub async fn create_wireguard_connection(
    name: String,
    config: WireGuardConfig,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<String, String> {
    let mut service = wireguard_service.lock().await;
    service.create_connection(name, config).await
}

/// Import an exact standard WireGuard `.conf` payload. Tauri invokes this as
/// `create_wireguard_connection_from_conf` with `{ name, content }` and returns
/// the newly persisted profile ID as a string.
#[tauri::command]
pub async fn create_wireguard_connection_from_conf(
    name: String,
    content: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<String, String> {
    let mut service = wireguard_service.lock().await;
    service.create_connection_from_conf(name, content).await
}

#[tauri::command]
pub async fn connect_wireguard(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<(), String> {
    let mut service = wireguard_service.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_wireguard(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<(), String> {
    let mut service = wireguard_service.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_wireguard_connection(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<WireGuardConnection, String> {
    let mut service = wireguard_service.lock().await;
    service.ensure_persisted_loaded().await?;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn get_wireguard_status(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<WireGuardStatus, String> {
    let mut service = wireguard_service.lock().await;
    service.ensure_persisted_loaded().await?;
    Ok(service.get_connection(&connection_id).await?.status)
}

#[tauri::command]
pub async fn list_wireguard_connections(
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<Vec<WireGuardConnection>, String> {
    let mut service = wireguard_service.lock().await;
    service.ensure_persisted_loaded().await?;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_wireguard_connection(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<(), String> {
    let mut service = wireguard_service.lock().await;
    service.delete_connection(&connection_id).await
}

#[tauri::command]
pub async fn update_wireguard_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<WireGuardConfig>,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<(), String> {
    let mut service = wireguard_service.lock().await;
    service
        .update_connection(&connection_id, name, config)
        .await
}
