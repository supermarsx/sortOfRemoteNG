use chrono::{DateTime, Utc};
use ssh2::Session;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

use super::service::SshService;

// ===============================
// Default value helpers
// ===============================

pub fn default_true() -> bool {
    true
}
pub fn default_keepalive_probes() -> u32 {
    2
}
pub fn default_ip_protocol() -> String {
    "auto".to_string()
}
pub fn default_compression_level() -> u32 {
    6
}
pub fn default_compression_config() -> SshCompressionConfig {
    SshCompressionConfig::default()
}
pub fn default_ssh_version() -> String {
    "auto".to_string()
}
pub fn default_proxy_timeout() -> u64 {
    10000
}
pub fn default_automation_timeout() -> u64 {
    30000
}
pub fn default_ftp_port() -> u16 {
    21
}
pub fn default_passive_port_count() -> u16 {
    10
}
pub fn default_rdp_port() -> u16 {
    3389
}
pub fn default_vnc_port() -> u16 {
    5900
}

// ===============================
// SSH Compression Types
// ===============================

/// Compression algorithms supported by the SSH transport layer.
/// These map directly to the algorithm names in the SSH specification (RFC 4253).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum SshCompressionAlgorithm {
    /// No compression — raw data transfer
    None,
    /// Standard zlib compression (RFC 1950) — compresses from the start of the session
    Zlib,
    /// Delayed zlib — compression only activates after user authentication completes.
    /// This is `zlib@openssh.com` and is more secure than plain `zlib`
    /// because unauthenticated data is not decompressed (mitigates pre-auth exploits).
    ZlibOpenssh,
    /// Automatically negotiate the best available algorithm.
    /// Preference order: zlib@openssh.com > zlib > none
    #[default]
    Auto,
}

impl SshCompressionAlgorithm {
    /// Return the SSH algorithm name strings for `MethodType::CompCs` / `CompSc`.
    /// When `Auto`, returns the full preference list.
    pub fn to_method_pref(&self) -> &str {
        match self {
            Self::None => "none",
            Self::Zlib => "zlib,none",
            Self::ZlibOpenssh => "zlib@openssh.com,none",
            Self::Auto => "zlib@openssh.com,zlib,none",
        }
    }
}

/// Per-direction configuration lets users choose different algorithms/levels for
/// upload (client → server) vs download (server → client) traffic.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshDirectionalCompression {
    /// Compression algorithm for this direction
    #[serde(default)]
    pub algorithm: SshCompressionAlgorithm,
    /// Compression level 1-9 (1 = fastest, 9 = best compression, 0 = library default).
    /// Only meaningful for zlib-based algorithms.
    #[serde(default = "default_compression_level")]
    pub level: u32,
}

impl Default for SshDirectionalCompression {
    fn default() -> Self {
        Self {
            algorithm: SshCompressionAlgorithm::Auto,
            level: 6,
        }
    }
}

/// Adaptive compression adjusts behaviour dynamically based on data characteristics.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshAdaptiveCompression {
    /// When true, compression is automatically disabled for payloads that are
    /// already compressed (binary transfers, media, archives, etc.)
    #[serde(default)]
    pub enabled: bool,
    /// Minimum payload size in bytes before compression is applied.
    /// Packets smaller than this are sent uncompressed to avoid overhead.
    #[serde(default = "default_adaptive_min_size")]
    pub min_payload_bytes: u64,
    /// If the compression ratio (compressed / original) is worse than this
    /// threshold, compression is automatically disabled for subsequent data.
    /// Value 0.0–1.0 (e.g. 0.95 means disable if < 5 % savings).
    #[serde(default = "default_adaptive_ratio_threshold")]
    pub ratio_threshold: f64,
    /// List of file extensions that should never be compressed (already compressed).
    #[serde(default = "default_incompressible_extensions")]
    pub incompressible_extensions: Vec<String>,
}

