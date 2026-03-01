//! Shared types for the Windows Management crate.
//!
//! Covers WMI connection configuration, session state, query results,
//! Windows service/process/event/perfmon domain types, and Tauri events.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Connection & Session ────────────────────────────────────────────

/// Protocol used to reach the remote WMI provider.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WmiTransportProtocol {
    /// WS-Management over HTTP/HTTPS (WinRM)
    WinRm,
    /// DCOM / MS-RPC (classic — Windows only)
    Dcom,
}

impl Default for WmiTransportProtocol {
    fn default() -> Self {
        Self::WinRm
    }
}

/// Authentication method for the WMI connection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WmiAuthMethod {
    Basic,
    Ntlm,
    Negotiate,
    Kerberos,
    CredSsp,
    Default,
}

impl Default for WmiAuthMethod {
    fn default() -> Self {
        Self::Negotiate
    }
}

/// Credentials for the remote host.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WmiCredential {
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub domain: Option<String>,
}

/// Configuration to establish a WMI session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WmiConnectionConfig {
    /// Target hostname or IP.
    pub computer_name: String,
    /// Credentials (None = current user / Kerberos SSO).
    #[serde(default)]
    pub credential: Option<WmiCredential>,
    /// Transport protocol.
    #[serde(default)]
    pub protocol: WmiTransportProtocol,
    /// Authentication method.
    #[serde(default)]
    pub auth_method: WmiAuthMethod,
    /// WMI namespace (default `root\cimv2`).
    #[serde(default = "default_namespace")]
    pub namespace: String,
    /// Use HTTPS / encrypted channel.
    #[serde(default)]
    pub use_ssl: bool,
    /// Custom port (0 = auto: 5985 HTTP / 5986 HTTPS for WinRM, 135 DCOM).
    #[serde(default)]
    pub port: u16,
    /// Skip CA certificate validation.
    #[serde(default)]
    pub skip_ca_check: bool,
    /// Operation timeout in seconds.
    #[serde(default = "default_timeout")]
    pub timeout_sec: u32,
    /// Skip CN / hostname verification.
    #[serde(default)]
    pub skip_cn_check: bool,
}

fn default_namespace() -> String {
    r"root\cimv2".to_string()
}
fn default_timeout() -> u32 {
    30
}

impl WmiConnectionConfig {
    /// Effective port for the connection.
    pub fn effective_port(&self) -> u16 {
        if self.port > 0 {
            return self.port;
        }
        match self.protocol {
            WmiTransportProtocol::WinRm => {
                if self.use_ssl {
                    5986
                } else {
                    5985
                }
            }
            WmiTransportProtocol::Dcom => 135,
        }
    }

    /// Build the WinRM endpoint URI.
    pub fn endpoint_uri(&self) -> String {
        let scheme = if self.use_ssl { "https" } else { "http" };
        let port = self.effective_port();
        format!("{}://{}:{}/wsman", scheme, self.computer_name, port)
    }
}

/// State of a WMI session.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WmiSessionState {
    Connected,
    Disconnected,
    Error,
}

/// A managed WMI session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WmiSession {
    pub id: String,
    pub computer_name: String,
    pub namespace: String,
    pub state: WmiSessionState,
    pub protocol: WmiTransportProtocol,
    pub auth_method: WmiAuthMethod,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
}

// ─── WMI Query ───────────────────────────────────────────────────────

/// Result of a raw WQL query.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WmiQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, serde_json::Value>>,
    pub row_count: usize,
    pub execution_time_ms: u64,
    pub query: String,
}

// ─── Windows Services (Win32_Service) ────────────────────────────────

/// Mirrors the Win32_Service CIM class.
/// Ref: <https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-service>
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsService {
    pub name: String,
    pub display_name: String,
    pub description: Option<String>,
    pub state: ServiceState,
    pub start_mode: ServiceStartMode,
    pub service_type: String,
    pub path_name: Option<String>,
    pub process_id: Option<u32>,
    pub exit_code: Option<u32>,
    pub status: String,
    pub started: bool,
    pub accept_pause: bool,
    pub accept_stop: bool,
    pub start_name: Option<String>,
    pub delayed_auto_start: Option<bool>,
    /// Dependencies (other service names).
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// Services that depend on this service.
    #[serde(default)]
    pub dependent_services: Vec<String>,
}

