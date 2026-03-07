//! Shared data structures for Supermicro BMC management.

use serde::{Deserialize, Serialize};

// Re-export common BMC types so consumers only need `sorng_supermicro::types::*`
pub use sorng_bmc_common::types::*;
pub use sorng_bmc_common::power::PowerAction;
pub use sorng_bmc_common::redfish::RedfishSession;

// ── Platform generation ─────────────────────────────────────────────

/// Supermicro motherboard / BMC platform generation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SmcPlatform {
    /// X13 — Latest Intel Xeon Scalable (Sapphire Rapids+)
    X13,
    /// H13 — Latest AMD EPYC (Genoa/Bergamo)
    H13,
    /// X12 — Intel Xeon Scalable 3rd Gen (Ice Lake)
    X12,
    /// H12 — AMD EPYC 7003 (Milan)
    H12,
    /// X11 — Intel Xeon Scalable 1st/2nd Gen (Skylake/Cascade Lake)
    X11,
    /// X10 — Intel Xeon E5/E7 v3/v4 (Haswell/Broadwell)
    X10,
    /// X9 — Intel Xeon E5/E7 v1/v2 (Sandy Bridge/Ivy Bridge)
    X9,
    /// Unknown / auto-detect
    Unknown,
}

impl SmcPlatform {
    pub fn display_name(&self) -> &str {
        match self {
            Self::X13 => "X13 (Intel SPR+)",
            Self::H13 => "H13 (AMD Genoa+)",
            Self::X12 => "X12 (Intel ICX)",
            Self::H12 => "H12 (AMD Milan)",
            Self::X11 => "X11 (Intel SKL/CLX)",
            Self::X10 => "X10 (Intel HSW/BDW)",
            Self::X9 => "X9 (Intel SNB/IVB)",
            Self::Unknown => "Unknown",
        }
    }

    /// Whether this platform supports Redfish (DMTF standard).
    pub fn supports_redfish(&self) -> bool {
        matches!(self, Self::X13 | Self::H13 | Self::X12 | Self::H12 | Self::X11)
    }

    /// Whether this platform supports the legacy ATEN CGI web API.
    pub fn supports_legacy_web(&self) -> bool {
        matches!(self, Self::X12 | Self::H12 | Self::X11 | Self::X10 | Self::X9)
    }

    /// Whether this platform supports IPMI-over-LAN.
    pub fn supports_ipmi(&self) -> bool {
        // All Supermicro platforms support IPMI
        true
    }

    /// Whether this platform supports HTML5 iKVM console.
    pub fn supports_html5_ikvm(&self) -> bool {
        matches!(self, Self::X13 | Self::H13 | Self::X12 | Self::H12 | Self::X11)
    }

    /// Whether this platform supports Java-based KVM console.
    pub fn supports_java_kvm(&self) -> bool {
        matches!(self, Self::X10 | Self::X9)
    }

    /// Whether this platform supports Intel Node Manager power capping.
    pub fn supports_node_manager(&self) -> bool {
        matches!(self, Self::X13 | Self::X12 | Self::X11 | Self::X10)
    }

    /// CPU vendor for this platform.
    pub fn cpu_vendor(&self) -> &str {
        match self {
            Self::H13 | Self::H12 => "AMD",
            _ => "Intel",
        }
    }
}

// ── Protocol / connection ───────────────────────────────────────────

/// Protocol used to communicate with the BMC.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SmcProtocol {
    Redfish,
    LegacyWeb,
    Ipmi,
}

/// Authentication method.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SmcAuthMethod {
    Basic,
    Session,
}

/// Connection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmcConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(skip_serializing)]
    pub password: String,
    pub use_ssl: bool,
    pub verify_cert: bool,
    pub platform: SmcPlatform,
    pub auth_method: SmcAuthMethod,
    pub timeout_secs: u64,
}

impl Default for SmcConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 443,
            username: String::from("ADMIN"),
            password: String::new(),
            use_ssl: true,
            verify_cert: false,
            platform: SmcPlatform::Unknown,
            auth_method: SmcAuthMethod::Session,
            timeout_secs: 30,
        }
    }
}

