use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Connection & Session
// ---------------------------------------------------------------------------

/// Configuration for connecting to a RabbitMQ management API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RabbitConnectionConfig {
    /// Hostname or IP of the RabbitMQ server.
    pub host: String,
    /// AMQP port (default 5672). Informational only — we use the management API.
    #[serde(default = "default_amqp_port")]
    pub port: u16,
    /// HTTP management API port (default 15672).
    #[serde(default = "default_management_port")]
    pub management_port: u16,
    /// Username for the management API.
    pub username: String,
    /// Password for the management API.
    pub password: String,
    /// Default vhost to operate on.
    #[serde(default = "default_vhost")]
    pub vhost: String,
    /// Whether to use HTTPS for the management API.
    #[serde(default)]
    pub use_tls: bool,
    /// Whether to verify TLS certificates.
    #[serde(default = "default_true")]
    pub verify_cert: bool,
    /// Request timeout in seconds.
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

fn default_amqp_port() -> u16 { 5672 }
fn default_management_port() -> u16 { 15672 }
fn default_vhost() -> String { "/".to_string() }
fn default_true() -> bool { true }
fn default_timeout() -> u64 { 30 }

/// An active management API session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RabbitSession {
    /// Unique session identifier.
    pub id: String,
    /// The configuration used t create this session.
    pub config: RabbitConnectionConfig,
    /// When the session was established.
    pub connected_at: DateTime<Utc>,
    /// Server information retrieved at connect time.
    pub server_info: Option<ServerInfo>,
}

/// Basic identification for the remote RabbitMQ server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub rabbitmq_version: String,
    pub erlang_version: String,
    pub cluster_name: String,
    pub node_name: String,
    #[serde(default)]
    pub product_name: Option<String>,
    #[serde(default)]
    pub product_version: Option<String>,
}

// ---------------------------------------------------------------------------
// Vhosts
// ---------------------------------------------------------------------------

/// Information about a virtual host.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VhostInfo {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub tracing: bool,
    #[serde(default)]
    pub default_queue_type: Option<String>,
    #[serde(default)]
    pub cluster_state: Option<HashMap<String, String>>,
    #[serde(default)]
    pub messages: Option<u64>,
    #[serde(default)]
    pub messages_ready: Option<u64>,
    #[serde(default)]
    pub messages_unacknowledged: Option<u64>,
    #[serde(default)]
    pub recv_oct: Option<u64>,
    #[serde(default)]
    pub send_oct: Option<u64>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

/// Request body when creating or updating a vhost.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VhostCreateRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_queue_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracing: Option<bool>,
}

/// Limits that can be set on a vhost.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VhostLimits {
    #[serde(rename = "max-connections", skip_serializing_if = "Option::is_none")]
    pub max_connections: Option<i64>,
    #[serde(rename = "max-queues", skip_serializing_if = "Option::is_none")]
    pub max_queues: Option<i64>,
}

// ---------------------------------------------------------------------------
// Exchanges
// ---------------------------------------------------------------------------

/// The type of an exchange.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExchangeType {
    #[serde(rename = "direct")]
    Direct,
    #[serde(rename = "fanout")]
    Fanout,
    #[serde(rename = "topic")]
    Topic,
    #[serde(rename = "headers")]
    Headers,
    #[serde(rename = "x-consistent-hash")]
    ConsistentHash,
    #[serde(rename = "x-delayed-message")]
    XDelayedMessage,
    #[serde(untagged)]
    Other(String),
}

impl fmt::Display for ExchangeType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Direct => write!(f, "direct"),
            Self::Fanout => write!(f, "fanout"),
            Self::Topic => write!(f, "topic"),
            Self::Headers => write!(f, "headers"),
            Self::ConsistentHash => write!(f, "x-consistent-hash"),
            Self::XDelayedMessage => write!(f, "x-delayed-message"),
            Self::Other(s) => write!(f, "{}", s),
        }
    }
}