fn default_adaptive_min_size() -> u64 {
    256
}
fn default_adaptive_ratio_threshold() -> f64 {
    0.90
}
fn default_incompressible_extensions() -> Vec<String> {
    vec![
        "gz", "bz2", "xz", "zst", "lz4", "lzma", "zip", "7z", "rar", "tar.gz", "tar.bz2", "tar.xz",
        "tgz", "jpg", "jpeg", "png", "gif", "webp", "avif", "mp3", "mp4", "mkv", "avi", "flac",
        "ogg", "webm", "pdf", "docx", "xlsx",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

impl Default for SshAdaptiveCompression {
    fn default() -> Self {
        Self {
            enabled: false,
            min_payload_bytes: default_adaptive_min_size(),
            ratio_threshold: default_adaptive_ratio_threshold(),
            incompressible_extensions: default_incompressible_extensions(),
        }
    }
}

/// Comprehensive SSH compression configuration.
///
/// Controls algorithm negotiation, per-direction settings, compression level,
/// adaptive behaviour, and statistics tracking.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshCompressionConfig {
    /// Master switch — when false, compression is completely disabled regardless
    /// of other settings.
    #[serde(default)]
    pub enabled: bool,

    /// Global compression algorithm preference (used when per-direction is not set).
    #[serde(default)]
    pub algorithm: SshCompressionAlgorithm,

    /// Global compression level 1-9 (1 = fastest/least, 9 = best/slowest, 0 = default).
    #[serde(default = "default_compression_level")]
    pub level: u32,

    /// Per-direction overrides.  When `Some`, these take precedence over the
    /// global `algorithm` and `level` above.
    #[serde(default)]
    pub client_to_server: Option<SshDirectionalCompression>,
    #[serde(default)]
    pub server_to_client: Option<SshDirectionalCompression>,

    /// Adaptive compression settings.
    #[serde(default)]
    pub adaptive: SshAdaptiveCompression,

    /// When true, runtime compression statistics are tracked and queryable.
    #[serde(default)]
    pub track_statistics: bool,

    /// Enable SFTP-specific compression.
    /// When false, SFTP transfers bypass compression even if the session has
    /// compression enabled (useful because many transferred files are already
    /// compressed).  When true, SFTP traffic is compressed per the session settings.
    #[serde(default)]
    pub compress_sftp: bool,

    /// When true, existing sessions can have their compression settings
    /// re-negotiated at runtime via the `update_compression_config` command.
    #[serde(default)]
    pub allow_runtime_update: bool,
}

impl Default for SshCompressionConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            algorithm: SshCompressionAlgorithm::Auto,
            level: 6,
            client_to_server: None,
            server_to_client: None,
            adaptive: SshAdaptiveCompression::default(),
            track_statistics: false,
            compress_sftp: false,
            allow_runtime_update: false,
        }
    }
}

/// Runtime compression statistics tracked per-session.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct SshCompressionStats {
    /// Total uncompressed bytes sent
    pub bytes_sent_uncompressed: u64,
    /// Total compressed bytes sent (after compression)
    pub bytes_sent_compressed: u64,
    /// Total uncompressed bytes received
    pub bytes_recv_uncompressed: u64,
    /// Total compressed bytes received (after decompression)
    pub bytes_recv_compressed: u64,
    /// Current send compression ratio (0.0-1.0, lower = better)
    pub send_ratio: f64,
    /// Current receive compression ratio
    pub recv_ratio: f64,
    /// Negotiated client-to-server algorithm
    pub negotiated_cs_algorithm: String,
    /// Negotiated server-to-client algorithm
    pub negotiated_sc_algorithm: String,
    /// Whether compression is currently active
    pub compression_active: bool,
    /// Adaptive compression was in effect (skipped some payloads)
    pub adaptive_skips: u64,
}

/// Serialisable snapshot returned by `get_compression_info`
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshCompressionInfo {
    pub session_id: String,
    pub config: SshCompressionConfig,
    pub stats: SshCompressionStats,
    pub negotiated_cs_algorithm: String,
    pub negotiated_sc_algorithm: String,
}

