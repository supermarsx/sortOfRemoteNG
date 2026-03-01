//! Shared types, enums, error types, and event payloads for the OpenVPN crate.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::PathBuf;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Connection state machine
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Top-level connection status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStatus {
    /// No process running.
    Disconnected,
    /// Process launched, waiting for management interface.
    Initializing,
    /// Management interface connected, waiting for TLS handshake.
    Connecting,
    /// TLS handshake in progress.
    TlsHandshake,
    /// Authenticating credentials.
    Authenticating,
    /// Waiting for server to push config.
    GettingConfig,
    /// Assigning IP address.
    AssigningIp,
    /// Routes being added.
    AddingRoutes,
    /// Tunnel is up and traffic is flowing.
    Connected,
    /// Graceful disconnect in progress.
    Disconnecting,
    /// Reconnecting after a failure.
    Reconnecting,
    /// Paused (e.g. user-initiated hold).
    Held,
    /// Process exited with an error.
    Error(String),
}

impl Default for ConnectionStatus {
    fn default() -> Self {
        Self::Disconnected
    }
}

impl fmt::Display for ConnectionStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Disconnected => write!(f, "Disconnected"),
            Self::Initializing => write!(f, "Initializing"),
            Self::Connecting => write!(f, "Connecting"),
            Self::TlsHandshake => write!(f, "TLS Handshake"),
            Self::Authenticating => write!(f, "Authenticating"),
            Self::GettingConfig => write!(f, "Getting Config"),
            Self::AssigningIp => write!(f, "Assigning IP"),
            Self::AddingRoutes => write!(f, "Adding Routes"),
            Self::Connected => write!(f, "Connected"),
            Self::Disconnecting => write!(f, "Disconnecting"),
            Self::Reconnecting => write!(f, "Reconnecting"),
            Self::Held => write!(f, "Held"),
            Self::Error(e) => write!(f, "Error: {}", e),
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Protocol / transport
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Transport protocol for the VPN tunnel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VpnProtocol {
    Udp,
    Tcp,
    Udp6,
    Tcp6,
}

impl Default for VpnProtocol {
    fn default() -> Self {
        Self::Udp
    }
}

impl fmt::Display for VpnProtocol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Udp => write!(f, "udp"),
            Self::Tcp => write!(f, "tcp"),
            Self::Udp6 => write!(f, "udp6"),
            Self::Tcp6 => write!(f, "tcp6"),
        }
    }
}

impl VpnProtocol {
    /// Parse from OpenVPN config string.
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "tcp" | "tcp-client" | "tcp4" => Self::Tcp,
            "udp6" => Self::Udp6,
            "tcp6" | "tcp6-client" => Self::Tcp6,
            _ => Self::Udp,
        }
    }
}

/// TUN/TAP device type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceType {
    Tun,
    Tap,
}

impl Default for DeviceType {
    fn default() -> Self {
        Self::Tun
    }
}

impl fmt::Display for DeviceType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Tun => write!(f, "tun"),
            Self::Tap => write!(f, "tap"),
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Cipher / auth / compression
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Cipher algorithm.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Cipher {
    Aes256Gcm,
    Aes128Gcm,
    Aes256Cbc,
    Aes128Cbc,
    ChaCha20Poly1305,
    BlowfishCbc,
    Custom(String),
}

impl Default for Cipher {
    fn default() -> Self {
        Self::Aes256Gcm
    }
}

impl fmt::Display for Cipher {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Aes256Gcm => write!(f, "AES-256-GCM"),
            Self::Aes128Gcm => write!(f, "AES-128-GCM"),
            Self::Aes256Cbc => write!(f, "AES-256-CBC"),
            Self::Aes128Cbc => write!(f, "AES-128-CBC"),
            Self::ChaCha20Poly1305 => write!(f, "CHACHA20-POLY1305"),
            Self::BlowfishCbc => write!(f, "BF-CBC"),
            Self::Custom(c) => write!(f, "{}", c),
        }
    }
}

