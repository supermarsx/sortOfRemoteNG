//! Types for the Microsoft SQL Server integration crate.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

/// A single row represented as column-name → JSON value.
pub type RowMap = HashMap<String, serde_json::Value>;

// ── Error ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MssqlErrorKind {
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
pub struct MssqlError {
    pub kind: MssqlErrorKind,
    pub message: String,
}

impl fmt::Display for MssqlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)
    }
}

impl std::error::Error for MssqlError {}

impl MssqlError {
    pub fn new(kind: MssqlErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
    pub fn not_connected() -> Self {
        Self::new(MssqlErrorKind::NotConnected, "No active SQL Server connection")
    }
    pub fn session_not_found(id: &str) -> Self {
        Self::new(MssqlErrorKind::SessionNotFound, format!("Session not found: {id}"))
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
    pub trust_server_certificate: bool,
    pub ca_cert_path: Option<String>,
}

// ── Connection config ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MssqlAuthMethod {
    SqlAuth { username: String, password: String },
    WindowsAuth,
    AzureAd { username: String, password: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MssqlConnectionConfig {
    pub host: String,
    pub port: u16,
    pub auth: MssqlAuthMethod,
    pub database: Option<String>,
    pub instance_name: Option<String>,
    pub application_name: Option<String>,
    pub connection_timeout_secs: Option<u64>,
    pub ssh_tunnel: Option<SshTunnelConfig>,
    pub tls: Option<TlsConfig>,
    pub encrypt: Option<bool>,
}

impl MssqlConnectionConfig {
    pub fn sql_auth(host: impl Into<String>, port: u16, username: impl Into<String>, password: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            port,
            auth: MssqlAuthMethod::SqlAuth { username: username.into(), password: password.into() },
            database: None,
            instance_name: None,
            application_name: None,
            connection_timeout_secs: Some(15),
            ssh_tunnel: None,
            tls: None,
            encrypt: Some(true),
        }
    }

    pub fn with_database(mut self, db: impl Into<String>) -> Self {
        self.database = Some(db.into());
        self
    }

    pub fn with_instance(mut self, instance: impl Into<String>) -> Self {
        self.instance_name = Some(instance.into());
        self
    }

    pub fn with_ssh_tunnel(mut self, cfg: SshTunnelConfig) -> Self {
        self.ssh_tunnel = Some(cfg);
        self
    }

    /// Build an ADO.NET-style connection string for tiberius.
    pub fn to_ado_string(&self, override_port: Option<u16>) -> String {
        let port = override_port.unwrap_or(self.port);
        let mut parts: Vec<String> = vec![
            format!("server=tcp:{},{}", self.host, port),
        ];
        if let Some(ref inst) = self.instance_name {
            parts.push(format!("instance={inst}"));
        }
        match &self.auth {
            MssqlAuthMethod::SqlAuth { username, password } => {
                parts.push(format!("user={username}"));
                parts.push(format!("password={password}"));
                parts.push("IntegratedSecurity=false".to_string());
            }
            MssqlAuthMethod::WindowsAuth => {
                parts.push("IntegratedSecurity=true".to_string());
            }
            MssqlAuthMethod::AzureAd { username, password } => {
                parts.push(format!("user={username}"));
                parts.push(format!("password={password}"));
                parts.push("Authentication=ActiveDirectoryPassword".to_string());
            }
        }
        if let Some(ref db) = self.database {
            parts.push(format!("database={db}"));
        }
        if let Some(ref app) = self.application_name {
            parts.push(format!("ApplicationName={app}"));
        }
        if let Some(e) = self.encrypt {
            parts.push(format!("Encrypt={}", if e { "true" } else { "false" }));
        }
        if let Some(ref tls) = self.tls {
            parts.push(format!("TrustServerCertificate={}", if tls.trust_server_certificate { "true" } else { "false" }));
        }
        parts.join(";")
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
    pub state: Option<String>,
    pub recovery_model: Option<String>,
    pub compatibility_level: Option<i32>,
    pub collation: Option<String>,
    pub size_mb: Option<f64>,
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
    pub row_count: Option<i64>,
    pub total_size_kb: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
    pub max_length: Option<i16>,
    pub precision: Option<u8>,
    pub scale: Option<u8>,
    pub is_nullable: bool,
    pub is_identity: bool,
    pub is_computed: bool,
    pub default_value: Option<String>,
    pub ordinal_position: i32,
    pub collation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub table_name: String,
    pub index_type: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary_key: bool,
    pub is_clustered: bool,
    pub fill_factor: Option<u8>,
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
    pub is_indexed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredProcInfo {
    pub name: String,
    pub schema: String,
    pub proc_type: String,
    pub definition: Option<String>,
    pub created: Option<String>,
    pub modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerInfo {
    pub name: String,
    pub table_name: String,
    pub schema: String,
    pub trigger_type: String,
    pub is_enabled: bool,
    pub definition: Option<String>,
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
    pub database: Option<String>,
    pub instance_name: Option<String>,
    pub status: ConnectionStatus,
    pub server_version: Option<String>,
    pub connected_at: Option<String>,
    pub queries_executed: u64,
    pub total_rows_fetched: u64,
    pub via_ssh_tunnel: bool,
}

// ── Admin ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerProperty {
    pub name: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpWhoResult {
    pub spid: i16,
    pub status: Option<String>,
    pub login_name: Option<String>,
    pub hostname: Option<String>,
    pub database_name: Option<String>,
    pub command: Option<String>,
    pub program_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlLogin {
    pub name: String,
    pub login_type: String,
    pub is_disabled: bool,
    pub default_database: Option<String>,
    pub create_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExplainRow {
    pub stmt_text: Option<String>,
    pub stmt_id: Option<i32>,
    pub node_id: Option<i32>,
    pub parent: Option<i32>,
    pub physical_op: Option<String>,
    pub logical_op: Option<String>,
    pub argument: Option<String>,
    pub estimated_rows: Option<f64>,
    pub estimated_io: Option<f64>,
    pub estimated_cpu: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentJobInfo {
    pub name: String,
    pub enabled: bool,
    pub description: Option<String>,
    pub last_run_date: Option<String>,
    pub last_run_outcome: Option<String>,
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display() {
        let e = MssqlError::new(MssqlErrorKind::ConnectionFailed, "tcp failed");
        assert!(e.to_string().contains("ConnectionFailed"));
        assert!(e.to_string().contains("tcp failed"));
    }

    #[test]
    fn error_not_connected() {
        let e = MssqlError::not_connected();
        assert!(matches!(e.kind, MssqlErrorKind::NotConnected));
    }

    #[test]
    fn error_session_not_found() {
        let e = MssqlError::session_not_found("x1");
        assert!(e.message.contains("x1"));
    }

    #[test]
    fn config_sql_auth() {
        let c = MssqlConnectionConfig::sql_auth("dbserver", 1433, "sa", "pass");
        assert_eq!(c.host, "dbserver");
        assert_eq!(c.port, 1433);
        assert!(matches!(c.auth, MssqlAuthMethod::SqlAuth { .. }));
        assert_eq!(c.connection_timeout_secs, Some(15));
    }

    #[test]
    fn config_builders() {
        let c = MssqlConnectionConfig::sql_auth("h", 1433, "u", "p")
            .with_database("mydb")
            .with_instance("INST1");
        assert_eq!(c.database.as_deref(), Some("mydb"));
        assert_eq!(c.instance_name.as_deref(), Some("INST1"));
    }

    #[test]
    fn config_to_ado_string_sql_auth() {
        let c = MssqlConnectionConfig::sql_auth("srv", 1433, "sa", "pw")
            .with_database("test");
        let ado = c.to_ado_string(None);
        assert!(ado.contains("server=tcp:srv,1433"));
        assert!(ado.contains("user=sa"));
        assert!(ado.contains("password=pw"));
        assert!(ado.contains("database=test"));
    }

    #[test]
    fn config_to_ado_windows_auth() {
        let c = MssqlConnectionConfig {
            host: "srv".to_string(),
            port: 1433,
            auth: MssqlAuthMethod::WindowsAuth,
            database: None,
            instance_name: None,
            application_name: None,
            connection_timeout_secs: None,
            ssh_tunnel: None,
            tls: None,
            encrypt: None,
        };
        let ado = c.to_ado_string(None);
        assert!(ado.contains("IntegratedSecurity=true"));
    }

    #[test]
    fn config_to_ado_override_port() {
        let c = MssqlConnectionConfig::sql_auth("h", 1433, "u", "p");
        let ado = c.to_ado_string(Some(14330));
        assert!(ado.contains(":14330"));
    }

    #[test]
    fn query_result_empty() {
        let qr = QueryResult::empty(100);
        assert_eq!(qr.execution_time_ms, 100);
        assert!(qr.rows.is_empty());
    }

    #[test]
    fn export_format_from_str() {
        assert!(matches!(ExportFormat::from_str_loose("csv"), ExportFormat::Csv));
        assert!(matches!(ExportFormat::from_str_loose("TSV"), ExportFormat::Tsv));
        assert!(matches!(ExportFormat::from_str_loose("SQL"), ExportFormat::Sql));
        assert!(matches!(ExportFormat::from_str_loose("json"), ExportFormat::Json));
        assert!(matches!(ExportFormat::from_str_loose("unknown"), ExportFormat::Csv));
    }

    #[test]
    fn connection_status_eq() {
        assert_eq!(ConnectionStatus::Connected, ConnectionStatus::Connected);
        assert_ne!(ConnectionStatus::Connected, ConnectionStatus::Disconnected);
    }

    #[test]
    fn session_info_serde() {
        let si = SessionInfo {
            id: "s1".to_string(),
            host: "sqlserver".to_string(),
            port: 1433,
            database: Some("master".to_string()),
            instance_name: None,
            status: ConnectionStatus::Connected,
            server_version: Some("16.0.1000".to_string()),
            connected_at: None,
            queries_executed: 3,
            total_rows_fetched: 50,
            via_ssh_tunnel: false,
        };
        let json = serde_json::to_string(&si).unwrap();
        let back: SessionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "s1");
        assert_eq!(back.queries_executed, 3);
    }

    #[test]
    fn agent_job_info_serde() {
        let j = AgentJobInfo {
            name: "Backup".to_string(),
            enabled: true,
            description: Some("Daily backup".to_string()),
            last_run_date: None,
            last_run_outcome: Some("Succeeded".to_string()),
        };
        let json = serde_json::to_string(&j).unwrap();
        assert!(json.contains("Backup"));
    }
}