/// Information about an exchange.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExchangeInfo {
    pub name: String,
    pub vhost: String,
    #[serde(rename = "type")]
    pub exchange_type: ExchangeType,
    #[serde(default)]
    pub durable: bool,
    #[serde(default)]
    pub auto_delete: bool,
    #[serde(default)]
    pub internal: bool,
    #[serde(default)]
    pub arguments: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub message_stats: Option<MessageStats>,
    #[serde(default)]
    pub user_who_performed_action: Option<String>,
}

/// Request body when declaring an exchange.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExchangeCreateRequest {
    #[serde(rename = "type")]
    pub exchange_type: String,
    #[serde(default)]
    pub durable: bool,
    #[serde(default)]
    pub auto_delete: bool,
    #[serde(default)]
    pub internal: bool,
    #[serde(default)]
    pub arguments: HashMap<String, serde_json::Value>,
}

/// A message to publish to an exchange.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishMessage {
    pub routing_key: String,
    pub payload: String,
    pub payload_encoding: String,
    pub properties: PublishProperties,
}

/// AMQP basic properties attached to a published message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishProperties {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_encoding: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_mode: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, serde_json::Value>>,
}

/// A message retrieved from a queue via the management API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueMessage {
    pub payload: String,
    pub payload_encoding: String,
    pub payload_bytes: u64,
    pub redelivered: bool,
    pub exchange: String,
    pub routing_key: String,
    pub message_count: u64,
    pub properties: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

/// The type of a queue (classic, quorum, stream).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum QueueType {
    #[serde(rename = "classic")]
    Classic,
    #[serde(rename = "quorum")]
    Quorum,
    #[serde(rename = "stream")]
    Stream,
    #[serde(untagged)]
    Other(String),
}

impl fmt::Display for QueueType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Classic => write!(f, "classic"),
            Self::Quorum => write!(f, "quorum"),
            Self::Stream => write!(f, "stream"),
            Self::Other(s) => write!(f, "{}", s),
        }
    }
}

/// The runtime state of a queue.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum QueueState {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "idle")]
    Idle,
    #[serde(rename = "crashed")]
    Crashed,
    #[serde(rename = "stopped")]
    Stopped,
    #[serde(rename = "minority")]
    Minority,
    #[serde(rename = "down")]
    Down,
    #[serde(untagged)]
    Other(String),
}

/// Full information about a queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueInfo {
    pub name: String,
    pub vhost: String,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub durable: bool,
    #[serde(default)]
    pub auto_delete: bool,
    #[serde(default)]
    pub exclusive: bool,
    #[serde(rename = "type", default)]
    pub queue_type: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub consumers: Option<u64>,
    #[serde(default)]
    pub messages: Option<u64>,
    #[serde(default)]
    pub messages_ready: Option<u64>,
    #[serde(default)]
    pub messages_unacknowledged: Option<u64>,
    #[serde(default)]
    pub messages_ram: Option<u64>,
    #[serde(default)]
    pub messages_persistent: Option<u64>,
    #[serde(default)]
    pub memory: Option<u64>,
    #[serde(default)]
    pub consumer_utilisation: Option<f64>,
    #[serde(default)]
    pub head_message_timestamp: Option<u64>,
    #[serde(default)]
    pub arguments: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub policy: Option<String>,
    #[serde(default)]
    pub operator_policy: Option<String>,
    #[serde(default)]
    pub effective_policy_definition: Option<serde_json::Value>,
    #[serde(default)]
    pub idle_since: Option<String>,
    #[serde(default)]
    pub slave_nodes: Option<Vec<String>>,
    #[serde(default)]
    pub synchronised_slave_nodes: Option<Vec<String>>,
    #[serde(default)]
    pub recoverable_slaves: Option<Vec<String>>,
    #[serde(default)]
    pub leader: Option<String>,
    #[serde(default)]
    pub online: Option<Vec<String>>,
    #[serde(default)]
    pub members: Option<Vec<String>>,
    #[serde(default)]
    pub message_stats: Option<MessageStats>,
    #[serde(default)]
    pub user_who_performed_action: Option<String>,
}

