//! Structured log capture, rotation, filtering, and export for OpenVPN
//! connections. Logs come primarily from the management interface's real-time
//! log output and from process stderr.

use crate::openvpn::types::*;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::sync::RwLock;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Log entry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Verbosity / severity level (matches OpenVPN verb levels).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Error = 0,
    Warning = 1,
    Info = 3,
    Debug = 5,
    Trace = 9,
}

impl LogLevel {
    /// Map from an OpenVPN verb-level integer.
    pub fn from_verb(verb: u32) -> Self {
        match verb {
            0 => Self::Error,
            1..=2 => Self::Warning,
            3..=4 => Self::Info,
            5..=8 => Self::Debug,
            _ => Self::Trace,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Error => "ERROR",
            Self::Warning => "WARN",
            Self::Info => "INFO",
            Self::Debug => "DEBUG",
            Self::Trace => "TRACE",
        }
    }
}

/// A single structured log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: DateTime<Utc>,
    pub level: LogLevel,
    pub source: LogSource,
    pub message: String,
    /// Connection ID this log belongs to.
    pub connection_id: Option<String>,
    /// Raw line from management interface (if applicable).
    pub raw: Option<String>,
}

/// Where the log line originated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogSource {
    /// Management interface real-time log.
    Management,
    /// Process stderr/stdout.
    Process,
    /// Our own instrumentation.
    Internal,
}

impl LogEntry {
    pub fn management(message: impl Into<String>) -> Self {
        Self {
            timestamp: Utc::now(),
            level: LogLevel::Info,
            source: LogSource::Management,
            message: message.into(),
            connection_id: None,
            raw: None,
        }
    }

    pub fn process(message: impl Into<String>) -> Self {
        Self {
            timestamp: Utc::now(),
            level: LogLevel::Info,
            source: LogSource::Process,
            message: message.into(),
            connection_id: None,
            raw: None,
        }
    }

    pub fn internal(level: LogLevel, message: impl Into<String>) -> Self {
        Self {
            timestamp: Utc::now(),
            level,
            source: LogSource::Internal,
            message: message.into(),
            connection_id: None,
            raw: None,
        }
    }

    pub fn with_connection(mut self, id: impl Into<String>) -> Self {
        self.connection_id = Some(id.into());
        self
    }

    pub fn with_level(mut self, level: LogLevel) -> Self {
        self.level = level;
        self
    }

    pub fn with_raw(mut self, raw: impl Into<String>) -> Self {
        self.raw = Some(raw.into());
        self
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Log buffer
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// In-memory ring buffer for log entries.
pub struct LogBuffer {
    entries: Vec<LogEntry>,
    max_entries: usize,
    min_level: LogLevel,
}

impl LogBuffer {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: Vec::with_capacity(max_entries.min(1024)),
            max_entries,
            min_level: LogLevel::Info,
        }
    }

    pub fn with_level(mut self, level: LogLevel) -> Self {
        self.min_level = level;
        self
    }

    /// Append a log entry (respects min_level filter).
    pub fn push(&mut self, entry: LogEntry) {
        if entry.level < self.min_level {
            // Lower enum value = higher severity. Error=0 < Info=3.
            // We keep entries where level <= min_level (more severe or equal).
        } else if entry.level > self.min_level {
            return; // Too verbose, skip.
        }
        self.entries.push(entry);
        if self.entries.len() > self.max_entries {
            self.entries.remove(0);
        }
    }

    /// Unconditionally append (bypass level filter).
    pub fn push_force(&mut self, entry: LogEntry) {
        self.entries.push(entry);
        if self.entries.len() > self.max_entries {
            self.entries.remove(0);
        }
    }

