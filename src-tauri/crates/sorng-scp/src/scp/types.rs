// ── Types ─────────────────────────────────────────────────────────────────────

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

// ── Serde default helpers ────────────────────────────────────────────────────

fn default_scp_port() -> u16 {
    22
}
fn default_true() -> bool {
    true
}
fn default_false() -> bool {
    false
}
fn default_chunk_size() -> u64 {
    1_048_576 // 1 MiB
}
fn default_concurrency() -> usize {
    4
}
fn default_timeout_secs() -> u64 {
    30
}
fn default_keepalive_secs() -> u64 {
    60
}
fn default_retry_count() -> u32 {
    3
}
fn default_retry_delay_ms() -> u64 {
    2000
}
fn default_file_mode() -> i32 {
    0o644
}
fn default_dir_mode() -> i32 {
    0o755
}
#[allow(dead_code)]
fn default_max_history() -> usize {
    500
}
#[allow(dead_code)]
fn default_bandwidth_test_size() -> u64 {
    1_048_576 // 1 MiB
}

// ── Connection & Authentication ──────────────────────────────────────────────

/// Configuration for establishing an SCP session over SSH.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpConnectionConfig {
    pub host: String,
    #[serde(default = "default_scp_port")]
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
    #[serde(default)]
    pub private_key_data: Option<String>,
    #[serde(default = "default_false")]
    pub use_agent: bool,
    #[serde(default)]
    pub known_hosts_policy: ScpKnownHostsPolicy,
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
    #[serde(default = "default_keepalive_secs")]
    pub keepalive_interval_secs: u64,
    #[serde(default)]
    pub proxy: Option<ScpProxyConfig>,
    #[serde(default = "default_false")]
    pub compress: bool,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub color_tag: Option<String>,
    /// Preferred cipher algorithms (comma-separated, e.g. "aes256-ctr,aes128-ctr")
    #[serde(default)]
    pub preferred_ciphers: Option<String>,
    /// Preferred MAC algorithms
    #[serde(default)]
    pub preferred_macs: Option<String>,
    /// Preferred key exchange algorithms
    #[serde(default)]
    pub preferred_kex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ScpKnownHostsPolicy {
    #[default]
    Ask,
    AcceptNew,
    Strict,
    Ignore,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpProxyConfig {
    pub proxy_type: ScpProxyType,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScpProxyType {
    Socks5,
    Http,
    JumpHost,
}

// ── Session ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpSessionInfo {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
    pub connected: bool,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub color_tag: Option<String>,
    #[serde(default)]
    pub server_banner: Option<String>,
    #[serde(default)]
    pub remote_home: Option<String>,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub bytes_uploaded: u64,
    pub bytes_downloaded: u64,
    pub transfers_count: u64,
    pub server_fingerprint: Option<String>,
}

/// Type alias for the managed state.
pub type ScpServiceState = Arc<Mutex<ScpService>>;

use super::service::ScpService;

// ── Transfer request ─────────────────────────────────────────────────────────

/// Request to upload or download a single file via SCP.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpTransferRequest {
    pub session_id: String,
    pub local_path: String,
    pub remote_path: String,
    #[serde(default = "default_chunk_size")]
    pub chunk_size: u64,
    #[serde(default = "default_false")]
    pub verify_checksum: bool,
    #[serde(default = "default_retry_count")]
    pub retry_count: u32,
    #[serde(default = "default_retry_delay_ms")]
    pub retry_delay_ms: u64,
    #[serde(default = "default_file_mode")]
    pub file_mode: i32,
    #[serde(default = "default_true")]
    pub preserve_times: bool,
    /// If true, create parent directories on the remote side when uploading
    #[serde(default = "default_false")]
    pub create_parents: bool,
    /// If true, overwrite existing files without asking
    #[serde(default = "default_true")]
    pub overwrite: bool,
}

/// Request to transfer an entire directory recursively via SCP.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpDirectoryTransferRequest {
    pub session_id: String,
    pub local_path: String,
    pub remote_path: String,
    #[serde(default = "default_chunk_size")]
    pub chunk_size: u64,
    #[serde(default = "default_false")]
    pub verify_checksum: bool,
    #[serde(default = "default_retry_count")]
    pub retry_count: u32,
    #[serde(default = "default_retry_delay_ms")]
    pub retry_delay_ms: u64,
    #[serde(default = "default_file_mode")]
    pub file_mode: i32,
    #[serde(default = "default_dir_mode")]
    pub dir_mode: i32,
    #[serde(default = "default_true")]
    pub preserve_times: bool,
    #[serde(default = "default_true")]
    pub preserve_permissions: bool,
    /// Glob pattern for files to include (e.g. "*.log"). None = include all.
    #[serde(default)]
    pub include_pattern: Option<String>,
    /// Glob pattern for files to exclude
    #[serde(default)]
    pub exclude_pattern: Option<String>,
    /// Follow symbolic links when walking local directories
    #[serde(default = "default_false")]
    pub follow_symlinks: bool,
    /// Maximum directory depth to recurse (None = unlimited)
    #[serde(default)]
    pub max_depth: Option<usize>,
    /// If true, overwrite existing files
    #[serde(default = "default_true")]
    pub overwrite: bool,
}

