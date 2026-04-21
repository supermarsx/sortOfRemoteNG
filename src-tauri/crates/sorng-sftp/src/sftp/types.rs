// ── Types ─────────────────────────────────────────────────────────────────────

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

// ── Serde default helpers ────────────────────────────────────────────────────

fn default_sftp_port() -> u16 {
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

// ── Connection & Authentication ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpConnectionConfig {
    pub host: String,
    #[serde(default = "default_sftp_port")]
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
    pub known_hosts_policy: KnownHostsPolicy,
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
    #[serde(default = "default_keepalive_secs")]
    pub keepalive_interval_secs: u64,
    #[serde(default)]
    pub proxy: Option<SftpProxyConfig>,
    #[serde(default)]
    pub banner_callback: bool,
    #[serde(default)]
    pub compress: bool,
    #[serde(default)]
    pub initial_directory: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub color_tag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum KnownHostsPolicy {
    #[default]
    Ask,
    AcceptNew,
    Strict,
    Ignore,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpProxyConfig {
    pub proxy_type: SftpProxyType,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SftpProxyType {
    Socks5,
    Http,
    JumpHost,
}

// ── Session ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpSessionInfo {
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
    pub server_banner: Option<String>,
    pub remote_home: Option<String>,
    pub current_directory: String,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub bytes_uploaded: u64,
    pub bytes_downloaded: u64,
    pub operations_count: u64,
}

// ── Directory Listing ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDirEntry {
    pub name: String,
    pub path: String,
    pub entry_type: SftpEntryType,
    pub size: u64,
    pub permissions: u32,
    pub permissions_string: String,
    pub owner_uid: u32,
    pub group_gid: u32,
    pub accessed: Option<u64>,
    pub modified: Option<u64>,
    pub is_hidden: bool,
    pub link_target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SftpEntryType {
    File,
    Directory,
    Symlink,
    BlockDevice,
    CharDevice,
    NamedPipe,
    Socket,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpListOptions {
    #[serde(default = "default_true")]
    pub include_hidden: bool,
    #[serde(default)]
    pub sort_by: SftpSortField,
    #[serde(default = "default_true")]
    pub ascending: bool,
    #[serde(default)]
    pub filter_glob: Option<String>,
    #[serde(default)]
    pub filter_type: Option<SftpEntryType>,
    #[serde(default = "default_false")]
    pub recursive: bool,
    #[serde(default)]
    pub max_depth: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SftpSortField {
    #[default]
    Name,
    Size,
    Modified,
    Type,
    Permissions,
}

// ── File Stat ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpFileStat {
    pub path: String,
    pub size: u64,
    pub permissions: u32,
    pub permissions_string: String,
    pub owner_uid: u32,
    pub group_gid: u32,
    pub accessed: Option<u64>,
    pub modified: Option<u64>,
    pub entry_type: SftpEntryType,
    pub link_target: Option<String>,
    pub is_readonly: bool,
}

// ── Transfer ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferRequest {
    pub session_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub direction: TransferDirection,
    #[serde(default = "default_chunk_size")]
    pub chunk_size: u64,
    #[serde(default = "default_false")]
    pub resume: bool,
    #[serde(default)]
    pub on_conflict: ConflictResolution,
    #[serde(default = "default_true")]
    pub preserve_timestamps: bool,
    #[serde(default = "default_false")]
    pub preserve_permissions: bool,
    #[serde(default)]
    pub bandwidth_limit_kbps: Option<u64>,
    #[serde(default = "default_retry_count")]
    pub retry_count: u32,
    #[serde(default = "default_retry_delay_ms")]
    pub retry_delay_ms: u64,
    #[serde(default = "default_false")]
    pub verify_checksum: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ConflictResolution {
    #[default]
    Overwrite,
    Skip,
    Rename,
    Resume,
    Ask,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    pub session_id: String,
    pub direction: TransferDirection,
    pub local_path: String,
    pub remote_path: String,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub percent: f64,
    pub speed_bytes_per_sec: f64,
    pub eta_secs: Option<f64>,
    pub status: TransferStatus,
    pub started_at: DateTime<Utc>,
    pub error: Option<String>,
    pub retry_attempt: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TransferStatus {
    Queued,
    InProgress,
    Paused,
    Completed,
    Failed,
    Cancelled,
    Verifying,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    pub transfer_id: String,
    pub success: bool,
    pub bytes_transferred: u64,
    pub duration_ms: u64,
    pub average_speed_bps: f64,
    pub checksum: Option<String>,
    pub error: Option<String>,
}

// ── Batch / Bulk Operations ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpBatchTransfer {
    pub session_id: String,
    pub items: Vec<SftpBatchItem>,
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
    #[serde(default)]
    pub on_error: BatchErrorPolicy,
    #[serde(default = "default_chunk_size")]
    pub chunk_size: u64,
    #[serde(default = "default_false")]
    pub verify_checksums: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpBatchItem {
    pub local_path: String,
    pub remote_path: String,
    pub direction: TransferDirection,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum BatchErrorPolicy {
    #[default]
    Continue,
    Abort,
    Skip,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchTransferResult {
    pub total_items: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub skipped: usize,
    pub total_bytes: u64,
    pub duration_ms: u64,
    pub results: Vec<TransferResult>,
}

// ── Queue ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub id: String,
    pub request: SftpTransferRequest,
    pub priority: i32,
    pub added_at: DateTime<Utc>,
    pub status: TransferStatus,
    pub progress: Option<TransferProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStatus {
    pub total: usize,
    pub pending: usize,
    pub active: usize,
    pub completed: usize,
    pub failed: usize,
    pub total_bytes_remaining: u64,
    pub is_running: bool,
}

// ── Watch / Sync ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchConfig {
    pub session_id: String,
    pub remote_path: String,
    pub local_path: String,
    #[serde(default)]
    pub interval_secs: u64,
    #[serde(default = "default_true")]
    pub auto_download: bool,
    #[serde(default = "default_false")]
    pub auto_upload: bool,
    #[serde(default = "default_false")]
    pub recursive: bool,
    #[serde(default)]
    pub ignore_patterns: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct WatchState {
    pub config: WatchConfig,
    pub active: bool,
    pub shutdown_tx: tokio::sync::mpsc::Sender<()>,
}

// Make WatchState serializable (minus the channel)
impl Serialize for WatchState {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("WatchState", 2)?;
        s.serialize_field("config", &self.config)?;
        s.serialize_field("active", &self.active)?;
        s.end()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchEvent {
    pub watch_id: String,
    pub event_type: WatchEventType,
    pub path: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WatchEventType {
    Created,
    Modified,
    Deleted,
    Renamed,
}

// ── Bookmarks ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpBookmark {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub remote_path: String,
    #[serde(default)]
    pub local_path: Option<String>,
    #[serde(default)]
    pub color_tag: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used: Option<DateTime<Utc>>,
    pub use_count: u64,
}

// ── Permissions helpers ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpChmodRequest {
    pub path: String,
    pub mode: u32,
    #[serde(default = "default_false")]
    pub recursive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpChownRequest {
    pub path: String,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    #[serde(default = "default_false")]
    pub recursive: bool,
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDiagnosticReport {
    pub session_id: String,
    pub host: String,
    pub protocol_version: String,
    pub server_extensions: Vec<String>,
    pub max_packet_size: u64,
    pub latency_ms: f64,
    pub throughput_test: Option<ThroughputResult>,
    pub steps: Vec<SftpDiagnosticStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDiagnosticStep {
    pub name: String,
    pub passed: bool,
    pub message: String,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThroughputResult {
    pub upload_bps: f64,
    pub download_bps: f64,
    pub test_size_bytes: u64,
}

// ── State alias ──────────────────────────────────────────────────────────────

pub type SftpServiceState = Arc<Mutex<SftpService>>;

use super::service::SftpService;