/// Service runtime state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ServiceState {
    Running,
    Stopped,
    StartPending,
    StopPending,
    ContinuePending,
    PausePending,
    Paused,
    Unknown,
}

impl ServiceState {
    pub fn from_wmi(s: &str) -> Self {
        match s {
            "Running" => Self::Running,
            "Stopped" => Self::Stopped,
            "Start Pending" => Self::StartPending,
            "Stop Pending" => Self::StopPending,
            "Continue Pending" => Self::ContinuePending,
            "Pause Pending" => Self::PausePending,
            "Paused" => Self::Paused,
            _ => Self::Unknown,
        }
    }
}

/// Service start mode.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ServiceStartMode {
    Auto,
    Manual,
    Disabled,
    Boot,
    System,
    DelayedAuto,
    Unknown,
}

impl ServiceStartMode {
    pub fn from_wmi(s: &str) -> Self {
        match s {
            "Auto" => Self::Auto,
            "Manual" => Self::Manual,
            "Disabled" => Self::Disabled,
            "Boot" => Self::Boot,
            "System" => Self::System,
            _ => Self::Unknown,
        }
    }
    pub fn to_wmi(&self) -> &str {
        match self {
            Self::Auto | Self::DelayedAuto => "Automatic",
            Self::Manual => "Manual",
            Self::Disabled => "Disabled",
            Self::Boot => "Boot",
            Self::System => "System",
            Self::Unknown => "Manual",
        }
    }
}

/// Parameters for changing a service.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceChangeParams {
    pub service_name: String,
    pub start_mode: Option<ServiceStartMode>,
    pub start_name: Option<String>,
    pub start_password: Option<String>,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub path_name: Option<String>,
}

// ─── Windows Event Log (Win32_NTLogEvent) ────────────────────────────

/// Log entry from the Windows Event Log.
/// Ref: <https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-ntlogevent>
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventLogEntry {
    pub record_number: u64,
    pub log_file: String,
    pub event_code: u32,
    pub event_identifier: u64,
    pub event_type: EventLogLevel,
    pub source_name: String,
    pub category: Option<u16>,
    pub category_string: Option<String>,
    pub time_generated: DateTime<Utc>,
    pub time_written: DateTime<Utc>,
    pub message: Option<String>,
    pub computer_name: String,
    pub user: Option<String>,
    #[serde(default)]
    pub insertion_strings: Vec<String>,
    #[serde(default)]
    pub data: Vec<u8>,
}

/// Event severity level (maps to Win32_NTLogEvent.EventType).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum EventLogLevel {
    Error,
    Warning,
    Information,
    AuditSuccess,
    AuditFailure,
    Unknown,
}

impl EventLogLevel {
    pub fn from_wmi(val: u8) -> Self {
        match val {
            1 => Self::Error,
            2 => Self::Warning,
            3 => Self::Information,
            4 => Self::AuditSuccess,
            5 => Self::AuditFailure,
            _ => Self::Unknown,
        }
    }
    pub fn to_wmi(&self) -> u8 {
        match self {
            Self::Error => 1,
            Self::Warning => 2,
            Self::Information => 3,
            Self::AuditSuccess => 4,
            Self::AuditFailure => 5,
            Self::Unknown => 0,
        }
    }
    pub fn name(&self) -> &str {
        match self {
            Self::Error => "Error",
            Self::Warning => "Warning",
            Self::Information => "Information",
            Self::AuditSuccess => "Audit Success",
            Self::AuditFailure => "Audit Failure",
            Self::Unknown => "Unknown",
        }
    }
}

