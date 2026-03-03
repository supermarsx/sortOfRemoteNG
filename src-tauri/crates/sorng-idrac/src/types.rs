//! Shared data structures for iDRAC management.
//!
//! Covers Redfish, WS-Management, and IPMI-sourced entities.

use serde::{Deserialize, Serialize};

// ── Protocol / connection ───────────────────────────────────────────

/// Which protocol generations the iDRAC supports.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum IdracProtocol {
    /// Redfish REST/JSON (iDRAC 7 FW 2.x+, iDRAC 8, iDRAC 9)
    Redfish,
    /// WS-Management SOAP/XML (iDRAC 6, iDRAC 7 early FW)
    Wsman,
    /// IPMI over LAN (very old BMC / iDRAC 6 basic)
    Ipmi,
}

/// Authentication method.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum IdracAuthMethod {
    /// Username + password (Basic Auth or Redfish session)
    Basic { username: String, password: String },
    /// Redfish X-Auth-Token session auth (auto-created from Basic login)
    Session { username: String, password: String },
}

/// Connection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracConfig {
    pub host: String,
    pub port: u16,
    pub auth: IdracAuthMethod,
    /// Accept self-signed / untrusted TLS certificates
    pub insecure: bool,
    /// Force a specific protocol (auto-detect if None)
    pub force_protocol: Option<IdracProtocol>,
    /// Request timeout in seconds
    pub timeout_secs: u64,
}

/// Sanitised config returned to the frontend (no secrets).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracConfigSafe {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub insecure: bool,
    pub protocol: IdracProtocol,
    pub idrac_version: Option<String>,
}

/// Redfish session ticket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracSession {
    pub token: String,
    pub session_uri: String,
    pub username: String,
    pub connected_at: String,
}

// ── Redfish OData envelope ──────────────────────────────────────────

/// Standard Redfish response (single resource or collection).
#[derive(Debug, Deserialize)]
pub struct RedfishResponse<T> {
    #[serde(flatten)]
    pub data: T,
}

/// Redfish collection wrapper.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct RedfishCollection<T> {
    #[serde(rename = "Members@odata.count")]
    pub count: Option<u64>,
    #[serde(rename = "Members")]
    pub members: Vec<T>,
}

/// Redfish member link (used in collection).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OdataLink {
    #[serde(rename = "@odata.id")]
    pub odata_id: String,
}

// ── System ──────────────────────────────────────────────────────────

/// Top-level system overview from Redfish `/redfish/v1/Systems/System.Embedded.1`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub id: String,
    pub manufacturer: String,
    pub model: String,
    pub serial_number: String,
    pub service_tag: String,
    pub sku: Option<String>,
    pub bios_version: String,
    pub hostname: Option<String>,
    pub power_state: String,
    pub indicator_led: Option<String>,
    pub asset_tag: Option<String>,
    pub memory_gib: f64,
    pub processor_count: u32,
    pub processor_model: String,
}

/// iDRAC controller information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracInfo {
    pub firmware_version: String,
    pub idrac_type: String,
    pub ip_address: String,
    pub mac_address: Option<String>,
    pub model: Option<String>,
    pub generation: Option<String>,
    pub license_type: Option<String>,
}

// ── Power ───────────────────────────────────────────────────────────

/// Power action to send.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PowerAction {
    On,
    ForceOff,
    GracefulShutdown,
    GracefulRestart,
    ForceRestart,
    Nmi,
    PushPowerButton,
    PowerCycle,
}

impl PowerAction {
    pub fn to_redfish(&self) -> &str {
        match self {
            Self::On => "On",
            Self::ForceOff => "ForceOff",
            Self::GracefulShutdown => "GracefulShutdown",
            Self::GracefulRestart => "GracefulRestart",
            Self::ForceRestart => "ForceRestart",
            Self::Nmi => "Nmi",
            Self::PushPowerButton => "PushPowerButton",
            Self::PowerCycle => "PowerCycle",
        }
    }

    /// Legacy WSMAN RequestedState enum value.
    pub fn to_wsman_state(&self) -> u32 {
        match self {
            Self::On => 2,
            Self::ForceOff => 8,
            Self::GracefulShutdown => 12,
            Self::GracefulRestart => 10,
            Self::ForceRestart => 11,
            Self::Nmi => 11,
            Self::PushPowerButton => 5,
            Self::PowerCycle => 5,
        }
    }
}

