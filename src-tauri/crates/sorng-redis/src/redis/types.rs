//! Types for Redis connection management, key-value operations, and session lifecycle.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Error ───────────────────────────────────────────────────────────

/// Categories of errors that can occur during Redis operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RedisErrorKind {
    ConnectionFailed,
    AuthenticationFailed,
    SessionNotFound,
    CommandError,
    KeyNotFound,
    TypeError,
    SshTunnelError,
    Timeout,
    InvalidConfig,
    SerializationError,
    ScriptError,
    ClusterError,
}

/// Structured error for Redis operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisError {
    pub kind: RedisErrorKind,
    pub message: String,
    pub details: Option<String>,
}

impl RedisError {
    pub fn new(kind: RedisErrorKind, msg: impl Into<String>) -> Self {
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
            RedisErrorKind::SessionNotFound,
            format!("Redis session not found: {id}"),
        )
    }

    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(RedisErrorKind::ConnectionFailed, msg)
    }
}

impl std::fmt::Display for RedisError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for RedisError {}

// ── SSH tunnel config ───────────────────────────────────────────────

/// SSH tunnel configuration for reaching Redis through a jump host.
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

/// TLS/SSL options for Redis connections.
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

// ── Connection config ───────────────────────────────────────────────

/// Full connection configuration for a Redis instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisConnectionConfig {
    /// Human-readable label for this connection.
    pub label: Option<String>,

    /// Redis server hostname.
    pub host: String,
    /// Redis server port (default: 6379).
    pub port: u16,

    /// Password for AUTH command.
    pub password: Option<String>,
    /// Username for ACL-based auth (Redis 6+).
    pub username: Option<String>,

    /// Default database index (0-15).
    pub database: Option<u8>,

    /// Optional connection URL. When provided, overrides other fields.
    /// e.g., redis://user:pass@host:6379/0
    pub connection_url: Option<String>,

    /// Connection timeout in seconds.
    pub connect_timeout_secs: Option<u64>,

    /// Whether this is a Redis Sentinel connection.
    pub sentinel: Option<SentinelConfig>,

    /// Whether this is a Redis Cluster connection.
    pub cluster: Option<ClusterConfig>,

    /// SSH tunnel configuration.
    pub ssh_tunnel: Option<SshTunnelConfig>,

    /// TLS configuration.
    pub tls: Option<TlsConfig>,
}

impl RedisConnectionConfig {
    /// Build a Redis connection URL from the config fields.
    pub fn to_url(&self) -> String {
        if let Some(ref url) = self.connection_url {
            return url.clone();
        }

        let scheme = if self
            .tls
            .as_ref()
            .map(|t| t.enabled)
            .unwrap_or(false)
        {
            "rediss"
        } else {
            "redis"
        };

        let userinfo = match (&self.username, &self.password) {
            (Some(u), Some(p)) => format!("{}:{}@", u, p),
            (None, Some(p)) => format!(":{}@", p),
            (Some(u), None) => format!("{}@", u),
            _ => String::new(),
        };

        let db = self.database.unwrap_or(0);

        format!("{}://{}{}:{}/{}", scheme, userinfo, self.host, self.port, db)
    }
}

/// Sentinel configuration for high-availability setups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentinelConfig {
    pub master_name: String,
    pub sentinels: Vec<String>,
    pub password: Option<String>,
}

/// Cluster configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterConfig {
    pub nodes: Vec<String>,
    pub read_from_replicas: bool,
}

// ── Key types ───────────────────────────────────────────────────────

/// Redis key type classification.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RedisKeyType {
    String,
    List,
    Set,
    ZSet,
    Hash,
    Stream,
    Unknown,
}

impl From<&str> for RedisKeyType {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "string" => Self::String,
            "list" => Self::List,
            "set" => Self::Set,
            "zset" => Self::ZSet,
            "hash" => Self::Hash,
            "stream" => Self::Stream,
            _ => Self::Unknown,
        }
    }
}

/// Information about a Redis key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyInfo {
    pub key: String,
    pub key_type: RedisKeyType,
    pub ttl: i64,
    pub size: Option<i64>,
    pub encoding: Option<String>,
}

