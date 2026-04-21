//! # Tailscale Types
//!
//! Core data types for the Tailscale integration — peers, DERP regions,
//! ACL policies, network status, Funnel/Serve configs, and more.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

// ── Connection & Status ─────────────────────────────────────────

/// A managed Tailscale connection/profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailscaleConnection {
    pub id: String,
    pub name: String,
    pub config: TailscaleConfig,
    pub status: TailscaleStatus,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub tailnet_ip: Option<String>,
    pub tailnet_ipv6: Option<String>,
    pub hostname: Option<String>,
    pub tailnet_name: Option<String>,
    pub dns_name: Option<String>,
    pub process_id: Option<u32>,
    pub version: Option<String>,
    pub backend_state: Option<String>,
    pub auth_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TailscaleStatus {
    Disconnected,
    Connecting,
    NeedsLogin,
    Connected,
    Disconnecting,
    Stopped,
    Error(String),
}

/// Tailscale configuration for `tailscale up`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailscaleConfig {
    pub auth_key: Option<String>,
    pub login_server: Option<String>,
    pub accept_routes: Option<bool>,
    pub accept_dns: Option<bool>,
    pub advertise_routes: Vec<String>,
    pub advertise_tags: Vec<String>,
    pub hostname: Option<String>,
    pub exit_node: Option<String>,
    pub exit_node_allow_lan_access: Option<bool>,
    pub ssh: Option<bool>,
    pub funnel: Option<bool>,
    pub shields_up: Option<bool>,
    pub advertise_exit_node: Option<bool>,
    pub force_reauth: Option<bool>,
    pub operator: Option<String>,
    pub state_dir: Option<String>,
    pub socket: Option<String>,
    pub timeout: Option<u32>,
    pub unattended: Option<bool>,
    pub netfilter_mode: Option<String>,
    pub snat_subnet_routes: Option<bool>,
    pub stateful_filtering: Option<bool>,
}

impl Default for TailscaleConfig {
    fn default() -> Self {
        Self {
            auth_key: None,
            login_server: None,
            accept_routes: Some(true),
            accept_dns: Some(true),
            advertise_routes: Vec::new(),
            advertise_tags: Vec::new(),
            hostname: None,
            exit_node: None,
            exit_node_allow_lan_access: None,
            ssh: None,
            funnel: None,
            shields_up: None,
            advertise_exit_node: None,
            force_reauth: None,
            operator: None,
            state_dir: None,
            socket: None,
            timeout: None,
            unattended: None,
            netfilter_mode: None,
            snat_subnet_routes: None,
            stateful_filtering: None,
        }
    }
}

// ── Peer Info ───────────────────────────────────────────────────

/// A peer in the tailnet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailscalePeer {
    pub id: String,
    pub public_key: String,
    pub host_name: String,
    pub dns_name: String,
    pub os: String,
    pub tailscale_ips: Vec<String>,
    pub allowed_ips: Vec<String>,
    pub addrs: Vec<String>,
    pub cur_addr: Option<String>,
    pub relay: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub created: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub last_write: Option<DateTime<Utc>>,
    pub last_handshake: Option<DateTime<Utc>>,
    pub online: bool,
    pub keep_alive: bool,
    pub exit_node: bool,
    pub exit_node_option: bool,
    pub active: bool,
    pub tags: Vec<String>,
    pub ssh_host_keys: Vec<String>,
    pub in_network_map: bool,
    pub in_magic_sock: bool,
    pub in_engine: bool,
    pub connection_type: PeerConnectionType,
    pub latency_ms: Option<f64>,
}

/// How a peer is currently connected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PeerConnectionType {
    /// Direct WireGuard connection (P2P)
    Direct,
    /// Connection through a DERP relay
    Relay,
    /// Not currently connected
    Offline,
    /// Unknown
    Unknown,
}

// ── DERP ────────────────────────────────────────────────────────

/// A DERP (Designated Encrypted Relay for Packets) region.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DerpRegion {
    pub region_id: u16,
    pub region_code: String,
    pub region_name: String,
    pub avoid: bool,
    pub nodes: Vec<DerpNode>,
}

/// A DERP relay node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DerpNode {
    pub name: String,
    pub region_id: u16,
    pub host_name: String,
    pub ipv4: Option<String>,
    pub ipv6: Option<String>,
    pub stun_port: u16,
    pub stun_only: bool,
    pub derp_port: u16,
}

