use super::commander::*;

#[tauri::command]
pub async fn connect_commander(
    state: tauri::State<'_, CommanderServiceState>,
    config: CommanderConnectionConfig,
) -> Result<String, String> {
    let mut commander = state.lock().await;
    commander.connect_commander(config).await
}

#[tauri::command]
pub async fn disconnect_commander(
    state: tauri::State<'_, CommanderServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut commander = state.lock().await;
    commander.disconnect_commander(&session_id).await
}

#[tauri::command]
pub async fn execute_commander_command(
    state: tauri::State<'_, CommanderServiceState>,
    session_id: String,
    command: CommanderCommand,
) -> Result<String, String> {
    let commander = state.lock().await;
    commander
        .execute_commander_command(&session_id, command)
        .await
}

#[tauri::command]
pub async fn get_commander_command_result(
    state: tauri::State<'_, CommanderServiceState>,
    session_id: String,
    command_id: String,
) -> Result<CommanderCommandResult, String> {
    let commander = state.lock().await;
    commander
        .get_commander_command_result(&session_id, &command_id)
        .await
}

#[tauri::command]
pub async fn upload_commander_file(
    state: tauri::State<'_, CommanderServiceState>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<String, String> {
    let commander = state.lock().await;
    commander
        .upload_commander_file(&session_id, local_path, remote_path)
        .await
}

#[tauri::command]
pub async fn download_commander_file(
    state: tauri::State<'_, CommanderServiceState>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<String, String> {
    let commander = state.lock().await;
    commander
        .download_commander_file(&session_id, remote_path, local_path)
        .await
}

#[tauri::command]
pub async fn get_commander_file_transfer(
    state: tauri::State<'_, CommanderServiceState>,
    session_id: String,
    transfer_id: String,
) -> Result<CommanderFileTransfer, String> {
    let commander = state.lock().await;
    commander
        .get_commander_file_transfer(&session_id, &transfer_id)
        .await
}

#[tauri::command]
pub async fn list_commander_directory(
    state: tauri::State<'_, CommanderServiceState>,
    session_id: String,
    path: String,
) -> Result<Vec<serde_json::Value>, String> {
    let commander = state.lock().await;
    commander.list_commander_directory(&session_id, path).await
}

#[tauri::command]
pub async fn get_commander_session(
    state: tauri::State<'_, CommanderServiceState>,
    session_id: String,
) -> Result<CommanderSession, String> {
    let commander = state.lock().await;
    commander
        .get_commander_session(&session_id)
        .await
        .ok_or_else(|| format!("Commander session {} not found", session_id))
}

#[tauri::command]
pub async fn list_commander_sessions(
    state: tauri::State<'_, CommanderServiceState>,
) -> Result<Vec<CommanderSession>, String> {
    let commander = state.lock().await;
    Ok(commander.list_commander_sessions().await)
}

#[tauri::command]
pub async fn update_commander_status(
    state: tauri::State<'_, CommanderServiceState>,
    session_id: String,
    status: CommanderStatus,
) -> Result<(), String> {
    let mut commander = state.lock().await;
    commander.update_commander_status(&session_id, status).await
}

#[tauri::command]
pub async fn get_commander_system_info(
    state: tauri::State<'_, CommanderServiceState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let commander = state.lock().await;
    commander.get_commander_system_info(&session_id).await
}