/// Filter for querying event logs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventLogFilter {
    /// Log name(s): Application, System, Security, etc.
    #[serde(default)]
    pub log_names: Vec<String>,
    /// Filter by level.
    #[serde(default)]
    pub levels: Vec<EventLogLevel>,
    /// Filter by source name.
    #[serde(default)]
    pub sources: Vec<String>,
    /// Filter by event ID(s).
    #[serde(default)]
    pub event_ids: Vec<u32>,
    /// Start time (inclusive).
    pub start_time: Option<DateTime<Utc>>,
    /// End time (inclusive).
    pub end_time: Option<DateTime<Utc>>,
    /// Text search in Message field.
    pub message_contains: Option<String>,
    /// Computer name filter.
    pub computer_name: Option<String>,
    /// Maximum results to return.
    #[serde(default = "default_max_events")]
    pub max_results: u32,
    /// Sort order.
    #[serde(default)]
    pub newest_first: bool,
}

fn default_max_events() -> u32 {
    500
}

impl Default for EventLogFilter {
    fn default() -> Self {
        Self {
            log_names: vec!["Application".to_string(), "System".to_string()],
            levels: Vec::new(),
            sources: Vec::new(),
            event_ids: Vec::new(),
            start_time: None,
            end_time: None,
            message_contains: None,
            computer_name: None,
            max_results: default_max_events(),
            newest_first: true,
        }
    }
}

/// Metadata about an available event log on the remote system.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventLogInfo {
    pub name: String,
    pub file_name: String,
    pub number_of_records: u64,
    pub max_file_size: u64,
    pub current_size: u64,
    pub overwrite_policy: String,
    pub overwrite_outdated: Option<u32>,
    pub sources: Vec<String>,
    pub status: String,
}

// ─── Windows Processes (Win32_Process) ───────────────────────────────

/// Mirrors the Win32_Process CIM class.
/// Ref: <https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process>
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsProcess {
    pub process_id: u32,
    pub parent_process_id: u32,
    pub name: String,
    pub executable_path: Option<String>,
    pub command_line: Option<String>,
    pub creation_date: Option<DateTime<Utc>>,
    pub status: Option<String>,
    /// Thread count.
    pub thread_count: u32,
    /// Handle count.
    pub handle_count: u32,
    /// Private memory (bytes).
    pub working_set_size: u64,
    /// Virtual memory (bytes).
    pub virtual_size: u64,
    /// Peak working set (bytes).
    pub peak_working_set_size: u64,
    /// Page faults.
    pub page_faults: u32,
    /// Page file usage (bytes).
    pub page_file_usage: u64,
    /// Peak page file usage (bytes).
    pub peak_page_file_usage: u64,
    /// Kernel-mode time (100-ns units).
    pub kernel_mode_time: u64,
    /// User-mode time (100-ns units).
    pub user_mode_time: u64,
    /// Priority.
    pub priority: u32,
    /// Session ID.
    pub session_id: u32,
    /// Owner (domain\user).
    pub owner: Option<String>,
    /// Read operation count.
    pub read_operation_count: Option<u64>,
    /// Write operation count.
    pub write_operation_count: Option<u64>,
    /// Read transfer count (bytes).
    pub read_transfer_count: Option<u64>,
    /// Write transfer count (bytes).
    pub write_transfer_count: Option<u64>,
}

/// Parameters for creating a remote process.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProcessParams {
    pub command_line: String,
    pub current_directory: Option<String>,
    /// Process creation flags.
    #[serde(default)]
    pub hidden: bool,
}

/// Result of process creation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProcessResult {
    pub process_id: u32,
    pub return_value: u32,
}

/// Filter for process queries.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessFilter {
    pub name: Option<String>,
    pub pid: Option<u32>,
    pub parent_pid: Option<u32>,
    pub executable_path_contains: Option<String>,
    pub command_line_contains: Option<String>,
    pub owner: Option<String>,
    pub min_working_set_mb: Option<u64>,
    pub session_id: Option<u32>,
    /// Sort field.
    #[serde(default = "default_proc_sort")]
    pub sort_by: ProcessSortField,
    #[serde(default)]
    pub sort_desc: bool,
    #[serde(default = "default_proc_limit")]
    pub limit: u32,
}

fn default_proc_sort() -> ProcessSortField {
    ProcessSortField::WorkingSetSize
}
fn default_proc_limit() -> u32 {
    500
}

