//! Types for the MySQL / MariaDB integration crate.

use serde::{Deserialize, Serialize};
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use std::collections::HashMap;
use std::fmt;
use zeroize::Zeroize;

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
    Unsupported,
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
            Self::Unsupported => "unsupported",
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
        Self {
            kind,
            message: msg.into(),
        }
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::Connection, msg)
    }
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::Authentication, msg)
    }
    pub fn query(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::Query, msg)
    }
    pub fn schema(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::Schema, msg)
    }
    pub fn export(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::Export, msg)
    }
    pub fn import(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::Import, msg)
    }
    pub fn tunnel(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::Tunnel, msg)
    }
    pub fn not_connected() -> Self {
        Self::new(MysqlErrorKind::NotConnected, "No active MySQL connection")
    }
    pub fn invalid(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::InvalidInput, msg)
    }
    pub fn unsupported(msg: impl Into<String>) -> Self {
        Self::new(MysqlErrorKind::Unsupported, msg)
    }
}

impl std::fmt::Display for MysqlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[mysql:{}] {}", self.kind, self.message)
    }
}

// ── Connection config ───────────────────────────────────────────────

/// SSH tunnel configuration for connecting through a bastion host.
///
/// The DTO is kept for wire compatibility, but `MysqlService::connect`
/// rejects any config that carries an enabled tunnel: no real forwarder
/// exists yet, and the previous implementation dialled an unbound local port
/// after authenticating (see `docs/` follow-up). Mirrors `sorng-postgres`.
#[derive(Clone, Serialize, Deserialize)]
pub struct SshTunnelConfig {
    pub enabled: bool,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_username: String,
    pub ssh_password: Option<String>,
    pub ssh_private_key: Option<String>,
    pub ssh_passphrase: Option<String>,
}

impl fmt::Debug for SshTunnelConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SshTunnelConfig")
            .field("enabled", &self.enabled)
            .field("ssh_host", &self.ssh_host)
            .field("ssh_port", &self.ssh_port)
            .field("ssh_username", &self.ssh_username)
            .field(
                "ssh_password",
                &self.ssh_password.as_ref().map(|_| REDACTED),
            )
            .field(
                "ssh_private_key",
                &self.ssh_private_key.as_ref().map(|_| REDACTED),
            )
            .field(
                "ssh_passphrase",
                &self.ssh_passphrase.as_ref().map(|_| REDACTED),
            )
            .finish()
    }
}

impl Drop for SshTunnelConfig {
    fn drop(&mut self) {
        self.ssh_password.zeroize();
        self.ssh_private_key.zeroize();
        self.ssh_passphrase.zeroize();
    }
}

const REDACTED: &str = "[redacted]";

/// TLS/SSL configuration for the MySQL connection.
///
/// `ca_cert`, `client_cert` and `client_key` accept either a filesystem path
/// or inline PEM text (detected by a `-----BEGIN` marker).
///
/// Mapping to the driver's SSL mode (see [`MysqlConnectionConfig::tls_plan`]):
///
/// | config                               | sqlx `MySqlSslMode` |
/// |--------------------------------------|---------------------|
/// | `tls: None`                          | `Preferred`         |
/// | `enabled: false`                     | `Disabled`          |
/// | `enabled, skip_verify`               | `Required`          |
/// | `enabled, !skip_verify`              | `VerifyCa`          |
/// | `enabled, !skip_verify, verify_hostname` | `VerifyIdentity` |
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct TlsConfig {
    pub enabled: bool,
    pub ca_cert: Option<String>,
    pub client_cert: Option<String>,
    pub client_key: Option<String>,
    pub skip_verify: bool,
    /// Additionally verify that the server certificate matches `host`
    /// (`VerifyIdentity`). Only meaningful when `skip_verify` is false.
    pub verify_hostname: bool,
}

/// Certificate material: a path on disk or inline PEM text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TlsMaterial {
    Path(String),
    Pem(String),
}

impl TlsMaterial {
    pub fn from_input(value: &str) -> Option<Self> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else if trimmed.starts_with("-----BEGIN") {
            Some(Self::Pem(trimmed.to_string()))
        } else {
            Some(Self::Path(trimmed.to_string()))
        }
    }
}

/// Driver SSL mode, mirrored locally so it can be compared/serialised.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TlsMode {
    Disabled,
    Preferred,
    Required,
    VerifyCa,
    VerifyIdentity,
}