impl Cipher {
    /// Parse from config string.
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_uppercase().as_str() {
            "AES-256-GCM" => Self::Aes256Gcm,
            "AES-128-GCM" => Self::Aes128Gcm,
            "AES-256-CBC" => Self::Aes256Cbc,
            "AES-128-CBC" => Self::Aes128Cbc,
            "CHACHA20-POLY1305" => Self::ChaCha20Poly1305,
            "BF-CBC" => Self::BlowfishCbc,
            other => Self::Custom(other.to_string()),
        }
    }

    /// Whether this cipher uses AEAD (no separate HMAC needed).
    pub fn is_aead(&self) -> bool {
        matches!(
            self,
            Self::Aes256Gcm | Self::Aes128Gcm | Self::ChaCha20Poly1305
        )
    }
}

/// HMAC digest algorithm.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuthDigest {
    Sha256,
    Sha384,
    Sha512,
    Sha1,
    Custom(String),
}

impl Default for AuthDigest {
    fn default() -> Self {
        Self::Sha256
    }
}

impl fmt::Display for AuthDigest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sha256 => write!(f, "SHA256"),
            Self::Sha384 => write!(f, "SHA384"),
            Self::Sha512 => write!(f, "SHA512"),
            Self::Sha1 => write!(f, "SHA1"),
            Self::Custom(c) => write!(f, "{}", c),
        }
    }
}

impl AuthDigest {
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_uppercase().as_str() {
            "SHA256" => Self::Sha256,
            "SHA384" => Self::Sha384,
            "SHA512" => Self::Sha512,
            "SHA1" | "SHA" => Self::Sha1,
            other => Self::Custom(other.to_string()),
        }
    }
}

/// Compression algorithm.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Compression {
    None,
    Lz4,
    Lz4V2,
    Lzo,
    Stub,
    StubV2,
    Migrate,
}

impl Default for Compression {
    fn default() -> Self {
        Self::None
    }
}

impl fmt::Display for Compression {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::None => write!(f, ""),
            Self::Lz4 => write!(f, "lz4"),
            Self::Lz4V2 => write!(f, "lz4-v2"),
            Self::Lzo => write!(f, "lzo"),
            Self::Stub => write!(f, "stub"),
            Self::StubV2 => write!(f, "stub-v2"),
            Self::Migrate => write!(f, "migrate"),
        }
    }
}

impl Compression {
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "lz4" => Self::Lz4,
            "lz4-v2" => Self::Lz4V2,
            "lzo" => Self::Lzo,
            "stub" => Self::Stub,
            "stub-v2" => Self::StubV2,
            "migrate" => Self::Migrate,
            _ => Self::None,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TLS mode
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// TLS wrapping mode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TlsMode {
    /// No extra TLS wrapping.
    None,
    /// `--tls-auth <file> <direction>`
    TlsAuth { key_path: String, direction: Option<u8> },
    /// `--tls-crypt <file>`
    TlsCrypt { key_path: String },
    /// `--tls-crypt-v2 <file>`
    TlsCryptV2 { key_path: String },
}