/// Power supply unit info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerSupply {
    pub id: String,
    pub name: String,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub firmware_version: Option<String>,
    pub status: ComponentHealth,
    pub capacity_watts: Option<f64>,
    pub input_voltage: Option<f64>,
    pub output_watts: Option<f64>,
    pub line_input_voltage_type: Option<String>,
    pub power_supply_type: Option<String>,
    pub manufacturer: Option<String>,
    pub part_number: Option<String>,
    pub spare_part_number: Option<String>,
    pub efficiency_rating: Option<f64>,
}

/// Server power consumption metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerMetrics {
    pub current_watts: Option<f64>,
    pub min_watts: Option<f64>,
    pub max_watts: Option<f64>,
    pub average_watts: Option<f64>,
    pub power_cap_watts: Option<f64>,
    pub power_cap_enabled: bool,
}

// ── Thermal ─────────────────────────────────────────────────────────

/// Temperature sensor.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemperatureSensor {
    pub id: String,
    pub name: String,
    pub reading_celsius: Option<f64>,
    pub upper_threshold_critical: Option<f64>,
    pub upper_threshold_fatal: Option<f64>,
    pub lower_threshold_critical: Option<f64>,
    pub status: ComponentHealth,
    pub physical_context: Option<String>,
}

/// Fan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fan {
    pub id: String,
    pub name: String,
    pub reading_rpm: Option<u64>,
    pub reading_percent: Option<f64>,
    pub lower_threshold_critical: Option<u64>,
    pub lower_threshold_fatal: Option<u64>,
    pub status: ComponentHealth,
    pub physical_context: Option<String>,
    pub fan_name: Option<String>,
}

/// Combined thermal data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalData {
    pub temperatures: Vec<TemperatureSensor>,
    pub fans: Vec<Fan>,
}

// ── Hardware ────────────────────────────────────────────────────────

/// Processor (CPU).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Processor {
    pub id: String,
    pub socket: String,
    pub manufacturer: String,
    pub model: String,
    pub total_cores: u32,
    pub total_threads: u32,
    pub max_speed_mhz: Option<u64>,
    pub current_speed_mhz: Option<u64>,
    pub status: ComponentHealth,
    pub instruction_set: Option<String>,
    pub microcode: Option<String>,
    pub cache_mib: Option<f64>,
}

/// Memory DIMM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDimm {
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    pub serial_number: Option<String>,
    pub part_number: Option<String>,
    pub capacity_mib: u64,
    pub speed_mhz: Option<u64>,
    pub memory_type: String,
    pub rank_count: Option<u32>,
    pub device_locator: String,
    pub bank_locator: Option<String>,
    pub status: ComponentHealth,
    pub error_correction: Option<String>,
    pub data_width_bits: Option<u32>,
    pub bus_width_bits: Option<u32>,
}

/// PCIe device info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PcieDevice {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub device_class: Option<String>,
    pub slot_type: Option<String>,
    pub bus_number: Option<u32>,
    pub function_number: Option<u32>,
    pub status: ComponentHealth,
    pub firmware_version: Option<String>,
}

// ── Storage ─────────────────────────────────────────────────────────

/// RAID controller.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageController {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub firmware_version: Option<String>,
    pub status: ComponentHealth,
    pub speed_gbps: Option<f64>,
    pub supported_raid_levels: Vec<String>,
    pub cache_size_mib: Option<u64>,
    pub supported_device_protocols: Vec<String>,
}

/// Virtual disk (RAID array).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualDisk {
    pub id: String,
    pub name: String,
    pub raid_level: String,
    pub capacity_bytes: u64,
    pub status: ComponentHealth,
    pub media_type: Option<String>,
    pub optimum_io_size_bytes: Option<u64>,
    pub stripe_size_bytes: Option<u64>,
    pub read_cache_policy: Option<String>,
    pub write_cache_policy: Option<String>,
    pub disk_cache_policy: Option<String>,
    pub encrypted: Option<bool>,
    pub physical_disk_ids: Vec<String>,
}

/// Physical disk (SSD/HDD).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalDisk {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub firmware_version: Option<String>,
    pub capacity_bytes: u64,
    pub media_type: String,
    pub protocol: Option<String>,
    pub rotation_speed_rpm: Option<u64>,
    pub status: ComponentHealth,
    pub capable_speed_gbps: Option<f64>,
    pub negotiated_speed_gbps: Option<f64>,
    pub failure_predicted: Option<bool>,
    pub predicted_media_life_left_percent: Option<f64>,
    pub slot: Option<String>,
    pub enclosure_id: Option<String>,
    pub hotspare_type: Option<String>,
}

