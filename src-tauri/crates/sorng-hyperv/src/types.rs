//! Shared types for the Hyper-V management crate.
//!
//! Covers VM configuration, state enums, checkpoint / snapshot info,
//! virtual switch & adapter definitions, VHD / VHDX metadata,
//! resource metrics, replication state, and Tauri events.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ─── VM State ────────────────────────────────────────────────────────

/// Runtime state of a Hyper-V virtual machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum VmState {
    Off,
    Running,
    Paused,
    Saved,
    Starting,
    Stopping,
    Saving,
    Pausing,
    Resuming,
    Reset,
    /// A state we didn't map yet.
    Other,
}

impl Default for VmState {
    fn default() -> Self {
        Self::Off
    }
}

impl VmState {
    /// Parse from the integer representation returned by Hyper-V WMI.
    pub fn from_wmi_state(n: u32) -> Self {
        match n {
            2 => Self::Running,
            3 => Self::Off,
            6 => Self::Paused, // offline
            9 => Self::Paused,
            32768 => Self::Paused,
            32769 => Self::Saved,
            32770 => Self::Starting,
            32771 => Self::Saving,
            32772 => Self::Stopping,
            32773 => Self::Pausing,
            32774 => Self::Resuming,
            _ => Self::Other,
        }
    }

    /// Parse from the string representation returned by Get-VM.
    pub fn from_ps_string(s: &str) -> Self {
        match s.trim() {
            "Off" => Self::Off,
            "Running" => Self::Running,
            "Paused" => Self::Paused,
            "Saved" => Self::Saved,
            "Starting" => Self::Starting,
            "Stopping" => Self::Stopping,
            "Saving" => Self::Saving,
            "Pausing" => Self::Pausing,
            "Resuming" => Self::Resuming,
            "Reset" => Self::Reset,
            _ => Self::Other,
        }
    }
}

// ─── VM Generation ───────────────────────────────────────────────────

/// Hyper-V VM generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VmGeneration {
    Gen1 = 1,
    Gen2 = 2,
}

impl Default for VmGeneration {
    fn default() -> Self {
        Self::Gen2
    }
}

// ─── Boot Device ─────────────────────────────────────────────────────

/// Boot device type for Hyper-V VM.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum BootDevice {
    VHD,
    CD,
    IDE,
    LegacyNetworkAdapter,
    NetworkAdapter,
    Floppy,
}

impl Default for BootDevice {
    fn default() -> Self {
        Self::VHD
    }
}

// ─── Automatic Start / Stop Actions ─────────────────────────────────

/// Action when host starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AutoStartAction {
    Nothing,
    StartIfRunning,
    Start,
}

impl Default for AutoStartAction {
    fn default() -> Self {
        Self::Nothing
    }
}

/// Action when host stops.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AutoStopAction {
    TurnOff,
    Save,
    Shutdown,
}

impl Default for AutoStopAction {
    fn default() -> Self {
        Self::Save
    }
}

// ─── Checkpoint Type ─────────────────────────────────────────────────

/// Hyper-V checkpoint (snapshot) type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckpointType {
    Disabled,
    Production,
    ProductionOnly,
    Standard,
}

impl Default for CheckpointType {
    fn default() -> Self {
        Self::Production
    }
}

// ─── Memory Configuration ────────────────────────────────────────────

/// Dynamic memory configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicMemoryConfig {
    /// Enable dynamic memory.
    pub enabled: bool,
    /// Minimum memory in MB.
    pub minimum_mb: u64,
    /// Maximum memory in MB.
    pub maximum_mb: u64,
    /// Startup memory in MB.
    pub startup_mb: u64,
    /// Buffer percentage (0-100).
    #[serde(default = "default_buffer_pct")]
    pub buffer_percentage: u32,
    /// Memory priority (0-100).
    #[serde(default = "default_memory_priority")]
    pub priority: u32,
}

fn default_buffer_pct() -> u32 {
    20
}
fn default_memory_priority() -> u32 {
    50
}

impl Default for DynamicMemoryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            minimum_mb: 512,
            maximum_mb: 1_048_576, // 1 TB
            startup_mb: 1024,
            buffer_percentage: 20,
            priority: 50,
        }
    }
}

