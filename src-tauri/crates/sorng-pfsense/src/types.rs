//! All domain types for pfSense firewall management.

use serde::{Deserialize, Serialize};

// ── Connection ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfsenseConnectionConfig {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub api_secret: String,
    #[serde(default = "default_true")]
    pub use_tls: bool,
    #[serde(default)]
    pub accept_invalid_certs: bool,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_true() -> bool {
    true
}
fn default_timeout() -> u64 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfsenseConnectionSummary {
    pub host: String,
    pub version: String,
    pub hostname: String,
    pub platform: String,
}

// ── Interfaces ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfsenseInterface {
    pub name: String,
    #[serde(default)]
    pub if_descr: String,
    #[serde(default)]
    pub if_name: String,
    pub enabled: bool,
    #[serde(default)]
    pub ipaddr: String,
    #[serde(default)]
    pub subnet: String,
    #[serde(default)]
    pub ipaddrv6: String,
    #[serde(default)]
    pub subnetv6: String,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub gatewayv6: String,
    #[serde(default)]
    pub mac: String,
    #[serde(default)]
    pub media: String,
    #[serde(default)]
    pub mtu: u32,
    #[serde(default)]
    pub mss: u32,
    #[serde(default)]
    pub spoofmac: String,
    #[serde(rename = "type", default)]
    pub type_: String,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub blockpriv: bool,
    #[serde(default)]
    pub blockbogons: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceConfig {
    pub name: String,
    #[serde(default)]
    pub descr: String,
    pub enabled: bool,
    #[serde(default)]
    pub typev4: String,
    #[serde(default)]
    pub ipaddr: String,
    #[serde(default)]
    pub subnet: String,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub typev6: String,
    #[serde(default)]
    pub ipaddrv6: String,
    #[serde(default)]
    pub subnetv6: String,
    #[serde(default)]
    pub gatewayv6: String,
    #[serde(default)]
    pub mtu: u32,
    #[serde(default)]
    pub mss: u32,
    #[serde(default)]
    pub media: String,
    #[serde(default)]
    pub spoofmac: String,
    #[serde(default)]
    pub blockpriv: bool,
    #[serde(default)]
    pub blockbogons: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceStatus {
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub ipaddr: String,
    #[serde(default)]
    pub subnet: String,
    #[serde(default)]
    pub media: String,
    #[serde(default)]
    pub link_state: String,
    #[serde(default)]
    pub macaddr: String,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub mtu: u32,
    pub enabled: bool,
    #[serde(default)]
    pub bytes_in: u64,
    #[serde(default)]
    pub bytes_out: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceStats {
    pub name: String,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub packets_in: u64,
    pub packets_out: u64,
    pub errors_in: u64,
    pub errors_out: u64,
    pub collisions: u64,
    pub multicast_in: u64,
    pub multicast_out: u64,
    pub dropped_in: u64,
    pub dropped_out: u64,
}

// ── Firewall ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallRule {
    pub tracker: String,
    #[serde(rename = "type", default)]
    pub type_: String,
    #[serde(default)]
    pub interface: String,
    #[serde(default)]
    pub ipprotocol: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub source_port: String,
    #[serde(default)]
    pub destination: String,
    #[serde(default)]
    pub destination_port: String,
    #[serde(default)]
    pub descr: String,
    pub disabled: bool,
    #[serde(default)]
    pub log: bool,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub sched: String,
    #[serde(default)]
    pub os: String,
    #[serde(default)]
    pub tag: String,
    #[serde(default)]
    pub tagged: String,
    #[serde(default)]
    pub max: u32,
    #[serde(default)]
    pub max_src_nodes: u32,
    #[serde(default)]
    pub max_src_conn: u32,
    #[serde(default)]
    pub max_src_states: u32,
    #[serde(default)]
    pub statetimeout: u32,
    #[serde(default)]
    pub statetype: String,
    #[serde(default)]
    pub direction: String,
    #[serde(default)]
    pub floating: bool,
    #[serde(default)]
    pub quick: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallRuleConfig {
    #[serde(rename = "type", default)]
    pub type_: String,
    pub interface: String,
    #[serde(default)]
    pub ipprotocol: String,
    #[serde(default)]
    pub protocol: String,
    pub source: String,
    #[serde(default)]
    pub source_port: String,
    pub destination: String,
    #[serde(default)]
    pub destination_port: String,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub log: bool,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub sched: String,
    #[serde(default)]
    pub direction: String,
    #[serde(default)]
    pub floating: bool,
    #[serde(default)]
    pub quick: bool,
    #[serde(default)]
    pub top: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallAlias {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(default)]
    pub address: Vec<String>,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub detail: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallAliasConfig {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub address: Vec<String>,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub detail: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallState {
    pub total_entries: u64,
    pub current_entries: u64,
    #[serde(default)]
    pub states: Vec<FirewallStateEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallStateEntry {
    #[serde(default)]
    pub interface: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub destination: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub age: String,
    #[serde(default)]
    pub packets: u64,
    #[serde(default)]
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallLog {
    #[serde(default)]
    pub time: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub interface: String,
    #[serde(default)]
    pub direction: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub source_port: String,
    #[serde(default)]
    pub destination: String,
    #[serde(default)]
    pub destination_port: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub label: String,
}

// ── NAT ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatRule {
    pub id: String,
    #[serde(default)]
    pub interface: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub source_port: String,
    #[serde(default)]
    pub destination: String,
    #[serde(default)]
    pub destination_port: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub local_port: String,
    #[serde(default)]
    pub descr: String,
    pub disabled: bool,
    #[serde(default)]
    pub nordr: bool,
    #[serde(default)]
    pub associated_rule_id: String,
    #[serde(default)]
    pub natreflection: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatRuleConfig {
    pub interface: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub source_port: String,
    pub destination: String,
    pub destination_port: String,
    pub target: String,
    pub local_port: String,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub nordr: bool,
    #[serde(default)]
    pub natreflection: String,
    #[serde(default)]
    pub top: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatOutbound {
    pub id: String,
    #[serde(default)]
    pub interface: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub source_port: String,
    #[serde(default)]
    pub destination: String,
    #[serde(default)]
    pub destination_port: String,
    #[serde(default)]
    pub translation_address: String,
    #[serde(default)]
    pub translation_port: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub poolopts: String,
    #[serde(default)]
    pub descr: String,
    pub disabled: bool,
    #[serde(default)]
    pub nonat: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nat1to1 {
    pub id: String,
    #[serde(default)]
    pub interface: String,
    #[serde(default)]
    pub external: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub destination: String,
    #[serde(default)]
    pub descr: String,
    pub disabled: bool,
    #[serde(default)]
    pub nobinat: bool,
    #[serde(default)]
    pub natreflection: String,
}

// ── DHCP ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhcpConfig {
    pub interface: String,
    pub enabled: bool,
    #[serde(default)]
    pub range_from: String,
    #[serde(default)]
    pub range_to: String,
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub dns_servers: Vec<String>,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub default_lease_time: u64,
    #[serde(default)]
    pub max_lease_time: u64,
    #[serde(default)]
    pub wins_servers: Vec<String>,
    #[serde(default)]
    pub ntp_servers: Vec<String>,
    #[serde(default)]
    pub tftp_server: String,
    #[serde(default)]
    pub next_server: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub deny_unknown: bool,
    #[serde(default)]
    pub enable_static_arp: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhcpLease {
    pub ip: String,
    #[serde(rename = "type", default)]
    pub type_: String,
    #[serde(default)]
    pub mac: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub start: String,
    #[serde(default)]
    pub end: String,
    #[serde(default)]
    pub online: bool,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub interface: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhcpStaticMapping {
    #[serde(default)]
    pub id: String,
    pub mac: String,
    pub ipaddr: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub arp_table_static_entry: bool,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub dns_servers: Vec<String>,
    pub interface: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhcpRelay {
    pub enabled: bool,
    #[serde(default)]
    pub interface: Vec<String>,
    #[serde(default)]
    pub server: Vec<String>,
    #[serde(default)]
    pub append_agent_id: bool,
}

// ── DNS ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsResolverConfig {
    pub enabled: bool,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub active_interface: Vec<String>,
    #[serde(default)]
    pub outgoing_interface: Vec<String>,
    #[serde(default)]
    pub dnssec: bool,
    #[serde(default)]
    pub forwarding: bool,
    #[serde(default)]
    pub regdhcp: bool,
    #[serde(default)]
    pub regdhcpstatic: bool,
    #[serde(default)]
    pub custom_options: String,
    #[serde(default)]
    pub hide_identity: bool,
    #[serde(default)]
    pub hide_version: bool,
    #[serde(default)]
    pub prefetch: bool,
    #[serde(default)]
    pub prefetch_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsForwarderConfig {
    pub enabled: bool,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub interface: Vec<String>,
    #[serde(default)]
    pub regdhcp: bool,
    #[serde(default)]
    pub regdhcpstatic: bool,
    #[serde(default)]
    pub dhcpfirst: bool,
    #[serde(default)]
    pub strict_order: bool,
    #[serde(default)]
    pub domain_needed: bool,
    #[serde(default)]
    pub no_private_reverse: bool,
    #[serde(default)]
    pub custom_options: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsHostOverride {
    #[serde(default)]
    pub id: String,
    pub host: String,
    pub domain: String,
    pub ip: String,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub aliases: Vec<DnsHostAlias>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsHostAlias {
    pub host: String,
    pub domain: String,
    #[serde(default)]
    pub descr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsDomainOverride {
    #[serde(default)]
    pub id: String,
    pub domain: String,
    pub ip: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub tls_hostname: String,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub forward_tls_upstream: bool,
}

// ── VPN ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenVpnServer {
    pub vpnid: u32,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub dev_mode: String,
    #[serde(default)]
    pub interface: String,
    pub local_port: u16,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub tls_key: String,
    #[serde(default)]
    pub ca_ref: String,
    #[serde(default)]
    pub cert_ref: String,
    #[serde(default)]
    pub dh_length: u32,
    #[serde(default)]
    pub data_ciphers: String,
    #[serde(default)]
    pub digest: String,
    #[serde(default)]
    pub tunnel_network: String,
    #[serde(default)]
    pub tunnel_networkv6: String,
    #[serde(default)]
    pub remote_network: String,
    #[serde(default)]
    pub local_network: String,
    #[serde(default)]
    pub compression: String,
    pub enabled: bool,
    #[serde(default)]
    pub maxclients: u32,
    #[serde(default)]
    pub dns_server1: String,
    #[serde(default)]
    pub dns_server2: String,
    #[serde(default)]
    pub ntp_server1: String,
    #[serde(default)]
    pub push_register_dns: bool,
    #[serde(default)]
    pub topology: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenVpnClient {
    pub vpnid: u32,
    #[serde(default)]
    pub server_addr: String,
    pub server_port: u16,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub dev_mode: String,
    #[serde(default)]
    pub interface: String,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub ca_ref: String,
    #[serde(default)]
    pub cert_ref: String,
    #[serde(default)]
    pub tls_key: String,
    #[serde(default)]
    pub data_ciphers: String,
    #[serde(default)]
    pub digest: String,
    #[serde(default)]
    pub tunnel_network: String,
    #[serde(default)]
    pub remote_network: String,
    #[serde(default)]
    pub compression: String,
    pub enabled: bool,
    #[serde(default)]
    pub auth_user: String,
    #[serde(default)]
    pub auth_pass: String,
    #[serde(default)]
    pub topology: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpsecTunnel {
    pub ikeid: u32,
    pub phase1: IpsecPhase1,
    #[serde(default)]
    pub phase2: Vec<IpsecPhase2>,
    pub enabled: bool,
    #[serde(default)]
    pub descr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpsecPhase1 {
    pub ikeid: u32,
    #[serde(default)]
    pub iketype: String,
    #[serde(default)]
    pub interface: String,
    #[serde(default)]
    pub remote_gateway: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub myid_type: String,
    #[serde(default)]
    pub myid_data: String,
    #[serde(default)]
    pub peerid_type: String,
    #[serde(default)]
    pub peerid_data: String,
    #[serde(default)]
    pub pre_shared_key: String,
    #[serde(default)]
    pub cert_ref: String,
    #[serde(default)]
    pub ca_ref: String,
    #[serde(default)]
    pub encryption_algorithm: String,
    #[serde(default)]
    pub hash_algorithm: String,
    #[serde(default)]
    pub dh_group: u32,
    #[serde(default)]
    pub lifetime: u64,
    pub disabled: bool,
    #[serde(default)]
    pub nat_traversal: String,
    #[serde(default)]
    pub mobike: String,
    #[serde(default)]
    pub dpd_delay: u32,
    #[serde(default)]
    pub dpd_maxfail: u32,
    #[serde(default)]
    pub descr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpsecPhase2 {
    #[serde(default)]
    pub uniqid: String,
    pub ikeid: u32,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub localid_type: String,
    #[serde(default)]
    pub localid_address: String,
    #[serde(default)]
    pub localid_netbits: u32,
    #[serde(default)]
    pub remoteid_type: String,
    #[serde(default)]
    pub remoteid_address: String,
    #[serde(default)]
    pub remoteid_netbits: u32,
    #[serde(default)]
    pub encryption_algorithm: String,
    #[serde(default)]
    pub hash_algorithm: String,
    #[serde(default)]
    pub pfsgroup: u32,
    #[serde(default)]
    pub lifetime: u64,
    pub disabled: bool,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub descr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireGuardTunnel {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub listen_port: u16,
    #[serde(default)]
    pub private_key: String,
    #[serde(default)]
    pub public_key: String,
    #[serde(default)]
    pub addresses: Vec<String>,
    #[serde(default)]
    pub dns_servers: Vec<String>,
    #[serde(default)]
    pub mtu: u32,
    pub enabled: bool,
    #[serde(default)]
    pub descr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireGuardPeer {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub tunnel_id: String,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub public_key: String,
    #[serde(default)]
    pub preshared_key: String,
    #[serde(default)]
    pub allowed_ips: Vec<String>,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub endpoint_port: u16,
    #[serde(default)]
    pub persistent_keepalive: u32,
}

// ── Routing ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaticRoute {
    #[serde(default)]
    pub id: String,
    pub network: String,
    pub gateway: String,
    #[serde(default)]
    pub descr: String,
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Gateway {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub interface: String,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub monitor: String,
    #[serde(default)]
    pub descr: String,
    pub disabled: bool,
    #[serde(default)]
    pub default_gw: bool,
    #[serde(default)]
    pub weight: u32,
    #[serde(default)]
    pub ipprotocol: String,
    #[serde(default)]
    pub interval: u32,
    #[serde(default)]
    pub loss_interval: u32,
    #[serde(default)]
    pub time_period: u32,
    #[serde(default)]
    pub alert_interval: u32,
    #[serde(default)]
    pub latencylow: u32,
    #[serde(default)]
    pub latencyhigh: u32,
    #[serde(default)]
    pub losslow: u32,
    #[serde(default)]
    pub losshigh: u32,
    #[serde(default)]
    pub action_disable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayGroup {
    pub name: String,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub trigger: String,
    #[serde(default)]
    pub members: Vec<GatewayGroupMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayGroupMember {
    pub gateway: String,
    pub tier: u32,
    #[serde(default)]
    pub virtual_ip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayStatus {
    pub name: String,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub monitor: String,
    pub status: String,
    #[serde(default)]
    pub delay: String,
    #[serde(default)]
    pub stddev: String,
    #[serde(default)]
    pub loss: String,
    #[serde(default)]
    pub substatus: String,
}

// ── Services ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfsenseService {
    pub name: String,
    #[serde(default)]
    pub descr: String,
    pub enabled: bool,
    pub status: bool,
    #[serde(default)]
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub name: String,
    pub running: bool,
    #[serde(default)]
    pub pid: String,
    #[serde(default)]
    pub descr: String,
    pub enabled: bool,
}

// ── System ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub hostname: String,
    pub domain: String,
    pub version: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub serial: String,
    #[serde(default)]
    pub netgate_id: String,
    pub uptime: String,
    #[serde(default)]
    pub cpu_model: String,
    pub cpu_count: u32,
    #[serde(default)]
    pub cpu_usage: String,
    pub mem_total: u64,
    pub mem_used: u64,
    #[serde(default)]
    pub swap_total: u64,
    #[serde(default)]
    pub swap_used: u64,
    #[serde(default)]
    pub disk_usage: String,
    #[serde(default)]
    pub temp: String,
    pub load_avg: Vec<String>,
    #[serde(default)]
    pub bios_vendor: String,
    #[serde(default)]
    pub bios_version: String,
    #[serde(default)]
    pub bios_date: String,
    #[serde(default)]
    pub kernel_pti: bool,
    #[serde(default)]
    pub mds_mitigation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemUpdate {
    pub version: String,
    pub installed_version: String,
    pub update_available: bool,
    #[serde(default)]
    pub latest_version: String,
    #[serde(default)]
    pub pkg_updates: Vec<PackageUpdate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageUpdate {
    pub name: String,
    pub current_version: String,
    pub new_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralConfig {
    pub hostname: String,
    pub domain: String,
    #[serde(default)]
    pub dns_servers: Vec<String>,
    #[serde(default)]
    pub timezone: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub theme: String,
    #[serde(default)]
    pub webgui_protocol: String,
    #[serde(default)]
    pub webgui_port: u16,
    #[serde(default)]
    pub webgui_ssl_cert_ref: String,
    #[serde(default)]
    pub dns_allow_override: bool,
    #[serde(default)]
    pub already_run_wizard: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedConfig {
    #[serde(default)]
    pub scrub_rnid: bool,
    #[serde(default)]
    pub optimization: String,
    #[serde(default)]
    pub max_states: u64,
    #[serde(default)]
    pub max_table_entries: u64,
    #[serde(default)]
    pub max_frags: u64,
    #[serde(default)]
    pub adaptive_start: u64,
    #[serde(default)]
    pub adaptive_end: u64,
    #[serde(default)]
    pub alias_resolve_interval: u32,
    #[serde(default)]
    pub check_cert_ca: bool,
    #[serde(default)]
    pub bogonsinterval: String,
    #[serde(default)]
    pub powerd_enable: bool,
    #[serde(default)]
    pub powerd_ac_mode: String,
    #[serde(default)]
    pub powerd_battery_mode: String,
    #[serde(default)]
    pub crypto_hardware: String,
    #[serde(default)]
    pub thermal_hardware: String,
    #[serde(default)]
    pub disable_pf_scrub: bool,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default)]
    pub proxy_port: u16,
    #[serde(default)]
    pub proxy_user: String,
    #[serde(default)]
    pub proxy_pass: String,
}

// ── Certificates ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaCertificate {
    #[serde(default)]
    pub refid: String,
    pub descr: String,
    #[serde(default)]
    pub crt: String,
    #[serde(default)]
    pub prv: String,
    #[serde(default)]
    pub serial: String,
    #[serde(default)]
    pub distinguished_name: String,
    #[serde(default)]
    pub valid_from: String,
    #[serde(default)]
    pub valid_to: String,
    #[serde(default)]
    pub key_length: u32,
    #[serde(default)]
    pub hash_algo: String,
    #[serde(default)]
    pub issuer: String,
    #[serde(default)]
    pub in_use: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerCertificate {
    #[serde(default)]
    pub refid: String,
    pub descr: String,
    #[serde(default)]
    pub ca_ref: String,
    #[serde(default)]
    pub crt: String,
    #[serde(default)]
    pub prv: String,
    #[serde(default)]
    pub csr: String,
    #[serde(rename = "type", default)]
    pub type_: String,
    #[serde(default)]
    pub distinguished_name: String,
    #[serde(default)]
    pub valid_from: String,
    #[serde(default)]
    pub valid_to: String,
    #[serde(default)]
    pub key_length: u32,
    #[serde(default)]
    pub hash_algo: String,
    #[serde(default)]
    pub san: Vec<String>,
    #[serde(default)]
    pub issuer: String,
    #[serde(default)]
    pub serial: String,
    #[serde(default)]
    pub in_use: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateRequest {
    pub descr: String,
    #[serde(default)]
    pub key_length: u32,
    #[serde(default)]
    pub digest_alg: String,
    #[serde(default)]
    pub lifetime: u32,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub city: String,
    #[serde(default)]
    pub organization: String,
    #[serde(default)]
    pub organizational_unit: String,
    #[serde(default)]
    pub common_name: String,
    #[serde(default)]
    pub alt_names: Vec<String>,
    #[serde(rename = "type", default)]
    pub type_: String,
    #[serde(default)]
    pub ca_ref: String,
}

// ── Users ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfsenseUser {
    #[serde(default)]
    pub uid: u32,
    pub name: String,
    #[serde(default)]
    pub full_name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub comment: String,
    pub disabled: bool,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub groups: Vec<String>,
    #[serde(default)]
    pub cert_refs: Vec<String>,
    #[serde(default)]
    pub authorizedkeys: String,
    #[serde(default)]
    pub ipsecpsk: String,
    #[serde(default)]
    pub expires: String,
    #[serde(default)]
    pub dashboard_columns: u32,
    #[serde(default)]
    pub webguicss: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfsenseGroup {
    #[serde(default)]
    pub gid: u32,
    pub name: String,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub members: Vec<String>,
    #[serde(default)]
    pub priv_list: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPrivilege {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub descr: String,
    #[serde(default)]
    pub match_: String,
}

// ── Diagnostics ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArpEntry {
    pub ip: String,
    pub mac: String,
    #[serde(default)]
    pub interface: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub expires: String,
    #[serde(rename = "type", default)]
    pub type_: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub link_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NdpEntry {
    pub ipv6: String,
    pub mac: String,
    #[serde(default)]
    pub interface: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub expires: String,
    #[serde(default)]
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsLookupResult {
    pub query: String,
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(default)]
    pub results: Vec<DnsLookupRecord>,
    #[serde(default)]
    pub resolver: String,
    #[serde(default)]
    pub query_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsLookupRecord {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub ttl: u32,
    #[serde(default)]
    pub class: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingResult {
    pub host: String,
    pub count: u32,
    pub transmitted: u32,
    pub received: u32,
    #[serde(default)]
    pub loss_pct: f64,
    #[serde(default)]
    pub min_rtt: f64,
    #[serde(default)]
    pub avg_rtt: f64,
    #[serde(default)]
    pub max_rtt: f64,
    #[serde(default)]
    pub stddev_rtt: f64,
    #[serde(default)]
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceResult {
    pub host: String,
    #[serde(default)]
    pub hops: Vec<TraceHop>,
    #[serde(default)]
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceHop {
    pub hop: u32,
    #[serde(default)]
    pub ip: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub rtt1: String,
    #[serde(default)]
    pub rtt2: String,
    #[serde(default)]
    pub rtt3: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IfStats {
    pub interface: String,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub packets_in: u64,
    pub packets_out: u64,
    pub errors_in: u64,
    pub errors_out: u64,
    pub collisions: u64,
    #[serde(default)]
    pub speed: String,
    #[serde(default)]
    pub media: String,
    #[serde(default)]
    pub status: String,
}

// ── Backups ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfig {
    #[serde(default)]
    pub area: String,
    #[serde(default)]
    pub no_rrd: bool,
    #[serde(default)]
    pub no_packages: bool,
    #[serde(default)]
    pub encrypt: bool,
    #[serde(default)]
    pub encrypt_password: String,
    #[serde(default)]
    pub skip_captive_portal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupEntry {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub timestamp: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub config_type: String,
}

// ── API response wrappers ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub status: String,
    pub code: u16,
    #[serde(rename = "return")]
    pub return_code: i32,
    pub message: String,
    pub data: T,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiListResponse<T> {
    pub status: String,
    pub code: u16,
    #[serde(rename = "return")]
    pub return_code: i32,
    pub message: String,
    pub data: Vec<T>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsCacheStats {
    pub total_entries: u64,
    #[serde(default)]
    pub rrset_count: u64,
    #[serde(default)]
    pub msg_count: u64,
    #[serde(default)]
    pub infra_count: u64,
    #[serde(default)]
    pub key_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingTableEntry {
    #[serde(default)]
    pub destination: String,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub flags: String,
    #[serde(default)]
    pub netif: String,
    #[serde(default)]
    pub expire: String,
}

// ── Type Aliases ─────────────────────────────────────────────────

/// Alias used by domain modules for interface types.
pub type NetworkInterface = PfsenseInterface;

/// Alias used by domain modules for NAT port-forward rules.
pub type NatPortForward = NatRule;
