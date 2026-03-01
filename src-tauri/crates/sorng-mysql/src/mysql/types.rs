//! Types for the MySQL / MariaDB integration crate.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Errors ──────────────────────────────────────────────────────────

/// Error kinds specific to MySQL operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MysqlErrorKind {
    Connection,
    Authentication,
    Query,
    Schema,
    Export,
    Import,
    Tunnel,
    Timeout,
    PoolExhausted,
    NotConnected,
    AlreadyConnected,
    InvalidInput,
    Internal,
}

impl std::fmt::Display for MysqlErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Self::Connection => "connection",
            Self::Authentication => "authentication",
            Self::Query => "query",
            Self::Schema => "schema",
            Self::Export => "export",
            Self::Import => "import",
            Self::Tunnel => "tunnel",
            Self::Timeout => "timeout",
            Self::PoolExhausted => "pool_exhausted",
            Self::NotConnected => "not_connected",
            Self::AlreadyConnected => "already_connected",
            Self::InvalidInput => "invalid_input",
            Self::Internal => "internal",
        };
        write!(f, "{}", s)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlError {
    pub kind: MysqlErrorKind,
    pub message: String,
}

impl MysqlError {
    pub fn new(kind: MysqlErrorKind, msg: impl Into<String>) -> Self {
        Self { kind, message: msg.into() }
    }
    pub fn connection(msg: impl Into<String>) -> Self { Self::new(MysqlErrorKind::Connection, msg) }
    pub fn auth(msg: impl Into<String>) -> Self { Self::new(MysqlErrorKind::Authentication, msg) }
    pub fn query(msg: impl Into<String>) -> Self { Self::new(MysqlErrorKind::Query, msg) }
    pub fn schema(msg: impl Into<String>) -> Self { Self::new(MysqlErrorKind::Schema, msg) }
    pub fn export(msg: impl Into<String>) -> Self { Self::new(MysqlErrorKind::Export, msg) }
    pub fn import(msg: impl Into<String>) -> Self { Self::new(MysqlErrorKind::Import, msg) }
    pub fn tunnel(msg: impl Into<String>) -> Self { Self::new(MysqlErrorKind::Tunnel, msg) }
    pub fn not_connected() -> Self { Self::new(MysqlErrorKind::NotConnected, "No active MySQL connection") }
    pub fn invalid(msg: impl Into<String>) -> Self { Self::new(MysqlErrorKind::InvalidInput, msg) }
}

impl std::fmt::Display for MysqlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[mysql:{}] {}", self.kind, self.message)
    }
}

// ── Connection config ───────────────────────────────────────────────

/// SSH tunnel configuration for connecting through a bastion host.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnelConfig {
    pub enabled: bool,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_username: String,
    pub ssh_password: Option<String>,
    pub ssh_private_key: Option<String>,
    pub ssh_passphrase: Option<String>,
}

/// TLS/SSL configuration for the MySQL connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConfig {
    pub enabled: bool,
    pub ca_cert: Option<String>,
    pub client_cert: Option<String>,
    pub client_key: Option<String>,
    pub skip_verify: bool,
}

impl Default for TlsConfig {
    fn default() -> Self {
        Self { enabled: false, ca_cert: None, client_cert: None, client_key: None, skip_verify: false }
    }
}

/// Full connection configuration for a MySQL/MariaDB server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MysqlConnectionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: Option<String>,
    pub ssh_tunnel: Option<SshTunnelConfig>,
    pub tls: Option<TlsConfig>,
    pub max_connections: Option<u32>,
    pub connect_timeout_secs: Option<u64>,
    pub idle_timeout_secs: Option<u64>,
    pub charset: Option<String>,
    pub timezone: Option<String>,
}

impl MysqlConnectionConfig {
    pub fn new(host: &str, port: u16, username: &str, password: &str) -> Self {
        Self {
            host: host.into(),
            port,
            username: username.into(),
            password: password.into(),
            database: None,
            ssh_tunnel: None,
            tls: None,
            max_connections: Some(5),
            connect_timeout_secs: Some(30),
            idle_timeout_secs: Some(300),
            charset: Some("utf8mb4".into()),
            timezone: None,
        }
    }

    pub fn with_database(mut self, db: &str) -> Self {
        self.database = Some(db.into());
        self
    }

