//! # NetBird Types
//!
//! Core data types for the NetBird integration — peers, groups, routes,
//! access-control policies, setup keys, DNS nameserver groups, posture
//! checks, relay/signal server status, and management API structures.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

// ── Connection & Status ─────────────────────────────────────────

/// A managed NetBird connection/profile inside SortOfRemoteNG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetBirdConnection {
    pub id: String,
    pub name: String,
    pub config: NetBirdConfig,
    pub status: NetBirdStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub ip: Option<String>,
    pub ipv6: Option<String>,
    pub fqdn: Option<String>,
    pub hostname: Option<String>,
    pub public_key: Option<String>,
    pub process_id: Option<u32>,
    pub version: Option<String>,
    pub management_url: Option<String>,
    pub signal_connected: bool,
    pub management_connected: bool,
    pub relays_connected: u32,
}

/// Current connection status of the local NetBird daemon.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum NetBirdStatus {
    Disconnected,
    Connecting,
    Connected,
    NeedsLogin,
    LoginExpired,
    Disconnecting,
    Error(String),
}

/// Configuration for establishing or reconfiguring a NetBird connection.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NetBirdConfig {
    /// Management server URL (default: `https://api.netbird.io`).
    pub management_url: Option<String>,
    /// Setup key for automatic enrolment.
    pub setup_key: Option<String>,
    /// Pre-shared key for extra WireGuard layer.
    pub preshared_key: Option<String>,
    /// Custom WireGuard listen port.
    pub wireguard_port: Option<u16>,
    /// Disable auto-connect on startup.
    pub disable_auto_connect: Option<bool>,
    /// Interface name override (e.g. `wt0`, `utun100`).
    pub interface_name: Option<String>,
    /// Log level for the daemon (trace, debug, info, warn, error).
    pub log_level: Option<String>,
    /// Admin API token for management operations.
    pub admin_api_token: Option<String>,
    /// Enable rosenpass post-quantum key exchange.
    pub rosenpass_enabled: Option<bool>,
    /// Enable rosenpass permissive mode (fallback to plain WireGuard).
    pub rosenpass_permissive: Option<bool>,
    /// Hostname to register with the management server.
    pub hostname: Option<String>,
    /// Disable DNS management by NetBird.
    pub disable_dns: Option<bool>,
    /// Disable firewall route management.
    pub disable_firewall: Option<bool>,
    /// Extra labels to tag this peer with.
    pub extra_labels: HashMap<String, String>,
}

// ── Peer ────────────────────────────────────────────────────────

/// A peer in the NetBird network (from the management API).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetBirdPeer {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub ipv6: Option<String>,
    pub fqdn: Option<String>,
    pub hostname: String,
    pub os: String,
    pub version: String,
    pub ui_version: Option<String>,
    pub kernel_version: Option<String>,
    pub connected: bool,
    pub last_seen: DateTime<Utc>,
    pub last_login: Option<DateTime<Utc>>,
    pub login_expired: bool,
    pub login_expiration_enabled: bool,
    pub connection_ip: Option<String>,
    pub groups: Vec<GroupMinimal>,
    pub accessible_peers: Vec<AccessiblePeer>,
    pub accessible_peers_count: u32,
    pub user_id: Option<String>,
    pub ssh_enabled: bool,
    pub approval_required: bool,
    pub country_code: Option<String>,
    pub city_name: Option<String>,
    pub serial_number: Option<String>,
    pub dns_label: Option<String>,
    pub connection_type: PeerConnectionType,
    pub latency_ms: Option<f64>,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub wireguard_pubkey: Option<String>,
}

/// Minimal group reference carried on a peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMinimal {
    pub id: String,
    pub name: String,
    pub peers_count: u32,
}

/// A peer accessible through the network.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessiblePeer {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub dns_label: Option<String>,
    pub user_id: Option<String>,
}

/// How a peer is connected to the mesh.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PeerConnectionType {
    /// Direct WireGuard tunnel (hole-punched)
    Direct,
    /// Routed through a TURN relay
    Relayed,
    /// Not currently connected
    Disconnected,
    /// Unknown / not yet probed
    Unknown,
}

// ── Group ───────────────────────────────────────────────────────

/// A NetBird peer group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetBirdGroup {
    pub id: String,
    pub name: String,
    pub issued: Option<GroupIssued>,
    pub peers: Vec<GroupPeerInfo>,
    pub peers_count: u32,
}

/// How the group was issued.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GroupIssued {
    Api,
    Integration,
    Jwt,
}

/// Minimal peer info inside a group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupPeerInfo {
    pub id: String,
    pub name: String,
    pub ip: String,
}

// ── Route ───────────────────────────────────────────────────────

/// A network route advertised through NetBird.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetBirdRoute {
    pub id: String,
    pub description: String,
    pub network_id: String,
    /// CIDR prefix, e.g. `10.20.0.0/16`.
    pub network: String,
    pub network_type: RouteNetworkType,
    pub enabled: bool,
    pub peer: Option<String>,
    pub peer_groups: Vec<String>,
    pub metric: u32,
    pub masquerade: bool,
    pub groups: Vec<String>,
    pub keep_route: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RouteNetworkType {
    IPv4,
    IPv6,
    DomainRoute,
}

// ── Access Control / Policy ─────────────────────────────────────

/// A NetBird access-control policy (replaces legacy "rules").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetBirdPolicy {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub rules: Vec<PolicyRule>,
    pub source_posture_checks: Vec<String>,
}

