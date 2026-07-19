use super::zerotier::*;
use crate::vpn_lifecycle::{RuntimeVpnType, VpnLeaseKey, VpnLeaseServiceState};

#[tauri::command]
pub async fn create_zerotier_connection(
    name: String,
    config: ZeroTierConfig,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<String, String> {
    let mut service = zerotier_service.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_zerotier(
    connection_id: String,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<(), String> {
    let mut service = zerotier_service.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_zerotier(
    connection_id: String,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::ZeroTier,
            connection_id: connection_id.clone(),
        },
        "disconnect",
    )?;
    let mut service = zerotier_service.lock().await;
    let result = service.disconnect(&connection_id).await;
    drop(service);
    drop(lease_registry);
    result
}

#[tauri::command]
pub async fn get_zerotier_connection(
    connection_id: String,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<ZeroTierConnectionView, String> {
    let mut service = zerotier_service.lock().await;
    service.ensure_persisted_loaded().await?;
    Ok(service
        .get_connection(&connection_id)
        .await?
        .into_redacted_view())
}

#[tauri::command]
pub async fn get_zerotier_status(
    connection_id: String,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<ZeroTierStatus, String> {
    let mut service = zerotier_service.lock().await;
    service.ensure_persisted_loaded().await?;
    Ok(service.get_connection(&connection_id).await?.status)
}

#[tauri::command]
pub async fn list_zerotier_connections(
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<Vec<ZeroTierConnectionView>, String> {
    let mut service = zerotier_service.lock().await;
    service.ensure_persisted_loaded().await?;
    Ok(service
        .list_connections()
        .await
        .into_iter()
        .map(ZeroTierConnection::into_redacted_view)
        .collect())
}

#[tauri::command]
pub async fn delete_zerotier_connection(
    connection_id: String,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::ZeroTier,
            connection_id: connection_id.clone(),
        },
        "delete",
    )?;
    let mut service = zerotier_service.lock().await;
    let result = service.delete_connection(&connection_id).await;
    drop(service);
    drop(lease_registry);
    result
}

#[tauri::command]
pub async fn update_zerotier_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<ZeroTierConfig>,
    secret_mutation: Option<ZeroTierSecretMutation>,
    zerotier_service: tauri::State<'_, ZeroTierServiceState>,
) -> Result<(), String> {
    let mut service = zerotier_service.lock().await;
    service
        .update_connection_from_ipc(
            &connection_id,
            name,
            config,
            secret_mutation.unwrap_or_default(),
        )
        .await
}
