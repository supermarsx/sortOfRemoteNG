use super::rlogin::*;

#[tauri::command]
pub async fn connect_rlogin(
    host: String,
    port: u16,
    local_username: String,
    remote_username: String,
    terminal_type: String,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service
        .connect_rlogin(host, port, local_username, remote_username, terminal_type)
        .await
}

#[tauri::command]
pub async fn disconnect_rlogin(
    session_id: String,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_rlogin(&session_id).await
}

#[tauri::command]
pub async fn send_rlogin_command(
    session_id: String,
    command: String,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.send_rlogin_command(&session_id, command).await
}

#[tauri::command]
pub async fn get_rlogin_session_info(
    session_id: String,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<RloginSession, String> {
    let service = state.lock().await;
    service.get_rlogin_session_info(&session_id).await
}

#[tauri::command]
pub async fn list_rlogin_sessions(
    state: tauri::State<'_, RloginServiceState>,
) -> Result<Vec<RloginSession>, String> {
    let service = state.lock().await;
    Ok(service.list_rlogin_sessions().await)
}