impl From<TlsMode> for MySqlSslMode {
    fn from(mode: TlsMode) -> Self {
        match mode {
            TlsMode::Disabled => MySqlSslMode::Disabled,
            TlsMode::Preferred => MySqlSslMode::Preferred,
            TlsMode::Required => MySqlSslMode::Required,
            TlsMode::VerifyCa => MySqlSslMode::VerifyCa,
            TlsMode::VerifyIdentity => MySqlSslMode::VerifyIdentity,
        }
    }
}

impl From<MySqlSslMode> for TlsMode {
    fn from(mode: MySqlSslMode) -> Self {
        match mode {
            MySqlSslMode::Disabled => TlsMode::Disabled,
            MySqlSslMode::Preferred => TlsMode::Preferred,
            MySqlSslMode::Required => TlsMode::Required,
            MySqlSslMode::VerifyCa => TlsMode::VerifyCa,
            MySqlSslMode::VerifyIdentity => TlsMode::VerifyIdentity,
        }
    }
}

/// Resolved TLS settings that will be applied to the driver options.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsPlan {
    pub mode: TlsMode,
    pub ca: Option<TlsMaterial>,
    pub client_cert: Option<TlsMaterial>,
    pub client_key: Option<TlsMaterial>,
}

/// Full connection configuration for a MySQL/MariaDB server.
///
/// `Debug` redacts the password and the password is zeroised on drop.
#[derive(Clone, Serialize, Deserialize)]
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

    pub fn with_tls(mut self, tls: TlsConfig) -> Self {
        self.tls = Some(tls);
        self
    }

    /// True when the DTO asks for an SSH tunnel. The service refuses such
    /// configs before opening any socket.
    pub fn requests_ssh_tunnel(&self) -> bool {
        self.ssh_tunnel.as_ref().is_some_and(|t| t.enabled)
    }

    /// Resolve the TLS configuration into a driver SSL mode plus material.
    pub fn tls_plan(&self) -> TlsPlan {
        let Some(tls) = self.tls.as_ref() else {
            return TlsPlan {
                mode: TlsMode::Preferred,
                ca: None,
                client_cert: None,
                client_key: None,
            };
        };
        if !tls.enabled {
            return TlsPlan {
                mode: TlsMode::Disabled,
                ca: None,
                client_cert: None,
                client_key: None,
            };
        }
        let mode = if tls.skip_verify {
            TlsMode::Required
        } else if tls.verify_hostname {
            TlsMode::VerifyIdentity
        } else {
            TlsMode::VerifyCa
        };
        TlsPlan {
            mode,
            ca: tls.ca_cert.as_deref().and_then(TlsMaterial::from_input),
            client_cert: tls.client_cert.as_deref().and_then(TlsMaterial::from_input),
            client_key: tls.client_key.as_deref().and_then(TlsMaterial::from_input),
        }
    }

    /// Build the driver connect options. No URL string is ever produced, so
    /// credentials containing `@ : / % #` need no escaping and never end up
    /// in a formatted string.
    pub fn connect_options(&self) -> MySqlConnectOptions {
        let plan = self.tls_plan();
        let mut opts = MySqlConnectOptions::new()
            .host(&self.host)
            .port(self.port)
            .username(&self.username)
            .password(&self.password)
            .ssl_mode(plan.mode.into());
        if let Some(db) = self.database.as_deref().filter(|d| !d.is_empty()) {
            opts = opts.database(db);
        }
        if let Some(cs) = self.charset.as_deref().filter(|c| !c.is_empty()) {
            opts = opts.charset(cs);
        }
        if let Some(tz) = self.timezone.as_deref().filter(|t| !t.is_empty()) {
            opts = opts.timezone(Some(tz.to_string()));
        }
        opts = match plan.ca {
            Some(TlsMaterial::Path(p)) => opts.ssl_ca(p),
            Some(TlsMaterial::Pem(pem)) => opts.ssl_ca_from_pem(pem.into_bytes()),
            None => opts,
        };
        opts = match plan.client_cert {
            Some(TlsMaterial::Path(p)) => opts.ssl_client_cert(p),
            Some(TlsMaterial::Pem(pem)) => opts.ssl_client_cert_from_pem(pem),
            None => opts,
        };
        opts = match plan.client_key {
            Some(TlsMaterial::Path(p)) => opts.ssl_client_key(p),
            Some(TlsMaterial::Pem(pem)) => opts.ssl_client_key_from_pem(pem),
            None => opts,
        };
        opts
    }

    /// Redacted, display-only URL (`mysql://user@host:port/db`). Never
    /// includes the password.
    pub fn display_url(&self) -> String {
        let db = self.database.as_deref().unwrap_or("");
        format!(
            "mysql://{}@{}:{}/{}",
            self.username.replace(['@', ':', '/'], "_"),
            self.host,
            self.port,
            db
        )
    }
}