/// Request body when declaring a queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueCreateRequest {
    #[serde(default)]
    pub durable: bool,
    #[serde(default)]
    pub auto_delete: bool,
    #[serde(default)]
    pub arguments: HashMap<String, serde_json::Value>,
}

/// Request body when getting messages from a queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetMessagesRequest {
    pub count: u32,
    #[serde(rename = "ackmode")]
    pub ack_mode: String,
    pub encoding: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncate: Option<u64>,
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

/// Whether a binding target is a queue or an exchange.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DestinationType {
    #[serde(rename = "queue")]
    Queue,
    #[serde(rename = "exchange")]
    Exchange,
}

impl fmt::Display for DestinationType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Queue => write!(f, "q"),
            Self::Exchange => write!(f, "e"),
        }
    }
}

/// Information about a binding between a source exchange and a destination.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BindingInfo {
    pub source: String,
    #[serde(default)]
    pub vhost: Option<String>,
    pub destination: String,
    pub destination_type: String,
    pub routing_key: String,
    #[serde(default)]
    pub arguments: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub properties_key: Option<String>,
}

/// Request body when creating a binding.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BindingCreateRequest {
    #[serde(default)]
    pub routing_key: String,
    #[serde(default)]
    pub arguments: HashMap<String, serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/// User tags that control management-level access.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum UserTag {
    #[serde(rename = "administrator")]
    Administrator,
    #[serde(rename = "monitoring")]
    Monitoring,
    #[serde(rename = "policymaker")]
    Policymaker,
    #[serde(rename = "management")]
    Management,
    #[serde(rename = "impersonator")]
    Impersonator,
    #[serde(rename = "")]
    None,
    #[serde(untagged)]
    Custom(String),
}

impl fmt::Display for UserTag {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Administrator => write!(f, "administrator"),
            Self::Monitoring => write!(f, "monitoring"),
            Self::Policymaker => write!(f, "policymaker"),
            Self::Management => write!(f, "management"),
            Self::Impersonator => write!(f, "impersonator"),
            Self::None => write!(f, ""),
            Self::Custom(s) => write!(f, "{}", s),
        }
    }
}

/// Information about a RabbitMQ user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub name: String,
    #[serde(default)]
    pub password_hash: Option<String>,
    #[serde(default)]
    pub hashing_algorithm: Option<String>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub limits: Option<serde_json::Value>,
}

/// Request body when creating or updating a user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserCreateRequest {
    pub password: String,
    pub tags: String,
}

/// User limits.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserLimits {
    #[serde(rename = "max-connections", skip_serializing_if = "Option::is_none")]
    pub max_connections: Option<i64>,
    #[serde(rename = "max-channels", skip_serializing_if = "Option::is_none")]
    pub max_channels: Option<i64>,
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/// Standard vhost-level permissions for a user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionInfo {
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub vhost: Option<String>,
    pub configure: String,
    pub write: String,
    pub read: String,
}

/// Topic-level permissions for a user on a specific exchange.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicPermissionInfo {
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub vhost: Option<String>,
    pub exchange: String,
    pub write: String,
    pub read: String,
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

/// What resource types a policy applies to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ApplyTo {
    #[serde(rename = "queues")]
    Queues,
    #[serde(rename = "exchanges")]
    Exchanges,
    #[serde(rename = "all")]
    All,
    #[serde(rename = "classic_queues")]
    ClassicQueues,
    #[serde(rename = "quorum_queues")]
    QuorumQueues,
    #[serde(rename = "streams")]
    Streams,
    #[serde(untagged)]
    Other(String),
}

impl Default for ApplyTo {
    fn default() -> Self {
        Self::All
    }
}

