//! Shared types for UPS / NUT management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsConnectionConfig {
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    pub nut_host: Option<String>,
    pub nut_port: Option<u16>,
    pub nut_user: Option<String>,
    pub nut_password: Option<String>,
    pub protocol: Option<UpsProtocol>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpsProtocol {
    Nut,
    Snmp,
    Ssh,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsConnectionSummary {
    pub host: String,
    pub devices_count: u32,
    pub nut_version: Option<String>,
    pub server_info: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Devices
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsDevice {
    pub name: String,
    pub description: Option<String>,
    pub driver: String,
    pub port: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub firmware_version: Option<String>,
    pub ups_status: Option<String>,
    pub battery_charge: Option<f64>,
    pub battery_runtime: Option<u64>,
    pub input_voltage: Option<f64>,
    pub output_voltage: Option<f64>,
    pub output_power: Option<f64>,
    pub ups_load: Option<f64>,
    pub ups_temperature: Option<f64>,
    pub beeper_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsVariable {
    pub name: String,
    pub value: String,
    #[serde(rename = "type")]
    pub type_: Option<VarType>,
    pub description: Option<String>,
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VarType {
    String,
    Number,
    Enum,
    Range,
    Boolean,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsDriver {
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub supported_models: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDeviceRequest {
    pub name: String,
    pub driver: String,
    pub port: String,
    pub description: Option<String>,
    pub extra_config: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCapability {
    pub name: String,
    pub description: Option<String>,
    pub available: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Status
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsStatus {
    pub status_flags: Vec<UpsStatusFlag>,
    pub line_voltage: Option<f64>,
    pub line_frequency: Option<f64>,
    pub output_voltage: Option<f64>,
    pub output_frequency: Option<f64>,
    pub output_current: Option<f64>,
    pub output_power: Option<f64>,
    pub ups_load: Option<f64>,
    pub ups_temperature: Option<f64>,
    pub ups_efficiency: Option<f64>,
    pub input_sensitivity: Option<String>,
    pub alarm_status: Vec<String>,
    pub last_transfer_reason: Option<String>,
    pub self_test_result: Option<String>,
    pub self_test_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UpsStatusFlag {
    Online,
    OnBattery,
    LowBattery,
    HighBattery,
    Replacing,
    Charging,
    Discharging,
    Bypass,
    Off,
    Overload,
    Trim,
    Boost,
    ForcedShutdown,
    Alarm,
    Test,
    Calibrating,
    Communication,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowerQuality {
    pub input_voltage_min: Option<f64>,
    pub input_voltage_max: Option<f64>,
    pub input_voltage_avg: Option<f64>,
    pub input_frequency: Option<f64>,
    pub input_sensitivity: Option<String>,
    pub output_voltage: Option<f64>,
    pub output_frequency: Option<f64>,
    pub power_factor: Option<f64>,
    pub apparent_power: Option<f64>,
    pub active_power: Option<f64>,
    pub reactive_power: Option<f64>,
    pub thd_voltage: Option<f64>,
    pub thd_current: Option<f64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Battery
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatteryStatus {
    pub charge_percent: Option<f64>,
    pub runtime_seconds: Option<u64>,
    pub voltage: Option<f64>,
    pub voltage_nominal: Option<f64>,
    pub current: Option<f64>,
    pub temperature: Option<f64>,
    pub date_installed: Option<String>,
    pub date_last_replaced: Option<String>,
    pub chemistry: Option<String>,
    pub packs: Option<u32>,
    pub packs_bad: Option<u32>,
    pub health: BatteryHealth,
    pub capacity_ah: Option<f64>,
    pub remaining_ah: Option<f64>,
    pub charge_cycles: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BatteryHealth {
    Good,
    Weak,
    Replace,
    Unknown,
}

impl Default for BatteryHealth {
    fn default() -> Self {
        Self::Unknown
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatteryTest {
    pub result: Option<String>,
    pub date: Option<String>,
    pub duration_secs: Option<u64>,
    pub details: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Outlet
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsOutlet {
    pub id: u32,
    pub name: Option<String>,
    pub status: OutletStatus,
    pub switchable: bool,
    pub delay_start: Option<u32>,
    pub delay_shutdown: Option<u32>,
    pub load_watts: Option<f64>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutletStatus {
    On,
    Off,
    Unknown,
}

impl Default for OutletStatus {
    fn default() -> Self {
        Self::Unknown
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutletGroup {
    pub id: String,
    pub name: String,
    pub outlets: Vec<u32>,
    pub status: OutletStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetOutletRequest {
    pub id: u32,
    pub status: OutletStatus,
    pub delay_secs: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsEvent {
    pub timestamp: String,
    pub device: String,
    pub event_type: UpsEventType,
    pub message: String,
    pub severity: EventSeverity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpsEventType {
    OnLine,
    OnBattery,
    LowBattery,
    BatteryReplace,
    CommunicationsOk,
    CommunicationsLost,
    Shutdown,
    SelfTest,
    Overload,
    Bypass,
    Alarm,
    ForcedShutdown,
    CalibrationStart,
    CalibrationEnd,
    Temperature,
    VoltageExcursion,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventSeverity {
    Info,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventFilter {
    pub device: Option<String>,
    pub event_types: Option<Vec<UpsEventType>>,
    pub severity: Option<EventSeverity>,
    pub from_time: Option<String>,
    pub to_time: Option<String>,
    pub limit: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NutConfig {
    pub mode: NutMode,
    pub listen_addresses: Vec<String>,
    pub max_retry: Option<u32>,
    pub retry_interval: Option<u32>,
    pub maxage: Option<u32>,
    pub state_path: Option<String>,
    pub run_as_user: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NutMode {
    #[serde(rename = "none")]
    None_,
    Standalone,
    Netserver,
    Netclient,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NutUpsConfig {
    pub name: String,
    pub driver: String,
    pub port: String,
    pub desc: Option<String>,
    pub extra: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NutUpsdConfig {
    pub listen: Vec<NutListen>,
    pub maxage: Option<u32>,
    pub statepath: Option<String>,
    pub certfile: Option<String>,
    pub maxconn: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NutListen {
    pub address: String,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsmonConfig {
    pub monitor_entries: Vec<UpsmonEntry>,
    pub notify_cmd: Option<String>,
    pub shutdown_cmd: Option<String>,
    pub min_supplies: Option<u32>,
    pub power_down_flag: Option<String>,
    pub polling_freq: Option<u32>,
    pub dead_time: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsmonEntry {
    pub system: String,
    pub power_value: Option<u32>,
    pub username: String,
    pub password: String,
    #[serde(rename = "type")]
    pub type_: UpsmonType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpsmonType {
    Primary,
    Secondary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsSched {
    pub at_entries: Vec<UpsSchedEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsSchedEntry {
    pub ups_name: String,
    pub event: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Actions
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShutdownRequest {
    pub device: String,
    #[serde(rename = "type")]
    pub type_: ShutdownType,
    pub delay_secs: Option<u64>,
    pub return_delay_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShutdownType {
    Normal,
    LowBattery,
    Stayoff,
    Reboot,
    RebootGraceful,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResult {
    pub success: bool,
    pub message: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scheduling
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowerSchedule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub device: String,
    pub action: ScheduleAction,
    pub cron_expression: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleAction {
    Shutdown,
    Restart,
    SelfTest,
    Calibrate,
    OutletOn,
    OutletOff,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateScheduleRequest {
    pub name: String,
    pub device: String,
    pub action: ScheduleAction,
    pub cron_expression: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateScheduleRequest {
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub action: Option<ScheduleAction>,
    pub cron_expression: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleHistoryEntry {
    pub schedule_id: String,
    pub executed_at: String,
    pub result: String,
    pub details: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// NUT
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NutServerInfo {
    pub version: Option<String>,
    pub num_ups_devices: u32,
    pub num_clients: u32,
    pub num_connections: u32,
    pub server_actions: Vec<String>,
}