// ─── VM Creation Config ──────────────────────────────────────────────

/// Configuration for creating a new VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmCreateConfig {
    /// VM display name.
    pub name: String,
    /// Generation (1 or 2).
    #[serde(default)]
    pub generation: VmGeneration,
    /// Startup memory in MB.
    #[serde(default = "default_startup_mb")]
    pub memory_startup_mb: u64,
    /// Processor count.
    #[serde(default = "default_processor_count")]
    pub processor_count: u32,
    /// Optional path for VM files.
    #[serde(default)]
    pub path: Option<String>,
    /// Optional path to a VHD to attach.
    #[serde(default)]
    pub vhd_path: Option<String>,
    /// Create a new VHD of this size (GB) if no existing VHD.
    #[serde(default)]
    pub new_vhd_size_gb: Option<u64>,
    /// Virtual switch to connect to.
    #[serde(default)]
    pub switch_name: Option<String>,
    /// ISO path for CD/DVD.
    #[serde(default)]
    pub iso_path: Option<String>,
    /// Enable dynamic memory.
    #[serde(default)]
    pub dynamic_memory: Option<DynamicMemoryConfig>,
    /// Automatic start action.
    #[serde(default)]
    pub auto_start_action: AutoStartAction,
    /// Automatic start delay (seconds).
    #[serde(default)]
    pub auto_start_delay: u32,
    /// Automatic stop action.
    #[serde(default)]
    pub auto_stop_action: AutoStopAction,
    /// Notes / description.
    #[serde(default)]
    pub notes: Option<String>,
    /// Checkpoint type.
    #[serde(default)]
    pub checkpoint_type: CheckpointType,
    /// Enable Secure Boot (Gen2 only).
    #[serde(default = "default_true")]
    pub secure_boot: bool,
    /// Enable TPM (Gen2 only).
    #[serde(default)]
    pub enable_tpm: bool,
}

fn default_startup_mb() -> u64 {
    1024
}
fn default_processor_count() -> u32 {
    2
}
fn default_true() -> bool {
    true
}

// ─── VM Update Config ────────────────────────────────────────────────

/// Configuration for updating an existing VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmUpdateConfig {
    /// New display name.
    #[serde(default)]
    pub name: Option<String>,
    /// Processor count.
    #[serde(default)]
    pub processor_count: Option<u32>,
    /// Startup memory in MB.
    #[serde(default)]
    pub memory_startup_mb: Option<u64>,
    /// Dynamic memory settings.
    #[serde(default)]
    pub dynamic_memory: Option<DynamicMemoryConfig>,
    /// Automatic start action.
    #[serde(default)]
    pub auto_start_action: Option<AutoStartAction>,
    /// Automatic start delay.
    #[serde(default)]
    pub auto_start_delay: Option<u32>,
    /// Automatic stop action.
    #[serde(default)]
    pub auto_stop_action: Option<AutoStopAction>,
    /// Notes / description.
    #[serde(default)]
    pub notes: Option<String>,
    /// Checkpoint type.
    #[serde(default)]
    pub checkpoint_type: Option<CheckpointType>,
    /// Enable Secure Boot.
    #[serde(default)]
    pub secure_boot: Option<bool>,
    /// Enable TPM.
    #[serde(default)]
    pub enable_tpm: Option<bool>,
    /// Lock on disconnect.
    #[serde(default)]
    pub lock_on_disconnect: Option<bool>,
}

// ─── VM Info ─────────────────────────────────────────────────────────

