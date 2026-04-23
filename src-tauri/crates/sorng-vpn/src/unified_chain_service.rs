//! Unified chain service — manages the lifecycle of multi-layer VPN/proxy chains.
//!
//! Replaces both `ChainingService` (connection chains) and proxy chain management
//! in `ProxyService` with a single unified service.

use chrono::Utc;
use sorng_core::events::DynEventEmitter;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::openvpn::OpenVPNServiceState;
use crate::proxy::ProxyServiceState;
use crate::tailscale::TailscaleServiceState;
use crate::unified_chain::*;
use crate::wireguard::WireGuardServiceState;
use crate::zerotier::ZeroTierServiceState;

pub type UnifiedChainServiceState = Arc<Mutex<UnifiedChainService>>;

pub struct UnifiedChainService {
    chains: HashMap<String, UnifiedChain>,
    profiles: HashMap<String, SavedLayerProfile>,
    // Service references for executing layer connections
    proxy_service: ProxyServiceState,
    openvpn_service: OpenVPNServiceState,
    wireguard_service: WireGuardServiceState,
    zerotier_service: ZeroTierServiceState,
    tailscale_service: TailscaleServiceState,
    emitter: Option<DynEventEmitter>,
}

impl UnifiedChainService {
    pub fn new(
        proxy_service: ProxyServiceState,
        openvpn_service: OpenVPNServiceState,
        wireguard_service: WireGuardServiceState,
        zerotier_service: ZeroTierServiceState,
        tailscale_service: TailscaleServiceState,
    ) -> UnifiedChainServiceState {
        Arc::new(Mutex::new(UnifiedChainService {
            chains: HashMap::new(),
            profiles: HashMap::new(),
            proxy_service,
            openvpn_service,
            wireguard_service,
            zerotier_service,
            tailscale_service,
            emitter: None,
        }))
    }

    pub fn new_with_emitter(
        proxy_service: ProxyServiceState,
        openvpn_service: OpenVPNServiceState,
        wireguard_service: WireGuardServiceState,
        zerotier_service: ZeroTierServiceState,
        tailscale_service: TailscaleServiceState,
        emitter: DynEventEmitter,
    ) -> UnifiedChainServiceState {
        Arc::new(Mutex::new(UnifiedChainService {
            chains: HashMap::new(),
            profiles: HashMap::new(),
            proxy_service,
            openvpn_service,
            wireguard_service,
            zerotier_service,
            tailscale_service,
            emitter: Some(emitter),
        }))
    }

    fn emit_event(&self, event: &str, chain_id: &str, status: &str) {
        if let Some(emitter) = &self.emitter {
            let payload = serde_json::json!({
                "connection_id": chain_id,
                "service_type": "unified_chain",
                "status": status,
            });
            let _ = emitter.emit_event(event, payload);
        }
    }

    // ── Chain CRUD ──────────────────────────────────────────────────

    pub async fn create_chain(
        &mut self,
        name: String,
        description: Option<String>,
        layers: Vec<UnifiedChainLayer>,
        tags: Option<Vec<String>>,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let chain = UnifiedChain {
            id: id.clone(),
            name,
            description,
            layers,
            tags,
            target_host: None,
            target_port: None,
            status: ChainStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            final_local_port: None,
            error: None,
        };
        self.chains.insert(id.clone(), chain);
        Ok(id)
    }

    pub async fn get_chain(&self, chain_id: &str) -> Result<UnifiedChain, String> {
        self.chains
            .get(chain_id)
            .cloned()
            .ok_or_else(|| format!("Chain '{}' not found", chain_id))
    }

    pub async fn list_chains(&self) -> Vec<UnifiedChain> {
        self.chains.values().cloned().collect()
    }

    pub async fn update_chain(
        &mut self,
        chain_id: &str,
        name: Option<String>,
        description: Option<Option<String>>,
        layers: Option<Vec<UnifiedChainLayer>>,
        tags: Option<Vec<String>>,
    ) -> Result<(), String> {
        let chain = self
            .chains
            .get_mut(chain_id)
            .ok_or_else(|| format!("Chain '{}' not found", chain_id))?;

        if let ChainStatus::Connected | ChainStatus::Connecting = &chain.status {
            return Err("Cannot update a connected or connecting chain".to_string());
        }

        if let Some(n) = name {
            chain.name = n;
        }
        if let Some(d) = description {
            chain.description = d;
        }
        if let Some(l) = layers {
            chain.layers = l;
        }
        if let Some(t) = tags {
            chain.tags = Some(t);
        }
        Ok(())
    }