/// A single rule inside a policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRule {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub action: PolicyAction,
    pub bidirectional: bool,
    pub protocol: PolicyProtocol,
    pub ports: Vec<String>,
    pub sources: Vec<String>,
    pub destinations: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PolicyAction {
    Accept,
    Drop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PolicyProtocol {
    All,
    Tcp,
    Udp,
    Icmp,
}

// ── DNS ─────────────────────────────────────────────────────────

/// A DNS nameserver group in NetBird.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NameserverGroup {
    pub id: String,
    pub name: String,
    pub description: String,
    pub nameservers: Vec<Nameserver>,
    pub groups: Vec<String>,
    pub domains: Vec<String>,
    pub primary: bool,
    pub enabled: bool,
    pub search_domains_enabled: bool,
}

/// An individual nameserver entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nameserver {
    pub ip: String,
    pub port: u16,
    pub ns_type: NameserverType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NameserverType {
    Udp,
    Tcp,
    DoH,
    DoT,
}

// ── Setup Key ───────────────────────────────────────────────────

/// A setup key used to enrol peers without interactive login.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupKey {
    pub id: String,
    pub key: String,
    pub name: String,
    pub key_type: SetupKeyType,
    pub expires: DateTime<Utc>,
    pub revoked: bool,
    pub used_times: u32,
    pub last_used: Option<DateTime<Utc>>,
    pub auto_groups: Vec<String>,
    pub usage_limit: u32,
    pub valid: bool,
    pub state: SetupKeyState,
    pub ephemeral: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SetupKeyType {
    OneOff,
    Reusable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SetupKeyState {
    Valid,
    Expired,
    Revoked,
    Overused,
}

// ── Relay / TURN / Signal ───────────────────────────────────────

/// TURN relay server info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnRelay {
    pub uri: String,
    pub username: Option<String>,
    pub available: bool,
    pub latency_ms: Option<f64>,
    pub region: Option<String>,
    pub protocol: TurnProtocol,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TurnProtocol {
    Udp,
    Tcp,
    Tls,
}

/// Signal server connectivity info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalServer {
    pub uri: String,
    pub connected: bool,
    pub protocol: SignalProtocol,
    pub latency_ms: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SignalProtocol {
    Grpc,
    WebSocket,
}

/// Management server connectivity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagementServer {
    pub uri: String,
    pub connected: bool,
    pub version: Option<String>,
    pub latency_ms: Option<f64>,
}

// ── Posture Check ───────────────────────────────────────────────

/// A posture check definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostureCheck {
    pub id: String,
    pub name: String,
    pub description: String,
    pub checks: PostureCheckDetail,
}

/// The actual checks within a posture check definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostureCheckDetail {
    pub nb_version_check: Option<NbVersionCheck>,
    pub os_version_check: Option<OsVersionCheck>,
    pub geo_location_check: Option<GeoLocationCheck>,
    pub peer_network_range_check: Option<PeerNetworkRangeCheck>,
    pub process_check: Option<ProcessCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NbVersionCheck {
    pub min_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsVersionCheck {
    pub android: Option<OsVersionConstraint>,
    pub darwin: Option<OsVersionConstraint>,
    pub ios: Option<OsVersionConstraint>,
    pub linux: Option<OsVersionConstraint>,
    pub windows: Option<OsVersionConstraint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsVersionConstraint {
    pub min_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoLocationCheck {
    pub locations: Vec<GeoLocation>,
    pub action: GeoAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoLocation {
    pub country_code: String,
    pub city_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GeoAction {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerNetworkRangeCheck {
    pub ranges: Vec<String>,
    pub action: PeerNetworkAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PeerNetworkAction {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessCheck {
    pub processes: Vec<ProcessCheckEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessCheckEntry {
    pub linux_path: Option<String>,
    pub mac_path: Option<String>,
    pub windows_path: Option<String>,
}

// ── User ────────────────────────────────────────────────────────

/// A user synced from IdP or created via the management API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetBirdUser {
    pub id: String,
    pub email: Option<String>,
    pub name: String,
    pub role: UserRole,
    pub auto_groups: Vec<String>,
    pub is_current: bool,
    pub is_service_user: bool,
    pub is_blocked: bool,
    pub last_login: Option<DateTime<Utc>>,
    pub issued: Option<String>,
    pub permissions: UserPermissions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UserRole {
    Owner,
    Admin,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPermissions {
    pub dashboard_view: Option<String>,
}

// ── Diagnostics ─────────────────────────────────────────────────

/// Full health-check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheck {
    pub overall: HealthStatus,
    pub management: ManagementServer,
    pub signal: SignalServer,
    pub relays: Vec<TurnRelay>,
    pub peers_total: u32,
    pub peers_connected: u32,
    pub peers_direct: u32,
    pub peers_relayed: u32,
    pub interface_up: bool,
    pub wireguard_port: Option<u16>,
    pub rosenpass_enabled: bool,
    pub rosenpass_permissive: bool,
    pub dns_active: bool,
    pub firewall_active: bool,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub checked_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
}

// ── Events ──────────────────────────────────────────────────────

/// Events emitted by the NetBird integration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NetBirdEvent {
    PeerConnected {
        peer_id: String,
        direct: bool,
    },
    PeerDisconnected {
        peer_id: String,
    },
    ConnectionEstablished {
        connection_id: String,
        ip: String,
    },
    ConnectionLost {
        connection_id: String,
        reason: String,
    },
    LoginRequired {
        auth_url: String,
    },
    LoginExpired,
    RouteAdded {
        route_id: String,
        network: String,
    },
    RouteRemoved {
        route_id: String,
    },
    DnsUpdated,
    SetupKeyUsed {
        key_id: String,
        peer_id: String,
    },
    RelayFallback {
        peer_id: String,
        relay_uri: String,
    },
    HealthChanged {
        new_status: HealthStatus,
    },
}

// ── Service State Alias ─────────────────────────────────────────

pub type NetBirdServiceState = Arc<Mutex<crate::service::NetBirdService>>;
