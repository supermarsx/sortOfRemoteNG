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
    let service = wireguard_service.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_wireguard_connections(
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<Vec<WireGuardConnection>, String> {
    let service = wireguard_service.lock().await;
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