/// Information about an operator or user policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyInfo {
    pub name: String,
    pub vhost: String,
    pub pattern: String,
    #[serde(default)]
    pub definition: serde_json::Value,
    #[serde(default)]
    pub priority: i64,
    #[serde(rename = "apply-to", default)]
    pub apply_to: Option<String>,
}

/// Strongly-typed policy definition with common policy keys.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PolicyDefinition {
    #[serde(rename = "ha-mode", skip_serializing_if = "Option::is_none")]
    pub ha_mode: Option<String>,
    #[serde(rename = "ha-params", skip_serializing_if = "Option::is_none")]
    pub ha_params: Option<serde_json::Value>,
    #[serde(rename = "ha-sync-mode", skip_serializing_if = "Option::is_none")]
    pub ha_sync_mode: Option<String>,
    #[serde(rename = "message-ttl", skip_serializing_if = "Option::is_none")]
    pub message_ttl: Option<u64>,
    #[serde(rename = "max-length", skip_serializing_if = "Option::is_none")]
    pub max_length: Option<i64>,
    #[serde(rename = "max-length-bytes", skip_serializing_if = "Option::is_none")]
    pub max_length_bytes: Option<i64>,
    #[serde(rename = "dead-letter-exchange", skip_serializing_if = "Option::is_none")]
    pub dead_letter_exchange: Option<String>,
    #[serde(rename = "dead-letter-routing-key", skip_serializing_if = "Option::is_none")]
    pub dead_letter_routing_key: Option<String>,
    #[serde(rename = "queue-mode", skip_serializing_if = "Option::is_none")]
    pub queue_mode: Option<String>,
    #[serde(rename = "delivery-limit", skip_serializing_if = "Option::is_none")]
    pub delivery_limit: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overflow: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires: Option<u64>,
    #[serde(rename = "max-age", skip_serializing_if = "Option::is_none")]
    pub max_age: Option<String>,
    #[serde(rename = "max-priority", skip_serializing_if = "Option::is_none")]
    pub max_priority: Option<u8>,
    #[serde(rename = "alternate-exchange", skip_serializing_if = "Option::is_none")]
    pub alternate_exchange: Option<String>,
    #[serde(rename = "federation-upstream", skip_serializing_if = "Option::is_none")]
    pub federation_upstream: Option<String>,
    #[serde(rename = "federation-upstream-set", skip_serializing_if = "Option::is_none")]
    pub federation_upstream_set: Option<String>,
}

/// Request body for creating a policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyCreateRequest {
    pub pattern: String,
    pub definition: serde_json::Value,
    #[serde(default)]
    pub priority: i64,
    #[serde(rename = "apply-to", default = "default_apply_all")]
    pub apply_to: String,
}

fn default_apply_all() -> String {
    "all".to_string()
}

// ---------------------------------------------------------------------------
// Shovels
// ---------------------------------------------------------------------------

/// Acknowledgement mode for shovels.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AckMode {
    #[serde(rename = "on-confirm")]
    OnConfirm,
    #[serde(rename = "on-publish")]
    OnPublish,
    #[serde(rename = "no-ack")]
    NoAck,
}

impl Default for AckMode {
    fn default() -> Self {
        Self::OnConfirm
    }
}

/// Runtime information about a shovel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShovelInfo {
    pub name: String,
    pub vhost: String,
    #[serde(default)]
    pub component: Option<String>,
    #[serde(default)]
    pub definition: Option<serde_json::Value>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(rename = "type", default)]
    pub shovel_type: Option<String>,
}

