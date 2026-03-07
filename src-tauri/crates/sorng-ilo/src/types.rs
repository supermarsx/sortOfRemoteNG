//! iLO-specific data structures.
//!
//! Re-exports common BMC types from `sorng-bmc-common` and adds
//! HP/HPE-specific structures for RIBCL, licensing, federation, etc.

use serde::{Deserialize, Serialize};

// Re-export the vendor-neutral types so consumers only need `sorng_ilo::types::*`
pub use sorng_bmc_common::types::*;
pub use sorng_bmc_common::power::PowerAction;
pub use sorng_bmc_common::redfish::RedfishSession;

/// Helper to build a ComponentHealth from a simple status string.
pub fn component_health(status: &str) -> ComponentHealth {
    ComponentHealth {
        health: Some(status.to_string()),
        state: Some("Enabled".to_string()),
    }
}

// ── iLO generations ─────────────────────────────────────────────────

/// iLO hardware generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IloGeneration {
    Ilo1,
    Ilo2,
    Ilo3,
    Ilo4,
    Ilo5,
    Ilo6,
    Ilo7,
    Unknown,
}

impl IloGeneration {
    /// Human-readable name.
    pub fn display_name(&self) -> &str {
        match self {
            Self::Ilo1 => "iLO 1",
            Self::Ilo2 => "iLO 2",
            Self::Ilo3 => "iLO 3",
            Self::Ilo4 => "iLO 4",
            Self::Ilo5 => "iLO 5",
            Self::Ilo6 => "iLO 6",
            Self::Ilo7 => "iLO 7",
            Self::Unknown => "iLO (unknown)",
        }
    }

    /// Whether Redfish is supported on this generation.
    pub fn supports_redfish(&self) -> bool {
        matches!(self, Self::Ilo4 | Self::Ilo5 | Self::Ilo6 | Self::Ilo7)
    }

    /// Whether RIBCL XML is supported on this generation.
    pub fn supports_ribcl(&self) -> bool {
        matches!(self, Self::Ilo1 | Self::Ilo2 | Self::Ilo3 | Self::Ilo4 | Self::Ilo5)
    }

    /// Whether HTML5 remote console is available.
    pub fn supports_html5_console(&self) -> bool {
        matches!(self, Self::Ilo4 | Self::Ilo5 | Self::Ilo6 | Self::Ilo7)
    }

    /// Whether Java IRC remote console is available.
    pub fn supports_java_console(&self) -> bool {
        matches!(self, Self::Ilo2 | Self::Ilo3 | Self::Ilo4)
    }

    /// Server family name.
    pub fn server_family(&self) -> &str {
        match self {
            Self::Ilo1 => "ProLiant G3/G4",
            Self::Ilo2 => "ProLiant G5/G6",
            Self::Ilo3 => "ProLiant G7",
            Self::Ilo4 => "ProLiant Gen8/Gen9",
            Self::Ilo5 => "ProLiant Gen10/Gen10+",
            Self::Ilo6 => "ProLiant Gen11",
            Self::Ilo7 => "ProLiant Gen12",
            Self::Unknown => "Unknown",
        }
    }
}

impl std::fmt::Display for IloGeneration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

// ── Protocol selection ──────────────────────────────────────────────

/// Which protocol to use for iLO communication.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum IloProtocol {
    /// Redfish REST/JSON (iLO 4 FW 2.30+, iLO 5/6/7)
    Redfish,
    /// RIBCL XML-over-HTTPS (iLO 1/2/3/4/5 legacy)
    Ribcl,
    /// IPMI over LAN (all generations, basic ops only)
    Ipmi,
}

/// Authentication method.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IloAuthMethod {
    /// Username + password (Basic Auth or Redfish session)
    Basic,
    /// Redfish X-Auth-Token session auth
    Session,
}