/// Full information about a virtual machine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmInfo {
    /// VM unique identifier (GUID).
    pub id: String,
    /// Display name.
    pub name: String,
    /// Current state.
    pub state: VmState,
    /// Status string (e.g. "Operating normally").
    #[serde(default)]
    pub status: String,
    /// Generation (1 or 2).
    pub generation: u32,
    /// VM version.
    #[serde(default)]
    pub version: String,
    /// Path to VM configuration files.
    #[serde(default)]
    pub path: String,
    /// Number of processors.
    pub processor_count: u32,
    /// Assigned memory in bytes.
    pub memory_assigned: u64,
    /// Startup memory in bytes.
    pub memory_startup: u64,
    /// Dynamic memory minimum in bytes.
    #[serde(default)]
    pub memory_minimum: u64,
    /// Dynamic memory maximum in bytes.
    #[serde(default)]
    pub memory_maximum: u64,
    /// Whether dynamic memory is enabled.
    pub dynamic_memory_enabled: bool,
    /// Uptime (as human-readable string from PS).
    #[serde(default)]
    pub uptime: String,
    /// Uptime in seconds.
    #[serde(default)]
    pub uptime_seconds: u64,
    /// Integration services version.
    #[serde(default)]
    pub integration_services_version: String,
    /// Integration services state.
    #[serde(default)]
    pub integration_services_state: String,
    /// Automatic start action.
    #[serde(default)]
    pub auto_start_action: String,
    /// Automatic start delay.
    #[serde(default)]
    pub auto_start_delay: u32,
    /// Automatic stop action.
    #[serde(default)]
    pub auto_stop_action: String,
    /// Checkpoint type.
    #[serde(default)]
    pub checkpoint_type: String,
    /// Whether the VM has checkpoints.
    #[serde(default)]
    pub has_checkpoints: bool,
    /// Parent checkpoint ID.
    #[serde(default)]
    pub parent_checkpoint_id: Option<String>,
    /// Parent checkpoint name.
    #[serde(default)]
    pub parent_checkpoint_name: Option<String>,
    /// Notes.
    #[serde(default)]
    pub notes: String,
    /// Creation time.
    #[serde(default)]
    pub creation_time: Option<DateTime<Utc>>,
    /// Replication state.
    #[serde(default)]
    pub replication_state: String,
    /// Replication mode.
    #[serde(default)]
    pub replication_mode: String,
    /// Whether Secure Boot is on (Gen2).
    #[serde(default)]
    pub secure_boot_enabled: bool,
    /// Attached network adapters.
    #[serde(default)]
    pub network_adapters: Vec<VmNetworkAdapterInfo>,
    /// Attached hard drives.
    #[serde(default)]
    pub hard_drives: Vec<VmHardDriveInfo>,
    /// DVD drives.
    #[serde(default)]
    pub dvd_drives: Vec<VmDvdDriveInfo>,
}

/// Summary for quick listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmSummary {
    pub id: String,
    pub name: String,
    pub state: VmState,
    pub status: String,
    pub processor_count: u32,
    pub memory_assigned: u64,
    pub uptime: String,
    pub generation: u32,
    pub has_checkpoints: bool,
    pub replication_state: String,
}

// ─── Network Adapter ─────────────────────────────────────────────────

/// Information about a VM network adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmNetworkAdapterInfo {
    /// Adapter name.
    pub name: String,
    /// Connected switch name.
    #[serde(default)]
    pub switch_name: Option<String>,
    /// MAC address.
    #[serde(default)]
    pub mac_address: String,
    /// Whether MAC is dynamic.
    #[serde(default)]
    pub dynamic_mac_address: bool,
    /// VLAN ID (0 = untagged).
    #[serde(default)]
    pub vlan_id: u32,
    /// Whether VLAN access mode is set.
    #[serde(default)]
    pub vlan_enabled: bool,
    /// IP addresses reported by integration services.
    #[serde(default)]
    pub ip_addresses: Vec<String>,
    /// Adapter status.
    #[serde(default)]
    pub status: String,
    /// Bandwidth setting (weight).
    #[serde(default)]
    pub bandwidth_weight: u32,
    /// Whether DHCP guard is enabled.
    #[serde(default)]
    pub dhcp_guard: bool,
    /// Whether router guard is enabled.
    #[serde(default)]
    pub router_guard: bool,
    /// Whether MAC spoofing is allowed.
    #[serde(default)]
    pub mac_address_spoofing: bool,
    /// Whether port mirroring is enabled.
    #[serde(default)]
    pub port_mirroring_mode: String,
}

