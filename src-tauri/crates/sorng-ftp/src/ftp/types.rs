//! Shared types for the FTP crate.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Connection / Session ────────────────────────────────────────────

/// Security mode for the control channel.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FtpSecurityMode {
    /// Plain-text FTP (port 21).
    None,
    /// Explicit FTPS — starts plain then upgrades via AUTH TLS (port 21).
    Explicit,
    /// Implicit FTPS — TLS from the first byte (port 990).
    Implicit,
}

impl Default for FtpSecurityMode {
    fn default() -> Self {
        Self::None
    }
}

/// Transfer type (RFC 959 TYPE command).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TransferType {
    Ascii,
    Binary,
}

impl Default for TransferType {
    fn default() -> Self {
        Self::Binary
    }
}

/// Transfer mode selected for the data channel.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DataChannelMode {
    Passive,
    ExtendedPassive,
    Active,
    ExtendedActive,
}

impl Default for DataChannelMode {
    fn default() -> Self {
        Self::Passive
    }
}

/// Configuration for a single FTP connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpConnectionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub security: FtpSecurityMode,
    #[serde(default)]
    pub transfer_type: TransferType,
    #[serde(default)]
    pub data_channel_mode: DataChannelMode,
    /// Initial remote directory to CWD into after login.
    #[serde(default)]
    pub initial_directory: Option<String>,
    /// Connection timeout in seconds.
    #[serde(default = "default_connect_timeout")]
    pub connect_timeout_sec: u64,
    /// Data-channel timeout in seconds.
    #[serde(default = "default_data_timeout")]
    pub data_timeout_sec: u64,
    /// Number of keepalive NOOPs per minute (0 = disabled).
    #[serde(default = "default_keepalive")]
    pub keepalive_interval_sec: u64,
    /// Accept self-signed / untrusted certificates.
    #[serde(default)]
    pub accept_invalid_certs: bool,
    /// UTF-8 encoding (OPTS UTF8 ON).
    #[serde(default = "default_true")]
    pub utf8: bool,
    /// Local address to bind for active-mode data connections.
    #[serde(default)]
    pub active_bind_address: Option<String>,
    /// Friendly label shown in the UI.
    #[serde(default)]
    pub label: Option<String>,
}

fn default_connect_timeout() -> u64 {
    15
}
fn default_data_timeout() -> u64 {
    30
}
fn default_keepalive() -> u64 {
    60
}
fn default_true() -> bool {
    true
}

impl Default for FtpConnectionConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 21,
            username: "anonymous".into(),
            password: "anonymous@".into(),
            security: FtpSecurityMode::None,
            transfer_type: TransferType::Binary,
            data_channel_mode: DataChannelMode::Passive,
            initial_directory: None,
            connect_timeout_sec: default_connect_timeout(),
            data_timeout_sec: default_data_timeout(),
            keepalive_interval_sec: default_keepalive(),
            accept_invalid_certs: false,
            utf8: true,
            active_bind_address: None,
            label: None,
        }
    }
}

/// Information about an active FTP session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpSessionInfo {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub security: FtpSecurityMode,
    pub connected: bool,
    pub current_directory: String,
    pub server_banner: Option<String>,
    pub system_type: Option<String>,
    pub features: Vec<String>,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub transfer_type: TransferType,
    pub label: Option<String>,
    pub bytes_uploaded: u64,
    pub bytes_downloaded: u64,
}

// ─── Directory Listing ───────────────────────────────────────────────

/// Type of a remote filesystem entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FtpEntryKind {
    File,
    Directory,
    Symlink,
    Unknown,
}

/// One entry from a directory listing (parsed from LIST or MLSD output).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpEntry {
    pub name: String,
    pub kind: FtpEntryKind,
    pub size: u64,
    pub modified: Option<DateTime<Utc>>,
    pub permissions: Option<String>,
    pub owner: Option<String>,
    pub group: Option<String>,
    pub link_target: Option<String>,
    /// Raw line from the server (for debugging).
    pub raw: Option<String>,
    /// MLSD fact map (e.g. "type" → "file", "size" → "1234").
    #[serde(default)]
    pub facts: HashMap<String, String>,
}

/// Sorting field for directory listings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FtpSortField {
    Name,
    Size,
    Modified,
    Kind,
}

/// Sort order.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FtpSortOrder {
    Asc,
    Desc,
}

/// Options for listing a directory.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListOptions {
    /// Filter by glob pattern (e.g. "*.txt").
    pub filter: Option<String>,
    pub sort_by: Option<FtpSortField>,
    pub sort_order: Option<FtpSortOrder>,
    /// Show hidden ("dot") files.
    #[serde(default = "default_true")]
    pub show_hidden: bool,
    /// Prefer MLSD over LIST when the server supports it.
    #[serde(default = "default_true")]
    pub prefer_mlsd: bool,
}

