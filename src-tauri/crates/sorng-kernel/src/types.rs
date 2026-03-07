//! Data types for kernel management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelHost {
    pub id: String,
    pub name: String,
    pub ssh: Option<SshConfig>,
    pub use_sudo: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── Kernel Modules ─────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModuleState {
    Live,
    Loading,
    Unloading,
}

impl ModuleState {
    pub fn parse(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "live" => Self::Live,
            "loading" => Self::Loading,
            "unloading" => Self::Unloading,
            _ => Self::Live,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelModule {
    pub name: String,
    pub size_bytes: u64,
    pub used_by: Vec<String>,
    pub use_count: u32,
    pub state: ModuleState,
    pub offset: Option<String>,
    pub taint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleParameter {
    pub name: String,
    pub param_type: String,
    pub description: String,
    pub current_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleInfo {
    pub name: String,
    pub filename: String,
    pub license: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub firmware: Vec<String>,
    pub depends: Vec<String>,
    pub alias: Vec<String>,
    pub parm: Vec<ModuleParameter>,
}

// ─── Sysctl ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SysctlSource {
    Runtime,
    Persistent,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SysctlEntry {
    pub key: String,
    pub value: String,
    pub source: SysctlSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SysctlCategory {
    Kernel,
    Net,
    Vm,
    Fs,
    Debug,
    Dev,
    Abi,
    User,
}

impl SysctlCategory {
    pub fn prefix(&self) -> &'static str {
        match self {
            Self::Kernel => "kernel.",
            Self::Net    => "net.",
            Self::Vm     => "vm.",
            Self::Fs     => "fs.",
            Self::Debug  => "debug.",
            Self::Dev    => "dev.",
            Self::Abi    => "abi.",
            Self::User   => "user.",
        }
    }
}

// ─── Kernel Config / Features ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelConfig {
    pub option_name: String,
    pub value: String,
    pub section: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelFeature {
    pub name: String,
    pub available: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelVersion {
    pub version: String,
    pub release: String,
    pub full_string: String,
    pub build_date: Option<String>,
}

// ─── /proc info ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterruptInfo {
    pub irq: String,
    pub cpu_counts: Vec<u64>,
    pub chip_name: String,
    pub hw_irq: String,
    pub actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmaInfo {
    pub channel: u32,
    pub device: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IoPortInfo {
    pub range_start: String,
    pub range_end: String,
    pub device: String,
}

// ─── Power management ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowerState {
    pub current_state: String,
    pub available_states: Vec<String>,
    pub suspend_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TripPoint {
    pub temp_millicelsius: i64,
    pub trip_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThermalZone {
    pub name: String,
    pub type_str: String,
    pub temp_millicelsius: i64,
    pub trip_points: Vec<TripPoint>,
}

// ─── Sysfs ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SysfsAttribute {
    pub path: String,
    pub value: String,
    pub writable: bool,
}
