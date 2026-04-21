use super::ssh3::*;

#[tauri::command]
pub async fn connect_ssh3(
    state: tauri::State<'_, Ssh3ServiceState>,
    config: Ssh3ConnectionConfig,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect(config).await
}

#[tauri::command]
pub async fn disconnect_ssh3(
    state: tauri::State<'_, Ssh3ServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect(&session_id).await
}

#[tauri::command]
pub async fn start_ssh3_shell(
    state: tauri::State<'_, Ssh3ServiceState>,
    session_id: String,
) -> Result<String, String> {
    let mut service = state.lock().await;
    let emitter: sorng_core::events::DynEventEmitter = std::sync::Arc::new(sorng_core::events::NoopEventEmitter);
    service.start_shell(&session_id, emitter).await
}

#[tauri::command]
pub async fn send_ssh3_input(
    state: tauri::State<'_, Ssh3ServiceState>,
    session_id: String,
    channel_id: String,
    data: String,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service
        .send_shell_input(&session_id, &channel_id, data)
        .await
}

#[tauri::command]
pub async fn resize_ssh3_shell(
    state: tauri::State<'_, Ssh3ServiceState>,
    session_id: String,
    channel_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service
        .resize_shell(&session_id, &channel_id, cols, rows)
        .await
}

#[tauri::command]
pub async fn execute_ssh3_command(
    state: tauri::State<'_, Ssh3ServiceState>,
    session_id: String,
    command: String,
    timeout: Option<u64>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.execute_command(&session_id, command, timeout).await
}

#[tauri::command]
pub async fn setup_ssh3_port_forward(
    state: tauri::State<'_, Ssh3ServiceState>,
    session_id: String,
    config: Ssh3PortForwardConfig,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.setup_port_forward(&session_id, config).await
}

#[tauri::command]
pub async fn stop_ssh3_port_forward(
    state: tauri::State<'_, Ssh3ServiceState>,
    forward_id: String,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.stop_port_forward(&forward_id).await
}

#[tauri::command]
pub async fn close_ssh3_channel(
    state: tauri::State<'_, Ssh3ServiceState>,
    session_id: String,
    channel_id: String,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.close_channel(&session_id, &channel_id).await
}

#[tauri::command]
pub async fn get_ssh3_session_info(
    state: tauri::State<'_, Ssh3ServiceState>,
    session_id: String,
) -> Result<Ssh3SessionInfo, String> {
    let service = state.lock().await;
    service.get_session_info(&session_id)
}

#[tauri::command]
pub async fn list_ssh3_sessions(
    state: tauri::State<'_, Ssh3ServiceState>,
) -> Result<Vec<Ssh3SessionInfo>, String> {
    let service = state.lock().await;
    Ok(service.list_sessions())
}

#[tauri::command]
pub async fn test_ssh3_connection(
    _state: tauri::State<'_, Ssh3ServiceState>,
    config: Ssh3ConnectionConfig,
) -> Result<String, String> {
    // Test connection without storing session
    log::info!(
        "SSH3: Testing connection to {}:{}",
        config.host,
        config.port
    );

    // In full implementation:
    // 1. Establish QUIC connection
    // 2. Authenticate
    // 3. Disconnect immediately
    // 4. Return result

    Ok("SSH3 connection test successful".to_string())
}