impl fmt::Debug for MysqlConnectionConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MysqlConnectionConfig")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("password", &REDACTED)
            .field("database", &self.database)
            .field("ssh_tunnel", &self.ssh_tunnel)
            .field("tls", &self.tls)
            .field("max_connections", &self.max_connections)
            .field("connect_timeout_secs", &self.connect_timeout_secs)
            .field("idle_timeout_secs", &self.idle_timeout_secs)
            .field("charset", &self.charset)
            .field("timezone", &self.timezone)
            .finish()
    }
}

impl Drop for MysqlConnectionConfig {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}

// ── Server dialect ──────────────────────────────────────────────────

/// Which server flavour a session is talking to. Detected from
/// `SELECT VERSION()` after connect.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ServerDialect {
    #[default]
    MySql,
    MariaDb,
}

impl ServerDialect {
    /// Parse a `VERSION()` string. Anything mentioning MariaDB (any case) is
    /// MariaDB; everything else — including unparseable input — is MySQL.
    pub fn detect(version: &str) -> Self {
        if version.to_ascii_lowercase().contains("mariadb") {
            Self::MariaDb
        } else {
            Self::MySql
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::MySql => "MySQL",
            Self::MariaDb => "MariaDB",
        }
    }
}

impl fmt::Display for ServerDialect {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

/// Result of `mysql_server_info`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerInfo {
    pub dialect: ServerDialect,
    pub server_version: Option<String>,
    /// Whether the live connection actually negotiated TLS
    /// (`Ssl_cipher` non-empty), not merely whether it was requested.
    pub tls_enabled: bool,
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
    #[serde(default)]
    pub dialect: ServerDialect,
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
    fn config_display_url_is_redacted() {
        let cfg =
            MysqlConnectionConfig::new("db.example.com", 3306, "user", "pw").with_database("mydb");
        assert_eq!(cfg.display_url(), "mysql://user@db.example.com:3306/mydb");
    }

    const HOSTILE_PASSWORD: &str = "p@ss:w/ord%23#x";
    const HOSTILE_USER: &str = "us@er:name";

    fn hostile_config() -> MysqlConnectionConfig {
        MysqlConnectionConfig::new("db.host", 3306, HOSTILE_USER, HOSTILE_PASSWORD)
            .with_database("mydb")
            .with_ssh_tunnel(SshTunnelConfig {
                enabled: false,
                ssh_host: "bastion".into(),
                ssh_port: 22,
                ssh_username: "ops".into(),
                ssh_password: Some("ssh-secret".into()),
                ssh_private_key: Some("-----BEGIN KEY-----\nkey-secret".into()),
                ssh_passphrase: Some("phrase-secret".into()),
            })
    }

    #[test]
    fn connect_options_carry_raw_credentials_without_encoding() {
        let cfg = hostile_config();
        let opts = cfg.connect_options();
        // sqlx keeps the raw values; nothing was URL-encoded or truncated.
        assert_eq!(opts.get_username(), HOSTILE_USER);
        assert_eq!(opts.get_host(), "db.host");
        assert_eq!(opts.get_port(), 3306);
        assert_eq!(opts.get_database(), Some("mydb"));
        assert_eq!(opts.get_charset(), "utf8mb4");
    }

    #[test]
    fn secrets_never_appear_in_debug_or_display_strings() {
        let cfg = hostile_config();
        let rendered = format!("{:?} {}", cfg, cfg.display_url());
        for secret in [
            HOSTILE_PASSWORD,
            "ssh-secret",
            "key-secret",
            "phrase-secret",
        ] {
            assert!(
                !rendered.contains(secret),
                "secret {secret:?} leaked into: {rendered}"
            );
        }
        assert!(rendered.contains("[redacted]"));
        // The display URL is structurally safe even with `@ : /` in the user.
        let url = cfg.display_url();
        assert_eq!(url.matches('@').count(), 1);
        assert!(url.ends_with("@db.host:3306/mydb"));
    }

    #[test]
    fn tls_plan_none_is_preferred() {
        let cfg = MysqlConnectionConfig::new("h", 3306, "u", "p");
        let plan = cfg.tls_plan();
        assert_eq!(plan.mode, TlsMode::Preferred);
        assert!(plan.ca.is_none());
        assert_eq!(
            TlsMode::from(cfg.connect_options().get_ssl_mode()),
            TlsMode::Preferred
        );
    }

