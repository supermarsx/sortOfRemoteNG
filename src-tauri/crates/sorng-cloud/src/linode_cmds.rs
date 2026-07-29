use super::linode::*;

#[tauri::command]
pub async fn connect_linode(
    config: LinodeConnectionConfig,
    state: tauri::State<'_, LinodeServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_linode(config).await
}

#[tauri::command]
pub async fn disconnect_linode(
    session_id: String,
    state: tauri::State<'_, LinodeServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_linode(&session_id).await
}

#[tauri::command]
pub async fn list_linode_instances(
    session_id: String,
    state: tauri::State<'_, LinodeServiceState>,
) -> Result<Vec<LinodeInstance>, String> {
    let mut service = state.lock().await;
    service.list_linodes(&session_id).await
}

#[tauri::command]
pub async fn get_linode_session(
    session_id: String,
    state: tauri::State<'_, LinodeServiceState>,
) -> Result<LinodeSessionStatus, String> {
    let service = state.lock().await;
    service
        .get_session(&session_id)
        .await
        .map(LinodeSessionStatus::from)
        .ok_or("Linode session not found".to_string())
}

#[tauri::command]
pub async fn list_linode_sessions(
    state: tauri::State<'_, LinodeServiceState>,
) -> Result<Vec<LinodeSessionStatus>, String> {
    let service = state.lock().await;
    Ok(service
        .get_sessions()
        .into_iter()
        .map(LinodeSessionStatus::from)
        .collect())
}

