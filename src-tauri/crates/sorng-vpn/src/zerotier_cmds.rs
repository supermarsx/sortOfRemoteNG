use super::zerotier::*;

#[tauri::command]
pub async fn create_zerotier_connection(
    name: String,
    config: ZeroTierConfig,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<String, String> {
    let mut service = zerotier_service.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_zerotier(
    connection_id: String,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<(), String> {
    let mut service = zerotier_service.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_zerotier(
    connection_id: String,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<(), String> {
    let mut service = zerotier_service.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_zerotier_connection(
    connection_id: String,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<ZeroTierConnection, String> {
    let service = zerotier_service.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_zerotier_connections(
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<Vec<ZeroTierConnection>, String> {
    let service = zerotier_service.lock().await;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_zerotier_connection(
    connection_id: String,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<(), String> {
    let mut service = zerotier_service.lock().await;
    service.delete_connection(&connection_id).await
}

#[tauri::command]
pub async fn update_zerotier_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<ZeroTierConfig>,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<(), String> {
    let mut service = zerotier_service.lock().await;
    service.update_connection(&connection_id, name, config).await
}