/// Definition of a dynamic shovel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShovelDefinition {
    #[serde(rename = "src-uri")]
    pub src_uri: String,
    #[serde(rename = "src-queue", skip_serializing_if = "Option::is_none")]
    pub src_queue: Option<String>,
    #[serde(rename = "src-exchange", skip_serializing_if = "Option::is_none")]
    pub src_exchange: Option<String>,
    #[serde(rename = "src-exchange-key", skip_serializing_if = "Option::is_none")]
    pub src_exchange_key: Option<String>,
    #[serde(rename = "dest-uri")]
    pub dest_uri: String,
    #[serde(rename = "dest-queue", skip_serializing_if = "Option::is_none")]
    pub dest_queue: Option<String>,
    #[serde(rename = "dest-exchange", skip_serializing_if = "Option::is_none")]
    pub dest_exchange: Option<String>,
    #[serde(rename = "dest-exchange-key", skip_serializing_if = "Option::is_none")]
    pub dest_exchange_key: Option<String>,
    #[serde(rename = "prefetch-count", skip_serializing_if = "Option::is_none")]
    pub prefetch_count: Option<u32>,
    #[serde(rename = "reconnect-delay", skip_serializing_if = "Option::is_none")]
    pub reconnect_delay: Option<u32>,
    #[serde(rename = "ack-mode", skip_serializing_if = "Option::is_none")]
    pub ack_mode: Option<String>,
    #[serde(rename = "src-protocol", skip_serializing_if = "Option::is_none")]
    pub src_protocol: Option<String>,
    #[serde(rename = "dest-protocol", skip_serializing_if = "Option::is_none")]
    pub dest_protocol: Option<String>,
}

/// Wrapper for creating a shovel parameter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShovelParameterValue {
    pub value: ShovelDefinition,
}

// ---------------------------------------------------------------------------
// Federation
// ---------------------------------------------------------------------------

/// A federation upstream parameter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationUpstream {
    pub name: String,
    pub vhost: String,
    #[serde(default)]
    pub component: Option<String>,
    #[serde(default)]
    pub value: Option<FederationUpstreamDef>,
}

/// Configuration values for a federation upstream.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationUpstreamDef {
    pub uri: String,
    #[serde(rename = "prefetch-count", skip_serializing_if = "Option::is_none")]
    pub prefetch_count: Option<u32>,
    #[serde(rename = "reconnect-delay", skip_serializing_if = "Option::is_none")]
    pub reconnect_delay: Option<u32>,
    #[serde(rename = "ack-mode", skip_serializing_if = "Option::is_none")]
    pub ack_mode: Option<String>,
    #[serde(rename = "trust-user-id", skip_serializing_if = "Option::is_none")]
    pub trust_user_id: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exchange: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue: Option<String>,
    #[serde(rename = "max-hops", skip_serializing_if = "Option::is_none")]
    pub max_hops: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires: Option<u64>,
    #[serde(rename = "message-ttl", skip_serializing_if = "Option::is_none")]
    pub message_ttl: Option<u64>,
}

/// An upstream set entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationUpstreamSetEntry {
    pub upstream: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exchange: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue: Option<String>,
}

/// Runtime status of a federation link.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationLink {
    pub node: String,
    #[serde(rename = "type")]
    pub type_name: String,
    pub name: String,
    pub vhost: String,
    #[serde(default)]
    pub upstream: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub local_connection: Option<serde_json::Value>,
    #[serde(default)]
    pub uri: Option<String>,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
}

// ---------------------------------------------------------------------------
// Cluster / Nodes
// ---------------------------------------------------------------------------

