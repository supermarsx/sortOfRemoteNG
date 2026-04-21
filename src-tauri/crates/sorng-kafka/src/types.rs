use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Connection & Security
// ---------------------------------------------------------------------------

/// Security protocol used to communicate with Kafka brokers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum SecurityProtocol {
    #[default]
    Plaintext,
    Ssl,
    SaslPlaintext,
    SaslSsl,
}

impl SecurityProtocol {
    pub fn as_kafka_str(&self) -> &str {
        match self {
            SecurityProtocol::Plaintext => "plaintext",
            SecurityProtocol::Ssl => "ssl",
            SecurityProtocol::SaslPlaintext => "sasl_plaintext",
            SecurityProtocol::SaslSsl => "sasl_ssl",
        }
    }
}

/// SASL authentication mechanism.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING-KEBAB-CASE")]
pub enum SaslMechanism {
    Plain,
    ScramSha256,
    ScramSha512,
    GssApi,
    OAuthBearer,
}

impl SaslMechanism {
    pub fn as_kafka_str(&self) -> &str {
        match self {
            SaslMechanism::Plain => "PLAIN",
            SaslMechanism::ScramSha256 => "SCRAM-SHA-256",
            SaslMechanism::ScramSha512 => "SCRAM-SHA-512",
            SaslMechanism::GssApi => "GSSAPI",
            SaslMechanism::OAuthBearer => "OAUTHBEARER",
        }
    }
}

/// Configuration required to connect to a Kafka cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KafkaConnectionConfig {
    /// Comma-separated list of host:port pairs.
    pub bootstrap_servers: String,
    /// Security protocol (default: Plaintext).
    #[serde(default)]
    pub security_protocol: SecurityProtocol,
    /// SASL mechanism (required when security_protocol uses SASL).
    pub sasl_mechanism: Option<SaslMechanism>,
    /// SASL username.
    pub sasl_username: Option<String>,
    /// SASL password.
    pub sasl_password: Option<String>,
    /// Path to CA certificate for SSL.
    pub ssl_ca_location: Option<String>,
    /// Path to client certificate for mutual TLS.
    pub ssl_cert_location: Option<String>,
    /// Path to client private key.
    pub ssl_key_location: Option<String>,
    /// Password protecting the client private key.
    pub ssl_key_password: Option<String>,
    /// Confluent Schema Registry URL.
    pub schema_registry_url: Option<String>,
    /// Kafka Connect REST API URL.
    pub connect_url: Option<String>,
    /// Session timeout in milliseconds (default: 30000).
    #[serde(default = "default_session_timeout")]
    pub session_timeout_ms: u32,
    /// Request timeout in milliseconds (default: 30000).
    #[serde(default = "default_request_timeout")]
    pub request_timeout_ms: u32,
}

fn default_session_timeout() -> u32 {
    30_000
}

fn default_request_timeout() -> u32 {
    30_000
}

impl KafkaConnectionConfig {
    /// Build an `rdkafka::ClientConfig` from this connection configuration.
    pub fn to_client_config(&self) -> rdkafka::ClientConfig {
        let mut cfg = rdkafka::ClientConfig::new();
        cfg.set("bootstrap.servers", &self.bootstrap_servers);
        cfg.set("security.protocol", self.security_protocol.as_kafka_str());
        cfg.set("session.timeout.ms", self.session_timeout_ms.to_string());
        cfg.set("request.timeout.ms", self.request_timeout_ms.to_string());

        if let Some(ref mechanism) = self.sasl_mechanism {
            cfg.set("sasl.mechanism", mechanism.as_kafka_str());
        }
        if let Some(ref username) = self.sasl_username {
            cfg.set("sasl.username", username);
        }
        if let Some(ref password) = self.sasl_password {
            cfg.set("sasl.password", password);
        }
        if let Some(ref ca) = self.ssl_ca_location {
            cfg.set("ssl.ca.location", ca);
        }
        if let Some(ref cert) = self.ssl_cert_location {
            cfg.set("ssl.certificate.location", cert);
        }
        if let Some(ref key) = self.ssl_key_location {
            cfg.set("ssl.key.location", key);
        }
        if let Some(ref key_pw) = self.ssl_key_password {
            cfg.set("ssl.key.password", key_pw);
        }

        cfg
    }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/// Represents an active connection session to a Kafka cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KafkaSession {
    pub id: String,
    pub config: KafkaConnectionConfig,
    pub cluster_id: Option<String>,
    pub controller_id: Option<i32>,
    pub brokers: Vec<BrokerInfo>,
    pub connected_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Broker
// ---------------------------------------------------------------------------

/// Information about a Kafka broker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerInfo {
    pub id: i32,
    pub host: String,
    pub port: u16,
    pub rack: Option<String>,
    pub is_controller: bool,
    pub version: Option<String>,
    pub endpoints: Vec<BrokerEndpoint>,
    pub log_dirs: Vec<String>,
}

