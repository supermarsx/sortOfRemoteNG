// sorng-recording – Comprehensive type definitions
// Every type is Serialize + Deserialize so it can cross the Tauri bridge.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════
//  Common / shared types
// ═══════════════════════════════════════════════════════════════════════

/// Unique identifier for any recording session.
pub type RecordingId = String;

/// Which protocol a recording belongs to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RecordingProtocol {
    Ssh,
    Rdp,
    Http,
    Vnc,
    Telnet,
    Serial,
    DatabaseQuery,
    Macro,
    Custom(String),
}

/// High-level status of a recording session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecordingStatus {
    Idle,
    Recording,
    Paused,
    Encoding,
    Compressing,
    Saving,
    Completed,
    Failed(String),
}

/// Compression algorithm.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompressionAlgorithm {
    None,
    Gzip,
    Zstd,
    Deflate,
}

/// Export / encoding format for a finished recording.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Json,
    Asciicast,
    Script,
    Har,
    Csv,
    FrameSequence,
    Raw,
    Custom(String),
}

/// Video format for RDP / VNC screen recordings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VideoFormat {
    Webm,
    Mp4,
    Gif,
    PngSequence,
    Raw,
}

// ═══════════════════════════════════════════════════════════════════════
//  SSH Terminal Recording types
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TerminalEntryType {
    Output,
    Input,
    Resize { cols: u32, rows: u32 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalRecordingEntry {
    pub timestamp_ms: u64,
    pub data: String,
    pub entry_type: TerminalEntryType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalRecordingMetadata {
    pub recording_id: String,
    pub session_id: String,
    pub protocol: RecordingProtocol,
    pub start_time: chrono::DateTime<chrono::Utc>,
    pub end_time: Option<chrono::DateTime<chrono::Utc>>,
    pub host: String,
    pub username: String,
    pub cols: u32,
    pub rows: u32,
    pub duration_ms: u64,
    pub entry_count: usize,
    pub record_input: bool,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalRecording {
    pub metadata: TerminalRecordingMetadata,
    pub entries: Vec<TerminalRecordingEntry>,
}

// ═══════════════════════════════════════════════════════════════════════
//  RDP Screen Recording types
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdpFrame {
    pub timestamp_ms: u64,
    pub width: u32,
    pub height: u32,
    /// Base64-encoded raw RGBA pixel data for a single frame.
    pub data_b64: String,
    pub frame_index: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdpRecordingMetadata {
    pub recording_id: String,
    pub session_id: String,
    pub start_time: chrono::DateTime<chrono::Utc>,
    pub end_time: Option<chrono::DateTime<chrono::Utc>>,
    pub host: String,
    pub connection_name: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub duration_ms: u64,
    pub frame_count: u64,
    pub format: VideoFormat,
    pub size_bytes: u64,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdpRecording {
    pub metadata: RdpRecordingMetadata,
    /// The recorded frames (only available before encoding / export).
    pub frames: Vec<RdpFrame>,
}

// ═══════════════════════════════════════════════════════════════════════
//  HTTP / HAR recording types
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpRecordingEntry {
    pub timestamp_ms: u64,
    pub method: String,
    pub url: String,
    pub request_headers: std::collections::HashMap<String, String>,
    pub request_body_size: u64,
    pub status: u16,
    pub response_headers: std::collections::HashMap<String, String>,
    pub response_body_size: u64,
    pub content_type: Option<String>,
    pub duration_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpRecordingMetadata {
    pub recording_id: String,
    pub session_id: String,
    pub start_time: chrono::DateTime<chrono::Utc>,
    pub end_time: Option<chrono::DateTime<chrono::Utc>>,
    pub host: String,
    pub target_url: String,
    pub duration_ms: u64,
    pub entry_count: usize,
    pub total_bytes_transferred: u64,
    pub record_headers: bool,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpRecording {
    pub metadata: HttpRecordingMetadata,
    pub entries: Vec<HttpRecordingEntry>,
}

// ═══════════════════════════════════════════════════════════════════════
//  VNC recording types
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncFrame {
    pub timestamp_ms: u64,
    pub width: u32,
    pub height: u32,
    pub data_b64: String,
    pub frame_index: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncRecordingMetadata {
    pub recording_id: String,
    pub session_id: String,
    pub start_time: chrono::DateTime<chrono::Utc>,
    pub end_time: Option<chrono::DateTime<chrono::Utc>>,
    pub host: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub duration_ms: u64,
    pub frame_count: u64,
    pub format: VideoFormat,
    pub size_bytes: u64,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VncRecording {
    pub metadata: VncRecordingMetadata,
    pub frames: Vec<VncFrame>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Telnet recording types
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TelnetEntryType {
    Output,
    Input,
    NegotiationSent(String),
    NegotiationReceived(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnetRecordingEntry {
    pub timestamp_ms: u64,
    pub data: String,
    pub entry_type: TelnetEntryType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnetRecordingMetadata {
    pub recording_id: String,
    pub session_id: String,
    pub start_time: chrono::DateTime<chrono::Utc>,
    pub end_time: Option<chrono::DateTime<chrono::Utc>>,
    pub host: String,
    pub port: u16,
    pub duration_ms: u64,
    pub entry_count: usize,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnetRecording {
    pub metadata: TelnetRecordingMetadata,
    pub entries: Vec<TelnetRecordingEntry>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Serial port recording types
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SerialEntryType {
    Received,
    Sent,
    ControlLine(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialRecordingEntry {
    pub timestamp_ms: u64,
    pub data: String,
    pub entry_type: SerialEntryType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialRecordingMetadata {
    pub recording_id: String,
    pub session_id: String,
    pub start_time: chrono::DateTime<chrono::Utc>,
    pub end_time: Option<chrono::DateTime<chrono::Utc>>,
    pub port_name: String,
    pub baud_rate: u32,
    pub duration_ms: u64,
    pub entry_count: usize,
    pub total_bytes: u64,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialRecording {
    pub metadata: SerialRecordingMetadata,
    pub entries: Vec<SerialRecordingEntry>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Database query recording types
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbQueryEntry {
    pub timestamp_ms: u64,
    pub query: String,
    pub duration_ms: u64,
    pub rows_affected: Option<u64>,
    pub error: Option<String>,
    pub database: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbQueryRecordingMetadata {
    pub recording_id: String,
    pub session_id: String,
    pub start_time: chrono::DateTime<chrono::Utc>,
    pub end_time: Option<chrono::DateTime<chrono::Utc>>,
    pub host: String,
    pub database_type: String,
    pub database_name: String,
    pub duration_ms: u64,
    pub entry_count: usize,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbQueryRecording {
    pub metadata: DbQueryRecordingMetadata,
    pub entries: Vec<DbQueryEntry>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Macro recording types
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroStep {
    pub command: String,
    pub delay_ms: u64,
    pub send_newline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroRecording {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub steps: Vec<MacroStep>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub tags: Vec<String>,
    pub target_protocol: RecordingProtocol,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroReplayConfig {
    pub macro_id: String,
    pub session_id: String,
    pub speed_multiplier: f64,
    pub confirm_before_each: bool,
    pub stop_on_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MacroReplayStatus {
    Idle,
    Running,
    Paused,
    Completed,
    Failed(String),
    Cancelled,
}

// ═══════════════════════════════════════════════════════════════════════
//  Unified recording envelope  (stored in the library)
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedRecordingEnvelope {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub protocol: RecordingProtocol,
    pub saved_at: chrono::DateTime<chrono::Utc>,
    pub duration_ms: u64,
    pub size_bytes: u64,
    pub compression: CompressionAlgorithm,
    pub format: ExportFormat,
    pub tags: Vec<String>,
    pub connection_id: Option<String>,
    pub connection_name: Option<String>,
    pub host: Option<String>,
    /// JSON-serialised inner recording (compressed or not).
    ///
    /// Empty string when [`media_blob_basename`] is set — the actual
    /// media bytes live in a sidecar file under the recordings root
    /// and are loaded lazily via
    /// [`crate::storage::load_media_blob_dispatched`]. Inline `data`
    /// remains the path for text-encoded recordings (asciicast,
    /// script, JSON, HAR, CSV, raw terminal) where there's no random-
    /// access seek requirement and the v2 envelope codec handles the
    /// whole blob fine.
    pub data: String,
    /// When `Some(name)`, the recording's media bytes live in a
    /// sidecar file at `<recordings_root>/<name>` (or
    /// `<recordings_root>/<name>.enc` when the encryption state is
    /// unlocked at write-time). The metadata envelope `data` field
    /// stays empty in that case.
    ///
    /// Set automatically by `save_to_library` for any format that's
    /// binary-shaped (`FrameSequence`, `Raw`, `Custom` plus the
    /// video formats); the legacy text-encoded formats stay inline.
    /// `None` on every pre-Phase-2c envelope, which keeps the read
    /// path backward-compatible — existing libraries continue to
    /// load without migration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_blob_basename: Option<String>,
}

impl SavedRecordingEnvelope {
    /// Whether this envelope's payload lives in a media sidecar
    /// rather than the inline `data` field. Used by the service to
    /// decide between v2 recording-meta and the chunked-stream codec.
    pub fn has_media_sidecar(&self) -> bool {
        self.media_blob_basename
            .as_deref()
            .map(|s| !s.is_empty())
            .unwrap_or(false)
    }
}

/// Heuristic used by `save_to_library` + library scans to decide
/// whether a given `(format, size_bytes)` pair should land in a media
/// sidecar instead of inline in the metadata envelope.
///
/// Returns `true` when the format is binary-shaped (frame sequences,
/// raw / custom video) **or** the payload is over the [`MEDIA_SIDECAR_THRESHOLD_BYTES`]
/// budget. Text-encoded formats (asciicast, script, JSON, HAR, CSV)
/// stay inline regardless of size — the v2 recording-meta codec
/// handles big JSON blobs fine and inlining keeps the file count down.
pub fn should_use_media_sidecar(format: &ExportFormat, size_bytes: u64) -> bool {
    if size_bytes > MEDIA_SIDECAR_THRESHOLD_BYTES {
        return true;
    }
    matches!(
        format,
        ExportFormat::FrameSequence | ExportFormat::Raw | ExportFormat::Custom(_),
    )
}

/// Above this plaintext size, the chunked-stream codec wins on every
/// dimension: it keeps the metadata JSON small enough to scan-load
/// the whole library, and gives the playback path random-access seek
/// without decrypting the entire payload. 4 MiB is a conservative
/// threshold — most asciicast / HAR exports clear it by an order of
/// magnitude, and the few that don't survive the inline path with no
/// noticeable cost.
pub const MEDIA_SIDECAR_THRESHOLD_BYTES: u64 = 4 * 1024 * 1024;

// ═══════════════════════════════════════════════════════════════════════
//  Configuration types
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingGlobalConfig {
    pub enabled: bool,
    pub auto_record_ssh: bool,
    pub auto_record_rdp: bool,
    pub auto_record_http: bool,
    pub auto_record_vnc: bool,
    pub auto_record_telnet: bool,
    pub auto_record_serial: bool,
    pub auto_record_db: bool,
    pub record_input: bool,
    pub record_http_headers: bool,
    pub default_compression: CompressionAlgorithm,
    pub default_ssh_export_format: ExportFormat,
    pub default_http_export_format: ExportFormat,
    pub default_video_format: VideoFormat,
    pub recording_fps: u32,
    pub video_bitrate_mbps: f64,
    pub max_recording_duration_minutes: u64,
    pub max_stored_recordings: usize,
    pub max_storage_bytes: u64,
    pub auto_save_to_library: bool,
    pub auto_cleanup_enabled: bool,
    pub auto_cleanup_older_than_days: u64,
    pub storage_directory: Option<String>,
    pub macro_default_step_delay_ms: u64,
    pub macro_confirm_before_replay: bool,
    pub macro_max_steps: usize,
}

impl Default for RecordingGlobalConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            auto_record_ssh: false,
            auto_record_rdp: false,
            auto_record_http: false,
            auto_record_vnc: false,
            auto_record_telnet: false,
            auto_record_serial: false,
            auto_record_db: false,
            record_input: false,
            record_http_headers: true,
            default_compression: CompressionAlgorithm::Zstd,
            default_ssh_export_format: ExportFormat::Asciicast,
            default_http_export_format: ExportFormat::Har,
            default_video_format: VideoFormat::Webm,
            recording_fps: 30,
            video_bitrate_mbps: 5.0,
            max_recording_duration_minutes: 120,
            max_stored_recordings: 200,
            max_storage_bytes: 10 * 1024 * 1024 * 1024, // 10 GB
            auto_save_to_library: true,
            auto_cleanup_enabled: true,
            auto_cleanup_older_than_days: 90,
            storage_directory: None,
            macro_default_step_delay_ms: 500,
            macro_confirm_before_replay: true,
            macro_max_steps: 500,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Aggregate status snapshot (returned to the frontend)
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveRecordingInfo {
    pub recording_id: String,
    pub session_id: String,
    pub protocol: RecordingProtocol,
    pub status: RecordingStatus,
    pub host: String,
    pub start_time: chrono::DateTime<chrono::Utc>,
    pub duration_ms: u64,
    pub entry_count: usize,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingLibrarySummary {
    pub total_recordings: usize,
    pub total_size_bytes: u64,
    pub by_protocol: std::collections::HashMap<String, usize>,
    pub oldest: Option<chrono::DateTime<chrono::Utc>>,
    pub newest: Option<chrono::DateTime<chrono::Utc>>,
}

// ═══════════════════════════════════════════════════════════════════════
//  Task / job types for the thread pool
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct JobId(pub String);

impl JobId {
    pub fn new() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
    }
}

impl Default for JobId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    Encode,
    Compress,
    Save,
    Export,
    Cleanup,
    MacroReplay,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed(String),
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobInfo {
    pub id: JobId,
    pub kind: JobKind,
    pub status: JobStatus,
    pub recording_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub progress_pct: f64,
    pub message: Option<String>,
}