impl Default for ProcessFilter {
    fn default() -> Self {
        Self {
            name: None,
            pid: None,
            parent_pid: None,
            executable_path_contains: None,
            command_line_contains: None,
            owner: None,
            min_working_set_mb: None,
            session_id: None,
            sort_by: ProcessSortField::WorkingSetSize,
            sort_desc: true,
            limit: default_proc_limit(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProcessSortField {
    Name,
    ProcessId,
    WorkingSetSize,
    CpuTime,
    ThreadCount,
    HandleCount,
    CreationDate,
}

// ─── Performance Monitoring ──────────────────────────────────────────

/// A snapshot of overall system performance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPerformanceSnapshot {
    pub timestamp: DateTime<Utc>,
    pub cpu: CpuPerformance,
    pub memory: MemoryPerformance,
    pub disks: Vec<DiskPerformance>,
    pub network: Vec<NetworkPerformance>,
    pub system: SystemCounters,
}

/// CPU performance counters.
/// Ref: Win32_PerfFormattedData_PerfOS_Processor
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuPerformance {
    /// Overall CPU usage percentage.
    pub total_usage_percent: f64,
    /// Per-core usage percentages.
    pub per_core_usage: Vec<f64>,
    /// Privileged (kernel) time percent.
    pub privileged_time_percent: f64,
    /// User time percent.
    pub user_time_percent: f64,
    /// Interrupt time percent.
    pub interrupt_time_percent: f64,
    /// DPC time percent.
    pub dpc_time_percent: f64,
    /// Idle time percent.
    pub idle_time_percent: f64,
    /// Processor queue length.
    pub processor_queue_length: u32,
    /// Context switches per second.
    pub context_switches_per_sec: u64,
    /// System calls per second.
    pub system_calls_per_sec: u64,
}

/// Memory performance counters.
/// Ref: Win32_PerfFormattedData_PerfOS_Memory, Win32_OperatingSystem
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPerformance {
    /// Total physical memory (bytes).
    pub total_physical_bytes: u64,
    /// Available physical memory (bytes).
    pub available_bytes: u64,
    /// Used percentage.
    pub used_percent: f64,
    /// Commit total (bytes).
    pub committed_bytes: u64,
    /// Commit limit (bytes).
    pub commit_limit: u64,
    /// Pages per second.
    pub pages_per_sec: u64,
    /// Page faults per second.
    pub page_faults_per_sec: u64,
    /// Cache bytes.
    pub cache_bytes: u64,
    /// Pool paged bytes.
    pub pool_paged_bytes: u64,
    /// Pool nonpaged bytes.
    pub pool_nonpaged_bytes: u64,
}

/// Per-disk performance counters.
/// Ref: Win32_PerfFormattedData_PerfDisk_PhysicalDisk
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskPerformance {
    pub name: String,
    /// Disk read bytes/sec.
    pub read_bytes_per_sec: u64,
    /// Disk write bytes/sec.
    pub write_bytes_per_sec: u64,
    /// Read IOPS.
    pub reads_per_sec: u64,
    /// Write IOPS.
    pub writes_per_sec: u64,
    /// Average disk queue length.
    pub avg_disk_queue_length: f64,
    /// Percent busy time.
    pub percent_disk_time: f64,
    /// Average seconds per read.
    pub avg_sec_per_read: f64,
    /// Average seconds per write.
    pub avg_sec_per_write: f64,
    /// Free space (bytes) — from Win32_LogicalDisk.
    pub free_space_bytes: Option<u64>,
    /// Total size (bytes) — from Win32_LogicalDisk.
    pub total_size_bytes: Option<u64>,
}

/// Per-NIC network performance counters.
/// Ref: Win32_PerfFormattedData_Tcpip_NetworkInterface
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPerformance {
    pub name: String,
    /// Bytes received/sec.
    pub bytes_received_per_sec: u64,
    /// Bytes sent/sec.
    pub bytes_sent_per_sec: u64,
    /// Total bytes/sec.
    pub bytes_total_per_sec: u64,
    /// Packets received/sec.
    pub packets_received_per_sec: u64,
    /// Packets sent/sec.
    pub packets_sent_per_sec: u64,
    /// Current bandwidth (bits/sec).
    pub current_bandwidth: u64,
    /// Output queue length.
    pub output_queue_length: u64,
    /// Packets received errors.
    pub packets_received_errors: u64,
    /// Packets outbound errors.
    pub packets_outbound_errors: u64,
    /// Packets received discarded.
    pub packets_received_discarded: u64,
    /// Packets outbound discarded.
    pub packets_outbound_discarded: u64,
}

/// System-wide counters.
/// Ref: Win32_PerfFormattedData_PerfOS_System
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCounters {
    /// Total processes running.
    pub processes: u32,
    /// Total threads.
    pub threads: u32,
    /// System uptime (seconds).
    pub system_up_time: u64,
    /// File data operations/sec.
    pub file_data_operations_per_sec: u64,
    /// File read operations/sec.
    pub file_read_operations_per_sec: u64,
    /// File write operations/sec.
    pub file_write_operations_per_sec: u64,
    /// System handle count.
    pub handle_count: Option<u32>,
}

/// Configuration for real-time performance monitoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfMonitorConfig {
    /// Polling interval in seconds.
    #[serde(default = "default_poll_interval")]
    pub interval_sec: u32,
    /// Include per-core CPU breakdown.
    #[serde(default = "default_true")]
    pub include_per_core_cpu: bool,
    /// Include disk counters.
    #[serde(default = "default_true")]
    pub include_disks: bool,
    /// Include network counters.
    #[serde(default = "default_true")]
    pub include_network: bool,
    /// Custom WMI perf class queries.
    #[serde(default)]
    pub custom_counters: Vec<CustomPerfCounter>,
    /// Max history samples to retain in memory.
    #[serde(default = "default_max_history")]
    pub max_history: usize,
}

fn default_poll_interval() -> u32 {
    5
}
fn default_true() -> bool {
    true
}
fn default_max_history() -> usize {
    720
}

impl Default for PerfMonitorConfig {
    fn default() -> Self {
        Self {
            interval_sec: default_poll_interval(),
            include_per_core_cpu: true,
            include_disks: true,
            include_network: true,
            custom_counters: Vec::new(),
            max_history: default_max_history(),
        }
    }
}

/// A custom performance counter query.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomPerfCounter {
    pub name: String,
    pub wmi_class: String,
    pub properties: Vec<String>,
    pub filter: Option<String>,
}

// ─── Registry ────────────────────────────────────────────────────────

/// Registry hive (root key).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RegistryHive {
    HkeyClassesRoot,
    HkeyCurrentUser,
    HkeyLocalMachine,
    HkeyUsers,
    HkeyCurrentConfig,
}