/// Connection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IloConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub auth_method: IloAuthMethod,
    /// Accept self-signed / untrusted TLS certificates
    pub insecure: bool,
    /// Force a specific protocol (auto-detect if None)
    pub protocol: Option<IloProtocol>,
    /// Request timeout in seconds
    pub timeout_secs: u64,
    /// IPMI port (default 623)
    pub ipmi_port: u16,
}

/// Sanitised config returned to the frontend (no secrets).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IloConfigSafe {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub insecure: bool,
    pub protocol: IloProtocol,
    pub generation: IloGeneration,
    pub firmware_version: Option<String>,
    pub server_model: Option<String>,
}

// ── iLO controller info ─────────────────────────────────────────────

/// iLO controller-specific information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IloInfo {
    pub generation: IloGeneration,
    pub firmware_version: String,
    pub firmware_date: Option<String>,
    pub ip_address: String,
    pub mac_address: Option<String>,
    pub hostname: Option<String>,
    pub serial_number: Option<String>,
    pub license_type: String,
    pub fqdn: Option<String>,
    pub uuid: Option<String>,
}

// ── RIBCL types ─────────────────────────────────────────────────────

/// Parsed RIBCL response wrapper.
#[derive(Debug, Clone)]
pub struct RibclResponse {
    pub status: u32,
    pub message: String,
    pub xml_body: String,
}

// ── License ─────────────────────────────────────────────────────────

/// iLO license tier.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum IloLicenseTier {
    /// iLO Standard (included, limited features)
    Standard,
    /// iLO Essentials (basic remote management)
    Essentials,
    /// iLO Advanced (full features: remote console, VM, etc.)
    Advanced,
    /// iLO Advanced Premium Security (iLO 5+)
    AdvancedPremium,
    /// iLO Scale-Out (Moonshot / dense compute)
    ScaleOut,
    /// Unknown / custom
    Other(String),
}

/// License information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IloLicense {
    pub tier: IloLicenseTier,
    pub key: Option<String>,
    pub license_string: Option<String>,
    pub expiration: Option<String>,
    pub install_date: Option<String>,
}

// ── Federation ──────────────────────────────────────────────────────

/// iLO Federation group.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IloFederationGroup {
    pub name: String,
    pub key: Option<String>,
    pub privileges: Vec<String>,
}

/// iLO Federation peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IloFederationPeer {
    pub name: String,
    pub ip_address: String,
    pub group: String,
    pub ilo_generation: Option<String>,
    pub firmware_version: Option<String>,
    pub server_name: Option<String>,
}

// ── Security ────────────────────────────────────────────────────────

/// iLO security dashboard status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IloSecurityStatus {
    pub overall_status: String,
    pub risk_count: u32,
    pub risks: Vec<SecurityRiskItem>,
    pub tls_version: Option<String>,
    pub ipmi_over_lan_enabled: Option<bool>,
    pub ssh_enabled: Option<bool>,
    pub default_password: Option<bool>,
}

/// Security risk item from the iLO security dashboard.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityRiskItem {
    pub name: String,
    pub severity: String,
    pub description: Option<String>,
    pub recommended_action: Option<String>,
}

// ── Virtual Console ─────────────────────────────────────────────────

/// Console type supported by this iLO generation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConsoleType {
    /// HTML5 Integrated Remote Console (iLO 4 FW 2.30+, iLO 5/6/7)
    Html5,
    /// Java IRC applet (iLO 2/3/4)
    JavaIrc,
    /// .NET IRC plugin (iLO 4)
    DotNetIrc,
    /// Java applet (iLO 1 — very old)
    JavaApplet,
}

/// Remote console information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IloConsoleInfo {
    pub available_types: Vec<ConsoleType>,
    pub html5_url: Option<String>,
    pub java_url: Option<String>,
    pub hotkeys: Vec<HotkeyConfig>,
}

/// Remote console hotkey configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyConfig {
    pub name: String,
    pub key_sequence: String,
}

// ── Dashboard ───────────────────────────────────────────────────────

