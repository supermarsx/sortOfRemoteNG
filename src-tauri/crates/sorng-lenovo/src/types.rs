//! Shared data structures for Lenovo XCC/IMM management.

use serde::{Deserialize, Serialize};

// Re-export common BMC types so consumers only need `sorng_lenovo::types::*`
pub use sorng_bmc_common::types::*;
pub use sorng_bmc_common::power::PowerAction;
pub use sorng_bmc_common::redfish::RedfishSession;

// ── Controller generation ───────────────────────────────────────────

/// Lenovo management controller generation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum XccGeneration {
    /// XClarity Controller 2 — ThinkSystem V3 (SR635 V3, SR645 V3, SD530 V3, etc.)
    Xcc2,
    /// XClarity Controller — ThinkSystem V1/V2 (SR630, SR650, SR950, etc.)
    Xcc,
    /// Integrated Management Module II — System x M5/M6 (x3650 M5, etc.)
    Imm2,
    /// Integrated Management Module — System x M4 (x3650 M4, etc.)
    Imm,
    /// Unknown / auto-detect
    Unknown,
}

impl XccGeneration {
    pub fn display_name(&self) -> &str {
        match self {
            Self::Xcc2 => "XCC2 (ThinkSystem V3)",
            Self::Xcc => "XCC (ThinkSystem V1/V2)",
            Self::Imm2 => "IMM2 (System x M5/M6)",
            Self::Imm => "IMM (System x M4)",
            Self::Unknown => "Unknown",
        }
    }

    /// Whether this generation supports Redfish (DMTF standard).
    pub fn supports_redfish(&self) -> bool {
        matches!(self, Self::Xcc2 | Self::Xcc)
    }

    /// Whether this generation supports the legacy IMM2 REST API.
    pub fn supports_legacy_rest(&self) -> bool {
        matches!(self, Self::Imm2)
    }

    /// Whether this generation supports IPMI-over-LAN.
    pub fn supports_ipmi(&self) -> bool {
        // All generations support IPMI
        true
    }

    /// Whether this generation supports HTML5 remote console.
    pub fn supports_html5_console(&self) -> bool {
        matches!(self, Self::Xcc2 | Self::Xcc)
    }

    /// Whether this generation supports Java-based remote console.
    pub fn supports_java_console(&self) -> bool {
        matches!(self, Self::Imm2 | Self::Imm)
    }

    /// Server family name.
    pub fn server_family(&self) -> &str {
        match self {
            Self::Xcc2 => "ThinkSystem V3",
            Self::Xcc => "ThinkSystem",
            Self::Imm2 => "System x",
            Self::Imm => "System x (legacy)",
            Self::Unknown => "Lenovo Server",
        }
    }
}

// ── Protocol / connection ───────────────────────────────────────────

/// Protocol used to communicate with the management controller.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LenovoProtocol {
    Redfish,
    LegacyRest,
    Ipmi,
}

/// Authentication method.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LenovoAuthMethod {
    Basic,
    Session,
}

/// Connection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LenovoConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub auth_method: LenovoAuthMethod,
    /// Force a specific protocol (auto-detect if None)
    pub protocol: Option<LenovoProtocol>,
    /// Accept self-signed / untrusted TLS certificates
    pub insecure: bool,
    /// Request timeout in seconds
    pub timeout_secs: u64,
    /// IPMI port (default 623)
    pub ipmi_port: u16,
    /// Controller generation override (auto-detect if None)
    pub generation: Option<XccGeneration>,
}

/// Sanitised config returned to the frontend (no secrets).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LenovoConfigSafe {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub insecure: bool,
    pub generation: XccGeneration,
    pub protocol: LenovoProtocol,
}

// ── Controller info ─────────────────────────────────────────────────

/// Information about the XCC/IMM controller itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XccInfo {
    pub generation: XccGeneration,
    pub firmware_version: String,
    pub firmware_date: Option<String>,
    pub ip_address: String,
    pub mac_address: Option<String>,
    pub hostname: Option<String>,
    pub serial_number: Option<String>,
    pub model: Option<String>,
    pub uuid: Option<String>,
    pub fqdn: Option<String>,
}

// ── License ─────────────────────────────────────────────────────────