    pub fn entries(&self) -> &[LogEntry] {
        &self.entries
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn set_min_level(&mut self, level: LogLevel) {
        self.min_level = level;
    }

    pub fn min_level(&self) -> LogLevel {
        self.min_level
    }

    /// Get the last N entries.
    pub fn tail(&self, n: usize) -> &[LogEntry] {
        let start = self.entries.len().saturating_sub(n);
        &self.entries[start..]
    }

    /// Filter entries by level.
    pub fn filter_level(&self, level: LogLevel) -> Vec<&LogEntry> {
        self.entries.iter().filter(|e| e.level <= level).collect()
    }

    /// Filter entries by source.
    pub fn filter_source(&self, source: &LogSource) -> Vec<&LogEntry> {
        self.entries.iter().filter(|e| &e.source == source).collect()
    }

    /// Search entries by message substring.
    pub fn search(&self, query: &str) -> Vec<&LogEntry> {
        let lower = query.to_lowercase();
        self.entries
            .iter()
            .filter(|e| e.message.to_lowercase().contains(&lower))
            .collect()
    }

    /// Get entries in a time range.
    pub fn range(
        &self,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Vec<&LogEntry> {
        self.entries
            .iter()
            .filter(|e| e.timestamp >= from && e.timestamp <= to)
            .collect()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Parse management log lines
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Parse a raw management `>LOG:` line into a LogEntry.
/// Format: `>LOG:timestamp_unix,flags,message`
pub fn parse_mgmt_log_line(line: &str) -> Option<LogEntry> {
    let payload = line.strip_prefix(">LOG:")?;
    let parts: Vec<&str> = payload.splitn(3, ',').collect();
    if parts.len() < 3 {
        return None;
    }

    let timestamp = parts[0]
        .parse::<i64>()
        .ok()
        .and_then(|ts| DateTime::from_timestamp(ts, 0))
        .unwrap_or_else(Utc::now);

    let flags = parts[1];
    let message = parts[2].to_string();

    let level = match flags {
        f if f.contains('F') || f.contains('N') => LogLevel::Error,
        f if f.contains('W') => LogLevel::Warning,
        f if f.contains('I') => LogLevel::Info,
        f if f.contains('D') => LogLevel::Debug,
        _ => LogLevel::Info,
    };

    Some(LogEntry {
        timestamp,
        level,
        source: LogSource::Management,
        message,
        connection_id: None,
        raw: Some(line.to_string()),
    })
}

/// Parse a process stderr line, detecting severity from common patterns.
pub fn parse_process_log_line(line: &str) -> LogEntry {
    let level = detect_log_level(line);
    LogEntry {
        timestamp: Utc::now(),
        level,
        source: LogSource::Process,
        message: line.to_string(),
        connection_id: None,
        raw: None,
    }
}

/// Detect severity from log message content.
pub fn detect_log_level(message: &str) -> LogLevel {
    let lower = message.to_lowercase();
    if lower.contains("error") || lower.contains("fatal") || lower.contains("fail") {
        LogLevel::Error
    } else if lower.contains("warn") || lower.contains("caution") {
        LogLevel::Warning
    } else if lower.contains("debug") || lower.contains("verbose") {
        LogLevel::Debug
    } else {
        LogLevel::Info
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Export
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Export format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    PlainText,
    Json,
    Csv,
}

/// Export log entries to a string in the given format.
pub fn export_logs(entries: &[LogEntry], format: ExportFormat) -> String {
    match format {
        ExportFormat::PlainText => export_plain(entries),
        ExportFormat::Json => export_json(entries),
        ExportFormat::Csv => export_csv(entries),
    }
}

fn export_plain(entries: &[LogEntry]) -> String {
    let mut out = String::new();
    for e in entries {
        out.push_str(&format!(
            "[{}] {} ({:?}) {}\n",
            e.timestamp.format("%Y-%m-%d %H:%M:%S"),
            e.level.as_str(),
            e.source,
            e.message
        ));
    }
    out
}

fn export_json(entries: &[LogEntry]) -> String {
    serde_json::to_string_pretty(entries).unwrap_or_default()
}

fn export_csv(entries: &[LogEntry]) -> String {
    let mut out = String::from("timestamp,level,source,connection_id,message\n");
    for e in entries {
        let conn = e.connection_id.as_deref().unwrap_or("");
        let msg = e.message.replace(',', ";").replace('\n', " ");
        out.push_str(&format!(
            "{},{},{:?},{},{}\n",
            e.timestamp.to_rfc3339(),
            e.level.as_str(),
            e.source,
            conn,
            msg
        ));
    }
    out
}

/// Write logs to a file.
pub async fn write_log_file(
    path: &Path,
    entries: &[LogEntry],
    format: ExportFormat,
) -> Result<(), OpenVpnError> {
    let content = export_logs(entries, format);
    tokio::fs::write(path, content).await.map_err(|e| OpenVpnError {
        kind: OpenVpnErrorKind::IoError,
        message: format!("Cannot write log file {}: {}", path.display(), e),
        detail: None,
    })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Log rotation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Log rotation settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogRotation {
    /// Maximum log file size in bytes before rotation.
    pub max_size_bytes: u64,
    /// Maximum number of rotated files to keep.
    pub max_files: u32,
    /// Base path for log files.
    pub base_path: PathBuf,
    /// Whether compression is enabled.
    pub compress: bool,
}

impl Default for LogRotation {
    fn default() -> Self {
        Self {
            max_size_bytes: 10 * 1024 * 1024, // 10 MB
            max_files: 5,
            base_path: PathBuf::from("openvpn.log"),
            compress: false,
        }
    }
}

/// Check if a log file needs rotation and perform it.
pub async fn rotate_if_needed(settings: &LogRotation) -> Result<bool, OpenVpnError> {
    let path = &settings.base_path;
    if !path.exists() {
        return Ok(false);
    }

    let metadata = tokio::fs::metadata(path).await.map_err(|e| OpenVpnError {
        kind: OpenVpnErrorKind::IoError,
        message: format!("Cannot stat log file: {}", e),
        detail: None,
    })?;

    if metadata.len() < settings.max_size_bytes {
        return Ok(false);
    }

    // Rotate: .log → .log.1, .log.1 → .log.2, etc.
    for i in (1..settings.max_files).rev() {
        let from = rotated_path(path, i);
        let to = rotated_path(path, i + 1);
        if from.exists() {
            let _ = tokio::fs::rename(&from, &to).await;
        }
    }

    let first = rotated_path(path, 1);
    let _ = tokio::fs::rename(path, &first).await;

    // Remove oldest if over limit
    let oldest = rotated_path(path, settings.max_files + 1);
    if oldest.exists() {
        let _ = tokio::fs::remove_file(&oldest).await;
    }

    Ok(true)
}

fn rotated_path(base: &Path, index: u32) -> PathBuf {
    let name = base
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let parent = base.parent().unwrap_or(Path::new("."));
    parent.join(format!("{}.{}", name, index))
}

/// List existing rotated log files.
pub fn list_log_files(settings: &LogRotation) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if settings.base_path.exists() {
        files.push(settings.base_path.clone());
    }
    for i in 1..=settings.max_files {
        let p = rotated_path(&settings.base_path, i);
        if p.exists() {
            files.push(p);
        }
    }
    files
}

/// Total size of all log files.
pub fn total_log_size(settings: &LogRotation) -> u64 {
    list_log_files(settings)
        .iter()
        .filter_map(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .sum()
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Connection log store (thread-safe, per-connection)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Thread-safe log store for a single connection.
pub struct ConnectionLog {
    connection_id: String,
    buffer: RwLock<LogBuffer>,
}

impl ConnectionLog {
    pub fn new(connection_id: impl Into<String>, max_entries: usize) -> Self {
        Self {
            connection_id: connection_id.into(),
            buffer: RwLock::new(LogBuffer::new(max_entries)),
        }
    }

    pub async fn append(&self, mut entry: LogEntry) {
        entry.connection_id = Some(self.connection_id.clone());
        self.buffer.write().await.push_force(entry);
    }

    pub async fn entries(&self) -> Vec<LogEntry> {
        self.buffer.read().await.entries().to_vec()
    }

    pub async fn tail(&self, n: usize) -> Vec<LogEntry> {
        self.buffer.read().await.tail(n).to_vec()
    }

    pub async fn search(&self, query: &str) -> Vec<LogEntry> {
        self.buffer
            .read()
            .await
            .search(query)
            .into_iter()
            .cloned()
            .collect()
    }

    pub async fn clear(&self) {
        self.buffer.write().await.clear();
    }

    pub async fn len(&self) -> usize {
        self.buffer.read().await.len()
    }

    pub async fn export(&self, format: ExportFormat) -> String {
        let guard = self.buffer.read().await;
        export_logs(guard.entries(), format)
    }

    pub fn connection_id(&self) -> &str {
        &self.connection_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── LogLevel ─────────────────────────────────────────────────

    #[test]
    fn log_level_from_verb() {
        assert_eq!(LogLevel::from_verb(0), LogLevel::Error);
        assert_eq!(LogLevel::from_verb(1), LogLevel::Warning);
        assert_eq!(LogLevel::from_verb(3), LogLevel::Info);
        assert_eq!(LogLevel::from_verb(5), LogLevel::Debug);
        assert_eq!(LogLevel::from_verb(11), LogLevel::Trace);
    }

    #[test]
    fn log_level_as_str() {
        assert_eq!(LogLevel::Error.as_str(), "ERROR");
        assert_eq!(LogLevel::Warning.as_str(), "WARN");
        assert_eq!(LogLevel::Info.as_str(), "INFO");
    }

    #[test]
    fn log_level_ordering() {
        assert!(LogLevel::Error < LogLevel::Warning);
        assert!(LogLevel::Warning < LogLevel::Info);
        assert!(LogLevel::Info < LogLevel::Debug);
        assert!(LogLevel::Debug < LogLevel::Trace);
    }

    // ── LogEntry builder ─────────────────────────────────────────

    #[test]
    fn log_entry_management() {
        let e = LogEntry::management("test msg")
            .with_connection("c1")
            .with_level(LogLevel::Warning);
        assert_eq!(e.source, LogSource::Management);
        assert_eq!(e.level, LogLevel::Warning);
        assert_eq!(e.connection_id, Some("c1".into()));
    }

    #[test]
    fn log_entry_process() {
        let e = LogEntry::process("stderr line");
        assert_eq!(e.source, LogSource::Process);
    }

    #[test]
    fn log_entry_internal() {
        let e = LogEntry::internal(LogLevel::Error, "something broke");
        assert_eq!(e.source, LogSource::Internal);
        assert_eq!(e.level, LogLevel::Error);
    }

    // ── LogBuffer ────────────────────────────────────────────────

    #[test]
    fn buffer_push_and_len() {
        let mut buf = LogBuffer::new(100);
        buf.push_force(LogEntry::management("msg1"));
        buf.push_force(LogEntry::management("msg2"));
        assert_eq!(buf.len(), 2);
    }

    #[test]
    fn buffer_max_size() {
        let mut buf = LogBuffer::new(3);
        for i in 0..5 {
            buf.push_force(LogEntry::management(format!("msg{}", i)));
        }
        assert_eq!(buf.len(), 3);
        assert_eq!(buf.entries()[0].message, "msg2");
    }

    #[test]
    fn buffer_tail() {
        let mut buf = LogBuffer::new(100);
        for i in 0..10 {
            buf.push_force(LogEntry::management(format!("msg{}", i)));
        }
        let tail = buf.tail(3);
        assert_eq!(tail.len(), 3);
        assert_eq!(tail[0].message, "msg7");
    }

    #[test]
    fn buffer_clear() {
        let mut buf = LogBuffer::new(100);
        buf.push_force(LogEntry::management("msg"));
        buf.clear();
        assert!(buf.is_empty());
    }

    #[test]
    fn buffer_search() {
        let mut buf = LogBuffer::new(100);
        buf.push_force(LogEntry::management("connected to server"));
        buf.push_force(LogEntry::management("route added"));
        buf.push_force(LogEntry::management("disconnected from server"));
        let results = buf.search("server");
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn buffer_filter_source() {
        let mut buf = LogBuffer::new(100);
        buf.push_force(LogEntry::management("mgmt msg"));
        buf.push_force(LogEntry::process("proc msg"));
        buf.push_force(LogEntry::management("mgmt msg 2"));
        let filtered = buf.filter_source(&LogSource::Management);
        assert_eq!(filtered.len(), 2);
    }

    // ── Parse management log ─────────────────────────────────────

    #[test]
    fn parse_mgmt_log_basic() {
        let entry = parse_mgmt_log_line(">LOG:1700000000,I,Initialization complete").unwrap();
        assert_eq!(entry.message, "Initialization complete");
        assert_eq!(entry.level, LogLevel::Info);
        assert_eq!(entry.source, LogSource::Management);
    }

    #[test]
    fn parse_mgmt_log_error() {
        let entry = parse_mgmt_log_line(">LOG:1700000000,F,Connection failed").unwrap();
        assert_eq!(entry.level, LogLevel::Error);
    }

    #[test]
    fn parse_mgmt_log_warning() {
        let entry = parse_mgmt_log_line(">LOG:1700000000,W,Certificate expiring").unwrap();
        assert_eq!(entry.level, LogLevel::Warning);
    }

    #[test]
    fn parse_mgmt_log_invalid() {
        assert!(parse_mgmt_log_line("not a log line").is_none());
        assert!(parse_mgmt_log_line(">LOG:bad").is_none());
    }

    // ── Parse process log ────────────────────────────────────────

    #[test]
    fn parse_process_log_error() {
        let e = parse_process_log_line("ERROR: Cannot open file");
        assert_eq!(e.level, LogLevel::Error);
    }

    #[test]
    fn parse_process_log_warning() {
        let e = parse_process_log_line("WARNING: deprecated option");
        assert_eq!(e.level, LogLevel::Warning);
    }

    #[test]
    fn parse_process_log_info() {
        let e = parse_process_log_line("Connected to 10.8.0.1");
        assert_eq!(e.level, LogLevel::Info);
    }

    // ── Detect log level ─────────────────────────────────────────

    #[test]
    fn detect_levels() {
        assert_eq!(detect_log_level("FATAL: crash"), LogLevel::Error);
        assert_eq!(detect_log_level("some failure"), LogLevel::Error);
        assert_eq!(detect_log_level("caution: low space"), LogLevel::Warning);
        assert_eq!(detect_log_level("all good"), LogLevel::Info);
        assert_eq!(detect_log_level("debug output here"), LogLevel::Debug);
    }

    // ── Export ───────────────────────────────────────────────────

    #[test]
    fn export_plain_text() {
        let entries = vec![LogEntry::management("test message")];
        let out = export_logs(&entries, ExportFormat::PlainText);
        assert!(out.contains("test message"));
        assert!(out.contains("INFO"));
    }

    #[test]
    fn export_json_format() {
        let entries = vec![LogEntry::management("test")];
        let out = export_logs(&entries, ExportFormat::Json);
        let parsed: Vec<LogEntry> = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed.len(), 1);
    }

    #[test]
    fn export_csv_format() {
        let entries = vec![LogEntry::management("hello,world")];
        let out = export_logs(&entries, ExportFormat::Csv);
        assert!(out.starts_with("timestamp,level,source,connection_id,message\n"));
        // Comma in message should be replaced
        assert!(out.contains("hello;world"));
    }

    #[test]
    fn export_empty() {
        let out = export_logs(&[], ExportFormat::PlainText);
        assert!(out.is_empty());
    }

    // ── Log rotation helpers ─────────────────────────────────────

    #[test]
    fn rotated_path_format() {
        let base = PathBuf::from("/tmp/openvpn.log");
        let p = rotated_path(&base, 1);
        // Use path comparison instead of string to handle platform separators
        let expected = PathBuf::from("/tmp").join("openvpn.log.1");
        assert_eq!(p, expected);
        let p2 = rotated_path(&base, 5);
        let expected2 = PathBuf::from("/tmp").join("openvpn.log.5");
        assert_eq!(p2, expected2);
    }

    #[test]
    fn log_rotation_default() {
        let r = LogRotation::default();
        assert_eq!(r.max_size_bytes, 10 * 1024 * 1024);
        assert_eq!(r.max_files, 5);
    }

    // ── ConnectionLog ────────────────────────────────────────────

    #[tokio::test]
    async fn connection_log_append() {
        let log = ConnectionLog::new("conn-1", 100);
        log.append(LogEntry::management("msg1")).await;
        log.append(LogEntry::management("msg2")).await;
        assert_eq!(log.len().await, 2);
        let entries = log.entries().await;
        assert_eq!(entries[0].connection_id, Some("conn-1".into()));
    }

    #[tokio::test]
    async fn connection_log_tail() {
        let log = ConnectionLog::new("conn-1", 100);
        for i in 0..10 {
            log.append(LogEntry::management(format!("msg{}", i))).await;
        }
        let tail = log.tail(3).await;
        assert_eq!(tail.len(), 3);
        assert_eq!(tail[0].message, "msg7");
    }

    #[tokio::test]
    async fn connection_log_search() {
        let log = ConnectionLog::new("conn-1", 100);
        log.append(LogEntry::management("connected to server")).await;
        log.append(LogEntry::management("route added")).await;
        let results = log.search("server").await;
        assert_eq!(results.len(), 1);
    }

    #[tokio::test]
    async fn connection_log_export() {
        let log = ConnectionLog::new("conn-1", 100);
        log.append(LogEntry::management("test")).await;
        let csv = log.export(ExportFormat::Csv).await;
        assert!(csv.contains("test"));
    }

    #[tokio::test]
    async fn connection_log_clear() {
        let log = ConnectionLog::new("conn-1", 100);
        log.append(LogEntry::management("msg")).await;
        log.clear().await;
        assert_eq!(log.len().await, 0);
    }

    // ── LogLevel serde ───────────────────────────────────────────

    #[test]
    fn log_level_serde_roundtrip() {
        for lvl in &[
            LogLevel::Error,
            LogLevel::Warning,
            LogLevel::Info,
            LogLevel::Debug,
            LogLevel::Trace,
        ] {
            let json = serde_json::to_string(lvl).unwrap();
            let back: LogLevel = serde_json::from_str(&json).unwrap();
            assert_eq!(lvl, &back);
        }
    }

    // ── ExportFormat serde ───────────────────────────────────────

    #[test]
    fn export_format_serde() {
        for fmt in &[ExportFormat::PlainText, ExportFormat::Json, ExportFormat::Csv] {
            let json = serde_json::to_string(fmt).unwrap();
            let back: ExportFormat = serde_json::from_str(&json).unwrap();
            assert_eq!(fmt, &back);
        }
    }
}