    pub async fn delete_chain(&mut self, chain_id: &str) -> Result<(), String> {
        if let Some(chain) = self.chains.get(chain_id) {
            if let ChainStatus::Connected | ChainStatus::Connecting = &chain.status {
                // Auto-disconnect before deleting
                self.disconnect_chain(chain_id).await?;
            }
        }
        self.chains
            .remove(chain_id)
            .ok_or_else(|| format!("Chain '{}' not found", chain_id))?;
        Ok(())
    }

    pub async fn duplicate_chain(&mut self, chain_id: &str) -> Result<String, String> {
        let original = self
            .chains
            .get(chain_id)
            .ok_or_else(|| format!("Chain '{}' not found", chain_id))?
            .clone();

        let new_id = Uuid::new_v4().to_string();
        let mut copy = original;
        copy.id = new_id.clone();
        copy.name = format!("{} (copy)", copy.name);
        copy.status = ChainStatus::Disconnected;
        copy.connected_at = None;
        copy.final_local_port = None;
        copy.error = None;
        copy.created_at = Utc::now();
        // Reset layer runtime state
        for layer in &mut copy.layers {
            layer.id = Uuid::new_v4().to_string();
            layer.status = LayerStatus::Disconnected;
            layer.actual_local_port = None;
            layer.error = None;
            layer.connected_at = None;
        }
        self.chains.insert(new_id.clone(), copy);
        Ok(new_id)
    }

    // ── Chain lifecycle ─────────────────────────────────────────────