/// Safe view of connection config (no password).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmcConfigSafe {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub use_ssl: bool,
    pub verify_cert: bool,
    pub platform: SmcPlatform,
    pub auth_method: SmcAuthMethod,
}

impl From<&SmcConfig> for SmcConfigSafe {
    fn from(c: &SmcConfig) -> Self {
        Self {
            host: c.host.clone(),
            port: c.port,
            username: c.username.clone(),
            use_ssl: c.use_ssl,
            verify_cert: c.verify_cert,
            platform: c.platform.clone(),
            auth_method: c.auth_method.clone(),
        }
    }
}

// ── BMC info ────────────────────────────────────────────────────────

/// Supermicro BMC controller information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmcBmcInfo {
    pub platform: SmcPlatform,
    pub firmware_version: String,
    pub firmware_build_date: Option<String>,
    pub bmc_mac_address: Option<String>,
    pub ipmi_version: Option<String>,
    pub bmc_model: Option<String>,
    pub unique_id: Option<String>,
}

// ── License info (Supermicro SFT-OOB-LIC / SFT-DCMS-SINGLE) ───────

/// Supermicro license tier (BMC/BIOS feature key).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SmcLicenseTier {
    /// Standard BMC — basic IPMI, web, SOL
    Standard,
    /// SFT-OOB-LIC — Out-of-Band management (iKVM, virtual media, etc.)
    OutOfBand,
    /// SFT-DCMS-SINGLE — Data Center Management Suite (node manager, power capping)
    Dcms,
    /// SFT-SPM-LIC — Server Power Management
    Spm,
    /// Other / unknown key
    Other(String),
}

/// Supermicro license information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmcLicense {
    pub tier: SmcLicenseTier,
    pub product_key: Option<String>,
    pub activated: bool,
    pub expiration: Option<String>,
    pub description: Option<String>,
}

// ── Console types ───────────────────────────────────────────────────

/// Remote console type available.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SmcConsoleType {
    /// HTML5-based iKVM (X11+)
    Html5Ikvm,
    /// Java-based KVM (X9/X10)
    JavaKvm,
}

/// Console / iKVM session information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmcConsoleInfo {
    pub console_type: SmcConsoleType,
    pub enabled: bool,
    pub max_sessions: u32,
    pub active_sessions: u32,
    pub encryption_enabled: bool,
    pub port: Option<u16>,
    pub ssl_port: Option<u16>,
    pub launch_url: Option<String>,
}

// ── Dashboard / aggregates ──────────────────────────────────────────

/// Aggregate dashboard for a Supermicro server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmcDashboard {
    pub platform: SmcPlatform,
    pub system_info: Option<SystemInfo>,
    pub bmc_info: Option<SmcBmcInfo>,
    pub power_state: Option<String>,
    pub health_status: Option<String>,
    pub total_memory_gb: Option<f64>,
    pub cpu_count: Option<u32>,
    pub storage_controller_count: Option<u32>,
    pub nic_count: Option<u32>,
    pub ambient_temp_celsius: Option<f64>,
    pub total_power_watts: Option<f64>,
    pub sel_entry_count: Option<u32>,
    pub license_tier: Option<SmcLicenseTier>,
}

// ── Thermal summary ─────────────────────────────────────────────────

/// Aggregated thermal status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalSummary {
    pub ambient_temp_celsius: Option<f64>,
    pub cpu_max_temp_celsius: Option<f64>,
    pub dimm_max_temp_celsius: Option<f64>,
    pub fan_count: u32,
    pub fans_ok: u32,
    pub fans_warning: u32,
    pub fans_critical: u32,
    pub overall_status: String,
}

// ── BIOS settings ───────────────────────────────────────────────────

/// A single BIOS/UEFI attribute.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiosAttribute {
    pub name: String,
    pub current_value: serde_json::Value,
    pub default_value: Option<serde_json::Value>,
    pub attribute_type: Option<String>,
    pub allowed_values: Option<Vec<serde_json::Value>>,
    pub read_only: bool,
    pub description: Option<String>,
}

/// Boot configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootConfig {
    pub boot_mode: String,
    pub boot_order: Vec<BootSource>,
    pub current_boot_source: Option<String>,
    pub uefi_secure_boot: Option<bool>,
}

