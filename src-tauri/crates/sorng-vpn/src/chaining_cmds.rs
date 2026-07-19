use super::chaining::*;
use super::vpn_lifecycle::*;

struct TauriVpnRuntime {
    openvpn: super::openvpn::OpenVPNServiceState,
    wireguard: super::wireguard::WireGuardServiceState,
    tailscale: super::tailscale::TailscaleServiceState,
    zerotier: super::zerotier::ZeroTierServiceState,
}

impl VpnRuntime for TauriVpnRuntime {
    async fn is_active(&mut self, key: &VpnLeaseKey) -> bool {
        match key.vpn_type {
            RuntimeVpnType::OpenVpn => {
                self.openvpn
                    .lock()
                    .await
                    .is_connection_active(&key.connection_id)
                    .await
            }
            RuntimeVpnType::WireGuard => {
                self.wireguard
                    .lock()
                    .await
                    .is_connection_active(&key.connection_id)
                    .await
            }
            RuntimeVpnType::Tailscale => {
                self.tailscale
                    .lock()
                    .await
                    .is_connection_active(&key.connection_id)
                    .await
            }
            RuntimeVpnType::ZeroTier => {
                self.zerotier
                    .lock()
                    .await
                    .is_connection_active(&key.connection_id)
                    .await
            }
        }
    }

    async fn connect(&mut self, key: &VpnLeaseKey) -> Result<(), String> {
        match key.vpn_type {
            RuntimeVpnType::OpenVpn => self.openvpn.lock().await.connect(&key.connection_id).await,
            RuntimeVpnType::WireGuard => {
                self.wireguard
                    .lock()
                    .await
                    .connect(&key.connection_id)
                    .await
            }
            RuntimeVpnType::Tailscale => {
                self.tailscale
                    .lock()
                    .await
                    .connect(&key.connection_id)
                    .await
            }
            RuntimeVpnType::ZeroTier => {
                self.zerotier.lock().await.connect(&key.connection_id).await
            }
        }
    }

    async fn disconnect(&mut self, key: &VpnLeaseKey) -> Result<(), String> {
        match key.vpn_type {
            RuntimeVpnType::OpenVpn => {
                self.openvpn
                    .lock()
                    .await
                    .disconnect(&key.connection_id)
                    .await
            }
            RuntimeVpnType::WireGuard => {
                self.wireguard
                    .lock()
                    .await
                    .disconnect(&key.connection_id)
                    .await
            }
            RuntimeVpnType::Tailscale => {
                self.tailscale
                    .lock()
                    .await
                    .disconnect(&key.connection_id)
                    .await
            }
            RuntimeVpnType::ZeroTier => {
                self.zerotier
                    .lock()
                    .await
                    .disconnect(&key.connection_id)
                    .await
            }
        }
    }
}

fn tauri_vpn_runtime(
    openvpn_state: &tauri::State<'_, super::openvpn::OpenVPNServiceState>,
    wireguard_state: &tauri::State<'_, super::wireguard::WireGuardServiceState>,
    tailscale_state: &tauri::State<'_, super::tailscale::TailscaleServiceState>,
    zerotier_state: &tauri::State<'_, super::zerotier::ZeroTierServiceState>,
) -> TauriVpnRuntime {
    TauriVpnRuntime {
        openvpn: openvpn_state.inner().clone(),
        wireguard: wireguard_state.inner().clone(),
        tailscale: tailscale_state.inner().clone(),
        zerotier: zerotier_state.inner().clone(),
    }
}

