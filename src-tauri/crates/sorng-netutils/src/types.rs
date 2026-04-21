//! # Network Utilities Types
//!
//! Shared data types for all network diagnostic and monitoring utilities.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

// ═══════════════════════════════════════════════════════════════════════
// Ping
// ═══════════════════════════════════════════════════════════════════════

/// A complete ping result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingResult {
    pub host: String,
    pub resolved_ip: Option<String>,
    pub packets_sent: u32,
    pub packets_received: u32,
    pub packet_loss_pct: f64,
    pub min_ms: f64,
    pub avg_ms: f64,
    pub max_ms: f64,
    pub stddev_ms: f64,
    pub replies: Vec<PingReply>,
    pub started_at: DateTime<Utc>,
    pub duration_ms: u64,
    pub ttl: Option<u8>,
    pub payload_size: u32,
    pub ip_version: IpVersion,
}

/// A single ICMP echo reply.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingReply {
    pub seq: u32,
    pub ttl: u8,
    pub time_ms: f64,
    pub size: u32,
    pub from: String,
    pub dup: bool,
}

/// Ping configuration options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingOptions {
    pub count: Option<u32>,
    pub interval_ms: Option<u32>,
    pub timeout_ms: Option<u32>,
    pub ttl: Option<u8>,
    pub payload_size: Option<u32>,
    pub ip_version: Option<IpVersion>,
    pub interface: Option<String>,
    pub flood: bool,
    pub adaptive: bool,
    pub dont_fragment: bool,
}

impl Default for PingOptions {
    fn default() -> Self {
        Self {
            count: Some(4),
            interval_ms: Some(1000),
            timeout_ms: Some(5000),
            ttl: None,
            payload_size: Some(56),
            ip_version: None,
            interface: None,
            flood: false,
            adaptive: false,
            dont_fragment: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IpVersion {
    V4,
    V6,
    Auto,
}

// ═══════════════════════════════════════════════════════════════════════
// Traceroute
// ═══════════════════════════════════════════════════════════════════════

/// A complete traceroute result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteResult {
    pub host: String,
    pub resolved_ip: Option<String>,
    pub hops: Vec<TracerouteHop>,
    pub completed: bool,
    pub protocol: TracerouteProtocol,
    pub max_hops: u8,
    pub started_at: DateTime<Utc>,
    pub duration_ms: u64,
}

/// A single hop in a traceroute.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteHop {
    pub hop_num: u8,
    pub probes: Vec<TracerouteProbe>,
    pub asn: Option<u32>,
    pub as_name: Option<String>,
}

/// A single probe result at a given hop.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteProbe {
    pub ip: Option<String>,
    pub hostname: Option<String>,
    pub rtt_ms: Option<f64>,
    pub timeout: bool,
    pub icmp_type: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TracerouteProtocol {
    Udp,
    Icmp,
    Tcp,
}

/// Traceroute options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteOptions {
    pub max_hops: Option<u8>,
    pub queries_per_hop: Option<u8>,
    pub timeout_ms: Option<u32>,
    pub protocol: Option<TracerouteProtocol>,
    pub port: Option<u16>,
    pub source_addr: Option<String>,
    pub ip_version: Option<IpVersion>,
    pub resolve_hostnames: bool,
    pub asn_lookup: bool,
}

impl Default for TracerouteOptions {
    fn default() -> Self {
        Self {
            max_hops: Some(30),
            queries_per_hop: Some(3),
            timeout_ms: Some(5000),
            protocol: None,
            port: None,
            source_addr: None,
            ip_version: None,
            resolve_hostnames: true,
            asn_lookup: false,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// MTR
// ═══════════════════════════════════════════════════════════════════════

/// MTR (My TraceRoute) combined ping/traceroute result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtrResult {
    pub host: String,
    pub report: Vec<MtrHop>,
    pub cycles: u32,
    pub started_at: DateTime<Utc>,
    pub duration_ms: u64,
}

/// A single MTR hop with aggregate statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtrHop {
    pub hop_num: u8,
    pub ip: Option<String>,
    pub hostname: Option<String>,
    pub loss_pct: f64,
    pub sent: u32,
    pub recv: u32,
    pub best_ms: f64,
    pub avg_ms: f64,
    pub worst_ms: f64,
    pub stddev_ms: f64,
    pub last_ms: f64,
    pub jitter_ms: f64,
    pub asn: Option<u32>,
}

/// MTR run options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtrOptions {
    pub cycles: Option<u32>,
    pub interval_ms: Option<u32>,
    pub max_hops: Option<u8>,
    pub protocol: Option<TracerouteProtocol>,
    pub port: Option<u16>,
    pub ip_version: Option<IpVersion>,
    pub resolve_hostnames: bool,
    pub asn_lookup: bool,
}