impl Default for TlsMode {
    fn default() -> Self {
        Self::None
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OpenVPN connection configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Full configuration for an OpenVPN connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenVpnConfig {
    // ── Identity ─────────────────────────────────────────────
    /// Human-readable label.
    pub label: Option<String>,
    /// Path to an existing `.ovpn` file (if using file-based config).
    pub config_file: Option<String>,

    // ── Remote server ────────────────────────────────────────
    /// One or more remote endpoints (host, port, proto).
    pub remotes: Vec<RemoteEndpoint>,
    /// Randomly pick from remotes instead of sequential failover.
    pub remote_random: bool,
    /// Resolve hostname once at start vs on each reconnect.
    pub resolve_retry_infinite: bool,

    // ── Device / protocol ────────────────────────────────────
    pub device_type: DeviceType,
    pub device_name: Option<String>,

    // ── Cryptography ─────────────────────────────────────────
    pub cipher: Cipher,
    /// Negotiate cipher with server (OpenVPN 2.4+).
    pub data_ciphers: Vec<Cipher>,
    pub auth_digest: AuthDigest,
    pub tls_mode: TlsMode,
    /// Minimum TLS version (e.g. "1.2").
    pub tls_version_min: Option<String>,
    /// TLS cipher suites.
    pub tls_cipher: Option<String>,

    // ── Authentication ───────────────────────────────────────
    pub auth_user_pass: bool,
    pub username: Option<String>,
    pub password: Option<String>,
    /// Path to auth-user-pass file.
    pub auth_file: Option<String>,
    /// Path to CA certificate.
    pub ca_cert: Option<String>,
    /// Path to client certificate.
    pub client_cert: Option<String>,
    /// Path to client private key.
    pub client_key: Option<String>,
    /// PKCS#12 bundle path.
    pub pkcs12: Option<String>,
    /// Verify server CN / x509-name.
    pub verify_x509_name: Option<String>,
    /// `remote-cert-tls server`
    pub remote_cert_tls: bool,

    // ── Network tuning ───────────────────────────────────────
    pub mtu: Option<u16>,
    pub mss_fix: Option<u16>,
    pub fragment: Option<u16>,
    pub sndbuf: Option<u32>,
    pub rcvbuf: Option<u32>,
    pub compression: Compression,

    // ── Keep-alive / timeouts ────────────────────────────────
    pub keepalive_interval: Option<u16>,
    pub keepalive_timeout: Option<u16>,
    pub connect_timeout: Option<u16>,
    pub connect_retry: Option<u16>,
    pub connect_retry_max: Option<u16>,
    pub server_poll_timeout: Option<u16>,
    pub hand_window: Option<u16>,
    pub tran_window: Option<u16>,
    pub inactive_timeout: Option<u32>,

    // ── Routing ──────────────────────────────────────────────
    pub pull_routes: bool,
    pub route_no_pull: bool,
    pub redirect_gateway: bool,
    pub routes: Vec<RouteEntry>,
    pub ipv6_routes: Vec<Ipv6RouteEntry>,

    // ── DNS ──────────────────────────────────────────────────
    pub dns_servers: Vec<String>,
    pub search_domains: Vec<String>,
    pub block_outside_dns: bool,

    // ── Proxy ────────────────────────────────────────────────
    pub http_proxy: Option<ProxyConfig>,
    pub socks_proxy: Option<ProxyConfig>,

    // ── Management interface ─────────────────────────────────
    pub management_addr: Option<String>,
    pub management_port: Option<u16>,
    pub management_password: Option<String>,

    // ── Logging ──────────────────────────────────────────────
    pub verbosity: u8,
    pub mute: Option<u16>,
    pub log_file: Option<String>,

    // ── Misc ─────────────────────────────────────────────────
    pub persist_tun: bool,
    pub persist_key: bool,
    pub nobind: bool,
    pub float: bool,
    pub passtos: bool,
    pub fast_io: bool,
    pub allow_pull_fqdn: bool,
    pub custom_directives: Vec<String>,
    /// Inline cert/key content (base64 encoded).
    pub inline_ca: Option<String>,
    pub inline_cert: Option<String>,
    pub inline_key: Option<String>,
    pub inline_tls_auth: Option<String>,
    pub inline_tls_crypt: Option<String>,
}

impl Default for OpenVpnConfig {
    fn default() -> Self {
        Self {
            label: None,
            config_file: None,
            remotes: Vec::new(),
            remote_random: false,
            resolve_retry_infinite: true,
            device_type: DeviceType::Tun,
            device_name: None,
            cipher: Cipher::Aes256Gcm,
            data_ciphers: vec![
                Cipher::Aes256Gcm,
                Cipher::Aes128Gcm,
                Cipher::ChaCha20Poly1305,
            ],
            auth_digest: AuthDigest::Sha256,
            tls_mode: TlsMode::None,
            tls_version_min: None,
            tls_cipher: None,
            auth_user_pass: false,
            username: None,
            password: None,
            auth_file: None,
            ca_cert: None,
            client_cert: None,
            client_key: None,
            pkcs12: None,
            verify_x509_name: None,
            remote_cert_tls: true,
            mtu: None,
            mss_fix: None,
            fragment: None,
            sndbuf: None,
            rcvbuf: None,
            compression: Compression::None,
            keepalive_interval: Some(10),
            keepalive_timeout: Some(120),
            connect_timeout: Some(30),
            connect_retry: Some(5),
            connect_retry_max: None,
            server_poll_timeout: None,
            hand_window: None,
            tran_window: None,
            inactive_timeout: None,
            pull_routes: true,
            route_no_pull: false,
            redirect_gateway: false,
            routes: Vec::new(),
            ipv6_routes: Vec::new(),
            dns_servers: Vec::new(),
            search_domains: Vec::new(),
            block_outside_dns: false,
            http_proxy: None,
            socks_proxy: None,
            management_addr: Some("127.0.0.1".to_string()),
            management_port: None,
            management_password: None,
            verbosity: 3,
            mute: None,
            log_file: None,
            persist_tun: true,
            persist_key: true,
            nobind: true,
            float: false,
            passtos: false,
            fast_io: false,
            allow_pull_fqdn: false,
            custom_directives: Vec::new(),
            inline_ca: None,
            inline_cert: None,
            inline_key: None,
            inline_tls_auth: None,
            inline_tls_crypt: None,
        }
    }
}

/// A remote endpoint entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteEndpoint {
    pub host: String,
    pub port: u16,
    pub protocol: VpnProtocol,
}

impl Default for RemoteEndpoint {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 1194,
            protocol: VpnProtocol::Udp,
        }
    }
}

