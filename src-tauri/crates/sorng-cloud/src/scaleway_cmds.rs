use super::scaleway::*;

#[tauri::command]
pub async fn connect_scaleway(
    config: ScalewayConnectionConfig,
    state: tauri::State<'_, ScalewayServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_scaleway(config).await
}

#[tauri::command]
pub async fn disconnect_scaleway(
    session_id: String,
    state: tauri::State<'_, ScalewayServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_scaleway(&session_id).await
}

#[tauri::command]
pub async fn list_scaleway_instances(
    session_id: String,
    state: tauri::State<'_, ScalewayServiceState>,
) -> Result<Vec<ScalewayInstance>, String> {
    let mut service = state.lock().await;
    service.list_instances(&session_id).await
}

#[tauri::command]
pub async fn get_scaleway_session(
    session_id: String,
    state: tauri::State<'_, ScalewayServiceState>,
) -> Result<ScalewaySessionStatus, String> {
    let service = state.lock().await;
    service
        .get_session(&session_id)
        .await
        .map(ScalewaySessionStatus::from)
        .ok_or("Scaleway session not found".to_string())
}

#[tauri::command]
pub async fn list_scaleway_sessions(
    state: tauri::State<'_, ScalewayServiceState>,
) -> Result<Vec<ScalewaySessionStatus>, String> {
    let service = state.lock().await;
    Ok(service
        .get_sessions()
        .into_iter()
        .map(ScalewaySessionStatus::from)
        .collect())
}