/// Batch transfer: multiple individual SCP operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpBatchTransferRequest {
    pub session_id: String,
    pub items: Vec<ScpBatchItem>,
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
    #[serde(default = "default_false")]
    pub stop_on_error: bool,
    #[serde(default = "default_false")]
    pub verify_checksum: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpBatchItem {
    pub local_path: String,
    pub remote_path: String,
    pub direction: ScpTransferDirection,
    #[serde(default = "default_file_mode")]
    pub file_mode: i32,
}

// ── Transfer progress ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpTransferProgress {
    pub transfer_id: String,
    pub session_id: String,
    pub direction: ScpTransferDirection,
    pub local_path: String,
    pub remote_path: String,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub percent: f64,
    pub speed_bytes_per_sec: f64,
    pub eta_secs: Option<f64>,
    pub status: ScpTransferStatus,
    pub started_at: DateTime<Utc>,
    pub error: Option<String>,
    pub retry_attempt: u32,
    pub current_file: Option<String>,
    pub files_total: u32,
    pub files_completed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ScpTransferDirection {
    Upload,
    Download,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ScpTransferStatus {
    Pending,
    InProgress,
    Paused,
    Verifying,
    Completed,
    Failed,
    Cancelled,
}

// ── Transfer result ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpTransferResult {
    pub transfer_id: String,
    pub direction: ScpTransferDirection,
    pub local_path: String,
    pub remote_path: String,
    pub bytes_transferred: u64,
    pub duration_ms: u64,
    pub average_speed: f64,
    pub checksum: Option<String>,
    pub success: bool,
    pub error: Option<String>,
}

/// Result for a batch transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpBatchTransferResult {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub skipped: usize,
    pub total_bytes: u64,
    pub duration_ms: u64,
    pub results: Vec<ScpTransferResult>,
}

/// Result for a recursive directory transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpDirectoryTransferResult {
    pub transfer_id: String,
    pub direction: ScpTransferDirection,
    pub local_path: String,
    pub remote_path: String,
    pub files_transferred: u32,
    pub files_failed: u32,
    pub files_skipped: u32,
    pub total_bytes: u64,
    pub duration_ms: u64,
    pub average_speed: f64,
    pub errors: Vec<String>,
}

// ── Queue types ──────────────────────────────────────────────────────────────

/// Entry in the transfer queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpQueueEntry {
    pub id: String,
    pub session_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub direction: ScpTransferDirection,
    pub file_mode: i32,
    pub priority: u32,
    pub status: ScpQueueStatus,
    pub added_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error: Option<String>,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub retry_count: u32,
    pub max_retries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ScpQueueStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Cancelled,
    Paused,
}

/// Summary of the queue state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpQueueSummary {
    pub total: usize,
    pub pending: usize,
    pub in_progress: usize,
    pub completed: usize,
    pub failed: usize,
    pub cancelled: usize,
    pub paused: usize,
    pub total_bytes: u64,
    pub bytes_transferred: u64,
    pub is_running: bool,
}

// ── History types ────────────────────────────────────────────────────────────

/// Persistent record of a completed (or failed) transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpTransferRecord {
    pub transfer_id: String,
    pub session_id: String,
    pub host: String,
    pub username: String,
    pub direction: ScpTransferDirection,
    pub local_path: String,
    pub remote_path: String,
    pub bytes_transferred: u64,
    pub duration_ms: u64,
    pub average_speed: f64,
    pub success: bool,
    pub error: Option<String>,
    pub checksum: Option<String>,
    pub timestamp: DateTime<Utc>,
}

// ── Diagnostics types ────────────────────────────────────────────────────────

/// Result of an SCP connection diagnostic.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpDiagnosticResult {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub tcp_connect_ms: f64,
    pub ssh_handshake_ms: f64,
    pub auth_ms: f64,
    pub total_connect_ms: f64,
    pub server_banner: Option<String>,
    pub server_fingerprint: Option<String>,
    pub negotiated_kex: Option<String>,
    pub negotiated_cipher: Option<String>,
    pub negotiated_mac: Option<String>,
    pub negotiated_host_key: Option<String>,
    pub auth_methods: Vec<String>,
    pub compression_enabled: bool,
    pub bandwidth_estimate: Option<ScpBandwidthEstimate>,
    pub warnings: Vec<String>,
}

/// Bandwidth estimation from a small test transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpBandwidthEstimate {
    pub upload_bytes_per_sec: f64,
    pub download_bytes_per_sec: f64,
    pub test_size_bytes: u64,
    pub upload_duration_ms: f64,
    pub download_duration_ms: f64,
    pub latency_ms: f64,
}

/// Remote file metadata retrieved via exec.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpRemoteFileInfo {
    pub path: String,
    pub size: u64,
    pub mode: i32,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub mtime: Option<DateTime<Utc>>,
    pub atime: Option<DateTime<Utc>>,
    pub owner: Option<String>,
    pub group: Option<String>,
}

/// Remote directory listing entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpRemoteDirEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub mode: Option<String>,
    pub mtime: Option<String>,
    pub owner: Option<String>,
    pub group: Option<String>,
}