    pub async fn connect_chain(
        &mut self,
        chain_id: &str,
        target_host: Option<String>,
        target_port: Option<u16>,
    ) -> Result<Option<u16>, String> {
        // Validate chain exists and collect enabled layer info
        {
            let chain = self
                .chains
                .get(chain_id)
                .ok_or_else(|| format!("Chain '{}' not found", chain_id))?;

            let has_enabled = chain.layers.iter().any(|l| l.enabled);
            if !has_enabled {
                return Err("No enabled layers in chain".to_string());
            }

            let last_enabled_type = chain
                .layers
                .iter().rfind(|l| l.enabled)
                .map(|l| l.tunnel_type.clone());
            let needs_target = matches!(
                last_enabled_type.as_ref(),
                Some(TunnelType::Proxy | TunnelType::Shadowsocks | TunnelType::Tor)
            );
            if needs_target && (target_host.is_none() || target_port.is_none()) {
                return Err(
                    "Proxy-terminated chains require target_host and target_port".to_string(),
                );
            }
        }

        // Set chain to connecting state
        {
            let chain = self.chains.get_mut(chain_id).unwrap();
            chain.target_host = target_host;
            chain.target_port = target_port;
            chain.status = ChainStatus::Connecting;
            chain.error = None;
        }
        self.emit_event("chain::status-changed", chain_id, "connecting");

        // Collect enabled layer indices and snapshots for iteration
        let enabled_indices: Vec<usize> = self.chains[chain_id]
            .layers
            .iter()
            .enumerate()
            .filter(|(_, l)| l.enabled)
            .map(|(i, _)| i)
            .collect();

        let mut last_local_port: Option<u16> = None;

        for &idx in &enabled_indices {
            // Mark layer as connecting
            self.chains.get_mut(chain_id).unwrap().layers[idx].status =
                LayerStatus::Connecting;

            // Clone layer data for the connect call (avoids borrow conflict)
            let layer_snapshot = self.chains[chain_id].layers[idx].clone();

            // Delegate to appropriate service
            let result = match &layer_snapshot.tunnel_type {
                TunnelType::Proxy | TunnelType::Shadowsocks => {
                    self.connect_proxy_layer(&layer_snapshot).await
                }
                TunnelType::Openvpn => {
                    self.connect_vpn_layer(&layer_snapshot, "openvpn").await
                }
                TunnelType::Wireguard => {
                    self.connect_vpn_layer(&layer_snapshot, "wireguard").await
                }
                TunnelType::Tailscale => {
                    self.connect_vpn_layer(&layer_snapshot, "tailscale").await
                }
                TunnelType::Zerotier => {
                    self.connect_vpn_layer(&layer_snapshot, "zerotier").await
                }
                TunnelType::SshTunnel | TunnelType::SshJump => {
                    self.connect_ssh_layer(&layer_snapshot).await
                }
                // Protocol-specific VPNs (IKEv2/IPsec/SSTP/L2TP/PPTP/SoftEther)
                // and external tunnels (Tor/Stunnel/Chisel/Ngrok/Cloudflared)
                // are not yet plumbed into the unified chain service because
                // their service handles are not held in `UnifiedChainService`.
                // Callers should connect them directly via the protocol-specific
                // command (e.g. `connect_ikev2`) for now. Surface an explicit,
                // actionable error rather than silently succeeding.
                other => Err(format!(
                    "Tunnel type {:?} is not yet routable through the unified chain service. \
                     Use the protocol-specific command (e.g. connect_{} for IKEv2/IPsec/SSTP/L2TP/PPTP/SoftEther) \
                     until these services are threaded into the chain constructor.",
                    other,
                    match other {
                        TunnelType::Ikev2 => "ikev2",
                        TunnelType::Ipsec => "ipsec",
                        TunnelType::Sstp => "sstp",
                        TunnelType::L2tp => "l2tp",
                        TunnelType::Pptp => "pptp",
                        TunnelType::Softether => "softether",
                        _ => "<protocol>",
                    }
                )),
            };

            // Update layer status based on result
            match result {
                Ok(port) => {
                    let layer = &mut self.chains.get_mut(chain_id).unwrap().layers[idx];
                    layer.status = LayerStatus::Connected;
                    layer.connected_at = Some(Utc::now());
                    if let Some(p) = port {
                        layer.actual_local_port = Some(p);
                        last_local_port = Some(p);
                    }
                }
                Err(e) => {
                    let layer = &mut self.chains.get_mut(chain_id).unwrap().layers[idx];
                    layer.status = LayerStatus::Error {
                        message: e.clone(),
                    };
                    layer.error = Some(e.clone());

                    let chain = self.chains.get_mut(chain_id).unwrap();
                    chain.status = ChainStatus::Error {
                        message: e.clone(),
                    };
                    chain.error = Some(e.clone());
                    self.emit_event("chain::status-changed", chain_id, "error");
                    return Err(e);
                }
            }
        }

        let chain = self.chains.get_mut(chain_id).unwrap();
        chain.status = ChainStatus::Connected;
        chain.connected_at = Some(Utc::now());
        chain.final_local_port = last_local_port;
        self.emit_event("chain::status-changed", chain_id, "connected");
        Ok(last_local_port)
    }

    pub async fn disconnect_chain(&mut self, chain_id: &str) -> Result<(), String> {
        if !self.chains.contains_key(chain_id) {
            return Err(format!("Chain '{}' not found", chain_id));
        }

        self.chains.get_mut(chain_id).unwrap().status = ChainStatus::Disconnecting;
        self.emit_event("chain::status-changed", chain_id, "disconnecting");

        // Collect connected layer indices in reverse order
        let connected_indices: Vec<usize> = self.chains[chain_id]
            .layers
            .iter()
            .enumerate()
            .filter(|(_, l)| matches!(l.status, LayerStatus::Connected))
            .map(|(i, _)| i)
            .rev()
            .collect();

        for idx in connected_indices {
            self.chains.get_mut(chain_id).unwrap().layers[idx].status =
                LayerStatus::Disconnecting;

            // Clone layer data to avoid borrow conflicts
            let layer = self.chains[chain_id].layers[idx].clone();

            match &layer.tunnel_type {
                TunnelType::Openvpn => {
                    if let Some(config_id) = layer.vpn.as_ref().and_then(|v| v.config_id.as_ref())
                    {
                        let mut svc = self.openvpn_service.lock().await;
                        let _ = svc.disconnect(config_id).await;
                    }
                }
                TunnelType::Wireguard => {
                    if let Some(config_id) = layer.vpn.as_ref().and_then(|v| v.config_id.as_ref())
                    {
                        let mut svc = self.wireguard_service.lock().await;
                        let _ = svc.disconnect(config_id).await;
                    }
                }
                TunnelType::Tailscale => {
                    if let Some(config_id) =
                        layer.mesh.as_ref().and_then(|m| m.network_id.as_ref())
                    {
                        let mut svc = self.tailscale_service.lock().await;
                        let _ = svc.disconnect(config_id).await;
                    }
                }
                TunnelType::Zerotier => {
                    if let Some(config_id) =
                        layer.mesh.as_ref().and_then(|m| m.network_id.as_ref())
                    {
                        let mut svc = self.zerotier_service.lock().await;
                        let _ = svc.disconnect(config_id).await;
                    }
                }
                _ => {} // Proxy/SSH layers clean up when relay tasks end
            }

            let l = &mut self.chains.get_mut(chain_id).unwrap().layers[idx];
            l.status = LayerStatus::Disconnected;
            l.actual_local_port = None;
            l.connected_at = None;
        }

        let chain = self.chains.get_mut(chain_id).unwrap();
        chain.status = ChainStatus::Disconnected;
        chain.connected_at = None;
        chain.final_local_port = None;
        chain.error = None;
        self.emit_event("chain::status-changed", chain_id, "disconnected");
        Ok(())
    }

