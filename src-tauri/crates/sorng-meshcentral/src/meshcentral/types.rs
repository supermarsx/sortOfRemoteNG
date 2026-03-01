//! All data structures, enums, and configuration for MeshCentral.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Connection / Config ────────────────────────────────────────────────────

/// Configuration for connecting to a MeshCentral server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McConnectionConfig {
    /// Base URL of the MeshCentral server (e.g. `https://mesh.example.com`)
    pub server_url: String,
    /// Authentication method.
    pub auth: McAuthConfig,
    /// Domain id (empty string = default domain).
    #[serde(default)]
    pub domain: String,
    /// Request timeout in seconds (default 30).
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    /// Whether to verify TLS certificates.
    #[serde(default = "default_true")]
    pub verify_tls: bool,
    /// Optional HTTP proxy URL.
    pub proxy: Option<String>,
}

fn default_timeout() -> u64 {
    30
}
fn default_true() -> bool {
    true
}

/// Authentication configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "method")]
pub enum McAuthConfig {
    /// Username + password (optionally with 2FA token).
    #[serde(rename = "password")]
    Password {
        username: String,
        password: String,
        token: Option<String>,
    },
    /// Login token (created via MeshCentral UI or API).
    #[serde(rename = "login_token")]
    LoginToken { token_user: String, token_pass: String },
    /// Login key (hex-encoded 80-byte key) for cookie-based auth.
    #[serde(rename = "login_key")]
    LoginKey {
        key_hex: String,
        username: Option<String>,
    },
}

// ─── Session ────────────────────────────────────────────────────────────────

/// Represents an active session to a MeshCentral server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McSession {
    pub id: String,
    pub server_url: String,
    pub username: String,
    pub domain: String,
    pub connected_at: DateTime<Utc>,
    pub authenticated: bool,
    pub server_info: Option<McServerInfo>,
}

// ─── Server ─────────────────────────────────────────────────────────────────

/// Server information returned by the `serverinfo` action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McServerInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub https_port: u16,
    /// Any extra fields the server returns.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Server configuration (subset of config.json).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McServerConfig {
    pub domains: Option<HashMap<String, serde_json::Value>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

// ─── Devices ────────────────────────────────────────────────────────────────

