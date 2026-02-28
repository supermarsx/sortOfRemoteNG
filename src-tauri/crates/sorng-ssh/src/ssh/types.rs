use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use ssh2::Session;
use chrono::{DateTime, Utc};

use super::service::SshService;

// ===============================
// Default value helpers
// ===============================

pub fn default_true() -> bool { true }
pub fn default_keepalive_probes() -> u32 { 2 }
pub(crate) fn default_ip_protocol() -> String { "auto".to_string() }
pub(crate) fn default_compression_level() -> u32 { 6 }
pub(crate) fn default_ssh_version() -> String { "auto".to_string() }
pub(crate) fn default_proxy_timeout() -> u64 { 10000 }
pub(crate) fn default_automation_timeout() -> u64 { 30000 }
pub fn default_ftp_port() -> u16 { 21 }
pub(crate) fn default_passive_port_count() -> u16 { 10 }
pub fn default_rdp_port() -> u16 { 3389 }
pub fn default_vnc_port() -> u16 { 5900 }

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
pub(crate) struct RecordingState {
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
pub(crate) struct AutomationState {
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
