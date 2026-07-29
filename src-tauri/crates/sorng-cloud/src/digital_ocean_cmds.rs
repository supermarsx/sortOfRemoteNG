use super::digital_ocean::*;

#[tauri::command]
pub async fn connect_digital_ocean(
    config: DigitalOceanConnectionConfig,
    state: tauri::State<'_, DigitalOceanServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_digital_ocean(config).await
}

#[tauri::command]
pub async fn disconnect_digital_ocean(
    session_id: String,
    state: tauri::State<'_, DigitalOceanServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_digital_ocean(&session_id).await
}

#[tauri::command]
pub async fn list_digital_ocean_droplets(
    session_id: String,
    state: tauri::State<'_, DigitalOceanServiceState>,
) -> Result<Vec<DigitalOceanDroplet>, String> {
    let mut service = state.lock().await;
    service.list_droplets(&session_id).await
}

#[tauri::command]
pub async fn get_digital_ocean_session(
    session_id: String,
    state: tauri::State<'_, DigitalOceanServiceState>,
) -> Result<DigitalOceanSessionStatus, String> {
    let service = state.lock().await;
    service
        .get_session(&session_id)
        .await
        .map(DigitalOceanSessionStatus::from)
        .ok_or("DigitalOcean session not found".to_string())
}

#[tauri::command]
pub async fn list_digital_ocean_sessions(
    state: tauri::State<'_, DigitalOceanServiceState>,
) -> Result<Vec<DigitalOceanSessionStatus>, String> {
    let service = state.lock().await;
    Ok(service
        .get_sessions()
        .into_iter()
        .map(DigitalOceanSessionStatus::from)
        .collect())
}