/// IPv4 route entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteEntry {
    pub network: String,
    pub netmask: String,
    pub gateway: Option<String>,
    pub metric: Option<u32>,
}

/// IPv6 route entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ipv6RouteEntry {
    pub network: String,
    pub prefix_len: u8,
    pub gateway: Option<String>,
}

/// Proxy configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Connection info / session snapshot
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Snapshot of a running (or recently-closed) connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub id: String,
    pub label: String,
    pub status: ConnectionStatus,
    pub remote: Option<RemoteEndpoint>,
    pub local_ip: Option<String>,
    pub remote_ip: Option<String>,
    pub server_ip: Option<String>,
    pub process_id: Option<u32>,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
    pub disconnected_at: Option<DateTime<Utc>>,
    pub bytes_rx: u64,
    pub bytes_tx: u64,
    pub uptime_seconds: u64,
    pub last_error: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Bandwidth / stats
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Point-in-time bandwidth sample.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandwidthSample {
    pub timestamp: DateTime<Utc>,
    pub bytes_rx: u64,
    pub bytes_tx: u64,
    pub rx_per_sec: f64,
    pub tx_per_sec: f64,
}

/// Cumulative session statistics.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionStats {
    pub total_bytes_rx: u64,
    pub total_bytes_tx: u64,
    pub peak_rx_per_sec: f64,
    pub peak_tx_per_sec: f64,
    pub avg_rx_per_sec: f64,
    pub avg_tx_per_sec: f64,
    pub reconnect_count: u32,
    pub auth_failures: u32,
    pub tls_errors: u32,
    pub samples: usize,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Management interface types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Parsed real-time message from the management interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MgmtMessage {
    /// >INFO: message
    Info(String),
    /// >STATE: fields…
    State(MgmtState),
    /// >BYTECOUNT: rx,tx
    ByteCount { rx: u64, tx: u64 },
    /// >HOLD: message
    Hold(String),
    /// >PASSWORD: Need 'Auth' username/password
    PasswordNeeded(String),
    /// >LOG: timestamp,flags,message
    Log(MgmtLogEntry),
    /// >CLIENT: event
    ClientEvent(String),
    /// >FATAL: message
    Fatal(String),
    /// >REMOTE: host,port,proto
    Remote { host: String, port: u16, proto: String },
    /// >RST: restart
    Restart,
    /// >NEED-OK: message
    NeedOk(String),
    /// Echo message from server
    Echo(String),
    /// Any unrecognised real-time message.
    Unknown(String),
}