/// A device (node) managed by MeshCentral.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McDevice {
    /// Node ID, e.g. `node//abcdef...`
    #[serde(rename = "_id", default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub ip: Option<String>,
    /// OS description string.
    #[serde(default)]
    pub osdesc: Option<String>,
    /// Connection state bitmask (1=agent, 2=CIRA, 4=AMT, 8=relay).
    #[serde(default)]
    pub conn: Option<u32>,
    /// Power state (0=unknown, 1=S0, 2=S1, ...).
    #[serde(default)]
    pub pwr: Option<u32>,
    /// Icon number (1–8).
    #[serde(default)]
    pub icon: Option<u8>,
    /// Tags applied to this device.
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// Description.
    #[serde(default)]
    pub desc: Option<String>,
    /// Device group (mesh) ID.
    #[serde(default)]
    pub meshid: Option<String>,
    /// Agent information.
    #[serde(default)]
    pub agent: Option<McDeviceAgent>,
    /// Intel AMT information.
    #[serde(default)]
    pub intelamt: Option<McIntelAmt>,
    /// Windows Security Center.
    #[serde(default)]
    pub wsc: Option<McWindowsSecurity>,
    /// Currently logged-in users.
    #[serde(default)]
    pub users: Option<Vec<String>>,
    /// User rights links.
    #[serde(default)]
    pub links: Option<HashMap<String, McDeviceLink>>,
    /// Last-seen time.
    #[serde(default)]
    pub lastconnect: Option<DateTime<Utc>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Agent info embedded in a device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McDeviceAgent {
    #[serde(default)]
    pub id: Option<u32>,
    #[serde(default)]
    pub ver: Option<u32>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Intel AMT info embedded in a device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McIntelAmt {
    #[serde(default)]
    pub ver: Option<String>,
    /// Provisioning state: 0=Not Activated (Pre), 1=Not Activated (In), 2=Activated
    #[serde(default)]
    pub state: Option<u8>,
    #[serde(default)]
    pub flags: Option<u32>,
    #[serde(default)]
    pub tls: Option<u8>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Windows Security Center info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McWindowsSecurity {
    #[serde(rename = "antiVirus", default)]
    pub anti_virus: Option<String>,
    #[serde(rename = "autoUpdate", default)]
    pub auto_update: Option<String>,
    #[serde(default)]
    pub firewall: Option<String>,
}

/// A user-rights link for a device or mesh.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McDeviceLink {
    #[serde(default)]
    pub rights: Option<u64>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Options for filtering device listings.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McDeviceFilter {
    /// Device group ID to limit results to.
    pub group_id: Option<String>,
    /// Device group name to limit results to.
    pub group_name: Option<String>,
    /// Text filter (name, user:, ip:, group:, tag:, os:, desc:, etc.).
    pub filter: Option<String>,
    /// IDs to include.
    pub filter_ids: Option<Vec<String>>,
    /// Include full details.
    #[serde(default)]
    pub details: bool,
}

/// Parameters for adding a local device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McAddLocalDevice {
    /// Device group (mesh) ID.
    pub mesh_id: String,
    pub device_name: String,
    pub hostname: String,
    /// Device type: 4=Windows RDP, 6=Linux SSH, 29=macOS SSH.
    #[serde(default = "default_device_type")]
    pub device_type: u32,
}

fn default_device_type() -> u32 {
    4
}

/// Parameters for adding an Intel AMT device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McAddAmtDevice {
    pub mesh_id: String,
    pub device_name: String,
    pub hostname: String,
    pub amt_username: String,
    pub amt_password: String,
    #[serde(default = "default_true")]
    pub use_tls: bool,
}

/// Parameters for editing a device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McEditDevice {
    pub device_id: String,
    pub name: Option<String>,
    pub desc: Option<String>,
    pub tags: Option<Vec<String>>,
    pub icon: Option<u8>,
    pub consent: Option<u32>,
}

/// Information returned by the `deviceinfo` compound query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McDeviceInfo {
    pub device: Option<McDevice>,
    pub system_info: Option<serde_json::Value>,
    pub network_info: Option<serde_json::Value>,
    pub last_connect: Option<McLastConnect>,
}

/// Last connection info for a device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McLastConnect {
    pub time: Option<DateTime<Utc>>,
    pub addr: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

// ─── Device Groups (Meshes) ─────────────────────────────────────────────────

/// A device group (mesh).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McDeviceGroup {
    #[serde(rename = "_id", default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub desc: Option<String>,
    /// Mesh type: 1=Intel AMT only, 2=Agent-based, 3=Agentless.
    #[serde(rename = "mtype", default)]
    pub mesh_type: Option<u8>,
    /// Feature flags (1=auto-remove, 2=hostname sync, 4=record sessions).
    #[serde(default)]
    pub flags: Option<u32>,
    /// Consent flags.
    #[serde(default)]
    pub consent: Option<u32>,
    /// User links with rights.
    #[serde(default)]
    pub links: Option<HashMap<String, McDeviceLink>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Parameters for creating a device group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McCreateDeviceGroup {
    pub name: String,
    pub desc: Option<String>,
    /// 1=Intel AMT only, 2=Agent-based (default), 3=Agentless.
    #[serde(default = "default_mesh_type")]
    pub mesh_type: u8,
    /// Feature flags.
    pub features: Option<u32>,
    /// Consent flags.
    pub consent: Option<u32>,
}

fn default_mesh_type() -> u8 {
    2
}

/// Parameters for editing a device group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McEditDeviceGroup {
    /// Group ID (or use group_name).
    pub group_id: Option<String>,
    /// Group name (alternative to group_id).
    pub group_name: Option<String>,
    pub name: Option<String>,
    pub desc: Option<String>,
    pub flags: Option<u32>,
    pub consent: Option<u32>,
    pub invite_codes: Option<Vec<String>>,
    /// 0=both, 1=interactive only, 2=background only
    pub invite_flags: Option<u8>,
}

