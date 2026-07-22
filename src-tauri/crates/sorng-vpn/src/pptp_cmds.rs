// PPTP Tauri command shims.
//
// Threading model (per global rule in `.orchestration/plans/t1.md`):
// - Every command is `async` and returns quickly to the Tauri command thread.
// - Service methods use native RAS on Windows. Other platforms fail closed
//   until the backend owns and verifies a complete PPP data plane.
// - State is guarded by the service-level `tokio::sync::Mutex`.
//
// NOTE: kept as regular `//` — file is `include!()`ed into
// `src-tauri/src/pptp_commands.rs`; inner doc (`//!`) not allowed.

use super::pptp::*;
use crate::vpn_lifecycle::{RuntimeVpnType, VpnLeaseKey, VpnLeaseServiceState};

#[tauri::command]
pub async fn create_pptp_connection(
    name: String,
    config: PPTPConfig,
    state: tauri::State<'_, PPTPServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_pptp(
    connection_id: String,
    state: tauri::State<'_, PPTPServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_pptp(
    connection_id: String,
    state: tauri::State<'_, PPTPServiceState>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::Pptp,
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
pub async fn get_pptp_connection(
    connection_id: String,
    state: tauri::State<'_, PPTPServiceState>,
) -> Result<PPTPConnectionView, String> {
    let mut service = state.lock().await;
    Ok(service
        .get_connection(&connection_id)
        .await?
        .into_redacted_view())
}

#[tauri::command]
pub async fn get_pptp_status(
    connection_id: String,
    state: tauri::State<'_, PPTPServiceState>,
) -> Result<PPTPStatus, String> {
    let mut service = state.lock().await;
    service.get_status(&connection_id).await
}

#[tauri::command]
pub async fn list_pptp_connections(
    state: tauri::State<'_, PPTPServiceState>,
) -> Result<Vec<PPTPConnectionView>, String> {
    let mut service = state.lock().await;
    Ok(service
        .list_connections()
        .await?
        .into_iter()
        .map(PPTPConnection::into_redacted_view)
        .collect())
}

#[tauri::command]
pub async fn delete_pptp_connection(
    connection_id: String,
    state: tauri::State<'_, PPTPServiceState>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::Pptp,
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
pub async fn update_pptp_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<PPTPConfig>,
    secret_mutation: Option<PPTPSecretMutation>,
    state: tauri::State<'_, PPTPServiceState>,
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
