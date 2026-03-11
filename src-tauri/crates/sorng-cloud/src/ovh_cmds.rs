use super::ovh::*;

#[tauri::command]
pub async fn connect_ovh(
    config: OvhConnectionConfig,
    state: tauri::State<'_, OvhServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_ovh(config).await
}

#[tauri::command]
pub async fn disconnect_ovh(
    session_id: String,
    state: tauri::State<'_, OvhServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_ovh(&session_id).await
}

#[tauri::command]
pub async fn list_ovh_instances(
    session_id: String,
    state: tauri::State<'_, OvhServiceState>,
) -> Result<Vec<OvhInstance>, String> {
    let mut service = state.lock().await;
    service.list_instances(&session_id).await
}

#[tauri::command]
pub async fn get_ovh_session(
    session_id: String,
    state: tauri::State<'_, OvhServiceState>,
) -> Result<OvhSession, String> {
    let service = state.lock().await;
    service
        .get_session(&session_id)
        .await
        .cloned()
        .ok_or("OVH session not found".to_string())
}

#[tauri::command]
pub async fn list_ovh_sessions(
    state: tauri::State<'_, OvhServiceState>,
) -> Result<Vec<OvhSession>, String> {
    let service = state.lock().await;
    Ok(service.get_sessions().into_iter().cloned().collect())
}

