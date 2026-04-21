//! # Network Manager Types
//!
//! Unified data types spanning nmcli, firewalld, iptables, nftables, ufw,
//! pf, Windows Firewall, interfaces, Wi-Fi, VLAN, bonding, bridging, and profiles.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

// ═══════════════════════════════════════════════════════════════════════
// Firewall Backends
// ═══════════════════════════════════════════════════════════════════════

/// Which firewall backend is active on a given host.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FirewallBackend {
    Firewalld,
    Iptables,
    Nftables,
    Ufw,
    Pf,
    WindowsFirewall,
    Unknown,
}

/// Overall firewall status for a host.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallStatus {
    pub backend: FirewallBackend,
    pub enabled: bool,
    pub version: Option<String>,
    pub default_zone: Option<String>,
    pub default_policy_in: Option<FirewallVerdict>,
    pub default_policy_out: Option<FirewallVerdict>,
    pub default_policy_fwd: Option<FirewallVerdict>,
    pub active_rules_count: u32,
    pub logging_enabled: bool,
    pub checked_at: DateTime<Utc>,
}

/// Verdict / action for a firewall rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FirewallVerdict {
    Accept,
    Drop,
    Reject,
    Log,
    Return,
    Queue,
    Continue,
    Jump,
    Mark,
    Masquerade,
    Snat,
    Dnat,
    Redirect,
    Limit,
}

/// Protocol for firewall rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FirewallProtocol {
    Tcp,
    Udp,
    Icmp,
    Icmpv6,
    Sctp,
    Dccp,
    Esp,
    Ah,
    Gre,
    All,
    Custom(u8),
}

/// IP version selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IpFamily {
    IPv4,
    IPv6,
    Both,
}

// ── Unified Firewall Rule ──────────────────────────────────────

/// A single firewall rule in unified representation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallRule {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub backend: FirewallBackend,
    pub direction: RuleDirection,
    pub action: FirewallVerdict,
    pub protocol: Option<FirewallProtocol>,
    pub ip_family: IpFamily,
    pub source_addr: Option<String>,
    pub source_port: Option<String>,
    pub dest_addr: Option<String>,
    pub dest_port: Option<String>,
    pub interface_in: Option<String>,
    pub interface_out: Option<String>,
    pub chain: Option<String>,
    pub table: Option<String>,
    pub zone: Option<String>,
    pub priority: Option<i32>,
    pub enabled: bool,
    pub persistent: bool,
    pub comment: Option<String>,
    pub log_prefix: Option<String>,
    pub rate_limit: Option<RateLimit>,
    pub conntrack_state: Vec<ConntrackState>,
    pub created_at: Option<DateTime<Utc>>,
    pub raw_rule: Option<String>,
}

/// Direction of a firewall rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuleDirection {
    Inbound,
    Outbound,
    Forward,
    PreRouting,
    PostRouting,
}

/// Rate limit parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimit {
    pub rate: u32,
    pub unit: RateLimitUnit,
    pub burst: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RateLimitUnit {
    Second,
    Minute,
    Hour,
    Day,
}

/// Connection tracking state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConntrackState {
    New,
    Established,
    Related,
    Invalid,
    Untracked,
}

// ═══════════════════════════════════════════════════════════════════════
// firewalld-specific
// ═══════════════════════════════════════════════════════════════════════

/// A firewalld zone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewalldZone {
    pub name: String,
    pub description: String,
    pub target: FirewallVerdict,
    pub interfaces: Vec<String>,
    pub sources: Vec<String>,
    pub services: Vec<String>,
    pub ports: Vec<FirewalldPort>,
    pub protocols: Vec<String>,
    pub masquerade: bool,
    pub forward_ports: Vec<FirewalldForwardPort>,
    pub rich_rules: Vec<String>,
    pub icmp_blocks: Vec<String>,
    pub icmp_block_inversion: bool,
    pub is_active: bool,
    pub is_default: bool,
}

