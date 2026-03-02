//! # Gateway Types
//!
//! Core data types for the gateway system — sessions, proxy routes, policies,
//! metrics, and configuration primitives.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;

// ── Gateway Identity ────────────────────────────────────────────────

/// Information about this gateway instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayInfo {
    /// Unique gateway instance ID (UUID v4)
    pub id: String,
    /// Human-readable gateway name
    pub name: String,
    /// Gateway version string
    pub version: String,
    /// When the gateway was started
    pub started_at: DateTime<Utc>,
    /// The address the gateway is listening on
    pub listen_addr: String,
    /// Whether the gateway is running in headless mode
    pub headless: bool,
    /// Operating system / platform info
    pub platform: String,
}

// ── Sessions ────────────────────────────────────────────────────────

/// A gateway-proxied session representing a connection routed through the gateway.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewaySession {
    /// Unique session ID (UUID v4)
    pub id: String,
    /// User ID of the connecting user
    pub user_id: String,
    /// Username (display purposes)
    pub username: String,
    /// The protocol being proxied
    pub protocol: GatewayProtocol,
    /// Source address (client side)
    pub source_addr: String,
    /// Target host:port being accessed
    pub target_addr: String,
    /// Optional target hostname (for display)
    pub target_hostname: Option<String>,
    /// Proxy route used
    pub route_id: Option<String>,
    /// Session state
    pub state: SessionState,
    /// When the session was created
    pub created_at: DateTime<Utc>,
    /// When the session became active (connected)
    pub connected_at: Option<DateTime<Utc>>,
    /// When the session ended
    pub ended_at: Option<DateTime<Utc>>,
    /// Bytes transferred (client → target)
    pub bytes_sent: u64,
    /// Bytes transferred (target → client)
    pub bytes_received: u64,
    /// Whether this session is being recorded
    pub recording: bool,
    /// Recording ID (if recording is active)
    pub recording_id: Option<String>,
    /// Additional session metadata
    pub metadata: HashMap<String, String>,
}

/// Protocols the gateway can proxy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GatewayProtocol {
    Ssh,
    Rdp,
    Vnc,
    Telnet,
    Ftp,
    Sftp,
    Http,
    Https,
    MySql,
    PostgreSql,
    MsSql,
    MongoDB,
    Redis,
    Raw,
}

impl GatewayProtocol {
    /// Get the default port for this protocol.
    pub fn default_port(&self) -> u16 {
        match self {
            Self::Ssh | Self::Sftp => 22,
            Self::Rdp => 3389,
            Self::Vnc => 5900,
            Self::Telnet => 23,
            Self::Ftp => 21,
            Self::Http => 80,
            Self::Https => 443,
            Self::MySql => 3306,
            Self::PostgreSql => 5432,
            Self::MsSql => 1433,
            Self::MongoDB => 27017,
            Self::Redis => 6379,
            Self::Raw => 0,
        }
    }
}

/// State of a gateway session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionState {
    /// Session created, waiting to connect
    Pending,
    /// Authenticating with the target
    Authenticating,
    /// Active and proxying data
    Active,
    /// Temporarily paused
    Paused,
    /// Session ended normally
    Closed,
    /// Session ended due to error
    Error,
    /// Session terminated by policy/admin
    Terminated,
}

// ── Proxy Routes ────────────────────────────────────────────────────

/// A proxy route defining how connections to a target are handled.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyRoute {
    /// Unique route ID
    pub id: String,
    /// Route name for display
    pub name: String,
    /// Route description
    pub description: Option<String>,
    /// Protocol this route handles
    pub protocol: GatewayProtocol,
    /// Local port the gateway listens on for this route
    pub listen_port: u16,
    /// Target host
    pub target_host: String,
    /// Target port
    pub target_port: u16,
    /// Whether this route is enabled
    pub enabled: bool,
    /// Maximum concurrent sessions through this route
    pub max_sessions: Option<u32>,
    /// Whether to use TLS for the upstream connection
    pub upstream_tls: bool,
    /// Whether to record sessions on this route
    pub record_sessions: bool,
    /// Policy IDs that apply to this route
    pub policy_ids: Vec<String>,
    /// Bandwidth limit in bytes/sec (0 = unlimited)
    pub bandwidth_limit: u64,
    /// Connection timeout in seconds
    pub connect_timeout_secs: u32,
    /// Idle timeout in seconds (0 = no timeout)
    pub idle_timeout_secs: u32,
    /// When this route was created
    pub created_at: DateTime<Utc>,
}