    // ── Layer toggle ────────────────────────────────────────────────

    pub async fn toggle_layer(
        &mut self,
        chain_id: &str,
        layer_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let chain = self
            .chains
            .get_mut(chain_id)
            .ok_or_else(|| format!("Chain '{}' not found", chain_id))?;

        if let ChainStatus::Connected | ChainStatus::Connecting = &chain.status {
            return Err("Cannot toggle layers on a connected chain".to_string());
        }

        let layer = chain
            .layers
            .iter_mut()
            .find(|l| l.id == layer_id)
            .ok_or_else(|| format!("Layer '{}' not found", layer_id))?;

        layer.enabled = enabled;
        Ok(())
    }

    // ── Health check ────────────────────────────────────────────────

    pub async fn get_chain_health(&self, chain_id: &str) -> Result<ChainHealth, String> {
        let chain = self
            .chains
            .get(chain_id)
            .ok_or_else(|| format!("Chain '{}' not found", chain_id))?;

        let mut layers = Vec::new();
        let mut healthy_count = 0;

        for (i, layer) in chain.layers.iter().enumerate() {
            let healthy = matches!(
                layer.status,
                LayerStatus::Connected | LayerStatus::Disconnected
            );
            if healthy {
                healthy_count += 1;
            }
            layers.push(LayerHealth {
                id: layer.id.clone(),
                position: i,
                status: layer.status.clone(),
                healthy,
                local_port: layer.actual_local_port,
                error: layer.error.clone(),
            });
        }

        let overall = if healthy_count == chain.layers.len() {
            "healthy"
        } else if healthy_count > 0 {
            "degraded"
        } else {
            "failed"
        };

        Ok(ChainHealth {
            chain_id: chain_id.to_string(),
            overall_health: overall.to_string(),
            healthy_layers: healthy_count,
            total_layers: chain.layers.len(),
            layers,
        })
    }

    // ── Profile CRUD ────────────────────────────────────────────────

    pub async fn save_profile(&mut self, profile: SavedLayerProfile) -> Result<String, String> {
        let id = profile.id.clone();
        self.profiles.insert(id.clone(), profile);
        Ok(id)
    }

    pub async fn list_profiles(&self) -> Vec<SavedLayerProfile> {
        self.profiles.values().cloned().collect()
    }

    pub async fn delete_profile(&mut self, profile_id: &str) -> Result<(), String> {
        self.profiles
            .remove(profile_id)
            .ok_or_else(|| format!("Profile '{}' not found", profile_id))?;
        Ok(())
    }

    // ── Layer connect helpers ───────────────────────────────────────

