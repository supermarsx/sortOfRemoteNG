//! Shared data structures for iDRAC management.
//!
//! Covers Redfish, WS-Management, and IPMI-sourced entities.

use serde::{Deserialize, Serialize};

// ── Protocol / connection ───────────────────────────────────────────

/// Which protocol generations the iDRAC supports.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum IdracProtocol {
    /// Redfish REST/JSON (iDRAC 7 FW 2.x+, iDRAC 8, iDRAC 9)
    #[default]
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

impl Default for IdracAuthMethod {
    fn default() -> Self {
        IdracAuthMethod::Basic {
            username: String::new(),
            password: String::new(),
        }
    }
}

/// Connection configuration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OdataLink {
    #[serde(rename = "@odata.id")]
    pub odata_id: String,
}

// ── System ──────────────────────────────────────────────────────────

/// Top-level system overview from Redfish `/redfish/v1/Systems/System.Embedded.1`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PowerAction {
    #[default]
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemperatureSensor {
    pub name: String,
    pub reading_celsius: Option<f64>,
    pub upper_threshold_non_critical: Option<f64>,
    pub upper_threshold_critical: Option<f64>,
    pub upper_threshold_fatal: Option<f64>,
    pub lower_threshold_non_critical: Option<f64>,
    pub lower_threshold_critical: Option<f64>,
    pub status: ComponentHealth,
    pub physical_context: Option<String>,
    pub sensor_number: Option<u32>,
    pub member_id: Option<String>,
}

/// Fan.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fan {
    pub name: String,
    pub reading_rpm: Option<f64>,
    pub reading_percent: Option<f64>,
    pub lower_threshold_non_critical: Option<f64>,
    pub lower_threshold_critical: Option<f64>,
    pub upper_threshold_non_critical: Option<f64>,
    pub upper_threshold_critical: Option<f64>,
    pub status: ComponentHealth,
    pub physical_context: Option<String>,
    pub member_id: Option<String>,
    pub hot_pluggable: Option<bool>,
}

/// Combined thermal data.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalData {
    pub temperatures: Vec<TemperatureSensor>,
    pub fans: Vec<Fan>,
}

// ── Hardware ────────────────────────────────────────────────────────

/// Processor (CPU).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Processor {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub socket: Option<String>,
    pub total_cores: Option<u32>,
    pub total_threads: Option<u32>,
    pub max_speed_mhz: Option<u32>,
    pub current_speed_mhz: Option<u64>,
    pub status: ComponentHealth,
    pub instruction_set: Option<String>,
    pub processor_type: Option<String>,
    pub processor_architecture: Option<String>,
    pub microcode: Option<String>,
}

/// Memory DIMM.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDimm {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub serial_number: Option<String>,
    pub part_number: Option<String>,
    pub capacity_mb: Option<u32>,
    pub speed_mhz: Option<u32>,
    pub memory_type: Option<String>,
    pub rank_count: Option<u32>,
    pub device_locator: Option<String>,
    pub bank_locator: Option<String>,
    pub status: ComponentHealth,
    pub error_correction: Option<String>,
    pub data_width_bits: Option<u32>,
    pub bus_width_bits: Option<u32>,
}

/// PCIe device info.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PcieDevice {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub device_type: Option<String>,
    pub serial_number: Option<String>,
    pub firmware_version: Option<String>,
    pub pcie_generation: Option<String>,
    pub lane_width: Option<u32>,
    pub slot: Option<String>,
    pub bus_number: Option<u32>,
    pub device_number: Option<u32>,
    pub function_number: Option<u32>,
    pub status: ComponentHealth,
}

// ── Storage ─────────────────────────────────────────────────────────

/// RAID controller.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageController {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub firmware_version: Option<String>,
    pub serial_number: Option<String>,
    pub status: ComponentHealth,
    pub speed_gbps: Option<f64>,
    pub supported_device_protocols: Vec<String>,
    pub supported_raid_types: Vec<String>,
    pub cache_size_mb: Option<u32>,
    pub driver_version: Option<String>,
}

/// Virtual disk (RAID array).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualDisk {
    pub id: String,
    pub name: String,
    pub raid_level: Option<String>,
    pub capacity_bytes: Option<u64>,
    pub status: ComponentHealth,
    pub stripe_size_bytes: Option<u64>,
    pub read_policy: Option<String>,
    pub write_policy: Option<String>,
    pub disk_cache_policy: Option<String>,
    pub controller_id: String,
    pub physical_disk_ids: Vec<String>,
    pub encrypted: Option<bool>,
}