impl RegistryHive {
    /// Numeric value for WMI StdRegProv methods.
    pub fn to_wmi_value(&self) -> u32 {
        match self {
            Self::HkeyClassesRoot => 0x80000000,
            Self::HkeyCurrentUser => 0x80000001,
            Self::HkeyLocalMachine => 0x80000002,
            Self::HkeyUsers => 0x80000003,
            Self::HkeyCurrentConfig => 0x80000005,
        }
    }

    pub fn display_name(&self) -> &str {
        match self {
            Self::HkeyClassesRoot => "HKEY_CLASSES_ROOT",
            Self::HkeyCurrentUser => "HKEY_CURRENT_USER",
            Self::HkeyLocalMachine => "HKEY_LOCAL_MACHINE",
            Self::HkeyUsers => "HKEY_USERS",
            Self::HkeyCurrentConfig => "HKEY_CURRENT_CONFIG",
        }
    }
}

/// A registry value with its typed data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryValue {
    pub name: String,
    pub value_type: RegistryValueType,
    pub data: serde_json::Value,
}

/// Registry value types.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RegistryValueType {
    String,
    ExpandString,
    Binary,
    DWord,
    MultiString,
    QWord,
    Unknown,
}

/// Listing of a registry key's subkeys and values.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryKeyInfo {
    pub hive: RegistryHive,
    pub path: String,
    pub subkeys: Vec<String>,
    pub values: Vec<RegistryValue>,
}

/// Recursive tree representation of a registry key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryTreeNode {
    pub hive: RegistryHive,
    pub path: String,
    pub name: String,
    pub values: Vec<RegistryValue>,
    pub children: Vec<RegistryTreeNode>,
}