    #[test]
    fn tls_plan_disabled() {
        let cfg = MysqlConnectionConfig::new("h", 3306, "u", "p").with_tls(TlsConfig {
            enabled: false,
            ca_cert: Some("/ignored/ca.pem".into()),
            ..TlsConfig::default()
        });
        let plan = cfg.tls_plan();
        assert_eq!(plan.mode, TlsMode::Disabled);
        assert!(plan.ca.is_none(), "material is dropped when TLS is off");
        assert_eq!(
            TlsMode::from(cfg.connect_options().get_ssl_mode()),
            TlsMode::Disabled
        );
    }

    #[test]
    fn tls_plan_required_when_skip_verify() {
        let cfg = MysqlConnectionConfig::new("h", 3306, "u", "p").with_tls(TlsConfig {
            enabled: true,
            skip_verify: true,
            verify_hostname: true, // ignored: skip_verify wins
            ..TlsConfig::default()
        });
        assert_eq!(cfg.tls_plan().mode, TlsMode::Required);
        assert_eq!(
            TlsMode::from(cfg.connect_options().get_ssl_mode()),
            TlsMode::Required
        );
    }

    #[test]
    fn tls_plan_verify_ca_with_path_material() {
        let cfg = MysqlConnectionConfig::new("h", 3306, "u", "p").with_tls(TlsConfig {
            enabled: true,
            ca_cert: Some("/etc/ssl/ca.pem".into()),
            client_cert: Some("/etc/ssl/client.crt".into()),
            client_key: Some(" /etc/ssl/client.key ".into()),
            ..TlsConfig::default()
        });
        let plan = cfg.tls_plan();
        assert_eq!(plan.mode, TlsMode::VerifyCa);
        assert_eq!(plan.ca, Some(TlsMaterial::Path("/etc/ssl/ca.pem".into())));
        assert_eq!(
            plan.client_cert,
            Some(TlsMaterial::Path("/etc/ssl/client.crt".into()))
        );
        assert_eq!(
            plan.client_key,
            Some(TlsMaterial::Path("/etc/ssl/client.key".into()))
        );
        assert_eq!(
            TlsMode::from(cfg.connect_options().get_ssl_mode()),
            TlsMode::VerifyCa
        );
    }

    #[test]
    fn tls_plan_verify_identity_with_inline_pem() {
        let pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
        let cfg = MysqlConnectionConfig::new("h", 3306, "u", "p").with_tls(TlsConfig {
            enabled: true,
            verify_hostname: true,
            ca_cert: Some(pem.into()),
            client_cert: Some("".into()), // empty → no material
            ..TlsConfig::default()
        });
        let plan = cfg.tls_plan();
        assert_eq!(plan.mode, TlsMode::VerifyIdentity);
        assert_eq!(plan.ca, Some(TlsMaterial::Pem(pem.into())));
        assert!(plan.client_cert.is_none());
        assert_eq!(
            TlsMode::from(cfg.connect_options().get_ssl_mode()),
            TlsMode::VerifyIdentity
        );
    }

    #[test]
    fn tls_plan_verify_ca_without_material_still_verifies() {
        // Corresponds to the UI's "verify-ca" mode without a CA file: the
        // driver falls back to its bundled roots and will reject a self-signed
        // server certificate instead of silently downgrading.
        let cfg = MysqlConnectionConfig::new("h", 3306, "u", "p").with_tls(TlsConfig {
            enabled: true,
            ..TlsConfig::default()
        });
        let plan = cfg.tls_plan();
        assert_eq!(plan.mode, TlsMode::VerifyCa);
        assert!(plan.ca.is_none());
    }

    #[test]
    fn caching_sha2_password_needs_no_tls_knob() {
        // MySQL 8 defaults to caching_sha2_password; sqlx negotiates it over
        // a plaintext channel via RSA public-key exchange, so `Disabled` must
        // remain a legal, unmodified configuration (proved live by
        // tests/mysql_live.rs).
        let cfg = MysqlConnectionConfig::new("h", 3306, "u", "p").with_tls(TlsConfig {
            enabled: false,
            ..TlsConfig::default()
        });
        assert_eq!(
            TlsMode::from(cfg.connect_options().get_ssl_mode()),
            TlsMode::Disabled
        );
    }