/// A port entry in firewalld.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewalldPort {
    pub port: String,
    pub protocol: String,
}

/// A port-forwarding entry in firewalld.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewalldForwardPort {
    pub port: String,
    pub protocol: String,
    pub to_port: Option<String>,
    pub to_addr: Option<String>,
}

/// A firewalld service definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewalldService {
    pub name: String,
    pub description: String,
    pub ports: Vec<FirewalldPort>,
    pub protocols: Vec<String>,
    pub source_ports: Vec<FirewalldPort>,
    pub modules: Vec<String>,
    pub destinations: HashMap<String, String>,
}

/// A firewalld rich rule (structured).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewalldRichRule {
    pub family: Option<IpFamily>,
    pub source: Option<String>,
    pub destination: Option<String>,
    pub service: Option<String>,
    pub port: Option<FirewalldPort>,
    pub protocol: Option<String>,
    pub icmp_block: Option<String>,
    pub icmp_type: Option<String>,
    pub masquerade: bool,
    pub forward_port: Option<FirewalldForwardPort>,
    pub action: FirewallVerdict,
    pub log: Option<RichRuleLog>,
    pub audit: bool,
    pub limit: Option<RateLimit>,
    pub raw: String,
}

/// Logging config for a rich rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RichRuleLog {
    pub prefix: Option<String>,
    pub level: Option<String>,
    pub limit: Option<RateLimit>,
}

// ═══════════════════════════════════════════════════════════════════════
// iptables-specific
// ═══════════════════════════════════════════════════════════════════════

/// An iptables table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IptablesTable {
    Filter,
    Nat,
    Mangle,
    Raw,
    Security,
}

/// An iptables chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IptablesChain {
    pub name: String,
    pub table: IptablesTable,
    pub policy: Option<FirewallVerdict>,
    pub packets: u64,
    pub bytes: u64,
    pub is_builtin: bool,
    pub rules: Vec<IptablesRule>,
}

/// A single iptables rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IptablesRule {
    pub num: u32,
    pub target: String,
    pub protocol: String,
    pub opt: String,
    pub source: String,
    pub destination: String,
    pub extra: String,
    pub packets: u64,
    pub bytes: u64,
}

/// Saved iptables ruleset.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IptablesSave {
    pub tables: HashMap<String, Vec<String>>,
    pub generated_at: DateTime<Utc>,
}

// ═══════════════════════════════════════════════════════════════════════
// nftables-specific
// ═══════════════════════════════════════════════════════════════════════

/// An nftables table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NftTable {
    pub name: String,
    pub family: NftFamily,
    pub handle: u32,
    pub chains: Vec<NftChain>,
    pub sets: Vec<NftSet>,
}

/// nftables address family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NftFamily {
    Ip,
    Ip6,
    Inet,
    Arp,
    Bridge,
    Netdev,
}

/// An nftables chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NftChain {
    pub name: String,
    pub chain_type: Option<NftChainType>,
    pub hook: Option<String>,
    pub priority: Option<i32>,
    pub policy: Option<FirewallVerdict>,
    pub handle: u32,
    pub rules: Vec<NftRule>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NftChainType {
    Filter,
    Nat,
    Route,
}

/// An nftables rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NftRule {
    pub handle: u32,
    pub expr: String,
    pub comment: Option<String>,
    pub counter_packets: Option<u64>,
    pub counter_bytes: Option<u64>,
}

/// An nftables named set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NftSet {
    pub name: String,
    pub set_type: String,
    pub flags: Vec<String>,
    pub elements: Vec<String>,
    pub timeout: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════
// ufw-specific
// ═══════════════════════════════════════════════════════════════════════

/// UFW global status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UfwStatus {
    pub enabled: bool,
    pub default_incoming: FirewallVerdict,
    pub default_outgoing: FirewallVerdict,
    pub default_routed: FirewallVerdict,
    pub logging: UfwLogLevel,
    pub rules: Vec<UfwRule>,
}

