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
) -> Result<LinodeSession, String> {
    let service = state.lock().await;
    service
        .get_session(&session_id)
        .await
        .cloned()
        .ok_or("Linode session not found".to_string())
}

#[tauri::command]
pub async fn list_linode_sessions(
    state: tauri::State<'_, LinodeServiceState>,
) -> Result<Vec<LinodeSession>, String> {
    let service = state.lock().await;
    Ok(service.get_sessions().into_iter().cloned().collect())
}

