//! Vendor-neutral data types for BMC management.
//!
//! These are the *common denominator* structures that every BMC vendor
//! populates (Dell, HP, Supermicro, Lenovo, …).  Vendor-specific fields
//! live in the respective crate, not here.

use serde::{Deserialize, Serialize};

// ── Redfish OData helpers ───────────────────────────────────────────

/// Redfish collection wrapper (Members array + count).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct RedfishCollection<T> {
    #[serde(rename = "Members@odata.count")]
    pub count: Option<u64>,
    #[serde(rename = "Members")]
    pub members: Vec<T>,
}

/// Redfish member link (`@odata.id`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OdataLink {
    #[serde(rename = "@odata.id")]
    pub odata_id: String,
}

// ── System ──────────────────────────────────────────────────────────

/// Vendor-neutral top-level system overview.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcSystemInfo {
    pub id: String,
    pub manufacturer: String,
    pub model: String,
    pub serial_number: String,
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

/// BMC controller information (the management card itself).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcControllerInfo {
    pub firmware_version: String,
    pub controller_type: String,
    pub ip_address: String,
    pub mac_address: Option<String>,
    pub model: Option<String>,
    pub generation: Option<String>,
    pub license_type: Option<String>,
}

// ── Power ───────────────────────────────────────────────────────────

/// Power supply unit info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcPowerSupply {
    pub id: String,
    pub name: String,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub firmware_version: Option<String>,
    pub status: ComponentHealth,
    pub capacity_watts: Option<f64>,
    pub input_voltage: Option<f64>,
    pub output_watts: Option<f64>,
    pub manufacturer: Option<String>,
    pub part_number: Option<String>,
    pub efficiency_rating: Option<f64>,
}

/// Power consumption metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcPowerMetrics {
    pub current_watts: Option<f64>,
    pub min_watts: Option<f64>,
    pub max_watts: Option<f64>,
    pub average_watts: Option<f64>,
    pub power_cap_watts: Option<f64>,
    pub power_cap_enabled: bool,
}

// ── Thermal ─────────────────────────────────────────────────────────

/// Temperature sensor reading.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcTemperatureSensor {
    pub id: String,
    pub name: String,
    pub reading_celsius: Option<f64>,
    pub upper_threshold_critical: Option<f64>,
    pub upper_threshold_fatal: Option<f64>,
    pub lower_threshold_critical: Option<f64>,
    pub status: ComponentHealth,
    pub physical_context: Option<String>,
}

/// Fan reading.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcFan {
    pub id: String,
    pub name: String,
    pub reading_rpm: Option<u32>,
    pub reading_percent: Option<u32>,
    pub status: ComponentHealth,
    pub physical_context: Option<String>,
}

/// Combined thermal data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcThermalData {
    pub temperatures: Vec<BmcTemperatureSensor>,
    pub fans: Vec<BmcFan>,
}

// ── Hardware ────────────────────────────────────────────────────────

/// CPU / processor.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcProcessor {
    pub id: String,
    pub socket: String,
    pub manufacturer: String,
    pub model: String,
    pub total_cores: u32,
    pub total_threads: u32,
    pub max_speed_mhz: Option<u32>,
    pub status: ComponentHealth,
}

/// Memory DIMM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcMemoryDimm {
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    pub capacity_mib: u64,
    pub speed_mhz: Option<u32>,
    pub memory_type: String,
    pub device_locator: String,
    pub status: ComponentHealth,
}

// ── Storage ─────────────────────────────────────────────────────────

/// Storage controller.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcStorageController {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub firmware_version: Option<String>,
    pub status: ComponentHealth,
}

/// Logical / virtual disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcVirtualDisk {
    pub id: String,
    pub name: String,
    pub raid_level: Option<String>,
    pub capacity_bytes: Option<u64>,
    pub status: ComponentHealth,
}

/// Physical disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcPhysicalDisk {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub capacity_bytes: Option<u64>,
    pub media_type: Option<String>,
    pub protocol: Option<String>,
    pub status: ComponentHealth,
}

// ── Network ─────────────────────────────────────────────────────────

/// Network adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcNetworkAdapter {
    pub id: String,
    pub name: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub mac_address: Option<String>,
    pub status: ComponentHealth,
}

// ── Firmware ────────────────────────────────────────────────────────

/// Firmware inventory item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcFirmwareItem {
    pub id: String,
    pub name: String,
    pub version: String,
    pub updateable: bool,
    pub component_type: Option<String>,
    pub status: ComponentHealth,
}

// ── Event log ───────────────────────────────────────────────────────

/// System Event Log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcEventLogEntry {
    pub id: String,
    pub created: String,
    pub severity: String,
    pub message: String,
    pub message_id: Option<String>,
    pub entry_type: Option<String>,
}

// ── Users ───────────────────────────────────────────────────────────

/// BMC local user.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcUser {
    pub id: String,
    pub username: String,
    pub role: String,
    pub enabled: bool,
    pub locked: bool,
}

// ── Virtual Media ───────────────────────────────────────────────────

/// Virtual media device status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcVirtualMedia {
    pub id: String,
    pub media_types: Vec<String>,
    pub image: Option<String>,
    pub inserted: bool,
    pub write_protected: bool,
    pub connected_via: Option<String>,
}

// ── Health ──────────────────────────────────────────────────────────

/// Component health status (mirrors Redfish Health / State).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComponentHealth {
    pub health: Option<String>,
    pub state: Option<String>,
}

impl Default for ComponentHealth {
    fn default() -> Self {
        Self {
            health: Some("OK".to_string()),
            state: Some("Enabled".to_string()),
        }
    }
}

/// Overall BMC health rollup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcHealthRollup {
    pub overall: String,
    pub processors: String,
    pub memory: String,
    pub storage: String,
    pub fans: String,
    pub temperatures: String,
    pub power_supplies: String,
    pub network: String,
}

// ── IPMI types ──────────────────────────────────────────────────────

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

/// IPMI FRU (Field Replaceable Unit) info.
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

/// IPMI sensor reading.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpmiSensor {
    pub name: String,
    pub sensor_type: String,
    pub reading: Option<f64>,
    pub unit: Option<String>,
    pub status: String,
    pub thresholds: Option<SensorThresholds>,
}

/// Sensor thresholds.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SensorThresholds {
    pub upper_critical: Option<f64>,
    pub upper_non_critical: Option<f64>,
    pub lower_critical: Option<f64>,
    pub lower_non_critical: Option<f64>,
}
