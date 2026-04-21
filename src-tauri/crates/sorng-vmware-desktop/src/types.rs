//! Shared types for VMware Desktop (Player / Workstation / Fusion).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════════════════════
// Product & Host
// ═══════════════════════════════════════════════════════════════════════════════

/// Which VMware desktop product is installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VmwProduct {
    Player,
    Workstation,
    WorkstationPro,
    Fusion,
    FusionPro,
    Unknown,
}

/// Whether vmrest / vmrun was detected and product version.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmwHostInfo {
    pub product: VmwProduct,
    pub product_version: Option<String>,
    pub vmrun_path: Option<String>,
    pub vmrest_available: bool,
    pub vmrest_port: Option<u16>,
    pub os: String,
    pub default_vm_dir: Option<String>,
    pub network_types: Vec<String>,
}

/// Connection/config for reaching the vmrest endpoint (or local CLI).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmwDesktopConfig {
    /// Path to vmrun binary (auto-detected if omitted).
    pub vmrun_path: Option<String>,
    /// If using vmrest: host (default 127.0.0.1).
    pub vmrest_host: Option<String>,
    /// vmrest port (default 8697).
    pub vmrest_port: Option<u16>,
    /// vmrest basic-auth username.
    pub vmrest_username: Option<String>,
    /// vmrest basic-auth password.
    pub vmrest_password: Option<String>,
    /// Whether to also launch vmrest if not already running.
    #[serde(default)]
    pub auto_start_vmrest: bool,
    /// Timeout for CLI commands (seconds).
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_timeout() -> u64 {
    60
}

impl Default for VmwDesktopConfig {
    fn default() -> Self {
        Self {
            vmrun_path: None,
            vmrest_host: None,
            vmrest_port: None,
            vmrest_username: None,
            vmrest_password: None,
            auto_start_vmrest: false,
            timeout_secs: default_timeout(),
        }
    }
}

/// Summary returned after successful connection / detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmwConnectionSummary {
    pub product: VmwProduct,
    pub product_version: Option<String>,
    pub vmrun_available: bool,
    pub vmrest_available: bool,
    pub vm_count: usize,
}

// ═══════════════════════════════════════════════════════════════════════════════
// VM Core
// ═══════════════════════════════════════════════════════════════════════════════

/// Power state of a VM.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VmPowerState {
    PoweredOn,
    PoweredOff,
    Suspended,
    Paused,
    Unknown,
}

/// Guest OS family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GuestOsFamily {
    Windows,
    Linux,
    MacOs,
    FreeBsd,
    Solaris,
    Other,
}

/// Compact VM listing entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmSummary {
    /// The VM identifier (vmrest uses an opaque ID, vmrun uses vmx path).
    pub id: String,
    /// Absolute path to the .vmx file.
    pub vmx_path: String,
    /// Display name.
    pub name: String,
    pub power_state: VmPowerState,
    pub guest_os: Option<String>,
    pub guest_os_family: GuestOsFamily,
    pub num_cpus: Option<u32>,
    pub memory_mb: Option<u64>,
}

/// Full VM detail including hardware, settings, etc.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmDetail {
    pub id: String,
    pub vmx_path: String,
    pub name: String,
    pub power_state: VmPowerState,
    pub guest_os: Option<String>,
    pub guest_os_family: GuestOsFamily,
    pub annotation: Option<String>,
    pub hardware_version: Option<u32>,
    pub num_cpus: Option<u32>,
    pub cores_per_socket: Option<u32>,
    pub memory_mb: Option<u64>,
    pub firmware: Option<String>,
    pub bios_type: Option<String>,
    pub uefi_secure_boot: Option<bool>,
    pub vtpm_present: Option<bool>,
    pub encryption_enabled: Option<bool>,
    pub tools_status: Option<String>,
    pub tools_version: Option<String>,
    pub ip_address: Option<String>,
    pub mac_addresses: Vec<String>,
    pub nics: Vec<VmNic>,
    pub disks: Vec<VmDisk>,
    pub cdroms: Vec<VmCdrom>,
    pub usb_controllers: Vec<String>,
    pub sound_card: Option<String>,
    pub display: Option<VmDisplay>,
    pub shared_folders: Vec<SharedFolder>,
    pub snapshots: Vec<SnapshotInfo>,
    pub auto_start: Option<bool>,
    pub vmx_settings: HashMap<String, String>,
}

