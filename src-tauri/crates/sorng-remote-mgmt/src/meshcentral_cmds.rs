use super::meshcentral::*;

#[tauri::command]
pub async fn connect_meshcentral(
    state: tauri::State<'_, MeshCentralServiceState>,
    config: MeshCentralConnectionConfig,
) -> Result<String, String> {
    let mut meshcentral = state.lock().await;
    meshcentral.connect_meshcentral(config).await
}

#[tauri::command]
pub async fn disconnect_meshcentral(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut meshcentral = state.lock().await;
    meshcentral.disconnect_meshcentral(&session_id).await
}

#[tauri::command]
pub async fn get_meshcentral_devices(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<Vec<MeshCentralDevice>, String> {
    let meshcentral = state.lock().await;
    meshcentral.get_meshcentral_devices(&session_id).await
}

#[tauri::command]
pub async fn get_meshcentral_groups(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<Vec<MeshCentralGroup>, String> {
    let meshcentral = state.lock().await;
    meshcentral.get_meshcentral_groups(&session_id).await
}

#[tauri::command]
pub async fn execute_meshcentral_command(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    command: MeshCentralCommand,
) -> Result<String, String> {
    let meshcentral = state.lock().await;
    meshcentral
        .execute_meshcentral_command(&session_id, command)
        .await
}

#[tauri::command]
pub async fn get_meshcentral_command_result(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
    command_id: String,
) -> Result<MeshCentralCommandResult, String> {
    let meshcentral = state.lock().await;
    meshcentral
        .get_meshcentral_command_result(&session_id, &command_id)
        .await
}

#[tauri::command]
pub async fn get_meshcentral_session(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<MeshCentralSession, String> {
    let meshcentral = state.lock().await;
    meshcentral
        .get_meshcentral_session(&session_id)
        .await
        .ok_or_else(|| format!("MeshCentral session {} not found", session_id))
}

#[tauri::command]
pub async fn list_meshcentral_sessions(
    state: tauri::State<'_, MeshCentralServiceState>,
) -> Result<Vec<MeshCentralSession>, String> {
    let meshcentral = state.lock().await;
    Ok(meshcentral.list_meshcentral_sessions().await)
}

#[tauri::command]
pub async fn get_meshcentral_server_info(
    state: tauri::State<'_, MeshCentralServiceState>,
    session_id: String,
) -> Result<MeshCentralServerInfo, String> {
    let meshcentral = state.lock().await;
    meshcentral.get_meshcentral_server_info(&session_id).await
}