/// Information about a cluster node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterNode {
    pub name: String,
    #[serde(rename = "type", default)]
    pub type_name: Option<String>,
    #[serde(default)]
    pub running: Option<bool>,
    #[serde(default)]
    pub os_pid: Option<String>,
    #[serde(default)]
    pub fd_total: Option<u64>,
    #[serde(default)]
    pub fd_used: Option<u64>,
    #[serde(default)]
    pub sockets_total: Option<u64>,
    #[serde(default)]
    pub sockets_used: Option<u64>,
    #[serde(default)]
    pub mem_limit: Option<u64>,
    #[serde(default)]
    pub mem_used: Option<u64>,
    #[serde(default)]
    pub mem_alarm: Option<bool>,
    #[serde(default)]
    pub disk_free_limit: Option<u64>,
    #[serde(default)]
    pub disk_free: Option<u64>,
    #[serde(default)]
    pub disk_free_alarm: Option<bool>,
    #[serde(default)]
    pub proc_total: Option<u64>,
    #[serde(default)]
    pub proc_used: Option<u64>,
    #[serde(default)]
    pub run_queue: Option<u64>,
    #[serde(default)]
    pub uptime: Option<u64>,
    #[serde(default)]
    pub io_read_count: Option<u64>,
    #[serde(default)]
    pub io_write_count: Option<u64>,
    #[serde(default)]
    pub io_read_bytes: Option<u64>,
    #[serde(default)]
    pub io_write_bytes: Option<u64>,
    #[serde(default)]
    pub context_switches: Option<u64>,
    #[serde(default)]
    pub partitions: Option<Vec<String>>,
    #[serde(default)]
    pub rates_mode: Option<String>,
    #[serde(default)]
    pub net_ticktime: Option<u64>,
    #[serde(default)]
    pub enabled_plugins: Option<Vec<String>>,
    #[serde(default)]
    pub config_files: Option<Vec<String>>,
    #[serde(default)]
    pub db_dir: Option<String>,
    #[serde(default)]
    pub log_files: Option<Vec<String>>,
    #[serde(default)]
    pub exchange_types: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub auth_mechanisms: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub applications: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub contexts: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub cluster_links: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub metrics_gc_queue_length: Option<serde_json::Value>,
}

/// Cluster name wrapper.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterName {
    pub name: String,
}

/// Node memory breakdown.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeMemory {
    #[serde(default)]
    pub memory: Option<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/// Information about an AMQP connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub name: String,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub protocol: Option<String>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub vhost: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub peer_host: Option<String>,
    #[serde(default)]
    pub peer_port: Option<u16>,
    #[serde(default)]
    pub ssl: Option<bool>,
    #[serde(default)]
    pub channels: Option<u64>,
    #[serde(default)]
    pub connected_at: Option<u64>,
    #[serde(default)]
    pub timeout: Option<u64>,
    #[serde(default)]
    pub frame_max: Option<u64>,
    #[serde(default)]
    pub recv_oct: Option<u64>,
    #[serde(default)]
    pub send_oct: Option<u64>,
    #[serde(default)]
    pub recv_cnt: Option<u64>,
    #[serde(default)]
    pub send_cnt: Option<u64>,
    #[serde(default)]
    pub client_properties: Option<serde_json::Value>,
    #[serde(default)]
    pub channel_max: Option<u64>,
    #[serde(default)]
    pub auth_mechanism: Option<String>,
    #[serde(default)]
    pub ssl_protocol: Option<String>,
    #[serde(default)]
    pub ssl_cipher: Option<String>,
    #[serde(default)]
    pub ssl_hash: Option<String>,
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/// Information about a channel on a connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelInfo {
    pub name: String,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub number: Option<u64>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub vhost: Option<String>,
    #[serde(default)]
    pub connection_details: Option<serde_json::Value>,
    #[serde(default)]
    pub consumer_count: Option<u64>,
    #[serde(default)]
    pub messages_unacknowledged: Option<u64>,
    #[serde(default)]
    pub messages_unconfirmed: Option<u64>,
    #[serde(default)]
    pub messages_uncommitted: Option<u64>,
    #[serde(default)]
    pub prefetch_count: Option<u64>,
    #[serde(default)]
    pub global_prefetch_count: Option<u64>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub acks_uncommitted: Option<u64>,
    #[serde(default)]
    pub confirm: Option<bool>,
    #[serde(default)]
    pub transactional: Option<bool>,
    #[serde(default)]
    pub message_stats: Option<MessageStats>,
}