/// Scan result for iterating keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub cursor: u64,
    pub keys: Vec<String>,
}

/// A Redis value that can hold different types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum RedisValue {
    String(String),
    Integer(i64),
    Float(f64),
    List(Vec<String>),
    Set(Vec<String>),
    ZSet(Vec<ZSetMember>),
    Hash(HashMap<String, String>),
    Nil,
    Array(Vec<String>),
}

/// A member of a sorted set with its score.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZSetMember {
    pub member: String,
    pub score: f64,
}

// ── Server info types ───────────────────────────────────────────────

/// Parsed INFO section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub sections: HashMap<String, HashMap<String, String>>,
}

/// A connected Redis client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    pub id: String,
    pub addr: String,
    pub name: Option<String>,
    pub age: Option<i64>,
    pub idle: Option<i64>,
    pub db: Option<i32>,
    pub cmd: Option<String>,
    pub flags: Option<String>,
}

/// Slow log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlowLogEntry {
    pub id: i64,
    pub timestamp: i64,
    pub duration_us: i64,
    pub command: Vec<String>,
    pub client_addr: Option<String>,
    pub client_name: Option<String>,
}

/// Memory usage report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryInfo {
    pub used_memory: i64,
    pub used_memory_human: String,
    pub used_memory_peak: i64,
    pub used_memory_peak_human: String,
    pub used_memory_rss: i64,
    pub maxmemory: i64,
    pub maxmemory_human: String,
    pub maxmemory_policy: String,
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
    pub host: String,
    pub port: u16,
    pub database: u8,
    pub status: ConnectionStatus,
    pub connected_at: String,
    pub server_version: Option<String>,
    pub role: Option<String>,
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let e = RedisError::new(RedisErrorKind::ConnectionFailed, "cannot connect");
        assert_eq!(e.to_string(), "cannot connect");
    }

    #[test]
    fn test_error_with_details() {
        let e = RedisError::new(RedisErrorKind::AuthenticationFailed, "NOAUTH")
            .with_details("password required");
        assert_eq!(e.kind, RedisErrorKind::AuthenticationFailed);
        assert_eq!(e.details.as_deref(), Some("password required"));
    }

    #[test]
    fn test_session_not_found() {
        let e = RedisError::session_not_found("sess-99");
        assert_eq!(e.kind, RedisErrorKind::SessionNotFound);
        assert!(e.message.contains("sess-99"));
    }

    #[test]
    fn test_url_basic() {
        let cfg = RedisConnectionConfig {
            label: None,
            host: "localhost".into(),
            port: 6379,
            password: None,
            username: None,
            database: None,
            connection_url: None,
            connect_timeout_secs: None,
            sentinel: None,
            cluster: None,
            ssh_tunnel: None,
            tls: None,
        };
        assert_eq!(cfg.to_url(), "redis://localhost:6379/0");
    }

    #[test]
    fn test_url_with_auth() {
        let cfg = RedisConnectionConfig {
            label: None,
            host: "redis.example.com".into(),
            port: 6380,
            password: Some("secret".into()),
            username: Some("default".into()),
            database: Some(3),
            connection_url: None,
            connect_timeout_secs: None,
            sentinel: None,
            cluster: None,
            ssh_tunnel: None,
            tls: None,
        };
        assert_eq!(
            cfg.to_url(),
            "redis://default:secret@redis.example.com:6380/3"
        );
    }

    #[test]
    fn test_url_password_only() {
        let cfg = RedisConnectionConfig {
            label: None,
            host: "localhost".into(),
            port: 6379,
            password: Some("pass".into()),
            username: None,
            database: Some(1),
            connection_url: None,
            connect_timeout_secs: None,
            sentinel: None,
            cluster: None,
            ssh_tunnel: None,
            tls: None,
        };
        assert_eq!(cfg.to_url(), "redis://:pass@localhost:6379/1");
    }

    #[test]
    fn test_url_with_tls() {
        let cfg = RedisConnectionConfig {
            label: None,
            host: "redis.example.com".into(),
            port: 6380,
            password: None,
            username: None,
            database: None,
            connection_url: None,
            connect_timeout_secs: None,
            sentinel: None,
            cluster: None,
            ssh_tunnel: None,
            tls: Some(TlsConfig {
                enabled: true,
                ..Default::default()
            }),
        };
        assert!(cfg.to_url().starts_with("rediss://"));
    }

    #[test]
    fn test_url_override() {
        let cfg = RedisConnectionConfig {
            label: None,
            host: "ignored".into(),
            port: 6379,
            password: None,
            username: None,
            database: None,
            connection_url: Some("redis://custom:1234/5".into()),
            connect_timeout_secs: None,
            sentinel: None,
            cluster: None,
            ssh_tunnel: None,
            tls: None,
        };
        assert_eq!(cfg.to_url(), "redis://custom:1234/5");
    }

    #[test]
    fn test_key_type_from_str() {
        assert_eq!(RedisKeyType::from("string"), RedisKeyType::String);
        assert_eq!(RedisKeyType::from("list"), RedisKeyType::List);
        assert_eq!(RedisKeyType::from("set"), RedisKeyType::Set);
        assert_eq!(RedisKeyType::from("zset"), RedisKeyType::ZSet);
        assert_eq!(RedisKeyType::from("hash"), RedisKeyType::Hash);
        assert_eq!(RedisKeyType::from("stream"), RedisKeyType::Stream);
        assert_eq!(RedisKeyType::from("nonsense"), RedisKeyType::Unknown);
    }

    #[test]
    fn test_redis_value_nil() {
        let v = RedisValue::Nil;
        let json = serde_json::to_value(&v).unwrap();
        assert_eq!(json["type"], "Nil");
    }

    #[test]
    fn test_redis_value_string() {
        let v = RedisValue::String("hello".into());
        let json = serde_json::to_value(&v).unwrap();
        assert_eq!(json["type"], "String");
        assert_eq!(json["value"], "hello");
    }

    #[test]
    fn test_redis_value_hash() {
        let mut map = HashMap::new();
        map.insert("field1".into(), "val1".into());
        let v = RedisValue::Hash(map);
        let json = serde_json::to_value(&v).unwrap();
        assert_eq!(json["type"], "Hash");
    }

    #[test]
    fn test_zset_member() {
        let m = ZSetMember {
            member: "alice".into(),
            score: 99.5,
        };
        let json = serde_json::to_value(&m).unwrap();
        assert_eq!(json["member"], "alice");
        assert_eq!(json["score"], 99.5);
    }

    #[test]
    fn test_session_info_serialize() {
        let si = SessionInfo {
            id: "s1".into(),
            label: "dev".into(),
            host: "localhost".into(),
            port: 6379,
            database: 0,
            status: ConnectionStatus::Connected,
            connected_at: "2024-01-01T00:00:00Z".into(),
            server_version: Some("7.2.0".into()),
            role: Some("master".into()),
        };
        let json = serde_json::to_value(&si).unwrap();
        assert_eq!(json["status"], "Connected");
        assert_eq!(json["port"], 6379);
    }

    #[test]
    fn test_slow_log_entry_serialize() {
        let entry = SlowLogEntry {
            id: 1,
            timestamp: 1700000000,
            duration_us: 50000,
            command: vec!["GET".into(), "mykey".into()],
            client_addr: Some("127.0.0.1:12345".into()),
            client_name: None,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["duration_us"], 50000);
    }

    #[test]
    fn test_memory_info_serialize() {
        let mi = MemoryInfo {
            used_memory: 1048576,
            used_memory_human: "1.00M".into(),
            used_memory_peak: 2097152,
            used_memory_peak_human: "2.00M".into(),
            used_memory_rss: 3145728,
            maxmemory: 0,
            maxmemory_human: "0B".into(),
            maxmemory_policy: "noeviction".into(),
        };
        let json = serde_json::to_value(&mi).unwrap();
        assert_eq!(json["used_memory"], 1048576);
    }

    #[test]
    fn test_scan_result() {
        let sr = ScanResult {
            cursor: 42,
            keys: vec!["key1".into(), "key2".into()],
        };
        let json = serde_json::to_value(&sr).unwrap();
        assert_eq!(json["cursor"], 42);
        assert_eq!(json["keys"].as_array().unwrap().len(), 2);
    }
}
