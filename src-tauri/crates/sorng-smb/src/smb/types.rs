// ── Types ─────────────────────────────────────────────────────────────────────
//
// All public data types for the SMB service. Kept as simple serde-derived
// structs / enums. `camelCase` rename at the serde boundary so the TS side
// consumes idiomatic JS field names.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ── default helpers ──────────────────────────────────────────────────────────

fn default_smb_port() -> u16 {
    445
}
fn default_false() -> bool {
    false
}

// ── Connection config ────────────────────────────────────────────────────────

/// Configuration for establishing an SMB connection to a server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbConnectionConfig {
    pub host: String,
    #[serde(default = "default_smb_port")]
    pub port: u16,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    /// Optional workgroup (Unix/smbclient only).
    #[serde(default)]
    pub workgroup: Option<String>,
    /// If set, the connection is scoped to a specific share. If unset,
    /// the session starts at the server root and can enumerate shares.
    #[serde(default)]
    pub share: Option<String>,
    /// Optional display label (UI only).
    #[serde(default)]
    pub label: Option<String>,
    /// Reject plaintext auth (force at least NTLMv2). Unix only.
    #[serde(default = "default_false")]
    pub disable_plaintext: bool,
    /// Use Kerberos auth on Unix (passes `-k` to smbclient). No-op on Windows.
    #[serde(default = "default_false")]
    pub use_kerberos: bool,
}

// ── Session info ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbSessionInfo {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub domain: Option<String>,
    pub username: Option<String>,
    pub share: Option<String>,
    pub connected: bool,
    pub label: Option<String>,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    /// Platform backing this session: "windows-unc" or "unix-smbclient".
    pub backend: String,
}

// ── Shares ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbShareInfo {
    pub name: String,
    pub share_type: SmbShareType,
    #[serde(default)]
    pub comment: Option<String>,
    /// True for administrative shares (`C$`, `ADMIN$`, `IPC$`, …).
    pub is_admin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SmbShareType {
    Disk,
    Printer,
    Ipc,
    Device,
    Special,
    Unknown,
}

// ── Directory entries ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbDirEntry {
    pub name: String,
    /// Server-relative path (always uses forward slashes at the wire
    /// level; backend converts to native on platform APIs).
    pub path: String,
    pub entry_type: SmbEntryType,
    pub size: u64,
    /// Millis since Unix epoch. `None` if unavailable on the backend.
    pub modified: Option<i64>,
    pub is_hidden: bool,
    pub is_readonly: bool,
    pub is_system: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SmbEntryType {
    File,
    Directory,
    Symlink,
    Unknown,
}

// ── Stat ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbStat {
    pub path: String,
    pub entry_type: SmbEntryType,
    pub size: u64,
    pub modified: Option<i64>,
    pub created: Option<i64>,
    pub accessed: Option<i64>,
    pub is_hidden: bool,
    pub is_readonly: bool,
    pub is_system: bool,
}

// ── Read / Write ─────────────────────────────────────────────────────────────

/// A small file read. The `content` is base64-encoded so the frontend
/// can round-trip binary blobs via IPC. Use `smb_download_file` for big
/// files (streams to disk instead of returning inline).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbReadResult {
    pub path: String,
    pub size: u64,
    /// Base64-encoded content.
    pub content_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbWriteResult {
    pub path: String,
    pub bytes_written: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbTransferResult {
    pub remote_path: String,
    pub local_path: String,
    pub bytes_transferred: u64,
    pub duration_ms: u64,
}

// ── Errors ───────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum SmbError {
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("invalid path: {0}")]
    InvalidPath(String),
    #[error("authentication failed: {0}")]
    AuthFailed(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("backend command failed: {0}")]
    Backend(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("unsupported operation: {0}")]
    Unsupported(String),
    #[error("other: {0}")]
    Other(String),
}

impl From<SmbError> for String {
    fn from(e: SmbError) -> Self {
        e.to_string()
    }
}

pub type SmbResult<T> = Result<T, SmbError>;