// ---------------------------------------------------------------------------
// Consumers
// ---------------------------------------------------------------------------

/// Information about a consumer on a queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsumerInfo {
    #[serde(default)]
    pub queue: Option<serde_json::Value>,
    #[serde(default)]
    pub channel_details: Option<serde_json::Value>,
    #[serde(default)]
    pub consumer_tag: Option<String>,
    #[serde(default)]
    pub ack_required: Option<bool>,
    #[serde(default)]
    pub exclusive: Option<bool>,
    #[serde(default)]
    pub prefetch_count: Option<u64>,
    #[serde(default)]
    pub active: Option<bool>,
    #[serde(default)]
    pub activity_status: Option<String>,
    #[serde(default)]
    pub arguments: Option<HashMap<String, serde_json::Value>>,
}

// ---------------------------------------------------------------------------
// Message Stats
// ---------------------------------------------------------------------------

/// Message throughput statistics including per-second rates.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MessageStats {
    #[serde(default)]
    pub publish: Option<u64>,
    #[serde(default)]
    pub publish_details: Option<MessageRate>,
    #[serde(default)]
    pub publish_in: Option<u64>,
    #[serde(default)]
    pub publish_in_details: Option<MessageRate>,
    #[serde(default)]
    pub publish_out: Option<u64>,
    #[serde(default)]
    pub publish_out_details: Option<MessageRate>,
    #[serde(default)]
    pub confirm: Option<u64>,
    #[serde(default)]
    pub confirm_details: Option<MessageRate>,
    #[serde(default)]
    pub deliver: Option<u64>,
    #[serde(default)]
    pub deliver_details: Option<MessageRate>,
    #[serde(default)]
    pub deliver_get: Option<u64>,
    #[serde(default)]
    pub deliver_get_details: Option<MessageRate>,
    #[serde(default)]
    pub deliver_no_ack: Option<u64>,
    #[serde(default)]
    pub deliver_no_ack_details: Option<MessageRate>,
    #[serde(default)]
    pub get: Option<u64>,
    #[serde(default)]
    pub get_details: Option<MessageRate>,
    #[serde(default)]
    pub get_no_ack: Option<u64>,
    #[serde(default)]
    pub get_no_ack_details: Option<MessageRate>,
    #[serde(default)]
    pub ack: Option<u64>,
    #[serde(default)]
    pub ack_details: Option<MessageRate>,
    #[serde(default)]
    pub redeliver: Option<u64>,
    #[serde(default)]
    pub redeliver_details: Option<MessageRate>,
    #[serde(default)]
    pub return_unroutable: Option<u64>,
    #[serde(default)]
    pub return_unroutable_details: Option<MessageRate>,
}

/// A per-second rate value.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MessageRate {
    pub rate: f64,
}

// ---------------------------------------------------------------------------
// Monitoring / Overview
// ---------------------------------------------------------------------------

/// The /api/overview response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverviewInfo {
    #[serde(default)]
    pub rabbitmq_version: Option<String>,
    #[serde(default)]
    pub erlang_version: Option<String>,
    #[serde(default)]
    pub cluster_name: Option<String>,
    #[serde(default)]
    pub object_totals: Option<ObjectTotals>,
    #[serde(default)]
    pub queue_totals: Option<QueueTotals>,
    #[serde(default)]
    pub message_stats: Option<MessageStats>,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub listeners: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub contexts: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub management_version: Option<String>,
    #[serde(default)]
    pub rates_mode: Option<String>,
    #[serde(default)]
    pub erlang_full_version: Option<String>,
    #[serde(default)]
    pub product_name: Option<String>,
    #[serde(default)]
    pub product_version: Option<String>,
    #[serde(default)]
    pub disable_stats: Option<bool>,
    #[serde(default)]
    pub sample_retention_policies: Option<serde_json::Value>,
    #[serde(default)]
    pub exchange_types: Option<Vec<serde_json::Value>>,
}

