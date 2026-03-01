//! Types for the PostgreSQL integration crate.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

// ── Row alias ───────────────────────────────────────────────────────

/// A single row represented as column-name → JSON value.
pub type RowMap = HashMap<String, serde_json::Value>;

// ── Error ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PgErrorKind {
    ConnectionFailed,
    AuthenticationFailed,
    QueryFailed,
    NotConnected,
    SessionNotFound,
    SessionExists,
    DatabaseNotFound,
    SchemaNotFound,
    TableNotFound,
    PermissionDenied,
    SshTunnelFailed,
    TlsError,
    Timeout,
    ExportFailed,
    ImportFailed,
    InvalidInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgError {
    pub kind: PgErrorKind,
    pub message: String,
}

impl fmt::Display for PgError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for PgError {}

impl PgError {
    pub fn new(kind: PgErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
    pub fn not_connected() -> Self {
        Self::new(PgErrorKind::NotConnected, "No active PostgreSQL connection")
    }
    pub fn session_not_found(id: &str) -> Self {
        Self::new(PgErrorKind::SessionNotFound, format!("Session not found: {id}"))
    }
}

// ── SSH / TLS ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnelConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConfig {
    pub require_ssl: bool,
    pub ca_cert_path: Option<String>,
    pub client_cert_path: Option<String>,
    pub client_key_path: Option<String>,
}

// ── Connection config ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgConnectionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub database: Option<String>,
    pub application_name: Option<String>,
    pub connection_timeout_secs: Option<u64>,
    pub ssh_tunnel: Option<SshTunnelConfig>,
    pub tls: Option<TlsConfig>,
    pub extra_params: Option<HashMap<String, String>>,
}

