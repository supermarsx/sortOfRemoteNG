use super::tailscale::*;

#[tauri::command]
pub async fn create_tailscale_connection(
    name: String,
    config: TailscaleConfig,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<String, String> {
    let mut service = tailscale_service.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_tailscale(
    connection_id: String,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<(), String> {
    let mut service = tailscale_service.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_tailscale(
    connection_id: String,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<(), String> {
    let mut service = tailscale_service.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_tailscale_connection(
    connection_id: String,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<TailscaleConnection, String> {
    let service = tailscale_service.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_tailscale_connections(
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<Vec<TailscaleConnection>, String> {
    let service = tailscale_service.lock().await;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_tailscale_connection(
    connection_id: String,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<(), String> {
    let mut service = tailscale_service.lock().await;
    service.delete_connection(&connection_id).await
}

