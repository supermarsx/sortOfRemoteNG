//! Comprehensive data types for Redis connection management, key-value
//! operations, data structure commands, server admin, cluster, sentinel,
//! replication, streams, and pub/sub.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Connection & Session
// ---------------------------------------------------------------------------

/// Full connection configuration for a Redis instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisConnectionConfig {
    /// Redis server hostname.
    pub host: String,
    /// Redis server port (default 6379).
    #[serde(default = "default_port")]
    pub port: u16,
    /// Password for AUTH command.
    #[serde(default)]
    pub password: Option<String>,
    /// Username for ACL-based auth (Redis 6+).
    #[serde(default)]
    pub username: Option<String>,
    /// Default database index.
    #[serde(default)]
    pub db: u8,
    /// Whether to use TLS (`rediss://`).
    #[serde(default)]
    pub use_tls: bool,
    /// Connection / command timeout in seconds.
    #[serde(default = "default_timeout")]
    pub timeout: u64,
    /// Human-readable label for this connection.
    #[serde(default)]
    pub label: Option<String>,
    /// Full connection URL — when set, overrides individual fields.
    #[serde(default)]
    pub connection_url: Option<String>,
    /// Enable Redis Cluster mode.
    #[serde(default)]
    pub cluster_mode: Option<RedisClusterConfig>,
    /// Redis Sentinel configuration.
    #[serde(default)]
    pub sentinel: Option<RedisSentinelConfig>,
    /// SSH tunnel configuration.
    #[serde(default)]
    pub ssh_tunnel: Option<SshTunnelConfig>,
    /// Detailed TLS parameters.
    #[serde(default)]
    pub tls_config: Option<RedisTlsConfig>,
}

fn default_port() -> u16 {
    6379
}
fn default_timeout() -> u64 {
    30
}

impl RedisConnectionConfig {
    /// Build a `redis://` or `rediss://` URL from the individual fields.
    pub fn to_url(&self) -> String {
        if let Some(ref url) = self.connection_url {
            return url.clone();
        }
        let scheme = if self.use_tls { "rediss" } else { "redis" };
        let userinfo = match (&self.username, &self.password) {
            (Some(u), Some(p)) => format!("{}:{}@", u, p),
            (None, Some(p)) => format!(":{}@", p),
            (Some(u), None) => format!("{}@", u),
            _ => String::new(),
        };
        format!(
            "{}://{}{}:{}/{}",
            scheme, userinfo, self.host, self.port, self.db
        )
    }
}

/// SSH tunnel configuration for reaching Redis through a jump host.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelConfig {
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
}

fn default_ssh_port() -> u16 {
    22
}

/// TLS / SSL options for Redis connections.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisTlsConfig {
    #[serde(default)]
    pub ca_cert_path: Option<String>,
    #[serde(default)]
    pub client_cert_path: Option<String>,
    #[serde(default)]
    pub client_key_path: Option<String>,
    #[serde(default)]
    pub allow_invalid_certificates: bool,
}

/// Redis Cluster configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisClusterConfig {
    pub nodes: Vec<String>,
    #[serde(default)]
    pub read_from_replicas: bool,
}

/// Redis Sentinel configuration for HA setups.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisSentinelConfig {
    pub master_name: String,
    pub sentinels: Vec<String>,
    #[serde(default)]
    pub password: Option<String>,
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/// An active Redis session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisSession {
    /// Unique session identifier.
    pub id: String,
    /// The configuration used to create this session.
    pub config: RedisConnectionConfig,
    /// When the session was established.
    pub connected_at: DateTime<Utc>,
    /// Server information retrieved at connect time.
    pub server_info: Option<RedisServerInfo>,
}

// ---------------------------------------------------------------------------
// Server Info
// ---------------------------------------------------------------------------