/// Storage enclosure (backplane).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEnclosure {
    pub id: String,
    pub name: String,
    pub connector: Option<String>,
    pub slot_count: Option<u32>,
    pub wired_order: Option<String>,
    pub status: ComponentHealth,
}

/// Parameters for creating a virtual disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVirtualDiskParams {
    pub controller_id: String,
    pub name: Option<String>,
    pub raid_level: String,
    pub physical_disk_ids: Vec<String>,
    pub size_bytes: Option<u64>,
    pub stripe_size_bytes: Option<u64>,
    pub read_cache_policy: Option<String>,
    pub write_cache_policy: Option<String>,
}

// ── Network ─────────────────────────────────────────────────────────

/// Network adapter (NIC card).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAdapter {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub part_number: Option<String>,
    pub serial_number: Option<String>,
    pub status: ComponentHealth,
    pub port_count: u32,
    pub ports: Vec<NetworkPort>,
}

/// Network port.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPort {
    pub id: String,
    pub name: String,
    pub link_status: Option<String>,
    pub current_speed_gbps: Option<f64>,
    pub mac_address: Option<String>,
    pub active_link_technology: Option<String>,
    pub auto_negotiate: Option<bool>,
    pub flow_control: Option<String>,
    pub mtu_size: Option<u32>,
}

/// iDRAC network configuration (management interface).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracNetworkConfig {
    pub ipv4_address: Option<String>,
    pub ipv4_subnet: Option<String>,
    pub ipv4_gateway: Option<String>,
    pub ipv4_source: Option<String>,
    pub ipv6_address: Option<String>,
    pub ipv6_prefix_length: Option<u32>,
    pub ipv6_gateway: Option<String>,
    pub ipv6_source: Option<String>,
    pub mac_address: Option<String>,
    pub dns_servers: Vec<String>,
    pub hostname: Option<String>,
    pub domain_name: Option<String>,
    pub vlan_enable: Option<bool>,
    pub vlan_id: Option<u32>,
    pub nic_selection: Option<String>,
    pub speed_duplex: Option<String>,
    pub auto_negotiation: Option<bool>,
}

// ── Firmware ────────────────────────────────────────────────────────

/// Firmware inventory item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareInventory {
    pub id: String,
    pub name: String,
    pub version: String,
    pub updateable: bool,
    pub status: ComponentHealth,
    pub component_id: Option<String>,
    pub install_date: Option<String>,
    pub release_date: Option<String>,
    pub size_bytes: Option<u64>,
}

/// Firmware update job params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareUpdateParams {
    /// URI of the DUP image (HTTP, CIFS, NFS, TFTP)
    pub image_uri: String,
    /// Install target (immediate, at next reboot, on reset)
    pub apply_time: Option<String>,
    /// Force even if same version
    pub force: bool,
}

// ── Lifecycle Controller ────────────────────────────────────────────

/// Lifecycle Controller job.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleJob {
    pub id: String,
    pub name: Option<String>,
    pub message: Option<String>,
    pub job_type: Option<String>,
    pub job_state: String,
    pub percent_complete: Option<u32>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub target_settings_uri: Option<String>,
}

/// Server Configuration Profile (SCP) export params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpExportParams {
    pub export_format: Option<String>,
    pub export_use: Option<String>,
    pub include_in_export: Option<String>,
    pub share_type: Option<String>,
    pub ip_address: Option<String>,
    pub share_name: Option<String>,
    pub file_name: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
}

/// Server Configuration Profile (SCP) import params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpImportParams {
    pub import_buffer: Option<String>,
    pub share_type: Option<String>,
    pub ip_address: Option<String>,
    pub share_name: Option<String>,
    pub file_name: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub shutdown_type: Option<String>,
    pub host_poweroff: Option<bool>,
}

// ── Virtual Media ───────────────────────────────────────────────────

/// Connected virtual media status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualMediaStatus {
    pub id: String,
    pub name: String,
    pub media_types: Vec<String>,
    pub inserted: bool,
    pub image: Option<String>,
    pub write_protected: bool,
    pub connected_via: Option<String>,
}