/// A single listener endpoint on a broker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerEndpoint {
    pub security_protocol: String,
    pub host: String,
    pub port: u16,
    pub listener_name: Option<String>,
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

/// Full information about a Kafka topic.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicInfo {
    pub name: String,
    pub partitions: i32,
    pub replication_factor: i32,
    pub internal: bool,
    pub configs: Vec<TopicConfig>,
    pub partition_details: Vec<PartitionInfo>,
    pub total_messages: Option<i64>,
    pub total_size_bytes: Option<i64>,
}

/// A single configuration entry for a topic or broker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicConfig {
    pub name: String,
    pub value: Option<String>,
    pub source: ConfigSource,
    pub is_default: bool,
    pub is_sensitive: bool,
    pub is_read_only: bool,
    pub synonyms: Vec<String>,
}

/// The originating source of a configuration entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Default)]
pub enum ConfigSource {
    DynamicTopicConfig,
    DynamicBrokerConfig,
    DynamicDefaultBrokerConfig,
    StaticBrokerConfig,
    DefaultConfig,
    #[default]
    Unknown,
}

// ---------------------------------------------------------------------------
// Partitions
// ---------------------------------------------------------------------------

/// Information about a single topic partition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartitionInfo {
    pub id: i32,
    pub leader: i32,
    pub replicas: Vec<i32>,
    pub isr: Vec<i32>,
    pub offline_replicas: Vec<i32>,
    pub earliest_offset: Option<i64>,
    pub latest_offset: Option<i64>,
    pub size_bytes: Option<i64>,
}

// ---------------------------------------------------------------------------
// Consumer Groups
// ---------------------------------------------------------------------------

/// State of a consumer group.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
#[derive(Default)]
pub enum GroupState {
    Stable,
    PreparingRebalance,
    CompletingRebalance,
    Empty,
    Dead,
    #[default]
    Unknown,
}

impl GroupState {
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "stable" => GroupState::Stable,
            "preparingrebalance" | "preparing_rebalance" => GroupState::PreparingRebalance,
            "completingrebalance" | "completing_rebalance" => GroupState::CompletingRebalance,
            "empty" => GroupState::Empty,
            "dead" => GroupState::Dead,
            _ => GroupState::Unknown,
        }
    }
}

/// Full information about a consumer group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsumerGroupInfo {
    pub group_id: String,
    pub state: GroupState,
    pub protocol_type: String,
    pub protocol: String,
    pub coordinator: Option<i32>,
    pub members: Vec<GroupMember>,
    pub partition_assignor: Option<String>,
    pub authorized_operations: Vec<String>,
}

/// A member of a consumer group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMember {
    pub member_id: String,
    pub client_id: String,
    pub client_host: String,
    pub assignments: Vec<MemberAssignment>,
}

/// A partition assignment for a group member.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberAssignment {
    pub topic: String,
    pub partitions: Vec<i32>,
}

/// Consumer group offset information for a single partition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsumerGroupOffset {
    pub topic: String,
    pub partition: i32,
    pub current_offset: i64,
    pub log_end_offset: i64,
    pub lag: i64,
    pub metadata: Option<String>,
}

// ---------------------------------------------------------------------------
// ACLs
// ---------------------------------------------------------------------------

/// Kafka resource types for ACL management.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum ResourceType {
    Topic,
    Group,
    Cluster,
    TransactionalId,
    DelegationToken,
    Any,
}

impl ResourceType {
    pub fn as_rdkafka(&self) -> rdkafka::admin::ResourceSpecifier<'_> {
        // This returns a rough mapping; real usage requires a name.
        // We provide a helper that takes a name separately.
        match self {
            ResourceType::Topic => rdkafka::admin::ResourceSpecifier::Topic(""),
            ResourceType::Group => rdkafka::admin::ResourceSpecifier::Group(""),
            _ => rdkafka::admin::ResourceSpecifier::Topic(""),
        }
    }

    pub fn to_i32(&self) -> i32 {
        match self {
            ResourceType::Any => 1,
            ResourceType::Topic => 2,
            ResourceType::Group => 3,
            ResourceType::Cluster => 4,
            ResourceType::TransactionalId => 5,
            ResourceType::DelegationToken => 6,
        }
    }

    pub fn from_i32(v: i32) -> Self {
        match v {
            2 => ResourceType::Topic,
            3 => ResourceType::Group,
            4 => ResourceType::Cluster,
            5 => ResourceType::TransactionalId,
            6 => ResourceType::DelegationToken,
            _ => ResourceType::Any,
        }
    }
}