    pub fn with_ssh_tunnel(mut self, tunnel: SshTunnelConfig) -> Self {
        self.ssh_tunnel = Some(tunnel);
        self
    }

    /// Build the connection URL.
    pub fn to_url(&self, override_host: Option<&str>, override_port: Option<u16>) -> String {
        let h = override_host.unwrap_or(&self.host);
        let p = override_port.unwrap_or(self.port);
        let db = self.database.as_deref().unwrap_or("");
        let mut url = format!("mysql://{}:{}@{}:{}/{}", self.username, self.password, h, p, db);

        let mut params = Vec::new();
        if let Some(ref cs) = self.charset {
            params.push(format!("charset={}", cs));
        }
        if let Some(ref tz) = self.timezone {
            params.push(format!("timezone={}", tz));
        }
        if !params.is_empty() {
            url.push('?');
            url.push_str(&params.join("&"));
        }
        url
    }
}

// ── Query results ───────────────────────────────────────────────────

/// A single query result set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub affected_rows: u64,
    pub last_insert_id: Option<u64>,
    pub execution_time_ms: u64,
    pub warnings: Vec<String>,
}

impl QueryResult {
    pub fn empty() -> Self {
        Self {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            affected_rows: 0,
            last_insert_id: None,
            execution_time_ms: 0,
            warnings: vec![],
        }
    }
}

/// Column metadata returned alongside query results.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub ordinal: usize,
    pub data_type: String,
    pub is_nullable: bool,
    pub max_length: Option<u32>,
}

// ── Schema introspection ────────────────────────────────────────────

/// Database metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub character_set: Option<String>,
    pub collation: Option<String>,
    pub table_count: Option<usize>,
}

/// Table metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub engine: Option<String>,
    pub row_count: Option<u64>,
    pub data_length: Option<u64>,
    pub index_length: Option<u64>,
    pub auto_increment: Option<u64>,
    pub create_time: Option<String>,
    pub update_time: Option<String>,
    pub collation: Option<String>,
    pub comment: Option<String>,
}

/// Column definition within a table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub column_default: Option<String>,
    pub is_primary_key: bool,
    pub is_unique: bool,
    pub is_auto_increment: bool,
    pub character_set: Option<String>,
    pub collation: Option<String>,
    pub ordinal_position: u32,
    pub extra: String,
    pub comment: Option<String>,
}

/// Index metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: String,
}

/// Foreign key metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub name: String,
    pub column: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub on_update: String,
    pub on_delete: String,
}

// ── Import / Export ─────────────────────────────────────────────────

/// Export format.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExportFormat {
    Csv,
    Sql,
    Json,
    Tsv,
}

impl ExportFormat {
    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "csv" => Some(Self::Csv),
            "sql" => Some(Self::Sql),
            "json" => Some(Self::Json),
            "tsv" => Some(Self::Tsv),
            _ => None,
        }
    }
}

/// Options for export operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportOptions {
    pub format: ExportFormat,
    pub include_schema: bool,
    pub include_data: bool,
    pub chunk_size: u32,
    pub max_chunks: u32,
    pub where_clause: Option<String>,
    pub tables: Option<Vec<String>>,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            format: ExportFormat::Sql,
            include_schema: true,
            include_data: true,
            chunk_size: 1000,
            max_chunks: 100,
            where_clause: None,
            tables: None,
        }
    }
}

// ── Session state ───────────────────────────────────────────────────

/// Status of the MySQL connection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Error(String),
}

impl std::fmt::Display for ConnectionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Disconnected => write!(f, "disconnected"),
            Self::Connecting => write!(f, "connecting"),
            Self::Connected => write!(f, "connected"),
            Self::Error(e) => write!(f, "error: {}", e),
        }
    }
}

/// Session information exposed to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub database: Option<String>,
    pub status: ConnectionStatus,
    pub server_version: Option<String>,
    pub server_charset: Option<String>,
    pub connected_at: Option<String>,
    pub via_ssh_tunnel: bool,
    pub tls_enabled: bool,
    pub queries_executed: u64,
    pub total_rows_fetched: u64,
}

/// Server variable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerVariable {
    pub name: String,
    pub value: String,
}