/// Network adapter attached to a VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmNic {
    pub index: u32,
    pub adapter_type: String,
    pub network_type: String,
    pub mac_address: Option<String>,
    pub connected: bool,
    pub start_connected: bool,
    pub vnet: Option<String>,
}

/// Virtual disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmDisk {
    pub index: u32,
    pub file_name: String,
    pub capacity_mb: Option<u64>,
    pub disk_type: String,
    pub controller_type: String,
    pub controller_bus: u32,
    pub unit_number: u32,
}

/// CD/DVD device.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmCdrom {
    pub index: u32,
    pub device_type: String,
    pub file_name: Option<String>,
    pub connected: bool,
    pub start_connected: bool,
}

/// Display / 3D acceleration settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmDisplay {
    pub display_name: Option<String>,
    pub use_auto_detect: bool,
    pub accel_3d: bool,
    pub vram_size_kb: Option<u64>,
    pub num_displays: Option<u32>,
}

/// Shared folder between host and guest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedFolder {
    pub name: String,
    pub host_path: String,
    pub writable: bool,
    pub enabled: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// VM Creation / Configuration
// ═══════════════════════════════════════════════════════════════════════════════

/// Request to create a new VM from scratch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVmRequest {
    pub name: String,
    pub guest_os: String,
    pub num_cpus: Option<u32>,
    pub cores_per_socket: Option<u32>,
    pub memory_mb: Option<u64>,
    pub disk_size_mb: Option<u64>,
    pub disk_type: Option<String>,
    pub network_type: Option<String>,
    pub firmware: Option<String>,
    pub hardware_version: Option<u32>,
    /// Directory where the VM folder will be created.
    pub target_dir: Option<String>,
    pub iso_path: Option<String>,
    pub auto_install: Option<bool>,
    pub annotation: Option<String>,
}

/// Request to clone an existing VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneVmRequest {
    pub source_vmx: String,
    pub dest_name: String,
    pub dest_dir: Option<String>,
    /// "full" or "linked"
    pub clone_type: String,
    /// Optional snapshot name to clone from.
    pub snapshot_name: Option<String>,
}

/// A subset of VMX settings to update.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVmRequest {
    pub vmx_path: String,
    pub name: Option<String>,
    pub num_cpus: Option<u32>,
    pub cores_per_socket: Option<u32>,
    pub memory_mb: Option<u64>,
    pub annotation: Option<String>,
    pub firmware: Option<String>,
    pub nested_virt: Option<bool>,
    pub side_channel_mitigations: Option<bool>,
    pub uefi_secure_boot: Option<bool>,
    pub vtpm: Option<bool>,
}

/// Request to add / modify a NIC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureNicRequest {
    pub vmx_path: String,
    pub nic_index: u32,
    pub network_type: Option<String>,
    pub adapter_type: Option<String>,
    pub mac_address: Option<String>,
    pub vnet: Option<String>,
    pub connected: Option<bool>,
    pub start_connected: Option<bool>,
}

/// Request to add a virtual disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddDiskRequest {
    pub vmx_path: String,
    pub size_mb: u64,
    pub disk_type: Option<String>,
    /// Controller type – "scsi", "sata", "nvme", "ide"
    pub controller_type: Option<String>,
    pub file_name: Option<String>,
}

/// Request to add / change CD/DVD.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureCdromRequest {
    pub vmx_path: String,
    pub cdrom_index: u32,
    pub device_type: String,
    pub file_name: Option<String>,
    pub connected: Option<bool>,
}

/// Request to add / modify a shared folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedFolderRequest {
    pub vmx_path: String,
    pub name: String,
    pub host_path: String,
    pub writable: Option<bool>,
    pub enabled: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Snapshots
// ═══════════════════════════════════════════════════════════════════════════════