/// Physical disk (SSD/HDD).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalDisk {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub firmware_version: Option<String>,
    pub capacity_bytes: Option<u64>,
    pub media_type: Option<String>,
    pub protocol: Option<String>,
    pub rotation_speed_rpm: Option<u32>,
    pub status: ComponentHealth,
    pub capable_speed_gbps: Option<f64>,
    pub negotiated_speed_gbps: Option<f64>,
    pub failure_predicted: Option<bool>,
    pub predicted_media_life_left_percent: Option<f64>,
    pub block_size_bytes: Option<u32>,
    pub hotspare_type: Option<String>,
    pub encryption_ability: Option<String>,
    pub controller_id: String,
    pub slot: Option<u32>,
}

/// Storage enclosure (backplane).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEnclosure {
    pub id: String,
    pub name: String,
    pub service_tag: Option<String>,
    pub asset_tag: Option<String>,
    pub connector: Option<u32>,
    pub wired_order: Option<u32>,
    pub slot_count: Option<u32>,
    pub firmware_version: Option<String>,
    pub status: ComponentHealth,
}

/// Parameters for creating a virtual disk.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVirtualDiskParams {
    pub controller_id: String,
    pub name: Option<String>,
    pub raid_level: String,
    pub physical_disk_ids: Vec<String>,
    pub size_bytes: Option<u64>,
    pub capacity_bytes: Option<u64>,
    pub stripe_size_bytes: Option<u64>,
    pub read_cache_policy: Option<String>,
    pub write_cache_policy: Option<String>,
}

// ── Network ─────────────────────────────────────────────────────────

/// Network adapter (NIC card).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAdapter {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub part_number: Option<String>,
    pub serial_number: Option<String>,
    pub firmware_version: Option<String>,
    pub status: ComponentHealth,
    pub port_count: Option<u32>,
}

/// Network port.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPort {
    pub id: String,
    pub name: String,
    pub mac_address: Option<String>,
    pub permanent_mac_address: Option<String>,
    pub link_status: Option<String>,
    pub speed_mbps: Option<u32>,
    pub auto_neg: Option<bool>,
    pub full_duplex: Option<bool>,
    pub mtu_size: Option<u32>,
    pub ipv4_addresses: Vec<String>,
    pub ipv6_addresses: Vec<String>,
    pub vlan_id: Option<u32>,
    pub vlan_enabled: Option<bool>,
    pub status: ComponentHealth,
}

/// iDRAC network configuration (management interface).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracNetworkConfig {
    pub ipv4_address: Option<String>,
    pub ipv4_subnet: Option<String>,
    pub ipv4_gateway: Option<String>,
    pub ipv4_source: Option<String>,
    pub ipv4_dhcp_enabled: Option<bool>,
    pub ipv6_address: Option<String>,
    pub ipv6_prefix_length: Option<u32>,
    pub ipv6_gateway: Option<String>,
    pub ipv6_source: Option<String>,
    pub mac_address: Option<String>,
    pub dns_servers: Vec<String>,
    pub hostname: Option<String>,
    pub domain_name: Option<String>,
    pub vlan_enable: Option<bool>,
    pub vlan_enabled: Option<bool>,
    pub vlan_id: Option<u32>,
    pub nic_selection: Option<String>,
    pub speed_duplex: Option<String>,
    pub speed_mbps: Option<u32>,
    pub auto_negotiation: Option<bool>,
}

// ── Firmware ────────────────────────────────────────────────────────

/// Firmware inventory item.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareInventory {
    pub id: String,
    pub name: String,
    pub version: Option<String>,
    pub updateable: bool,
    pub status: ComponentHealth,
    pub component_id: Option<String>,
    pub device_id: Option<String>,
    pub vendor_id: Option<String>,
    pub sub_device_id: Option<String>,
    pub sub_vendor_id: Option<String>,
    pub install_date: Option<String>,
    pub release_date: Option<String>,
    pub size_bytes: Option<u64>,
}

/// Firmware update job params.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareUpdateParams {
    /// URI of the DUP image (HTTP, CIFS, NFS, TFTP)
    pub image_uri: String,
    /// Install target (immediate, at next reboot, on reset)
    pub apply_time: Option<String>,
    /// Force even if same version
    pub force: bool,
    /// Target component URIs
    pub targets: Option<Vec<String>>,
    /// Transfer protocol (HTTP, HTTPS, CIFS, NFS, etc.)
    pub transfer_protocol: Option<String>,
}

// ── Lifecycle Controller ────────────────────────────────────────────

/// Lifecycle Controller job.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleJob {
    pub id: String,
    pub name: String,
    pub message: Option<String>,
    pub message_id: Option<String>,
    pub job_type: Option<String>,
    pub job_state: Option<String>,
    pub percent_complete: Option<u32>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub target_uri: Option<String>,
}

/// Server Configuration Profile (SCP) export params.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpExportParams {
    pub target: Option<String>,
    pub format: Option<String>,
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScpImportParams {
    pub import_buffer: Option<String>,
    pub target: Option<String>,
    pub share_type: Option<String>,
    pub ip_address: Option<String>,
    pub share_name: Option<String>,
    pub file_name: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub shutdown_type: Option<String>,
    pub host_poweroff: Option<bool>,
    pub host_power_state: Option<String>,
}