    async fn connect_proxy_layer(
        &self,
        layer: &UnifiedChainLayer,
    ) -> Result<Option<u16>, String> {
        let proxy_config = layer
            .proxy
            .as_ref()
            .ok_or("Proxy layer missing proxy config")?;

        let mut proxy_svc = self.proxy_service.lock().await;
        let target_host = layer
            .local_bind_host
            .as_deref()
            .unwrap_or("127.0.0.1")
            .to_string();
        let target_port = layer.local_bind_port.unwrap_or(0);

        let conn_config = crate::proxy::ProxyConfig {
            proxy_type: proxy_config.proxy_type.clone(),
            host: proxy_config.host.clone(),
            port: proxy_config.port,
            username: proxy_config.username.clone(),
            password: proxy_config.password.clone(),
            ssh_key_file: None,
            ssh_key_passphrase: None,
            ssh_host_key_verification: None,
            ssh_known_hosts_file: None,
            tunnel_domain: None,
            tunnel_key: None,
            tunnel_method: None,
            custom_headers: proxy_config.custom_headers.clone(),
            websocket_path: proxy_config.websocket_path.clone(),
            quic_cert_file: proxy_config.quic_cert_file.clone(),
            shadowsocks_method: proxy_config.method.clone(),
            shadowsocks_plugin: proxy_config.plugin.clone(),
        };

        let conn_id = proxy_svc
            .create_proxy_connection(target_host, target_port, conn_config)
            .await?;
        let port = proxy_svc.connect_via_proxy(&conn_id).await?;
        Ok(Some(port))
    }

    async fn connect_vpn_layer(
        &self,
        layer: &UnifiedChainLayer,
        vpn_type: &str,
    ) -> Result<Option<u16>, String> {
        let vpn_config = layer.vpn.as_ref().ok_or("VPN layer missing vpn config")?;

        let config_id = vpn_config
            .config_id
            .as_ref()
            .ok_or("VPN layer missing config_id (reference to existing VPN connection)")?;

        match vpn_type {
            "openvpn" => {
                let mut svc = self.openvpn_service.lock().await;
                svc.connect(config_id).await?;
            }
            "wireguard" => {
                let mut svc = self.wireguard_service.lock().await;
                svc.connect(config_id).await?;
            }
            "tailscale" => {
                let mut svc = self.tailscale_service.lock().await;
                svc.connect(config_id).await?;
            }
            "zerotier" => {
                let mut svc = self.zerotier_service.lock().await;
                svc.connect(config_id).await?;
            }
            _ => return Err(format!("Unknown VPN type: {}", vpn_type)),
        }
        Ok(None) // VPN connections don't produce a local port
    }

