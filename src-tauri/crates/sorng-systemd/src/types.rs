//! Data types for systemd management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Host ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    pub timeout_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuth {
    Password {
        password: String,
    },
    PrivateKey {
        key_path: String,
        passphrase: Option<String>,
    },
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemdHost {
    pub id: String,
    pub name: String,
    pub ssh: Option<SshConfig>,
    pub use_sudo: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── Unit ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitType {
    Service,
    Socket,
    Target,
    Timer,
    Mount,
    Automount,
    Swap,
    Path,
    Slice,
    Scope,
    Device,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitActiveState {
    Active,
    Inactive,
    Activating,
    Deactivating,
    Failed,
    Reloading,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitLoadState {
    Loaded,
    NotFound,
    BadSetting,
    Error,
    Masked,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitSubState {
    Running,
    Dead,
    Exited,
    Waiting,
    Listening,
    Mounted,
    Plugged,
    Elapsed,
    AutoRestart,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitEnableState {
    Enabled,
    EnabledRuntime,
    Disabled,
    Static,
    Indirect,
    Masked,
    Generated,
    Transient,
    Bad,
    Alias,
    Unknown,
}

/// A systemd unit with its status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemdUnit {
    pub name: String,
    pub unit_type: UnitType,
    pub description: String,
    pub load_state: UnitLoadState,
    pub active_state: UnitActiveState,
    pub sub_state: UnitSubState,
    pub enable_state: UnitEnableState,
    pub fragment_path: Option<String>,
    pub main_pid: Option<u32>,
    pub memory_current: Option<u64>,
    pub cpu_usage_nsec: Option<u64>,
    pub tasks_current: Option<u32>,
    pub active_enter_timestamp: Option<DateTime<Utc>>,
    pub inactive_enter_timestamp: Option<DateTime<Utc>>,
    pub triggered_by: Vec<String>,
    pub triggers: Vec<String>,
    pub wants: Vec<String>,
    pub required_by: Vec<String>,
    pub after: Vec<String>,
    pub before: Vec<String>,
}

// ─── Unit File ──────────────────────────────────────────────────────

/// A systemd unit file definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitFileContent {
    pub path: String,
    pub sections: Vec<UnitFileSection>,
}

/// A section within a unit file ([Unit], [Service], [Install], etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitFileSection {
    pub name: String,
    pub directives: Vec<UnitFileDirective>,
}

/// A key=value directive in a unit file section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitFileDirective {
    pub key: String,
    pub value: String,
}

/// Drop-in override for a unit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitOverride {
    pub unit_name: String,
    pub override_name: String,
    pub path: String,
    pub content: String,
}

// ─── Journal ────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JournalPriority {
    Emergency,
    Alert,
    Critical,
    Error,
    Warning,
    Notice,
    Info,
    Debug,
}

/// A journal log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEntry {
    pub timestamp: DateTime<Utc>,
    pub hostname: String,
    pub unit: Option<String>,
    pub syslog_identifier: Option<String>,
    pub pid: Option<u32>,
    pub priority: JournalPriority,
    pub message: String,
    pub cursor: String,
    pub boot_id: Option<String>,
    pub extra_fields: HashMap<String, String>,
}

/// Options for querying the journal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalQueryOpts {
    pub unit: Option<String>,
    pub boot_id: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub priority: Option<JournalPriority>,
    pub grep: Option<String>,
    pub lines: Option<u32>,
    pub reverse: bool,
    pub output_format: JournalOutputFormat,
    pub catalog: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JournalOutputFormat {
    Short,
    ShortIso,
    ShortFull,
    ShortMonotonic,
    Verbose,
    Export,
    Json,
    JsonPretty,
    Cat,
}

/// Journal disk usage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalDiskUsage {
    pub archived_bytes: u64,
    pub current_bytes: u64,
    pub total_bytes: u64,
    pub max_use_bytes: Option<u64>,
}

// ─── Boot / Target ──────────────────────────────────────────────────

/// Boot information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootEntry {
    pub boot_id: String,
    pub first_entry: DateTime<Utc>,
    pub last_entry: DateTime<Utc>,
    pub offset: i32,
}

/// systemd-analyze blame entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlameEntry {
    pub unit: String,
    pub time_ms: u64,
}

/// systemd-analyze critical-chain entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriticalChainEntry {
    pub unit: String,
    pub time_after_ms: u64,
    pub time_active_ms: u64,
    pub depth: u32,
}