/// Process entry from SHOW PROCESSLIST.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub id: u64,
    pub user: String,
    pub host: String,
    pub db: Option<String>,
    pub command: String,
    pub time: u64,
    pub state: Option<String>,
    pub info: Option<String>,
}

/// User / privilege info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub user: String,
    pub host: String,
    pub grants: Vec<String>,
}

// ── Stored routine / trigger info ───────────────────────────────────

/// Stored procedure or function.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineInfo {
    pub name: String,
    pub routine_type: String, // PROCEDURE | FUNCTION
    pub definer: String,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub body: Option<String>,
}

/// Trigger definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerInfo {
    pub name: String,
    pub event: String,
    pub table: String,
    pub timing: String,
    pub statement: String,
}

/// View definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewInfo {
    pub name: String,
    pub definition: Option<String>,
    pub definer: String,
    pub is_updatable: bool,
}

// ── Explain / Query plan ────────────────────────────────────────────

/// A single row from EXPLAIN.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplainRow {
    pub id: Option<u64>,
    pub select_type: Option<String>,
    pub table: Option<String>,
    pub partitions: Option<String>,
    pub access_type: Option<String>,
    pub possible_keys: Option<String>,
    pub key: Option<String>,
    pub key_len: Option<String>,
    pub ref_col: Option<String>,
    pub rows: Option<u64>,
    pub filtered: Option<f64>,
    pub extra: Option<String>,
}

// ── Helper maps ─────────────────────────────────────────────────────