impl Default for MtrOptions {
    fn default() -> Self {
        Self {
            cycles: Some(10),
            interval_ms: Some(1000),
            max_hops: Some(30),
            protocol: None,
            port: None,
            ip_version: None,
            resolve_hostnames: true,
            asn_lookup: false,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Nmap
// ═══════════════════════════════════════════════════════════════════════

/// An nmap scan result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NmapScanResult {
    pub target: String,
    pub hosts: Vec<NmapHost>,
    pub scan_type: NmapScanType,
    pub started_at: DateTime<Utc>,
    pub duration_ms: u64,
    pub total_hosts_up: u32,
    pub total_hosts_down: u32,
    pub nmap_version: Option<String>,
    pub xml_output: Option<String>,
}

/// A host discovered by nmap.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NmapHost {
    pub ip: String,
    pub hostnames: Vec<String>,
    pub status: NmapHostStatus,
    pub ports: Vec<NmapPort>,
    pub os_matches: Vec<NmapOsMatch>,
    pub mac_address: Option<String>,
    pub mac_vendor: Option<String>,
    pub distance_hops: Option<u8>,
    pub uptime_seconds: Option<u64>,
    pub scripts: Vec<NmapScriptResult>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NmapHostStatus {
    Up,
    Down,
    Unknown,
}

/// A port discovered by nmap.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NmapPort {
    pub port: u16,
    pub protocol: PortProtocol,
    pub state: NmapPortState,
    pub service_name: Option<String>,
    pub service_product: Option<String>,
    pub service_version: Option<String>,
    pub service_extra: Option<String>,
    pub scripts: Vec<NmapScriptResult>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NmapPortState {
    Open,
    Closed,
    Filtered,
    Unfiltered,
    OpenFiltered,
    ClosedFiltered,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PortProtocol {
    Tcp,
    Udp,
    Sctp,
}

/// An OS detection match.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NmapOsMatch {
    pub name: String,
    pub accuracy: u8,
    pub os_family: Option<String>,
    pub os_gen: Option<String>,
    pub cpe: Vec<String>,
}

/// An NSE script result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NmapScriptResult {
    pub id: String,
    pub output: String,
    pub elements: HashMap<String, String>,
}

/// Nmap scan types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NmapScanType {
    TcpSyn,
    TcpConnect,
    TcpAck,
    TcpWindow,
    TcpFin,
    TcpXmas,
    TcpNull,
    Udp,
    SctpInit,
    SctpCookieEcho,
    IpProtocol,
    Ping,
    ListScan,
    VersionDetect,
    OsDetect,
    ScriptScan,
}

/// Nmap scan options.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NmapOptions {
    pub scan_type: Option<NmapScanType>,
    pub ports: Option<String>,
    pub top_ports: Option<u32>,
    pub service_detection: bool,
    pub os_detection: bool,
    pub scripts: Vec<String>,
    pub script_args: HashMap<String, String>,
    pub timing: Option<NmapTiming>,
    pub source_port: Option<u16>,
    pub decoys: Vec<String>,
    pub interface: Option<String>,
    pub ip_version: Option<IpVersion>,
    pub privileged: bool,
    pub max_retries: Option<u8>,
    pub host_timeout_ms: Option<u64>,
    pub min_rate: Option<u32>,
    pub max_rate: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NmapTiming {
    Paranoid,
    Sneaky,
    Polite,
    Normal,
    Aggressive,
    Insane,
}

// ═══════════════════════════════════════════════════════════════════════
// Netstat / ss
// ═══════════════════════════════════════════════════════════════════════