/// Aggregated iLO dashboard data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IloDashboard {
    pub system_info: Option<BmcSystemInfo>,
    pub ilo_info: Option<IloInfo>,
    pub health: Option<BmcHealthRollup>,
    pub power_state: Option<String>,
    pub power_consumption_watts: Option<f64>,
    pub thermal_summary: Option<ThermalSummary>,
}

/// Thermal summary (aggregated).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalSummary {
    pub ambient_temp_celsius: Option<f64>,
    pub cpu_temp_max_celsius: Option<f64>,
    pub fan_speed_min_percent: Option<f64>,
    pub fan_speed_max_percent: Option<f64>,
    pub thermal_alerts: u32,
}

// ── BIOS / Boot ─────────────────────────────────────────────────────

/// BIOS/UEFI attribute.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiosAttribute {
    pub name: String,
    pub value: serde_json::Value,
    pub read_only: bool,
}

/// Boot order configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootConfig {
    pub boot_order: Vec<BootSource>,
    pub boot_override_target: Option<String>,
    pub boot_override_enabled: Option<String>,
    pub uefi_boot_mode: Option<String>,
}

/// Boot source entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootSource {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub position: u32,
}

// ── Certificate ─────────────────────────────────────────────────────

/// iLO SSL/TLS certificate.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IloCertificate {
    pub issuer: String,
    pub subject: String,
    pub valid_from: String,
    pub valid_to: String,
    pub serial_number: Option<String>,
    pub fingerprint: Option<String>,
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
}

// ── Active Directory / LDAP ─────────────────────────────────────────

/// LDAP/AD directory configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryConfig {
    pub enabled: bool,
    pub server_address: String,
    pub server_port: u16,
    pub base_dn: String,
    pub bind_dn: Option<String>,
    pub use_ssl: bool,
    pub directory_type: String,
    pub default_role: Option<String>,
}

// ── Smart Array / Storage ───────────────────────────────────────────

/// Smart Array controller details (extends BmcStorageController).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartArrayController {
    pub id: String,
    pub name: String,
    pub model: String,
    pub serial_number: Option<String>,
    pub firmware_version: Option<String>,
    pub status: ComponentHealth,
    pub location: Option<String>,
    pub cache_size_mib: Option<u64>,
    pub cache_status: Option<String>,
    pub encryption_enabled: bool,
    pub logical_drive_count: u32,
    pub physical_drive_count: u32,
}

/// Smart Array logical drive.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartArrayLogicalDrive {
    pub id: String,
    pub name: String,
    pub raid_level: String,
    pub capacity_gib: f64,
    pub status: ComponentHealth,
    pub stripe_size_kb: Option<u32>,
    pub accelerator: Option<String>,
    pub data_drives: Vec<String>,
    pub spare_drives: Vec<String>,
}

/// Smart Array physical drive.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartArrayPhysicalDrive {
    pub id: String,
    pub name: String,
    pub model: String,
    pub serial_number: Option<String>,
    pub firmware_version: Option<String>,
    pub capacity_gib: f64,
    pub media_type: String,
    pub interface_type: String,
    pub status: ComponentHealth,
    pub location: String,
    pub rotational_speed_rpm: Option<u32>,
    pub current_temperature_celsius: Option<f64>,
    pub maximum_temperature_celsius: Option<f64>,
    pub power_on_hours: Option<u64>,
    pub carrier_type: Option<String>,
}

// ── IML (Integrated Management Log) ─────────────────────────────────

/// IML entry (HP-specific log, separate from SEL).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImlEntry {
    pub id: String,
    pub created: String,
    pub severity: String,
    pub message: String,
    pub class: Option<String>,
    pub class_description: Option<String>,
    pub source: Option<String>,
    pub repaired: bool,
    pub count: u32,
    pub initial_update: Option<String>,
    pub last_update: Option<String>,
}

/// iLO Event Log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IloEventLogEntry {
    pub id: String,
    pub created: String,
    pub severity: String,
    pub message: String,
    pub entry_type: Option<String>,
    pub source: Option<String>,
}
