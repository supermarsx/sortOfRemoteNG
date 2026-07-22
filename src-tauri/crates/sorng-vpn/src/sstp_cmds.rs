// SSTP Tauri command shims.
//
// Threading model (per global rule in `.orchestration/plans/t1.md`):
// - Every command is `async` and returns quickly to the Tauri command thread.
// - Service methods use native RAS on Windows. Other platforms fail closed
//   until credentials and PPP readiness can be handled without exposure.
// - State is guarded by the service-level `tokio::sync::Mutex`.
//
// NOTE: kept as regular `//` — file is `include!()`ed into
// `src-tauri/src/sstp_commands.rs`; inner doc (`//!`) not allowed.

use super::sstp::*;
use crate::vpn_lifecycle::{RuntimeVpnType, VpnLeaseKey, VpnLeaseServiceState};

#[tauri::command]
pub async fn create_sstp_connection(
    name: String,
    config: SSTPConfig,
    state: tauri::State<'_, SSTPServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_sstp(
    connection_id: String,
    state: tauri::State<'_, SSTPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_sstp(
    connection_id: String,
    state: tauri::State<'_, SSTPServiceState>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::Sstp,
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
pub async fn get_sstp_connection(
    connection_id: String,
    state: tauri::State<'_, SSTPServiceState>,
) -> Result<SSTPConnectionView, String> {
    let mut service = state.lock().await;
    Ok(service
        .get_connection(&connection_id)
        .await?
        .into_redacted_view())
}

#[tauri::command]
pub async fn get_sstp_status(
    connection_id: String,
    state: tauri::State<'_, SSTPServiceState>,
) -> Result<SSTPStatus, String> {
    let mut service = state.lock().await;
    service.get_status(&connection_id).await
}

#[tauri::command]
pub async fn list_sstp_connections(
    state: tauri::State<'_, SSTPServiceState>,
) -> Result<Vec<SSTPConnectionView>, String> {
    let mut service = state.lock().await;
    Ok(service
        .list_connections()
        .await?
        .into_iter()
        .map(SSTPConnection::into_redacted_view)
        .collect())
}

#[tauri::command]
pub async fn delete_sstp_connection(
    connection_id: String,
    state: tauri::State<'_, SSTPServiceState>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::Sstp,
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
pub async fn update_sstp_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<SSTPConfig>,
    secret_mutation: Option<SSTPSecretMutation>,
    state: tauri::State<'_, SSTPServiceState>,
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
