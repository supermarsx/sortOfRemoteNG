use super::chaining::*;
use super::vpn_lifecycle::*;
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VpnRuntimeCapability {
    pub vpn_type: String,
    pub executable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

fn unsupported_capability(vpn_type: &str, reason: &str) -> VpnRuntimeCapability {
    VpnRuntimeCapability {
        vpn_type: vpn_type.to_string(),
        executable: false,
        reason: Some(reason.to_string()),
    }
}

fn runtime_vpn_capabilities_for(
    platform: &str,
    legacy_profiles_persisted: bool,
) -> Vec<VpnRuntimeCapability> {
    let supported = |vpn_type: &str| VpnRuntimeCapability {
        vpn_type: vpn_type.to_string(),
        executable: true,
        reason: None,
    };
    let windows_only = |vpn_type: &str| {
        if !legacy_profiles_persisted {
            return unsupported_capability(
                vpn_type,
                "Saved profiles are not yet available through encrypted persistent storage, so session associations are disabled.",
            );
        }
        if platform == "windows" {
            supported(vpn_type)
        } else {
            unsupported_capability(
                vpn_type,
                "This provider is available for session associations only on Windows RAS; the non-Windows backend does not yet establish and verify a complete tunnel.",
            )
        }
    };
    let ikev2_backends = |vpn_type: &str| {
        if !legacy_profiles_persisted {
            return unsupported_capability(
                vpn_type,
                "Saved profiles are not yet available through encrypted persistent storage, so session associations are disabled.",
            );
        }
        if platform == "windows" || platform == "linux" {
            supported(vpn_type)
        } else {
            unsupported_capability(
                vpn_type,
                "This provider is unavailable for macOS session associations until native strongSwan elevation and readiness probing are supported.",
            )
        }
    };
    let linux_only_strongswan = |vpn_type: &str| {
        if !legacy_profiles_persisted {
            return unsupported_capability(
                vpn_type,
                "Saved profiles are not yet available through encrypted persistent storage, so session associations are disabled.",
            );
        }
        match platform {
            "linux" => supported(vpn_type),
            "windows" => unsupported_capability(
                vpn_type,
                "Legacy IPsec session associations are unavailable on Windows because the current RAS path does not safely implement the profile authentication contract; use IKEv2 or run IPsec on Linux.",
            ),
            _ => unsupported_capability(
                vpn_type,
                "This provider is unavailable for macOS session associations until native strongSwan elevation and readiness probing are supported.",
            ),
        }
    };

    vec![
        supported("openvpn"),
        supported("wireguard"),
        supported("tailscale"),
        supported("zerotier"),
        windows_only("pptp"),
        windows_only("l2tp"),
        ikev2_backends("ikev2"),
        linux_only_strongswan("ipsec"),
        windows_only("sstp"),
        unsupported_capability(
            "softether",
            "SoftEther session associations are unavailable because the backend is feature-gated and does not expose the persisted profile and lease-runtime contract.",
        ),
    ]
}

fn ensure_runtime_provider_supported(vpn_type: RuntimeVpnType) -> Result<(), String> {
    let name = vpn_type.as_str();
    let capability =
        runtime_vpn_capabilities_for(std::env::consts::OS, LEGACY_SESSION_PIPELINE_ENABLED)
            .into_iter()
            .find(|candidate| candidate.vpn_type == name)
            .ok_or_else(|| format!("Unsupported VPN type: {name}"))?;
    if capability.executable {
        Ok(())
    } else {
        Err(capability
            .reason
            .unwrap_or_else(|| format!("{name} is not executable on this platform")))
    }
}

#[tauri::command]
pub async fn get_vpn_runtime_capabilities() -> Vec<VpnRuntimeCapability> {
    runtime_vpn_capabilities_for(std::env::consts::OS, LEGACY_SESSION_PIPELINE_ENABLED)
}

struct TauriVpnRuntime {
    openvpn: super::openvpn::OpenVPNServiceState,
    wireguard: super::wireguard::WireGuardServiceState,
    tailscale: super::tailscale::TailscaleServiceState,
    zerotier: super::zerotier::ZeroTierServiceState,
    pptp: super::pptp::PPTPServiceState,
    l2tp: super::l2tp::L2TPServiceState,
    ikev2: super::ikev2::IKEv2ServiceState,
    ipsec: super::ipsec::IPsecServiceState,
    sstp: super::sstp::SSTPServiceState,
}

impl VpnRuntime for TauriVpnRuntime {
    async fn probe_active(&mut self, key: &VpnLeaseKey) -> Result<bool, String> {
        ensure_runtime_provider_supported(key.vpn_type)?;
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
            RuntimeVpnType::Pptp => {
                self.pptp
                    .lock()
                    .await
                    .probe_connection_active(&key.connection_id)
                    .await
            }
            RuntimeVpnType::L2tp => {
                self.l2tp
                    .lock()
                    .await
                    .probe_connection_active(&key.connection_id)
                    .await
            }
            RuntimeVpnType::Ikev2 => {
                self.ikev2
                    .lock()
                    .await
                    .probe_connection_active(&key.connection_id)
                    .await
            }
            RuntimeVpnType::Ipsec => {
                self.ipsec
                    .lock()
                    .await
                    .probe_connection_active(&key.connection_id)
                    .await
            }
            RuntimeVpnType::Sstp => {
                self.sstp
                    .lock()
                    .await
                    .probe_connection_active(&key.connection_id)
                    .await
            }
        }
    }

    async fn connect(&mut self, key: &VpnLeaseKey) -> Result<(), String> {
        ensure_runtime_provider_supported(key.vpn_type)?;
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
            RuntimeVpnType::Pptp => self.pptp.lock().await.connect(&key.connection_id).await,
            RuntimeVpnType::L2tp => self.l2tp.lock().await.connect(&key.connection_id).await,
            RuntimeVpnType::Ikev2 => self.ikev2.lock().await.connect(&key.connection_id).await,
            RuntimeVpnType::Ipsec => self.ipsec.lock().await.connect(&key.connection_id).await,
            RuntimeVpnType::Sstp => self.sstp.lock().await.connect(&key.connection_id).await,
        }
    }

    async fn disconnect(&mut self, key: &VpnLeaseKey) -> Result<(), String> {
        ensure_runtime_provider_supported(key.vpn_type)?;
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
            RuntimeVpnType::Pptp => self.pptp.lock().await.disconnect(&key.connection_id).await,
            RuntimeVpnType::L2tp => self.l2tp.lock().await.disconnect(&key.connection_id).await,
            RuntimeVpnType::Ikev2 => self.ikev2.lock().await.disconnect(&key.connection_id).await,
            RuntimeVpnType::Ipsec => self.ipsec.lock().await.disconnect(&key.connection_id).await,
            RuntimeVpnType::Sstp => self.sstp.lock().await.disconnect(&key.connection_id).await,
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn tauri_vpn_runtime(
    openvpn_state: &tauri::State<'_, super::openvpn::OpenVPNServiceState>,
    wireguard_state: &tauri::State<'_, super::wireguard::WireGuardServiceState>,
    tailscale_state: &tauri::State<'_, super::tailscale::TailscaleServiceState>,
    zerotier_state: &tauri::State<'_, super::zerotier::ZeroTierServiceState>,
    pptp_state: &tauri::State<'_, super::pptp::PPTPServiceState>,
    l2tp_state: &tauri::State<'_, super::l2tp::L2TPServiceState>,
    ikev2_state: &tauri::State<'_, super::ikev2::IKEv2ServiceState>,
    ipsec_state: &tauri::State<'_, super::ipsec::IPsecServiceState>,
    sstp_state: &tauri::State<'_, super::sstp::SSTPServiceState>,
) -> TauriVpnRuntime {
    TauriVpnRuntime {
        openvpn: openvpn_state.inner().clone(),
        wireguard: wireguard_state.inner().clone(),
        tailscale: tailscale_state.inner().clone(),
        zerotier: zerotier_state.inner().clone(),
        pptp: pptp_state.inner().clone(),
        l2tp: l2tp_state.inner().clone(),
        ikev2: ikev2_state.inner().clone(),
        ipsec: ipsec_state.inner().clone(),
        sstp: sstp_state.inner().clone(),
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
                ConnectionType::PPTP => RuntimeVpnType::Pptp,
                ConnectionType::L2TP => RuntimeVpnType::L2tp,
                ConnectionType::IKEv2 => RuntimeVpnType::Ikev2,
                ConnectionType::IPsec => RuntimeVpnType::Ipsec,
                ConnectionType::SSTP => RuntimeVpnType::Sstp,
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
#[allow(clippy::too_many_arguments)]
pub async fn acquire_vpn_leases(
    owner_id: String,
    requests: Vec<VpnLeaseRequest>,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
    openvpn_state: tauri::State<'_, super::openvpn::OpenVPNServiceState>,
    wireguard_state: tauri::State<'_, super::wireguard::WireGuardServiceState>,
    tailscale_state: tauri::State<'_, super::tailscale::TailscaleServiceState>,
    zerotier_state: tauri::State<'_, super::zerotier::ZeroTierServiceState>,
    pptp_state: tauri::State<'_, super::pptp::PPTPServiceState>,
    l2tp_state: tauri::State<'_, super::l2tp::L2TPServiceState>,
    ikev2_state: tauri::State<'_, super::ikev2::IKEv2ServiceState>,
    ipsec_state: tauri::State<'_, super::ipsec::IPsecServiceState>,
    sstp_state: tauri::State<'_, super::sstp::SSTPServiceState>,
) -> Result<AcquireVpnLeasesResult, String> {
    let mut registry = vpn_lease_state.lock().await;
    let mut runtime = tauri_vpn_runtime(
        &openvpn_state,
        &wireguard_state,
        &tailscale_state,
        &zerotier_state,
        &pptp_state,
        &l2tp_state,
        &ikev2_state,
        &ipsec_state,
        &sstp_state,
    );
    acquire_session_vpn_leases(&mut registry, &owner_id, requests, &mut runtime).await
}

/// Release every VPN lease held by one frontend session.
///
/// Shared VPNs remain active until their final session releases them.  A VPN
/// that pre-dated the first lease is removed from the registry but left active.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn release_vpn_leases(
    owner_id: String,
    vpn_lease_state: tauri::State<'_, VpnLeaseServiceState>,
    openvpn_state: tauri::State<'_, super::openvpn::OpenVPNServiceState>,
    wireguard_state: tauri::State<'_, super::wireguard::WireGuardServiceState>,
    tailscale_state: tauri::State<'_, super::tailscale::TailscaleServiceState>,
    zerotier_state: tauri::State<'_, super::zerotier::ZeroTierServiceState>,
    pptp_state: tauri::State<'_, super::pptp::PPTPServiceState>,
    l2tp_state: tauri::State<'_, super::l2tp::L2TPServiceState>,
    ikev2_state: tauri::State<'_, super::ikev2::IKEv2ServiceState>,
    ipsec_state: tauri::State<'_, super::ipsec::IPsecServiceState>,
    sstp_state: tauri::State<'_, super::sstp::SSTPServiceState>,
) -> Result<ReleaseVpnLeasesResult, String> {
    let mut registry = vpn_lease_state.lock().await;
    let mut runtime = tauri_vpn_runtime(
        &openvpn_state,
        &wireguard_state,
        &tailscale_state,
        &zerotier_state,
        &pptp_state,
        &l2tp_state,
        &ikev2_state,
        &ipsec_state,
        &sstp_state,
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
    fn runtime_capabilities_are_platform_scoped_and_softether_stays_unsupported() {
        let gated = runtime_vpn_capabilities_for("windows", false);
        for vpn_type in ["pptp", "l2tp", "ikev2", "ipsec", "sstp"] {
            let capability = gated
                .iter()
                .find(|capability| capability.vpn_type == vpn_type)
                .unwrap();
            assert!(!capability.executable);
            assert!(capability.reason.as_deref().unwrap().contains("encrypted"));
        }

        let windows = runtime_vpn_capabilities_for("windows", true);
        for vpn_type in ["pptp", "l2tp", "ikev2", "sstp"] {
            assert!(windows
                .iter()
                .any(|capability| capability.vpn_type == vpn_type && capability.executable));
        }
        let windows_ipsec = windows
            .iter()
            .find(|capability| capability.vpn_type == "ipsec")
            .unwrap();
        assert!(!windows_ipsec.executable);
        assert!(windows_ipsec
            .reason
            .as_deref()
            .unwrap()
            .contains("authentication contract"));

        let linux = runtime_vpn_capabilities_for("linux", true);
        for vpn_type in ["ikev2", "ipsec"] {
            assert!(linux
                .iter()
                .any(|capability| capability.vpn_type == vpn_type && capability.executable));
        }
        for vpn_type in ["pptp", "l2tp", "sstp"] {
            let capability = linux
                .iter()
                .find(|capability| capability.vpn_type == vpn_type)
                .unwrap();
            assert!(!capability.executable);
            assert!(capability
                .reason
                .as_deref()
                .unwrap()
                .contains("Windows RAS"));
        }

        let macos = runtime_vpn_capabilities_for("macos", true);
        assert!(macos
            .iter()
            .filter(|capability| matches!(capability.vpn_type.as_str(), "ikev2" | "ipsec"))
            .all(|capability| !capability.executable));
        assert!(windows
            .iter()
            .chain(linux.iter())
            .chain(macos.iter())
            .filter(|capability| capability.vpn_type == "softether")
            .all(|capability| !capability.executable));
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

        assert!(deserialized.was_already_connected);
        assert!(deserialized.is_now_connected);
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

        assert_eq!(connection_chain_vpn_lease_keys(&chain).len(), 3);
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
