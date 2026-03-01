use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

// ─── Server Configuration ───────────────────────────────────────────

/// Configuration for connecting to a RustDesk Server Pro instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskServerConfig {
    /// Base URL of the RustDesk server API (e.g., `https://rustdesk.example.com`)
    pub api_url: String,
    /// API bearer token with the required permissions
    pub api_token: String,
    /// Optional relay server override (ip:port)
    pub relay_server: Option<String>,
    /// Optional encryption key for the server
    pub server_key: Option<String>,
    /// Whether the server uses the Pro edition
    pub is_pro: bool,
}

/// Result returned after testing connectivity to the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskServerStatus {
    pub reachable: bool,
    pub version: Option<String>,
    pub api_accessible: bool,
    pub relay_ok: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

// ─── Client / Binary ────────────────────────────────────────────────

/// Information about the locally installed RustDesk client binary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskBinaryInfo {
    pub path: String,
    pub version: Option<String>,
    pub installed: bool,
    pub service_running: bool,
    pub platform: String,
}

/// Configuration for the local RustDesk client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskClientConfig {
    pub id_server: Option<String>,
    pub relay_server: Option<String>,
    pub api_server: Option<String>,
    pub key: Option<String>,
    pub force_relay: bool,
    pub direct_server: Option<String>,
    pub allow_direct_ip: bool,
}

// ─── Connection / Session ───────────────────────────────────────────

/// Parameters for initiating a RustDesk connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskConnectRequest {
    /// Remote device ID (numeric) or IP address for direct access
    pub remote_id: String,
    /// Password for the remote device
    pub password: Option<String>,
    /// Connection type
    pub connection_type: RustDeskConnectionType,
    /// Quality preset
    pub quality: Option<RustDeskQuality>,
    /// Start in view-only mode
    pub view_only: Option<bool>,
    /// Enable audio forwarding
    pub enable_audio: Option<bool>,
    /// Enable clipboard sharing
    pub enable_clipboard: Option<bool>,
    /// Enable file transfer capability
    pub enable_file_transfer: Option<bool>,
    /// Codec preference
    pub codec: Option<RustDeskCodec>,
    /// Force relay connection
    pub force_relay: Option<bool>,
    /// For TCP tunnel: local port
    pub tunnel_local_port: Option<u16>,
    /// For TCP tunnel: remote port
    pub tunnel_remote_port: Option<u16>,
}

/// Type of RustDesk connection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RustDeskConnectionType {
    RemoteDesktop,
    FileTransfer,
    PortForward,
    ViewCamera,
    Terminal,
}

/// Quality presets for remote desktop sessions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RustDeskQuality {
    Best,
    Balanced,
    Low,
    Custom,
}

/// Video codec preference.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RustDeskCodec {
    Auto,
    Vp8,
    Vp9,
    Av1,
    H264,
    H265,
}

/// A live RustDesk session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskSession {
    pub id: String,
    pub remote_id: String,
    pub connection_type: RustDeskConnectionType,
    pub connected: bool,
    pub connected_at: Option<DateTime<Utc>>,
    pub quality: RustDeskQuality,
    pub codec: RustDeskCodec,
    pub view_only: bool,
    pub enable_audio: bool,
    pub enable_clipboard: bool,
    pub enable_file_transfer: bool,
    pub force_relay: bool,
    pub tunnel_local_port: Option<u16>,
    pub tunnel_remote_port: Option<u16>,
    pub password_protected: bool,
    pub remote_device_name: Option<String>,
    pub remote_os: Option<String>,
}

/// Updated session settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskSessionUpdate {
    pub quality: Option<RustDeskQuality>,
    pub codec: Option<RustDeskCodec>,
    pub view_only: Option<bool>,
    pub enable_audio: Option<bool>,
    pub enable_clipboard: Option<bool>,
    pub enable_file_transfer: Option<bool>,
}

/// Input event sent to a remote session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskInputEvent {
    pub input_type: RustDeskInputType,
    pub data: serde_json::Value,
}

/// Input types for remote control.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RustDeskInputType {
    KeyDown,
    KeyUp,
    KeyPress,
    MouseMove,
    MouseClick,
    MouseScroll,
    CtrlAltDel,
    LockScreen,
    Clipboard,
    Touch,
}