    async fn connect_ssh_layer(
        &self,
        layer: &UnifiedChainLayer,
    ) -> Result<Option<u16>, String> {
        // Delegate to the proxy service's russh-based SSH tunnel implementation.
        //
        // The SSH tunnel relay (`ProxyService::connect_ssh_tunnel_static`) already
        // handles all heavy work on its own `tokio::spawn`ed loop. This method
        // only configures and kicks it off — no blocking I/O runs on the Tauri
        // command thread.
        let ssh_cfg = layer
            .ssh_tunnel
            .as_ref()
            .ok_or("SSH layer missing ssh_tunnel config")?;
        let host = ssh_cfg
            .host
            .clone()
            .ok_or("SSH layer missing host")?;
        let port = ssh_cfg.port.unwrap_or(22);
        let username = ssh_cfg.username.clone();
        let password = ssh_cfg.password.clone();
        let key_file = ssh_cfg.private_key.clone();
        let key_passphrase = ssh_cfg.passphrase.clone();

        // SshJump uses jump_target_host/port as the forward target; SshTunnel
        // uses remote_host/port. Fall back to each in turn.
        let (target_host, target_port) = match layer.tunnel_type {
            TunnelType::SshJump => (
                ssh_cfg
                    .jump_target_host
                    .clone()
                    .or_else(|| ssh_cfg.remote_host.clone())
                    .ok_or("SSH jump layer missing jump_target_host")?,
                ssh_cfg
                    .jump_target_port
                    .or(ssh_cfg.remote_port)
                    .ok_or("SSH jump layer missing jump_target_port")?,
            ),
            _ => (
                ssh_cfg
                    .remote_host
                    .clone()
                    .ok_or("SSH tunnel layer missing remote_host")?,
                ssh_cfg
                    .remote_port
                    .ok_or("SSH tunnel layer missing remote_port")?,
            ),
        };

        let conn_config = crate::proxy::ProxyConfig {
            proxy_type: "ssh".to_string(),
            host,
            port,
            username,
            password,
            ssh_key_file: key_file,
            ssh_key_passphrase: key_passphrase,
            ssh_host_key_verification: None,
            ssh_known_hosts_file: None,
            tunnel_domain: None,
            tunnel_key: None,
            tunnel_method: None,
            custom_headers: None,
            websocket_path: None,
            quic_cert_file: None,
            shadowsocks_method: None,
            shadowsocks_plugin: None,
        };

        let mut proxy_svc = self.proxy_service.lock().await;
        let conn_id = proxy_svc
            .create_proxy_connection(target_host, target_port, conn_config)
            .await?;
        let local_port = proxy_svc.connect_via_proxy(&conn_id).await?;
        Ok(Some(local_port))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_services() -> (
        ProxyServiceState,
        OpenVPNServiceState,
        WireGuardServiceState,
        ZeroTierServiceState,
        TailscaleServiceState,
    ) {
        (
            crate::proxy::ProxyService::new(),
            crate::openvpn::OpenVPNService::new(),
            crate::wireguard::WireGuardService::new(),
            crate::zerotier::ZeroTierService::new(),
            crate::tailscale::TailscaleService::new(),
        )
    }

    #[tokio::test]
    async fn create_and_list_chains() {
        let (p, o, w, z, t) = mock_services();
        let svc = UnifiedChainService::new(p, o, w, z, t);
        let mut svc = svc.lock().await;

        let id = svc
            .create_chain(
                "Test Chain".to_string(),
                None,
                vec![],
                Some(vec!["test".to_string()]),
            )
            .await
            .unwrap();

        let chains = svc.list_chains().await;
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].id, id);
        assert_eq!(chains[0].name, "Test Chain");
    }

    #[tokio::test]
    async fn duplicate_chain() {
        let (p, o, w, z, t) = mock_services();
        let svc = UnifiedChainService::new(p, o, w, z, t);
        let mut svc = svc.lock().await;

        let id = svc
            .create_chain("Original".to_string(), None, vec![], None)
            .await
            .unwrap();

        let copy_id = svc.duplicate_chain(&id).await.unwrap();
        let copy = svc.get_chain(&copy_id).await.unwrap();
        assert_eq!(copy.name, "Original (copy)");
        assert_ne!(copy.id, id);
    }

    #[tokio::test]
    async fn delete_chain() {
        let (p, o, w, z, t) = mock_services();
        let svc = UnifiedChainService::new(p, o, w, z, t);
        let mut svc = svc.lock().await;

        let id = svc
            .create_chain("To Delete".to_string(), None, vec![], None)
            .await
            .unwrap();

        svc.delete_chain(&id).await.unwrap();
        assert!(svc.get_chain(&id).await.is_err());
    }

    #[tokio::test]
    async fn connect_empty_chain_fails() {
        let (p, o, w, z, t) = mock_services();
        let svc = UnifiedChainService::new(p, o, w, z, t);
        let mut svc = svc.lock().await;

        let id = svc
            .create_chain("Empty".to_string(), None, vec![], None)
            .await
            .unwrap();

        let result = svc.connect_chain(&id, None, None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No enabled layers"));
    }

    #[tokio::test]
    async fn profile_crud() {
        let (p, o, w, z, t) = mock_services();
        let svc = UnifiedChainService::new(p, o, w, z, t);
        let mut svc = svc.lock().await;

        let profile = SavedLayerProfile {
            id: "prof-1".to_string(),
            name: "SOCKS5 Profile".to_string(),
            tunnel_type: TunnelType::Proxy,
            description: None,
            tags: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            proxy: Some(ProxyLayerConfig {
                proxy_type: "socks5".to_string(),
                host: "proxy.test".to_string(),
                port: 1080,
                username: None,
                password: None,
                method: None,
                plugin: None,
                plugin_opts: None,
                custom_headers: None,
                websocket_path: None,
                quic_cert_file: None,
            }),
            ssh_tunnel: None,
            vpn: None,
            mesh: None,
            tunnel: None,
        };

        svc.save_profile(profile).await.unwrap();
        assert_eq!(svc.list_profiles().await.len(), 1);
        svc.delete_profile("prof-1").await.unwrap();
        assert_eq!(svc.list_profiles().await.len(), 0);
    }
}