/// DERP connectivity status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DerpStatus {
    pub region_id: u16,
    pub region_code: String,
    pub latency_ms: f64,
    pub preferred: bool,
    pub connected: bool,
    pub last_ping: Option<DateTime<Utc>>,
}

// ── Netcheck ────────────────────────────────────────────────────

/// Result of a Tailscale netcheck operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetcheckResult {
    pub udp: bool,
    pub ipv4: bool,
    pub ipv6: bool,
    pub mapping_varies_by_dest_ip: Option<bool>,
    pub hair_pinning: Option<bool>,
    pub portmap_probe: Option<String>,
    pub preferred_derp: u16,
    pub region_latency: HashMap<String, f64>,
    pub region_v4_latency: HashMap<String, f64>,
    pub region_v6_latency: HashMap<String, f64>,
    pub global_v4: Option<String>,
    pub global_v6: Option<String>,
    pub captive_portal: Option<bool>,
    pub upnp: Option<bool>,
    pub pmp: Option<bool>,
    pub pcp: Option<bool>,
}

// ── ACL ─────────────────────────────────────────────────────────

/// Tailscale ACL policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclPolicy {
    pub acls: Vec<AclRule>,
    pub groups: HashMap<String, Vec<String>>,
    pub tag_owners: HashMap<String, Vec<String>>,
    pub auto_approvers: Option<AutoApprovers>,
    pub ssh: Vec<SshRule>,
    pub node_attrs: Vec<NodeAttrRule>,
    pub tests: Vec<AclTest>,
}

/// A single ACL rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclRule {
    pub action: String,
    pub src: Vec<String>,
    pub dst: Vec<String>,
    pub proto: Option<String>,
}

/// Auto-approvers for routes and exit nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoApprovers {
    pub routes: HashMap<String, Vec<String>>,
    pub exit_node: Vec<String>,
}

/// SSH ACL rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshRule {
    pub action: String,
    pub src: Vec<String>,
    pub dst: Vec<String>,
    pub users: Vec<String>,
    pub check_period: Option<String>,
}

/// Node attribute rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeAttrRule {
    pub target: Vec<String>,
    pub attr: Vec<String>,
}

/// ACL test entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclTest {
    pub src: String,
    pub accept: Vec<String>,
    pub deny: Vec<String>,
}

// ── Funnel & Serve ──────────────────────────────────────────────

/// Funnel configuration (public HTTPS ingress to tailnet node).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunnelConfig {
    pub enabled: bool,
    pub port: u16,
    pub backend: FunnelBackend,
    pub allow_funnel: bool,
}

/// What Funnel forwards to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FunnelBackend {
    Proxy(String),
    FileServer(String),
    Text(String),
}

/// Serve configuration (expose local service to tailnet).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServeConfig {
    pub tcp: HashMap<u16, ServeTarget>,
    pub web: HashMap<String, ServeWebHandler>,
    pub allow_funnel: HashMap<String, bool>,
}

/// A serve target.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServeTarget {
    Proxy(String),
    FileServer(String),
    Text(String),
    TcpForward(String),
}

/// A web serve handler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServeWebHandler {
    pub handlers: HashMap<String, ServeTarget>,
}

// ── Taildrop ────────────────────────────────────────────────────

/// A Taildrop file transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaildropTransfer {
    pub id: String,
    pub filename: String,
    pub size_bytes: u64,
    pub peer_id: String,
    pub peer_name: String,
    pub direction: TransferDirection,
    pub state: TransferState,
    pub progress_bytes: u64,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransferDirection {
    Send,
    Receive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransferState {
    Pending,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

// ── Exit Node ───────────────────────────────────────────────────

/// Exit node info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExitNodeInfo {
    pub peer_id: String,
    pub name: String,
    pub location: Option<ExitNodeLocation>,
    pub online: bool,
    pub currently_using: bool,
    pub mullvad: bool,
}

/// Exit node geographic location.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExitNodeLocation {
    pub country: String,
    pub country_code: String,
    pub city: String,
    pub city_code: String,
    pub priority: u32,
}

// ── Diagnostics ─────────────────────────────────────────────────

/// Health check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheck {
    pub overall: HealthStatus,
    pub warnings: Vec<HealthWarning>,
    pub errors: Vec<String>,
    pub checked_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HealthStatus {
    Healthy,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthWarning {
    pub code: String,
    pub text: String,
    pub severity: String,
    pub depends_on: Vec<String>,
}

// ── Service State Alias ─────────────────────────────────────────

pub type TailscaleServiceState = Arc<Mutex<crate::service::TailscaleService>>;