// ─── Server Pro API: Devices ────────────────────────────────────────

/// A device registered with RustDesk Server Pro.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskDevice {
    pub id: String,
    pub guid: Option<String>,
    pub device_name: Option<String>,
    pub user_name: Option<String>,
    pub device_username: Option<String>,
    pub os: Option<String>,
    pub online: bool,
    pub enabled: bool,
    pub note: Option<String>,
    pub device_group_name: Option<String>,
    pub user_group_name: Option<String>,
    pub last_online: Option<String>,
    pub created_at: Option<String>,
    pub version: Option<String>,
    pub cpu: Option<String>,
    pub memory: Option<String>,
    pub ip: Option<String>,
}

/// Query filter for listing devices.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeviceFilter {
    pub id: Option<String>,
    pub device_name: Option<String>,
    pub user_name: Option<String>,
    pub group_name: Option<String>,
    pub device_group_name: Option<String>,
    pub offline_days: Option<u32>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

/// Action to perform on devices.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DeviceAction {
    Enable,
    Disable,
    Delete,
}

/// Device assignment parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceAssignment {
    pub device_id: String,
    pub user_name: Option<String>,
    pub device_group_name: Option<String>,
    pub strategy_name: Option<String>,
}

// ─── Server Pro API: Users ──────────────────────────────────────────

/// A user on the RustDesk Server Pro.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskUser {
    pub guid: Option<String>,
    pub name: String,
    pub email: Option<String>,
    pub note: Option<String>,
    pub is_admin: bool,
    pub enabled: bool,
    pub group_name: Option<String>,
    pub created_at: Option<String>,
}

/// Parameters for creating a new user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub name: String,
    pub password: String,
    pub group_name: String,
    pub email: Option<String>,
    pub note: Option<String>,
    pub is_admin: Option<bool>,
}

/// Filter for listing users.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserFilter {
    pub name: Option<String>,
    pub group_name: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

/// Actions on users.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum UserAction {
    Enable,
    Disable,
    Delete,
    ResetTwoFactor,
    ForceLogout,
}

// ─── Server Pro API: Groups ─────────────────────────────────────────

/// A user group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskUserGroup {
    pub guid: Option<String>,
    pub name: String,
    pub note: Option<String>,
    pub user_count: Option<u32>,
    pub accessed_from: Option<serde_json::Value>,
    pub access_to: Option<serde_json::Value>,
}

/// A device group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskDeviceGroup {
    pub guid: Option<String>,
    pub name: String,
    pub note: Option<String>,
    pub device_count: Option<u32>,
    pub accessed_from: Option<serde_json::Value>,
}

/// Parameters for creating a group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
    pub note: Option<String>,
    pub accessed_from: Option<serde_json::Value>,
    pub access_to: Option<serde_json::Value>,
}

// ─── Server Pro API: Address Books ──────────────────────────────────

/// A shared address book on the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskAddressBook {
    pub guid: String,
    pub name: String,
    pub note: Option<String>,
    pub personal: bool,
    pub peer_count: Option<u32>,
    pub rule_count: Option<u32>,
    pub created_at: Option<String>,
}

/// A peer entry in an address book.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressBookPeer {
    pub id: String,
    pub alias: Option<String>,
    pub note: Option<String>,
    pub tags: Vec<String>,
    pub password: Option<String>,
    pub username: Option<String>,
    pub hostname: Option<String>,
    pub platform: Option<String>,
    pub online: Option<bool>,
}

/// A tag in an address book.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressBookTag {
    pub name: String,
    pub color: Option<String>,
}

/// Access rule for an address book.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressBookRule {
    pub guid: Option<String>,
    pub rule_type: AddressBookRuleType,
    pub user: Option<String>,
    pub group: Option<String>,
    pub permission: AddressBookPermission,
}

/// Address book rule target type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AddressBookRuleType {
    User,
    Group,
    Everyone,
}

/// Address book permission level.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AddressBookPermission {
    ReadOnly,
    ReadWrite,
    Full,
}

// ─── Server Pro API: Strategies ─────────────────────────────────────