/// Virtual media mount params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualMediaMountParams {
    pub image_uri: String,
    pub media_type: Option<String>,
    pub inserted: Option<bool>,
    pub write_protected: Option<bool>,
    pub username: Option<String>,
    pub password: Option<String>,
}

// ── Virtual Console / KVM ───────────────────────────────────────────

/// Console launch info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleInfo {
    pub console_type: String,
    pub url: String,
    pub enabled: bool,
    pub max_sessions: Option<u32>,
    pub ssl_encryption_bits: Option<u32>,
}

// ── Event Log ───────────────────────────────────────────────────────

/// System Event Log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelEntry {
    pub id: String,
    pub created: Option<String>,
    pub message: String,
    pub severity: String,
    pub entry_type: Option<String>,
    pub message_id: Option<String>,
    pub sensor_type: Option<String>,
    pub component: Option<String>,
}

/// Lifecycle Controller log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LcLogEntry {
    pub id: String,
    pub created: Option<String>,
    pub message: String,
    pub severity: String,
    pub message_id: Option<String>,
    pub category: Option<String>,
    pub comment: Option<String>,
    pub sequence: Option<u64>,
}

// ── Users ───────────────────────────────────────────────────────────

/// iDRAC local user account.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracUser {
    pub id: String,
    pub name: String,
    pub role_id: String,
    pub enabled: bool,
    pub locked: bool,
    pub description: Option<String>,
    pub ipmi_privilege: Option<String>,
    pub snmp_v3_auth: Option<String>,
    pub snmp_v3_privacy: Option<String>,
}

/// Create / update user params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracUserParams {
    pub username: String,
    pub password: Option<String>,
    pub role_id: Option<String>,
    pub enabled: Option<bool>,
    pub description: Option<String>,
}

/// LDAP / Active Directory config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapConfig {
    pub enabled: bool,
    pub server_address: Option<String>,
    pub port: Option<u16>,
    pub base_dn: Option<String>,
    pub bind_dn: Option<String>,
    pub search_filter: Option<String>,
    pub use_ssl: Option<bool>,
    pub certificate_validation: Option<bool>,
    pub group_attribute: Option<String>,
}

/// Active Directory config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveDirectoryConfig {
    pub enabled: bool,
    pub domain_name: Option<String>,
    pub domain_controller_addresses: Vec<String>,
    pub global_catalog_addresses: Vec<String>,
    pub schema_type: Option<String>,
    pub certificate_validation: Option<bool>,
}

// ── BIOS ────────────────────────────────────────────────────────────

/// BIOS attribute (current value + allowed values).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiosAttribute {
    pub name: String,
    pub value: serde_json::Value,
    pub attribute_type: Option<String>,
    pub display_name: Option<String>,
    pub read_only: bool,
    pub allowed_values: Option<Vec<serde_json::Value>>,
    pub lower_bound: Option<i64>,
    pub upper_bound: Option<i64>,
}

/// Boot Source entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootSource {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub index: u32,
    pub boot_option_reference: Option<String>,
    pub uefi_device_path: Option<String>,
    pub display_name: Option<String>,
}

/// Boot order configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootConfig {
    pub boot_mode: String,
    pub boot_order: Vec<String>,
    pub boot_source_override_target: Option<String>,
    pub boot_source_override_enabled: Option<String>,
    pub boot_source_override_mode: Option<String>,
    pub uefi_target_boot_source_override: Option<String>,
}

// ── Certificates ────────────────────────────────────────────────────

/// SSL certificate installed on iDRAC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracCertificate {
    pub id: String,
    pub subject: String,
    pub issuer: String,
    pub valid_from: String,
    pub valid_to: String,
    pub serial_number: String,
    pub thumbprint: Option<String>,
    pub key_usage: Option<Vec<String>>,
    pub signature_algorithm: Option<String>,
}

/// Generate CSR params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsrParams {
    pub common_name: String,
    pub organization: Option<String>,
    pub organizational_unit: Option<String>,
    pub locality: Option<String>,
    pub state: Option<String>,
    pub country: Option<String>,
    pub email: Option<String>,
    pub subject_alternative_names: Option<Vec<String>>,
}

// ── Health ───────────────────────────────────────────────────────────

/// Component health status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentHealth {
    pub health: Option<String>,
    pub health_rollup: Option<String>,
    pub state: Option<String>,
}