/// Filter parameters for registry search.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySearchFilter {
    /// The hive to search in.
    pub hive: RegistryHive,
    /// Root path to start the search from.
    pub root_path: String,
    /// Text pattern to match (case-insensitive substring by default).
    pub pattern: String,
    /// Whether to treat the pattern as a regex.
    #[serde(default)]
    pub is_regex: bool,
    /// Search key names.
    #[serde(default = "default_true")]
    pub search_keys: bool,
    /// Search value names.
    #[serde(default = "default_true")]
    pub search_value_names: bool,
    /// Search value data (strings only).
    #[serde(default)]
    pub search_value_data: bool,
    /// Maximum recursion depth (0 = unlimited).
    #[serde(default)]
    pub max_depth: u32,
    /// Maximum results.
    #[serde(default = "default_search_max")]
    pub max_results: u32,
}

fn default_search_max() -> u32 {
    500
}

/// A single result from a registry search.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySearchResult {
    pub hive: RegistryHive,
    pub path: String,
    pub match_type: RegistrySearchMatchType,
    /// The matching key name, value name, or value data.
    pub matched_text: String,
    /// The value (if the match was on a value name or value data).
    pub value: Option<RegistryValue>,
}

/// What part of the registry matched the search.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RegistrySearchMatchType {
    KeyName,
    ValueName,
    ValueData,
}

/// Export format for registry data.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RegistryExportFormat {
    /// Windows .reg file format (REGEDIT4 / Windows Registry Editor 5.00).
    RegFile,
    /// JSON representation.
    Json,
}

impl Default for RegistryExportFormat {
    fn default() -> Self {
        Self::RegFile
    }
}

/// A snapshot of a registry subtree for comparison.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySnapshot {
    pub hive: RegistryHive,
    pub root_path: String,
    pub computer_name: String,
    pub captured_at: DateTime<Utc>,
    pub keys: Vec<RegistrySnapshotKey>,
}

/// A single key within a snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySnapshotKey {
    pub path: String,
    pub values: Vec<RegistryValue>,
}

/// Result of comparing two registry snapshots.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryDiff {
    pub source: RegistryDiffSide,
    pub target: RegistryDiffSide,
    pub entries: Vec<RegistryDiffEntry>,
    pub summary: RegistryDiffSummary,
}

/// Identifies one side of a registry comparison.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryDiffSide {
    pub computer_name: String,
    pub hive: RegistryHive,
    pub root_path: String,
    pub captured_at: DateTime<Utc>,
}

/// Summary statistics of a diff.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryDiffSummary {
    pub keys_only_in_source: u32,
    pub keys_only_in_target: u32,
    pub values_only_in_source: u32,
    pub values_only_in_target: u32,
    pub values_different: u32,
    pub values_identical: u32,
}

/// A single difference between two snapshots.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryDiffEntry {
    pub path: String,
    pub diff_type: RegistryDiffType,
    pub value_name: Option<String>,
    pub source_value: Option<RegistryValue>,
    pub target_value: Option<RegistryValue>,
}

/// Classification of a diff entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RegistryDiffType {
    /// Key exists only in source.
    KeyOnlyInSource,
    /// Key exists only in target.
    KeyOnlyInTarget,
    /// Value exists only in source.
    ValueOnlyInSource,
    /// Value exists only in target.
    ValueOnlyInTarget,
    /// Value exists in both but differs.
    ValueDifferent,
}

/// A set of registry values to write in one batch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryBulkSetRequest {
    pub hive: RegistryHive,
    pub path: String,
    pub values: Vec<RegistryBulkValue>,
    /// Create the key if it doesn't exist.
    #[serde(default = "default_true")]
    pub create_key: bool,
}

/// A value to set in a bulk operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryBulkValue {
    pub name: String,
    pub value_type: RegistryValueType,
    pub data: serde_json::Value,
}

/// Result of a bulk set operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryBulkSetResult {
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub errors: Vec<RegistryBulkError>,
}