/// Configuration for adding a network adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddNetworkAdapterConfig {
    /// Adapter name.
    #[serde(default = "default_adapter_name")]
    pub name: String,
    /// Switch to connect to.
    #[serde(default)]
    pub switch_name: Option<String>,
    /// Static MAC address (None = dynamic).
    #[serde(default)]
    pub static_mac_address: Option<String>,
    /// VLAN ID to assign.
    #[serde(default)]
    pub vlan_id: Option<u32>,
    /// Enable DHCP guard.
    #[serde(default)]
    pub dhcp_guard: bool,
    /// Enable router guard.
    #[serde(default)]
    pub router_guard: bool,
    /// Allow MAC spoofing.
    #[serde(default)]
    pub mac_address_spoofing: bool,
    /// Bandwidth weight (0-100).
    #[serde(default)]
    pub bandwidth_weight: Option<u32>,
}

fn default_adapter_name() -> String {
    "Network Adapter".to_string()
}

// ─── Virtual Hard Drive ──────────────────────────────────────────────

/// Information about an attached VM hard drive.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmHardDriveInfo {
    /// Controller type (IDE / SCSI).
    pub controller_type: String,
    /// Controller number.
    pub controller_number: u32,
    /// Controller location.
    pub controller_location: u32,
    /// Path to the VHD/VHDX.
    pub path: String,
    /// Disk type (Fixed / Dynamic / Differencing).
    #[serde(default)]
    pub vhd_type: String,
    /// Current file size in bytes.
    #[serde(default)]
    pub file_size: u64,
    /// Maximum VHD size in bytes.
    #[serde(default)]
    pub max_size: u64,
}

/// Information about a VM DVD drive.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmDvdDriveInfo {
    /// Controller number.
    pub controller_number: u32,
    /// Controller location.
    pub controller_location: u32,
    /// Path to mounted ISO.
    #[serde(default)]
    pub path: Option<String>,
}

// ─── VHD Types ───────────────────────────────────────────────────────

/// VHD disk format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VhdFormat {
    VHD,
    VHDX,
    VHDSet,
}

impl Default for VhdFormat {
    fn default() -> Self {
        Self::VHDX
    }
}

/// VHD disk type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VhdType {
    Fixed,
    Dynamic,
    Differencing,
}

impl Default for VhdType {
    fn default() -> Self {
        Self::Dynamic
    }
}

/// Configuration for creating a new VHD.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VhdCreateConfig {
    /// Full path for the new VHD file.
    pub path: String,
    /// Size in GB.
    pub size_gb: u64,
    /// Disk format.
    #[serde(default)]
    pub format: VhdFormat,
    /// Disk type.
    #[serde(default)]
    pub vhd_type: VhdType,
    /// Block size in MB (VHDX only, 0 = default).
    #[serde(default)]
    pub block_size_mb: u32,
    /// Logical sector size (512 or 4096).
    #[serde(default)]
    pub logical_sector_size: u32,
    /// Physical sector size (512 or 4096).
    #[serde(default)]
    pub physical_sector_size: u32,
    /// Parent path for differencing disks.
    #[serde(default)]
    pub parent_path: Option<String>,
}

/// Full VHD information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VhdInfo {
    /// File path.
    pub path: String,
    /// File format (VHD / VHDX / VHDSet).
    pub format: String,
    /// Disk type (Fixed / Dynamic / Differencing).
    pub vhd_type: String,
    /// Current file size in bytes.
    pub file_size: u64,
    /// Maximum virtual size in bytes.
    pub max_internal_size: u64,
    /// Minimum virtual size in bytes (for shrink).
    #[serde(default)]
    pub minimum_size: u64,
    /// Block size in bytes.
    #[serde(default)]
    pub block_size: u64,
    /// Logical sector size.
    #[serde(default)]
    pub logical_sector_size: u32,
    /// Physical sector size.
    #[serde(default)]
    pub physical_sector_size: u32,
    /// Parent path (differencing).
    #[serde(default)]
    pub parent_path: Option<String>,
    /// Fragmentation percentage.
    #[serde(default)]
    pub fragmentation_percentage: u32,
    /// Attached to VM name.
    #[serde(default)]
    pub attached_to: Option<String>,
    /// Whether the VHD is currently attached.
    #[serde(default)]
    pub is_attached: bool,
    /// Disk identifier.
    #[serde(default)]
    pub disk_identifier: String,
}