// ─── Transfer ────────────────────────────────────────────────────────

/// Direction of a file transfer.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TransferDirection {
    Upload,
    Download,
}

/// Current state of a transfer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TransferState {
    Queued,
    InProgress,
    Paused,
    Completed,
    Failed,
    Cancelled,
    Retrying,
}

/// A queued transfer item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferItem {
    pub id: String,
    pub session_id: String,
    pub direction: TransferDirection,
    pub local_path: String,
    pub remote_path: String,
    pub state: TransferState,
    pub total_bytes: Option<u64>,
    pub transferred_bytes: u64,
    pub speed_bps: u64,
    pub eta_seconds: Option<u32>,
    pub error: Option<String>,
    pub retry_count: u32,
    pub max_retries: u32,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub transfer_type: TransferType,
    /// Resume from byte offset (REST).
    pub resume_offset: u64,
}

/// Live progress snapshot for a single transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    pub session_id: String,
    pub direction: TransferDirection,
    pub local_path: String,
    pub remote_path: String,
    pub total_bytes: Option<u64>,
    pub transferred_bytes: u64,
    pub speed_bps: u64,
    pub eta_seconds: Option<u32>,
    pub percent: f32,
    pub state: TransferState,
}

/// Configuration for the transfer queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferQueueConfig {
    /// Maximum concurrent transfers across all sessions.
    #[serde(default = "default_concurrent")]
    pub max_concurrent: usize,
    /// Default number of retries on failure.
    #[serde(default = "default_retries")]
    pub default_retries: u32,
    /// Retry back-off base in seconds.
    #[serde(default = "default_backoff")]
    pub retry_backoff_sec: u64,
    /// Chunk size for progress-tracked reads/writes (bytes).
    #[serde(default = "default_chunk")]
    pub chunk_size: usize,
}

fn default_concurrent() -> usize {
    3
}
fn default_retries() -> u32 {
    3
}
fn default_backoff() -> u64 {
    5
}
fn default_chunk() -> usize {
    65_536
}

impl Default for TransferQueueConfig {
    fn default() -> Self {
        Self {
            max_concurrent: default_concurrent(),
            default_retries: default_retries(),
            retry_backoff_sec: default_backoff(),
            chunk_size: default_chunk(),
        }
    }
}

// ─── FTP Response ────────────────────────────────────────────────────

/// A single FTP response (may be multi-line).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpResponse {
    pub code: u16,
    pub lines: Vec<String>,
}

impl FtpResponse {
    /// Full response text (all lines joined).
    pub fn text(&self) -> String {
        self.lines.join("\n")
    }

    /// Whether the response code indicates success (1xx–3xx).
    pub fn is_success(&self) -> bool {
        self.code < 400
    }

    /// Whether this is a positive-preliminary reply (1xx).
    pub fn is_preliminary(&self) -> bool {
        (100..200).contains(&self.code)
    }

    /// Whether this is a positive-completion reply (2xx).
    pub fn is_completion(&self) -> bool {
        (200..300).contains(&self.code)
    }

    /// Whether this is a positive-intermediate reply (3xx).
    pub fn is_intermediate(&self) -> bool {
        (300..400).contains(&self.code)
    }
}

// ─── Connection Pool ─────────────────────────────────────────────────

/// Statistics about the connection pool.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolStats {
    pub total_sessions: u32,
    pub active_sessions: u32,
    pub idle_sessions: u32,
    pub max_sessions: u32,
}

// ─── Server Capabilities ─────────────────────────────────────────────

/// Parsed FEAT response.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerFeatures {
    pub mlsd: bool,
    pub mlst: bool,
    pub size: bool,
    pub mdtm: bool,
    pub rest_stream: bool,
    pub utf8: bool,
    pub epsv: bool,
    pub eprt: bool,
    pub auth_tls: bool,
    pub pbsz: bool,
    pub prot: bool,
    pub tvfs: bool,
    pub clnt: bool,
    pub mfmt: bool,
    pub raw_features: Vec<String>,
}

/// Diagnostics snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpDiagnostics {
    pub session_id: String,
    pub host: String,
    pub security: FtpSecurityMode,
    pub features: ServerFeatures,
    pub current_directory: String,
    pub system_type: Option<String>,
    pub latency_ms: Option<u64>,
    pub last_response_code: Option<u16>,
}

// ─── Bookmark ────────────────────────────────────────────────────────

/// A saved FTP bookmark.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpBookmark {
    pub id: String,
    pub label: String,
    pub config: FtpConnectionConfig,
    pub created_at: DateTime<Utc>,
    pub last_used: Option<DateTime<Utc>>,
    pub tags: Vec<String>,
}