/// Parsed `>STATE:` line.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MgmtState {
    pub timestamp: u64,
    pub state_name: String,
    pub description: String,
    pub local_ip: Option<String>,
    pub remote_ip: Option<String>,
    pub local_port: Option<u16>,
    pub remote_port: Option<u16>,
}

/// Parsed `>LOG:` line.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MgmtLogEntry {
    pub timestamp: u64,
    pub flags: String,
    pub message: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Event payloads (emitted to Tauri frontend)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Emitted when connection status changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusChangeEvent {
    pub connection_id: String,
    pub old_status: ConnectionStatus,
    pub new_status: ConnectionStatus,
    pub timestamp: DateTime<Utc>,
}

/// Emitted periodically with bandwidth data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandwidthEvent {
    pub connection_id: String,
    pub sample: BandwidthSample,
}

/// Emitted on management interface log lines.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEvent {
    pub connection_id: String,
    pub entry: MgmtLogEntry,
}

/// Emitted when a connection needs credentials interactively.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthRequestEvent {
    pub connection_id: String,
    pub auth_type: String,
    pub message: String,
}

/// Emitted when an error occurs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorEvent {
    pub connection_id: String,
    pub error: String,
    pub timestamp: DateTime<Utc>,
}

/// Emitted when tunnel IP is assigned.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelUpEvent {
    pub connection_id: String,
    pub local_ip: String,
    pub remote_ip: Option<String>,
    pub gateway: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Error type
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Crate-level error kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum OpenVpnErrorKind {
    ProcessSpawnFailed,
    ProcessExitedUnexpectedly,
    ManagementConnectFailed,
    ManagementCommandFailed,
    ConfigInvalid,
    ConfigFileNotFound,
    AuthFailed,
    TlsError,
    RouteError,
    DnsError,
    Timeout,
    AlreadyConnected,
    NotConnected,
    NotFound,
    PermissionDenied,
    IoError,
    ParseError,
    Internal,
}

/// Crate-level error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenVpnError {
    pub kind: OpenVpnErrorKind,
    pub message: String,
    pub detail: Option<String>,
}

impl fmt::Display for OpenVpnError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)?;
        if let Some(d) = &self.detail {
            write!(f, " ({})", d)?;
        }
        Ok(())
    }
}

