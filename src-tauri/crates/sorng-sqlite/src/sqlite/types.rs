//! Types for the SQLite integration crate.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

/// A single row represented as column-name → JSON value.
pub type RowMap = HashMap<String, serde_json::Value>;

// ── Error ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SqliteErrorKind {
    ConnectionFailed,
    QueryFailed,
    NotConnected,
    SessionNotFound,
    SessionExists,
    DatabaseNotFound,
    TableNotFound,
    PermissionDenied,
    FileLocked,
    CorruptDatabase,
    ExportFailed,
    ImportFailed,
    InvalidInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqliteError {
    pub kind: SqliteErrorKind,
    pub message: String,
}

impl fmt::Display for SqliteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for SqliteError {}

impl SqliteError {
    pub fn new(kind: SqliteErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
    pub fn not_connected() -> Self {
        Self::new(SqliteErrorKind::NotConnected, "No active SQLite connection")
    }
    pub fn session_not_found(id: &str) -> Self {
        Self::new(SqliteErrorKind::SessionNotFound, format!("Session not found: {id}"))
    }
}

// ── Connection config ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SqliteMode {
    File(String),
    Memory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqliteConnectionConfig {
    pub mode: SqliteMode,
    pub read_only: bool,
    pub journal_mode: Option<String>,
    pub busy_timeout_ms: Option<u32>,
    pub cache_size: Option<i64>,
    pub foreign_keys: Option<bool>,
}

impl SqliteConnectionConfig {
    pub fn file(path: impl Into<String>) -> Self {
        Self {
            mode: SqliteMode::File(path.into()),
            read_only: false,
            journal_mode: Some("wal".to_string()),
            busy_timeout_ms: Some(5000),
            cache_size: None,
            foreign_keys: Some(true),
        }
    }

    pub fn memory() -> Self {
        Self {
            mode: SqliteMode::Memory,
            read_only: false,
            journal_mode: None,
            busy_timeout_ms: None,
            cache_size: None,
            foreign_keys: Some(true),
        }
    }

    pub fn with_read_only(mut self) -> Self {
        self.read_only = true;
        self
    }

    pub fn to_url(&self) -> String {
        match &self.mode {
            SqliteMode::File(path) => {
                if self.read_only {
                    format!("sqlite://{}?mode=ro", path)
                } else {
                    format!("sqlite://{}?mode=rwc", path)
                }
            }
            SqliteMode::Memory => "sqlite::memory:".to_string(),
        }
    }
}

// ── Query result ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub type_name: String,
    pub ordinal: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<RowMap>,
    pub affected_rows: u64,
    pub execution_time_ms: u128,
}

impl QueryResult {
    pub fn empty(ms: u128) -> Self {
        Self { columns: vec![], rows: vec![], affected_rows: 0, execution_time_ms: ms }
    }
}

// ── Schema introspection types ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub table_type: String,
    pub sql: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDef {
    pub cid: i32,
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub table_name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_partial: bool,
    pub sql: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub id: i32,
    pub table: String,
    pub from_column: String,
    pub to_table: String,
    pub to_column: String,
    pub on_update: String,
    pub on_delete: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerInfo {
    pub name: String,
    pub table_name: String,
    pub sql: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachedDatabase {
    pub seq: i32,
    pub name: String,
    pub file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PragmaValue {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplainRow {
    pub detail: String,
}

// ── Export / Import ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExportFormat {
    Csv,
    Tsv,
    Sql,
    Json,
}

impl Default for ExportFormat {
    fn default() -> Self { Self::Csv }
}

impl ExportFormat {
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "csv" => Self::Csv,
            "tsv" => Self::Tsv,
            "sql" => Self::Sql,
            "json" => Self::Json,
            _ => Self::Csv,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportOptions {
    pub format: ExportFormat,
    pub include_headers: bool,
    pub include_create: bool,
    pub chunk_size: u32,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            format: ExportFormat::Csv,
            include_headers: true,
            include_create: true,
            chunk_size: 10000,
        }
    }
}

// ── Session / status ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub path: String,
    pub is_memory: bool,
    pub status: ConnectionStatus,
    pub sqlite_version: Option<String>,
    pub connected_at: Option<String>,
    pub queries_executed: u64,
    pub total_rows_fetched: u64,
    pub journal_mode: Option<String>,
    pub page_size: Option<i64>,
    pub database_size_bytes: Option<i64>,
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display() {
        let e = SqliteError::new(SqliteErrorKind::ConnectionFailed, "no such file");
        assert!(e.to_string().contains("ConnectionFailed"));
    }

    #[test]
    fn error_not_connected() {
        let e = SqliteError::not_connected();
        assert!(matches!(e.kind, SqliteErrorKind::NotConnected));
    }

    #[test]
    fn config_file() {
        let c = SqliteConnectionConfig::file("/tmp/test.db");
        assert!(matches!(c.mode, SqliteMode::File(_)));
        assert!(!c.read_only);
        assert_eq!(c.journal_mode.as_deref(), Some("wal"));
    }

    #[test]
    fn config_memory() {
        let c = SqliteConnectionConfig::memory();
        assert!(matches!(c.mode, SqliteMode::Memory));
    }

    #[test]
    fn config_to_url_file() {
        let c = SqliteConnectionConfig::file("/data/app.db");
        assert!(c.to_url().contains("/data/app.db"));
        assert!(c.to_url().contains("mode=rwc"));
    }

    #[test]
    fn config_to_url_file_readonly() {
        let c = SqliteConnectionConfig::file("/data/app.db").with_read_only();
        assert!(c.to_url().contains("mode=ro"));
    }

    #[test]
    fn config_to_url_memory() {
        let c = SqliteConnectionConfig::memory();
        assert_eq!(c.to_url(), "sqlite::memory:");
    }

    #[test]
    fn query_result_empty() {
        let qr = QueryResult::empty(5);
        assert_eq!(qr.execution_time_ms, 5);
    }

    #[test]
    fn export_format_parse() {
        assert!(matches!(ExportFormat::from_str_loose("csv"), ExportFormat::Csv));
        assert!(matches!(ExportFormat::from_str_loose("JSON"), ExportFormat::Json));
    }

    #[test]
    fn connection_status_eq() {
        assert_eq!(ConnectionStatus::Connected, ConnectionStatus::Connected);
    }

    #[test]
    fn session_info_serde() {
        let si = SessionInfo {
            id: "s1".to_string(),
            path: "/tmp/test.db".to_string(),
            is_memory: false,
            status: ConnectionStatus::Connected,
            sqlite_version: Some("3.45.0".to_string()),
            connected_at: None,
            queries_executed: 0,
            total_rows_fetched: 0,
            journal_mode: Some("wal".to_string()),
            page_size: Some(4096),
            database_size_bytes: None,
        };
        let json = serde_json::to_string(&si).unwrap();
        let back: SessionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "s1");
    }
}