/// Counts of broker-level objects.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ObjectTotals {
    #[serde(default)]
    pub connections: u64,
    #[serde(default)]
    pub channels: u64,
    #[serde(default)]
    pub exchanges: u64,
    #[serde(default)]
    pub queues: u64,
    #[serde(default)]
    pub consumers: u64,
}

/// Aggregated message counts across all queues.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueueTotals {
    #[serde(default)]
    pub messages: u64,
    #[serde(default)]
    pub messages_ready: u64,
    #[serde(default)]
    pub messages_unacknowledged: u64,
    #[serde(default)]
    pub messages_details: Option<MessageRate>,
    #[serde(default)]
    pub messages_ready_details: Option<MessageRate>,
    #[serde(default)]
    pub messages_unacknowledged_details: Option<MessageRate>,
}

// ---------------------------------------------------------------------------
// Definitions (import / export)
// ---------------------------------------------------------------------------

/// Full broker definition for import/export via /api/definitions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefinitionsExport {
    #[serde(default)]
    pub rabbitmq_version: Option<String>,
    #[serde(default)]
    pub product_name: Option<String>,
    #[serde(default)]
    pub product_version: Option<String>,
    #[serde(default)]
    pub users: Vec<serde_json::Value>,
    #[serde(default)]
    pub vhosts: Vec<serde_json::Value>,
    #[serde(default)]
    pub permissions: Vec<serde_json::Value>,
    #[serde(default)]
    pub topic_permissions: Vec<serde_json::Value>,
    #[serde(default)]
    pub parameters: Vec<serde_json::Value>,
    #[serde(default)]
    pub global_parameters: Vec<serde_json::Value>,
    #[serde(default)]
    pub policies: Vec<serde_json::Value>,
    #[serde(default)]
    pub queues: Vec<serde_json::Value>,
    #[serde(default)]
    pub exchanges: Vec<serde_json::Value>,
    #[serde(default)]
    pub bindings: Vec<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------

/// An active alarm on a node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlarmInfo {
    pub node: String,
    pub resource: String,
    #[serde(default)]
    pub source: Option<String>,
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/// Result of a health-check endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckResult {
    pub status: String,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub ok: Option<bool>,
}

/// Node metrics snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeMetrics {
    pub name: String,
    #[serde(default)]
    pub fd_used: Option<u64>,
    #[serde(default)]
    pub fd_total: Option<u64>,
    #[serde(default)]
    pub sockets_used: Option<u64>,
    #[serde(default)]
    pub sockets_total: Option<u64>,
    #[serde(default)]
    pub mem_used: Option<u64>,
    #[serde(default)]
    pub mem_limit: Option<u64>,
    #[serde(default)]
    pub mem_alarm: Option<bool>,
    #[serde(default)]
    pub disk_free: Option<u64>,
    #[serde(default)]
    pub disk_free_limit: Option<u64>,
    #[serde(default)]
    pub disk_free_alarm: Option<bool>,
    #[serde(default)]
    pub proc_used: Option<u64>,
    #[serde(default)]
    pub proc_total: Option<u64>,
    #[serde(default)]
    pub run_queue: Option<u64>,
    #[serde(default)]
    pub uptime: Option<u64>,
    #[serde(default)]
    pub io_read_count: Option<u64>,
    #[serde(default)]
    pub io_write_count: Option<u64>,
    #[serde(default)]
    pub io_read_bytes: Option<u64>,
    #[serde(default)]
    pub io_write_bytes: Option<u64>,
}

/// Queue depth info for monitoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueDepth {
    pub name: String,
    pub vhost: String,
    #[serde(default)]
    pub messages: u64,
    #[serde(default)]
    pub messages_ready: u64,
    #[serde(default)]
    pub messages_unacknowledged: u64,
    #[serde(default)]
    pub consumers: u64,
}

use std::fmt;
