//! # ZeroTier Types
//!
//! Core types for ZeroTier network management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// ZeroTier node identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtNodeIdentity {
    pub address: String,
    pub public_key: String,
    pub secret_key: Option<String>,
    pub world_id: u64,
    pub world_timestamp: u64,
}

/// ZeroTier connection to a network.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtConnection {
    pub id: String,
    pub name: String,
    pub network_id: String,
    pub config: ZtNetworkConfig,
    pub status: ZtConnectionStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub assigned_ips: Vec<String>,
    pub mac_address: Option<String>,
    pub mtu: u32,
    pub bridge: bool,
    pub broadcast_enabled: bool,
    pub dns_domain: Option<String>,
    pub dns_servers: Vec<String>,
}

/// Connection status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ZtConnectionStatus {
    Disconnected,
    Requesting,
    Connected,
    NotFound,
    AccessDenied,
    Disconnecting,
    Error(String),
}

/// Network configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtNetworkConfig {
    pub network_id: String,
    pub allow_managed: bool,
    pub allow_global: bool,
    pub allow_default: bool,
    pub allow_dns: bool,
}

impl Default for ZtNetworkConfig {
    fn default() -> Self {
        Self {
            network_id: String::new(),
            allow_managed: true,
            allow_global: false,
            allow_default: false,
            allow_dns: true,
        }
    }
}

/// Detailed network information from ZeroTier API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtNetworkDetail {
    pub id: String,
    pub name: String,
    pub status: ZtNetworkStatus,
    pub network_type: ZtNetworkType,
    pub mac: String,
    pub mtu: u32,
    pub dhcp: bool,
    pub bridge: bool,
    pub broadcast_enabled: bool,
    pub port_error: i32,
    pub netconf_revision: u64,
    pub assigned_addresses: Vec<String>,
    pub routes: Vec<ZtRoute>,
    pub port_device_name: Option<String>,
    pub allow_managed: bool,
    pub allow_global: bool,
    pub allow_default: bool,
    pub allow_dns: bool,
    pub dns: Option<ZtDnsConfig>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ZtNetworkStatus {
    Requesting,
    Ok,
    AccessDenied,
    NotFound,
    PortError,
    ClientTooOld,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ZtNetworkType {
    Public,
    Private,
}

/// Network route.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtRoute {
    pub target: String,
    pub via: Option<String>,
    pub flags: u16,
    pub metric: u16,
}

/// DNS configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtDnsConfig {
    pub domain: String,
    pub servers: Vec<String>,
}

/// ZeroTier peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtPeer {
    pub address: String,
    pub version_major: Option<i32>,
    pub version_minor: Option<i32>,
    pub version_rev: Option<i32>,
    pub latency: i32,
    pub role: ZtPeerRole,
    pub paths: Vec<ZtPeerPath>,
    pub is_bonded: bool,
    pub tunnel_suitable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ZtPeerRole {
    Leaf,
    Moon,
    Planet,
}

/// Peer path / physical connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtPeerPath {
    pub address: String,
    pub last_send: u64,
    pub last_receive: u64,
    pub active: bool,
    pub expired: bool,
    pub preferred: bool,
    pub trusted_path_id: Option<u64>,
    pub link_quality: Option<f64>,
}

/// ZeroTier service status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtServiceStatus {
    pub address: String,
    pub public_identity: String,
    pub online: bool,
    pub version: String,
    pub primary_port: u16,
    pub secondary_port: Option<u16>,
    pub tertiary_port: Option<u16>,
    pub tcp_fallback_active: bool,
    pub relay_policy: String,
    pub surface_addresses: Vec<String>,
    pub cluster: Option<String>,
    pub clock: u64,
    pub planet_world_id: u64,
    pub planet_world_timestamp: u64,
}

/// Controller network configuration (for self-hosted).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtControllerNetwork {
    pub id: String,
    pub name: String,
    pub private: bool,
    pub creation_time: u64,
    pub revision: u64,
    pub multicast_limit: u32,
    pub enable_broadcast: bool,
    pub v4_assign_mode: V4AssignMode,
    pub v6_assign_mode: V6AssignMode,
    pub routes: Vec<ZtRoute>,
    pub ip_assignment_pools: Vec<IpAssignmentPool>,
    pub rules: Vec<ZtFlowRule>,
    pub dns: Option<ZtDnsConfig>,
    pub authorized_member_count: u32,
    pub total_member_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct V4AssignMode {
    pub zt: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct V6AssignMode {
    pub zt: bool,
    pub rfc4193: bool,
    #[serde(rename = "6plane")]
    pub six_plane: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpAssignmentPool {
    pub ip_range_start: String,
    pub ip_range_end: String,
}

/// Controller network member.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtControllerMember {
    pub node_id: String,
    pub network_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub authorized: bool,
    pub active_bridge: bool,
    pub no_auto_assign_ips: bool,
    pub ip_assignments: Vec<String>,
    pub capabilities: Vec<u32>,
    pub tags: Vec<Vec<u32>>,
    pub revision: u64,
    pub last_authorized_time: Option<u64>,
    pub last_deauthorized_time: Option<u64>,
    pub creation_time: u64,
    pub physical_address: Option<String>,
    pub client_version: Option<String>,
    pub protocol_version: Option<i32>,
    pub supports_rules_engine: Option<bool>,
}

/// Flow rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtFlowRule {
    #[serde(rename = "type")]
    pub rule_type: String,
    pub not: Option<bool>,
    pub or: Option<bool>,
    pub zt: Option<String>,
    pub ethertype: Option<u16>,
    pub mac: Option<String>,
    #[serde(rename = "ipProtocol")]
    pub ip_protocol: Option<u8>,
    #[serde(rename = "ipTos")]
    pub ip_tos: Option<IpTosMask>,
    #[serde(rename = "portRange")]
    pub port_range: Option<PortRange>,
    pub id: Option<u32>,
    pub value: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpTosMask {
    pub mask: u8,
    pub value: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortRange {
    pub start: u16,
    pub end: u16,
}

/// Moon definition (custom root).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZtMoon {
    pub id: String,
    pub timestamp: u64,
    pub roots: Vec<MoonRoot>,
    pub signature: String,
    pub update_must_be_signed_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoonRoot {
    pub identity: String,
    pub stable_endpoints: Vec<String>,
}
