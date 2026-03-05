// ─── LXD / Incus Integration – shared types ────────────────────────────────
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

// ═══════════════════════════════════════════════════════════════════════════════
// Error types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LxdErrorKind {
    Auth,
    Connection,
    Timeout,
    NotFound,
    Conflict,
    Validation,
    Api,
    OperationFailed,
    Throttled,
    QuotaExceeded,
    ServiceUnavailable,
    Unknown,
}

impl fmt::Display for LxdErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Auth => write!(f, "auth"),
            Self::Connection => write!(f, "connection"),
            Self::Timeout => write!(f, "timeout"),
            Self::NotFound => write!(f, "not_found"),
            Self::Conflict => write!(f, "conflict"),
            Self::Validation => write!(f, "validation"),
            Self::Api => write!(f, "api"),
            Self::OperationFailed => write!(f, "operation_failed"),
            Self::Throttled => write!(f, "throttled"),
            Self::QuotaExceeded => write!(f, "quota_exceeded"),
            Self::ServiceUnavailable => write!(f, "service_unavailable"),
            Self::Unknown => write!(f, "unknown"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LxdError {
    pub kind: LxdErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl fmt::Display for LxdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[lxd:{}] {}", self.kind, self.message)
    }
}

impl std::error::Error for LxdError {}

impl From<LxdError> for String {
    fn from(e: LxdError) -> Self {
        e.to_string()
    }
}

impl LxdError {
    pub fn new(kind: LxdErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            status_code: None,
            code: None,
        }
    }

    pub fn auth(msg: impl Into<String>) -> Self {
        Self::new(LxdErrorKind::Auth, msg)
    }
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::new(LxdErrorKind::Connection, msg)
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(LxdErrorKind::NotFound, msg)
    }
    pub fn validation(msg: impl Into<String>) -> Self {
        Self::new(LxdErrorKind::Validation, msg)
    }
    pub fn api(msg: impl Into<String>) -> Self {
        Self::new(LxdErrorKind::Api, msg)
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::new(LxdErrorKind::Conflict, msg)
    }
    pub fn operation_failed(msg: impl Into<String>) -> Self {
        Self::new(LxdErrorKind::OperationFailed, msg)
    }
    pub fn unknown(msg: impl Into<String>) -> Self {
        Self::new(LxdErrorKind::Unknown, msg)
    }
}