/// Boot timing summary from systemd-analyze.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootTiming {
    pub firmware_ms: Option<u64>,
    pub loader_ms: Option<u64>,
    pub kernel_ms: u64,
    pub initrd_ms: Option<u64>,
    pub userspace_ms: u64,
    pub total_ms: u64,
}

// ─── Timer ──────────────────────────────────────────────────────────

/// A systemd timer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemdTimer {
    pub name: String,
    pub activates: String,
    pub next_trigger: Option<DateTime<Utc>>,
    pub last_trigger: Option<DateTime<Utc>>,
    pub enabled: bool,
    pub active: bool,
    pub calendar: Option<String>,
    pub on_boot_sec: Option<u64>,
    pub on_unit_active_sec: Option<u64>,
    pub accuracy_sec: Option<u64>,
    pub persistent: bool,
    pub wake_system: bool,
    pub remain_after_elapse: bool,
}

// ─── Socket ─────────────────────────────────────────────────────────

/// A systemd socket unit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemdSocket {
    pub name: String,
    pub listen_addresses: Vec<String>,
    pub activates: String,
    pub active: bool,
    pub connections: u32,
    pub accepted: u64,
    pub socket_type: SocketType,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SocketType {
    Stream,
    Datagram,
    Sequential,
    Fifo,
    Special,
    Netlink,
    Unknown,
}

// ─── cgroups / Resource Control ─────────────────────────────────────

/// Resource usage for a unit (cgroup stats).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CgroupStats {
    pub unit: String,
    pub tasks: u32,
    pub cpu_percent: f64,
    pub memory_bytes: u64,
    pub io_read_bytes: u64,
    pub io_write_bytes: u64,
}

/// Resource limits for a unit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    pub cpu_quota: Option<String>,
    pub cpu_shares: Option<u64>,
    pub memory_max: Option<u64>,
    pub memory_high: Option<u64>,
    pub memory_low: Option<u64>,
    pub io_weight: Option<u32>,
    pub tasks_max: Option<u32>,
}

// ─── hostnamectl ────────────────────────────────────────────────────

/// System hostname info from hostnamectl.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostnameInfo {
    pub static_hostname: String,
    pub transient_hostname: Option<String>,
    pub pretty_hostname: Option<String>,
    pub icon_name: Option<String>,
    pub chassis: Option<String>,
    pub deployment: Option<String>,
    pub location: Option<String>,
    pub kernel_name: String,
    pub kernel_release: String,
    pub os_pretty_name: String,
    pub os_id: Option<String>,
    pub cpe_name: Option<String>,
    pub machine_id: String,
    pub boot_id: String,
    pub virtualization: Option<String>,
    pub architecture: String,
}

// ─── localectl ──────────────────────────────────────────────────────

/// Locale and keymap settings from localectl.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocaleInfo {
    pub system_locale: HashMap<String, String>,
    pub vc_keymap: Option<String>,
    pub x11_layout: Option<String>,
    pub x11_model: Option<String>,
    pub x11_variant: Option<String>,
    pub x11_options: Option<String>,
}

// ─── loginctl ───────────────────────────────────────────────────────

/// A login session from loginctl.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginctlSession {
    pub session_id: String,
    pub uid: u32,
    pub user: String,
    pub seat: Option<String>,
    pub tty: Option<String>,
    pub state: String,
    pub idle: bool,
    pub since: Option<DateTime<Utc>>,
    pub class: String,
    pub scope: String,
    pub service: Option<String>,
    pub remote: bool,
    pub remote_host: Option<String>,
}

/// A loginctl user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginctlUser {
    pub uid: u32,
    pub name: String,
    pub state: String,
    pub linger: bool,
    pub sessions: Vec<String>,
}

// ─── Health ─────────────────────────────────────────────────────────

/// Health check for systemd subsystem.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemdHealthCheck {
    pub systemd_running: bool,
    pub system_state: String,
    pub systemctl_available: bool,
    pub journalctl_available: bool,
    pub total_units: u32,
    pub active_units: u32,
    pub failed_units: u32,
    pub loaded_units: u32,
    pub jobs_queued: u32,
    pub default_target: String,
    pub boot_time_ms: Option<u64>,
    pub journal_disk_usage_bytes: Option<u64>,
    pub warnings: Vec<String>,
    pub checked_at: DateTime<Utc>,
}