// ─── Users ──────────────────────────────────────────────────────────────────

/// A user account on the MeshCentral server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McUser {
    #[serde(rename = "_id", default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub realname: Option<String>,
    /// Site-admin rights bitmask.
    #[serde(default)]
    pub siteadmin: Option<u64>,
    /// Has OTP/2FA configured.
    #[serde(default)]
    pub otpsecret: Option<serde_json::Value>,
    #[serde(default)]
    pub otpkeys: Option<serde_json::Value>,
    #[serde(default)]
    pub otphkeys: Option<serde_json::Value>,
    #[serde(default)]
    pub links: Option<HashMap<String, McDeviceLink>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Parameters for adding a user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McAddUser {
    pub username: String,
    pub password: Option<String>,
    #[serde(default)]
    pub random_password: bool,
    pub email: Option<String>,
    #[serde(default)]
    pub email_verified: bool,
    #[serde(default)]
    pub reset_password: bool,
    pub realname: Option<String>,
    pub phone: Option<String>,
    pub domain: Option<String>,
    /// Rights: `full`, `none`, or comma-separated list.
    pub rights: Option<String>,
}

/// Parameters for editing a user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McEditUser {
    pub user_id: String,
    pub email: Option<String>,
    #[serde(default)]
    pub email_verified: bool,
    #[serde(default)]
    pub reset_password: bool,
    pub realname: Option<String>,
    pub phone: Option<String>,
    pub domain: Option<String>,
    pub rights: Option<String>,
}

/// User session count information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McUserSessions {
    pub sessions: HashMap<String, u32>,
}

/// User info returned by `userinfo`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McUserInfo {
    #[serde(flatten)]
    pub data: HashMap<String, serde_json::Value>,
}

// ─── User Groups ────────────────────────────────────────────────────────────

/// A user group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McUserGroup {
    #[serde(rename = "_id", default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub desc: Option<String>,
    #[serde(default)]
    pub links: Option<HashMap<String, McDeviceLink>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

// ─── Events ─────────────────────────────────────────────────────────────────

/// An event from the MeshCentral event log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McEvent {
    #[serde(default)]
    pub time: Option<DateTime<Utc>>,
    #[serde(rename = "etype", default)]
    pub event_type: Option<String>,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub nodeid: Option<String>,
    #[serde(default)]
    pub userid: Option<String>,
    #[serde(default)]
    pub msg: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Options for listing events.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McEventFilter {
    /// Filter by user ID.
    pub user_id: Option<String>,
    /// Filter by device ID.
    pub device_id: Option<String>,
    /// Maximum number of events.
    pub limit: Option<u32>,
}

// ─── Remote Commands ────────────────────────────────────────────────────────

/// Parameters for running a command on a remote device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McRunCommand {
    pub device_id: String,
    pub command: String,
    /// Use PowerShell on Windows.
    #[serde(default)]
    pub powershell: bool,
    /// Run as the logged-in user.
    #[serde(default)]
    pub run_as_user: bool,
    /// Only run as logged-in user (fail if none).
    #[serde(default)]
    pub run_as_user_only: bool,
    /// Wait for and return command output.
    #[serde(default)]
    pub reply: bool,
}

/// Result of a remote command execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McCommandResult {
    pub command_id: String,
    pub device_id: String,
    pub result: Option<String>,
    pub error: Option<String>,
    pub exit_code: Option<i32>,
    pub execution_time_ms: Option<u64>,
}

// ─── Power ──────────────────────────────────────────────────────────────────

/// Power action to perform on device(s).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum McPowerAction {
    /// Wake-on-LAN.
    Wake,
    /// Power off.
    PowerOff,
    /// Reset / reboot.
    Reset,
    /// Sleep / standby.
    Sleep,
    /// Intel AMT Power On.
    AmtPowerOn,
    /// Intel AMT Power Off.
    AmtPowerOff,
    /// Intel AMT Reset.
    AmtReset,
}