/// Parsed server information from the Redis INFO command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisServerInfo {
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub tcp_port: Option<u16>,
    #[serde(default)]
    pub uptime_in_seconds: Option<u64>,
    #[serde(default)]
    pub uptime_in_days: Option<u64>,
    #[serde(default)]
    pub connected_clients: Option<u64>,
    #[serde(default)]
    pub blocked_clients: Option<u64>,
    #[serde(default)]
    pub used_memory: Option<u64>,
    #[serde(default)]
    pub used_memory_human: Option<String>,
    #[serde(default)]
    pub used_memory_peak: Option<u64>,
    #[serde(default)]
    pub used_memory_peak_human: Option<String>,
    #[serde(default)]
    pub total_connections_received: Option<u64>,
    #[serde(default)]
    pub total_commands_processed: Option<u64>,
    #[serde(default)]
    pub instantaneous_ops_per_sec: Option<u64>,
    #[serde(default)]
    pub keyspace_hits: Option<u64>,
    #[serde(default)]
    pub keyspace_misses: Option<u64>,
    #[serde(default)]
    pub role: Option<String>,
    /// Raw key-value pairs per INFO section.
    #[serde(default)]
    pub sections: HashMap<String, HashMap<String, String>>,
}

// ---------------------------------------------------------------------------
// Key Types
// ---------------------------------------------------------------------------

/// Redis key type classification.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
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

/// Metadata about a single key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyInfo {
    pub key: String,
    pub key_type: RedisKeyType,
    /// TTL in seconds (-1 = no expiry, -2 = key does not exist).
    pub ttl: i64,
    /// Approximate memory usage in bytes (Redis 4.0+ MEMORY USAGE).
    #[serde(default)]
    pub size: Option<i64>,
    /// Internal encoding (OBJECT ENCODING).
    #[serde(default)]
    pub encoding: Option<String>,
}

/// A Redis value that can hold different data types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum RedisKeyValue {
    String(String),
    List(Vec<String>),
    Set(Vec<String>),
    SortedSet(Vec<ZSetMember>),
    Hash(HashMap<String, String>),
    Stream(Vec<RedisStreamEntry>),
    None,
}

/// Result of a SCAN iteration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisScanResult {
    pub cursor: u64,
    pub keys: Vec<String>,
}

// ---------------------------------------------------------------------------
// Sorted-set helpers
// ---------------------------------------------------------------------------

/// A member of a sorted set with its score.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZSetMember {
    pub member: String,
    pub score: f64,
}

// ---------------------------------------------------------------------------
// Slow Log
// ---------------------------------------------------------------------------

/// A single slow-log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisSlowLogEntry {
    pub id: i64,
    pub timestamp: i64,
    pub duration_us: i64,
    pub command: Vec<String>,
    #[serde(default)]
    pub client_addr: Option<String>,
    #[serde(default)]
    pub client_name: Option<String>,
}

// ---------------------------------------------------------------------------
// Client Info
// ---------------------------------------------------------------------------

/// Information about a connected Redis client (CLIENT LIST).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisClientInfo {
    pub id: String,
    pub addr: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub db: Option<i32>,
    #[serde(default)]
    pub cmd: Option<String>,
    #[serde(default)]
    pub age: Option<i64>,
    #[serde(default)]
    pub idle: Option<i64>,
    #[serde(default)]
    pub flags: Option<String>,
}

// ---------------------------------------------------------------------------
// Cluster
// ---------------------------------------------------------------------------

/// A node in a Redis Cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisClusterNode {
    pub id: String,
    pub addr: String,
    pub flags: String,
    #[serde(default)]
    pub master: Option<String>,
    #[serde(default)]
    pub slots: Vec<String>,
    pub connected: bool,
    #[serde(default)]
    pub ping_sent: Option<u64>,
    #[serde(default)]
    pub pong_recv: Option<u64>,
    #[serde(default)]
    pub config_epoch: Option<u64>,
    #[serde(default)]
    pub link_state: Option<String>,
}

/// Summary of CLUSTER INFO.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisClusterInfo {
    pub cluster_enabled: bool,
    pub cluster_state: String,
    pub cluster_slots_assigned: u64,
    pub cluster_slots_ok: u64,
    pub cluster_slots_pfail: u64,
    pub cluster_slots_fail: u64,
    pub cluster_known_nodes: u64,
    pub cluster_size: u64,
    pub cluster_current_epoch: u64,
    pub cluster_my_epoch: u64,
    #[serde(default)]
    pub raw: HashMap<String, String>,
}

