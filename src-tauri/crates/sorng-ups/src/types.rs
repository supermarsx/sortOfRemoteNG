//! Shared types for UPS / NUT management.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsConnectionConfig {
    /// SSH host
    pub host: String,
    pub port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key: Option<String>,
    /// NUT server host (default: localhost on the remote)
    pub nut_host: Option<String>,
    /// NUT server port (default: 3493)
    pub nut_port: Option<u16>,
    /// NUT username for authenticated commands
    pub nut_user: Option<String>,
    /// NUT password for authenticated commands
    pub nut_password: Option<String>,
    /// Connection timeout in seconds
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsConnectionSummary {
    pub host: String,
    pub ups_count: usize,
    pub nut_version: Option<String>,
    pub server_info: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSH output
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPS Devices
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsDevice {
    pub name: String,
    pub driver: Option<String>,
    pub port: Option<String>,
    pub description: Option<String>,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub firmware: Option<String>,
    pub status: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPS Status
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsStatus {
    pub device_name: String,
    pub status: Option<String>,
    pub load_percent: Option<f64>,
    pub input_voltage: Option<f64>,
    pub input_frequency: Option<f64>,
    pub output_voltage: Option<f64>,
    pub output_frequency: Option<f64>,
    pub output_current: Option<f64>,
    pub temperature: Option<f64>,
    pub humidity: Option<f64>,
    pub battery_charge: Option<f64>,
    pub battery_voltage: Option<f64>,
    pub battery_runtime: Option<u64>,
    pub battery_type: Option<String>,
    pub battery_date: Option<String>,
    pub battery_mfr_date: Option<String>,
    pub ups_power_nominal: Option<f64>,
    pub ups_realpower: Option<f64>,
    pub ups_realpower_nominal: Option<f64>,
    pub beeper_status: Option<String>,
    pub ups_delay_start: Option<u64>,
    pub ups_delay_shutdown: Option<u64>,
    pub ups_timer_start: Option<i64>,
    pub ups_timer_shutdown: Option<i64>,
    pub ups_test_result: Option<String>,
    pub ups_test_date: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Battery
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatteryInfo {
    pub charge_percent: Option<f64>,
    pub voltage: Option<f64>,
    pub voltage_nominal: Option<f64>,
    pub voltage_low: Option<f64>,
    pub voltage_high: Option<f64>,
    pub runtime_seconds: Option<u64>,
    pub runtime_low: Option<u64>,
    pub temperature: Option<f64>,
    pub type_name: Option<String>,
    pub date: Option<String>,
    pub mfr_date: Option<String>,
    pub packs: Option<u32>,
    pub packs_bad: Option<u32>,
    pub alarm_threshold: Option<String>,
    pub charge_low: Option<f64>,
    pub charge_warning: Option<f64>,
    pub charge_restart: Option<f64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsEvent {
    pub timestamp: Option<String>,
    pub device: Option<String>,
    pub event_type: UpsEventType,
    pub message: String,
    pub severity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpsEventType {
    OnBattery,
    OnLine,
    LowBattery,
    BatteryReplace,
    Overload,
    Trim,
    Boost,
    Bypass,
    Off,
    Shutdown,
    TestStarted,
    TestCompleted,
    TestFailed,
    CommLost,
    CommOk,
    Other,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Outlets
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsOutlet {
    pub id: String,
    pub name: Option<String>,
    pub status: Option<String>,
    pub switchable: Option<bool>,
    pub delay_shutdown: Option<u64>,
    pub delay_start: Option<u64>,
    pub description: Option<String>,
    pub type_name: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scheduling
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsSchedule {
    pub id: String,
    pub name: String,
    pub action: UpsScheduleAction,
    pub device: String,
    pub time: String,
    pub days: Vec<String>,
    pub enabled: bool,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpsScheduleAction {
    Shutdown,
    Restart,
    Test,
    BeeperOn,
    BeeperOff,
    LoadOff,
    LoadOn,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Thresholds
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsThreshold {
    pub name: String,
    pub variable: String,
    pub low: Option<f64>,
    pub high: Option<f64>,
    pub current_value: Option<f64>,
    pub unit: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Testing
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsTestResult {
    pub test_type: UpsTestType,
    pub result: Option<String>,
    pub timestamp: Option<String>,
    pub details: Option<String>,
    pub duration_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpsTestType {
    QuickTest,
    DeepTest,
    BatteryCalibration,
    PanelTest,
    GeneralTest,
}

// ═══════════════════════════════════════════════════════════════════════════════
// NUT Configuration
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NutConfig {
    pub mode: Option<String>,
    pub monitors: Vec<NutMonitor>,
    pub users: Vec<NutUser>,
    pub ups_configs: Vec<NutUpsConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NutMonitor {
    pub system: String,
    pub power_value: u32,
    pub username: String,
    pub password: String,
    pub monitor_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NutUser {
    pub username: String,
    pub password: Option<String>,
    pub actions: Vec<String>,
    pub instcmds: Vec<String>,
    pub upsmon_role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NutUpsConfig {
    pub name: String,
    pub driver: String,
    pub port: String,
    pub description: Option<String>,
    pub extra: HashMap<String, String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Notifications
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsNotification {
    pub id: String,
    pub event_type: String,
    pub message: Option<String>,
    pub exec_cmd: Option<String>,
    pub flags: Option<NotifyFlags>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotifyFlags {
    pub syslog: bool,
    pub wall: bool,
    pub exec: bool,
    pub ignore: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Commands & Variables
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsCommand {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsVariable {
    pub name: String,
    pub value: Option<String>,
    pub writable: bool,
    pub description: Option<String>,
    pub data_type: Option<String>,
    pub minimum: Option<String>,
    pub maximum: Option<String>,
    pub enum_values: Vec<String>,
}
