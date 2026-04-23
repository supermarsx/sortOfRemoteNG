//! Unified chain types for the consolidated chaining system.
//!
//! Replaces three separate chain systems (Connection Chains, Proxy Chains, Tunnel Chains)
//! with a single unified model that supports all tunnel types, reusable profiles,
//! per-layer enable/disable, and tagging.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ── Tunnel type enum ────────────────────────────────────────────────

/// All supported tunnel/VPN/proxy layer types.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TunnelType {
    Proxy,
    SshTunnel,
    SshJump,
    SshProxycmd,
    SshStdio,
    Openvpn,
    Wireguard,
    Tailscale,
    Zerotier,
    Ikev2,
    Sstp,
    L2tp,
    Pptp,
    Ipsec,
    Softether,
    Shadowsocks,
    Tor,
    Stunnel,
    Chisel,
    Ngrok,
    Cloudflared,
}

// ── Layer status ────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase", tag = "state")]
#[derive(Default)]
pub enum LayerStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Error { message: String },
}


// ── Chain status ────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase", tag = "state")]
#[derive(Default)]
pub enum ChainStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    PartiallyConnected,
    Disconnecting,
    Error { message: String },
}


// ── Layer config sub-structs ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyLayerConfig {
    pub proxy_type: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    /// Shadowsocks encryption method
    pub method: Option<String>,
    /// Shadowsocks plugin
    pub plugin: Option<String>,
    pub plugin_opts: Option<String>,
    /// Custom HTTP headers
    pub custom_headers: Option<std::collections::HashMap<String, String>>,
    /// WebSocket path
    pub websocket_path: Option<String>,
    /// QUIC certificate file
    pub quic_cert_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnelLayerConfig {
    pub connection_id: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub forward_type: Option<String>,
    pub remote_host: Option<String>,
    pub remote_port: Option<u16>,
    pub jump_target_host: Option<String>,
    pub jump_target_port: Option<u16>,
    pub agent_forwarding: Option<bool>,
    pub compression: Option<bool>,
    pub keepalive_interval: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpnLayerConfig {
    pub config_id: Option<String>,
    pub config_file: Option<String>,
    pub server_host: Option<String>,
    pub server_port: Option<u16>,
    pub protocol: Option<String>,
    // WireGuard-specific
    pub private_key: Option<String>,
    pub public_key: Option<String>,
    pub endpoint: Option<String>,
    pub allowed_ips: Option<Vec<String>>,
    pub persistent_keepalive: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshLayerConfig {
    pub network_id: Option<String>,
    pub auth_key: Option<String>,
    pub target_node_id: Option<String>,
    pub target_ip: Option<String>,
    pub target_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenericTunnelConfig {
    pub config_path: Option<String>,
    pub server_url: Option<String>,
    pub auth_token: Option<String>,
    pub subdomain: Option<String>,
    pub region: Option<String>,
    pub extra_args: Option<Vec<String>>,
}

// ── Per-layer chain dynamics ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeChainConfig {
    pub skip_on_failure: Option<bool>,
    pub retry_count: Option<u32>,
    pub timeout_ms: Option<u64>,
    pub weight: Option<f64>,
    pub is_backup: Option<bool>,
    pub priority: Option<u32>,
}

// ── Unified chain layer ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedChainLayer {
    pub id: String,
    #[serde(rename = "type")]
    pub tunnel_type: TunnelType,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub name: Option<String>,
    /// Reference to a saved layer profile
    pub tunnel_profile_id: Option<String>,

    // Common binding
    pub local_bind_host: Option<String>,
    pub local_bind_port: Option<u16>,
    pub ssh_chaining_method: Option<String>,
    pub node_chain_config: Option<NodeChainConfig>,

    // Type-specific configs (only one populated based on tunnel_type)
    pub proxy: Option<ProxyLayerConfig>,
    pub ssh_tunnel: Option<SshTunnelLayerConfig>,
    pub vpn: Option<VpnLayerConfig>,
    pub mesh: Option<MeshLayerConfig>,
    pub tunnel: Option<GenericTunnelConfig>,

    // Runtime state (not persisted in saved chain definitions)
    #[serde(default)]
    pub status: LayerStatus,
    pub actual_local_port: Option<u16>,
    pub error: Option<String>,
    pub connected_at: Option<DateTime<Utc>>,
}

fn default_true() -> bool {
    true
}

// ── Unified chain ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedChain {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub layers: Vec<UnifiedChainLayer>,
    pub tags: Option<Vec<String>>,

    /// Connect-time target (required when terminal layer is a proxy type)
    pub target_host: Option<String>,
    pub target_port: Option<u16>,

    // Chain-level status
    #[serde(default)]
    pub status: ChainStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub final_local_port: Option<u16>,
    pub error: Option<String>,
}

// ── Saved layer profile ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedLayerProfile {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub tunnel_type: TunnelType,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,

    // Config (same sub-structs as UnifiedChainLayer)
    pub proxy: Option<ProxyLayerConfig>,
    pub ssh_tunnel: Option<SshTunnelLayerConfig>,
    pub vpn: Option<VpnLayerConfig>,
    pub mesh: Option<MeshLayerConfig>,
    pub tunnel: Option<GenericTunnelConfig>,
}

// ── Chain health ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainHealth {
    pub chain_id: String,
    pub overall_health: String,
    pub healthy_layers: usize,
    pub total_layers: usize,
    pub layers: Vec<LayerHealth>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerHealth {
    pub id: String,
    pub position: usize,
    pub status: LayerStatus,
    pub healthy: bool,
    pub local_port: Option<u16>,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tunnel_type_serialization() {
        let t = TunnelType::SshTunnel;
        let json = serde_json::to_string(&t).unwrap();
        assert_eq!(json, "\"ssh-tunnel\"");

        let deserialized: TunnelType = serde_json::from_str("\"wireguard\"").unwrap();
        assert_eq!(deserialized, TunnelType::Wireguard);
    }

    #[test]
    fn layer_status_default() {
        let status = LayerStatus::default();
        assert_eq!(status, LayerStatus::Disconnected);
    }

    #[test]
    fn chain_roundtrip() {
        let chain = UnifiedChain {
            id: "test-id".to_string(),
            name: "Test Chain".to_string(),
            description: Some("A test chain".to_string()),
            layers: vec![UnifiedChainLayer {
                id: "layer-1".to_string(),
                tunnel_type: TunnelType::Proxy,
                enabled: true,
                name: Some("SOCKS5 Layer".to_string()),
                tunnel_profile_id: None,
                local_bind_host: None,
                local_bind_port: None,
                ssh_chaining_method: None,
                node_chain_config: None,
                proxy: Some(ProxyLayerConfig {
                    proxy_type: "socks5".to_string(),
                    host: "proxy.example.com".to_string(),
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
                status: LayerStatus::Disconnected,
                actual_local_port: None,
                error: None,
                connected_at: None,
            }],
            tags: Some(vec!["test".to_string()]),
            target_host: Some("target.example.com".to_string()),
            target_port: Some(443),
            status: ChainStatus::Disconnected,
            created_at: Utc::now(),
            connected_at: None,
            final_local_port: None,
            error: None,
        };

        let json = serde_json::to_string(&chain).unwrap();
        let deserialized: UnifiedChain = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "test-id");
        assert_eq!(deserialized.layers.len(), 1);
        assert_eq!(deserialized.layers[0].tunnel_type, TunnelType::Proxy);
    }
}