/// Configuration for resizing a VHD.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VhdResizeConfig {
    /// VHD file path.
    pub path: String,
    /// New size in GB.
    pub size_gb: u64,
}

/// Configuration for converting a VHD.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VhdConvertConfig {
    /// Source VHD path.
    pub source_path: String,
    /// Destination path.
    pub destination_path: String,
    /// Target format.
    pub format: VhdFormat,
    /// Target type.
    #[serde(default)]
    pub vhd_type: VhdType,
}

// ─── Virtual Switch ──────────────────────────────────────────────────

/// Virtual switch type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum SwitchType {
    Internal,
    External,
    Private,
}

impl Default for SwitchType {
    fn default() -> Self {
        Self::Internal
    }
}

/// Virtual switch information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualSwitchInfo {
    /// Switch ID.
    pub id: String,
    /// Switch name.
    pub name: String,
    /// Switch type.
    pub switch_type: String,
    /// Bound physical adapter (for External switches).
    #[serde(default)]
    pub net_adapter_name: Option<String>,
    /// Whether management OS uses the switch.
    #[serde(default)]
    pub allow_management_os: bool,
    /// Embedded teaming enabled.
    #[serde(default)]
    pub embedded_teaming_enabled: bool,
    /// IOV support.
    #[serde(default)]
    pub iov_enabled: bool,
    /// Bandwidth mode.
    #[serde(default)]
    pub bandwidth_mode: String,
    /// Notes.
    #[serde(default)]
    pub notes: String,
}

/// Configuration for creating a virtual switch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSwitchConfig {
    /// Switch name.
    pub name: String,
    /// Switch type.
    pub switch_type: SwitchType,
    /// Physical adapter for External switch.
    #[serde(default)]
    pub net_adapter_name: Option<String>,
    /// Allow management OS to use External switch.
    #[serde(default = "default_true")]
    pub allow_management_os: bool,
    /// Enable embedded teaming (SET).
    #[serde(default)]
    pub enable_embedded_teaming: bool,
    /// Enable IOV.
    #[serde(default)]
    pub enable_iov: bool,
    /// Notes.
    #[serde(default)]
    pub notes: Option<String>,
}

// ─── Snapshot / Checkpoint ───────────────────────────────────────────

/// Checkpoint information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointInfo {
    /// Checkpoint ID.
    pub id: String,
    /// Checkpoint name.
    pub name: String,
    /// VM name.
    pub vm_name: String,
    /// VM ID.
    pub vm_id: String,
    /// Parent checkpoint ID.
    #[serde(default)]
    pub parent_checkpoint_id: Option<String>,
    /// Parent checkpoint name.
    #[serde(default)]
    pub parent_checkpoint_name: Option<String>,
    /// Checkpoint type.
    pub checkpoint_type: String,
    /// Creation time.
    #[serde(default)]
    pub creation_time: Option<DateTime<Utc>>,
    /// Path to checkpoint files.
    #[serde(default)]
    pub path: String,
    /// Snapshot file size.
    #[serde(default)]
    pub snapshot_file_size: u64,
}

/// Configuration for creating a checkpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckpointConfig {
    /// Name for the new checkpoint.
    #[serde(default)]
    pub name: Option<String>,
    /// Checkpoint type override.
    #[serde(default)]
    pub checkpoint_type: Option<CheckpointType>,
}

// ─── Replication ─────────────────────────────────────────────────────

/// Replication mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReplicationMode {
    None,
    Primary,
    Replica,
    TestReplica,
    ExtendedReplica,
}

impl Default for ReplicationMode {
    fn default() -> Self {
        Self::None
    }
}

/// Replication state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReplicationState {
    Disabled,
    ReadyForInitialReplication,
    InitialReplicationInProgress,
    WaitingForInitialReplication,
    Replicating,
    Resynchronizing,
    ResynchronizeSuspended,
    FailOverWaitingCompletion,
    FailedOver,
    Suspended,
    Error,
    WaitingForStartResynchronize,
    WaitingForUpdateCompletion,
}

impl Default for ReplicationState {
    fn default() -> Self {
        Self::Disabled
    }
}

/// Authentication type for replication.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReplicationAuthType {
    Kerberos,
    Certificate,
}