// ---------------------------------------------------------------------------
// Sentinel
// ---------------------------------------------------------------------------

/// Summary returned by SENTINEL operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisSentinelMaster {
    pub name: String,
    pub ip: String,
    pub port: u16,
    #[serde(default)]
    pub runid: Option<String>,
    pub flags: String,
    #[serde(default)]
    pub num_slaves: Option<u64>,
    #[serde(default)]
    pub num_other_sentinels: Option<u64>,
    #[serde(default)]
    pub quorum: Option<u64>,
    #[serde(default)]
    pub raw: HashMap<String, String>,
}

/// Info about a sentinel instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisSentinelInfo {
    pub masters: Vec<RedisSentinelMaster>,
    pub sentinels: u64,
    pub quorum: u64,
}

/// Info about a sentinel slave / replica.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisSentinelSlave {
    pub ip: String,
    pub port: u16,
    pub flags: String,
    #[serde(default)]
    pub master_host: Option<String>,
    #[serde(default)]
    pub master_port: Option<u16>,
    #[serde(default)]
    pub raw: HashMap<String, String>,
}

// ---------------------------------------------------------------------------
// Replication
// ---------------------------------------------------------------------------

/// Parsed replication information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisReplicationInfo {
    pub role: String,
    #[serde(default)]
    pub connected_slaves: Option<u64>,
    #[serde(default)]
    pub master_host: Option<String>,
    #[serde(default)]
    pub master_port: Option<u16>,
    #[serde(default)]
    pub master_link_status: Option<String>,
    #[serde(default)]
    pub master_last_io_seconds_ago: Option<i64>,
    #[serde(default)]
    pub master_sync_in_progress: Option<bool>,
    #[serde(default)]
    pub repl_backlog_active: Option<bool>,
    #[serde(default)]
    pub repl_backlog_size: Option<u64>,
    #[serde(default)]
    pub slaves: Vec<RedisReplicaSummary>,
    #[serde(default)]
    pub raw: HashMap<String, String>,
}

/// Summary of a single slave / replica from INFO replication.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisReplicaSummary {
    pub ip: String,
    pub port: u16,
    pub state: String,
    #[serde(default)]
    pub offset: Option<u64>,
    #[serde(default)]
    pub lag: Option<u64>,
}

// ---------------------------------------------------------------------------
// Memory Stats
// ---------------------------------------------------------------------------

/// Detailed memory statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisMemoryStats {
    pub used_memory: i64,
    pub used_memory_human: String,
    pub used_memory_peak: i64,
    pub used_memory_peak_human: String,
    pub used_memory_rss: i64,
    #[serde(default)]
    pub used_memory_rss_human: Option<String>,
    pub maxmemory: i64,
    pub maxmemory_human: String,
    pub maxmemory_policy: String,
    #[serde(default)]
    pub mem_fragmentation_ratio: Option<f64>,
    #[serde(default)]
    pub mem_allocator: Option<String>,
    #[serde(default)]
    pub total_system_memory: Option<i64>,
    #[serde(default)]
    pub total_system_memory_human: Option<String>,
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

/// Info about a Redis stream (XINFO STREAM).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisStreamInfo {
    pub length: u64,
    pub radix_tree_keys: u64,
    pub radix_tree_nodes: u64,
    pub groups: u64,
    #[serde(default)]
    pub last_generated_id: Option<String>,
    #[serde(default)]
    pub first_entry: Option<RedisStreamEntry>,
    #[serde(default)]
    pub last_entry: Option<RedisStreamEntry>,
}

/// A single stream entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisStreamEntry {
    pub id: String,
    pub fields: HashMap<String, String>,
}

/// A consumer group on a stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisConsumerGroup {
    pub name: String,
    pub consumers: u64,
    pub pending: u64,
    pub last_delivered_id: String,
}

/// A consumer within a consumer group.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisStreamConsumer {
    pub name: String,
    pub pending: u64,
    pub idle: u64,
}

/// A pending message summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisPendingEntry {
    pub id: String,
    pub consumer: String,
    pub idle_ms: u64,
    pub delivery_count: u64,
}