/// ACL resource pattern type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum PatternType {
    Literal,
    Prefixed,
    Match,
    Any,
}

impl PatternType {
    pub fn to_i32(&self) -> i32 {
        match self {
            PatternType::Any => 1,
            PatternType::Match => 2,
            PatternType::Literal => 3,
            PatternType::Prefixed => 4,
        }
    }

    pub fn from_i32(v: i32) -> Self {
        match v {
            2 => PatternType::Match,
            3 => PatternType::Literal,
            4 => PatternType::Prefixed,
            _ => PatternType::Any,
        }
    }
}

/// ACL operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum AclOperation {
    All,
    Read,
    Write,
    Create,
    Delete,
    Alter,
    Describe,
    ClusterAction,
    DescribeConfigs,
    AlterConfigs,
    IdempotentWrite,
    CreateTokens,
    DescribeTokens,
    Any,
}

impl AclOperation {
    pub fn to_i32(&self) -> i32 {
        match self {
            AclOperation::Any => 1,
            AclOperation::All => 2,
            AclOperation::Read => 3,
            AclOperation::Write => 4,
            AclOperation::Create => 5,
            AclOperation::Delete => 6,
            AclOperation::Alter => 7,
            AclOperation::Describe => 8,
            AclOperation::ClusterAction => 9,
            AclOperation::DescribeConfigs => 10,
            AclOperation::AlterConfigs => 11,
            AclOperation::IdempotentWrite => 12,
            AclOperation::CreateTokens => 13,
            AclOperation::DescribeTokens => 14,
        }
    }

    pub fn from_i32(v: i32) -> Self {
        match v {
            2 => AclOperation::All,
            3 => AclOperation::Read,
            4 => AclOperation::Write,
            5 => AclOperation::Create,
            6 => AclOperation::Delete,
            7 => AclOperation::Alter,
            8 => AclOperation::Describe,
            9 => AclOperation::ClusterAction,
            10 => AclOperation::DescribeConfigs,
            11 => AclOperation::AlterConfigs,
            12 => AclOperation::IdempotentWrite,
            13 => AclOperation::CreateTokens,
            14 => AclOperation::DescribeTokens,
            _ => AclOperation::Any,
        }
    }
}

/// ACL permission type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum AclPermissionType {
    Allow,
    Deny,
    Any,
}

impl AclPermissionType {
    pub fn to_i32(&self) -> i32 {
        match self {
            AclPermissionType::Any => 1,
            AclPermissionType::Deny => 2,
            AclPermissionType::Allow => 3,
        }
    }

    pub fn from_i32(v: i32) -> Self {
        match v {
            2 => AclPermissionType::Deny,
            3 => AclPermissionType::Allow,
            _ => AclPermissionType::Any,
        }
    }
}

/// A single ACL entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclEntry {
    pub resource_type: ResourceType,
    pub resource_name: String,
    pub pattern_type: PatternType,
    pub principal: String,
    pub host: String,
    pub operation: AclOperation,
    pub permission_type: AclPermissionType,
}

/// Filter structure for querying/deleting ACLs.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AclFilter {
    pub resource_type: Option<ResourceType>,
    pub resource_name: Option<String>,
    pub pattern_type: Option<PatternType>,
    pub principal: Option<String>,
    pub host: Option<String>,
    pub operation: Option<AclOperation>,
    pub permission_type: Option<AclPermissionType>,
}

// ---------------------------------------------------------------------------
// Schema Registry
// ---------------------------------------------------------------------------

/// Schema type in the Confluent Schema Registry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
#[derive(Default)]
pub enum SchemaType {
    #[default]
    Avro,
    Json,
    Protobuf,
}

/// Compatibility level for schemas.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Default)]
pub enum CompatibilityLevel {
    #[default]
    Backward,
    BackwardTransitive,
    Forward,
    ForwardTransitive,
    Full,
    FullTransitive,
    None,
}

/// Reference to another schema (used for Protobuf imports, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaReference {
    pub name: String,
    pub subject: String,
    pub version: i32,
}