impl Default for ReplicationAuthType {
    fn default() -> Self {
        Self::Kerberos
    }
}

/// Replication frequency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReplicationFrequency {
    Seconds30  = 30,
    Minutes5   = 300,
    Minutes15  = 900,
}

impl Default for ReplicationFrequency {
    fn default() -> Self {
        Self::Minutes5
    }
}

/// Full replication information for a VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmReplicationInfo {
    /// VM name.
    pub vm_name: String,
    /// VM ID.
    pub vm_id: String,
    /// Replication mode.
    pub mode: String,
    /// Replication state.
    pub state: String,
    /// Replication health.
    pub health: String,
    /// Primary server.
    #[serde(default)]
    pub primary_server: String,
    /// Replica server.
    #[serde(default)]
    pub replica_server: String,
    /// Replication frequency (seconds).
    #[serde(default)]
    pub frequency_seconds: u32,
    /// Authentication type.
    #[serde(default)]
    pub auth_type: String,
    /// Last replication time.
    #[serde(default)]
    pub last_replication_time: Option<DateTime<Utc>>,
    /// Last replication type.
    #[serde(default)]
    pub last_replication_type: String,
    /// Average replication size.
    #[serde(default)]
    pub avg_replication_size: u64,
    /// Maximum replication size.
    #[serde(default)]
    pub max_replication_size: u64,
    /// Number of recovery points.
    #[serde(default)]
    pub recovery_point_count: u32,
    /// Missed replication count.
    #[serde(default)]
    pub missed_replication_count: u32,
    /// Included VHD paths.
    #[serde(default)]
    pub included_disks: Vec<String>,
    /// Excluded VHD paths.
    #[serde(default)]
    pub excluded_disks: Vec<String>,
}

/// Configuration for enabling replication.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnableReplicationConfig {
    /// Replica server hostname.
    pub replica_server: String,
    /// Replica server port.
    #[serde(default = "default_replica_port")]
    pub replica_server_port: u16,
    /// Authentication type.
    #[serde(default)]
    pub auth_type: ReplicationAuthType,
    /// Certificate thumbprint (for certificate auth).
    #[serde(default)]
    pub certificate_thumbprint: Option<String>,
    /// Replication frequency.
    #[serde(default)]
    pub frequency: ReplicationFrequency,
    /// Number of recovery points to keep.
    #[serde(default = "default_recovery_points")]
    pub recovery_history: u32,
    /// VHD paths to include (empty = all).
    #[serde(default)]
    pub included_disks: Vec<String>,
    /// Compression enabled.
    #[serde(default = "default_true")]
    pub compression_enabled: bool,
    /// Enable VSS snapshots on replica.
    #[serde(default)]
    pub enable_vss: bool,
    /// VSS frequency (hours).
    #[serde(default = "default_vss_freq")]
    pub vss_frequency_hours: u32,
    /// Auto-resynchronize.
    #[serde(default = "default_true")]
    pub auto_resynchronize: bool,
}

fn default_replica_port() -> u16 {
    80
}
fn default_recovery_points() -> u32 {
    12
}
fn default_vss_freq() -> u32 {
    4
}

// ─── Metrics ─────────────────────────────────────────────────────────

/// VM resource metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmMetrics {
    /// VM name.
    pub vm_name: String,
    /// VM ID.
    pub vm_id: String,
    /// CPU usage (percentage, 0-100).
    pub cpu_usage: f64,
    /// Memory assigned in MB.
    pub memory_assigned_mb: u64,
    /// Memory demand in MB.
    pub memory_demand_mb: u64,
    /// Memory status.
    pub memory_status: String,
    /// Average memory pressure.
    pub avg_memory_pressure: f64,
    /// Disk read bytes/sec.
    pub disk_read_bytes_per_sec: u64,
    /// Disk write bytes/sec.
    pub disk_write_bytes_per_sec: u64,
    /// Network ingress bytes/sec.
    pub network_in_bytes_per_sec: u64,
    /// Network egress bytes/sec.
    pub network_out_bytes_per_sec: u64,
    /// Total disk size in bytes.
    pub total_disk_size: u64,
    /// Timestamp.
    pub timestamp: DateTime<Utc>,
}

