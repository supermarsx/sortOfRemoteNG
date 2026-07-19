use super::tailscale::*;
use crate::vpn_lifecycle::{RuntimeVpnType, VpnLeaseKey, VpnLeaseServiceState};

#[tauri::command]
pub async fn create_tailscale_connection(
    name: String,
    config: TailscaleConfig,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<String, String> {
    let mut service = tailscale_service.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_tailscale(
    connection_id: String,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<(), String> {
    let mut service = tailscale_service.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_tailscale(
    connection_id: String,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::Tailscale,
            connection_id: connection_id.clone(),
        },
        "disconnect",
    )?;
    let mut service = tailscale_service.lock().await;
    let result = service.disconnect(&connection_id).await;
    drop(service);
    drop(lease_registry);
    result
}

#[tauri::command]
pub async fn get_tailscale_connection(
    connection_id: String,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<TailscaleConnectionView, String> {
    let mut service = tailscale_service.lock().await;
    service.ensure_persisted_loaded().await?;
    Ok(service
        .get_connection(&connection_id)
        .await?
        .into_redacted_view())
}

#[tauri::command]
pub async fn get_tailscale_status(
    connection_id: String,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<TailscaleStatus, String> {
    let mut service = tailscale_service.lock().await;
    service.ensure_persisted_loaded().await?;
    Ok(service.get_connection(&connection_id).await?.status)
}

#[tauri::command]
pub async fn list_tailscale_connections(
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<Vec<TailscaleConnectionView>, String> {
    let mut service = tailscale_service.lock().await;
    service.ensure_persisted_loaded().await?;
    Ok(service
        .list_connections()
        .await
        .into_iter()
        .map(TailscaleConnection::into_redacted_view)
        .collect())
}

#[tauri::command]
pub async fn delete_tailscale_connection(
    connection_id: String,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::Tailscale,
            connection_id: connection_id.clone(),
        },
        "delete",
    )?;
    let mut service = tailscale_service.lock().await;
    let result = service.delete_connection(&connection_id).await;
    drop(service);
    drop(lease_registry);
    result
}

#[tauri::command]
pub async fn update_tailscale_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<TailscaleConfig>,
    secret_mutation: Option<TailscaleSecretMutation>,
    tailscale_service: tauri::State<'_, TailscaleServiceState>,
) -> Result<(), String> {
    let mut service = tailscale_service.lock().await;
    service
        .update_connection_from_ipc(
            &connection_id,
            name,
            config,
            secret_mutation.unwrap_or_default(),
        )
        .await
}