// ===============================
// SSH Connection Types
// ===============================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshConnectionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub jump_hosts: Vec<JumpHostConfig>,
    pub proxy_config: Option<ProxyConfig>,
    /// Proxy chain for routing through multiple proxies
    #[serde(default)]
    pub proxy_chain: Option<ProxyChainConfig>,
    /// Mixed chain of SSH jumps + proxy hops (highest priority)
    #[serde(default)]
    pub mixed_chain: Option<MixedChainConfig>,
    pub openvpn_config: Option<OpenVPNConfig>,
    pub connect_timeout: Option<u64>,
    pub keep_alive_interval: Option<u64>,
    pub strict_host_key_checking: bool,
    pub known_hosts_path: Option<String>,
    // TOTP/MFA support for keyboard-interactive auth
    #[serde(default)]
    pub totp_secret: Option<String>,
    // Keyboard-interactive responses (pre-configured answers for MFA prompts)
    #[serde(default)]
    pub keyboard_interactive_responses: Vec<String>,
    // Agent forwarding
    #[serde(default)]
    pub agent_forwarding: bool,
    // TCP options
    #[serde(default = "default_true")]
    pub tcp_no_delay: bool,
    #[serde(default = "default_true")]
    pub tcp_keepalive: bool,
    #[serde(default = "default_keepalive_probes")]
    pub keepalive_probes: u32,
    #[serde(default = "default_ip_protocol")]
    pub ip_protocol: String,
    // SSH protocol options
    #[serde(default)]
    pub compression: bool,
    #[serde(default = "default_compression_level")]
    pub compression_level: u32,
    /// Full compression configuration — takes precedence over the legacy
    /// `compression` / `compression_level` fields when present.
    #[serde(default = "default_compression_config")]
    pub compression_config: SshCompressionConfig,
    #[serde(default = "default_ssh_version")]
    pub ssh_version: String,
    // Cipher preferences (optional)
    #[serde(default)]
    pub preferred_ciphers: Vec<String>,
    #[serde(default)]
    pub preferred_macs: Vec<String>,
    #[serde(default)]
    pub preferred_kex: Vec<String>,
    #[serde(default)]
    pub preferred_host_key_algorithms: Vec<String>,
    // X11 forwarding
    #[serde(default)]
    pub x11_forwarding: Option<X11ForwardingConfig>,
    // ProxyCommand — spawn external command whose stdio becomes the SSH transport
    #[serde(default)]
    pub proxy_command: Option<ProxyCommandConfig>,
    // PTY type (xterm, xterm-256color, vt100, etc.)
    #[serde(default)]
    pub pty_type: Option<String>,
    // Environment variables to send to the remote shell
    #[serde(default)]
    pub environment: HashMap<String, String>,
    // FIDO2 / Security Key auth options
    /// When true, the private key is an SK (security-key) type that requires
    /// FIDO2 user interaction (touch / PIN).
    #[serde(default)]
    pub sk_auth: bool,
    /// Optional FIDO2 device path — when `None`, the first available is used.
    #[serde(default)]
    pub sk_device_path: Option<String>,
    /// Optional PIN to unlock the FIDO2 authenticator.
    #[serde(default)]
    pub sk_pin: Option<String>,
    /// SK application / relying-party ID override (default: "ssh:").
    #[serde(default)]
    pub sk_application: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyConfig {
    pub proxy_type: ProxyType,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ProxyType {
    #[serde(rename = "http")]
    Http,
    #[serde(rename = "https")]
    Https,
    #[serde(rename = "socks4")]
    Socks4,
    #[serde(rename = "socks5")]
    Socks5,
}

/// Configuration for a proxy chain - route through multiple proxies
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyChainConfig {
    /// List of proxies to chain through (in order)
    pub proxies: Vec<ProxyConfig>,
    /// Chain mode
    #[serde(default)]
    pub mode: ProxyChainMode,
    /// Timeout for each proxy hop in milliseconds
    #[serde(default = "default_proxy_timeout")]
    pub hop_timeout_ms: u64,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub enum ProxyChainMode {
    /// Connect through all proxies in order (default)
    #[default]
    Strict,
    /// Try proxies in order, skip failures
    Dynamic,
    /// Randomly select one proxy
    Random,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenVPNConfig {
    pub connection_id: String,
    pub chain_position: Option<u16>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct JumpHostConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    /// Passphrase for the private key (if encrypted)
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
    /// Enable SSH agent forwarding through this hop
    #[serde(default)]
    pub agent_forwarding: bool,
    /// TOTP secret for keyboard-interactive auth on this hop
    #[serde(default)]
    pub totp_secret: Option<String>,
    /// Pre-configured responses for keyboard-interactive prompts
    #[serde(default)]
    pub keyboard_interactive_responses: Vec<String>,
    /// Per-hop cipher preferences
    #[serde(default)]
    pub preferred_ciphers: Vec<String>,
    /// Per-hop MAC preferences
    #[serde(default)]
    pub preferred_macs: Vec<String>,
    /// Per-hop key-exchange preferences
    #[serde(default)]
    pub preferred_kex: Vec<String>,
    /// Per-hop host-key algorithm preferences
    #[serde(default)]
    pub preferred_host_key_algorithms: Vec<String>,
}

// ===============================
// Mixed Chain Types
// ===============================

/// A single hop in a mixed chain – may be an SSH jump or a proxy.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum ChainHop {
    /// SSH jump host hop – full SSH session + channel_direct_tcpip
    #[serde(rename = "ssh_jump")]
    SshJump(JumpHostConfig),
    /// Proxy hop – SOCKS4, SOCKS5, HTTP CONNECT, or HTTPS CONNECT
    #[serde(rename = "proxy")]
    Proxy(ProxyConfig),
}

impl ChainHop {
    /// Return the network address of this hop.
    pub fn address(&self) -> (String, u16) {
        match self {
            ChainHop::SshJump(j) => (j.host.clone(), j.port),
            ChainHop::Proxy(p) => (p.host.clone(), p.port),
        }
    }

    /// Human-readable label.
    pub fn label(&self) -> String {
        match self {
            ChainHop::SshJump(j) => format!("SSH {}@{}:{}", j.username, j.host, j.port),
            ChainHop::Proxy(p) => format!("{:?} {}:{}", p.proxy_type, p.host, p.port),
        }
    }
}

/// Configuration for a mixed chain of SSH jumps and proxy hops.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MixedChainConfig {
    /// Ordered list of hops (processed left-to-right).
    pub hops: Vec<ChainHop>,
    /// Timeout per hop in milliseconds (default 10 000).
    #[serde(default = "default_proxy_timeout")]
    pub hop_timeout_ms: u64,
}

/// Per-hop status returned by `validate_mixed_chain` / diagnostics.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChainHopInfo {
    pub index: usize,
    pub label: String,
    pub hop_type: String,
    pub host: String,
    pub port: u16,
}

