//! # Teleport Types
//!
//! Core data types for the Teleport integration — nodes, clusters, databases,
//! apps, desktops, roles, sessions, recordings, audit events, certificates,
//! MFA devices, and connection profiles.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

// ── Connection & Profile ────────────────────────────────────────

/// A managed Teleport connection profile inside SortOfRemoteNG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeleportConnection {
    pub id: String,
    pub name: String,
    pub config: TeleportConfig,
    pub status: TeleportStatus,
    pub created_at: DateTime<Utc>,
    pub logged_in_at: Option<DateTime<Utc>>,
    pub cluster_name: Option<String>,
    pub proxy_address: Option<String>,
    pub username: Option<String>,
    pub roles: Vec<String>,
    pub traits: HashMap<String, Vec<String>>,
    pub cert_expires: Option<DateTime<Utc>>,
    pub tsh_version: Option<String>,
    pub cluster_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TeleportStatus {
    LoggedOut,
    LoggingIn,
    LoggedIn,
    CertExpired,
    MfaRequired,
    Error(String),
}

/// Configuration for connecting to a Teleport cluster.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TeleportConfig {
    /// Proxy address, e.g. `teleport.example.com:443`.
    pub proxy: String,
    /// Authentication connector (local, github, saml, oidc).
    pub auth_connector: Option<String>,
    /// User to log in as.
    pub user: Option<String>,
    /// Request specific roles on login.
    pub request_roles: Vec<String>,
    /// TTL for issued certificates (e.g. "8h", "12h").
    pub ttl: Option<String>,
    /// Enable MFA requirement per session.
    pub mfa_mode: Option<MfaMode>,
    /// Kubernetes cluster to select after login.
    pub kube_cluster: Option<String>,
    /// Database service to select after login.
    pub db_service: Option<String>,
    /// Application to select after login.
    pub app: Option<String>,
    /// Hardware key policy.
    pub hardware_key_policy: Option<HardwareKeyPolicy>,
    /// Custom tsh binary path.
    pub tsh_path: Option<String>,
    /// Extra environment variables for tsh.
    pub env: HashMap<String, String>,
    /// Whether to enable tracing.
    pub enable_tracing: bool,
    /// Insecure mode (skip TLS verification) — for dev only.
    pub insecure: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MfaMode {
    Off,
    Optional,
    Required,
    HardwareKeyTouch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HardwareKeyPolicy {
    None,
    Touch,
    Pin,
    TouchAndPin,
}

// ── Node (SSH Server) ───────────────────────────────────────────

/// An SSH node registered with Teleport.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeleportNode {
    pub id: String,
    pub hostname: String,
    pub address: String,
    pub labels: HashMap<String, String>,
    pub tunnel: bool,
    pub sub_kind: NodeSubKind,
    pub namespace: String,
    pub cluster_name: String,
    pub version: Option<String>,
    pub os: Option<String>,
    pub public_addrs: Vec<String>,
    pub peer_addr: Option<String>,
    pub rotation: Option<RotationStatus>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeSubKind {
    Regular,
    OpenSSH,
    OpenSSHEICE,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RotationStatus {
    pub phase: String,
    pub state: String,
    pub last_rotated: Option<DateTime<Utc>>,
}

// ── Kubernetes Cluster ──────────────────────────────────────────

/// A Kubernetes cluster registered with Teleport.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeleportKubeCluster {
    pub id: String,
    pub name: String,
    pub labels: HashMap<String, String>,
    pub cluster_name: String,
    pub kube_users: Vec<String>,
    pub kube_groups: Vec<String>,
    pub status: ResourceStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResourceStatus {
    Online,
    Offline,
    Unknown,
}

// ── Database ────────────────────────────────────────────────────

/// A database registered with Teleport.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeleportDatabase {
    pub id: String,
    pub name: String,
    pub protocol: DatabaseProtocol,
    pub uri: String,
    pub labels: HashMap<String, String>,
    pub cluster_name: String,
    pub db_users: Vec<String>,
    pub db_names: Vec<String>,
    pub hostname: Option<String>,
    pub ca_cert: Option<String>,
    pub dynamic_labels: HashMap<String, String>,
    pub aws_rds: Option<AwsRdsMetadata>,
    pub status: ResourceStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DatabaseProtocol {
    Postgres,
    Mysql,
    MongoDB,
    CockroachDB,
    Redis,
    SqlServer,
    Snowflake,
    Cassandra,
    Elasticsearch,
    OpenSearch,
    DynamoDB,
    Clickhouse,
    Spanner,
    Oracle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsRdsMetadata {
    pub instance_id: Option<String>,
    pub cluster_id: Option<String>,
    pub region: String,
    pub account_id: Option<String>,
    pub resource_id: Option<String>,
    pub iam_auth: bool,
}

// ── Application ─────────────────────────────────────────────────

/// A web or TCP application registered with Teleport.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeleportApp {
    pub id: String,
    pub name: String,
    pub uri: String,
    pub public_addr: Option<String>,
    pub labels: HashMap<String, String>,
    pub cluster_name: String,
    pub description: Option<String>,
    pub insecure_skip_verify: bool,
    pub rewrite: Option<AppRewrite>,
    pub app_type: AppType,
    pub aws_console: bool,
    pub status: ResourceStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppType {
    Http,
    Tcp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppRewrite {
    pub redirect: Vec<String>,
    pub headers: Vec<HeaderRewrite>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeaderRewrite {
    pub name: String,
    pub value: String,
}

// ── Desktop ─────────────────────────────────────────────────────

/// A Windows desktop registered with Teleport.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeleportDesktop {
    pub id: String,
    pub name: String,
    pub address: String,
    pub domain: String,
    pub labels: HashMap<String, String>,
    pub cluster_name: String,
    pub host_id: Option<String>,
    pub logins: Vec<String>,
    pub non_ad: bool,
    pub status: ResourceStatus,
}

// ── Role / RBAC ─────────────────────────────────────────────────

/// A Teleport role definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeleportRole {
    pub name: String,
    pub description: String,
    pub metadata: RoleMetadata,
    pub spec: RoleSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleMetadata {
    pub labels: HashMap<String, String>,
    pub revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleSpec {
    pub allow: RoleConditions,
    pub deny: RoleConditions,
    pub options: RoleOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RoleConditions {
    pub logins: Vec<String>,
    pub node_labels: HashMap<String, Vec<String>>,
    pub kube_groups: Vec<String>,
    pub kube_users: Vec<String>,
    pub db_labels: HashMap<String, Vec<String>>,
    pub db_names: Vec<String>,
    pub db_users: Vec<String>,
    pub app_labels: HashMap<String, Vec<String>>,
    pub desktop_labels: HashMap<String, Vec<String>>,
    pub desktop_logins: Vec<String>,
    pub rules: Vec<AccessRule>,
    pub request: Option<AccessRequestConditions>,
    pub require_session_join: Vec<SessionJoinRequirement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessRule {
    pub resources: Vec<String>,
    pub verbs: Vec<String>,
    #[serde(rename = "where")]
    pub where_clause: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessRequestConditions {
    pub roles: Vec<String>,
    pub claims_to_roles: Vec<ClaimMapping>,
    pub thresholds: Vec<AccessRequestThreshold>,
    pub max_duration: Option<String>,
    pub annotations: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimMapping {
    pub claim: String,
    pub value: String,
    pub roles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessRequestThreshold {
    pub name: String,
    pub approve: u32,
    pub deny: u32,
    pub filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionJoinRequirement {
    pub name: String,
    pub filter: Option<String>,
    pub kinds: Vec<String>,
    pub count: u32,
    pub modes: Vec<String>,
    pub on_leave: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleOptions {
    pub forward_agent: bool,
    pub max_session_ttl: Option<String>,
    pub port_forwarding: bool,
    pub cert_format: Option<String>,
    pub client_idle_timeout: Option<String>,
    pub disconnect_expired_cert: bool,
    pub permit_x11_forwarding: bool,
    pub enhanced_recording: Vec<String>,
    pub desktop_clipboard: bool,
    pub desktop_directory_sharing: bool,
    pub pin_source_ip: bool,
    pub require_session_mfa: Option<MfaMode>,
    pub lock: Option<String>,
    pub record_session: Option<RecordSessionConfig>,
    pub create_host_user: bool,
    pub create_host_user_mode: Option<String>,
    pub ssh_file_copy: bool,
    pub idp: Option<IdpOptions>,
}

impl Default for RoleOptions {
    fn default() -> Self {
        Self {
            forward_agent: false,
            max_session_ttl: None,
            port_forwarding: true,
            cert_format: None,
            client_idle_timeout: None,
            disconnect_expired_cert: false,
            permit_x11_forwarding: false,
            enhanced_recording: Vec::new(),
            desktop_clipboard: true,
            desktop_directory_sharing: true,
            pin_source_ip: false,
            require_session_mfa: None,
            lock: None,
            record_session: None,
            create_host_user: false,
            create_host_user_mode: None,
            ssh_file_copy: true,
            idp: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordSessionConfig {
    pub default: String,
    pub desktop: bool,
    pub ssh: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdpOptions {
    pub saml: Option<IdpSamlOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdpSamlOptions {
    pub enabled: bool,
}

// ── Session ─────────────────────────────────────────────────────

/// An active or recently ended session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeleportSession {
    pub id: String,
    pub session_type: SessionType,
    pub namespace: String,
    pub cluster_name: String,
    pub login: String,
    pub user: String,
    pub server_id: Option<String>,
    pub server_hostname: Option<String>,
    pub server_addr: Option<String>,
    pub participants: Vec<SessionParticipant>,
    pub created: DateTime<Utc>,
    pub last_active: DateTime<Utc>,
    pub ended: Option<DateTime<Utc>>,
    pub state: SessionState,
    pub interactive: bool,
    pub enhanced_recording: bool,
    pub command: Option<String>,
    pub kube_cluster: Option<String>,
    pub database_name: Option<String>,
    pub app_name: Option<String>,
    pub desktop_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionType {
    Ssh,
    Kubernetes,
    Database,
    App,
    Desktop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionState {
    Running,
    Terminated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionParticipant {
    pub user: String,
    pub mode: ParticipantMode,
    pub last_active: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ParticipantMode {
    Observer,
    Moderator,
    Peer,
}

// ── Session Recording ───────────────────────────────────────────

/// Metadata for a session recording.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecording {
    pub session_id: String,
    pub session_type: SessionType,
    pub cluster_name: String,
    pub user: String,
    pub login: Option<String>,
    pub server_hostname: Option<String>,
    pub participants: Vec<String>,
    pub created: DateTime<Utc>,
    pub duration_ms: u64,
    pub size_bytes: u64,
    pub interactive: bool,
    pub enhanced_recording: bool,
    pub playback_url: Option<String>,
}

// ── Audit Event ─────────────────────────────────────────────────

/// An audit event from Teleport.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: String,
    pub event_type: String,
    pub code: String,
    pub time: DateTime<Utc>,
    pub user: Option<String>,
    pub login: Option<String>,
    pub namespace: Option<String>,
    pub server_id: Option<String>,
    pub cluster_name: Option<String>,
    pub message: String,
    pub success: bool,
    pub metadata: HashMap<String, serde_json::Value>,
}

// ── Trusted Cluster ─────────────────────────────────────────────

/// A trusted (leaf/root) cluster.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustedCluster {
    pub name: String,
    pub enabled: bool,
    pub role_map: Vec<RoleMapping>,
    pub token: Option<String>,
    pub proxy_address: String,
    pub reverse_tunnel_address: Option<String>,
    pub status: TrustedClusterStatus,
    pub last_heartbeat: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrustedClusterStatus {
    Online,
    Offline,
    Establishing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleMapping {
    pub remote: String,
    pub local: Vec<String>,
}

// ── Certificate ─────────────────────────────────────────────────

/// Information about a user certificate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserCertificate {
    pub user: String,
    pub valid_before: DateTime<Utc>,
    pub valid_after: DateTime<Utc>,
    pub principals: Vec<String>,
    pub key_id: String,
    pub cert_type: CertType,
    pub extensions: HashMap<String, String>,
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CertType {
    User,
    Host,
    Db,
    Kube,
    App,
    Desktop,
}

// ── MFA Device ──────────────────────────────────────────────────

/// A registered MFA device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MfaDevice {
    pub id: String,
    pub name: String,
    pub device_type: MfaDeviceType,
    pub added_at: DateTime<Utc>,
    pub last_used: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MfaDeviceType {
    Totp,
    WebAuthn,
    Sso,
}

// ── Access Request ──────────────────────────────────────────────

/// A just-in-time access request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessRequest {
    pub id: String,
    pub user: String,
    pub roles: Vec<String>,
    pub state: AccessRequestState,
    pub reason: Option<String>,
    pub created: DateTime<Utc>,
    pub expires: DateTime<Utc>,
    pub resolved_by: Option<String>,
    pub resolve_reason: Option<String>,
    pub annotations: HashMap<String, Vec<String>>,
    pub thresholds: Vec<AccessRequestThreshold>,
    pub reviews: Vec<AccessRequestReview>,
    pub suggested_reviewers: Vec<String>,
    pub max_duration: Option<String>,
    pub resources: Vec<ResourceId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AccessRequestState {
    Pending,
    Approved,
    Denied,
    Expired,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessRequestReview {
    pub author: String,
    pub state: AccessRequestState,
    pub reason: Option<String>,
    pub created: DateTime<Utc>,
    pub annotations: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceId {
    pub kind: String,
    pub name: String,
    pub cluster: String,
    pub sub_resource: Option<String>,
}

// ── Lock ────────────────────────────────────────────────────────

/// A Teleport lock.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeleportLock {
    pub name: String,
    pub message: String,
    pub target: LockTarget,
    pub expires: Option<DateTime<Utc>>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockTarget {
    pub user: Option<String>,
    pub role: Option<String>,
    pub login: Option<String>,
    pub node: Option<String>,
    pub mfa_device: Option<String>,
    pub windows_desktop: Option<String>,
    pub access_request: Option<String>,
    pub device: Option<String>,
}

// ── Health / Diagnostics ────────────────────────────────────────

/// Full cluster health check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterHealthCheck {
    pub overall: HealthStatus,
    pub auth_server: ServerHealth,
    pub proxy_server: ServerHealth,
    pub nodes_connected: u32,
    pub nodes_total: u32,
    pub cluster_name: String,
    pub cluster_version: String,
    pub license_type: Option<String>,
    pub trusted_clusters: u32,
    pub trusted_clusters_online: u32,
    pub active_sessions: u32,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub checked_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerHealth {
    pub address: String,
    pub reachable: bool,
    pub version: Option<String>,
    pub latency_ms: Option<f64>,
}

// ── Events ──────────────────────────────────────────────────────

/// Events emitted by the Teleport integration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TeleportEvent {
    LoggedIn {
        cluster: String,
        user: String,
    },
    LoggedOut {
        cluster: String,
    },
    CertExpiring {
        cluster: String,
        expires_at: DateTime<Utc>,
    },
    SessionStarted {
        session_id: String,
        session_type: SessionType,
    },
    SessionEnded {
        session_id: String,
    },
    AccessRequestCreated {
        request_id: String,
    },
    AccessRequestResolved {
        request_id: String,
        state: AccessRequestState,
    },
    ClusterHealthChanged {
        cluster: String,
        status: HealthStatus,
    },
    MfaChallenge {
        cluster: String,
    },
}

// ── Service State Alias ─────────────────────────────────────────

pub type TeleportServiceState = Arc<Mutex<crate::service::TeleportService>>;