/// Hyper-V host capacity information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    /// Hostname.
    pub hostname: String,
    /// Total logical processors.
    pub logical_processor_count: u32,
    /// Total physical memory in bytes.
    pub total_memory: u64,
    /// Available memory in bytes.
    pub available_memory: u64,
    /// Number of VMs.
    pub vm_count: u32,
    /// Number of running VMs.
    pub running_vm_count: u32,
    /// Hyper-V version.
    pub hyperv_version: String,
    /// Whether NUMA spanning is enabled.
    #[serde(default)]
    pub numa_spanning_enabled: bool,
    /// Whether live migration is enabled.
    #[serde(default)]
    pub live_migration_enabled: bool,
    /// Maximum simultaneous live migrations.
    #[serde(default)]
    pub max_live_migrations: u32,
    /// Maximum simultaneous storage migrations.
    #[serde(default)]
    pub max_storage_migrations: u32,
    /// Virtual hard disk path.
    #[serde(default)]
    pub virtual_hard_disk_path: String,
    /// Virtual machine path.
    #[serde(default)]
    pub virtual_machine_path: String,
}

/// Integration services component.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationServiceInfo {
    /// Service name.
    pub name: String,
    /// Whether the service is enabled.
    pub enabled: bool,
    /// Whether the service is primary status OK.
    #[serde(default)]
    pub primary_status_ok: bool,
    /// Secondary status description.
    #[serde(default)]
    pub secondary_status: String,
}

// ─── VM Export / Import ──────────────────────────────────────────────

/// Configuration for exporting a VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmExportConfig {
    /// Destination directory.
    pub path: String,
    /// Whether to include snapshots.
    #[serde(default = "default_true")]
    pub include_snapshots: bool,
}

/// Configuration for importing a VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmImportConfig {
    /// Path to the VM configuration file (XML or VMCX).
    pub path: String,
    /// Copy the VM instead of registering in-place.
    #[serde(default)]
    pub copy: bool,
    /// Generate a new VM ID.
    #[serde(default)]
    pub generate_new_id: bool,
    /// Target VHD storage path.
    #[serde(default)]
    pub vhd_destination_path: Option<String>,
    /// Target VM path.
    #[serde(default)]
    pub virtual_machine_path: Option<String>,
}

// ─── Live Migration ──────────────────────────────────────────────────

/// Configuration for live-migrating a VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveMigrationConfig {
    /// Target host.
    pub destination_host: String,
    /// Destination storage path.
    #[serde(default)]
    pub destination_storage_path: Option<String>,
    /// Include storage in migration.
    #[serde(default)]
    pub include_storage: bool,
}

// ─── Physical Network Adapters ───────────────────────────────────────

/// Physical network adapter summary (for External switch creation).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalAdapterInfo {
    /// Adapter name.
    pub name: String,
    /// Interface description.
    pub description: String,
    /// MAC address.
    pub mac_address: String,
    /// Status (Up / Down).
    pub status: String,
    /// Link speed.
    pub link_speed: String,
}

// ─── Hyper-V Service Config ──────────────────────────────────────────

/// Configuration for the Hyper-V service.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HyperVConfig {
    /// PowerShell executable path.
    #[serde(default = "default_pwsh_path")]
    pub powershell_path: String,
    /// Default operation timeout in seconds.
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
    /// Maximum concurrent operations.
    #[serde(default = "default_max_ops")]
    pub max_concurrent_ops: usize,
    /// Target hostname (empty = localhost).
    #[serde(default)]
    pub target_host: String,
    /// Credential for remote management.
    #[serde(default)]
    pub credential: Option<HyperVCredential>,
}

/// Credential for remote Hyper-V host management.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HyperVCredential {
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub domain: Option<String>,
}

fn default_pwsh_path() -> String {
    "powershell.exe".to_string()
}
fn default_timeout() -> u64 {
    60
}
fn default_max_ops() -> usize {
    10
}

impl Default for HyperVConfig {
    fn default() -> Self {
        Self {
            powershell_path: default_pwsh_path(),
            timeout_seconds: 60,
            max_concurrent_ops: 10,
            target_host: String::new(),
            credential: None,
        }
    }
}