impl OpenVpnError {
    pub fn new(kind: OpenVpnErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

impl From<OpenVpnError> for String {
    fn from(e: OpenVpnError) -> String {
        e.to_string()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Binary location helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Well-known OpenVPN binary paths by platform.
pub fn default_binary_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(target_os = "windows")]
    {
        paths.push(PathBuf::from(r"C:\Program Files\OpenVPN\bin\openvpn.exe"));
        paths.push(PathBuf::from(
            r"C:\Program Files (x86)\OpenVPN\bin\openvpn.exe",
        ));
        paths.push(PathBuf::from(
            r"C:\Program Files\OpenVPN Connect\core\openvpn.exe",
        ));
    }
    #[cfg(target_os = "linux")]
    {
        paths.push(PathBuf::from("/usr/sbin/openvpn"));
        paths.push(PathBuf::from("/usr/bin/openvpn"));
        paths.push(PathBuf::from("/usr/local/sbin/openvpn"));
    }
    #[cfg(target_os = "macos")]
    {
        paths.push(PathBuf::from("/usr/local/sbin/openvpn"));
        paths.push(PathBuf::from("/opt/homebrew/sbin/openvpn"));
        paths.push(PathBuf::from("/usr/local/opt/openvpn/sbin/openvpn"));
    }
    paths
}

/// Try to find the openvpn binary on the system.
pub fn find_openvpn_binary() -> Option<PathBuf> {
    // First check well-known paths
    for p in default_binary_paths() {
        if p.exists() {
            return Some(p);
        }
    }
    // Fall back to PATH
    #[cfg(target_os = "windows")]
    let name = "openvpn.exe";
    #[cfg(not(target_os = "windows"))]
    let name = "openvpn";

    if let Ok(path_env) = std::env::var("PATH") {
        #[cfg(target_os = "windows")]
        let sep = ';';
        #[cfg(not(target_os = "windows"))]
        let sep = ':';
        for dir in path_env.split(sep) {
            let full = PathBuf::from(dir).join(name);
            if full.exists() {
                return Some(full);
            }
        }
    }
    None
}

/// Parse an OpenVPN `--version` output line (e.g. "OpenVPN 2.6.8 …").
pub fn parse_version_string(output: &str) -> Option<String> {
    let re = regex::Regex::new(r"OpenVPN\s+(\d+\.\d+\.\d+)").ok()?;
    re.captures(output).map(|c| c[1].to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Reconnect policy
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Reconnect behaviour on unexpected disconnection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconnectPolicy {
    pub enabled: bool,
    pub max_attempts: u32,
    pub base_delay_secs: u32,
    pub max_delay_secs: u32,
    /// Exponential back-off factor.
    pub backoff_factor: f64,
    /// Jitter up to this many seconds.
    pub jitter_secs: u32,
}

impl Default for ReconnectPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            max_attempts: 10,
            base_delay_secs: 2,
            max_delay_secs: 300,
            backoff_factor: 2.0,
            jitter_secs: 3,
        }
    }
}

impl ReconnectPolicy {
    /// Calculate delay for the given attempt (0-indexed).
    pub fn delay_for_attempt(&self, attempt: u32) -> u64 {
        if !self.enabled || attempt >= self.max_attempts {
            return 0;
        }
        let base = self.base_delay_secs as f64 * self.backoff_factor.powi(attempt as i32);
        let clamped = base.min(self.max_delay_secs as f64) as u64;
        clamped
    }

