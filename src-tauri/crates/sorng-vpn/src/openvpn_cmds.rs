use super::openvpn::*;

#[tauri::command]
pub async fn create_openvpn_connection(
    name: String,
    config: OpenVPNConfig,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_openvpn(
    connection_id: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_openvpn(
    connection_id: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect(&connection_id).await
}

#[tauri::command]
pub async fn get_openvpn_connection(
    connection_id: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<OpenVPNConnection, String> {
    let service = state.lock().await;
    service.get_connection(&connection_id).await
}

#[tauri::command]
pub async fn list_openvpn_connections(
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<Vec<OpenVPNConnection>, String> {
    let service = state.lock().await;
    Ok(service.list_connections().await)
}

#[tauri::command]
pub async fn delete_openvpn_connection(
    connection_id: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.delete_connection(&connection_id).await
}

#[tauri::command]
pub async fn get_openvpn_status(
    connection_id: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<OpenVPNStatus, String> {
    let service = state.lock().await;
    service.get_status(&connection_id).await
}

#[tauri::command]
pub async fn create_openvpn_connection_from_ovpn(
    name: String,
    ovpn_content: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service
        .create_connection_from_ovpn(name, ovpn_content)
        .await
}

#[tauri::command]
pub async fn update_openvpn_connection_auth(
    connection_id: String,
    username: Option<String>,
    password: Option<String>,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service
        .update_connection_auth(&connection_id, username, password)
        .await
}

#[tauri::command]
pub async fn set_openvpn_connection_key_files(
    connection_id: String,
    ca_cert: Option<String>,
    client_cert: Option<String>,
    client_key: Option<String>,
    tls_auth: Option<String>,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service
        .set_connection_key_files(&connection_id, ca_cert, client_cert, client_key, tls_auth)
        .await
}

#[tauri::command]
pub async fn validate_ovpn_config(
    ovpn_content: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<Vec<String>, String> {
    let service = state.lock().await;
    service.validate_ovpn_config(&ovpn_content).await
}