/// Error from a single item in a bulk operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryBulkError {
    pub name: String,
    pub error: String,
}

/// Security information for a registry key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryKeySecurity {
    pub hive: RegistryHive,
    pub path: String,
    pub owner: Option<String>,
    pub group: Option<String>,
    /// Raw SDDL string.
    pub sddl: Option<String>,
    pub permissions: Vec<RegistryAce>,
}

/// An Access Control Entry for a registry key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryAce {
    pub trustee: String,
    pub access_mask: u32,
    pub ace_type: String,
    pub ace_flags: u32,
    /// Human-readable permissions.
    pub permissions: Vec<String>,
}

/// Parameters for importing registry data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryImportRequest {
    /// The .reg file content or JSON string to import.
    pub content: String,
    /// Format of the content.
    #[serde(default)]
    pub format: RegistryExportFormat,
    /// If true, simulate the import without applying changes.
    #[serde(default)]
    pub dry_run: bool,
}

/// Result of a registry import operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryImportResult {
    pub keys_created: u32,
    pub values_set: u32,
    pub values_deleted: u32,
    pub errors: Vec<String>,
    pub dry_run: bool,
}

/// Parameters for a recursive registry key copy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryCopyRequest {
    pub source_hive: RegistryHive,
    pub source_path: String,
    pub dest_hive: RegistryHive,
    pub dest_path: String,
    /// Overwrite existing values.
    #[serde(default)]
    pub overwrite: bool,
}

/// Result of a registry copy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryCopyResult {
    pub keys_created: u32,
    pub values_copied: u32,
    pub errors: Vec<String>,
}

// ─── Scheduled Tasks ─────────────────────────────────────────────────

/// A scheduled task on the remote host.
/// Ref: MSFT_ScheduledTask (via Get-ScheduledTask / CIM).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub task_name: String,
    pub task_path: String,
    pub state: ScheduledTaskState,
    pub description: Option<String>,
    pub author: Option<String>,
    pub date: Option<String>,
    pub uri: Option<String>,
    pub last_run_time: Option<DateTime<Utc>>,
    pub last_task_result: Option<u32>,
    pub next_run_time: Option<DateTime<Utc>>,
    pub number_of_missed_runs: Option<u32>,
    pub actions: Vec<ScheduledTaskAction>,
    pub triggers: Vec<ScheduledTaskTrigger>,
    pub principal: Option<ScheduledTaskPrincipal>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ScheduledTaskState {
    Ready,
    Running,
    Disabled,
    Queued,
    Unknown,
}

