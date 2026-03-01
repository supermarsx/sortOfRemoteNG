//! Types for MongoDB connection management, document operations, and session lifecycle.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Error ───────────────────────────────────────────────────────────

/// Categories of errors that can occur during MongoDB operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MongoErrorKind {
    ConnectionFailed,
    AuthenticationFailed,
    SessionNotFound,
    DatabaseError,
    CollectionNotFound,
    DocumentNotFound,
    IndexError,
    AggregationError,
    SshTunnelError,
    Timeout,
    InvalidConfig,
    SerializationError,
    WriteError,
    BulkWriteError,
    CommandError,
}

/// Structured error for MongoDB operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoError {
    pub kind: MongoErrorKind,
    pub message: String,
    pub details: Option<String>,
}

impl MongoError {
    pub fn new(kind: MongoErrorKind, msg: impl Into<String>) -> Self {
        Self {
            kind,
            message: msg.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }

    pub fn session_not_found(id: &str) -> Self {
        Self::new(
            MongoErrorKind::SessionNotFound,
            format!("MongoDB session not found: {id}"),
        )
    }

    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(MongoErrorKind::ConnectionFailed, msg)
    }
}

impl std::fmt::Display for MongoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for MongoError {}

// ── SSH tunnel config ───────────────────────────────────────────────

/// SSH tunnel configuration for tunnelling to MongoDB through a jump host.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnelConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub passphrase: Option<String>,
}

// ── TLS config ──────────────────────────────────────────────────────

/// TLS/SSL options for MongoDB connections.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConfig {
    pub enabled: bool,
    pub ca_cert_path: Option<String>,
    pub client_cert_path: Option<String>,
    pub client_key_path: Option<String>,
    pub allow_invalid_certificates: bool,
}

impl Default for TlsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            ca_cert_path: None,
            client_cert_path: None,
            client_key_path: None,
            allow_invalid_certificates: false,
        }
    }
}

// ── Auth mechanism ──────────────────────────────────────────────────

/// MongoDB authentication mechanism.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MongoAuthMechanism {
    /// Default SCRAM-SHA-256 / SCRAM-SHA-1
    ScramSha256,
    ScramSha1,
    /// X.509 certificate authentication
    X509,
    /// AWS IAM authentication
    AwsIam,
    /// No authentication
    None,
}

impl Default for MongoAuthMechanism {
    fn default() -> Self {
        Self::ScramSha256
    }
}

// ── Connection config ───────────────────────────────────────────────

/// Full connection configuration for a MongoDB instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoConnectionConfig {
    /// Human-readable label for this connection.
    pub label: Option<String>,

    /// Hosts in the format "host:port". Supports replica sets.
    pub hosts: Vec<String>,

    /// Default database to connect to.
    pub database: Option<String>,

    /// Username for authentication.
    pub username: Option<String>,
    /// Password for authentication.
    pub password: Option<String>,

    /// Authentication database (defaults to "admin").
    pub auth_database: Option<String>,
    /// Authentication mechanism.
    pub auth_mechanism: Option<MongoAuthMechanism>,

    /// Replica set name (if connecting to a replica set).
    pub replica_set: Option<String>,
    /// Read preference for replica sets.
    pub read_preference: Option<String>,

    /// Direct connection to a single mongod (bypasses replica set discovery).
    pub direct_connection: Option<bool>,

    /// Application name advertised to the server.
    pub app_name: Option<String>,

    /// Optional connection string URI. When provided, overrides other fields.
    pub connection_string: Option<String>,

    /// Connection timeout in seconds.
    pub connect_timeout_secs: Option<u64>,
    /// Server selection timeout in seconds.
    pub server_selection_timeout_secs: Option<u64>,

    /// SSH tunnel configuration.
    pub ssh_tunnel: Option<SshTunnelConfig>,

    /// TLS configuration.
    pub tls: Option<TlsConfig>,
}