/// A socket/connection entry from netstat or ss.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocketEntry {
    pub protocol: SocketProtocol,
    pub state: SocketState,
    pub local_addr: String,
    pub local_port: u16,
    pub remote_addr: Option<String>,
    pub remote_port: Option<u16>,
    pub pid: Option<u32>,
    pub process_name: Option<String>,
    pub user: Option<String>,
    pub inode: Option<u64>,
    pub recv_queue: u64,
    pub send_queue: u64,
    pub timer: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SocketProtocol {
    Tcp,
    Tcp6,
    Udp,
    Udp6,
    Unix,
    Raw,
    Raw6,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SocketState {
    Established,
    SynSent,
    SynRecv,
    FinWait1,
    FinWait2,
    TimeWait,
    Close,
    CloseWait,
    LastAck,
    Listen,
    Closing,
    Unknown,
}

// ═══════════════════════════════════════════════════════════════════════
// ARP
// ═══════════════════════════════════════════════════════════════════════

/// An entry in the ARP cache.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArpEntry {
    pub ip: String,
    pub mac: String,
    pub interface: String,
    pub state: ArpState,
    pub hw_type: Option<String>,
    pub flags: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ArpState {
    Reachable,
    Stale,
    Delay,
    Probe,
    Failed,
    Noarp,
    Incomplete,
    Permanent,
}

// ═══════════════════════════════════════════════════════════════════════
// Dig / DNS query
// ═══════════════════════════════════════════════════════════════════════

/// A DNS query result (dig-style).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigResult {
    pub query_name: String,
    pub query_type: String,
    pub server: String,
    pub query_time_ms: u32,
    pub status: DnsStatus,
    pub answers: Vec<DnsRecord>,
    pub authority: Vec<DnsRecord>,
    pub additional: Vec<DnsRecord>,
    pub flags: Vec<String>,
    pub opcode: String,
    pub rcode: String,
    pub msg_size: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DnsStatus {
    NoError,
    FormErr,
    ServFail,
    NxDomain,
    NotImp,
    Refused,
    Other,
}

/// A single DNS resource record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsRecord {
    pub name: String,
    pub record_type: String,
    pub ttl: u32,
    pub class: String,
    pub data: String,
    pub priority: Option<u16>,
    pub weight: Option<u16>,
    pub port: Option<u16>,
}

/// Dig query options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigOptions {
    pub record_type: Option<String>,
    pub server: Option<String>,
    pub port: Option<u16>,
    pub tcp: bool,
    pub short: bool,
    pub trace: bool,
    pub dnssec: bool,
    pub timeout_ms: Option<u32>,
    pub retries: Option<u8>,
}

impl Default for DigOptions {
    fn default() -> Self {
        Self {
            record_type: Some("A".to_string()),
            server: None,
            port: None,
            tcp: false,
            short: false,
            trace: false,
            dnssec: false,
            timeout_ms: Some(5000),
            retries: Some(3),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// WHOIS
// ═══════════════════════════════════════════════════════════════════════

/// A WHOIS lookup result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhoisResult {
    pub query: String,
    pub registrar: Option<String>,
    pub registrant: Option<String>,
    pub creation_date: Option<String>,
    pub expiration_date: Option<String>,
    pub updated_date: Option<String>,
    pub name_servers: Vec<String>,
    pub status: Vec<String>,
    pub dnssec: Option<String>,
    pub abuse_contact: Option<String>,
    pub raw: String,
    pub queried_at: DateTime<Utc>,
    /// RDAP-style structured data (when available).
    pub rdap: Option<HashMap<String, String>>,
}

// ═══════════════════════════════════════════════════════════════════════
// Ethtool
// ═══════════════════════════════════════════════════════════════════════

/// NIC information from ethtool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EthtoolInfo {
    pub interface: String,
    pub driver: Option<String>,
    pub driver_version: Option<String>,
    pub firmware_version: Option<String>,
    pub bus_info: Option<String>,
    pub speed_mbps: Option<u32>,
    pub duplex: Option<String>,
    pub auto_negotiation: Option<bool>,
    pub link_detected: bool,
    pub supported_link_modes: Vec<String>,
    pub advertised_link_modes: Vec<String>,
    pub wake_on_lan: Option<String>,
    pub offloads: EthtoolOffloads,
    pub ring_params: Option<EthtoolRing>,
    pub statistics: HashMap<String, u64>,
}

/// NIC offload features.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EthtoolOffloads {
    pub rx_checksumming: Option<bool>,
    pub tx_checksumming: Option<bool>,
    pub scatter_gather: Option<bool>,
    pub tcp_segmentation_offload: Option<bool>,
    pub generic_segmentation_offload: Option<bool>,
    pub generic_receive_offload: Option<bool>,
    pub large_receive_offload: Option<bool>,
    pub rx_vlan_offload: Option<bool>,
    pub tx_vlan_offload: Option<bool>,
}

/// NIC ring buffer parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EthtoolRing {
    pub rx_max: u32,
    pub rx_current: u32,
    pub tx_max: u32,
    pub tx_current: u32,
}

// ═══════════════════════════════════════════════════════════════════════
// tcpdump / Packet Capture
// ═══════════════════════════════════════════════════════════════════════