// ── Virtual Media ───────────────────────────────────────────────────

/// Connected virtual media status.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualMediaStatus {
    pub id: String,
    pub name: String,
    pub media_types: Vec<String>,
    pub inserted: bool,
    pub image: Option<String>,
    pub image_name: Option<String>,
    pub connected: bool,
    pub write_protected: bool,
    pub connected_via: Option<String>,
    pub transfer_method: Option<String>,
    pub transfer_protocol_type: Option<String>,
}

/// Virtual media mount params.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualMediaMountParams {
    pub image_uri: String,
    pub media_id: Option<String>,
    pub media_type: Option<String>,
    pub inserted: Option<bool>,
    pub write_protected: Option<bool>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub transfer_protocol: Option<String>,
}

// ── Virtual Console / KVM ───────────────────────────────────────────

/// Console launch info.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleInfo {
    pub console_type: String,
    pub enabled: bool,
    pub max_concurrent_sessions: u32,
    pub html5_url: Option<String>,
    pub java_url: Option<String>,
    pub vnc_port: Option<u32>,
    pub connect_types_supported: Vec<String>,
    pub encryption_enabled: bool,
    pub local_server_video_enabled: bool,
}

// ── Event Log ───────────────────────────────────────────────────────

/// System Event Log entry.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelEntry {
    pub id: String,
    pub name: String,
    pub created: Option<String>,
    pub message: Option<String>,
    pub severity: Option<String>,
    pub entry_type: Option<String>,
    pub message_id: Option<String>,
    pub sensor_type: Option<String>,
    pub sensor_number: Option<u32>,
    pub component: Option<String>,
    pub message_args: Vec<String>,
}

/// Lifecycle Controller log entry.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LcLogEntry {
    pub id: String,
    pub name: String,
    pub created: Option<String>,
    pub message: Option<String>,
    pub severity: Option<String>,
    pub message_id: Option<String>,
    pub category: Option<String>,
    pub component: Option<String>,
    pub comment: Option<String>,
    pub sequence: Option<u64>,
    pub message_args: Vec<String>,
}

// ── Users ───────────────────────────────────────────────────────────

/// iDRAC local user account.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracUser {
    pub id: String,
    pub user_name: String,
    pub role_id: Option<String>,
    pub enabled: bool,
    pub locked: bool,
    pub description: Option<String>,
    pub privilege: Option<u32>,
    pub ipmi_lan_privilege: Option<String>,
    pub ipmi_serial_privilege: Option<String>,
    pub ipmi_privilege: Option<String>,
    pub snmp_v3_enabled: Option<bool>,
    pub snmp_v3_auth: Option<String>,
    pub snmp_v3_privacy: Option<String>,
}

/// Create / update user params.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracUserParams {
    pub user_name: String,
    pub password: Option<String>,
    pub role_id: Option<String>,
    pub enabled: Option<bool>,
    pub description: Option<String>,
    pub slot_id: Option<String>,
}

/// LDAP / Active Directory config.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapConfig {
    pub enabled: bool,
    pub server: Option<String>,
    pub server_address: Option<String>,
    pub port: Option<u16>,
    pub base_dn: Option<String>,
    pub bind_dn: Option<String>,
    pub search_filter: Option<String>,
    pub user_attribute: Option<String>,
    pub use_ssl: bool,
    pub certificate_validation_enabled: bool,
    pub certificate_validation: Option<bool>,
    pub group_attribute: Option<String>,
}

/// Active Directory config.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveDirectoryConfig {
    pub enabled: bool,
    pub domain_name: Option<String>,
    pub domain_controller1: Option<String>,
    pub domain_controller2: Option<String>,
    pub domain_controller3: Option<String>,
    pub domain_controller_addresses: Vec<String>,
    pub global_catalog1: Option<String>,
    pub global_catalog2: Option<String>,
    pub global_catalog3: Option<String>,
    pub global_catalog_addresses: Vec<String>,
    pub schema_type: Option<String>,
    pub certificate_validation_enabled: bool,
    pub certificate_validation: Option<bool>,
}

// ── BIOS ────────────────────────────────────────────────────────────

/// BIOS attribute (current value + allowed values).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiosAttribute {
    pub name: String,
    pub current_value: Option<String>,
    pub pending_value: Option<String>,
    pub value: Option<serde_json::Value>,
    pub attribute_type: Option<String>,
    pub display_name: Option<String>,
    pub read_only: Option<bool>,
    pub possible_values: Option<Vec<String>>,
    pub allowed_values: Option<Vec<serde_json::Value>>,
    pub description: Option<String>,
    pub lower_bound: Option<i64>,
    pub upper_bound: Option<i64>,
}