    #[test]
    fn tls_config_deserialises_with_missing_fields() {
        let tls: TlsConfig = serde_json::from_str(r#"{"enabled":true}"#).unwrap();
        assert!(tls.enabled);
        assert!(!tls.skip_verify);
        assert!(!tls.verify_hostname);
        assert!(tls.ca_cert.is_none());
    }

    #[test]
    fn requests_ssh_tunnel_only_when_enabled() {
        let mut cfg = hostile_config();
        assert!(!cfg.requests_ssh_tunnel());
        if let Some(t) = cfg.ssh_tunnel.as_mut() {
            t.enabled = true;
        }
        assert!(cfg.requests_ssh_tunnel());
        cfg.ssh_tunnel = None;
        assert!(!cfg.requests_ssh_tunnel());
    }

    #[test]
    fn dialect_detection() {
        assert_eq!(ServerDialect::detect("8.0.36"), ServerDialect::MySql);
        assert_eq!(ServerDialect::detect("5.7.44"), ServerDialect::MySql);
        assert_eq!(ServerDialect::detect("8.4.0-log"), ServerDialect::MySql);
        assert_eq!(
            ServerDialect::detect("11.4.2-MariaDB-ubu2404"),
            ServerDialect::MariaDb
        );
        assert_eq!(
            ServerDialect::detect("10.6.18-MariaDB-log"),
            ServerDialect::MariaDb
        );
        assert_eq!(
            ServerDialect::detect("5.5.5-10.11.6-mariadb-1:10.11.6+maria~ubu2204"),
            ServerDialect::MariaDb
        );
        assert_eq!(ServerDialect::detect(""), ServerDialect::MySql);
        assert_eq!(ServerDialect::MariaDb.to_string(), "MariaDB");
    }

    #[test]
    fn dialect_and_server_info_serde() {
        assert_eq!(
            serde_json::to_string(&ServerDialect::MariaDb).unwrap(),
            "\"mariadb\""
        );
        assert_eq!(
            serde_json::from_str::<ServerDialect>("\"mysql\"").unwrap(),
            ServerDialect::MySql
        );
        let info = ServerInfo {
            dialect: ServerDialect::MariaDb,
            server_version: Some("11.4.2-MariaDB".into()),
            tls_enabled: true,
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["dialect"], "mariadb");
        assert_eq!(json["server_version"], "11.4.2-MariaDB");
        assert_eq!(json["tls_enabled"], true);
        let back: ServerInfo = serde_json::from_value(json).unwrap();
        assert_eq!(back, info);
    }

    #[test]
    fn session_info_dialect_defaults_when_absent() {
        let json = r#"{"id":"a","host":"h","port":3306,"username":"u","database":null,
            "status":"Connected","server_version":null,"server_charset":null,
            "connected_at":null,"via_ssh_tunnel":false,"tls_enabled":false,
            "queries_executed":0,"total_rows_fetched":0}"#;
        let info: SessionInfo = serde_json::from_str(json).unwrap();
        assert_eq!(info.dialect, ServerDialect::MySql);
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
        assert_eq!(
            ConnectionStatus::Error("fail".into()).to_string(),
            "error: fail"
        );
    }

    #[test]
    fn export_format_from_str() {
        assert_eq!(ExportFormat::from_str_loose("csv"), Some(ExportFormat::Csv));
        assert_eq!(ExportFormat::from_str_loose("SQL"), Some(ExportFormat::Sql));
        assert_eq!(
            ExportFormat::from_str_loose("JSON"),
            Some(ExportFormat::Json)
        );
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
            dialect: ServerDialect::MariaDb,
            server_version: Some("8.0".into()),
            server_charset: None,
            connected_at: None,
            via_ssh_tunnel: false,
            tls_enabled: false,
            queries_executed: 10,
            total_rows_fetched: 500,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"dialect\":\"mariadb\""));
        let back: SessionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, "abc");
        assert_eq!(back.queries_executed, 10);
        assert_eq!(back.dialect, ServerDialect::MariaDb);
    }

    #[test]
    fn database_info_clone() {
        let db = DatabaseInfo {
            name: "test".into(),
            character_set: Some("utf8mb4".into()),
            collation: None,
            table_count: Some(5),
        };
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
        let r = RoutineInfo {
            name: "my_proc".into(),
            routine_type: "PROCEDURE".into(),
            definer: "root@localhost".into(),
            created: None,
            modified: None,
            body: Some("BEGIN END".into()),
        };
        assert_eq!(r.routine_type, "PROCEDURE");
    }

    #[test]
    fn trigger_info() {
        let t = TriggerInfo {
            name: "before_insert".into(),
            event: "INSERT".into(),
            table: "users".into(),
            timing: "BEFORE".into(),
            statement: "SET NEW.created = NOW()".into(),
        };
        assert_eq!(t.timing, "BEFORE");
    }

    #[test]
    fn view_info() {
        let v = ViewInfo {
            name: "active_users".into(),
            definition: Some("SELECT * FROM users WHERE active = 1".into()),
            definer: "root@localhost".into(),
            is_updatable: true,
        };
        assert!(v.is_updatable);
    }
}