// ── Access Policies ─────────────────────────────────────────────────

/// An access policy controlling who can use the gateway and how.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessPolicy {
    /// Unique policy ID
    pub id: String,
    /// Policy name
    pub name: String,
    /// Policy description
    pub description: Option<String>,
    /// Whether this policy is enabled
    pub enabled: bool,
    /// Policy priority (lower = evaluated first)
    pub priority: u32,
    /// The action to take when this policy matches
    pub action: PolicyAction,
    /// User conditions (who this policy applies to)
    pub user_conditions: Vec<UserCondition>,
    /// Target conditions (what targets this policy covers)
    pub target_conditions: Vec<TargetCondition>,
    /// Time conditions (when this policy is active)
    pub time_conditions: Vec<TimeCondition>,
    /// Connection limits
    pub connection_limits: Option<ConnectionLimits>,
    /// When this policy was created
    pub created_at: DateTime<Utc>,
    /// When this policy was last modified
    pub updated_at: DateTime<Utc>,
}

/// What to do when a policy matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PolicyAction {
    /// Allow the connection
    Allow,
    /// Deny the connection
    Deny,
    /// Allow but require MFA
    RequireMfa,
    /// Allow but force session recording
    AllowWithRecording,
    /// Allow with bandwidth throttling
    AllowThrottled,
}

/// A condition matching users.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum UserCondition {
    /// Match a specific user ID
    UserId(String),
    /// Match users in a specific group/team
    Group(String),
    /// Match any authenticated user
    AnyAuthenticated,
    /// Match users from a specific IP range (CIDR)
    SourceIp(String),
}

/// A condition matching target hosts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TargetCondition {
    /// Match a specific host
    Host(String),
    /// Match a specific host:port
    HostPort(String, u16),
    /// Match an IP subnet (CIDR notation)
    Subnet(String),
    /// Match a specific protocol
    Protocol(GatewayProtocol),
    /// Match any target
    Any,
}

/// Time-based conditions for policy activation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeCondition {
    /// Days of week (0=Sunday, 6=Saturday). Empty = all days.
    pub days_of_week: Vec<u8>,
    /// Start hour (0-23). None = no start restriction.
    pub start_hour: Option<u8>,
    /// End hour (0-23). None = no end restriction.
    pub end_hour: Option<u8>,
    /// Timezone (IANA name, e.g., "America/New_York")
    pub timezone: Option<String>,
}

/// Connection limits enforced by a policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionLimits {
    /// Max concurrent sessions per user
    pub max_per_user: Option<u32>,
    /// Max concurrent sessions total
    pub max_total: Option<u32>,
    /// Max session duration in seconds
    pub max_duration_secs: Option<u64>,
    /// Max idle time before disconnect in seconds
    pub max_idle_secs: Option<u64>,
    /// Max bandwidth per session in bytes/sec
    pub max_bandwidth: Option<u64>,
}

// ── Health & Metrics ────────────────────────────────────────────────

/// Gateway health status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayHealth {
    /// Overall health status
    pub status: HealthStatus,
    /// Gateway uptime in seconds
    pub uptime_secs: u64,
    /// Current active session count
    pub active_sessions: u32,
    /// Total sessions since start
    pub total_sessions: u64,
    /// Memory usage in bytes
    pub memory_usage: u64,
    /// CPU usage percentage (0-100)
    pub cpu_usage: f32,
    /// Individual component health checks
    pub checks: Vec<HealthCheck>,
    /// Last check timestamp
    pub last_check: DateTime<Utc>,
}