/// Snapshot metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub name: String,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub created_at: Option<String>,
    pub parent: Option<String>,
    pub is_current: bool,
    pub children: Vec<String>,
    /// Whether VM memory was captured.
    pub has_memory: Option<bool>,
    /// Size on disk (bytes).
    pub size: Option<u64>,
}

/// Snapshot tree (parent → children).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotTree {
    pub vm_name: String,
    pub vmx_path: String,
    pub current_snapshot: Option<String>,
    pub snapshots: Vec<SnapshotInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSnapshotRequest {
    pub vmx_path: String,
    pub name: String,
    pub description: Option<String>,
    #[serde(default = "default_true")]
    pub capture_memory: bool,
    #[serde(default)]
    pub quiesce_filesystem: bool,
}

fn default_true() -> bool {
    true
}

// ═══════════════════════════════════════════════════════════════════════════════
// Guest Operations
// ═══════════════════════════════════════════════════════════════════════════════

/// Run a program inside the guest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestExecRequest {
    pub vmx_path: String,
    pub guest_user: String,
    pub guest_password: String,
    pub program: String,
    pub arguments: Option<String>,
    #[serde(default)]
    pub no_wait: bool,
    #[serde(default)]
    pub interactive: bool,
}

/// Result of running a guest program.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestExecResult {
    pub exit_code: Option<i32>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
}

/// Run a script (bash/cmd/ps) inside the guest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestScriptRequest {
    pub vmx_path: String,
    pub guest_user: String,
    pub guest_password: String,
    /// Interpreter path, e.g. "/bin/bash", "C:\\Windows\\System32\\cmd.exe"
    pub interpreter: String,
    pub script_text: String,
    #[serde(default)]
    pub no_wait: bool,
}

/// Copy a file between host and guest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestFileTransfer {
    pub vmx_path: String,
    pub guest_user: String,
    pub guest_password: String,
    pub host_path: String,
    pub guest_path: String,
}

/// Guest environment variable.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestEnvVar {
    pub name: String,
    pub value: String,
}

/// Guest process entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestProcess {
    pub pid: u64,
    pub name: String,
    pub owner: Option<String>,
    pub command: Option<String>,
    pub start_time: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// VMware Tools
// ═══════════════════════════════════════════════════════════════════════════════

/// VMware Tools status inside the guest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsStatus {
    pub installed: bool,
    pub running: bool,
    pub version: Option<String>,
    pub upgrade_status: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Virtual Networking (vmnet)
// ═══════════════════════════════════════════════════════════════════════════════

/// A virtual network (vmnet adapter).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualNetwork {
    pub name: String,
    pub network_type: String,
    pub subnet: Option<String>,
    pub subnet_mask: Option<String>,
    pub dhcp_enabled: Option<bool>,
    pub nat_enabled: Option<bool>,
    pub host_only_adapter: Option<String>,
    pub mtu: Option<u32>,
}

/// NAT port-forwarding rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NatPortForward {
    pub network: String,
    pub protocol: String,
    pub host_port: u16,
    pub guest_ip: String,
    pub guest_port: u16,
    pub description: Option<String>,
}

/// DHCP reservation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DhcpReservation {
    pub network: String,
    pub mac_address: String,
    pub ip_address: String,
}

/// MAC-to-IP mapping (DHCP lease).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DhcpLease {
    pub mac_address: String,
    pub ip_address: String,
    pub hostname: Option<String>,
    pub expires: Option<String>,
}

/// Request to create / update a virtual network.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNetworkRequest {
    pub name: String,
    pub network_type: String,
    pub subnet: Option<String>,
    pub subnet_mask: Option<String>,
    pub dhcp_enabled: Option<bool>,
    pub nat_enabled: Option<bool>,
}

/// Request to add a NAT port-forward.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPortForwardRequest {
    pub network: String,
    pub protocol: String,
    pub host_port: u16,
    pub guest_ip: String,
    pub guest_port: u16,
    pub description: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// OVF / OVA Import / Export
// ═══════════════════════════════════════════════════════════════════════════════

