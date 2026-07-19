use super::chaining::*;
use super::vpn_lifecycle::*;
use std::collections::BTreeSet;

struct TauriVpnRuntime {
    openvpn: super::openvpn::OpenVPNServiceState,
    wireguard: super::wireguard::WireGuardServiceState,
    tailscale: super::tailscale::TailscaleServiceState,
    zerotier: super::zerotier::ZeroTierServiceState,
}

impl VpnRuntime for TauriVpnRuntime {
    async fn probe_active(&mut self, key: &VpnLeaseKey) -> Result<bool, String> {
        match key.vpn_type {
            RuntimeVpnType::OpenVpn => {
                self.openvpn
                    .lock()
                    .await
                    .probe_connection_active(&key.connection_id)
                    .await
            }
            RuntimeVpnType::WireGuard => {
                self.wireguard
                    .lock()
                    .await
                    .probe_connection_active(&key.connection_id)
                    .await
            }
            RuntimeVpnType::Tailscale => {
                self.tailscale
                    .lock()
                    .await
                    .probe_connection_active(&key.connection_id)
                    .await
            }
            RuntimeVpnType::ZeroTier => {
                self.zerotier
                    .lock()
                    .await
                    .probe_connection_active(&key.connection_id)
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

fn connection_chain_vpn_lease_keys(chain: &ConnectionChain) -> Vec<VpnLeaseKey> {
    chain
        .layers
        .iter()
        .filter_map(|layer| {
            let vpn_type = match layer.connection_type {
                ConnectionType::OpenVPN => RuntimeVpnType::OpenVpn,
                ConnectionType::WireGuard => RuntimeVpnType::WireGuard,
                ConnectionType::ZeroTier => RuntimeVpnType::ZeroTier,
                ConnectionType::Tailscale => RuntimeVpnType::Tailscale,
                _ => return None,
            };
            Some(VpnLeaseKey {
                vpn_type,
                connection_id: layer.connection_id.trim().to_string(),
            })
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn ensure_connection_chain_teardown_allowed(
    registry: &VpnLeaseRegistry,
    chain: &ConnectionChain,
    action: &str,
) -> Result<(), String> {
    for key in connection_chain_vpn_lease_keys(chain) {
        registry.ensure_direct_teardown_allowed(&key, action)?;
    }
    Ok(())
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
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<(), String> {
    // Keep the shared lifecycle mutex through preflight and every provider
    // teardown. A concurrent session acquire therefore cannot slip between
    // the lease check and the machine-wide disconnect.
    let registry = vpn_lease_state.lock().await;
    let mut service = chaining_service.lock().await;
    let chain = service.get_chain(&chain_id).await?;
    ensure_connection_chain_teardown_allowed(&registry, &chain, "disconnect")?;
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
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
    chaining_service: tauri::State<'_, ChainingServiceState>,
) -> Result<(), String> {
    let registry = vpn_lease_state.lock().await;
    let mut service = chaining_service.lock().await;
    // Preserve the historical idempotent delete of a missing chain. Existing
    // chains are guarded even when currently marked disconnected, because a
    // stale/error chain can still retain provider runtime state.
    if let Ok(chain) = service.get_chain(&chain_id).await {
        ensure_connection_chain_teardown_allowed(&registry, &chain, "delete")?;
    }
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
            let is_active = service.probe_connection_active(&connection_id).await?;
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
            let is_active = service.probe_connection_active(&connection_id).await?;
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
            let is_active = service.probe_connection_active(&connection_id).await?;
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
            let is_active = service.probe_connection_active(&connection_id).await?;
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
    use chrono::Utc;
    use std::collections::HashSet;
    use std::sync::Arc;

    #[derive(Default)]
    struct GuardMockRuntime {
        active: HashSet<VpnLeaseKey>,
    }

    impl VpnRuntime for GuardMockRuntime {
        async fn probe_active(&mut self, key: &VpnLeaseKey) -> Result<bool, String> {
            Ok(self.active.contains(key))
        }

        async fn connect(&mut self, key: &VpnLeaseKey) -> Result<(), String> {
            self.active.insert(key.clone());
            Ok(())
        }

        async fn disconnect(&mut self, key: &VpnLeaseKey) -> Result<(), String> {
            self.active.remove(key);
            Ok(())
        }
    }

    fn test_layer(
        connection_type: ConnectionType,
        connection_id: &str,
        position: usize,
    ) -> ChainLayer {
        ChainLayer {
            id: format!("layer-{position}"),
            connection_type,
            connection_id: connection_id.to_string(),
            position,
            status: ChainLayerStatus::Connected,
            local_port: None,
            error: None,
        }
    }

    fn test_chain(layers: Vec<ChainLayer>) -> ConnectionChain {
        ConnectionChain {
            id: "chain-test".to_string(),
            name: "Test chain".to_string(),
            description: None,
            layers,
            status: ChainStatus::Connected,
            created_at: Utc::now(),
            connected_at: Some(Utc::now()),
            final_local_port: None,
            error: None,
        }
    }

    fn request(vpn_type: &str, connection_id: &str) -> VpnLeaseRequest {
        VpnLeaseRequest {
            vpn_type: vpn_type.to_string(),
            connection_id: connection_id.to_string(),
            auto_connect: true,
        }
    }

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

    #[tokio::test]
    async fn connection_chain_disconnect_rejects_a_session_leased_vpn() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = GuardMockRuntime::default();
        acquire_session_vpn_leases(
            &mut registry,
            "secret-session-owner",
            vec![request("openvpn", "corp")],
            &mut runtime,
        )
        .await
        .unwrap();
        let chain = test_chain(vec![test_layer(ConnectionType::OpenVPN, "corp", 0)]);

        let error =
            ensure_connection_chain_teardown_allowed(&registry, &chain, "disconnect").unwrap_err();
        assert!(error.contains("1 active session"));
        assert!(!error.contains("secret-session-owner"));
    }

    #[tokio::test]
    async fn connection_chain_guard_checks_multiple_vpns_amid_mixed_layers() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = GuardMockRuntime::default();
        acquire_session_vpn_leases(
            &mut registry,
            "session-multiple",
            vec![
                request("wireguard", "wg-office"),
                request("zerotier", "zt-lab"),
            ],
            &mut runtime,
        )
        .await
        .unwrap();
        let chain = test_chain(vec![
            test_layer(ConnectionType::Proxy, "proxy-1", 0),
            test_layer(ConnectionType::WireGuard, "wg-office", 1),
            test_layer(ConnectionType::IKEv2, "ike-1", 2),
            test_layer(ConnectionType::ZeroTier, "zt-lab", 3),
        ]);

        assert_eq!(connection_chain_vpn_lease_keys(&chain).len(), 2);
        assert!(ensure_connection_chain_teardown_allowed(&registry, &chain, "disconnect").is_err());
        assert!(ensure_connection_chain_teardown_allowed(&registry, &chain, "delete").is_err());

        let unleased_mixed = test_chain(vec![
            test_layer(ConnectionType::Proxy, "proxy-1", 0),
            test_layer(ConnectionType::Tailscale, "tailnet-unleased", 1),
            test_layer(ConnectionType::PPTP, "pptp-1", 2),
        ]);
        ensure_connection_chain_teardown_allowed(&registry, &unleased_mixed, "disconnect").unwrap();
    }

    #[tokio::test]
    async fn held_connection_chain_guard_serializes_concurrent_session_acquire() {
        let state = new_vpn_lease_service_state();
        let chain = test_chain(vec![test_layer(ConnectionType::WireGuard, "wg-race", 0)]);
        let (guard_entered_tx, guard_entered_rx) = tokio::sync::oneshot::channel();
        let (acquire_attempt_tx, acquire_attempt_rx) = tokio::sync::oneshot::channel();
        let (acquire_done_tx, mut acquire_done_rx) = tokio::sync::oneshot::channel();

        let guarded_disconnect = {
            let state = Arc::clone(&state);
            async move {
                let registry = state.lock().await;
                ensure_connection_chain_teardown_allowed(&registry, &chain, "disconnect").unwrap();
                guard_entered_tx.send(()).unwrap();
                acquire_attempt_rx.await.unwrap();
                tokio::task::yield_now().await;
                assert!(matches!(
                    acquire_done_rx.try_recv(),
                    Err(tokio::sync::oneshot::error::TryRecvError::Empty)
                ));
                // The production command awaits the complete chain teardown
                // before this guard leaves scope.
                drop(registry);
                acquire_done_rx.await.unwrap();
            }
        };
        let competing_acquire = {
            let state = Arc::clone(&state);
            async move {
                guard_entered_rx.await.unwrap();
                acquire_attempt_tx.send(()).unwrap();
                let mut registry = state.lock().await;
                let mut runtime = GuardMockRuntime::default();
                acquire_session_vpn_leases(
                    &mut registry,
                    "session-racing",
                    vec![request("wireguard", "wg-race")],
                    &mut runtime,
                )
                .await
                .unwrap();
                acquire_done_tx.send(()).unwrap();
            }
        };

        tokio::join!(guarded_disconnect, competing_acquire);
        let registry = state.lock().await;
        let key = VpnLeaseKey {
            vpn_type: RuntimeVpnType::WireGuard,
            connection_id: "wg-race".to_string(),
        };
        assert_eq!(registry.usage(&key).unwrap().owner_count, 1);
    }
}