/// Overall status of a mixed chain.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MixedChainStatus {
    pub total_hops: usize,
    pub ssh_jump_count: usize,
    pub proxy_count: usize,
    pub hops: Vec<ChainHopInfo>,
}

// ===============================
// SFTP Types
// ===============================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SftpDirEntry {
    pub path: String,
    pub file_type: String,
    pub size: u64,
    pub modified: u64,
}

// ===============================
// Session Types
// ===============================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshSessionInfo {
    pub id: String,
    pub config: SshConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub is_alive: bool,
}

pub struct SshSession {
    pub id: String,
    pub session: Session,
    pub config: SshConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub port_forwards: HashMap<String, PortForwardHandle>,
    pub keep_alive_handle: Option<tokio::task::JoinHandle<()>>,
    /// Intermediate SSH sessions kept alive for multi-hop jump / mixed chains.
    /// These own the `channel_direct_tcpip` channels that form the tunnel.
    pub intermediate_sessions: Vec<Session>,
    /// Bridge threads that relay data between SSH channels and local TCP sockets.
    pub bridge_handles: Vec<std::thread::JoinHandle<()>>,
    /// Compression statistics tracked at runtime (populated when
    /// `compression_config.track_statistics` is enabled).
    pub compression_stats: SshCompressionStats,
}

// ===============================
// Shell Types
// ===============================

#[derive(Debug)]
pub struct SshShellHandle {
    pub id: String,
    pub sender: mpsc::UnboundedSender<SshShellCommand>,
    pub thread: std::thread::JoinHandle<()>,
}