/// Import options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OvfImportRequest {
    /// Path to the .ovf or .ova file.
    pub source_path: String,
    /// Target directory for the new VM.
    pub target_dir: Option<String>,
    /// Override the VM name.
    pub name: Option<String>,
    /// Accept license agreements automatically.
    #[serde(default)]
    pub accept_eula: bool,
}

/// Export options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OvfExportRequest {
    pub vmx_path: String,
    pub target_path: String,
    /// Format: "ovf" or "ova"
    pub format: Option<String>,
    /// Include ISO images.
    #[serde(default)]
    pub include_isos: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// USB
// ═══════════════════════════════════════════════════════════════════════════════

/// Connected USB device info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsbDevice {
    pub vendor_id: String,
    pub product_id: String,
    pub name: String,
    pub connected_to_vm: Option<String>,
    pub auto_connect: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Resource Monitoring
// ═══════════════════════════════════════════════════════════════════════════════

/// Real-time resource usage of a running VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmResourceUsage {
    pub vmx_path: String,
    pub cpu_usage_mhz: Option<u64>,
    pub cpu_usage_percent: Option<f64>,
    pub memory_active_mb: Option<u64>,
    pub memory_consumed_mb: Option<u64>,
    pub memory_overhead_mb: Option<u64>,
    pub disk_read_bps: Option<u64>,
    pub disk_write_bps: Option<u64>,
    pub net_rx_bps: Option<u64>,
    pub net_tx_bps: Option<u64>,
    pub uptime_secs: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Teams (Workstation Pro)
// ═══════════════════════════════════════════════════════════════════════════════

/// A "Team" is a group of VMs with shared networks (Workstation Pro feature).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmTeam {
    pub name: String,
    pub path: String,
    pub vms: Vec<String>,
    pub lan_segments: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// VMX File
// ═══════════════════════════════════════════════════════════════════════════════

/// Parsed VMX key-value pair (preserving comments).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmxEntry {
    pub key: String,
    pub value: String,
}

/// A full parsed VMX file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmxFile {
    pub path: String,
    pub entries: Vec<VmxEntry>,
    pub settings: HashMap<String, String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// VMDK
// ═══════════════════════════════════════════════════════════════════════════════

/// VMDK disk metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmdkInfo {
    pub path: String,
    pub capacity_mb: u64,
    pub disk_type: String,
    pub adapter_type: String,
    pub parent_vmdk: Option<String>,
    pub extents: Vec<VmdkExtent>,
    pub size_on_disk_mb: Option<u64>,
}

/// Individual VMDK extent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmdkExtent {
    pub access: String,
    pub size_sectors: u64,
    pub extent_type: String,
    pub file_name: String,
}

/// Request to create a standalone VMDK.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVmdkRequest {
    pub path: String,
    pub size_mb: u64,
    /// "monolithicSparse", "monolithicFlat", "twoGbMaxExtentSparse", "twoGbMaxExtentFlat"
    pub disk_type: Option<String>,
    pub adapter_type: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Preferences / Application-level
// ═══════════════════════════════════════════════════════════════════════════════

/// VMware Workstation / Player application preferences.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmwPreferences {
    pub default_vm_path: Option<String>,
    pub auto_connect_usb: Option<bool>,
    pub hot_key_combo: Option<String>,
    pub show_tray_icon: Option<bool>,
    pub updates_check: Option<bool>,
    pub ceip_enabled: Option<bool>,
    pub shared_vms_path: Option<String>,
    pub ws_port: Option<u16>,
    /// Raw key-value pairs from preferences file.
    pub raw: HashMap<String, String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Automation / Batch
// ═══════════════════════════════════════════════════════════════════════════════

/// Result for batch power operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPowerResult {
    pub succeeded: Vec<String>,
    pub failed: Vec<BatchPowerFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPowerFailure {
    pub vmx_path: String,
    pub error: String,
}

/// Power action for batch operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PowerAction {
    Start,
    Stop,
    Suspend,
    Reset,
    Pause,
    Unpause,
    Shutdown,
    Reboot,
}