#[tauri::command]
pub async fn create_connection_chain(
    name: String,
    description: Option<String>,
    layers: Vec<ChainLayer>,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<String, String> {
    let mut service = chaining_service.lock().await;
    service.create_chain(name, description, layers).await
}

#[tauri::command]
pub async fn connect_connection_chain(
    chain_id: String,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<(), String> {
    let mut service = chaining_service.lock().await;
    service.connect_chain(&chain_id).await
}

#[tauri::command]
pub async fn disconnect_connection_chain(
    chain_id: String,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<(), String> {
    let mut service = chaining_service.lock().await;
    service.disconnect_chain(&chain_id).await
}

#[tauri::command]
pub async fn get_connection_chain(
    chain_id: String,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<ConnectionChain, String> {
    let service = chaining_service.lock().await;
    service.get_chain(&chain_id).await
}

#[tauri::command]
pub async fn list_connection_chains(
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<Vec<ConnectionChain>, String> {
    let service = chaining_service.lock().await;
    Ok(service.list_chains().await)
}

#[tauri::command]
pub async fn delete_connection_chain(
    chain_id: String,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<(), String> {
    let mut service = chaining_service.lock().await;
    service.delete_chain(&chain_id).await
}

#[tauri::command]
pub async fn update_connection_chain_layers(
    chain_id: String,
    layers: Vec<ChainLayer>,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<(), String> {
    let mut service = chaining_service.lock().await;
    service.update_chain_layers(&chain_id, layers).await
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EnsureVpnResult {
    pub was_already_connected: bool,
    pub is_now_connected: bool,
    pub vpn_type: String,
    pub connection_id: String,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn ensure_vpn_connected(
    vpn_type: String,
    connection_id: String,
    auto_connect: bool,
    openvpn_state: tauri::State<'_, super::openvpn::OpenVPNServiceState>,
    wireguard_state: tauri::State<'_, super::wireguard::WireGuardServiceState>,
    tailscale_state: tauri::State<'_, super::tailscale::TailscaleServiceState>,
    zerotier_state: tauri::State<'_, super::zerotier::ZeroTierServiceState>,
) -> Result<EnsureVpnResult, String> {
    match vpn_type.as_str() {
        "openvpn" => {
            let mut service = openvpn_state.lock().await;
            let is_active = service.is_connection_active(&connection_id).await;
            if is_active {
                return Ok(EnsureVpnResult {
                    was_already_connected: true,
                    is_now_connected: true,
                    vpn_type,
                    connection_id,
                    error: None,
                });
            }
            if !auto_connect {
                return Ok(EnsureVpnResult {
                    was_already_connected: false,
                    is_now_connected: false,
                    vpn_type,
                    connection_id,
                    error: Some("VPN not connected and auto_connect is false".to_string()),
                });
            }
            match service.connect(&connection_id).await {
                Ok(()) => Ok(EnsureVpnResult {
                    was_already_connected: false,
                    is_now_connected: true,
                    vpn_type,
                    connection_id,
                    error: None,
                }),
                Err(e) => Ok(EnsureVpnResult {
                    was_already_connected: false,
                    is_now_connected: false,
                    vpn_type,
                    connection_id,
                    error: Some(e),
                }),
            }
        }
        "wireguard" => {
            let mut service = wireguard_state.lock().await;
            let is_active = service.is_connection_active(&connection_id).await;
            if is_active {
                return Ok(EnsureVpnResult {
                    was_already_connected: true,
                    is_now_connected: true,
                    vpn_type,
                    connection_id,
                    error: None,
                });
            }
            if !auto_connect {
                return Ok(EnsureVpnResult {
                    was_already_connected: false,
                    is_now_connected: false,
                    vpn_type,
                    connection_id,
                    error: Some("VPN not connected and auto_connect is false".to_string()),
                });
            }
            match service.connect(&connection_id).await {
                Ok(()) => Ok(EnsureVpnResult {
                    was_already_connected: false,
                    is_now_connected: true,
                    vpn_type,
                    connection_id,
                    error: None,
                }),
                Err(e) => Ok(EnsureVpnResult {
                    was_already_connected: false,
                    is_now_connected: false,
                    vpn_type,
                    connection_id,
                    error: Some(e),
                }),
            }
        }
        "tailscale" => {
            let mut service = tailscale_state.lock().await;
            let is_active = service.is_connection_active(&connection_id).await;
            if is_active {
                return Ok(EnsureVpnResult {
                    was_already_connected: true,
                    is_now_connected: true,
                    vpn_type,
                    connection_id,
                    error: None,
                });
            }
            if !auto_connect {
                return Ok(EnsureVpnResult {
                    was_already_connected: false,
                    is_now_connected: false,
                    vpn_type,
                    connection_id,
                    error: Some("VPN not connected and auto_connect is false".to_string()),
                });
            }
            match service.connect(&connection_id).await {
                Ok(()) => Ok(EnsureVpnResult {
                    was_already_connected: false,
                    is_now_connected: true,
                    vpn_type,
                    connection_id,
                    error: None,
                }),
                Err(e) => Ok(EnsureVpnResult {
                    was_already_connected: false,
                    is_now_connected: false,
                    vpn_type,
                    connection_id,
                    error: Some(e),
                }),
            }
        }
        "zerotier" => {
            let mut service = zerotier_state.lock().await;
            let is_active = service.is_connection_active(&connection_id).await;
            if is_active {
                return Ok(EnsureVpnResult {
                    was_already_connected: true,
                    is_now_connected: true,
                    vpn_type,
                    connection_id,
                    error: None,
                });
            }
            if !auto_connect {
                return Ok(EnsureVpnResult {
                    was_already_connected: false,
                    is_now_connected: false,
                    vpn_type,
                    connection_id,
                    error: Some("VPN not connected and auto_connect is false".to_string()),
                });
            }
            match service.connect(&connection_id).await {
                Ok(()) => Ok(EnsureVpnResult {
                    was_already_connected: false,
                    is_now_connected: true,
                    vpn_type,
                    connection_id,
                    error: None,
                }),
                Err(e) => Ok(EnsureVpnResult {
                    was_already_connected: false,
                    is_now_connected: false,
                    vpn_type,
                    connection_id,
                    error: Some(e),
                }),
            }
        }
        other => Err(format!("Unsupported VPN type: {}", other)),
    }
}

/// Atomically acquire every VPN pre-step required by one frontend session.
///
/// The lifecycle-state mutex is deliberately held across provider operations:
/// competing SSH/RDP sessions are serialized, so two first acquirers cannot
/// both start the same machine-wide VPN.  The pure orchestration layer rolls
/// back leases added by this call if a later pre-step fails.
#[tauri::command]
pub async fn acquire_vpn_leases(
    owner_id: String,
    requests: Vec<VpnLeaseRequest>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
    openvpn_state: tauri::State<'_, super::openvpn::OpenVPNServiceState>,
    wireguard_state: tauri::State<'_, super::wireguard::WireGuardServiceState>,
    tailscale_state: tauri::State<'_, super::tailscale::TailscaleServiceState>,
    zerotier_state: tauri::State<'_, super::zerotier::ZeroTierServiceState>,
) -> Result<AcquireVpnLeasesResult, String> {
    let mut registry = vpn_lease_state.lock().await;
    let mut runtime = tauri_vpn_runtime(
        &openvpn_state,
        &wireguard_state,
        &tailscale_state,
        &zerotier_state,
    );
    acquire_session_vpn_leases(&mut registry, &owner_id, requests, &mut runtime).await
}

/// Release every VPN lease held by one frontend session.
///
/// Shared VPNs remain active until their final session releases them.  A VPN
/// that pre-dated the first lease is removed from the registry but left active.
#[tauri::command]
pub async fn release_vpn_leases(
    owner_id: String,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
    openvpn_state: tauri::State<'_, super::openvpn::OpenVPNServiceState>,
    wireguard_state: tauri::State<'_, super::wireguard::WireGuardServiceState>,
    tailscale_state: tauri::State<'_, super::tailscale::TailscaleServiceState>,
    zerotier_state: tauri::State<'_, super::zerotier::ZeroTierServiceState>,
) -> Result<ReleaseVpnLeasesResult, String> {
    let mut registry = vpn_lease_state.lock().await;
    let mut runtime = tauri_vpn_runtime(
        &openvpn_state,
        &wireguard_state,
        &tailscale_state,
        &zerotier_state,
    );
    release_session_vpn_leases(&mut registry, &owner_id, &mut runtime).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_vpn_result_serialization() {
        let result = EnsureVpnResult {
            was_already_connected: true,
            is_now_connected: true,
            vpn_type: "openvpn".to_string(),
            connection_id: "test-id".to_string(),
            error: None,
        };

        let json = serde_json::to_string(&result).unwrap();
        let deserialized: EnsureVpnResult = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.was_already_connected, true);
        assert_eq!(deserialized.is_now_connected, true);
        assert_eq!(deserialized.vpn_type, "openvpn");
        assert_eq!(deserialized.connection_id, "test-id");
        assert!(deserialized.error.is_none());
    }

    #[test]
    fn ensure_vpn_result_with_error() {
        let result = EnsureVpnResult {
            was_already_connected: false,
            is_now_connected: false,
            vpn_type: "wireguard".to_string(),
            connection_id: "wg-1".to_string(),
            error: Some("Connection refused".to_string()),
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("Connection refused"));

        let deserialized: EnsureVpnResult = serde_json::from_str(&json).unwrap();
        assert!(!deserialized.is_now_connected);
        assert_eq!(deserialized.error, Some("Connection refused".to_string()));
    }
}