#[derive(Debug)]
pub enum SshShellCommand {
    Input(String),
    Resize(u32, u32),
    Close,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SshShellOutput {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SshShellError {
    pub session_id: String,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SshShellClosed {
    pub session_id: String,
}

// ===============================
// Port Forwarding Types
// ===============================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PortForwardConfig {
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub direction: PortForwardDirection,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum PortForwardDirection {
    Local,
    Remote,
    Dynamic,
}

#[derive(Debug)]
pub struct PortForwardHandle {
    pub id: String,
    pub config: PortForwardConfig,
    pub handle: tokio::task::JoinHandle<Result<(), Box<dyn std::error::Error + Send + Sync>>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PortForwardInfo {
    pub id: String,
    pub config: PortForwardConfig,
}

// ===============================
// Transfer Types
// ===============================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum TransferDirection {
    Upload,
    Download,
}

// ===============================
// System/Process Info Types
// ===============================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SystemInfo {
    pub uname: String,
    pub cpu_info: String,
    pub memory_info: String,
    pub disk_info: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProcessInfo {
    pub user: String,
    pub pid: u32,
    pub cpu_percent: f32,
    pub mem_percent: f32,
    pub command: String,
}

// ===============================
// Recording Types
// ===============================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionRecordingEntry {
    pub timestamp_ms: u64,
    pub data: String,
    pub entry_type: RecordingEntryType,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum RecordingEntryType {
    Output,
    Input,
    Resize { cols: u32, rows: u32 },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionRecordingMetadata {
    pub session_id: String,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub host: String,
    pub username: String,
    pub cols: u32,
    pub rows: u32,
    pub duration_ms: u64,
    pub entry_count: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionRecording {
    pub metadata: SessionRecordingMetadata,
    pub entries: Vec<SessionRecordingEntry>,
}

#[derive(Debug)]
pub struct RecordingState {
    pub start_time: std::time::Instant,
    pub start_utc: DateTime<Utc>,
    pub host: String,
    pub username: String,
    pub cols: u32,
    pub rows: u32,
    pub entries: Vec<SessionRecordingEntry>,
    pub record_input: bool,
}

// ===============================
// Automation Types
// ===============================

/// Pattern to match in terminal output for automation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExpectPattern {
    /// Regex pattern to match
    pub pattern: String,
    /// Response to send when pattern matches
    pub response: String,
    /// Whether to include newline after response
    #[serde(default = "default_true")]
    pub send_newline: bool,
    /// Optional label for logging/debugging
    pub label: Option<String>,
}

/// Automation script definition
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AutomationScript {
    /// Unique script ID
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// Patterns to match and respond to
    pub patterns: Vec<ExpectPattern>,
    /// Timeout in milliseconds (0 = no timeout)
    #[serde(default = "default_automation_timeout")]
    pub timeout_ms: u64,
    /// Maximum number of pattern matches (0 = unlimited)
    #[serde(default)]
    pub max_matches: u32,
    /// Whether to stop on first unmatched output after patterns start matching
    #[serde(default)]
    pub stop_on_no_match: bool,
}

/// Result of a single automation match
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AutomationMatch {
    pub pattern_index: usize,
    pub matched_text: String,
    pub response_sent: String,
    pub timestamp_ms: u64,
}

/// Automation execution status
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AutomationStatus {
    pub session_id: String,
    pub script_id: String,
    pub script_name: String,
    pub is_active: bool,
    pub matches: Vec<AutomationMatch>,
    pub started_at: DateTime<Utc>,
    pub elapsed_ms: u64,
}

// State for active automation
#[derive(Debug)]
pub struct AutomationState {
    pub script: AutomationScript,
    pub compiled_patterns: Vec<regex::Regex>,
    pub output_buffer: String,
    pub matches: Vec<AutomationMatch>,
    pub start_time: std::time::Instant,
    pub start_utc: DateTime<Utc>,
    pub tx: mpsc::UnboundedSender<SshShellCommand>,
}

// ===============================
// Tunnel Types (FTP, RDP, VNC)
// ===============================

/// FTP tunnel configuration
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FtpTunnelConfig {
    /// Local port for FTP control connection (default: dynamically assigned)
    pub local_control_port: Option<u16>,
    /// Remote FTP server host
    pub remote_ftp_host: String,
    /// Remote FTP server port (default: 21)
    #[serde(default = "default_ftp_port")]
    pub remote_ftp_port: u16,
    /// Whether to set up passive mode data port forwarding
    #[serde(default = "default_true")]
    pub passive_mode: bool,
    /// Local port range start for passive mode data connections
    pub passive_port_range_start: Option<u16>,
    /// Number of passive ports to forward (default: 10)
    #[serde(default = "default_passive_port_count")]
    pub passive_port_count: u16,
}

/// FTP tunnel status
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FtpTunnelStatus {
    pub tunnel_id: String,
    pub session_id: String,
    pub local_control_port: u16,
    pub remote_ftp_host: String,
    pub remote_ftp_port: u16,
    pub passive_mode: bool,
    pub passive_ports: Vec<u16>,
    pub control_forward_id: String,
    pub data_forward_ids: Vec<String>,
}

/// Configuration for RDP over SSH tunnel
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RdpTunnelConfig {
    /// Local port for RDP connection (default: dynamically assigned starting from 13389)
    pub local_port: Option<u16>,
    /// Remote RDP server host (relative to SSH server)
    pub remote_rdp_host: String,
    /// Remote RDP server port (default: 3389)
    #[serde(default = "default_rdp_port")]
    pub remote_rdp_port: u16,
    /// Optional: Enable UDP tunnel for RDP UDP transport (requires additional setup)
    #[serde(default)]
    pub enable_udp: bool,
    /// Optional: Restrict to specific network interface
    pub bind_interface: Option<String>,
    /// Whether to use NLA (Network Level Authentication) - informational only
    #[serde(default = "default_true")]
    pub nla_enabled: bool,
    /// Optional description/label for this tunnel
    pub label: Option<String>,
}

/// RDP tunnel status
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RdpTunnelStatus {
    pub tunnel_id: String,
    pub session_id: String,
    pub local_port: u16,
    pub remote_rdp_host: String,
    pub remote_rdp_port: u16,
    pub forward_id: String,
    pub bind_address: String,
    pub label: Option<String>,
    pub nla_enabled: bool,
    pub enable_udp: bool,
    /// Connection string to use with RDP client (e.g., mstsc.exe)
    pub connection_string: String,
    pub created_at: DateTime<Utc>,
}

/// RDP tunnel statistics
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RdpTunnelStats {
    pub tunnel_id: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub active_connections: u32,
    pub uptime_seconds: u64,
}

/// Options for generating RDP file
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct RdpFileOptions {
    pub username: Option<String>,
    pub domain: Option<String>,
    pub screen_width: Option<u32>,
    pub screen_height: Option<u32>,
    pub fullscreen: Option<bool>,
    pub color_depth: Option<u32>,
    pub redirect_clipboard: Option<bool>,
    pub redirect_printers: Option<bool>,
    pub redirect_drives: Option<bool>,
    pub redirect_smartcards: Option<bool>,
    pub redirect_audio: Option<bool>,
    pub disable_wallpaper: Option<bool>,
    pub disable_themes: Option<bool>,
    pub disable_font_smoothing: Option<bool>,
}

/// Configuration for VNC over SSH tunnel
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VncTunnelConfig {
    /// Local port for VNC connection (default: dynamically assigned starting from 15900)
    pub local_port: Option<u16>,
    /// Remote VNC server host (relative to SSH server)
    pub remote_vnc_host: String,
    /// Remote VNC server port (default: 5900, or 5900 + display number)
    #[serde(default = "default_vnc_port")]
    pub remote_vnc_port: u16,
    /// VNC display number (alternative to specifying port directly)
    pub display_number: Option<u16>,
    /// Optional: Restrict to specific network interface
    pub bind_interface: Option<String>,
    /// Optional description/label for this tunnel
    pub label: Option<String>,
}

/// VNC tunnel status
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VncTunnelStatus {
    pub tunnel_id: String,
    pub session_id: String,
    pub local_port: u16,
    pub remote_vnc_host: String,
    pub remote_vnc_port: u16,
    pub forward_id: String,
    pub bind_address: String,
    pub label: Option<String>,
    /// Connection string to use with VNC client
    pub connection_string: String,
    pub created_at: DateTime<Utc>,
}

// ===============================
// Diagnostics Types
// ===============================

/// Host key information returned to the frontend.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshHostKeyInfo {
    /// SHA-256 fingerprint (hex-encoded)
    pub fingerprint: String,
    /// Key type string (e.g. "ssh-ed25519", "ssh-rsa")
    pub key_type: Option<String>,
    /// Key length in bits (where applicable)
    pub key_bits: Option<u32>,
    /// Base64-encoded raw public key
    pub public_key: Option<String>,
}

// ===============================
// Service State Type
// ===============================

pub type SshServiceState = Arc<Mutex<SshService>>;

// ===============================
// X11 Forwarding Types
// ===============================

pub fn default_x11_display_offset() -> u32 {
    10
}
pub fn default_x11_screen() -> u32 {
    0
}
pub fn default_x11_timeout() -> u64 {
    0
}

/// X11 forwarding configuration.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct X11ForwardingConfig {
    /// Whether X11 forwarding is enabled.
    #[serde(default)]
    pub enabled: bool,
    /// Use trusted forwarding (ForwardX11Trusted / -Y).  Trusted mode skips
    /// the X11 SECURITY extension — the remote app gets full access to the
    /// local display.  Untrusted (default) is safer.
    #[serde(default)]
    pub trusted: bool,
    /// Display offset on the remote side (default 10, mirrors OpenSSH).
    #[serde(default = "default_x11_display_offset")]
    pub display_offset: u32,
    /// X11 screen number (default 0).
    #[serde(default = "default_x11_screen")]
    pub screen: u32,
    /// Override the local DISPLAY value (e.g. "localhost:10.0").  When empty
    /// the runtime auto-detects from $DISPLAY / Xauthority.
    #[serde(default)]
    pub display_override: Option<String>,
    /// Path to the local Xauthority file.  When empty, $XAUTHORITY or
    /// ~/.Xauthority is used.
    #[serde(default)]
    pub xauthority_path: Option<String>,
    /// Timeout in seconds to wait for X11 channel open (0 = no timeout).
    #[serde(default = "default_x11_timeout")]
    pub timeout_secs: u64,
}

impl Default for X11ForwardingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            trusted: false,
            display_offset: default_x11_display_offset(),
            screen: default_x11_screen(),
            display_override: None,
            xauthority_path: None,
            timeout_secs: default_x11_timeout(),
        }
    }
}