impl MongoConnectionConfig {
    /// Build a MongoDB connection string URI from the config fields.
    /// If `connection_string` is already set, return it directly.
    pub fn to_connection_string(&self) -> String {
        if let Some(ref cs) = self.connection_string {
            return cs.clone();
        }

        let userinfo = match (&self.username, &self.password) {
            (Some(u), Some(p)) => {
                let ue = urlencoded(u);
                let pe = urlencoded(p);
                format!("{ue}:{pe}@")
            }
            (Some(u), None) => {
                let ue = urlencoded(u);
                format!("{ue}@")
            }
            _ => String::new(),
        };

        let hosts = if self.hosts.is_empty() {
            "localhost:27017".to_string()
        } else {
            self.hosts.join(",")
        };

        let db = self.database.as_deref().unwrap_or("");

        let mut params = Vec::<String>::new();

        if let Some(ref auth_db) = self.auth_database {
            params.push(format!("authSource={auth_db}"));
        }
        if let Some(ref mech) = self.auth_mechanism {
            let m = match mech {
                MongoAuthMechanism::ScramSha256 => "SCRAM-SHA-256",
                MongoAuthMechanism::ScramSha1 => "SCRAM-SHA-1",
                MongoAuthMechanism::X509 => "MONGODB-X509",
                MongoAuthMechanism::AwsIam => "MONGODB-AWS",
                MongoAuthMechanism::None => "",
            };
            if !m.is_empty() {
                params.push(format!("authMechanism={m}"));
            }
        }
        if let Some(ref rs) = self.replica_set {
            params.push(format!("replicaSet={rs}"));
        }
        if let Some(ref rp) = self.read_preference {
            params.push(format!("readPreference={rp}"));
        }
        if let Some(true) = self.direct_connection {
            params.push("directConnection=true".to_string());
        }
        if let Some(ref name) = self.app_name {
            params.push(format!("appName={name}"));
        }
        if let Some(t) = self.connect_timeout_secs {
            params.push(format!("connectTimeoutMS={}", t * 1000));
        }
        if let Some(t) = self.server_selection_timeout_secs {
            params.push(format!("serverSelectionTimeoutMS={}", t * 1000));
        }
        if let Some(ref tls) = self.tls {
            if tls.enabled {
                params.push("tls=true".to_string());
                if tls.allow_invalid_certificates {
                    params.push("tlsAllowInvalidCertificates=true".to_string());
                }
            }
        }

        let query = if params.is_empty() {
            String::new()
        } else {
            format!("?{}", params.join("&"))
        };

        format!("mongodb://{userinfo}{hosts}/{db}{query}")
    }
}

/// Simple percent-encoding for username/password in URI.
fn urlencoded(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            ':' => out.push_str("%3A"),
            '/' => out.push_str("%2F"),
            '@' => out.push_str("%40"),
            '?' => out.push_str("%3F"),
            '#' => out.push_str("%23"),
            '%' => out.push_str("%25"),
            _ => out.push(c),
        }
    }
    out
}

// ── Query / Result types ────────────────────────────────────────────

/// A document result from a query.
pub type Document = serde_json::Value;

/// Result of a find or aggregate operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentResult {
    /// List of documents returned.
    pub documents: Vec<Document>,
    /// Number of documents returned.
    pub count: usize,
}

/// Result of an insert operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsertResult {
    /// Inserted document IDs.
    pub inserted_ids: Vec<String>,
    /// Number of documents inserted.
    pub count: usize,
}

/// Result of an update operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateResult {
    pub matched_count: u64,
    pub modified_count: u64,
    pub upserted_id: Option<String>,
}

/// Result of a delete operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteResult {
    pub deleted_count: u64,
}

// ── Schema / Introspection types ────────────────────────────────────

/// Information about a MongoDB database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub size_on_disk: Option<i64>,
    pub empty: Option<bool>,
}

/// Information about a MongoDB collection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionInfo {
    pub name: String,
    pub collection_type: String,
    pub options: Option<serde_json::Value>,
    pub read_only: bool,
}

/// Detailed collection statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionStats {
    pub namespace: String,
    pub count: i64,
    pub size: i64,
    pub avg_obj_size: Option<f64>,
    pub storage_size: i64,
    pub num_indexes: i32,
    pub total_index_size: i64,
    pub capped: bool,
}

/// Index information for a collection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub keys: serde_json::Value,
    pub unique: bool,
    pub sparse: bool,
    pub ttl: Option<i64>,
    pub partial_filter: Option<serde_json::Value>,
}

/// User information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoUserInfo {
    pub user: String,
    pub database: String,
    pub roles: Vec<MongoRole>,
}

/// A role reference.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoRole {
    pub role: String,
    pub db: String,
}

/// Server status summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStatus {
    pub host: String,
    pub version: String,
    pub uptime_secs: f64,
    pub connections: ConnectionStats,
    pub opcounters: Option<serde_json::Value>,
    pub mem: Option<serde_json::Value>,
    pub extra: serde_json::Value,
}

/// Connection pool statistics from the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStats {
    pub current: i32,
    pub available: i32,
    pub total_created: i64,
}

/// Replica set status member info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplicaSetMember {
    pub name: String,
    pub state_str: String,
    pub state: i32,
    pub health: f64,
    #[serde(rename = "self")]
    pub is_self: Option<bool>,
    pub uptime: Option<i64>,
}

/// Sort direction for queries.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SortDirection {
    Ascending,
    Descending,
}