impl McPowerAction {
    /// Convert to the MeshCentral API action type number.
    pub fn action_type(&self) -> u32 {
        match self {
            Self::Wake => 1,         // wakedevices action
            Self::PowerOff => 2,     // poweraction type 2
            Self::Reset => 3,        // poweraction type 3
            Self::Sleep => 4,        // poweraction type 4
            Self::AmtPowerOn => 302, // AMT power on
            Self::AmtPowerOff => 308, // AMT power off
            Self::AmtReset => 310,   // AMT reset
        }
    }
}

// ─── File Transfer ──────────────────────────────────────────────────────────

/// Parameters for uploading a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McFileUpload {
    pub device_id: String,
    /// Local file path.
    pub local_path: String,
    /// Remote target directory.
    pub remote_path: String,
}

/// Parameters for downloading a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McFileDownload {
    pub device_id: String,
    /// Remote file path on the device.
    pub remote_path: String,
    /// Local download target.
    pub local_path: String,
}

/// File transfer progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McFileTransferProgress {
    pub transfer_id: String,
    pub device_id: String,
    pub direction: McTransferDirection,
    pub bytes_transferred: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<f64>,
    pub status: McTransferStatus,
}

/// Transfer direction.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum McTransferDirection {
    Upload,
    Download,
}

/// Transfer status.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum McTransferStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

// ─── Sharing ────────────────────────────────────────────────────────────────

/// A device sharing link.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McDeviceShare {
    #[serde(rename = "publicid", default)]
    pub public_id: Option<String>,
    #[serde(rename = "guestName", default)]
    pub guest_name: Option<String>,
    /// Share type bitmask: 1=terminal, 2=desktop, 4=files, 8=http, 16=https.
    #[serde(default)]
    pub p: Option<u32>,
    #[serde(default)]
    pub consent: Option<u32>,
    #[serde(rename = "viewOnly", default)]
    pub view_only: Option<bool>,
    #[serde(rename = "startTime")]
    pub start_time: Option<DateTime<Utc>>,
    #[serde(rename = "expireTime")]
    pub expire_time: Option<DateTime<Utc>>,
    #[serde(default)]
    pub duration: Option<u64>,
    #[serde(default)]
    pub recurring: Option<u8>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub userid: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Share type flags for creating a share link.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum McShareType {
    Terminal,
    Desktop,
    Files,
    Http,
    Https,
}

impl McShareType {
    pub fn flag(&self) -> u32 {
        match self {
            Self::Terminal => 1,
            Self::Desktop => 2,
            Self::Files => 4,
            Self::Http => 8,
            Self::Https => 16,
        }
    }
}

/// Parameters for creating a device share link.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McCreateShare {
    pub device_id: String,
    pub guest_name: String,
    /// Share types (combined as bitmask).
    #[serde(default)]
    pub share_types: Vec<McShareType>,
    /// View-only desktop sharing.
    #[serde(default)]
    pub view_only: bool,
    /// Consent: `notify`, `prompt`, `none`.
    pub consent: Option<String>,
    /// Start time (ISO 8601).
    pub start: Option<String>,
    /// End time (ISO 8601).
    pub end: Option<String>,
    /// Duration in minutes.
    pub duration: Option<u64>,
    /// 0=none, 1=daily, 2=weekly.
    #[serde(default)]
    pub recurring: u8,
    /// Port for HTTP/HTTPS shares.
    pub port: Option<u16>,
}

// ─── Messaging ──────────────────────────────────────────────────────────────

/// Parameters for showing a message box on a remote device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McDeviceMessage {
    pub device_id: String,
    pub msg: String,
    pub title: Option<String>,
    /// Timeout in milliseconds (default 120000 = 2 min).
    pub timeout: Option<u64>,
}

/// Parameters for showing a toast notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McDeviceToast {
    pub device_ids: Vec<String>,
    pub msg: String,
    pub title: Option<String>,
}