/// Health status levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HealthStatus {
    /// Everything is operating normally
    Healthy,
    /// Some issues detected but gateway is functional
    Degraded,
    /// Critical issues — gateway may not function correctly
    Unhealthy,
}

/// An individual health check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheck {
    /// Check name
    pub name: String,
    /// Check status
    pub status: HealthStatus,
    /// Optional message
    pub message: Option<String>,
    /// Response time in milliseconds (if applicable)
    pub response_time_ms: Option<u64>,
}

/// Connection metrics tracked by the gateway.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayMetrics {
    /// When the metrics collection started
    pub collection_started: DateTime<Utc>,
    /// Total connections handled
    pub total_connections: u64,
    /// Active connections right now
    pub active_connections: u32,
    /// Total bytes sent (all sessions combined)
    pub total_bytes_sent: u64,
    /// Total bytes received (all sessions combined)
    pub total_bytes_received: u64,
    /// Connection errors count
    pub connection_errors: u64,
    /// Policy denials count
    pub policy_denials: u64,
    /// Auth failures count
    pub auth_failures: u64,
    /// Average session duration in seconds
    pub avg_session_duration_secs: f64,
    /// Peak concurrent sessions
    pub peak_concurrent_sessions: u32,
    /// Per-protocol connection counts
    pub connections_by_protocol: HashMap<String, u64>,
    /// Per-user connection counts
    pub connections_by_user: HashMap<String, u64>,
}

// ── Gateway Authentication ──────────────────────────────────────────

/// An API key for gateway authentication.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayApiKey {
    /// Unique key ID
    pub id: String,
    /// Key name/label
    pub name: String,
    /// The hashed API key (never store plaintext)
    pub key_hash: String,
    /// User ID this key belongs to
    pub user_id: String,
    /// Permissions granted by this key
    pub permissions: Vec<GatewayPermission>,
    /// When the key was created
    pub created_at: DateTime<Utc>,
    /// When the key expires (None = never)
    pub expires_at: Option<DateTime<Utc>>,
    /// Whether the key is active
    pub active: bool,
    /// Last time this key was used
    pub last_used: Option<DateTime<Utc>>,
}

/// Permissions for gateway API keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GatewayPermission {
    /// Can create proxy sessions
    Connect,
    /// Can view session list and status
    ViewSessions,
    /// Can terminate sessions
    ManageSessions,
    /// Can view/modify routes
    ManageRoutes,
    /// Can view/modify policies
    ManagePolicies,
    /// Can view metrics and health
    ViewMetrics,
    /// Full admin access
    Admin,
}

// ── TLS Configuration ───────────────────────────────────────────────

/// TLS configuration for gateway listeners.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConfig {
    /// Whether TLS is enabled
    pub enabled: bool,
    /// Path to the certificate file (PEM)
    pub cert_path: Option<String>,
    /// Path to the private key file (PEM)
    pub key_path: Option<String>,
    /// Path to the CA certificate for client authentication
    pub ca_cert_path: Option<String>,
    /// Whether to require client certificates (mutual TLS)
    pub require_client_cert: bool,
    /// Minimum TLS version.
    ///
    /// Accepted values: `"1.0"`, `"1.1"`, `"1.2"` (default), `"1.3"`.
    ///
    /// **`"ssl3"`** is recognised for configuration purposes (maps to the
    /// `allow_ssl_3_0` policy flag) but is *not* enforceable at the
    /// transport layer — neither `rustls` nor `native-tls` implement
    /// SSL 3.0.  When `"ssl3"` is set, the effective floor is TLS 1.0
    /// and a warning is emitted.
    pub min_version: String,
}

impl Default for TlsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            cert_path: None,
            key_path: None,
            ca_cert_path: None,
            require_client_cert: false,
            min_version: "1.2".to_string(),
        }
    }
}

/// Type alias for the gateway service state (Tauri managed state pattern).
pub type GatewayServiceState = Arc<Mutex<crate::service::GatewayService>>;