/// Runtime state for an active X11 forwarding session.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct X11ForwardInfo {
    pub session_id: String,
    /// Local DISPLAY string handed to the remote (e.g. "localhost:10.0").
    pub remote_display: String,
    /// Local TCP listener address (e.g. "127.0.0.1:6010").
    pub local_bind: String,
    /// Whether trusted mode is active.
    pub trusted: bool,
    /// Number of currently-open X11 channels.
    pub active_channels: u32,
    /// Monotonically increasing counter of channels opened since start.
    pub total_channels_opened: u64,
}

/// Status summary returned by `get_x11_forward_status`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct X11ForwardStatus {
    pub session_id: String,
    pub enabled: bool,
    pub info: Option<X11ForwardInfo>,
}

// ===============================
// ProxyCommand Types
// ===============================

/// ProxyCommand configuration — the command is spawned as a child process
/// and its stdin/stdout are spliced to the SSH transport layer, replacing
/// the usual TCP connection.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyCommandConfig {
    /// Full shell command (expanded).  Supports `%h` (host), `%p` (port),
    /// `%r` (username) placeholders that are substituted at connect time.
    /// Example: `ssh -W %h:%p jumpbox` or `nc -X 5 -x proxy:1080 %h %p`
    #[serde(default)]
    pub command: Option<String>,
    /// Or pick a built-in template and fill in the proxy coordinates.
    #[serde(default)]
    pub template: Option<ProxyCommandTemplate>,
    /// Proxy host used by templates.
    #[serde(default)]
    pub proxy_host: Option<String>,
    /// Proxy port used by templates.
    #[serde(default)]
    pub proxy_port: Option<u16>,
    /// Proxy username (for templates that support auth).
    #[serde(default)]
    pub proxy_username: Option<String>,
    /// Proxy password (for templates that support auth).
    #[serde(default)]
    pub proxy_password: Option<String>,
    /// Proxy type hint used by some templates (socks4 / socks5 / http).
    #[serde(default)]
    pub proxy_type: Option<String>,
    /// Timeout in seconds for the ProxyCommand to produce a usable stdio
    /// pipe (default: same as connect_timeout, or 15s).
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

