// IPsec Tauri command shims.
//
// Threading model (per global rule in `.orchestration/plans/t1.md`):
// - Every command is `async` and returns quickly to the Tauri command thread.
// - Service methods delegated here use `tokio::process::Command` (RAS on
//   Windows, strongSwan `ipsec up/down` on Linux) — non-blocking async I/O.
// - State is guarded by the service-level `tokio::sync::Mutex`.
//
// NOTE: kept as regular `//` because this file is `include!()`ed into
// `src-tauri/src/ipsec_commands.rs`; inner doc (`//!`) is not allowed
// inside a module body.

use super::ipsec::*;
use crate::vpn_lifecycle::{RuntimeVpnType, VpnLeaseKey, VpnLeaseServiceState};

#[tauri::command]
pub async fn create_ipsec_connection(
    name: String,
    config: IPsecConfig,
    state: tauri::State<'_, IPsecServiceState>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.create_connection(name, config).await
}

#[tauri::command]
pub async fn connect_ipsec(
    connection_id: String,
    state: tauri::State<'_, IPsecServiceState>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.connect(&connection_id).await
}

#[tauri::command]
pub async fn disconnect_ipsec(
    connection_id: String,
    state: tauri::State<'_, IPsecServiceState>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::Ipsec,
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
pub async fn get_ipsec_connection(
    connection_id: String,
    state: tauri::State<'_, IPsecServiceState>,
) -> Result<IPsecConnectionView, String> {
    let mut service = state.lock().await;
    Ok(service
        .get_connection(&connection_id)
        .await?
        .into_redacted_view())
}

#[tauri::command]
pub async fn get_ipsec_status(
    connection_id: String,
    state: tauri::State<'_, IPsecServiceState>,
) -> Result<IPsecStatus, String> {
    let mut service = state.lock().await;
    service.get_status(&connection_id).await
}

#[tauri::command]
pub async fn list_ipsec_connections(
    state: tauri::State<'_, IPsecServiceState>,
) -> Result<Vec<IPsecConnectionView>, String> {
    let mut service = state.lock().await;
    Ok(service
        .list_connections()
        .await?
        .into_iter()
        .map(IPsecConnection::into_redacted_view)
        .collect())
}

#[tauri::command]
pub async fn delete_ipsec_connection(
    connection_id: String,
    state: tauri::State<'_, IPsecServiceState>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
) -> Result<(), String> {
    let lease_registry = vpn_lease_state.lock().await;
    lease_registry.ensure_direct_teardown_allowed(
        &VpnLeaseKey {
            vpn_type: RuntimeVpnType::Ipsec,
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
pub async fn update_ipsec_connection(
    connection_id: String,
    name: Option<String>,
    config: Option<IPsecConfig>,
    secret_mutation: Option<IPsecSecretMutation>,
    state: tauri::State<'_, IPsecServiceState>,
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