/// Sort specification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortSpec {
    pub field: String,
    pub direction: SortDirection,
}

/// Find query options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FindOptions {
    pub filter: Option<serde_json::Value>,
    pub projection: Option<serde_json::Value>,
    pub sort: Option<Vec<SortSpec>>,
    pub limit: Option<i64>,
    pub skip: Option<u64>,
}

/// Export format for collections.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExportFormat {
    Json,
    JsonArray,
    Csv,
    Ndjson,
}

/// Export options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportOptions {
    pub format: ExportFormat,
    pub filter: Option<serde_json::Value>,
    pub projection: Option<serde_json::Value>,
    pub limit: Option<i64>,
}

/// Connection status.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Error,
}

/// Session metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub label: String,
    pub hosts: Vec<String>,
    pub database: Option<String>,
    pub status: ConnectionStatus,
    pub connected_at: String,
    pub server_version: Option<String>,
    pub replica_set: Option<String>,
}

/// Row-map for generic key-value results.
pub type RowMap = HashMap<String, serde_json::Value>;

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let e = MongoError::new(MongoErrorKind::ConnectionFailed, "cannot connect");
        assert_eq!(e.to_string(), "cannot connect");
    }

    #[test]
    fn test_error_with_details() {
        let e = MongoError::new(MongoErrorKind::AuthenticationFailed, "bad creds")
            .with_details("SCRAM-SHA-256 failed");
        assert_eq!(e.kind, MongoErrorKind::AuthenticationFailed);
        assert_eq!(e.details.as_deref(), Some("SCRAM-SHA-256 failed"));
    }

    #[test]
    fn test_session_not_found() {
        let e = MongoError::session_not_found("sess-42");
        assert_eq!(e.kind, MongoErrorKind::SessionNotFound);
        assert!(e.message.contains("sess-42"));
    }

    #[test]
    fn test_connection_string_defaults() {
        let cfg = MongoConnectionConfig {
            label: None,
            hosts: vec![],
            database: None,
            username: None,
            password: None,
            auth_database: None,
            auth_mechanism: None,
            replica_set: None,
            read_preference: None,
            direct_connection: None,
            app_name: None,
            connection_string: None,
            connect_timeout_secs: None,
            server_selection_timeout_secs: None,
            ssh_tunnel: None,
            tls: None,
        };
        assert_eq!(cfg.to_connection_string(), "mongodb://localhost:27017/");
    }

    #[test]
    fn test_connection_string_full() {
        let cfg = MongoConnectionConfig {
            label: Some("prod".into()),
            hosts: vec!["db1.example.com:27017".into(), "db2.example.com:27017".into()],
            database: Some("mydb".into()),
            username: Some("admin".into()),
            password: Some("p@ss:word".into()),
            auth_database: Some("admin".into()),
            auth_mechanism: Some(MongoAuthMechanism::ScramSha256),
            replica_set: Some("rs0".into()),
            read_preference: Some("secondaryPreferred".into()),
            direct_connection: None,
            app_name: Some("sortOfRemoteNG".into()),
            connection_string: None,
            connect_timeout_secs: Some(10),
            server_selection_timeout_secs: Some(30),
            ssh_tunnel: None,
            tls: None,
        };
        let cs = cfg.to_connection_string();
        assert!(cs.starts_with("mongodb://admin:p%40ss%3Aword@"));
        assert!(cs.contains("db1.example.com:27017,db2.example.com:27017"));
        assert!(cs.contains("/mydb?"));
        assert!(cs.contains("authSource=admin"));
        assert!(cs.contains("authMechanism=SCRAM-SHA-256"));
        assert!(cs.contains("replicaSet=rs0"));
        assert!(cs.contains("readPreference=secondaryPreferred"));
        assert!(cs.contains("appName=sortOfRemoteNG"));
        assert!(cs.contains("connectTimeoutMS=10000"));
        assert!(cs.contains("serverSelectionTimeoutMS=30000"));
    }

    #[test]
    fn test_connection_string_override() {
        let cfg = MongoConnectionConfig {
            label: None,
            hosts: vec!["ignored:27017".into()],
            database: None,
            username: None,
            password: None,
            auth_database: None,
            auth_mechanism: None,
            replica_set: None,
            read_preference: None,
            direct_connection: None,
            app_name: None,
            connection_string: Some("mongodb+srv://user:pass@cluster.example.com/test".into()),
            connect_timeout_secs: None,
            server_selection_timeout_secs: None,
            ssh_tunnel: None,
            tls: None,
        };
        assert_eq!(
            cfg.to_connection_string(),
            "mongodb+srv://user:pass@cluster.example.com/test"
        );
    }

    #[test]
    fn test_connection_string_with_tls() {
        let cfg = MongoConnectionConfig {
            label: None,
            hosts: vec!["mongo.example.com:27017".into()],
            database: Some("db".into()),
            username: None,
            password: None,
            auth_database: None,
            auth_mechanism: None,
            replica_set: None,
            read_preference: None,
            direct_connection: Some(true),
            app_name: None,
            connection_string: None,
            connect_timeout_secs: None,
            server_selection_timeout_secs: None,
            ssh_tunnel: None,
            tls: Some(TlsConfig {
                enabled: true,
                allow_invalid_certificates: true,
                ..Default::default()
            }),
        };
        let cs = cfg.to_connection_string();
        assert!(cs.contains("directConnection=true"));
        assert!(cs.contains("tls=true"));
        assert!(cs.contains("tlsAllowInvalidCertificates=true"));
    }

    #[test]
    fn test_connection_string_username_only() {
        let cfg = MongoConnectionConfig {
            label: None,
            hosts: vec!["localhost:27017".into()],
            database: None,
            username: Some("user".into()),
            password: None,
            auth_database: None,
            auth_mechanism: Some(MongoAuthMechanism::X509),
            replica_set: None,
            read_preference: None,
            direct_connection: None,
            app_name: None,
            connection_string: None,
            connect_timeout_secs: None,
            server_selection_timeout_secs: None,
            ssh_tunnel: None,
            tls: None,
        };
        let cs = cfg.to_connection_string();
        assert!(cs.starts_with("mongodb://user@"));
        assert!(cs.contains("authMechanism=MONGODB-X509"));
    }

    #[test]
    fn test_urlencoded_special_chars() {
        assert_eq!(urlencoded("a:b/c@d?e#f%g"), "a%3Ab%2Fc%40d%3Fe%23f%25g");
    }

    #[test]
    fn test_auth_mechanism_default() {
        let m: MongoAuthMechanism = Default::default();
        assert_eq!(m, MongoAuthMechanism::ScramSha256);
    }

    #[test]
    fn test_sort_direction() {
        let asc = SortDirection::Ascending;
        let desc = SortDirection::Descending;
        assert_ne!(asc, desc);
    }

    #[test]
    fn test_export_format_variants() {
        assert_ne!(ExportFormat::Json, ExportFormat::Csv);
        assert_ne!(ExportFormat::Ndjson, ExportFormat::JsonArray);
    }

    #[test]
    fn test_document_result_serialize() {
        let dr = DocumentResult {
            documents: vec![serde_json::json!({"a": 1})],
            count: 1,
        };
        let json = serde_json::to_value(&dr).unwrap();
        assert_eq!(json["count"], 1);
        assert!(json["documents"].is_array());
    }

    #[test]
    fn test_insert_result_serialize() {
        let ir = InsertResult {
            inserted_ids: vec!["abc".into()],
            count: 1,
        };
        let json = serde_json::to_value(&ir).unwrap();
        assert_eq!(json["count"], 1);
    }

    #[test]
    fn test_update_result_serialize() {
        let ur = UpdateResult {
            matched_count: 5,
            modified_count: 3,
            upserted_id: None,
        };
        let json = serde_json::to_value(&ur).unwrap();
        assert_eq!(json["matched_count"], 5);
        assert_eq!(json["modified_count"], 3);
    }

    #[test]
    fn test_session_info_serialize() {
        let si = SessionInfo {
            id: "s1".into(),
            label: "test".into(),
            hosts: vec!["localhost:27017".into()],
            database: Some("testdb".into()),
            status: ConnectionStatus::Connected,
            connected_at: "2024-01-01T00:00:00Z".into(),
            server_version: Some("7.0.0".into()),
            replica_set: None,
        };
        let json = serde_json::to_value(&si).unwrap();
        assert_eq!(json["status"], "Connected");
        assert_eq!(json["database"], "testdb");
    }

    #[test]
    fn test_collection_stats_serialize() {
        let cs = CollectionStats {
            namespace: "db.coll".into(),
            count: 1000,
            size: 50000,
            avg_obj_size: Some(50.0),
            storage_size: 40960,
            num_indexes: 3,
            total_index_size: 8192,
            capped: false,
        };
        let json = serde_json::to_value(&cs).unwrap();
        assert_eq!(json["count"], 1000);
        assert!(!json["capped"].as_bool().unwrap());
    }

    #[test]
    fn test_index_info_serialize() {
        let ii = IndexInfo {
            name: "_id_".into(),
            keys: serde_json::json!({"_id": 1}),
            unique: true,
            sparse: false,
            ttl: None,
            partial_filter: None,
        };
        let json = serde_json::to_value(&ii).unwrap();
        assert_eq!(json["name"], "_id_");
        assert!(json["unique"].as_bool().unwrap());
    }
}