impl PgConnectionConfig {
    pub fn new(host: impl Into<String>, port: u16, username: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            port,
            username: username.into(),
            password: None,
            database: None,
            application_name: None,
            connection_timeout_secs: Some(10),
            ssh_tunnel: None,
            tls: None,
            extra_params: None,
        }
    }

    pub fn with_password(mut self, p: impl Into<String>) -> Self {
        self.password = Some(p.into());
        self
    }

    pub fn with_database(mut self, db: impl Into<String>) -> Self {
        self.database = Some(db.into());
        self
    }

    pub fn with_ssh_tunnel(mut self, cfg: SshTunnelConfig) -> Self {
        self.ssh_tunnel = Some(cfg);
        self
    }

    /// Build a `postgres://` connection URL.
    pub fn to_url(&self, override_port: Option<u16>) -> String {
        let port = override_port.unwrap_or(self.port);
        let userinfo = match &self.password {
            Some(pw) => format!("{}:{}", self.username, pw),
            None => self.username.clone(),
        };
        let db = self.database.as_deref().unwrap_or("postgres");
        let mut url = format!("postgres://{userinfo}@{}:{port}/{db}", self.host);
        let mut params: Vec<String> = Vec::new();
        if let Some(ref app) = self.application_name {
            params.push(format!("application_name={app}"));
        }
        if let Some(t) = self.connection_timeout_secs {
            params.push(format!("connect_timeout={t}"));
        }
        if let Some(ref extra) = self.extra_params {
            for (k, v) in extra {
                params.push(format!("{k}={v}"));
            }
        }
        if !params.is_empty() {
            url.push('?');
            url.push_str(&params.join("&"));
        }
        url
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
pub struct DatabaseInfo {
    pub name: String,
    pub owner: Option<String>,
    pub encoding: Option<String>,
    pub collation: Option<String>,
    pub size_bytes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaInfo {
    pub name: String,
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub schema: String,
    pub table_type: String,
    pub estimated_rows: Option<i64>,
    pub total_size: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub udt_name: String,
    pub is_nullable: bool,
    pub column_default: Option<String>,
    pub character_maximum_length: Option<i64>,
    pub numeric_precision: Option<i32>,
    pub ordinal_position: i32,
    pub is_identity: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub table_name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: Option<String>,
    pub index_size: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub name: String,
    pub column: String,
    pub referenced_table: String,
    pub referenced_column: String,
    pub referenced_schema: String,
    pub on_update: String,
    pub on_delete: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewInfo {
    pub name: String,
    pub schema: String,
    pub definition: Option<String>,
    pub is_materialized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutineInfo {
    pub name: String,
    pub schema: String,
    pub routine_type: String,
    pub language: Option<String>,
    pub return_type: Option<String>,
    pub definition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerInfo {
    pub name: String,
    pub table_name: String,
    pub schema: String,
    pub event: String,
    pub timing: String,
    pub definition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequenceInfo {
    pub name: String,
    pub schema: String,
    pub data_type: String,
    pub start_value: Option<i64>,
    pub increment: Option<i64>,
    pub min_value: Option<i64>,
    pub max_value: Option<i64>,
    pub current_value: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionInfo {
    pub name: String,
    pub version: String,
    pub schema: Option<String>,
    pub description: Option<String>,
}

// ── Explain ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplainNode {
    pub plan: serde_json::Value,
}

// ── Export / Import ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExportFormat {
    Csv,
    Tsv,
    Sql,
    Json,
    Copy,
}

impl Default for ExportFormat {
    fn default() -> Self {
        Self::Csv
    }
}

impl ExportFormat {
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "csv" => Self::Csv,
            "tsv" => Self::Tsv,
            "sql" => Self::Sql,
            "json" => Self::Json,
            "copy" => Self::Copy,
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
            chunk_size: 5000,
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
    pub host: String,
    pub port: u16,
    pub username: String,
    pub database: Option<String>,
    pub status: ConnectionStatus,
    pub server_version: Option<String>,
    pub connected_at: Option<String>,
    pub queries_executed: u64,
    pub total_rows_fetched: u64,
    pub via_ssh_tunnel: bool,
}

// ── Admin types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerSetting {
    pub name: String,
    pub setting: String,
    pub unit: Option<String>,
    pub category: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgStatActivity {
    pub pid: i32,
    pub database: Option<String>,
    pub username: Option<String>,
    pub application_name: Option<String>,
    pub client_addr: Option<String>,
    pub state: Option<String>,
    pub query: Option<String>,
    pub query_start: Option<String>,
    pub wait_event_type: Option<String>,
    pub wait_event: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgRole {
    pub name: String,
    pub is_superuser: bool,
    pub can_login: bool,
    pub can_create_db: bool,
    pub can_create_role: bool,
    pub is_replication: bool,
    pub connection_limit: Option<i32>,
    pub valid_until: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TablespaceInfo {
    pub name: String,
    pub owner: String,
    pub location: Option<String>,
    pub size: Option<String>,
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display() {
        let e = PgError::new(PgErrorKind::ConnectionFailed, "refused");
        assert!(e.to_string().contains("ConnectionFailed"));
        assert!(e.to_string().contains("refused"));
    }

    #[test]
    fn error_not_connected() {
        let e = PgError::not_connected();
        assert!(matches!(e.kind, PgErrorKind::NotConnected));
    }

    #[test]
    fn error_session_not_found() {
        let e = PgError::session_not_found("abc");
        assert!(e.message.contains("abc"));
    }

    #[test]
    fn config_new_defaults() {
        let c = PgConnectionConfig::new("localhost", 5432, "postgres");
        assert_eq!(c.host, "localhost");
        assert_eq!(c.port, 5432);
        assert_eq!(c.username, "postgres");
        assert!(c.password.is_none());
        assert!(c.database.is_none());
        assert_eq!(c.connection_timeout_secs, Some(10));
    }

    #[test]
    fn config_builders() {
        let c = PgConnectionConfig::new("db.host", 5432, "admin")
            .with_password("secret")
            .with_database("mydb");
        assert_eq!(c.password.as_deref(), Some("secret"));
        assert_eq!(c.database.as_deref(), Some("mydb"));
    }

    #[test]
    fn config_to_url_simple() {
        let c = PgConnectionConfig::new("localhost", 5432, "postgres");
        let url = c.to_url(None);
        assert!(url.starts_with("postgres://postgres@localhost:5432/postgres"));
    }

    #[test]
    fn config_to_url_with_password_and_db() {
        let c = PgConnectionConfig::new("localhost", 5432, "admin")
            .with_password("pass")
            .with_database("shop");
        let url = c.to_url(None);
        assert!(url.contains("admin:pass@"));
        assert!(url.contains("/shop"));
    }

    #[test]
    fn config_to_url_override_port() {
        let c = PgConnectionConfig::new("localhost", 5432, "u");
        let url = c.to_url(Some(15432));
        assert!(url.contains(":15432/"));
    }

    #[test]
    fn config_to_url_application_name() {
        let mut c = PgConnectionConfig::new("localhost", 5432, "u");
        c.application_name = Some("myapp".to_string());
        let url = c.to_url(None);
        assert!(url.contains("application_name=myapp"));
    }

    #[test]
    fn query_result_empty() {
        let qr = QueryResult::empty(42);
        assert_eq!(qr.columns.len(), 0);
        assert_eq!(qr.rows.len(), 0);
        assert_eq!(qr.execution_time_ms, 42);
    }

    #[test]
    fn export_format_from_str() {
        assert!(matches!(ExportFormat::from_str_loose("csv"), ExportFormat::Csv));
        assert!(matches!(ExportFormat::from_str_loose("TSV"), ExportFormat::Tsv));
        assert!(matches!(ExportFormat::from_str_loose("SQL"), ExportFormat::Sql));
        assert!(matches!(ExportFormat::from_str_loose("json"), ExportFormat::Json));
        assert!(matches!(ExportFormat::from_str_loose("copy"), ExportFormat::Copy));
        assert!(matches!(ExportFormat::from_str_loose("xyz"), ExportFormat::Csv));
    }

    #[test]
    fn export_options_default() {
        let o = ExportOptions::default();
        assert!(o.include_headers);
        assert!(o.include_create);
        assert_eq!(o.chunk_size, 5000);
    }

    #[test]
    fn connection_status_eq() {
        assert_eq!(ConnectionStatus::Connected, ConnectionStatus::Connected);
        assert_ne!(ConnectionStatus::Connected, ConnectionStatus::Disconnected);
    }

    #[test]
    fn session_info_serde_roundtrip() {
        let si = SessionInfo {
            id: "s1".to_string(),
            host: "localhost".to_string(),
            port: 5432,
            username: "pg".to_string(),
            database: Some("test".to_string()),
            status: ConnectionStatus::Connected,
            server_version: Some("16.2".to_string()),
            connected_at: None,
            queries_executed: 5,
            total_rows_fetched: 100,
            via_ssh_tunnel: false,
        };
        let json = serde_json::to_string(&si).unwrap();
        let back: SessionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "s1");
        assert_eq!(back.queries_executed, 5);
    }

    #[test]
    fn pg_role_serde() {
        let r = PgRole {
            name: "admin".to_string(),
            is_superuser: true,
            can_login: true,
            can_create_db: false,
            can_create_role: false,
            is_replication: false,
            connection_limit: Some(10),
            valid_until: None,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("\"is_superuser\":true"));
    }

    #[test]
    fn schema_types_serde() {
        let si = SequenceInfo {
            name: "id_seq".to_string(),
            schema: "public".to_string(),
            data_type: "bigint".to_string(),
            start_value: Some(1),
            increment: Some(1),
            min_value: Some(1),
            max_value: Some(i64::MAX),
            current_value: Some(42),
        };
        let json = serde_json::to_string(&si).unwrap();
        let back: SequenceInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "id_seq");
        assert_eq!(back.current_value, Some(42));
    }

    #[test]
    fn extension_info_serde() {
        let ext = ExtensionInfo {
            name: "pgcrypto".to_string(),
            version: "1.3".to_string(),
            schema: Some("public".to_string()),
            description: Some("cryptographic functions".to_string()),
        };
        let json = serde_json::to_string(&ext).unwrap();
        assert!(json.contains("pgcrypto"));
    }

    #[test]
    fn view_info_materialized() {
        let v = ViewInfo {
            name: "my_view".to_string(),
            schema: "public".to_string(),
            definition: Some("SELECT 1".to_string()),
            is_materialized: true,
        };
        assert!(v.is_materialized);
    }
}
