use super::ibm::*;

#[tauri::command]
pub async fn connect_ibm(
    config: IbmConnectionConfig,
    state: tauri::State<'_, IbmServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_ibm(config).await
}

#[tauri::command]
pub async fn disconnect_ibm(
    session_id: String,
    state: tauri::State<'_, IbmServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_ibm(&session_id).await
}

#[tauri::command]
pub async fn list_ibm_virtual_servers(
    session_id: String,
    state: tauri::State<'_, IbmServiceState>,
) -> Result<Vec<IbmVirtualServer>, String> {
    let mut service = state.lock().await;
    service.list_virtual_servers(&session_id).await
}

#[tauri::command]
pub async fn get_ibm_session(
    session_id: String,
    state: tauri::State<'_, IbmServiceState>,
) -> Result<IbmSession, String> {
    let service = state.lock().await;
    service
        .get_session(&session_id)
        .await
        .cloned()
        .ok_or("IBM Cloud session not found".to_string())
}

#[tauri::command]
pub async fn list_ibm_sessions(
    state: tauri::State<'_, IbmServiceState>,
) -> Result<Vec<IbmSession>, String> {
    let service = state.lock().await;
    Ok(service.get_sessions().into_iter().cloned().collect())
}

