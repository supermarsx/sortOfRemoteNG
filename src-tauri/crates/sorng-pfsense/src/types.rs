//! All domain types for pfSense/OPNsense management.

use serde::{Deserialize, Serialize};

// ── Connection ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfsenseConnectionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub api_secret: String,
    #[serde(default = "default_true")]
    pub tls_verify: bool,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    #[serde(default)]
    pub appliance_type: PfsenseApplianceType,
}

fn default_true() -> bool { true }
fn default_timeout() -> u64 { 30 }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PfsenseApplianceType {
    #[default]
    PfSense,
    OPNsense,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfsenseConnectionSummary {
    pub host: String,
    pub version: String,
    pub hostname: String,
    pub platform: String,
    pub appliance_type: PfsenseApplianceType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ── Interfaces ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfsenseInterface {
    pub name: String,
    pub if_name: String,
    pub status: String,
    #[serde(default)]
    pub ipaddr: String,
    #[serde(default)]
    pub subnet: String,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub mac: String,
    #[serde(default)]
    pub media: String,
    #[serde(default)]
    pub mtu: u32,
    pub enabled: bool,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "type", default)]
    pub type_: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceStats {
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub packets_in: u64,
    pub packets_out: u64,
    pub errors_in: u64,
    pub errors_out: u64,
    pub collisions: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VlanConfig {
    pub tag: u16,
    pub parent_if: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub priority: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateVlanRequest {
    pub tag: u16,
    pub parent_if: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub priority: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssignInterfaceRequest {
    pub if_name: String,
    pub name: String,
    #[serde(default)]
    pub ipaddr: String,
    #[serde(default)]
    pub subnet: String,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

// ── Firewall Rules ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallRule {
    pub id: String,
    #[serde(default)]
    pub tracker: String,
    #[serde(rename = "type", default)]
    pub type_: RuleType,
    pub interface: String,
    #[serde(default)]
    pub ip_protocol: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub source: RuleAddress,
    #[serde(default)]
    pub destination: RuleAddress,
    #[serde(default)]
    pub port: String,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub log: bool,
    #[serde(default = "default_true")]
    pub quick: bool,
    #[serde(default)]
    pub floating: bool,
    #[serde(default)]
    pub direction: String,
    #[serde(default)]
    pub states: u64,
    #[serde(default)]
    pub bytes: u64,
    #[serde(default)]
    pub evaluations: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RuleType {
    #[default]
    Pass,
    Block,
    Reject,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RuleAddress {
    #[serde(default)]
    pub network: String,
    #[serde(default)]
    pub port: String,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub not_: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFirewallRuleRequest {
    #[serde(rename = "type")]
    pub type_: RuleType,
    pub interface: String,
    #[serde(default)]
    pub ip_protocol: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub source: RuleAddress,
    #[serde(default)]
    pub destination: RuleAddress,
    #[serde(default)]
    pub port: String,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub log: bool,
    #[serde(default = "default_true")]
    pub quick: bool,
    #[serde(default)]
    pub floating: bool,
    #[serde(default)]
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateFirewallRuleRequest {
    #[serde(rename = "type")]
    pub type_: Option<RuleType>,
    pub interface: Option<String>,
    pub ip_protocol: Option<String>,
    pub protocol: Option<String>,
    pub source: Option<RuleAddress>,
    pub destination: Option<RuleAddress>,
    pub port: Option<String>,
    pub gateway: Option<String>,
    pub description: Option<String>,
    pub disabled: Option<bool>,
    pub log: Option<bool>,
    pub quick: Option<bool>,
    pub floating: Option<bool>,
    pub direction: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallAlias {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: AliasType,
    pub address: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AliasType {
    #[default]
    Host,
    Network,
    Port,
    Url,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAliasRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: AliasType,
    pub address: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallSchedule {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub time_ranges: Vec<ScheduleTimeRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleTimeRange {
    pub month: String,
    pub day: String,
    pub hour: String,
    pub position: String,
    #[serde(default)]
    pub description: String,
}

// ── NAT ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatRule {
    pub id: String,
    pub interface: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub source: String,
    pub destination: String,
    pub target: String,
    #[serde(default)]
    pub local_port: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub associated_rule: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum NatType {
    #[default]
    PortForward,
    OneToOne,
    Outbound,
    Npt,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNatRuleRequest {
    pub interface: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub source: String,
    pub destination: String,
    pub target: String,
    #[serde(default)]
    pub local_port: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboundNatRule {
    pub id: String,
    pub interface: String,
    #[serde(default)]
    pub protocol: String,
    pub source: String,
    pub destination: String,
    pub target: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub no_nat: bool,
    #[serde(default)]
    pub static_port: bool,
    #[serde(default)]
    pub pool_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OutboundNatMode {
    #[default]
    Automatic,
    Hybrid,
    Manual,
    Disabled,
}

// ── DHCP ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhcpServerConfig {
    pub interface: String,
    pub enable: bool,
    pub range_from: String,
    pub range_to: String,
    #[serde(default)]
    pub dns_servers: Vec<String>,
    #[serde(default)]
    pub gateway: String,
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub default_lease_time: u64,
    #[serde(default)]
    pub max_lease_time: u64,
    #[serde(default)]
    pub static_mappings: Vec<DhcpStaticMapping>,
    #[serde(default)]
    pub wins_servers: Vec<String>,
    #[serde(default)]
    pub ntp_servers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhcpStaticMapping {
    pub mac: String,
    pub ipaddr: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhcpLease {
    pub ip: String,
    pub mac: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub start: String,
    #[serde(default)]
    pub end: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub binding_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateDhcpConfigRequest {
    pub interface: String,
    pub enable: Option<bool>,
    pub range_from: Option<String>,
    pub range_to: Option<String>,
    pub dns_servers: Option<Vec<String>>,
    pub gateway: Option<String>,
    pub domain: Option<String>,
    pub default_lease_time: Option<u64>,
    pub max_lease_time: Option<u64>,
    pub wins_servers: Option<Vec<String>>,
    pub ntp_servers: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DhcpPoolStats {
    pub interface: String,
    pub total: u64,
    pub active: u64,
    pub available: u64,
    pub range_from: String,
    pub range_to: String,
}

// ── DNS ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsResolverConfig {
    pub enable: bool,
    #[serde(default)]
    pub forwarding: bool,
    #[serde(default)]
    pub dnssec: bool,
    #[serde(default)]
    pub host_overrides: Vec<DnsHostOverride>,
    #[serde(default)]
    pub domain_overrides: Vec<DnsDomainOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsForwarderConfig {
    pub enable: bool,
    #[serde(default)]
    pub host_overrides: Vec<DnsHostOverride>,
    #[serde(default)]
    pub domain_overrides: Vec<DnsDomainOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsHostOverride {
    pub host: String,
    pub domain: String,
    pub ip: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsDomainOverride {
    pub domain: String,
    pub ip: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tls_hostname: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynDnsConfig {
    #[serde(rename = "type")]
    pub type_: String,
    pub interface: String,
    pub host: String,
    pub domain: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub update_url: String,
}

// ── VPN ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpsecTunnel {
    pub ikeid: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub disabled: bool,
    pub interface: String,
    pub remote_gateway: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub phase1: IpsecPhase1,
    #[serde(default)]
    pub phase2: Vec<IpsecPhase2>,
    #[serde(default)]
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IpsecPhase1 {
    #[serde(default)]
    pub encryption: String,
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub dhgroup: String,
    #[serde(default)]
    pub lifetime: u64,
    #[serde(default)]
    pub auth_method: String,
    #[serde(default)]
    pub psk: String,
    #[serde(default)]
    pub cert_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IpsecPhase2 {
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub encryption: String,
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub pfs_group: String,
    #[serde(default)]
    pub lifetime: u64,
    #[serde(default)]
    pub local_network: String,
    #[serde(default)]
    pub remote_network: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenVpnServer {
    pub vpnid: String,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub dev_mode: String,
    #[serde(default)]
    pub interface: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tls_key: String,
    #[serde(default)]
    pub ca: String,
    #[serde(default)]
    pub cert: String,
    #[serde(default)]
    pub dh_length: u32,
    #[serde(default)]
    pub tunnel_network: String,
    #[serde(default)]
    pub local_network: String,
    #[serde(default)]
    pub remote_network: String,
    #[serde(default)]
    pub compression: String,
    #[serde(default)]
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenVpnClient {
    pub vpnid: String,
    #[serde(default)]
    pub server_addr: String,
    #[serde(default)]
    pub server_port: u16,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireGuardTunnel {
    pub name: String,
    #[serde(default)]
    pub listen_port: u16,
    #[serde(default)]
    pub private_key: String,
    #[serde(default)]
    pub public_key: String,
    #[serde(default)]
    pub peers: Vec<WireGuardPeer>,
    #[serde(default)]
    pub addresses: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireGuardPeer {
    pub public_key: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub allowed_ips: Vec<String>,
    #[serde(default)]
    pub persistent_keepalive: u32,
    #[serde(default)]
    pub description: String,
}

// ── Routing ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaticRoute {
    pub network: String,
    pub gateway: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Gateway {
    pub name: String,
    pub interface: String,
    pub gateway: String,
    #[serde(default)]
    pub monitor: String,
    #[serde(default)]
    pub weight: u32,
    #[serde(default)]
    pub default_gw: bool,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayGroup {
    pub name: String,
    #[serde(default)]
    pub gateways: Vec<String>,
    #[serde(default)]
    pub trigger_level: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayStatus {
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub delay: String,
    #[serde(default)]
    pub stddev: String,
    #[serde(default)]
    pub loss: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemRoute {
    pub destination: String,
    pub gateway: String,
    #[serde(default)]
    pub flags: String,
    #[serde(default)]
    pub interface: String,
    #[serde(default)]
    pub mtu: String,
}

// ── Certificates ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfsenseCertificate {
    pub refid: String,
    pub descr: String,
    #[serde(rename = "type", default)]
    pub type_: String,
    #[serde(default)]
    pub crt: String,
    #[serde(default)]
    pub prv: String,
    #[serde(default)]
    pub serial: String,
    #[serde(default)]
    pub valid_from: String,
    #[serde(default)]
    pub valid_to: String,
    #[serde(default)]
    pub ca_refid: String,
    #[serde(default)]
    pub san: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateAuthority {
    pub refid: String,
    pub descr: String,
    #[serde(default)]
    pub crt: String,
    #[serde(default)]
    pub prv: String,
    #[serde(default)]
    pub serial: String,
    #[serde(default)]
    pub trust: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCertRequest {
    pub method: String,
    pub descr: String,
    #[serde(default = "default_key_type")]
    pub key_type: String,
    #[serde(default = "default_key_length")]
    pub key_length: u32,
    #[serde(default = "default_digest")]
    pub digest_alg: String,
    #[serde(default = "default_lifetime")]
    pub lifetime: u32,
    #[serde(default)]
    pub dn: CertDn,
}

fn default_key_type() -> String { "RSA".to_string() }
fn default_key_length() -> u32 { 2048 }
fn default_digest() -> String { "sha256".to_string() }
fn default_lifetime() -> u32 { 3650 }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CertDn {
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportCertRequest {
    pub descr: String,
    pub crt: String,
    #[serde(default)]
    pub prv: String,
}

// ── Users ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfsenseUser {
    pub uid: String,
    pub name: String,
    #[serde(default)]
    pub full_name: String,
    #[serde(default)]
    pub groups: Vec<String>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub cert_refs: Vec<String>,
    #[serde(default)]
    pub authorized_keys: String,
    #[serde(default)]
    pub expires: String,
    #[serde(default)]
    pub shell: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfsenseGroup {
    pub name: String,
    pub gid: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub privileges: Vec<String>,
    #[serde(default)]
    pub members: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub name: String,
    pub password: String,
    #[serde(default)]
    pub full_name: String,
    #[serde(default)]
    pub groups: Vec<String>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub authorized_keys: String,
    #[serde(default)]
    pub expires: String,
    #[serde(default)]
    pub shell: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserRequest {
    pub password: Option<String>,
    pub full_name: Option<String>,
    pub groups: Option<Vec<String>>,
    pub disabled: Option<bool>,
    pub authorized_keys: Option<String>,
    pub expires: Option<String>,
    pub shell: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPrivilege {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

// ── Diagnostics ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArpEntry {
    pub interface: String,
    pub ip: String,
    pub mac: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub expires: String,
    #[serde(rename = "type", default)]
    pub type_: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NdpEntry {
    pub interface: String,
    pub ip: String,
    pub mac: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub expires: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfState {
    pub id: String,
    pub interface: String,
    #[serde(default)]
    pub protocol: String,
    pub source: String,
    pub destination: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub age: String,
    #[serde(default)]
    pub expires: String,
    #[serde(default)]
    pub bytes: u64,
    #[serde(default)]
    pub packets: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsLookupResult {
    pub query: String,
    pub server: String,
    #[serde(default)]
    pub results: Vec<String>,
    #[serde(default)]
    pub query_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingResult {
    pub host: String,
    pub transmitted: u32,
    pub received: u32,
    pub loss_percent: f64,
    #[serde(default)]
    pub min_ms: f64,
    #[serde(default)]
    pub avg_ms: f64,
    #[serde(default)]
    pub max_ms: f64,
    #[serde(default)]
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteResult {
    pub host: String,
    #[serde(default)]
    pub hops: Vec<TracerouteHop>,
    #[serde(default)]
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteHop {
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

// ── Packages ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfsensePackage {
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub installed_version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub installed: bool,
    #[serde(default)]
    pub available_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageCategory {
    pub name: String,
    #[serde(default)]
    pub packages: Vec<String>,
}

// ── Backup ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupConfig {
    #[serde(default)]
    pub area: String,
    #[serde(default)]
    pub encrypt: bool,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub skip_rrd: bool,
    #[serde(default)]
    pub skip_packages: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreConfig {
    #[serde(default)]
    pub area: String,
    #[serde(default)]
    pub decrypt: bool,
    #[serde(default)]
    pub password: String,
    pub config_xml: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupEntry {
    pub filename: String,
    pub timestamp: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub description: String,
}

// ── Status ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStatus {
    pub version: String,
    pub platform: String,
    #[serde(default)]
    pub cpu_type: String,
    #[serde(default)]
    pub cpu_count: u32,
    #[serde(default)]
    pub uptime: String,
    #[serde(default)]
    pub memory_total: u64,
    #[serde(default)]
    pub memory_used: u64,
    #[serde(default)]
    pub swap_total: u64,
    #[serde(default)]
    pub swap_used: u64,
    #[serde(default)]
    pub disk_usage: f64,
    #[serde(default)]
    pub cpu_usage: f64,
    #[serde(default)]
    pub load_average: Vec<f64>,
    #[serde(default)]
    pub temperature: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub running: bool,
    #[serde(default)]
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfInfo {
    pub states: u64,
    #[serde(default)]
    pub state_limit: u64,
    #[serde(default)]
    pub src_tracking: u64,
    #[serde(default)]
    pub running_since: String,
    #[serde(default)]
    pub if_stats: Vec<PfIfStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PfIfStats {
    pub interface: String,
    #[serde(default)]
    pub cleared: String,
    #[serde(default)]
    pub references: u64,
    #[serde(default)]
    pub in_pass_packets: u64,
    #[serde(default)]
    pub in_pass_bytes: u64,
    #[serde(default)]
    pub in_block_packets: u64,
    #[serde(default)]
    pub in_block_bytes: u64,
    #[serde(default)]
    pub out_pass_packets: u64,
    #[serde(default)]
    pub out_pass_bytes: u64,
    #[serde(default)]
    pub out_block_packets: u64,
    #[serde(default)]
    pub out_block_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrafficGraph {
    pub interface: String,
    #[serde(default)]
    pub in_bytes: u64,
    #[serde(default)]
    pub out_bytes: u64,
    #[serde(default)]
    pub in_packets: u64,
    #[serde(default)]
    pub out_packets: u64,
}