/// UFW logging level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UfwLogLevel {
    Off,
    Low,
    Medium,
    High,
    Full,
}

/// A single UFW rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UfwRule {
    pub number: u32,
    pub action: FirewallVerdict,
    pub direction: RuleDirection,
    pub from: String,
    pub to: String,
    pub port: Option<String>,
    pub protocol: Option<String>,
    pub interface: Option<String>,
    pub comment: Option<String>,
    pub v6: bool,
}

/// UFW application profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UfwAppProfile {
    pub name: String,
    pub title: String,
    pub description: String,
    pub ports: String,
}

// ═══════════════════════════════════════════════════════════════════════
// pf-specific (BSD/macOS)
// ═══════════════════════════════════════════════════════════════════════

/// PF status info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfStatus {
    pub enabled: bool,
    pub running_since: Option<DateTime<Utc>>,
    pub states_current: u64,
    pub states_searches: u64,
    pub states_inserts: u64,
    pub states_removals: u64,
    pub debug_level: String,
    pub counters: PfCounters,
}

/// PF packet counters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfCounters {
    pub passed_ipv4: u64,
    pub passed_ipv6: u64,
    pub blocked_ipv4: u64,
    pub blocked_ipv6: u64,
}

/// A PF table (address list).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfTable {
    pub name: String,
    pub addresses: Vec<String>,
    pub flags: Vec<String>,
    pub count: u32,
}

/// A PF anchor (sub-ruleset namespace).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfAnchor {
    pub name: String,
    pub path: String,
    pub rules: Vec<String>,
    pub evaluations: u64,
    pub packets: u64,
    pub bytes: u64,
}

// ═══════════════════════════════════════════════════════════════════════
// Windows Firewall (netsh advfirewall)
// ═══════════════════════════════════════════════════════════════════════

/// Windows Firewall profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WinFwProfile {
    Domain,
    Private,
    Public,
    All,
}

/// Status of a Windows Firewall profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WinFwProfileStatus {
    pub profile: WinFwProfile,
    pub enabled: bool,
    pub default_inbound: FirewallVerdict,
    pub default_outbound: FirewallVerdict,
    pub log_allowed: bool,
    pub log_dropped: bool,
    pub log_file: Option<String>,
    pub log_max_size_kb: Option<u32>,
    pub notification: bool,
    pub unicast_response: bool,
}

/// A Windows Firewall rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WinFwRule {
    pub name: String,
    pub display_name: String,
    pub description: Option<String>,
    pub direction: RuleDirection,
    pub action: FirewallVerdict,
    pub enabled: bool,
    pub profiles: Vec<WinFwProfile>,
    pub program: Option<String>,
    pub service: Option<String>,
    pub protocol: Option<String>,
    pub local_port: Option<String>,
    pub remote_port: Option<String>,
    pub local_address: Option<String>,
    pub remote_address: Option<String>,
    pub icmp_type: Option<String>,
    pub group: Option<String>,
    pub interface_types: Vec<String>,
    pub edge_traversal: bool,
}

// ═══════════════════════════════════════════════════════════════════════
// NetworkManager / nmcli
// ═══════════════════════════════════════════════════════════════════════

/// An nmcli connection profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NmConnection {
    pub uuid: String,
    pub name: String,
    pub conn_type: NmConnectionType,
    pub device: Option<String>,
    pub active: bool,
    pub autoconnect: bool,
    pub ipv4_method: Option<String>,
    pub ipv4_addresses: Vec<String>,
    pub ipv4_gateway: Option<String>,
    pub ipv4_dns: Vec<String>,
    pub ipv6_method: Option<String>,
    pub ipv6_addresses: Vec<String>,
    pub ipv6_gateway: Option<String>,
    pub ipv6_dns: Vec<String>,
    pub zone: Option<String>,
    pub timestamp: Option<DateTime<Utc>>,
    pub read_only: bool,
    pub filename: Option<String>,
}

