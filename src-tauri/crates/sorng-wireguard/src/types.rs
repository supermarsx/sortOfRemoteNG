//! # WireGuard Types
//!
//! Core type definitions for WireGuard tunnel management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// WireGuard tunnel connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WgConnection {
    pub id: String,
    pub name: String,
    pub config: WgConfig,
    pub status: WgConnectionStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub interface_name: Option<String>,
    pub stats: Option<WgInterfaceStats>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WgConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Disconnecting,
    Error(String),
}

/// Full WireGuard configuration (INI format compatible).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WgConfig {
    pub interface: WgInterfaceConfig,
    pub peers: Vec<WgPeerConfig>,
}

/// [Interface] section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WgInterfaceConfig {
    pub private_key: String,
    pub address: Vec<String>,
    pub listen_port: Option<u16>,
    pub dns: Vec<String>,
    pub mtu: Option<u16>,
    pub table: Option<String>,
    pub pre_up: Option<String>,
    pub post_up: Option<String>,
    pub pre_down: Option<String>,
    pub post_down: Option<String>,
    pub save_config: Option<bool>,
    pub fwmark: Option<u32>,
}

/// [Peer] section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WgPeerConfig {
    pub public_key: String,
    pub preshared_key: Option<String>,
    pub endpoint: Option<String>,
    pub allowed_ips: Vec<String>,
    pub persistent_keepalive: Option<u16>,
}

/// WireGuard keypair.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WgKeypair {
    pub private_key: String,
    pub public_key: String,
}

/// Preshared key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WgPresharedKey {
    pub key: String,
}

/// Interface runtime stats.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WgInterfaceStats {
    pub interface_name: String,
    pub public_key: String,
    pub listening_port: u16,
    pub fwmark: Option<u32>,
    pub peers: Vec<WgPeerStats>,
}

/// Peer runtime stats from `wg show`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WgPeerStats {
    pub public_key: String,
    pub endpoint: Option<String>,
    pub allowed_ips: Vec<String>,
    pub latest_handshake: Option<u64>,
    pub transfer_rx: u64,
    pub transfer_tx: u64,
    pub persistent_keepalive: Option<u16>,
    pub preshared_key: Option<String>,
}

/// Handshake status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HandshakeStatus {
    /// Handshake completed recently (< 180s).
    Active,
    /// Handshake exists but is stale (> 180s).
    Stale,
    /// No handshake has been completed.
    None,
}

/// DNS leak test result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsLeakResult {
    pub leak_detected: bool,
    pub resolvers_detected: Vec<String>,
    pub expected_resolvers: Vec<String>,
    pub unexpected_resolvers: Vec<String>,
}

/// Route entry for WireGuard.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WgRoute {
    pub destination: String,
    pub gateway: Option<String>,
    pub interface: String,
    pub metric: Option<u32>,
}

/// Split tunnel configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitTunnelConfig {
    pub mode: SplitTunnelMode,
    pub included_routes: Vec<String>,
    pub excluded_routes: Vec<String>,
    pub excluded_apps: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SplitTunnelMode {
    /// Route all traffic through WireGuard (0.0.0.0/0).
    FullTunnel,
    /// Route only specified subnets.
    SplitInclude,
    /// Route all except specified subnets.
    SplitExclude,
}

/// NAT keepalive configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeepaliveConfig {
    pub enabled: bool,
    pub interval_secs: u16,
    pub adaptive: bool,
    pub min_interval_secs: u16,
    pub max_interval_secs: u16,
}

impl Default for KeepaliveConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_secs: 25,
            adaptive: false,
            min_interval_secs: 15,
            max_interval_secs: 60,
        }
    }
}

/// Import source type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConfigSource {
    File,
    QrCode,
    Manual,
    Clipboard,
    Url,
}