/// Parameters for opening a URL on a remote device.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McDeviceOpenUrl {
    pub device_id: String,
    pub url: String,
}

/// Parameters for broadcasting a message to users.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McBroadcast {
    pub msg: String,
    /// Optional: target specific user.
    pub user_id: Option<String>,
}

// ─── Agent / Invites ────────────────────────────────────────────────────────

/// Parameters for downloading an agent binary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McAgentDownload {
    /// Device group (mesh) ID.
    pub mesh_id: String,
    /// Agent architecture type number.
    pub agent_type: u32,
    /// Install flags: 0=both, 1=interactive only, 2=background only.
    #[serde(default)]
    pub install_flags: u8,
}

/// Agent architecture types.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum McAgentType {
    Win32Console = 1,
    Win64Console = 2,
    Win32Service = 3,
    Win64Service = 4,
    Linux32 = 5,
    Linux64 = 6,
    Mips = 7,
    Android = 9,
    LinuxArm = 10,
    MacOSx86_32 = 11,
    MacOSx86_64 = 16,
    ChromeOS = 17,
    ArmLinaro = 24,
    ArmV6V7 = 25,
    ArmV8_64 = 26,
    AppleSilicon = 29,
    FreeBSD64 = 30,
    LinuxArm64 = 32,
    AlpineLinux64 = 33,
}

/// Parameters for sending an agent install invitation email.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McSendInviteEmail {
    /// Device group ID or name.
    pub group_id: Option<String>,
    pub group_name: Option<String>,
    pub email: String,
    pub name: Option<String>,
    pub message: Option<String>,
}

/// Parameters for generating an invite link.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McGenerateInviteLink {
    pub group_id: Option<String>,
    pub group_name: Option<String>,
    /// Validity period in hours (0 = unlimited).
    pub hours: u64,
    /// 0=both, 1=interactive only, 2=background only.
    #[serde(default)]
    pub flags: u8,
}

// ─── Login Tokens ───────────────────────────────────────────────────────────

/// A login token.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McLoginToken {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(rename = "tokenUser", default)]
    pub token_user: Option<String>,
    #[serde(rename = "tokenPass", default)]
    pub token_pass: Option<String>,
    #[serde(default)]
    pub created: Option<DateTime<Utc>>,
    #[serde(default)]
    pub expire: Option<DateTime<Utc>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Parameters for creating a login token.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McCreateLoginToken {
    pub name: String,
    /// Expiration in minutes (0 = never).
    #[serde(default)]
    pub expire_minutes: u64,
}

// ─── Reports ────────────────────────────────────────────────────────────────

/// Report type.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum McReportType {
    Sessions = 1,
    Traffic = 2,
    Logins = 3,
    Database = 4,
}

/// Report grouping.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum McReportGroupBy {
    User = 1,
    Device = 2,
    Day = 3,
}

/// Parameters for generating a report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McGenerateReport {
    pub report_type: McReportType,
    #[serde(default)]
    pub group_by: Option<McReportGroupBy>,
    /// Start time (ISO 8601).
    pub start: Option<String>,
    /// End time (ISO 8601).
    pub end: Option<String>,
    /// Filter by device group.
    pub device_group: Option<String>,
    #[serde(default)]
    pub show_traffic: bool,
}

/// A generated report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McReport {
    pub columns: Vec<McReportColumn>,
    pub groups: HashMap<String, McReportGroup>,
}

/// Report column definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McReportColumn {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
}

/// A group of report entries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McReportGroup {
    pub entries: Vec<HashMap<String, serde_json::Value>>,
}

// ─── WebRelay ───────────────────────────────────────────────────────────────

/// Parameters for creating a web relay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McWebRelay {
    pub device_id: String,
    /// Protocol: `http` or `https`.
    pub protocol: String,
    /// Port number.
    pub port: Option<u16>,
}

/// Result of a web relay creation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McWebRelayResult {
    pub url: String,
    pub public_id: Option<String>,
}

// ─── Mesh rights bitmask constants ──────────────────────────────────────────

/// Rights bitmask values for device group / device permissions.
pub struct McRights;