impl ScheduledTaskState {
    pub fn from_value(v: u32) -> Self {
        match v {
            1 => Self::Disabled,
            2 => Self::Queued,
            3 => Self::Ready,
            4 => Self::Running,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskAction {
    pub action_type: String,
    pub execute: Option<String>,
    pub arguments: Option<String>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskTrigger {
    pub trigger_type: String,
    pub enabled: bool,
    pub start_boundary: Option<String>,
    pub end_boundary: Option<String>,
    pub repetition_interval: Option<String>,
    pub repetition_duration: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskPrincipal {
    pub user_id: Option<String>,
    pub run_level: Option<String>,
    pub logon_type: Option<String>,
}

// ─── System Information ──────────────────────────────────────────────

/// Aggregated system information snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub computer_system: ComputerSystemInfo,
    pub operating_system: OperatingSystemInfo,
    pub bios: BiosInfo,
    pub processors: Vec<ProcessorInfo>,
    pub logical_disks: Vec<LogicalDiskInfo>,
    pub network_adapters: Vec<NetworkAdapterInfo>,
    pub physical_memory: Vec<PhysicalMemoryInfo>,
}

/// Win32_ComputerSystem.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerSystemInfo {
    pub name: String,
    pub domain: String,
    pub manufacturer: String,
    pub model: String,
    pub total_physical_memory: u64,
    pub number_of_processors: u32,
    pub number_of_logical_processors: u32,
    pub domain_role: String,
    pub part_of_domain: bool,
    pub current_time_zone: Option<i32>,
    pub dns_host_name: Option<String>,
    pub workgroup: Option<String>,
    pub system_type: String,
    pub primary_owner_name: Option<String>,
    pub user_name: Option<String>,
}

/// Win32_OperatingSystem.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperatingSystemInfo {
    pub caption: String,
    pub version: String,
    pub build_number: String,
    pub os_architecture: String,
    pub serial_number: String,
    pub install_date: Option<String>,
    pub last_boot_up_time: Option<String>,
    pub local_date_time: Option<String>,
    pub registered_user: Option<String>,
    pub organization: Option<String>,
    pub windows_directory: String,
    pub system_directory: String,
    pub free_physical_memory: u64,
    pub total_visible_memory_size: u64,
    pub free_virtual_memory: u64,
    pub total_virtual_memory_size: u64,
    pub number_of_processes: u32,
    pub number_of_users: u32,
    pub service_pack_major_version: Option<u32>,
    pub service_pack_minor_version: Option<u32>,
    pub cs_name: String,
    pub status: String,
}

/// Win32_BIOS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiosInfo {
    pub manufacturer: String,
    pub name: String,
    pub serial_number: String,
    pub version: String,
    pub smbios_bios_version: Option<String>,
    pub release_date: Option<String>,
}

/// Win32_Processor.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessorInfo {
    pub name: String,
    pub device_id: String,
    pub manufacturer: String,
    pub number_of_cores: u32,
    pub number_of_logical_processors: u32,
    pub max_clock_speed: u32,
    pub current_clock_speed: u32,
    pub l2_cache_size: Option<u32>,
    pub l3_cache_size: Option<u32>,
    pub architecture: String,
    pub load_percentage: Option<u32>,
    pub address_width: u32,
    pub status: String,
}

/// Win32_LogicalDisk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogicalDiskInfo {
    pub device_id: String,
    pub drive_type: String,
    pub file_system: Option<String>,
    pub free_space: u64,
    pub size: u64,
    pub volume_name: Option<String>,
    pub volume_serial_number: Option<String>,
    pub compressed: bool,
    pub used_percent: f64,
}

/// Win32_NetworkAdapterConfiguration (active adapters only).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAdapterInfo {
    pub description: String,
    pub adapter_type: Option<String>,
    pub mac_address: Option<String>,
    pub ip_addresses: Vec<String>,
    pub ip_subnets: Vec<String>,
    pub default_ip_gateway: Vec<String>,
    pub dns_servers: Vec<String>,
    pub dhcp_enabled: bool,
    pub dhcp_server: Option<String>,
    pub speed: Option<u64>,
    pub interface_index: u32,
    pub net_connection_id: Option<String>,
    pub net_connection_status: Option<String>,
}

/// Win32_PhysicalMemory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalMemoryInfo {
    pub bank_label: Option<String>,
    pub capacity: u64,
    pub device_locator: String,
    pub form_factor: Option<String>,
    pub manufacturer: Option<String>,
    pub memory_type: Option<String>,
    pub part_number: Option<String>,
    pub serial_number: Option<String>,
    pub speed: Option<u32>,
    pub configured_clock_speed: Option<u32>,
}

// ─── Events (Tauri frontend) ─────────────────────────────────────────

/// Events emitted to the Tauri frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WinMgmtEvent {
    SessionConnected {
        session_id: String,
        computer_name: String,
        timestamp: DateTime<Utc>,
    },
    SessionDisconnected {
        session_id: String,
        timestamp: DateTime<Utc>,
    },
    ServiceStateChanged {
        session_id: String,
        service_name: String,
        old_state: ServiceState,
        new_state: ServiceState,
        timestamp: DateTime<Utc>,
    },
    ProcessCreated {
        session_id: String,
        process_id: u32,
        name: String,
        timestamp: DateTime<Utc>,
    },
    ProcessTerminated {
        session_id: String,
        process_id: u32,
        timestamp: DateTime<Utc>,
    },
    PerfSnapshotCollected {
        session_id: String,
        cpu_percent: f64,
        memory_percent: f64,
        timestamp: DateTime<Utc>,
    },
    Error {
        session_id: Option<String>,
        message: String,
        timestamp: DateTime<Utc>,
    },
}