/// A strategy (policy) on the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskStrategy {
    pub guid: Option<String>,
    pub name: String,
    pub enabled: bool,
    pub note: Option<String>,
    pub settings: Option<serde_json::Value>,
    pub device_count: Option<u32>,
    pub user_count: Option<u32>,
}

/// Assignment target for strategy operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyAssignment {
    pub strategy_name: String,
    pub peers: Option<Vec<String>>,
    pub users: Option<Vec<String>>,
    pub device_groups: Option<Vec<String>>,
}

// ─── Server Pro API: Audit Logs ─────────────────────────────────────

/// Connection audit log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionAudit {
    pub id: Option<u64>,
    pub action: Option<String>,
    pub conn_id: Option<u64>,
    pub remote_id: Option<String>,
    pub remote_name: Option<String>,
    pub peer_id: Option<String>,
    pub peer_name: Option<String>,
    pub ip: Option<String>,
    pub conn_type: Option<u32>,
    pub session_id: Option<String>,
    pub note: Option<String>,
    pub created_at: Option<String>,
}

/// File transfer audit log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAudit {
    pub id: Option<u64>,
    pub remote_id: Option<String>,
    pub peer_id: Option<String>,
    pub path: Option<String>,
    pub direction: Option<String>,
    pub size: Option<u64>,
    pub created_at: Option<String>,
}

/// Alarm audit log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlarmAudit {
    pub id: Option<u64>,
    pub device_id: Option<String>,
    pub alarm_type: Option<String>,
    pub message: Option<String>,
    pub created_at: Option<String>,
}

/// Console audit log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleAudit {
    pub id: Option<u64>,
    pub operator: Option<String>,
    pub action: Option<String>,
    pub detail: Option<String>,
    pub ip: Option<String>,
    pub created_at: Option<String>,
}

/// Filter for audit log queries.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AuditFilter {
    pub remote: Option<String>,
    pub device: Option<String>,
    pub operator: Option<String>,
    pub conn_type: Option<u32>,
    pub days_ago: Option<u32>,
    pub created_at: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

// ─── File Transfer ──────────────────────────────────────────────────

/// A file transfer entry initiated through RustDesk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskFileTransfer {
    pub id: String,
    pub session_id: String,
    pub direction: FileTransferDirection,
    pub local_path: String,
    pub remote_path: String,
    pub file_name: String,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub status: FileTransferStatus,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error: Option<String>,
}

/// Direction of file transfer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FileTransferDirection {
    Upload,
    Download,
}

/// Status of a file transfer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FileTransferStatus {
    Queued,
    InProgress,
    Completed,
    Failed,
    Cancelled,
    Paused,
}

/// A file/directory entry on the remote filesystem.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub permissions: Option<String>,
}

// ─── TCP Tunnel / Port Forward ──────────────────────────────────────

/// A TCP tunnel (port forward) through RustDesk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDeskTunnel {
    pub id: String,
    pub session_id: String,
    pub local_port: u16,
    pub remote_port: u16,
    pub remote_host: String,
    pub active: bool,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub created_at: DateTime<Utc>,
}

/// Request to create a TCP tunnel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTunnelRequest {
    pub remote_id: String,
    pub password: Option<String>,
    pub local_port: u16,
    pub remote_port: u16,
    pub remote_host: Option<String>,
}

// ─── Paginated Response ─────────────────────────────────────────────

/// Generic paginated API response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResponse<T> {
    pub data: Vec<T>,
    pub total: u64,
    pub page: u32,
    pub page_size: u32,
}

// ─── Diagnostics ────────────────────────────────────────────────────

/// Result of a diagnostics check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsReport {
    pub binary: RustDeskBinaryInfo,
    pub server: Option<RustDeskServerStatus>,
    pub local_id: Option<String>,
    pub nat_type: Option<String>,
    pub config_valid: bool,
    pub issues: Vec<DiagnosticsIssue>,
    pub checked_at: DateTime<Utc>,
}

/// A single issue discovered during diagnostics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsIssue {
    pub severity: IssueSeverity,
    pub component: String,
    pub message: String,
    pub suggestion: Option<String>,
}

/// Severity levels for diagnostics issues.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum IssueSeverity {
    Info,
    Warning,
    Error,
    Critical,
}