/// Built-in ProxyCommand templates.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ProxyCommandTemplate {
    /// `nc %h %p`  (OpenBSD netcat)
    #[serde(rename = "nc")]
    Nc,
    /// `ncat --proxy-type <type> --proxy <host:port> %h %p`
    #[serde(rename = "ncat")]
    Ncat,
    /// `socat - TCP:%h:%p`
    #[serde(rename = "socat")]
    Socat,
    /// `connect -H <host:port> %h %p`  (BSD/GNU connect-proxy for HTTP)
    #[serde(rename = "connect")]
    Connect,
    /// `corkscrew <proxy_host> <proxy_port> %h %p`
    #[serde(rename = "corkscrew")]
    Corkscrew,
    /// `ssh -W %h:%p <jumpbox>`  (ProxyJump via OpenSSH stdio forward)
    #[serde(rename = "ssh_stdio")]
    SshStdio,
}

/// Status of a ProxyCommand child process.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProxyCommandStatus {
    pub session_id: String,
    /// The expanded command string that was executed.
    pub command: String,
    /// Whether the child process is still alive.
    pub alive: bool,
    /// OS process id of the child.
    pub pid: Option<u32>,
}

// ===============================
// Syntax Highlighting Types
// ===============================

/// A single regex-based highlight rule.
///
/// When terminal output matches `pattern`, the matched text is wrapped
/// in ANSI SGR escape sequences using the configured colours and styles.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HighlightRule {
    /// Unique identifier for this rule.
    pub id: String,
    /// Human-readable label (e.g. "Errors", "IP addresses").
    #[serde(default)]
    pub label: Option<String>,
    /// Regex pattern to match against visible (non-ANSI) terminal text.
    pub pattern: String,
    /// Whether this rule is active.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Foreground colour — CSS-style hex (`#ff0000`), named ANSI colour
    /// (`red`, `bright_green`, …), or an 8-bit index (`38` → `\x1b[38;5;38m`).
    #[serde(default)]
    pub fg_color: Option<String>,
    /// Background colour (same format as `fg_color`).
    #[serde(default)]
    pub bg_color: Option<String>,
    /// Bold text.
    #[serde(default)]
    pub bold: bool,
    /// Italic text.
    #[serde(default)]
    pub italic: bool,
    /// Underline text.
    #[serde(default)]
    pub underline: bool,
    /// Priority — lower numbers are applied first.  When two rules overlap
    /// the higher-priority (lower number) rule wins.
    #[serde(default)]
    pub priority: i32,
}