// ---------------------------------------------------------------------------
// Pub/Sub
// ---------------------------------------------------------------------------

/// A pub/sub channel with subscriber count.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisPubSubChannel {
    pub channel: String,
    pub subscribers: u64,
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

/// A loaded Redis module.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisModuleInfo {
    pub name: String,
    #[serde(default)]
    pub version: Option<u64>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
}

// ---------------------------------------------------------------------------
// Keyspace
// ---------------------------------------------------------------------------

/// Per-database keyspace stats from INFO keyspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyspaceInfo {
    pub db: u32,
    pub keys: u64,
    pub expires: u64,
    #[serde(default)]
    pub avg_ttl: Option<u64>,
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/// A single CONFIG parameter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisConfigParam {
    pub key: String,
    pub value: String,
}

// ---------------------------------------------------------------------------
// Command Stats
// ---------------------------------------------------------------------------

/// Execution statistics for a single Redis command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisCommandStats {
    pub name: String,
    pub calls: u64,
    pub usec: u64,
    pub usec_per_call: f64,
    #[serde(default)]
    pub rejected_calls: Option<u64>,
    #[serde(default)]
    pub failed_calls: Option<u64>,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_basic() {
        let c = RedisConnectionConfig {
            host: "localhost".into(),
            port: 6379,
            password: None,
            username: None,
            db: 0,
            use_tls: false,
            timeout: 30,
            label: None,
            connection_url: None,
            cluster_mode: None,
            sentinel: None,
            ssh_tunnel: None,
            tls_config: None,
        };
        assert_eq!(c.to_url(), "redis://localhost:6379/0");
    }

    #[test]
    fn url_with_auth() {
        let c = RedisConnectionConfig {
            host: "r.example.com".into(),
            port: 6380,
            password: Some("secret".into()),
            username: Some("default".into()),
            db: 3,
            use_tls: false,
            timeout: 30,
            label: None,
            connection_url: None,
            cluster_mode: None,
            sentinel: None,
            ssh_tunnel: None,
            tls_config: None,
        };
        assert_eq!(c.to_url(), "redis://default:secret@r.example.com:6380/3");
    }

    #[test]
    fn url_tls() {
        let c = RedisConnectionConfig {
            host: "r.example.com".into(),
            port: 6380,
            password: None,
            username: None,
            db: 0,
            use_tls: true,
            timeout: 30,
            label: None,
            connection_url: None,
            cluster_mode: None,
            sentinel: None,
            ssh_tunnel: None,
            tls_config: None,
        };
        assert!(c.to_url().starts_with("rediss://"));
    }

    #[test]
    fn url_override() {
        let c = RedisConnectionConfig {
            host: "ignored".into(),
            port: 6379,
            password: None,
            username: None,
            db: 0,
            use_tls: false,
            timeout: 30,
            label: None,
            connection_url: Some("redis://custom:1234/5".into()),
            cluster_mode: None,
            sentinel: None,
            ssh_tunnel: None,
            tls_config: None,
        };
        assert_eq!(c.to_url(), "redis://custom:1234/5");
    }

    #[test]
    fn key_type_from_str() {
        assert_eq!(RedisKeyType::from("string"), RedisKeyType::String);
        assert_eq!(RedisKeyType::from("list"), RedisKeyType::List);
        assert_eq!(RedisKeyType::from("set"), RedisKeyType::Set);
        assert_eq!(RedisKeyType::from("zset"), RedisKeyType::ZSet);
        assert_eq!(RedisKeyType::from("hash"), RedisKeyType::Hash);
        assert_eq!(RedisKeyType::from("stream"), RedisKeyType::Stream);
        assert_eq!(RedisKeyType::from("other"), RedisKeyType::Unknown);
    }

    #[test]
    fn key_value_serialize() {
        let v = RedisKeyValue::String("hello".into());
        let json = serde_json::to_value(&v).unwrap();
        assert_eq!(json["type"], "string");
        assert_eq!(json["value"], "hello");
    }

    #[test]
    fn scan_result_serialize() {
        let r = RedisScanResult {
            cursor: 42,
            keys: vec!["a".into(), "b".into()],
        };
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["cursor"], 42);
    }
}
