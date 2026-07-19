use super::wireguard::*;
use crate::vpn_lifecycle::{RuntimeVpnType, VpnLeaseKey, VpnLeaseServiceState};

#[tauri::command]
pub async fn create_wireguard_connection(
    name: String,
    config: WireGuardConfig,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<String, String> {
    let mut service = wireguard_service.lock().await;
    service.create_connection(name, config).await
}

/// Import an exact standard WireGuard `.conf` payload. Tauri invokes this as
/// `create_wireguard_connection_from_conf` with `{ name, content }` and returns
/// the newly persisted profile ID as a string.
#[tauri::command]
pub async fn create_wireguard_connection_from_conf(
    name: String,
    content: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<String, String> {
    let mut service = wireguard_service.lock().await;
    service.create_connection_from_conf(name, content).await
}

#[tauri::command]
pub async fn connect_wireguard(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<(), String> {
    let mut service = wireguard_service.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_wireguard(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::WireGuard,
            connection_id: connection_id.clone(),
        },
        "disconnect",
    )?;
    let mut service = wireguard_service.lock().await;
    let result = service.disconnect(&connection_id).await;
    drop(service);
    drop(lease_registry);
    result
}

#[tauri::command]
pub async fn get_wireguard_connection(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<WireGuardConnectionView, String> {
    let mut service = wireguard_service.lock().await;
    service.ensure_persisted_loaded().await?;
    Ok(service
        .get_connection(&connection_id)
        .await?
        .into_redacted_view())
}

#[tauri::command]
pub async fn get_wireguard_status(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<WireGuardStatus, String> {
    let mut service = wireguard_service.lock().await;
    service.ensure_persisted_loaded().await?;
    Ok(service.get_connection(&connection_id).await?.status)
}

#[tauri::command]
pub async fn list_wireguard_connections(
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<Vec<WireGuardConnectionView>, String> {
    let mut service = wireguard_service.lock().await;
    service.ensure_persisted_loaded().await?;
    Ok(service
        .list_connections()
        .await
        .into_iter()
        .map(WireGuardConnection::into_redacted_view)
        .collect())
}

#[tauri::command]
pub async fn delete_wireguard_connection(
    connection_id: String,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::WireGuard,
            connection_id: connection_id.clone(),
        },
        "delete",
    )?;
    let mut service = wireguard_service.lock().await;
    let result = service.delete_connection(&connection_id).await;
    drop(service);
    drop(lease_registry);
    result
}

#[tauri::command]
pub async fn update_wireguard_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<WireGuardConfig>,
    secret_mutation: Option<WireGuardSecretMutation>,
    wireguard_service: tauri::State<'_, WireGuardServiceState>,
) -> Result<(), String> {
    let mut service = wireguard_service.lock().await;
    service
        .update_connection_from_ipc(
            &connection_id,
            name,
            config,
            secret_mutation.unwrap_or_default(),
        )
        .await
}