/// Single boot source in boot order.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootSource {
    pub index: u32,
    pub name: String,
    pub enabled: bool,
    pub device_type: Option<String>,
}

// ── Certificate management ──────────────────────────────────────────

/// BMC SSL/TLS certificate information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmcCertificate {
    pub subject: String,
    pub issuer: String,
    pub valid_from: String,
    pub valid_to: String,
    pub serial_number: String,
    pub thumbprint: Option<String>,
    pub key_size: Option<u32>,
    pub signature_algorithm: Option<String>,
}

/// Certificate signing request parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsrParams {
    pub common_name: String,
    pub organization: Option<String>,
    pub organizational_unit: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub country: Option<String>,
    pub email: Option<String>,
    pub key_size: Option<u32>,
}

// ── LDAP / directory ────────────────────────────────────────────────

/// LDAP/AD directory service configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryConfig {
    pub enabled: bool,
    pub service_type: String,
    pub server_addresses: Vec<String>,
    pub port: u16,
    pub use_ssl: bool,
    pub base_dn: Option<String>,
    pub bind_dn: Option<String>,
    pub search_filter: Option<String>,
    pub role_mapping: Option<Vec<RoleMapping>>,
}

/// LDAP role to BMC privilege mapping.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleMapping {
    pub ldap_group: String,
    pub bmc_role: String,
}

// ── Node Manager (Intel power capping) ──────────────────────────────

/// Intel Node Manager power policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeManagerPolicy {
    pub policy_id: u32,
    pub enabled: bool,
    pub domain: NodeManagerDomain,
    pub power_limit_watts: u32,
    pub correction_time_ms: u32,
    pub trigger_type: String,
    pub reporting_period_secs: u32,
}

/// Intel Node Manager power domain.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum NodeManagerDomain {
    /// Entire platform
    Platform,
    /// CPU subsystem only
    Cpu,
    /// Memory subsystem only
    Memory,
    /// I/O subsystem
    Io,
}

/// Node Manager statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeManagerStats {
    pub domain: NodeManagerDomain,
    pub current_watts: f64,
    pub min_watts: f64,
    pub max_watts: f64,
    pub avg_watts: f64,
    pub timestamp: String,
    pub reporting_period_secs: u32,
}

// ── Security ────────────────────────────────────────────────────────

/// BMC security configuration status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmcSecurityStatus {
    pub ssl_enabled: bool,
    pub ssl_cert_valid: bool,
    pub ipmi_over_lan_enabled: bool,
    pub ssh_enabled: bool,
    pub web_session_timeout_mins: u32,
    pub account_lockout_enabled: bool,
    pub max_login_failures: Option<u32>,
    pub lockout_duration_secs: Option<u32>,
    pub default_password_warning: bool,
    pub risks: Vec<SecurityRiskItem>,
}

/// Single security risk/finding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityRiskItem {
    pub severity: String,
    pub category: String,
    pub message: String,
    pub remediation: Option<String>,
}

// ── Supermicro-specific data types ──────────────────────────────────
// These mirror Redfish responses with Supermicro-specific field sets.
// They intentionally shadow the `Bmc*` types from bmc-common because
// the field names / optionality differ per vendor.

/// Server system information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub manufacturer: String,
    pub model: String,
    pub serial_number: Option<String>,
    pub sku: Option<String>,
    pub bios_version: Option<String>,
    pub hostname: Option<String>,
    pub power_state: Option<String>,
    pub indicator_led: Option<String>,
    pub asset_tag: Option<String>,
    pub uuid: Option<String>,
    pub service_tag: Option<String>,
    pub os_name: Option<String>,
    pub os_version: Option<String>,
    pub total_memory_gib: Option<f64>,
    pub processor_count: Option<u32>,
    pub processor_model: Option<String>,
}

/// Power supply unit information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PsuInfo {
    pub name: String,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub firmware_version: Option<String>,
    pub status: String,
    pub capacity_watts: Option<f64>,
    pub output_watts: Option<f64>,
    pub input_voltage: Option<f64>,
    pub efficiency_percent: Option<f64>,
    pub redundancy: Option<String>,
}