/// XCC license tier / feature level.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum XccLicenseTier {
    /// Standard (basic monitoring)
    Standard,
    /// Advanced (remote console, virtual media, etc.)
    Advanced,
    /// Enterprise / XClarity (full feature set)
    Enterprise,
    /// Features On Demand — per-feature licensing
    Fod,
    /// Unknown or not detected
    Other(String),
}

/// XCC license information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XccLicense {
    pub tier: XccLicenseTier,
    pub description: String,
    pub expiration: Option<String>,
    pub key_id: Option<String>,
    pub features: Vec<String>,
    pub status: String,
}

// ── Console ─────────────────────────────────────────────────────────

/// Remote console type.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConsoleType {
    Html5,
    JavaApplet,
}

/// Remote console information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XccConsoleInfo {
    pub console_types: Vec<ConsoleType>,
    pub max_sessions: u32,
    pub active_sessions: u32,
    pub html5_url: Option<String>,
    pub requires_license: bool,
}

// ── Dashboard ───────────────────────────────────────────────────────

/// Aggregated dashboard for quick overview.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XccDashboard {
    pub system: Option<BmcSystemInfo>,
    pub controller: Option<XccInfo>,
    pub power_state: Option<String>,
    pub health: Option<BmcHealthRollup>,
    pub power_watts: Option<f64>,
    pub ambient_temp_celsius: Option<f64>,
    pub cpu_temp_celsius: Option<f64>,
    pub fan_count: Option<u32>,
    pub dimm_count: Option<u32>,
    pub disk_count: Option<u32>,
}

// ── Thermal summary ─────────────────────────────────────────────────

/// Thermal summary for quick overview.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalSummary {
    pub ambient_celsius: Option<f64>,
    pub cpu_max_celsius: Option<f64>,
    pub fan_count: u32,
    pub fans_ok: u32,
    pub temp_sensors: u32,
    pub temp_warnings: u32,
    pub temp_critical: u32,
}

// ── BIOS ────────────────────────────────────────────────────────────

/// BIOS/UEFI attribute.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiosAttribute {
    pub name: String,
    pub current_value: serde_json::Value,
    pub pending_value: Option<serde_json::Value>,
    pub read_only: bool,
    pub attribute_type: Option<String>,
    pub allowed_values: Option<Vec<serde_json::Value>>,
}

/// Boot configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootConfig {
    pub boot_mode: String,      // UEFI or Legacy
    pub boot_order: Vec<String>,
    pub next_boot_override: Option<String>,
    pub uefi_target: Option<String>,
}

/// Boot source reference.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootSource {
    pub id: String,
    pub name: String,
    pub boot_type: String,
    pub enabled: bool,
}

// ── Certificate ─────────────────────────────────────────────────────

/// TLS/SSL certificate information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XccCertificate {
    pub subject: String,
    pub issuer: String,
    pub valid_from: String,
    pub valid_to: String,
    pub serial_number: String,
    pub fingerprint: Option<String>,
    pub key_usage: Option<String>,
    pub self_signed: bool,
}

/// CSR generation parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsrParams {
    pub common_name: String,
    pub organization: String,
    pub organizational_unit: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub country: String,
    pub alt_names: Option<Vec<String>>,
}

// ── LDAP / Active Directory ─────────────────────────────────────────

/// Directory service configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryConfig {
    pub enabled: bool,
    pub directory_type: String, // LDAP or Active Directory
    pub servers: Vec<String>,
    pub base_dn: String,
    pub bind_dn: Option<String>,
    pub search_filter: Option<String>,
    pub use_tls: bool,
    pub port: u16,
}

// ── OneCLI passthrough ──────────────────────────────────────────────

/// OneCLI command result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnecliResult {
    pub command: String,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

// ── Security ────────────────────────────────────────────────────────

/// XCC security status / hardening posture.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XccSecurityStatus {
    pub overall_status: String,
    pub tls_version: String,
    pub ipmi_over_lan: bool,
    pub ssh_enabled: bool,
    pub snmp_enabled: bool,
    pub cim_over_https: bool,
    pub security_risks: Vec<SecurityRiskItem>,
}

/// Individual security risk/finding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityRiskItem {
    pub id: String,
    pub severity: String,
    pub description: String,
    pub remediation: Option<String>,
}
