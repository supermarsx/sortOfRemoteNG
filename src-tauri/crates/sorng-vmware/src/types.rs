//! Shared types for VMware / vSphere management.

use serde::{Deserialize, Serialize};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Connection / Config
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Top-level configuration for connecting to a vCenter / ESXi host.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VsphereConfig {
    /// vCenter or ESXi hostname / IP (e.g. "vcenter.lab.local")
    pub host: String,
    /// Port (default 443)
    #[serde(default = "default_port")]
    pub port: u16,
    /// Username (e.g. "administrator@vsphere.local")
    pub username: String,
    /// Password
    pub password: String,
    /// Skip TLS certificate verification (self-signed labs)
    #[serde(default)]
    pub insecure: bool,
    /// Request timeout in seconds
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_port() -> u16 { 443 }
fn default_timeout() -> u64 { 30 }

impl Default for VsphereConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            username: String::new(),
            password: String::new(),
            port: 443,
            insecure: false,
            timeout_secs: 30,
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Session
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Tracks an active vSphere API session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VsphereSession {
    pub host: String,
    pub username: String,
    pub session_id: String,
    pub connected_at: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  VM Power State
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum VmPowerState {
    PoweredOn,
    PoweredOff,
    Suspended,
    #[serde(other)]
    Unknown,
}

impl Default for VmPowerState {
    fn default() -> Self { Self::Unknown }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  VM Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Concise VM summary (from list endpoint).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmSummary {
    /// vSphere managed-object ID (e.g. "vm-42")
    pub vm: String,
    pub name: String,
    pub power_state: VmPowerState,
    #[serde(default)]
    pub cpu_count: Option<u32>,
    #[serde(default)]
    pub memory_size_mib: Option<u64>,
}

/// Full VM detail (from GET /api/vcenter/vm/{vm}).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmInfo {
    pub name: String,
    pub power_state: VmPowerState,
    #[serde(default)]
    pub guest_os: Option<String>,
    #[serde(default)]
    pub hardware: Option<VmHardware>,
    #[serde(default)]
    pub cpu: Option<VmCpu>,
    #[serde(default)]
    pub memory: Option<VmMemory>,
    #[serde(default)]
    pub boot: Option<VmBoot>,
    #[serde(default)]
    pub boot_devices: Option<Vec<VmBootDevice>>,
    #[serde(default)]
    pub nics: Option<serde_json::Value>,
    #[serde(default)]
    pub disks: Option<serde_json::Value>,
    #[serde(default)]
    pub cdroms: Option<serde_json::Value>,
    #[serde(default)]
    pub floppies: Option<serde_json::Value>,
    #[serde(default)]
    pub parallel_ports: Option<serde_json::Value>,
    #[serde(default)]
    pub serial_ports: Option<serde_json::Value>,
    #[serde(default)]
    pub scsi_adapters: Option<serde_json::Value>,
    #[serde(default)]
    pub sata_adapters: Option<serde_json::Value>,
    #[serde(default)]
    pub nvme_adapters: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmHardware {
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub upgrade_policy: Option<String>,
    #[serde(default)]
    pub upgrade_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmCpu {
    #[serde(default)]
    pub count: Option<u32>,
    #[serde(default)]
    pub cores_per_socket: Option<u32>,
    #[serde(default)]
    pub hot_add_enabled: Option<bool>,
    #[serde(default)]
    pub hot_remove_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmMemory {
    #[serde(default)]
    pub size_mib: Option<u64>,
    #[serde(default)]
    pub hot_add_enabled: Option<bool>,
    #[serde(default)]
    pub hot_add_increment_size_mib: Option<u64>,
    #[serde(default)]
    pub hot_add_limit_mib: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmBoot {
    #[serde(default)]
    pub delay: Option<u64>,
    #[serde(default, rename = "type")]
    pub boot_type: Option<String>,
    #[serde(default)]
    pub efi_legacy_boot: Option<bool>,
    #[serde(default)]
    pub enter_setup_mode: Option<bool>,
    #[serde(default)]
    pub network_protocol: Option<String>,
    #[serde(default)]
    pub retry: Option<bool>,
    #[serde(default)]
    pub retry_delay: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmBootDevice {
    #[serde(rename = "type")]
    pub device_type: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  VM Create / Update
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Create VM spec matching vSphere POST /api/vcenter/vm.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmCreateSpec {
    pub name: String,
    #[serde(default)]
    pub guest_os: Option<String>,
    #[serde(default)]
    pub placement: Option<VmPlacement>,
    #[serde(default)]
    pub cpu: Option<VmCpuSpec>,
    #[serde(default)]
    pub memory: Option<VmMemorySpec>,
    #[serde(default)]
    pub boot: Option<VmBootSpec>,
    #[serde(default)]
    pub boot_devices: Option<Vec<VmBootDeviceSpec>>,
    #[serde(default)]
    pub nics: Option<Vec<VmNicSpec>>,
    #[serde(default)]
    pub disks: Option<Vec<VmDiskSpec>>,
    #[serde(default)]
    pub cdroms: Option<Vec<VmCdromSpec>>,
    #[serde(default)]
    pub scsi_adapters: Option<Vec<VmScsiAdapterSpec>>,
    #[serde(default)]
    pub sata_adapters: Option<Vec<VmSataAdapterSpec>>,
    #[serde(default)]
    pub hardware_version: Option<String>,
    /// Auto power-on after creation
    #[serde(default)]
    pub power_on: Option<bool>,
    /// Storage policy ID
    #[serde(default)]
    pub storage_policy: Option<StoragePolicySpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmPlacement {
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub resource_pool: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub cluster: Option<String>,
    #[serde(default)]
    pub datastore: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmCpuSpec {
    #[serde(default)]
    pub count: Option<u32>,
    #[serde(default)]
    pub cores_per_socket: Option<u32>,
    #[serde(default)]
    pub hot_add_enabled: Option<bool>,
    #[serde(default)]
    pub hot_remove_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmMemorySpec {
    #[serde(default)]
    pub size_mib: Option<u64>,
    #[serde(default)]
    pub hot_add_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmBootSpec {
    #[serde(default)]
    pub delay: Option<u64>,
    #[serde(default, rename = "type")]
    pub boot_type: Option<String>,
    #[serde(default)]
    pub efi_legacy_boot: Option<bool>,
    #[serde(default)]
    pub enter_setup_mode: Option<bool>,
    #[serde(default)]
    pub network_protocol: Option<String>,
    #[serde(default)]
    pub retry: Option<bool>,
    #[serde(default)]
    pub retry_delay: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmBootDeviceSpec {
    #[serde(rename = "type")]
    pub device_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmNicSpec {
    #[serde(default, rename = "type")]
    pub nic_type: Option<String>,
    #[serde(default)]
    pub network: Option<String>,
    #[serde(default)]
    pub mac_type: Option<String>,
    #[serde(default)]
    pub mac_address: Option<String>,
    #[serde(default)]
    pub start_connected: Option<bool>,
    #[serde(default)]
    pub allow_guest_control: Option<bool>,
    #[serde(default)]
    pub wake_on_lan_enabled: Option<bool>,
    #[serde(default)]
    pub upt_compatibility_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmDiskSpec {
    #[serde(default, rename = "type")]
    pub disk_type: Option<String>,
    #[serde(default)]
    pub new_vmdk: Option<VmdkCreateSpec>,
    #[serde(default)]
    pub backing: Option<DiskBackingSpec>,
    #[serde(default)]
    pub scsi: Option<ScsiAddressSpec>,
    #[serde(default)]
    pub sata: Option<SataAddressSpec>,
    #[serde(default)]
    pub nvme: Option<NvmeAddressSpec>,
    #[serde(default)]
    pub ide: Option<IdeAddressSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmdkCreateSpec {
    #[serde(default)]
    pub capacity: Option<u64>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub storage_policy: Option<StoragePolicySpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskBackingSpec {
    #[serde(default, rename = "type")]
    pub backing_type: Option<String>,
    #[serde(default)]
    pub vmdk_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScsiAddressSpec {
    #[serde(default)]
    pub bus: Option<u32>,
    #[serde(default)]
    pub unit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SataAddressSpec {
    #[serde(default)]
    pub bus: Option<u32>,
    #[serde(default)]
    pub unit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NvmeAddressSpec {
    #[serde(default)]
    pub bus: Option<u32>,
    #[serde(default)]
    pub unit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeAddressSpec {
    #[serde(default)]
    pub primary: Option<bool>,
    #[serde(default)]
    pub master: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmCdromSpec {
    #[serde(default, rename = "type")]
    pub cdrom_type: Option<String>,
    #[serde(default)]
    pub backing: Option<CdromBackingSpec>,
    #[serde(default)]
    pub start_connected: Option<bool>,
    #[serde(default)]
    pub allow_guest_control: Option<bool>,
    #[serde(default)]
    pub sata: Option<SataAddressSpec>,
    #[serde(default)]
    pub ide: Option<IdeAddressSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CdromBackingSpec {
    #[serde(default, rename = "type")]
    pub backing_type: Option<String>,
    #[serde(default)]
    pub iso_file: Option<String>,
    #[serde(default)]
    pub device_access_type: Option<String>,
    #[serde(default)]
    pub host_device: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmScsiAdapterSpec {
    #[serde(default, rename = "type")]
    pub adapter_type: Option<String>,
    #[serde(default)]
    pub bus: Option<u32>,
    #[serde(default)]
    pub sharing: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmSataAdapterSpec {
    #[serde(default)]
    pub bus: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePolicySpec {
    pub policy: String,
}

/// Update CPU configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmCpuUpdate {
    #[serde(default)]
    pub count: Option<u32>,
    #[serde(default)]
    pub cores_per_socket: Option<u32>,
    #[serde(default)]
    pub hot_add_enabled: Option<bool>,
    #[serde(default)]
    pub hot_remove_enabled: Option<bool>,
}

/// Update memory configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmMemoryUpdate {
    #[serde(default)]
    pub size_mib: Option<u64>,
    #[serde(default)]
    pub hot_add_enabled: Option<bool>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Guest OS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestInfo {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub family: Option<String>,
    #[serde(default)]
    pub full_name: Option<String>,
    #[serde(default)]
    pub host_name: Option<String>,
    #[serde(default)]
    pub ip_address: Option<String>,
    #[serde(default)]
    pub os_id: Option<String>,
}

/// Identity returned from guest operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestIdentity {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub family: Option<String>,
    #[serde(default)]
    pub full_name: Option<String>,
    #[serde(default)]
    pub host_name: Option<String>,
    #[serde(default)]
    pub ip_address: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Snapshots
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSummary {
    pub snapshot: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(default)]
    pub children: Option<Vec<String>>,
    #[serde(default)]
    pub power_state: Option<VmPowerState>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub creation_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotTree {
    #[serde(default)]
    pub snapshots: Vec<SnapshotSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSnapshotSpec {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Snapshot the VM's memory state
    #[serde(default)]
    pub memory: Option<bool>,
    /// Quiesce the guest file system
    #[serde(default)]
    pub quiesce: Option<bool>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Host (ESXi)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HostConnectionState {
    Connected,
    Disconnected,
    NotResponding,
    #[serde(other)]
    Unknown,
}

impl Default for HostConnectionState {
    fn default() -> Self { Self::Unknown }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HostPowerState {
    PoweredOn,
    PoweredOff,
    Standby,
    #[serde(other)]
    Unknown,
}

impl Default for HostPowerState {
    fn default() -> Self { Self::Unknown }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSummary {
    pub host: String,
    pub name: String,
    pub connection_state: HostConnectionState,
    #[serde(default)]
    pub power_state: Option<HostPowerState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub name: String,
    pub connection_state: HostConnectionState,
    #[serde(default)]
    pub power_state: Option<HostPowerState>,
    #[serde(default)]
    pub server_guid: Option<String>,
    #[serde(default)]
    pub ntp_servers: Option<Vec<String>>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Datastore / Storage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreSummary {
    pub datastore: String,
    pub name: String,
    #[serde(default, rename = "type")]
    pub ds_type: Option<String>,
    #[serde(default)]
    pub free_space: Option<u64>,
    #[serde(default)]
    pub capacity: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatastoreInfo {
    pub name: String,
    #[serde(default, rename = "type")]
    pub ds_type: Option<String>,
    #[serde(default)]
    pub accessible: Option<bool>,
    #[serde(default)]
    pub free_space: Option<u64>,
    #[serde(default)]
    pub multiple_host_access: Option<bool>,
    #[serde(default)]
    pub thin_provisioning_supported: Option<bool>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Network
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSummary {
    pub network: String,
    pub name: String,
    #[serde(default, rename = "type")]
    pub network_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub name: String,
    #[serde(default, rename = "type")]
    pub network_type: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Cluster / Datacenter / Folder / Resource Pool
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterSummary {
    pub cluster: String,
    pub name: String,
    #[serde(default)]
    pub ha_enabled: Option<bool>,
    #[serde(default)]
    pub drs_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatacenterSummary {
    pub datacenter: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSummary {
    pub folder: String,
    pub name: String,
    #[serde(default, rename = "type")]
    pub folder_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePoolSummary {
    pub resource_pool: String,
    pub name: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Content Library
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentLibrary {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, rename = "type")]
    pub lib_type: Option<String>,
    #[serde(default)]
    pub creation_time: Option<String>,
    #[serde(default)]
    pub storage_backings: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub library_id: Option<String>,
    #[serde(default, rename = "type")]
    pub item_type: Option<String>,
    #[serde(default)]
    pub creation_time: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tags
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCategory {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub cardinality: Option<String>,
    #[serde(default)]
    pub associable_types: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub category_id: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Task
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInfo {
    #[serde(default)]
    pub task: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub description: Option<serde_json::Value>,
    #[serde(default)]
    pub result: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<serde_json::Value>,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub end_time: Option<String>,
    #[serde(default)]
    pub progress: Option<u32>,
    #[serde(default)]
    pub cancelable: Option<bool>,
    #[serde(default)]
    pub target: Option<serde_json::Value>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Console Ticket / Session (cross-platform)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Ticket type used for the vSphere console tickets API.
///
/// - **WebMks** — HTML5 WebSocket console (VMware Mouse-Keyboard-Screen).
///   This is the primary cross-platform mode.
/// - **Vnc** — Standard VNC / RFB protocol.
/// - **Mks** — Legacy VMware MKS (binary, not WebSocket-based).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ConsoleTicketType {
    /// HTML5 WebSocket console (preferred, cross-platform).
    #[serde(rename = "WEBMKS")]
    WebMks,
    /// Standard VNC protocol.
    #[serde(rename = "VNC")]
    Vnc,
    /// Legacy VMware MKS protocol.
    #[serde(rename = "MKS")]
    Mks,
}

impl ConsoleTicketType {
    /// String value expected by the vSphere REST API.
    pub fn as_api_str(&self) -> &'static str {
        match self {
            Self::WebMks => "WEBMKS",
            Self::Vnc => "VNC",
            Self::Mks => "MKS",
        }
    }
}

impl Default for ConsoleTicketType {
    fn default() -> Self {
        Self::WebMks
    }
}

/// A console ticket returned by the vSphere REST API.
///
/// `POST /api/vcenter/vm/{vm}/console/tickets` → `ConsoleTicket`
///
/// The ticket is single-use and expires after a few minutes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleTicket {
    /// One-time-use opaque ticket string.
    pub ticket: String,
    /// ESXi host that serves the console WebSocket.
    #[serde(default)]
    pub host: Option<String>,
    /// Port (typically 443).
    #[serde(default)]
    pub port: Option<u16>,
    /// SSL certificate thumbprint (SHA-256, colon-separated hex).
    #[serde(default)]
    pub ssl_thumbprint: Option<String>,
}

/// Parameters for opening a cross-platform console session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenConsoleRequest {
    /// VM managed-object ID (e.g. `"vm-42"`).
    pub vm_id: String,
    /// Ticket type (default: WebMks).
    #[serde(default)]
    pub ticket_type: ConsoleTicketType,
    /// Accept self-signed / invalid TLS certificates on the ESXi host.
    #[serde(default = "default_true")]
    pub insecure: bool,
}

fn default_true() -> bool {
    true
}

/// An active console session backed by a local TCP proxy.
///
/// The proxy bridges `ws://localhost:{proxy_port}` (plain) to the ESXi
/// host's `wss://{host}:{port}` (TLS), so the Tauri webview does not
/// need to handle self-signed certificates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleSession {
    /// Unique identifier for this session.
    pub session_id: String,
    /// VM managed-object ID.
    pub vm_id: String,
    /// Which ticket type was used.
    pub ticket_type: String,
    /// Direct WebSocket URL to the ESXi host
    /// (e.g. `wss://esxi-host:443/ticket/{ticket}`).
    pub direct_url: String,
    /// Local proxy URL that the frontend should connect to
    /// (e.g. `ws://localhost:54321`).
    #[serde(default)]
    pub proxy_url: Option<String>,
    /// Local proxy listen port.
    #[serde(default)]
    pub proxy_port: Option<u16>,
    /// ISO-8601 timestamp when the session was created.
    pub started_at: String,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  VMRC / Horizon View types (binary fallback)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// How to connect via VMRC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmrcConnectionConfig {
    /// vCenter / ESXi host
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    /// VM managed-object reference (e.g. "vm-42")
    pub vm_moid: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    /// Use Horizon View client instead of VMRC
    #[serde(default)]
    pub use_horizon: bool,
    /// Horizon desktop / pool name
    #[serde(default)]
    pub desktop_name: Option<String>,
    /// Horizon domain
    #[serde(default)]
    pub domain: Option<String>,
}

/// Tracks a running VMRC / Horizon process.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmrcSession {
    pub session_id: String,
    pub vm_moid: String,
    pub host: String,
    pub process_id: u32,
    pub started_at: String,
    #[serde(default)]
    pub use_horizon: bool,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Performance / Metrics
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmQuickStats {
    pub vm: String,
    pub name: String,
    pub power_state: VmPowerState,
    #[serde(default)]
    pub cpu_count: Option<u32>,
    #[serde(default)]
    pub memory_size_mib: Option<u64>,
    #[serde(default)]
    pub cpu_usage_mhz: Option<u64>,
    #[serde(default)]
    pub memory_usage_mib: Option<u64>,
    #[serde(default)]
    pub storage_used_bytes: Option<u64>,
    #[serde(default)]
    pub uptime_seconds: Option<u64>,
    #[serde(default)]
    pub guest_os: Option<String>,
    #[serde(default)]
    pub ip_address: Option<String>,
    #[serde(default)]
    pub host_name: Option<String>,
    #[serde(default)]
    pub tools_status: Option<String>,
    #[serde(default)]
    pub tools_version: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  VM Clone / Relocate
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmCloneSpec {
    pub name: String,
    pub source: String,
    #[serde(default)]
    pub placement: Option<VmPlacement>,
    #[serde(default)]
    pub power_on: Option<bool>,
    /// Optional customization spec name
    #[serde(default)]
    pub customization_spec: Option<String>,
    #[serde(default)]
    pub disk_provision_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmRelocateSpec {
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub datastore: Option<String>,
    #[serde(default)]
    pub resource_pool: Option<String>,
    #[serde(default)]
    pub folder: Option<String>,
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OVF / Template
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OvfDeploySpec {
    /// Content Library item ID
    pub library_item_id: String,
    pub name: String,
    #[serde(default)]
    pub placement: Option<VmPlacement>,
    #[serde(default)]
    pub accept_all_eula: Option<bool>,
    #[serde(default)]
    pub power_on: Option<bool>,
    #[serde(default)]
    pub network_mappings: Option<serde_json::Value>,
    #[serde(default)]
    pub storage_mappings: Option<serde_json::Value>,
}

/// Convert VM to template or vice-versa.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateConvertSpec {
    /// Library to store the template in (for library template)
    #[serde(default)]
    pub library: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}