    /// Whether another attempt is allowed.
    pub fn should_retry(&self, attempt: u32) -> bool {
        self.enabled && attempt < self.max_attempts
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── ConnectionStatus ─────────────────────────────────────────

    #[test]
    fn status_serde_roundtrip() {
        let statuses = vec![
            ConnectionStatus::Disconnected,
            ConnectionStatus::Connecting,
            ConnectionStatus::Connected,
            ConnectionStatus::Disconnecting,
            ConnectionStatus::Reconnecting,
            ConnectionStatus::Held,
            ConnectionStatus::Error("oops".into()),
        ];
        for s in &statuses {
            let json = serde_json::to_string(s).unwrap();
            let back: ConnectionStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(s, &back);
        }
    }

    #[test]
    fn status_display() {
        assert_eq!(ConnectionStatus::Connected.to_string(), "Connected");
        assert_eq!(
            ConnectionStatus::Error("x".into()).to_string(),
            "Error: x"
        );
    }

    // ── VpnProtocol ──────────────────────────────────────────────

    #[test]
    fn protocol_from_str_loose() {
        assert_eq!(VpnProtocol::from_str_loose("tcp"), VpnProtocol::Tcp);
        assert_eq!(VpnProtocol::from_str_loose("tcp-client"), VpnProtocol::Tcp);
        assert_eq!(VpnProtocol::from_str_loose("udp6"), VpnProtocol::Udp6);
        assert_eq!(VpnProtocol::from_str_loose("anything"), VpnProtocol::Udp);
    }

    #[test]
    fn protocol_display() {
        assert_eq!(VpnProtocol::Udp.to_string(), "udp");
        assert_eq!(VpnProtocol::Tcp.to_string(), "tcp");
    }

    // ── Cipher ───────────────────────────────────────────────────

    #[test]
    fn cipher_from_str_loose() {
        assert_eq!(Cipher::from_str_loose("AES-256-GCM"), Cipher::Aes256Gcm);
        assert_eq!(
            Cipher::from_str_loose("CHACHA20-POLY1305"),
            Cipher::ChaCha20Poly1305
        );
        assert!(matches!(Cipher::from_str_loose("RC4"), Cipher::Custom(_)));
    }

    #[test]
    fn cipher_is_aead() {
        assert!(Cipher::Aes256Gcm.is_aead());
        assert!(Cipher::ChaCha20Poly1305.is_aead());
        assert!(!Cipher::Aes256Cbc.is_aead());
        assert!(!Cipher::BlowfishCbc.is_aead());
    }

    #[test]
    fn cipher_display() {
        assert_eq!(Cipher::Aes256Gcm.to_string(), "AES-256-GCM");
        assert_eq!(Cipher::BlowfishCbc.to_string(), "BF-CBC");
    }

    // ── AuthDigest ───────────────────────────────────────────────

    #[test]
    fn auth_digest_roundtrip() {
        let d = AuthDigest::Sha512;
        let json = serde_json::to_string(&d).unwrap();
        let back: AuthDigest = serde_json::from_str(&json).unwrap();
        assert_eq!(d, back);
    }

    #[test]
    fn auth_digest_from_str_loose() {
        assert_eq!(AuthDigest::from_str_loose("SHA1"), AuthDigest::Sha1);
        assert_eq!(AuthDigest::from_str_loose("SHA"), AuthDigest::Sha1);
        assert_eq!(AuthDigest::from_str_loose("SHA256"), AuthDigest::Sha256);
    }

    // ── Compression ──────────────────────────────────────────────

    #[test]
    fn compression_from_str_loose() {
        assert_eq!(Compression::from_str_loose("lz4"), Compression::Lz4);
        assert_eq!(Compression::from_str_loose("lzo"), Compression::Lzo);
        assert_eq!(Compression::from_str_loose("stub-v2"), Compression::StubV2);
        assert_eq!(Compression::from_str_loose("xyz"), Compression::None);
    }

    // ── Config defaults ──────────────────────────────────────────

    #[test]
    fn config_defaults() {
        let cfg = OpenVpnConfig::default();
        assert_eq!(cfg.cipher, Cipher::Aes256Gcm);
        assert_eq!(cfg.device_type, DeviceType::Tun);
        assert!(cfg.nobind);
        assert!(cfg.persist_tun);
        assert!(cfg.remote_cert_tls);
        assert_eq!(cfg.verbosity, 3);
        assert_eq!(cfg.keepalive_interval, Some(10));
        assert_eq!(cfg.keepalive_timeout, Some(120));
    }

    #[test]
    fn config_serde_roundtrip() {
        let mut cfg = OpenVpnConfig::default();
        cfg.label = Some("Test".into());
        cfg.remotes.push(RemoteEndpoint {
            host: "vpn.example.com".into(),
            port: 443,
            protocol: VpnProtocol::Tcp,
        });
        let json = serde_json::to_string(&cfg).unwrap();
        let back: OpenVpnConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.label, Some("Test".into()));
        assert_eq!(back.remotes.len(), 1);
        assert_eq!(back.remotes[0].host, "vpn.example.com");
    }

    // ── ReconnectPolicy ──────────────────────────────────────────