/// NetworkManager connection types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NmConnectionType {
    Ethernet,
    Wifi,
    WifiP2p,
    Bond,
    Bridge,
    Vlan,
    Team,
    Vpn,
    Wireguard,
    IpTunnel,
    Infiniband,
    Bluetooth,
    GsmCdma,
    Loopback,
    Pppoe,
    Tun,
    Dummy,
    MacVlan,
    VxLan,
    Unknown,
}

/// An nmcli device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NmDevice {
    pub device: String,
    pub device_type: String,
    pub state: NmDeviceState,
    pub connection: Option<String>,
    pub ip4_address: Option<String>,
    pub ip6_address: Option<String>,
    pub hw_address: Option<String>,
    pub mtu: Option<u32>,
    pub driver: Option<String>,
    pub autoconnect: bool,
}

/// NetworkManager device states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NmDeviceState {
    Unknown,
    Unmanaged,
    Unavailable,
    Disconnected,
    Prepare,
    Config,
    NeedAuth,
    IpConfig,
    IpCheck,
    Secondaries,
    Activated,
    Deactivating,
    Failed,
}

/// Global NetworkManager status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NmGeneralStatus {
    pub state: String,
    pub connectivity: NmConnectivity,
    pub wifi_enabled: bool,
    pub wifi_hw_enabled: bool,
    pub wwan_enabled: bool,
    pub wwan_hw_enabled: bool,
    pub networking_enabled: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NmConnectivity {
    Unknown,
    None,
    Portal,
    Limited,
    Full,
}

// ═══════════════════════════════════════════════════════════════════════
// Wi-Fi
// ═══════════════════════════════════════════════════════════════════════