/// Full schema information from the Schema Registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaInfo {
    pub id: i32,
    pub subject: String,
    pub version: i32,
    pub schema_type: SchemaType,
    pub schema: String,
    pub references: Vec<SchemaReference>,
    pub compatibility: Option<CompatibilityLevel>,
}

// ---------------------------------------------------------------------------
// Kafka Connect
// ---------------------------------------------------------------------------

/// Connector type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectorType {
    Source,
    Sink,
}

/// Connector runtime state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
#[derive(Default)]
pub enum ConnectorState {
    #[default]
    Running,
    Paused,
    Unassigned,
    Failed,
    Restarting,
}

impl ConnectorState {
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_uppercase().as_str() {
            "RUNNING" => ConnectorState::Running,
            "PAUSED" => ConnectorState::Paused,
            "UNASSIGNED" => ConnectorState::Unassigned,
            "FAILED" => ConnectorState::Failed,
            "RESTARTING" => ConnectorState::Restarting,
            _ => ConnectorState::Running,
        }
    }
}

/// Full information about a Kafka Connect connector.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorInfo {
    pub name: String,
    pub type_name: Option<ConnectorType>,
    pub state: ConnectorState,
    pub worker_id: Option<String>,
    pub config: HashMap<String, String>,
    pub tasks: Vec<TaskInfo>,
    pub trace: Option<String>,
}

/// Information about a single connector task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskInfo {
    pub id: i32,
    pub state: ConnectorState,
    pub worker_id: Option<String>,
    pub trace: Option<String>,
}

/// A connector plugin available in the Kafka Connect cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorPlugin {
    pub class_name: String,
    pub type_name: Option<ConnectorType>,
    pub version: Option<String>,
}

// ---------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------

/// Entity type for quota management.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QuotaEntityType {
    User,
    ClientId,
    Ip,
}

/// A single quota entry (key/value pair).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaEntry {
    pub key: String,
    pub value: f64,
}

/// Quota information for an entity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaInfo {
    pub entity_type: QuotaEntityType,
    pub entity_name: String,
    pub quotas: Vec<QuotaEntry>,
}

// ---------------------------------------------------------------------------
// Partition Reassignment
// ---------------------------------------------------------------------------

/// Information about an in-progress partition reassignment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReassignmentInfo {
    pub topic: String,
    pub partition: i32,
    pub replicas: Vec<i32>,
    pub adding_replicas: Vec<i32>,
    pub removing_replicas: Vec<i32>,
}

/// A proposed partition reassignment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReassignmentProposal {
    pub topic: String,
    pub partition: i32,
    pub new_replicas: Vec<i32>,
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/// Cluster-wide metrics aggregated across all brokers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterMetrics {
    pub brokers: i32,
    pub topics: i32,
    pub partitions: i32,
    pub under_replicated_partitions: i32,
    pub offline_partitions: i32,
    pub active_controllers: i32,
    pub isr_shrinks: i64,
    pub isr_expands: i64,
    pub messages_in_per_sec: f64,
    pub bytes_in_per_sec: f64,
    pub bytes_out_per_sec: f64,
    pub fetch_request_rate: f64,
    pub produce_request_rate: f64,
    pub active_connections: i64,
    pub leader_election_rate: f64,
    pub unclean_leader_elections: i64,
    pub log_flush_rate: f64,
    pub request_queue_size: i64,
}

impl Default for ClusterMetrics {
    fn default() -> Self {
        Self {
            brokers: 0,
            topics: 0,
            partitions: 0,
            under_replicated_partitions: 0,
            offline_partitions: 0,
            active_controllers: 0,
            isr_shrinks: 0,
            isr_expands: 0,
            messages_in_per_sec: 0.0,
            bytes_in_per_sec: 0.0,
            bytes_out_per_sec: 0.0,
            fetch_request_rate: 0.0,
            produce_request_rate: 0.0,
            active_connections: 0,
            leader_election_rate: 0.0,
            unclean_leader_elections: 0,
            log_flush_rate: 0.0,
            request_queue_size: 0,
        }
    }
}

/// Per-topic metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicMetrics {
    pub messages_in_per_sec: f64,
    pub bytes_in_per_sec: f64,
    pub bytes_out_per_sec: f64,
    pub total_produce_requests: i64,
    pub total_fetch_requests: i64,
    pub failed_produce_requests: i64,
    pub failed_fetch_requests: i64,
}