    #[test]
    fn reconnect_delay_exponential() {
        let p = ReconnectPolicy::default();
        assert_eq!(p.delay_for_attempt(0), 2); // 2 * 2^0
        assert_eq!(p.delay_for_attempt(1), 4); // 2 * 2^1
        assert_eq!(p.delay_for_attempt(2), 8); // 2 * 2^2
        // Should be clamped to max_delay_secs (300)
        assert!(p.delay_for_attempt(9) <= 300);
    }

    #[test]
    fn reconnect_should_retry() {
        let p = ReconnectPolicy {
            max_attempts: 3,
            ..Default::default()
        };
        assert!(p.should_retry(0));
        assert!(p.should_retry(2));
        assert!(!p.should_retry(3));
    }

    #[test]
    fn reconnect_disabled() {
        let p = ReconnectPolicy {
            enabled: false,
            ..Default::default()
        };
        assert!(!p.should_retry(0));
        assert_eq!(p.delay_for_attempt(0), 0);
    }

    // ── OpenVpnError ─────────────────────────────────────────────

    #[test]
    fn error_display() {
        let e = OpenVpnError::new(OpenVpnErrorKind::AuthFailed, "bad creds");
        assert!(e.to_string().contains("bad creds"));
        let e2 = e.with_detail("try again");
        assert!(e2.to_string().contains("try again"));
    }

    #[test]
    fn error_into_string() {
        let e = OpenVpnError::new(OpenVpnErrorKind::Timeout, "timed out");
        let s: String = e.into();
        assert!(s.contains("timed out"));
    }

    // ── Binary helpers ───────────────────────────────────────────

    #[test]
    fn default_binary_paths_not_empty() {
        let paths = default_binary_paths();
        assert!(!paths.is_empty());
    }

    #[test]
    fn parse_version_string_valid() {
        let output = "OpenVPN 2.6.8 x86_64-w64-mingw32 [SSL (OpenSSL)]";
        assert_eq!(parse_version_string(output), Some("2.6.8".into()));
    }

    #[test]
    fn parse_version_string_invalid() {
        assert_eq!(parse_version_string("no version here"), None);
    }

    // ── MgmtMessage serde ────────────────────────────────────────

    #[test]
    fn mgmt_message_serde_roundtrip() {
        let msg = MgmtMessage::ByteCount {
            rx: 1234,
            tx: 5678,
        };
        let json = serde_json::to_string(&msg).unwrap();
        let back: MgmtMessage = serde_json::from_str(&json).unwrap();
        if let MgmtMessage::ByteCount { rx, tx } = back {
            assert_eq!(rx, 1234);
            assert_eq!(tx, 5678);
        } else {
            panic!("Wrong variant");
        }
    }

    #[test]
    fn connection_info_serde() {
        let info = ConnectionInfo {
            id: "abc".into(),
            label: "My VPN".into(),
            status: ConnectionStatus::Connected,
            remote: Some(RemoteEndpoint::default()),
            local_ip: Some("10.8.0.2".into()),
            remote_ip: Some("10.8.0.1".into()),
            server_ip: Some("1.2.3.4".into()),
            process_id: Some(1234),
            created_at: Utc::now(),
            connected_at: Some(Utc::now()),
            disconnected_at: None,
            bytes_rx: 100,
            bytes_tx: 200,
            uptime_seconds: 60,
            last_error: None,
        };
        let json = serde_json::to_string(&info).unwrap();
        let back: ConnectionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "abc");
        assert_eq!(back.local_ip, Some("10.8.0.2".into()));
    }

    #[test]
    fn session_stats_default() {
        let s = SessionStats::default();
        assert_eq!(s.total_bytes_rx, 0);
        assert_eq!(s.reconnect_count, 0);
    }

    #[test]
    fn bandwidth_sample_serde() {
        let s = BandwidthSample {
            timestamp: Utc::now(),
            bytes_rx: 100,
            bytes_tx: 200,
            rx_per_sec: 50.0,
            tx_per_sec: 100.0,
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: BandwidthSample = serde_json::from_str(&json).unwrap();
        assert_eq!(back.bytes_rx, 100);
    }
}