/// A packet capture session configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureConfig {
    pub id: String,
    pub interface: String,
    pub filter: Option<String>,
    pub snap_len: Option<u32>,
    pub packet_count: Option<u32>,
    pub duration_secs: Option<u32>,
    pub output_file: Option<String>,
    pub promiscuous: bool,
    pub resolve_hostnames: bool,
    pub verbose_level: u8,
}

/// A captured packet (simplified).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedPacket {
    pub timestamp: DateTime<Utc>,
    pub source: String,
    pub destination: String,
    pub protocol: String,
    pub length: u32,
    pub info: String,
    pub raw_hex: Option<String>,
}

/// Capture session status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureStatus {
    pub id: String,
    pub running: bool,
    pub packets_captured: u64,
    pub packets_dropped: u64,
    pub bytes_captured: u64,
    pub started_at: Option<DateTime<Utc>>,
    pub duration_secs: u64,
    pub output_file: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
// iperf / Bandwidth
// ═══════════════════════════════════════════════════════════════════════

/// An iperf3 bandwidth test result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IperfResult {
    pub host: String,
    pub port: u16,
    pub protocol: IperfProtocol,
    pub direction: IperfDirection,
    pub intervals: Vec<IperfInterval>,
    pub summary: IperfSummary,
    pub started_at: DateTime<Utc>,
    pub duration_secs: f64,
    pub streams: u8,
    pub reverse: bool,
}

/// Bandwidth measurement for a time interval.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IperfInterval {
    pub start_secs: f64,
    pub end_secs: f64,
    pub bytes: u64,
    pub bits_per_sec: f64,
    pub retransmits: Option<u32>,
    pub cwnd_bytes: Option<u64>,
    pub rtt_us: Option<u64>,
    pub jitter_ms: Option<f64>,
    pub lost_packets: Option<u32>,
    pub total_packets: Option<u32>,
}

/// Summary of an iperf test.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IperfSummary {
    pub bytes: u64,
    pub bits_per_sec: f64,
    pub retransmits: Option<u32>,
    pub jitter_ms: Option<f64>,
    pub lost_packets: Option<u32>,
    pub lost_pct: Option<f64>,
    pub cpu_sender: Option<f64>,
    pub cpu_receiver: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IperfProtocol {
    Tcp,
    Udp,
    Sctp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IperfDirection {
    Upload,
    Download,
    Bidirectional,
}

/// iperf3 test options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IperfOptions {
    pub port: Option<u16>,
    pub protocol: Option<IperfProtocol>,
    pub duration_secs: Option<u32>,
    pub interval_secs: Option<u32>,
    pub bandwidth_limit: Option<String>,
    pub streams: Option<u8>,
    pub reverse: bool,
    pub bidirectional: bool,
    pub window_size: Option<String>,
    pub mss: Option<u32>,
    pub no_delay: bool,
    pub json: bool,
}