/// Power consumption metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerMetrics {
    pub total_consumed_watts: Option<f64>,
    pub average_consumed_watts: Option<f64>,
    pub max_consumed_watts: Option<f64>,
    pub min_consumed_watts: Option<f64>,
    pub power_cap_watts: Option<f64>,
    pub power_cap_enabled: bool,
    pub power_supplies: Vec<PsuInfo>,
}

/// Temperature sensor reading.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemperatureReading {
    pub name: String,
    pub reading_celsius: Option<f64>,
    pub upper_warning: Option<f64>,
    pub upper_critical: Option<f64>,
    pub upper_fatal: Option<f64>,
    pub lower_warning: Option<f64>,
    pub lower_critical: Option<f64>,
    pub status: String,
    pub location: Option<String>,
}

/// Fan reading.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FanReading {
    pub name: String,
    pub reading_rpm: Option<u32>,
    pub reading_percent: Option<f64>,
    pub status: String,
    pub location: Option<String>,
    pub redundancy: Option<String>,
}

/// Combined thermal data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalData {
    pub temperatures: Vec<TemperatureReading>,
    pub fans: Vec<FanReading>,
}

/// CPU / processor information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessorInfo {
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub architecture: Option<String>,
    pub core_count: Option<u32>,
    pub thread_count: Option<u32>,
    pub max_speed_mhz: Option<u32>,
    pub current_speed_mhz: Option<u32>,
    pub status: String,
    pub socket: Option<String>,
    pub cache_size_kb: Option<u32>,
}

/// Memory DIMM information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub name: String,
    pub capacity_mib: Option<u32>,
    pub speed_mhz: Option<u32>,
    pub manufacturer: Option<String>,
    pub part_number: Option<String>,
    pub serial_number: Option<String>,
    pub memory_type: Option<String>,
    pub status: String,
    pub slot: Option<String>,
    pub rank: Option<u32>,
    pub ecc: Option<bool>,
}

/// Storage controller.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageController {
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub firmware_version: Option<String>,
    pub status: String,
    pub speed_gbps: Option<f64>,
    pub supported_raid: Option<Vec<String>>,
    pub cache_size_mb: Option<u32>,
}

/// Virtual / logical disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualDisk {
    pub name: String,
    pub raid_level: Option<String>,
    pub capacity_bytes: Option<u64>,
    pub status: String,
    pub stripe_size_kb: Option<u32>,
    pub read_policy: Option<String>,
    pub write_policy: Option<String>,
}

/// Physical disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalDisk {
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub capacity_bytes: Option<u64>,
    pub media_type: Option<String>,
    pub protocol: Option<String>,
    pub rotation_speed_rpm: Option<u32>,
    pub status: String,
    pub firmware_version: Option<String>,
    pub slot: Option<u32>,
    pub predicted_life_left_percent: Option<f64>,
}

/// Network adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAdapter {
    pub name: String,
    pub mac_address: Option<String>,
    pub link_status: Option<String>,
    pub speed_mbps: Option<u32>,
    pub ipv4_addresses: Option<Vec<String>>,
    pub ipv6_addresses: Option<Vec<String>>,
    pub status: String,
    pub firmware_version: Option<String>,
}

/// Firmware inventory item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareInfo {
    pub name: String,
    pub version: String,
    pub updateable: bool,
    pub component: Option<String>,
    pub install_date: Option<String>,
    pub status: Option<String>,
}

/// Virtual media device status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualMediaStatus {
    pub name: String,
    pub media_types: Vec<String>,
    pub inserted: bool,
    pub image: Option<String>,
    pub write_protected: Option<bool>,
    pub connected_via: Option<String>,
}

/// Event log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventLogEntry {
    pub id: String,
    pub timestamp: String,
    pub severity: String,
    pub message: String,
    pub message_id: Option<String>,
    pub source: Option<String>,
    pub category: Option<String>,
}

/// User account.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAccount {
    pub id: String,
    pub username: String,
    pub role: String,
    pub enabled: bool,
    pub locked: bool,
    pub description: Option<String>,
}

/// Health component status (Supermicro-specific; shadows bmc-common `ComponentHealth`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentHealth {
    pub name: String,
    pub status: String,
    pub component_type: String,
    pub details: Option<String>,
}

/// Overall health rollup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthRollup {
    pub overall_status: String,
    pub components: Vec<ComponentHealth>,
}