/// Overall server health rollup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerHealthRollup {
    pub overall_health: String,
    pub system: ComponentHealth,
    pub processors: ComponentHealth,
    pub memory: ComponentHealth,
    pub storage: ComponentHealth,
    pub fans: ComponentHealth,
    pub temperatures: ComponentHealth,
    pub power_supplies: ComponentHealth,
    pub network: ComponentHealth,
    pub idrac: ComponentHealth,
    pub voltage: ComponentHealth,
    pub intrusion: ComponentHealth,
    pub batteries: ComponentHealth,
}

// ── Telemetry / Metrics ─────────────────────────────────────────────

/// Time-series data point for telemetry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryDataPoint {
    pub timestamp: String,
    pub value: f64,
    pub label: Option<String>,
}

/// Telemetry report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryReport {
    pub metric_id: String,
    pub name: String,
    pub metric_type: String,
    pub data_points: Vec<TelemetryDataPoint>,
}

/// Power telemetry summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerTelemetry {
    pub current_watts: f64,
    pub peak_watts: f64,
    pub min_watts: f64,
    pub average_watts: f64,
    pub time_window_minutes: u32,
    pub history: Vec<TelemetryDataPoint>,
}

/// Thermal telemetry summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalTelemetry {
    pub inlet_temp_celsius: Option<f64>,
    pub exhaust_temp_celsius: Option<f64>,
    pub peak_inlet_celsius: Option<f64>,
    pub average_inlet_celsius: Option<f64>,
    pub history: Vec<TelemetryDataPoint>,
}

// ── RACADM ──────────────────────────────────────────────────────────

/// RACADM command result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RacadmResult {
    pub command: String,
    pub output: String,
    pub return_code: i32,
    pub success: bool,
}

// ── IPMI types ──────────────────────────────────────────────────────

/// IPMI sensor reading.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpmiSensor {
    pub name: String,
    pub value: Option<f64>,
    pub unit: Option<String>,
    pub status: String,
    pub sensor_type: String,
    pub lower_critical: Option<f64>,
    pub upper_critical: Option<f64>,
}

/// IPMI FRU (Field Replaceable Unit) data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpmiFru {
    pub device_id: u8,
    pub product_manufacturer: Option<String>,
    pub product_name: Option<String>,
    pub product_serial: Option<String>,
    pub product_part_number: Option<String>,
    pub board_manufacturer: Option<String>,
    pub board_product_name: Option<String>,
    pub board_serial: Option<String>,
    pub chassis_type: Option<String>,
    pub chassis_serial: Option<String>,
}

/// IPMI chassis status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpmiChassisStatus {
    pub power_on: bool,
    pub power_overload: bool,
    pub power_interlock: bool,
    pub power_fault: bool,
    pub power_control_fault: bool,
    pub power_restore_policy: String,
    pub last_power_event: String,
    pub chassis_intrusion: bool,
    pub front_panel_lockout: bool,
    pub drive_fault: bool,
    pub cooling_fault: bool,
}

// ── WS-Management types ─────────────────────────────────────────────

/// WS-Management enumeration result (legacy).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsmanInstance {
    pub class_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

/// Legacy system view (DCIM_SystemView from WSMAN).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsmanSystemView {
    pub fqdd: String,
    pub model: String,
    pub service_tag: String,
    pub bios_version: String,
    pub system_generation: String,
    pub hostname: Option<String>,
    pub os_name: Option<String>,
    pub idrac_firmware_version: String,
    pub lifecycle_controller_version: String,
    pub power_state: String,
    pub cpld_version: Option<String>,
}

// ── Dashboard / summary ─────────────────────────────────────────────

/// One-shot dashboard data for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracDashboard {
    pub system: SystemInfo,
    pub idrac: IdracInfo,
    pub health: ServerHealthRollup,
    pub power: PowerMetrics,
    pub thermal_summary: Option<ThermalSummary>,
    pub firmware_count: u32,
    pub virtual_disk_count: u32,
    pub physical_disk_count: u32,
    pub memory_dimm_count: u32,
    pub nic_count: u32,
    pub recent_events: Vec<SelEntry>,
}

/// Quick thermal summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalSummary {
    pub inlet_temp_celsius: Option<f64>,
    pub exhaust_temp_celsius: Option<f64>,
    pub fan_count: u32,
    pub fans_ok: u32,
    pub sensor_count: u32,
    pub sensors_ok: u32,
}