/// A scanned Wi-Fi access point.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WifiAccessPoint {
    pub ssid: String,
    pub bssid: String,
    pub mode: WifiMode,
    pub channel: u32,
    pub frequency: u32,
    pub signal_strength: i32,
    pub security: Vec<WifiSecurity>,
    pub connected: bool,
    pub rate_mbps: Option<u32>,
    pub seen_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WifiMode {
    Infrastructure,
    AdHoc,
    Ap,
    Mesh,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WifiSecurity {
    Open,
    Wep,
    WpaPsk,
    Wpa2Psk,
    Wpa3Sae,
    WpaEnterprise,
    Wpa2Enterprise,
    Wpa3Enterprise,
    Owe,
}

/// Wi-Fi hotspot configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WifiHotspot {
    pub ssid: String,
    pub password: Option<String>,
    pub band: WifiBand,
    pub channel: Option<u32>,
    pub hidden: bool,
    pub interface: Option<String>,
    pub security: WifiSecurity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WifiBand {
    Bg,
    A,
    Auto,
}

// ═══════════════════════════════════════════════════════════════════════
// Interface / VLAN / Bond / Bridge
// ═══════════════════════════════════════════════════════════════════════

/// A network interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInterface {
    pub name: String,
    pub iface_type: InterfaceType,
    pub state: InterfaceState,
    pub mac_address: Option<String>,
    pub mtu: u32,
    pub speed_mbps: Option<u32>,
    pub duplex: Option<Duplex>,
    pub ipv4_addresses: Vec<String>,
    pub ipv6_addresses: Vec<String>,
    pub flags: Vec<String>,
    pub tx_bytes: u64,
    pub rx_bytes: u64,
    pub tx_packets: u64,
    pub rx_packets: u64,
    pub tx_errors: u64,
    pub rx_errors: u64,
    pub tx_dropped: u64,
    pub rx_dropped: u64,
    pub driver: Option<String>,
    pub firmware_version: Option<String>,
    pub pci_bus: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InterfaceType {
    Ethernet,
    Wireless,
    Loopback,
    Bridge,
    Bond,
    Vlan,
    Tun,
    Tap,
    Veth,
    MacVlan,
    VxLan,
    Dummy,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InterfaceState {
    Up,
    Down,
    LowerLayerDown,
    Dormant,
    NotPresent,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Duplex {
    Full,
    Half,
    Unknown,
}

/// VLAN configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VlanConfig {
    pub id: u16,
    pub name: String,
    pub parent_interface: String,
    pub protocol: VlanProtocol,
    pub flags: Vec<String>,
    pub ingress_qos_map: Vec<String>,
    pub egress_qos_map: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VlanProtocol {
    Ieee802_1Q,
    Ieee802_1Ad,
}

/// Bond configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BondConfig {
    pub name: String,
    pub mode: BondMode,
    pub slaves: Vec<String>,
    pub primary: Option<String>,
    pub miimon: u32,
    pub updelay: u32,
    pub downdelay: u32,
    pub lacp_rate: Option<LacpRate>,
    pub xmit_hash_policy: Option<String>,
    pub arp_interval: Option<u32>,
    pub arp_ip_targets: Vec<String>,
    pub active_slave: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BondMode {
    BalanceRr,
    ActiveBackup,
    BalanceXor,
    Broadcast,
    Ieee802_3ad,
    BalanceTlb,
    BalanceAlb,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LacpRate {
    Slow,
    Fast,
}

/// Bridge configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeConfig {
    pub name: String,
    pub ports: Vec<String>,
    pub stp_enabled: bool,
    pub forward_delay: u32,
    pub hello_time: u32,
    pub max_age: u32,
    pub ageing_time: u32,
    pub priority: u32,
    pub vlan_filtering: bool,
}

// ═══════════════════════════════════════════════════════════════════════
// Network Profiles
// ═══════════════════════════════════════════════════════════════════════

/// A named network profile (location-based configuration).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub detect_rules: Vec<ProfileDetectRule>,
    pub firewall_zone: Option<String>,
    pub dns_servers: Vec<String>,
    pub proxy: Option<ProxyConfig>,
    pub auto_vpn: Option<String>,
    pub auto_connections: Vec<String>,
    pub active: bool,
    pub priority: i32,
    pub created_at: DateTime<Utc>,
}

/// Rule for auto-detecting which profile to activate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileDetectRule {
    pub rule_type: DetectRuleType,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DetectRuleType {
    Ssid,
    Gateway,
    DnsSuffix,
    Subnet,
    Interface,
    PublicIp,
}

/// Proxy configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub proxy_type: ProxyType,
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
    pub ftp_proxy: Option<String>,
    pub socks_proxy: Option<String>,
    pub no_proxy: Vec<String>,
    pub pac_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProxyType {
    None,
    Manual,
    Auto,
    System,
}

// ═══════════════════════════════════════════════════════════════════════
// Diagnostics
// ═══════════════════════════════════════════════════════════════════════

/// Cross-backend health check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetMgrHealthCheck {
    pub backend: FirewallBackend,
    pub firewall_running: bool,
    pub nm_running: bool,
    pub nm_connectivity: Option<NmConnectivity>,
    pub interfaces_up: u32,
    pub interfaces_total: u32,
    pub default_route_present: bool,
    pub dns_resolving: bool,
    pub active_rules: u32,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub checked_at: DateTime<Utc>,
}

// ═══════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════

/// Events emitted by the network manager integration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NetMgrEvent {
    FirewallRuleAdded { rule_id: String },
    FirewallRuleRemoved { rule_id: String },
    FirewallEnabled { backend: FirewallBackend },
    FirewallDisabled { backend: FirewallBackend },
    ZoneChanged { zone: String, interface: String },
    InterfaceUp { name: String },
    InterfaceDown { name: String },
    ConnectionActivated { uuid: String, name: String },
    ConnectionDeactivated { uuid: String },
    WifiConnected { ssid: String },
    WifiDisconnected { interface: String },
    ProfileActivated { profile_id: String },
    HealthChanged { status: String },
}

// ═══════════════════════════════════════════════════════════════════════
// Service State Alias
// ═══════════════════════════════════════════════════════════════════════

pub type NetMgrServiceState = Arc<Mutex<crate::service::NetMgrService>>;