/// Shorthand for a row stored as a key-value map.
pub type RowMap = HashMap<String, serde_json::Value>;

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display() {
        let e = MysqlError::connection("refused");
        assert_eq!(format!("{}", e), "[mysql:connection] refused");
    }

    #[test]
    fn error_kinds() {
        assert_eq!(MysqlErrorKind::Connection.to_string(), "connection");
        assert_eq!(MysqlErrorKind::NotConnected.to_string(), "not_connected");
    }

    #[test]
    fn config_new_defaults() {
        let cfg = MysqlConnectionConfig::new("localhost", 3306, "root", "pass");
        assert_eq!(cfg.host, "localhost");
        assert_eq!(cfg.port, 3306);
        assert_eq!(cfg.max_connections, Some(5));
        assert_eq!(cfg.charset, Some("utf8mb4".into()));
    }

    #[test]
    fn config_to_url_basic() {
        let cfg = MysqlConnectionConfig::new("db.example.com", 3306, "user", "pw")
            .with_database("mydb");
        let url = cfg.to_url(None, None);
        assert!(url.starts_with("mysql://user:pw@db.example.com:3306/mydb"));
        assert!(url.contains("charset=utf8mb4"));
    }

    #[test]
    fn config_to_url_override() {
        let cfg = MysqlConnectionConfig::new("remote", 3306, "u", "p");
        let url = cfg.to_url(Some("127.0.0.1"), Some(33060));
        assert!(url.contains("127.0.0.1:33060"));
    }

    #[test]
    fn query_result_empty() {
        let qr = QueryResult::empty();
        assert_eq!(qr.row_count, 0);
        assert_eq!(qr.affected_rows, 0);
        assert!(qr.columns.is_empty());
    }

    #[test]
    fn connection_status_display() {
        assert_eq!(ConnectionStatus::Connected.to_string(), "connected");
        assert_eq!(ConnectionStatus::Disconnected.to_string(), "disconnected");
        assert_eq!(ConnectionStatus::Error("fail".into()).to_string(), "error: fail");
    }

    #[test]
    fn export_format_from_str() {
        assert_eq!(ExportFormat::from_str_loose("csv"), Some(ExportFormat::Csv));
        assert_eq!(ExportFormat::from_str_loose("SQL"), Some(ExportFormat::Sql));
        assert_eq!(ExportFormat::from_str_loose("JSON"), Some(ExportFormat::Json));
        assert_eq!(ExportFormat::from_str_loose("tsv"), Some(ExportFormat::Tsv));
        assert_eq!(ExportFormat::from_str_loose("xml"), None);
    }

    #[test]
    fn export_options_default() {
        let opts = ExportOptions::default();
        assert_eq!(opts.format, ExportFormat::Sql);
        assert!(opts.include_schema);
        assert!(opts.include_data);
        assert_eq!(opts.chunk_size, 1000);
    }

    #[test]
    fn tls_config_default() {
        let tls = TlsConfig::default();
        assert!(!tls.enabled);
        assert!(!tls.skip_verify);
    }

    #[test]
    fn session_info_serde_roundtrip() {
        let info = SessionInfo {
            id: "abc".into(),
            host: "h".into(),
            port: 3306,
            username: "u".into(),
            database: Some("db".into()),
            status: ConnectionStatus::Connected,
            server_version: Some("8.0".into()),
            server_charset: None,
            connected_at: None,
            via_ssh_tunnel: false,
            tls_enabled: false,
            queries_executed: 10,
            total_rows_fetched: 500,
        };
        let json = serde_json::to_string(&info).unwrap();
        let back: SessionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "abc");
        assert_eq!(back.queries_executed, 10);
    }

    #[test]
    fn database_info_clone() {
        let db = DatabaseInfo { name: "test".into(), character_set: Some("utf8mb4".into()), collation: None, table_count: Some(5) };
        let db2 = db.clone();
        assert_eq!(db.name, db2.name);
        assert_eq!(db.table_count, db2.table_count);
    }

    #[test]
    fn column_def_primary_key() {
        let col = ColumnDef {
            name: "id".into(),
            data_type: "INT".into(),
            is_nullable: false,
            column_default: None,
            is_primary_key: true,
            is_unique: true,
            is_auto_increment: true,
            character_set: None,
            collation: None,
            ordinal_position: 1,
            extra: "auto_increment".into(),
            comment: None,
        };
        assert!(col.is_primary_key);
        assert!(col.is_auto_increment);
    }

    #[test]
    fn index_info_serde() {
        let idx = IndexInfo {
            name: "idx_email".into(),
            columns: vec!["email".into()],
            is_unique: true,
            is_primary: false,
            index_type: "BTREE".into(),
        };
        let j = serde_json::to_value(&idx).unwrap();
        assert_eq!(j["name"], "idx_email");
        assert_eq!(j["is_unique"], true);
    }

    #[test]
    fn foreign_key_info_clone() {
        let fk = ForeignKeyInfo {
            name: "fk_user".into(),
            column: "user_id".into(),
            referenced_table: "users".into(),
            referenced_column: "id".into(),
            on_update: "CASCADE".into(),
            on_delete: "SET NULL".into(),
        };
        let fk2 = fk.clone();
        assert_eq!(fk2.on_delete, "SET NULL");
    }

    #[test]
    fn explain_row_default_fields() {
        let row = ExplainRow {
            id: Some(1),
            select_type: Some("SIMPLE".into()),
            table: Some("users".into()),
            partitions: None,
            access_type: Some("ALL".into()),
            possible_keys: None,
            key: None,
            key_len: None,
            ref_col: None,
            rows: Some(1000),
            filtered: Some(100.0),
            extra: Some("Using where".into()),
        };
        assert_eq!(row.id, Some(1));
        assert_eq!(row.rows, Some(1000));
    }

    #[test]
    fn process_info_serde() {
        let p = ProcessInfo {
            id: 42,
            user: "root".into(),
            host: "localhost".into(),
            db: Some("mydb".into()),
            command: "Query".into(),
            time: 5,
            state: Some("Sending data".into()),
            info: Some("SELECT * FROM t".into()),
        };
        let j = serde_json::to_value(&p).unwrap();
        assert_eq!(j["id"], 42);
        assert_eq!(j["command"], "Query");
    }

    #[test]
    fn routine_info_types() {
        let r = RoutineInfo { name: "my_proc".into(), routine_type: "PROCEDURE".into(), definer: "root@localhost".into(), created: None, modified: None, body: Some("BEGIN END".into()) };
        assert_eq!(r.routine_type, "PROCEDURE");
    }

    #[test]
    fn trigger_info() {
        let t = TriggerInfo { name: "before_insert".into(), event: "INSERT".into(), table: "users".into(), timing: "BEFORE".into(), statement: "SET NEW.created = NOW()".into() };
        assert_eq!(t.timing, "BEFORE");
    }

    #[test]
    fn view_info() {
        let v = ViewInfo { name: "active_users".into(), definition: Some("SELECT * FROM users WHERE active = 1".into()), definer: "root@localhost".into(), is_updatable: true };
        assert!(v.is_updatable);
    }
}
