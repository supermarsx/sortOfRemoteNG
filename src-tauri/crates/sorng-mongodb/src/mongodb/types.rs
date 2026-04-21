//! Types for simple MongoDB connection and server management.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MongoErrorKind {
    ConnectionFailed,
    SessionNotFound,
    DatabaseError,
    CommandError,
    InvalidConfig,
    SerializationError,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnelConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TlsConfig {
    pub enabled: bool,
    pub ca_cert_path: Option<String>,
    pub client_cert_path: Option<String>,
    pub client_key_path: Option<String>,
    pub allow_invalid_certificates: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum MongoAuthMechanism {
    #[default]
    ScramSha256,
    ScramSha1,
    X509,
    AwsIam,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoConnectionConfig {
    pub label: Option<String>,
    pub hosts: Vec<String>,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub auth_database: Option<String>,
    pub auth_mechanism: Option<MongoAuthMechanism>,
    pub replica_set: Option<String>,
    pub read_preference: Option<String>,
    pub direct_connection: Option<bool>,
    pub app_name: Option<String>,
    pub connection_string: Option<String>,
    pub connect_timeout_secs: Option<u64>,
    pub server_selection_timeout_secs: Option<u64>,
    pub ssh_tunnel: Option<SshTunnelConfig>,
    pub tls: Option<TlsConfig>,
}

impl MongoConnectionConfig {
    pub fn to_connection_string(&self) -> String {
        if let Some(ref cs) = self.connection_string {
            return cs.clone();
        }

        let userinfo = match (&self.username, &self.password) {
            (Some(u), Some(p)) => format!("{}:{}@", urlencoded(u), urlencoded(p)),
            (Some(u), None) => format!("{}@", urlencoded(u)),
            _ => String::new(),
        };

        let hosts = if self.hosts.is_empty() {
            "localhost:27017".to_string()
        } else {
            self.hosts.join(",")
        };

        let database = self.database.as_deref().unwrap_or("");
        let mut params = Vec::<String>::new();

        if let Some(ref auth_db) = self.auth_database {
            params.push(format!("authSource={auth_db}"));
        }
        if let Some(ref mech) = self.auth_mechanism {
            let mechanism = match mech {
                MongoAuthMechanism::ScramSha256 => "SCRAM-SHA-256",
                MongoAuthMechanism::ScramSha1 => "SCRAM-SHA-1",
                MongoAuthMechanism::X509 => "MONGODB-X509",
                MongoAuthMechanism::AwsIam => "MONGODB-AWS",
                MongoAuthMechanism::None => "",
            };
            if !mechanism.is_empty() {
                params.push(format!("authMechanism={mechanism}"));
            }
        }
        if let Some(ref replica_set) = self.replica_set {
            params.push(format!("replicaSet={replica_set}"));
        }
        if let Some(ref read_preference) = self.read_preference {
            params.push(format!("readPreference={read_preference}"));
        }
        if let Some(true) = self.direct_connection {
            params.push("directConnection=true".to_string());
        }
        if let Some(ref app_name) = self.app_name {
            params.push(format!("appName={app_name}"));
        }
        if let Some(timeout_secs) = self.connect_timeout_secs {
            params.push(format!("connectTimeoutMS={}", timeout_secs * 1000));
        }
        if let Some(timeout_secs) = self.server_selection_timeout_secs {
            params.push(format!("serverSelectionTimeoutMS={}", timeout_secs * 1000));
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

        format!("mongodb://{userinfo}{hosts}/{database}{query}")
    }
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionInfo {
    pub name: String,
    pub collection_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionStats {
    pub namespace: String,
    pub count: i64,
    pub size: i64,
    pub storage_size: i64,
    pub num_indexes: i32,
    pub total_index_size: i64,
    pub capped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoUserInfo {
    pub user: String,
    pub database: String,
    pub roles: Vec<MongoRole>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MongoRole {
    pub role: String,
    pub db: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStatus {
    pub host: String,
    pub version: String,
    pub uptime_secs: f64,
    pub connections: ConnectionStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStats {
    pub current: i32,
    pub available: i32,
    pub total_created: i64,
}

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Error,
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let e = MongoError::new(MongoErrorKind::ConnectionFailed, "cannot connect");
        assert_eq!(e.to_string(), "cannot connect");
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
            hosts: vec![
                "db1.example.com:27017".into(),
                "db2.example.com:27017".into(),
            ],
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
}