impl Default for TopicMetrics {
    fn default() -> Self {
        Self {
            messages_in_per_sec: 0.0,
            bytes_in_per_sec: 0.0,
            bytes_out_per_sec: 0.0,
            total_produce_requests: 0,
            total_fetch_requests: 0,
            failed_produce_requests: 0,
            failed_fetch_requests: 0,
        }
    }
}

/// Per-broker metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerMetrics {
    pub cpu_percent: f64,
    pub memory_used_bytes: i64,
    pub disk_used_bytes: i64,
    pub request_handler_avg_idle_percent: f64,
    pub network_processor_avg_idle_percent: f64,
    pub under_replicated_partitions: i32,
    pub is_controller: bool,
    pub active_controller_count: i32,
    pub offline_partitions: i32,
    pub io_in_per_sec: f64,
    pub io_out_per_sec: f64,
}

impl Default for BrokerMetrics {
    fn default() -> Self {
        Self {
            cpu_percent: 0.0,
            memory_used_bytes: 0,
            disk_used_bytes: 0,
            request_handler_avg_idle_percent: 0.0,
            network_processor_avg_idle_percent: 0.0,
            under_replicated_partitions: 0,
            is_controller: false,
            active_controller_count: 0,
            offline_partitions: 0,
            io_in_per_sec: 0.0,
            io_out_per_sec: 0.0,
        }
    }
}

// ---------------------------------------------------------------------------
// Producer / Consumer Messages
// ---------------------------------------------------------------------------

/// A message to be produced to Kafka.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProducerMessage {
    pub topic: String,
    pub partition: Option<i32>,
    pub key: Option<String>,
    pub value: Option<String>,
    pub headers: Vec<MessageHeader>,
    pub timestamp: Option<i64>,
}

/// A message consumed from Kafka.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsumedMessage {
    pub topic: String,
    pub partition: i32,
    pub offset: i64,
    pub key: Option<String>,
    pub value: Option<String>,
    pub headers: Vec<MessageHeader>,
    pub timestamp: Option<i64>,
    pub timestamp_type: Option<String>,
}

/// A header key/value pair attached to a Kafka message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageHeader {
    pub key: String,
    pub value: Option<String>,
}

// ---------------------------------------------------------------------------
// Offset Reset Strategy
// ---------------------------------------------------------------------------

/// Strategy for resetting consumer group offsets.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OffsetResetStrategy {
    Earliest,
    Latest,
    Timestamp(i64),
    Offset(i64),
}

// ---------------------------------------------------------------------------
// Topic Creation Request
// ---------------------------------------------------------------------------

/// Parameters for creating a new topic.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTopicRequest {
    pub name: String,
    pub partitions: i32,
    pub replication_factor: i32,
    pub configs: HashMap<String, String>,
}

// ---------------------------------------------------------------------------
// Produce Result
// ---------------------------------------------------------------------------

/// Result of a successful produce operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProduceResult {
    pub topic: String,
    pub partition: i32,
    pub offset: i64,
}

// ---------------------------------------------------------------------------
// Log Dir Info
// ---------------------------------------------------------------------------

/// Information about a broker log directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogDirInfo {
    pub path: String,
    pub error: Option<String>,
    pub topics: Vec<LogDirTopicInfo>,
}

/// Topic-level information within a log directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogDirTopicInfo {
    pub topic: String,
    pub partition: i32,
    pub size_bytes: i64,
    pub offset_lag: i64,
    pub is_future: bool,
}

// ---------------------------------------------------------------------------
// Quota Components
// ---------------------------------------------------------------------------

/// Component for quota filtering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaComponent {
    pub entity_type: QuotaEntityType,
    pub entity_name: Option<String>,
}

/// Entry for altering client quotas.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlterQuotaEntry {
    pub entity: Vec<QuotaComponent>,
    pub ops: Vec<QuotaOp>,
}

/// A single quota alteration operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaOp {
    pub key: String,
    pub value: Option<f64>,
    /// true to remove, false to set.
    pub remove: bool,
}

// ---------------------------------------------------------------------------
// Config Validation Result (Connect)
// ---------------------------------------------------------------------------

/// Result of validating a connector configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigValidationResult {
    pub name: String,
    pub error_count: i32,
    pub groups: Vec<String>,
    pub configs: Vec<ConfigValidationEntry>,
}

/// A single config entry in the validation result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigValidationEntry {
    pub name: String,
    pub value: Option<String>,
    pub recommended_values: Vec<String>,
    pub errors: Vec<String>,
    pub visible: bool,
}