impl Default for IperfOptions {
    fn default() -> Self {
        Self {
            port: Some(5201),
            protocol: None,
            duration_secs: Some(10),
            interval_secs: Some(1),
            bandwidth_limit: None,
            streams: Some(1),
            reverse: false,
            bidirectional: false,
            window_size: None,
            mss: None,
            no_delay: false,
            json: true,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Speedtest
// ═══════════════════════════════════════════════════════════════════════

/// An internet speed test result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeedtestResult {
    pub server_name: String,
    pub server_location: String,
    pub server_id: Option<u32>,
    pub isp: Option<String>,
    pub download_mbps: f64,
    pub upload_mbps: f64,
    pub ping_ms: f64,
    pub jitter_ms: Option<f64>,
    pub packet_loss_pct: Option<f64>,
    pub external_ip: Option<String>,
    pub tested_at: DateTime<Utc>,
    pub provider: SpeedtestProvider,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SpeedtestProvider {
    Ookla,
    Cloudflare,
    LibreSpeed,
    Netflix,
}

// ═══════════════════════════════════════════════════════════════════════
// Routing Table
// ═══════════════════════════════════════════════════════════════════════

/// A routing table entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteEntry {
    pub destination: String,
    pub gateway: Option<String>,
    pub netmask: Option<String>,
    pub prefix_len: Option<u8>,
    pub interface: String,
    pub metric: u32,
    pub protocol: Option<String>,
    pub scope: Option<String>,
    pub route_type: Option<String>,
    pub flags: Vec<String>,
    pub mtu: Option<u32>,
    pub table_id: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════
// Wake-on-LAN
// ═══════════════════════════════════════════════════════════════════════

/// A Wake-on-LAN target.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WolTarget {
    pub mac_address: String,
    pub hostname: Option<String>,
    pub ip_address: Option<String>,
    pub broadcast_addr: Option<String>,
    pub port: Option<u16>,
    pub secure_password: Option<String>,
    pub sent_at: Option<DateTime<Utc>>,
    pub status: WolStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WolStatus {
    Pending,
    Sent,
    Confirmed,
    Failed,
}

// ═══════════════════════════════════════════════════════════════════════
// Curl / HTTP Timing
// ═══════════════════════════════════════════════════════════════════════

/// HTTP timing breakdown (curl-style).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpTiming {
    pub url: String,
    pub http_code: u16,
    pub dns_lookup_ms: f64,
    pub tcp_connect_ms: f64,
    pub tls_handshake_ms: f64,
    pub time_to_first_byte_ms: f64,
    pub total_time_ms: f64,
    pub redirect_time_ms: f64,
    pub redirect_count: u32,
    pub download_size_bytes: u64,
    pub upload_size_bytes: u64,
    pub speed_download_bps: f64,
    pub speed_upload_bps: f64,
    pub ssl_verify_result: Option<i32>,
    pub effective_url: String,
    pub content_type: Option<String>,
    pub ip_address: Option<String>,
    pub port: Option<u16>,
    pub tls_version: Option<String>,
    pub headers: HashMap<String, String>,
}

// ═══════════════════════════════════════════════════════════════════════
// Netcat
// ═══════════════════════════════════════════════════════════════════════

/// Netcat probe result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetcatResult {
    pub host: String,
    pub port: u16,
    pub protocol: PortProtocol,
    pub open: bool,
    pub banner: Option<String>,
    pub latency_ms: Option<f64>,
    pub error: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
// lsof (network fds)
// ═══════════════════════════════════════════════════════════════════════

/// A network file descriptor entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkFd {
    pub pid: u32,
    pub process_name: String,
    pub user: String,
    pub fd: String,
    pub fd_type: String,
    pub protocol: Option<String>,
    pub local_addr: Option<String>,
    pub local_port: Option<u16>,
    pub remote_addr: Option<String>,
    pub remote_port: Option<u16>,
    pub state: Option<String>,
    pub node: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
// Bandwidth Monitor
// ═══════════════════════════════════════════════════════════════════════

/// Real-time bandwidth sample.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandwidthSample {
    pub interface: String,
    pub timestamp: DateTime<Utc>,
    pub rx_bytes_per_sec: u64,
    pub tx_bytes_per_sec: u64,
    pub rx_packets_per_sec: u64,
    pub tx_packets_per_sec: u64,
}

/// Per-connection bandwidth from iftop-style monitoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionBandwidth {
    pub source: String,
    pub destination: String,
    pub tx_2s: u64,
    pub tx_10s: u64,
    pub tx_40s: u64,
    pub rx_2s: u64,
    pub rx_10s: u64,
    pub rx_40s: u64,
    pub protocol: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
// Diagnostics
// ═══════════════════════════════════════════════════════════════════════

/// Overall network utilities health check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetUtilsHealthCheck {
    pub tools_available: HashMap<String, bool>,
    pub ping_ok: bool,
    pub dns_ok: bool,
    pub default_gateway_reachable: bool,
    pub internet_reachable: bool,
    pub warnings: Vec<String>,
    pub checked_at: DateTime<Utc>,
}

// ═══════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════

/// Events emitted by the network utilities.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NetUtilsEvent {
    PingComplete {
        host: String,
        loss_pct: f64,
        avg_ms: f64,
    },
    TracerouteComplete {
        host: String,
        hops: u8,
    },
    MtrComplete {
        host: String,
        cycles: u32,
    },
    NmapScanComplete {
        target: String,
        hosts_up: u32,
    },
    CaptureStarted {
        id: String,
        interface: String,
    },
    CaptureStopped {
        id: String,
        packets: u64,
    },
    IperfComplete {
        host: String,
        mbps: f64,
    },
    SpeedtestComplete {
        download_mbps: f64,
        upload_mbps: f64,
    },
    WolSent {
        mac: String,
    },
    ToolNotFound {
        tool: String,
    },
}

// ═══════════════════════════════════════════════════════════════════════
// Service State Alias
// ═══════════════════════════════════════════════════════════════════════

pub type NetUtilsServiceState = Arc<Mutex<crate::service::NetUtilsService>>;