impl McRights {
    pub const EDIT_MESH: u64 = 1;
    pub const MANAGE_USERS: u64 = 2;
    pub const MANAGE_COMPUTERS: u64 = 4;
    pub const REMOTE_CONTROL: u64 = 8;
    pub const AGENT_CONSOLE: u64 = 16;
    pub const SERVER_FILES: u64 = 32;
    pub const WAKE_DEVICE: u64 = 64;
    pub const SET_NOTES: u64 = 128;
    pub const REMOTE_VIEW_ONLY: u64 = 256;
    pub const NO_TERMINAL: u64 = 512;
    pub const NO_FILES: u64 = 1024;
    pub const NO_AMT: u64 = 2048;
    pub const DESKTOP_LIMITED_INPUT: u64 = 4096;
    pub const LIMIT_EVENTS: u64 = 8192;
    pub const CHAT_NOTIFY: u64 = 16384;
    pub const UNINSTALL_AGENT: u64 = 32768;
    pub const NO_REMOTE_DESKTOP: u64 = 65536;
    pub const REMOTE_COMMANDS: u64 = 131072;
    pub const RESET_POWER_OFF: u64 = 262144;
    pub const FULL_ADMIN: u64 = 0xFFFFFFFF;
}

/// Site admin rights bitmask values.
pub struct McSiteRights;

impl McSiteRights {
    pub const SERVER_BACKUP: u64 = 0x00000001;
    pub const MANAGE_USERS: u64 = 0x00000002;
    pub const SERVER_RESTORE: u64 = 0x00000004;
    pub const FILE_ACCESS: u64 = 0x00000008;
    pub const SERVER_UPDATE: u64 = 0x00000010;
    pub const LOCKED: u64 = 0x00000020;
    pub const NO_NEW_GROUPS: u64 = 0x00000040;
    pub const NO_TOOLS: u64 = 0x00000080;
    pub const USER_GROUPS: u64 = 0x00000100;
    pub const RECORDINGS: u64 = 0x00000200;
    pub const LOCK_SETTINGS: u64 = 0x00000400;
    pub const ALL_EVENTS: u64 = 0x00000800;
    pub const NO_NEW_DEVICES: u64 = 0x00001000;
    pub const FULL_ADMIN: u64 = 0xFFFFFFFF;
}

/// Consent flags for device groups / device sharing.
pub struct McConsent;

impl McConsent {
    pub const DESKTOP_NOTIFY: u32 = 1;
    pub const TERMINAL_NOTIFY: u32 = 2;
    pub const FILES_NOTIFY: u32 = 4;
    pub const DESKTOP_PROMPT: u32 = 8;
    pub const TERMINAL_PROMPT: u32 = 16;
    pub const FILES_PROMPT: u32 = 32;
    pub const DESKTOP_TOOLBAR: u32 = 64;
}

/// Connection state bitmask for devices.
pub struct McConnState;

impl McConnState {
    pub const AGENT: u32 = 1;
    pub const CIRA: u32 = 2;
    pub const AMT: u32 = 4;
    pub const RELAY: u32 = 8;
}

/// Parameters for adding a user to a device group with specific rights.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McAddUserToDeviceGroup {
    /// Device group ID (or use group_name).
    pub group_id: Option<String>,
    /// Device group name (or use group_id).
    pub group_name: Option<String>,
    pub user_id: String,
    /// Rights bitmask (or use `full_rights`).
    pub rights: Option<u64>,
    #[serde(default)]
    pub full_rights: bool,
}

/// Parameters for adding a user to a device with specific rights.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McAddUserToDevice {
    pub device_id: String,
    pub user_id: String,
    pub rights: Option<u64>,
    #[serde(default)]
    pub full_rights: bool,
}

// ─── WebSocket Message Envelope ─────────────────────────────────────────────

/// Generic WebSocket message sent to / received from MeshCentral.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McWsMessage {
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responseid: Option<String>,
    #[serde(flatten)]
    pub data: HashMap<String, serde_json::Value>,
}