/// Compiled state for highlight rules on a session.
#[derive(Debug)]
pub struct HighlightState {
    /// The original rules (kept for serialisation back to the frontend).
    pub rules: Vec<HighlightRule>,
    /// Pre-compiled regexes (same order as `rules`, only for enabled rules).
    pub compiled: Vec<CompiledHighlight>,
}

/// A compiled highlight rule ready for use in the reader thread.
#[derive(Debug)]
pub struct CompiledHighlight {
    pub rule_id: String,
    pub regex: regex::Regex,
    /// Full ANSI SGR "open" sequence (e.g. `\x1b[1;31m`).
    pub ansi_open: String,
    /// ANSI SGR reset sequence (`\x1b[0m`).
    pub ansi_close: String,
    pub priority: i32,
}

/// Status returned to the frontend for active highlights on a session.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HighlightStatus {
    pub session_id: String,
    pub rules: Vec<HighlightRule>,
    pub active_count: usize,
}

/// Result of `test_highlight_rules` — shows what a rule set would produce.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HighlightTestResult {
    /// The input text (plain).
    pub input: String,
    /// The output text with ANSI highlight sequences injected.
    pub output: String,
    /// Number of matches found per rule id.
    pub match_counts: HashMap<String, usize>,
}

// ===============================
// FIDO2 / Security Key Types
// ===============================

/// Options for generating an SK key pair (passed from the frontend).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SkKeyGenerationRequest {
    /// Key type: "ed25519-sk" or "ecdsa-sk".
    pub key_type: String,
    /// Output file path for the generated key pair.
    pub output_path: String,
    /// RP / application string (default "ssh:").
    #[serde(default = "default_sk_application")]
    pub application: String,
    /// Passphrase to protect the private key file.
    #[serde(default)]
    pub passphrase: Option<String>,
    /// Whether to create a resident (discoverable) credential.
    #[serde(default)]
    pub resident: bool,
    /// Whether to require user verification (PIN / biometric).
    #[serde(default)]
    pub verify_required: bool,
    /// Disable touch requirement.
    #[serde(default)]
    pub no_touch_required: bool,
    /// Optional FIDO2 device path.
    #[serde(default)]
    pub device_path: Option<String>,
    /// Optional PIN.
    #[serde(default)]
    pub pin: Option<String>,
    /// Key comment.
    #[serde(default)]
    pub comment: Option<String>,
    /// User string for resident credentials.
    #[serde(default)]
    pub user: Option<String>,
}

fn default_sk_application() -> String {
    "ssh:".to_string()
}

/// Response from SK key generation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SkKeyGenerationResponse {
    /// Private key file path.
    pub private_key_path: String,
    /// Public key file path.
    pub public_key_path: String,
    /// Public key content (for display / copy).
    pub public_key_content: String,
    /// Key fingerprint.
    pub fingerprint: String,
    /// Whether the key is a resident credential.
    pub resident: bool,
    /// Algorithm used.
    pub algorithm: String,
}

/// A FIDO2 resident credential summary (for listing).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Fido2ResidentCredentialInfo {
    /// Relying party ID.
    pub rp_id: String,
    /// User name.
    pub user: Option<String>,
    /// Algorithm.
    pub algorithm: String,
    /// Public key line (OpenSSH format).
    pub public_key: Option<String>,
}
