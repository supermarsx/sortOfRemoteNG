use super::openvpn::*;
use crate::vpn_lifecycle::{RuntimeVpnType, VpnLeaseKey, VpnLeaseServiceState};

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
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::OpenVpn,
            connection_id: connection_id.clone(),
        },
        "disconnect",
    )?;
    let mut service = state.lock().await;
    let result = service.disconnect(&connection_id).await;
    drop(service);
    drop(lease_registry);
    result
}

#[tauri::command]
pub async fn get_openvpn_connection(
    connection_id: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<OpenVPNConnectionView, String> {
    let mut service = state.lock().await;
    Ok(service
        .get_connection(&connection_id)
        .await?
        .into_redacted_view())
}

#[tauri::command]
pub async fn list_openvpn_connections(
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<Vec<OpenVPNConnectionView>, String> {
    let mut service = state.lock().await;
    Ok(service
        .list_connections()
        .await?
        .into_iter()
        .map(OpenVPNConnection::into_redacted_view)
        .collect())
}

#[tauri::command]
pub async fn delete_openvpn_connection(
    connection_id: String,
    state: tauri::State<'_, OpenVPNServiceState>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::OpenVpn,
            connection_id: connection_id.clone(),
        },
        "delete",
    )?;
    let mut service = state.lock().await;
    let result = service.delete_connection(&connection_id).await;
    drop(service);
    drop(lease_registry);
    result
}

#[tauri::command]
pub async fn get_openvpn_status(
    connection_id: String,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<OpenVPNStatus, String> {
    let mut service = state.lock().await;
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
pub async fn update_openvpn_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<OpenVPNConfig>,
    secret_mutation: Option<OpenVPNSecretMutation>,
    state: tauri::State<'_, OpenVPNServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service
        .update_connection_from_ipc(
            &connection_id,
            name,
            config,
            secret_mutation.unwrap_or_default(),
        )
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