pub type LxdResult<T> = Result<T, LxdError>;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection configuration
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LxdConnectionConfig {
    /// Base URL of the LXD/Incus REST API (e.g. https://10.0.0.1:8443)
    pub url: String,
    /// TLS client certificate (PEM) for mutual TLS auth
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_cert_pem: Option<String>,
    /// TLS client key (PEM)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_key_pem: Option<String>,
    /// Trust token / password for initial handshake
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trust_password: Option<String>,
    /// OIDC access token for token-based auth (Incus)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oidc_token: Option<String>,
    /// Skip TLS verification (self-signed certs)
    #[serde(default)]
    pub skip_tls_verify: bool,
    /// Target project (default: "default")
    #[serde(default = "default_project")]
    pub project: String,
    /// Request timeout in seconds
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_project() -> String {
    "default".to_string()
}
fn default_timeout() -> u64 {
    30
}

impl Default for LxdConnectionConfig {
    fn default() -> Self {
        Self {
            url: "https://127.0.0.1:8443".to_string(),
            client_cert_pem: None,
            client_key_pem: None,
            trust_password: None,
            oidc_token: None,
            skip_tls_verify: true,
            project: default_project(),
            timeout_secs: default_timeout(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LxdConnectionSummary {
    pub connected: bool,
    pub server_url: String,
    pub project: String,
    pub api_version: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub auth_type: Option<String>,
    pub auth_user_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_enabled: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// LXD API response wrappers
// ═══════════════════════════════════════════════════════════════════════════════

/// Standard synchronous response from the LXD API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LxdSyncResponse<T> {
    #[serde(rename = "type")]
    pub response_type: String,
    pub status: String,
    pub status_code: u16,
    #[serde(default)]
    pub metadata: T,
}

/// Async operation response from the LXD API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LxdAsyncResponse {
    #[serde(rename = "type")]
    pub response_type: String,
    pub status: String,
    pub status_code: u16,
    pub operation: String,
    #[serde(default)]
    pub metadata: Option<LxdOperation>,
}

/// Error response from the LXD API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LxdErrorResponse {
    #[serde(rename = "type")]
    pub response_type: String,
    pub error: String,
    pub error_code: u16,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Server / Cluster
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdServer {
    pub config: Option<HashMap<String, String>>,
    pub api_extensions: Option<Vec<String>>,
    pub api_status: Option<String>,
    pub api_version: Option<String>,
    pub auth: Option<String>,
    pub auth_user_name: Option<String>,
    pub auth_user_method: Option<String>,
    pub environment: Option<LxdServerEnvironment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdServerEnvironment {
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub os_name: Option<String>,
    pub os_version: Option<String>,
    pub kernel: Option<String>,
    pub kernel_version: Option<String>,
    pub kernel_architecture: Option<String>,
    pub storage: Option<String>,
    pub storage_version: Option<String>,
    pub driver: Option<String>,
    pub driver_version: Option<String>,
    pub server_clustered: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdCluster {
    pub server_name: Option<String>,
    pub enabled: bool,
    pub member_config: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdClusterMember {
    pub server_name: Option<String>,
    pub url: Option<String>,
    pub database: Option<bool>,
    pub status: Option<String>,
    pub message: Option<String>,
    pub architecture: Option<String>,
    pub description: Option<String>,
    pub roles: Option<Vec<String>>,
    pub failure_domain: Option<String>,
    pub config: Option<HashMap<String, String>>,
    pub groups: Option<Vec<String>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Instances (containers / VMs)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum InstanceType {
    Container,
    #[serde(rename = "virtual-machine")]
    VirtualMachine,
}

impl Default for InstanceType {
    fn default() -> Self {
        Self::Container
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum InstanceStatus {
    Running,
    Stopped,
    Frozen,
    Error,
    #[serde(other)]
    Unknown,
}

impl Default for InstanceStatus {
    fn default() -> Self {
        Self::Unknown
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct Instance {
    pub name: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub status_code: Option<i32>,
    #[serde(rename = "type")]
    pub instance_type: Option<String>,
    pub architecture: Option<String>,
    pub config: Option<HashMap<String, String>>,
    pub devices: Option<HashMap<String, HashMap<String, String>>>,
    pub ephemeral: Option<bool>,
    pub stateful: Option<bool>,
    pub profiles: Option<Vec<String>>,
    pub created_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub location: Option<String>,
    pub project: Option<String>,
    pub expanded_config: Option<HashMap<String, String>>,
    pub expanded_devices: Option<HashMap<String, HashMap<String, String>>>,
    pub backups: Option<Vec<String>>,
    pub snapshots: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateInstanceRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_type: Option<String>,
    /// Source image (alias, fingerprint, or server:alias)
    pub source: InstanceSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profiles: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub devices: Option<HashMap<String, HashMap<String, String>>>,
    #[serde(default)]
    pub ephemeral: bool,
    /// Start instance immediately after creation
    #[serde(default)]
    pub start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct InstanceSource {
    #[serde(rename = "type")]
    pub source_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// For migration source
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub certificate: Option<String>,
    /// For copy source
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_image: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstanceRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub devices: Option<HashMap<String, HashMap<String, String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profiles: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ephemeral: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct InstanceState {
    pub status: Option<String>,
    pub status_code: Option<i32>,
    pub cpu: Option<InstanceCpu>,
    pub disk: Option<HashMap<String, InstanceDisk>>,
    pub memory: Option<InstanceMemory>,
    pub network: Option<HashMap<String, InstanceNetwork>>,
    pub pid: Option<i64>,
    pub processes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InstanceCpu {
    pub usage: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InstanceDisk {
    pub usage: Option<i64>,
    pub total: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InstanceMemory {
    pub usage: Option<i64>,
    pub usage_peak: Option<i64>,
    pub total: Option<i64>,
    pub swap_usage: Option<i64>,
    pub swap_usage_peak: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InstanceNetwork {
    pub addresses: Option<Vec<InstanceAddress>>,
    pub counters: Option<InstanceNetCounters>,
    pub hwaddr: Option<String>,
    pub host_name: Option<String>,
    pub mtu: Option<i32>,
    pub state: Option<String>,
    #[serde(rename = "type")]
    pub net_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InstanceAddress {
    pub family: Option<String>,
    pub address: Option<String>,
    pub netmask: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InstanceNetCounters {
    pub bytes_received: Option<i64>,
    pub bytes_sent: Option<i64>,
    pub packets_received: Option<i64>,
    pub packets_sent: Option<i64>,
    pub errors_received: Option<i64>,
    pub errors_sent: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct InstanceExecRequest {
    pub command: Vec<String>,
    #[serde(default)]
    pub wait_for_websocket: bool,
    #[serde(default)]
    pub interactive: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<i32>,
    pub environment: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default)]
    pub record_output: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstanceExecResult {
    pub return_code: Option<i32>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct InstanceConsoleRequest {
    #[serde(rename = "type")]
    pub console_type: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Snapshots
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct InstanceSnapshot {
    pub name: String,
    pub created_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub stateful: Option<bool>,
    pub config: Option<HashMap<String, String>>,
    pub devices: Option<HashMap<String, HashMap<String, String>>>,
    pub size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateSnapshotRequest {
    pub instance: String,
    pub name: String,
    #[serde(default)]
    pub stateful: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSnapshotRequest {
    pub instance: String,
    pub snapshot: String,
    #[serde(default)]
    pub stateful: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Backups
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct InstanceBackup {
    pub name: String,
    pub created_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub instance_only: Option<bool>,
    pub optimized_storage: Option<bool>,
    pub compression_algorithm: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateBackupRequest {
    pub instance: String,
    pub name: String,
    #[serde(default)]
    pub instance_only: bool,
    #[serde(default)]
    pub optimized_storage: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compression_algorithm: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Images
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdImage {
    pub fingerprint: Option<String>,
    pub filename: Option<String>,
    pub size: Option<i64>,
    pub architecture: Option<String>,
    #[serde(rename = "type")]
    pub image_type: Option<String>,
    pub public: Option<bool>,
    pub auto_update: Option<bool>,
    pub created_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub uploaded_at: Option<DateTime<Utc>>,
    pub update_source: Option<ImageSource>,
    pub properties: Option<HashMap<String, String>>,
    pub aliases: Option<Vec<ImageAlias>>,
    pub profiles: Option<Vec<String>>,
    pub cached: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ImageAlias {
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ImageSource {
    pub server: Option<String>,
    pub protocol: Option<String>,
    pub alias: Option<String>,
    pub certificate: Option<String>,
    pub image_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateImageAliasRequest {
    pub name: String,
    pub description: Option<String>,
    pub target: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Profiles
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdProfile {
    pub name: String,
    pub description: Option<String>,
    pub config: Option<HashMap<String, String>>,
    pub devices: Option<HashMap<String, HashMap<String, String>>>,
    pub used_by: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateProfileRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub devices: Option<HashMap<String, HashMap<String, String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProfileRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub devices: Option<HashMap<String, HashMap<String, String>>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Networks
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdNetwork {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub network_type: Option<String>,
    pub status: Option<String>,
    pub managed: Option<bool>,
    pub config: Option<HashMap<String, String>>,
    pub used_by: Option<Vec<String>>,
    pub locations: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateNetworkRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub network_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdNetworkState {
    pub addresses: Option<Vec<InstanceAddress>>,
    pub counters: Option<InstanceNetCounters>,
    pub hwaddr: Option<String>,
    pub mtu: Option<i32>,
    pub state: Option<String>,
    #[serde(rename = "type")]
    pub net_type: Option<String>,
    pub bond: Option<serde_json::Value>,
    pub bridge: Option<serde_json::Value>,
    pub vlan: Option<serde_json::Value>,
    pub ovn: Option<serde_json::Value>,
}

// Network ACLs
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdNetworkAcl {
    pub name: String,
    pub description: Option<String>,
    pub egress: Option<Vec<NetworkAclRule>>,
    pub ingress: Option<Vec<NetworkAclRule>>,
    pub config: Option<HashMap<String, String>>,
    pub used_by: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NetworkAclRule {
    pub action: Option<String>,
    pub description: Option<String>,
    pub source: Option<String>,
    pub destination: Option<String>,
    pub protocol: Option<String>,
    pub source_port: Option<String>,
    pub destination_port: Option<String>,
    pub icmp_type: Option<String>,
    pub icmp_code: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateNetworkAclRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub egress: Option<Vec<NetworkAclRule>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ingress: Option<Vec<NetworkAclRule>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<HashMap<String, String>>,
}

// Network Forwards (port forwarding)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdNetworkForward {
    pub listen_address: Option<String>,
    pub description: Option<String>,
    pub config: Option<HashMap<String, String>>,
    pub ports: Option<Vec<NetworkForwardPort>>,
    pub location: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NetworkForwardPort {
    pub description: Option<String>,
    pub protocol: Option<String>,
    pub listen_ports: Option<String>,
    pub target_address: Option<String>,
    pub target_ports: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateNetworkForwardRequest {
    pub network: String,
    pub listen_address: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ports: Option<Vec<NetworkForwardPort>>,
}

// Network Zones (DNS)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdNetworkZone {
    pub name: String,
    pub description: Option<String>,
    pub config: Option<HashMap<String, String>>,
    pub used_by: Option<Vec<String>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct StoragePool {
    pub name: String,
    pub description: Option<String>,
    pub driver: Option<String>,
    pub status: Option<String>,
    pub config: Option<HashMap<String, String>>,
    pub used_by: Option<Vec<String>>,
    pub locations: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateStoragePoolRequest {
    pub name: String,
    pub driver: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct StoragePoolResources {
    pub space: Option<StorageSpace>,
    pub inodes: Option<StorageInodes>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StorageSpace {
    pub used: Option<i64>,
    pub total: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StorageInodes {
    pub used: Option<i64>,
    pub total: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct StorageVolume {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub volume_type: Option<String>,
    pub content_type: Option<String>,
    pub config: Option<HashMap<String, String>>,
    pub used_by: Option<Vec<String>>,
    pub location: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateStorageVolumeRequest {
    pub pool: String,
    pub name: String,
    #[serde(rename = "type")]
    pub volume_type: Option<String>,
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct StorageVolumeSnapshot {
    pub name: String,
    pub description: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub content_type: Option<String>,
    pub config: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageBucket {
    pub name: String,
    pub description: Option<String>,
    pub config: Option<HashMap<String, String>>,
    pub location: Option<String>,
    pub project: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateStorageBucketRequest {
    pub pool: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageBucketKey {
    pub name: String,
    pub description: Option<String>,
    pub role: Option<String>,
    pub access_key: Option<String>,
    pub secret_key: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Projects
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdProject {
    pub name: String,
    pub description: Option<String>,
    pub config: Option<HashMap<String, String>>,
    pub used_by: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config: Option<HashMap<String, String>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Operations
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdOperation {
    pub id: Option<String>,
    pub class: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub status_code: Option<i32>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub resources: Option<HashMap<String, Vec<String>>>,
    pub metadata: Option<serde_json::Value>,
    pub may_cancel: Option<bool>,
    pub err: Option<String>,
    pub location: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Certificates
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdCertificate {
    pub fingerprint: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub cert_type: Option<String>,
    pub restricted: Option<bool>,
    pub projects: Option<Vec<String>>,
    pub certificate: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AddCertificateRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub cert_type: Option<String>,
    pub certificate: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default)]
    pub restricted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projects: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Warnings & Events
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdWarning {
    pub uuid: Option<String>,
    pub status: Option<String>,
    pub severity: Option<String>,
    pub entity_url: Option<String>,
    #[serde(rename = "type")]
    pub warning_type: Option<String>,
    pub project: Option<String>,
    pub message: Option<String>,
    pub count: Option<i32>,
    pub first_seen_at: Option<DateTime<Utc>>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub location: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Instance Logs & Files
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstanceLogFile {
    pub name: String,
    pub size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferRequest {
    pub instance: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(rename = "type")]
    pub file_type: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Server Resources
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ServerResources {
    pub cpu: Option<CpuResources>,
    pub memory: Option<MemoryResources>,
    pub gpu: Option<GpuResources>,
    pub network: Option<NetworkResources>,
    pub storage: Option<StorageResources>,
    pub system: Option<SystemResources>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CpuResources {
    pub architecture: Option<String>,
    pub sockets: Option<Vec<serde_json::Value>>,
    pub total: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MemoryResources {
    pub used: Option<i64>,
    pub total: Option<i64>,
    pub hugepages_used: Option<i64>,
    pub hugepages_total: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GpuResources {
    pub cards: Option<Vec<serde_json::Value>>,
    pub total: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NetworkResources {
    pub cards: Option<Vec<serde_json::Value>>,
    pub total: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StorageResources {
    pub disks: Option<Vec<serde_json::Value>>,
    pub total: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SystemResources {
    pub uuid: Option<String>,
    pub vendor: Option<String>,
    pub product: Option<String>,
    pub family: Option<String>,
    pub version: Option<String>,
    pub serial: Option<String>,
    #[serde(rename = "type")]
    pub system_type: Option<String>,
    pub firmware: Option<serde_json::Value>,
    pub chassis: Option<serde_json::Value>,
    pub motherboard: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Migration
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MigrateInstanceRequest {
    pub name: String,
    pub target_server: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_project: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_pool: Option<String>,
    #[serde(default)]
    pub live: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_name: Option<String>,
    /// For remote migrations, TLS client cert of target
    #[serde(skip_serializing_if = "Option::is_none")]
    pub certificate: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Network Load Balancers
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdNetworkLoadBalancer {
    pub listen_address: Option<String>,
    pub description: Option<String>,
    pub config: Option<HashMap<String, String>>,
    pub backends: Option<Vec<LoadBalancerBackend>>,
    pub ports: Option<Vec<LoadBalancerPort>>,
    pub location: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoadBalancerBackend {
    pub name: Option<String>,
    pub description: Option<String>,
    pub target_address: Option<String>,
    pub target_port: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoadBalancerPort {
    pub description: Option<String>,
    pub protocol: Option<String>,
    pub listen_ports: Option<String>,
    pub target_backend: Option<Vec<String>>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Network Peers (cross-project networking)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct LxdNetworkPeer {
    pub name: Option<String>,
    pub description: Option<String>,
    pub target_project: Option<String>,
    pub target_network: Option<String>,
    pub status: Option<String>,
    pub config: Option<HashMap<String, String>>,
}