/// Boot Source entry.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootSource {
    pub id: String,
    pub name: String,
    pub enabled: Option<bool>,
    pub index: Option<u32>,
    pub boot_option_reference: Option<String>,
    pub uefi_device_path: Option<String>,
    pub display_name: Option<String>,
}

/// Boot order configuration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootConfig {
    pub boot_mode: Option<String>,
    pub boot_order: Vec<String>,
    pub boot_source_override_target: Option<String>,
    pub boot_source_override_enabled: Option<String>,
    pub boot_source_override_mode: Option<String>,
    pub uefi_target_boot_source_override: Option<String>,
    pub boot_sources: Vec<BootSource>,
}

// ── Certificates ────────────────────────────────────────────────────

/// SSL certificate installed on iDRAC.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracCertificate {
    pub id: String,
    pub subject: Option<String>,
    pub issuer: Option<String>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub serial_number: Option<String>,
    pub thumbprint: Option<String>,
    pub fingerprint: Option<String>,
    pub key_usage: Vec<String>,
    pub signature_algorithm: Option<String>,
    pub certificate_type: Option<String>,
    pub certificate_string: Option<String>,
}

/// Generate CSR params.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsrParams {
    pub common_name: String,
    pub organization: Option<String>,
    pub organizational_unit: Option<String>,
    pub locality: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub country: Option<String>,
    pub email: Option<String>,
    pub subject_alternative_names: Option<Vec<String>>,
    pub alternative_names: Option<Vec<String>>,
    pub key_algorithm: Option<String>,
    pub key_bit_length: Option<u32>,
}

// ── Health ───────────────────────────────────────────────────────────

/// Component health status.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentHealth {
    pub health: Option<String>,
    pub health_rollup: Option<String>,
    pub state: Option<String>,
}

/// Overall server health rollup.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerHealthRollup {
    pub overall_health: Option<String>,
    pub system_health: ComponentHealth,
    pub chassis_health: ComponentHealth,
    pub idrac_health: ComponentHealth,
    pub processor_health: ComponentHealth,
    pub memory_health: ComponentHealth,
    pub storage_health: Option<ComponentHealth>,
    pub network_health: Option<ComponentHealth>,
    pub power_state: Option<String>,
    pub indicator_led: Option<String>,
}

// ── Telemetry / Metrics ─────────────────────────────────────────────

/// Time-series data point for telemetry.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryDataPoint {
    pub timestamp: Option<String>,
    pub value: Option<f64>,
    pub label: Option<String>,
    pub metric_id: Option<String>,
}

/// Telemetry report.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryReport {
    pub id: String,
    pub name: String,
    pub report_sequence: Option<String>,
    pub timestamp: Option<String>,
    pub metric_values_count: Option<u32>,
}

/// Power telemetry summary.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerTelemetry {
    pub current_watts: Option<f64>,
    pub min_watts: Option<f64>,
    pub max_watts: Option<f64>,
    pub avg_watts: Option<f64>,
    pub interval_minutes: Option<u32>,
    pub history: Vec<TelemetryDataPoint>,
    pub timestamp: Option<String>,
}

/// Thermal telemetry summary.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalTelemetry {
    pub inlet_temp_celsius: Option<f64>,
    pub exhaust_temp_celsius: Option<f64>,
    pub sensor_readings: Vec<TelemetryDataPoint>,
    pub fan_readings: Vec<TelemetryDataPoint>,
    pub history: Vec<TelemetryDataPoint>,
    pub timestamp: Option<String>,
}

// ── RACADM ──────────────────────────────────────────────────────────

/// RACADM command result.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RacadmResult {
    pub command: String,
    pub output: String,
    pub return_code: i32,
    pub success: bool,
    pub error: Option<String>,
}

// ── IPMI types ──────────────────────────────────────────────────────

/// IPMI sensor reading.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
    pub fault: bool,
}

// ── WS-Management types ─────────────────────────────────────────────

/// WS-Management enumeration result (legacy).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsmanInstance {
    pub class_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

/// Legacy system view (DCIM_SystemView from WSMAN).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdracDashboard {
    pub system_info: Option<SystemInfo>,
    pub idrac_info: Option<IdracInfo>,
    pub power_state: Option<String>,
    pub power_metrics: Option<PowerMetrics>,
    pub thermal_summary: Option<ThermalSummary>,
    pub health_rollup: Option<ServerHealthRollup>,
}

/// Quick thermal summary.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalSummary {
    pub inlet_temp_celsius: Option<f64>,
    pub exhaust_temp_celsius: Option<f64>,
    pub max_temp_celsius: Option<f64>,
    pub avg_temp_celsius: Option<f64>,
    pub fan_count: u32,
    pub fans_healthy: bool,
    pub sensor_count: u32,
}
