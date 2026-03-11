use super::raw_socket::*;

#[tauri::command]
pub async fn connect_raw_socket(
    host: String,
    port: u16,
    protocol: String,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_raw_socket(host, port, protocol).await
}

#[tauri::command]
pub async fn disconnect_raw_socket(
    session_id: String,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_raw_socket(&session_id).await
}

#[tauri::command]
pub async fn send_raw_socket_data(
    session_id: String,
    data: Vec<u8>,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.send_raw_socket_data(&session_id, data).await
}

#[tauri::command]
pub async fn get_raw_socket_session_info(
    session_id: String,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<RawSocketSession, String> {
    let service = state.lock().await;
    service.get_raw_socket_session_info(&session_id).await
}

#[tauri::command]
pub async fn list_raw_socket_sessions(
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<Vec<RawSocketSession>, String> {
    let service = state.lock().await;
    Ok(service.list_raw_socket_sessions().await)
}

