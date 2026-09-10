//! Synology NAS data types.
//!
//! All types use `#[serde(rename_all = "camelCase")]` for TypeScript interop.

pub use crate::scoped_files::{
    CameraSnapshot, FileOperation, FileShareLink, FileShareList, FileStationLogin, FileTaskReceipt,
    FileTaskStatus, FileTransferOutcome,
};
use serde::{Deserialize, Serialize};

// ── Generic DSM response wrappers ───────────────────────────────────

/// Top-level response from every DSM API call.
#[derive(Debug, Deserialize)]
#[serde(bound(deserialize = "T: Deserialize<'de>"))]
pub struct SynoResponse<T> {
    pub success: bool,
    #[serde(default)]
    pub data: Option<T>,
    #[serde(default)]
    pub error: Option<SynoApiError>,
}

/// Error block returned by DSM on failure.
#[derive(Debug, Clone, Deserialize)]
pub struct SynoApiError {
    pub code: i32,
    #[serde(default)]
    pub errors: Vec<serde_json::Value>,
}

/// Discovered API entry from `SYNO.API.Info`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiInfoEntry {
    pub path: String,
    #[serde(rename = "minVersion")]
    #[serde(alias = "min_version")]
    pub min_version: u32,
    #[serde(rename = "maxVersion")]
    #[serde(alias = "max_version")]
    pub max_version: u32,
    #[serde(rename = "requestFormat")]
    #[serde(alias = "request_format")]
    pub request_format: Option<String>,
}

// ── Connection / Config ─────────────────────────────────────────────

/// Connection configuration (contains credentials).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynologyConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    #[serde(alias = "use_https")]
    pub use_https: bool,
    pub insecure: bool,
    #[serde(alias = "timeout_secs")]
    pub timeout_secs: u64,
    /// Optional 2FA code
    #[serde(alias = "otp_code")]
    pub otp_code: Option<String>,
    /// Remembered device token (skip 2FA on subsequent logins)
    #[serde(alias = "device_token")]
    pub device_token: Option<String>,
    /// Legacy explicit SID reuse; not a verified personal-access-token flow.
    #[serde(alias = "access_token")]
    pub access_token: Option<String>,
}

/// Safe configuration (no secrets), suitable for UI display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynologyConfigSafe {
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(alias = "use_https")]
    pub use_https: bool,
    #[serde(alias = "dsm_version")]
    pub dsm_version: Option<String>,
    pub model: Option<String>,
}

/// Login result from `SYNO.API.Auth` login.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    pub sid: String,
    pub synotoken: Option<String>,
    pub did: Option<String>,
}

// ── System ──────────────────────────────────────────────────────────

/// DSM system / NAS info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DsmInfo {
    pub model: String,
    pub ram: u64,
    pub serial: String,
    pub temperature: i32,
    #[serde(alias = "temperature_warn")]
    pub temperature_warn: Option<bool>,
    pub uptime: u64,
    pub version: String,
    #[serde(alias = "version_string")]
    pub version_string: String,
    #[serde(alias = "cpu_clock_speed")]
    pub cpu_clock_speed: Option<u32>,
    #[serde(alias = "cpu_cores")]
    pub cpu_cores: Option<String>,
    #[serde(alias = "cpu_family")]
    pub cpu_family: Option<String>,
    #[serde(alias = "cpu_vendor")]
    pub cpu_vendor: Option<String>,
    #[serde(alias = "sys_temp")]
    pub sys_temp: Option<i32>,
}

/// Real-time utilization snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemUtilization {
    pub cpu: CpuUtilization,
    pub memory: MemoryUtilization,
    pub network: Vec<NetworkUtilization>,
    pub disk: Vec<DiskUtilization>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuUtilization {
    #[serde(alias = "user_load")]
    pub user_load: f64,
    #[serde(alias = "system_load")]
    pub system_load: f64,
    #[serde(alias = "other_load")]
    pub other_load: Option<f64>,
    #[serde(rename = "15min_load")]
    #[serde(alias = "fifteen_min_load")]
    pub fifteen_min_load: Option<f64>,
    #[serde(rename = "5min_load")]
    #[serde(alias = "five_min_load")]
    pub five_min_load: Option<f64>,
    #[serde(rename = "1min_load")]
    #[serde(alias = "one_min_load")]
    pub one_min_load: Option<f64>,
    pub device: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUtilization {
    #[serde(alias = "total_real")]
    pub total_real: u64,
    #[serde(alias = "avail_real")]
    pub avail_real: u64,
    #[serde(alias = "total_swap")]
    pub total_swap: u64,
    #[serde(alias = "avail_swap")]
    pub avail_swap: u64,
    pub cached: Option<u64>,
    pub buffer: Option<u64>,
    #[serde(alias = "si_disk")]
    pub si_disk: Option<u64>,
    #[serde(alias = "so_disk")]
    pub so_disk: Option<u64>,
    #[serde(alias = "memory_size")]
    pub memory_size: Option<u64>,
    #[serde(alias = "real_usage")]
    pub real_usage: Option<f64>,
    #[serde(alias = "swap_usage")]
    pub swap_usage: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkUtilization {
    pub device: String,
    pub rx: u64,
    pub tx: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUtilization {
    pub device: String,
    #[serde(alias = "display_name")]
    pub display_name: Option<String>,
    #[serde(alias = "read_access")]
    pub read_access: Option<u64>,
    #[serde(alias = "write_access")]
    pub write_access: Option<u64>,
    #[serde(alias = "read_byte")]
    pub read_byte: Option<u64>,
    #[serde(alias = "write_byte")]
    pub write_byte: Option<u64>,
    pub utilization: Option<f64>,
}

/// Running process entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub user: String,
    pub cpu: f64,
    pub memory: f64,
    pub threads: Option<u32>,
}

// ── Storage ─────────────────────────────────────────────────────────

/// Complete storage topology (from `load_info`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageOverview {
    pub disks: Vec<DiskInfo>,
    pub volumes: Vec<VolumeInfo>,
    #[serde(alias = "storage_pools")]
    pub storage_pools: Vec<StoragePool>,
    #[serde(alias = "ssd_caches")]
    pub ssd_caches: Vec<SsdCache>,
    #[serde(alias = "hot_spares")]
    pub hot_spares: Vec<HotSpare>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub id: String,
    pub name: String,
    pub device: String,
    pub model: String,
    pub vendor: Option<String>,
    pub serial: Option<String>,
    pub firmware: Option<String>,
    #[serde(alias = "size_total")]
    pub size_total: u64,
    pub temp: Option<i32>,
    pub status: String,
    #[serde(alias = "smart_status")]
    pub smart_status: Option<String>,
    #[serde(alias = "disk_type")]
    pub disk_type: Option<String>,
    #[serde(alias = "exceed_bad_sector_thr")]
    pub exceed_bad_sector_thr: Option<bool>,
    pub intf: Option<String>,
    pub container: Option<DiskContainer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskContainer {
    pub pool: Option<String>,
    pub volume: Option<String>,
    pub r#type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    pub id: String,
    #[serde(alias = "display_name")]
    pub display_name: Option<String>,
    pub status: String,
    #[serde(alias = "fs_type")]
    pub fs_type: Option<String>,
    #[serde(alias = "size_total")]
    pub size_total: u64,
    #[serde(alias = "size_used")]
    pub size_used: u64,
    #[serde(alias = "size_free")]
    pub size_free: u64,
    #[serde(alias = "usage_percent")]
    pub usage_percent: Option<f64>,
    #[serde(alias = "pool_path")]
    pub pool_path: Option<String>,
    pub desc: Option<String>,
    pub container: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePool {
    pub id: String,
    pub status: String,
    #[serde(alias = "raid_type")]
    pub raid_type: Option<String>,
    #[serde(alias = "size_total")]
    pub size_total: Option<u64>,
    #[serde(alias = "size_used")]
    pub size_used: Option<u64>,
    pub disks: Vec<String>,
    pub desc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SsdCache {
    pub id: String,
    pub status: String,
    pub size: u64,
    #[serde(alias = "read_hit")]
    pub read_hit: Option<f64>,
    pub disks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotSpare {
    #[serde(alias = "disk_id")]
    pub disk_id: String,
    #[serde(alias = "pool_id")]
    pub pool_id: Option<String>,
}

/// SMART data for a single disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartInfo {
    #[serde(alias = "disk_id")]
    pub disk_id: String,
    #[serde(alias = "disk_name")]
    pub disk_name: String,
    #[serde(alias = "health_status")]
    pub health_status: String,
    pub temperature: Option<i32>,
    #[serde(alias = "power_on_hours")]
    pub power_on_hours: Option<u64>,
    #[serde(alias = "reallocated_sectors")]
    pub reallocated_sectors: Option<u64>,
    pub attributes: Vec<SmartAttribute>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartAttribute {
    pub id: u32,
    pub name: String,
    pub current: u64,
    pub worst: u64,
    pub threshold: u64,
    pub raw: String,
    pub status: String,
}

/// iSCSI LUN
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IscsiLun {
    #[serde(alias = "lun_id")]
    pub lun_id: String,
    pub name: String,
    pub size: u64,
    pub status: String,
    #[serde(alias = "used_size")]
    pub used_size: Option<u64>,
    pub location: Option<String>,
    #[serde(alias = "mapped_targets")]
    pub mapped_targets: Option<Vec<String>>,
}

/// iSCSI target
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IscsiTarget {
    #[serde(alias = "target_id")]
    pub target_id: String,
    pub name: String,
    pub iqn: String,
    pub status: String,
    #[serde(alias = "max_sessions")]
    pub max_sessions: Option<u32>,
    #[serde(alias = "mapped_luns")]
    pub mapped_luns: Vec<String>,
}

// ── File Station ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStationInfo {
    pub hostname: String,
    #[serde(alias = "is_manager")]
    pub is_manager: bool,
    #[serde(alias = "support_sharing")]
    pub support_sharing: bool,
    #[serde(alias = "support_virtual_protocol")]
    pub support_virtual_protocol: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileListItem {
    pub path: String,
    pub name: String,
    pub isdir: bool,
    pub additional: Option<FileAdditional>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAdditional {
    pub size: Option<u64>,
    pub time: Option<FileTime>,
    pub owner: Option<FileOwner>,
    pub perm: Option<FilePerm>,
    #[serde(alias = "real_path")]
    pub real_path: Option<String>,
    pub r#type: Option<String>,
    #[serde(alias = "mount_point_type")]
    pub mount_point_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTime {
    pub atime: Option<u64>,
    pub mtime: Option<u64>,
    pub ctime: Option<u64>,
    pub crtime: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileOwner {
    pub user: Option<String>,
    pub group: Option<String>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilePerm {
    pub posix: Option<u32>,
    pub acl: Option<serde_json::Value>,
    #[serde(alias = "is_acl_mode")]
    pub is_acl_mode: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileListResult {
    pub files: Vec<FileListItem>,
    pub total: u64,
    pub offset: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareLinkInfo {
    pub id: String,
    pub path: String,
    pub url: String,
    #[serde(alias = "is_folder")]
    pub is_folder: bool,
    #[serde(alias = "date_expired")]
    pub date_expired: Option<String>,
    #[serde(alias = "date_available")]
    pub date_available: Option<String>,
    pub status: String,
    #[serde(alias = "has_password")]
    pub has_password: bool,
}

/// Background task info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTask {
    pub taskid: String,
    pub finished: bool,
    pub progress: Option<f64>,
    pub path: Option<String>,
    #[serde(alias = "dest_folder_path")]
    pub dest_folder_path: Option<String>,
}

// ── Shared Folders ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedFolder {
    pub name: String,
    pub path: String,
    #[serde(alias = "vol_path")]
    pub vol_path: Option<String>,
    pub desc: Option<String>,
    #[serde(alias = "is_aclmode")]
    pub is_aclmode: Option<bool>,
    #[serde(alias = "enable_recycle_bin")]
    pub enable_recycle_bin: Option<bool>,
    pub encryption: Option<u32>,
    #[serde(alias = "is_share_moving")]
    pub is_share_moving: Option<bool>,
    pub additional: Option<SharedFolderAdditional>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedFolderAdditional {
    #[serde(alias = "real_path")]
    pub real_path: Option<String>,
    pub owner: Option<FileOwner>,
    pub perm: Option<FilePerm>,
    #[serde(alias = "mount_point_type")]
    pub mount_point_type: Option<String>,
    #[serde(alias = "volume_status")]
    pub volume_status: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePermission {
    pub name: String, // user or group name
    #[serde(alias = "is_readonly")]
    pub is_readonly: bool,
    #[serde(alias = "is_writable")]
    pub is_writable: bool,
    #[serde(alias = "is_deny")]
    pub is_deny: bool,
    #[serde(alias = "is_custom")]
    pub is_custom: Option<bool>,
}

// ── Network ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkOverview {
    pub hostname: String,
    pub workgroup: Option<String>,
    pub dns: Vec<String>,
    pub gateway: Option<String>,
    pub interfaces: Vec<NetworkInterface>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterface {
    pub id: String,
    pub name: Option<String>,
    pub mac: String,
    pub ip: Vec<String>,
    pub ipv6: Vec<String>,
    pub subnet: Option<String>,
    pub mtu: Option<u32>,
    #[serde(alias = "link_speed")]
    pub link_speed: Option<String>,
    pub status: String,
    #[serde(alias = "interface_type")]
    pub interface_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallRule {
    pub id: Option<String>,
    #[serde(alias = "src_ip")]
    pub src_ip: String,
    #[serde(alias = "src_port")]
    pub src_port: String,
    pub direction: String,
    pub action: String,
    pub protocol: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DhcpLease {
    pub hostname: String,
    pub mac: String,
    pub ip: String,
    pub expires: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VpnProfile {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub status: String,
    pub server: Option<String>,
}

// ── Users & Groups ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynoUser {
    pub name: String,
    pub uid: u32,
    pub description: Option<String>,
    pub email: Option<String>,
    pub expired: Option<String>,
    #[serde(alias = "enable_home_service")]
    pub enable_home_service: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynoGroup {
    pub name: String,
    pub gid: u32,
    pub description: Option<String>,
    pub members: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserQuota {
    pub user: String,
    pub share: String,
    #[serde(alias = "quota_value")]
    pub quota_value: u64,
    pub used: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserParams {
    pub name: String,
    pub password: String,
    pub description: Option<String>,
    pub email: Option<String>,
    #[serde(alias = "send_notification")]
    pub send_notification: Option<bool>,
    pub expired: Option<String>,
    #[serde(alias = "cannot_change_password")]
    pub cannot_change_password: bool,
}

// ── Packages ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub status: String, // "running", "stopped", "installed"
    #[serde(alias = "is_uninstall_pages")]
    pub is_uninstall_pages: Option<bool>,
    #[serde(alias = "update_version")]
    pub update_version: Option<String>,
    pub additional: Option<PackageAdditional>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageAdditional {
    pub description: Option<String>,
    pub maintainer: Option<String>,
    #[serde(alias = "dsm_apps")]
    pub dsm_apps: Option<String>,
    #[serde(alias = "dsm_app_page")]
    pub dsm_app_page: Option<String>,
}

// ── Services ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub running: bool,
    pub port: Option<u16>,
    #[serde(alias = "service_type")]
    pub service_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbConfig {
    pub enabled: bool,
    pub workgroup: Option<String>,
    pub description: Option<String>,
    #[serde(alias = "min_protocol")]
    pub min_protocol: Option<String>,
    #[serde(alias = "max_protocol")]
    pub max_protocol: Option<String>,
    #[serde(alias = "enable_smb2")]
    pub enable_smb2: Option<bool>,
    #[serde(alias = "enable_smb3")]
    pub enable_smb3: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NfsConfig {
    pub enabled: bool,
    #[serde(alias = "enable_nfs_v4")]
    pub enable_nfs_v4: Option<bool>,
    pub domain: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub enabled: bool,
    pub port: u16,
}

// ── Docker / Container Manager ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub created: Option<String>,
    #[serde(alias = "finished_at")]
    pub finished_at: Option<String>,
    #[serde(alias = "up_time")]
    pub up_time: Option<u64>,
    #[serde(alias = "cpu_percent")]
    pub cpu_percent: Option<f64>,
    #[serde(alias = "memory_usage")]
    pub memory_usage: Option<u64>,
    #[serde(alias = "memory_limit")]
    pub memory_limit: Option<u64>,
    pub ports: Vec<DockerPortBinding>,
    pub volumes: Vec<DockerVolumeMount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerPortBinding {
    #[serde(alias = "container_port")]
    pub container_port: u16,
    #[serde(alias = "host_port")]
    pub host_port: u16,
    pub protocol: String,
    #[serde(alias = "host_ip")]
    pub host_ip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerVolumeMount {
    pub source: String,
    pub destination: String,
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerImage {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub created: Option<String>,
    pub size: u64,
    #[serde(alias = "virtual_size")]
    pub virtual_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerRegistry {
    pub name: String,
    pub url: String,
    #[serde(alias = "enable_registry_mirror")]
    pub enable_registry_mirror: Option<bool>,
    pub username: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerNetwork {
    pub name: String,
    pub id: String,
    pub driver: String,
    pub scope: String,
    pub subnet: Option<String>,
    pub gateway: Option<String>,
    pub containers: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerProject {
    pub name: String,
    pub status: String,
    pub services: Vec<String>,
    pub path: Option<String>,
}

// ── Virtualization (VMM) ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmGuest {
    #[serde(alias = "guest_id")]
    pub guest_id: String,
    #[serde(alias = "guest_name")]
    pub guest_name: String,
    pub status: String,
    pub description: Option<String>,
    #[serde(alias = "vcpu_num")]
    pub vcpu_num: u32,
    #[serde(alias = "vram_size")]
    pub vram_size: u64,
    pub autorun: Option<bool>,
    #[serde(alias = "storage_name")]
    pub storage_name: Option<String>,
    #[serde(alias = "storage_size")]
    pub storage_size: Option<u64>,
    #[serde(alias = "vnc_port")]
    pub vnc_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmSnapshot {
    #[serde(alias = "snap_id")]
    pub snap_id: String,
    pub desc: Option<String>,
    #[serde(alias = "taken_at")]
    pub taken_at: Option<String>,
    pub lock: Option<bool>,
    #[serde(alias = "parent_snap_id")]
    pub parent_snap_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmNetwork {
    #[serde(alias = "network_id")]
    pub network_id: String,
    #[serde(alias = "network_name")]
    pub network_name: String,
    #[serde(alias = "vswitch_name")]
    pub vswitch_name: Option<String>,
    pub interface: Option<String>,
}

// ── Download Station ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub title: String,
    pub status: String,
    pub size: u64,
    #[serde(alias = "size_downloaded")]
    pub size_downloaded: u64,
    #[serde(alias = "size_uploaded")]
    pub size_uploaded: Option<u64>,
    #[serde(alias = "speed_download")]
    pub speed_download: Option<u64>,
    #[serde(alias = "speed_upload")]
    pub speed_upload: Option<u64>,
    #[serde(alias = "percent_dn")]
    pub percent_dn: Option<f64>,
    pub r#type: String,
    pub destination: Option<String>,
    pub uri: Option<String>,
    pub username: Option<String>,
    #[serde(alias = "created_time")]
    pub created_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadStationInfo {
    #[serde(alias = "is_manager")]
    pub is_manager: bool,
    pub version: String,
    #[serde(alias = "version_string")]
    pub version_string: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadStationStats {
    #[serde(alias = "speed_download")]
    pub speed_download: u64,
    #[serde(alias = "speed_upload")]
    pub speed_upload: u64,
    #[serde(alias = "emule_speed_download")]
    pub emule_speed_download: Option<u64>,
    #[serde(alias = "emule_speed_upload")]
    pub emule_speed_upload: Option<u64>,
}

// ── Surveillance Station ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurveillanceInfo {
    pub version: SurveillanceVersion,
    #[serde(alias = "camera_count")]
    pub camera_count: u32,
    #[serde(alias = "license_count")]
    pub license_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurveillanceVersion {
    pub major: u32,
    pub minor: u32,
    pub build: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Camera {
    pub id: u32,
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub model: Option<String>,
    pub vendor: Option<String>,
    pub status: u32, // 1=normal, 0=disconnected, etc.
    pub enabled: bool,
    pub recording: Option<bool>,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    #[serde(alias = "stream_path")]
    pub stream_path: Option<String>,
    #[serde(alias = "snapshot_path")]
    pub snapshot_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: String,
    #[serde(alias = "camera_id")]
    pub camera_id: u32,
    #[serde(alias = "camera_name")]
    pub camera_name: Option<String>,
    #[serde(alias = "start_time")]
    pub start_time: String,
    #[serde(alias = "stop_time")]
    pub stop_time: String,
    #[serde(alias = "file_size")]
    pub file_size: u64,
    #[serde(alias = "event_type")]
    pub event_type: Option<String>,
}

// ── Backup (Hyper Backup + Active Backup) ───────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupTaskInfo {
    #[serde(alias = "task_id")]
    pub task_id: u32,
    pub name: String,
    pub status: String,
    #[serde(alias = "last_backup_time")]
    pub last_backup_time: Option<String>,
    #[serde(alias = "next_backup_time")]
    pub next_backup_time: Option<String>,
    #[serde(alias = "dest_type")]
    pub dest_type: Option<String>,
    #[serde(alias = "dest_path")]
    pub dest_path: Option<String>,
    #[serde(alias = "total_size")]
    pub total_size: Option<u64>,
    #[serde(alias = "transferred_size")]
    pub transferred_size: Option<u64>,
    pub progress: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupVersion {
    #[serde(alias = "version_id")]
    pub version_id: u32,
    #[serde(alias = "created_time")]
    pub created_time: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveBackupDevice {
    #[serde(alias = "device_id")]
    pub device_id: u32,
    #[serde(alias = "device_name")]
    pub device_name: String,
    #[serde(alias = "device_type")]
    pub device_type: String,
    pub status: String,
    #[serde(alias = "last_backup")]
    pub last_backup: Option<String>,
    #[serde(alias = "agent_version")]
    pub agent_version: Option<String>,
    #[serde(alias = "ip_address")]
    pub ip_address: Option<String>,
}

// ── Security ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityOverview {
    #[serde(alias = "auto_block_enabled")]
    pub auto_block_enabled: bool,
    #[serde(alias = "firewall_enabled")]
    pub firewall_enabled: bool,
    #[serde(alias = "https_enabled")]
    pub https_enabled: bool,
    #[serde(alias = "advisor_score")]
    pub advisor_score: Option<u32>,
    #[serde(alias = "blocked_ips")]
    pub blocked_ips: Vec<BlockedIp>,
    #[serde(alias = "certificate_info")]
    pub certificate_info: Option<CertificateInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedIp {
    pub ip: String,
    #[serde(alias = "blocked_at")]
    pub blocked_at: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateInfo {
    pub id: String,
    pub desc: String,
    pub subject: serde_json::Value,
    pub issuer: serde_json::Value,
    #[serde(alias = "valid_from")]
    pub valid_from: String,
    #[serde(alias = "valid_till")]
    pub valid_till: String,
    #[serde(alias = "is_default")]
    pub is_default: bool,
    #[serde(alias = "is_broken")]
    pub is_broken: Option<bool>,
    #[serde(alias = "signature_algorithm")]
    pub signature_algorithm: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBlockConfig {
    pub enabled: bool,
    pub attempts: u32,
    #[serde(alias = "within_minutes")]
    pub within_minutes: u32,
    #[serde(alias = "block_forever")]
    pub block_forever: bool,
    #[serde(alias = "expire_minutes")]
    pub expire_minutes: Option<u32>,
}

// ── Hardware ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    #[serde(alias = "fan_speed")]
    pub fan_speed: Option<String>, // "full_speed", "cool_mode", "quiet_mode"
    #[serde(alias = "fan_speeds")]
    pub fan_speeds: Vec<FanInfo>,
    pub temperatures: Vec<TempSensor>,
    pub ups: Option<UpsInfo>,
    #[serde(alias = "beep_enabled")]
    pub beep_enabled: Option<bool>,
    #[serde(alias = "led_brightness")]
    pub led_brightness: Option<u32>,
    #[serde(alias = "power_schedule")]
    pub power_schedule: Option<PowerSchedule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FanInfo {
    pub id: String,
    #[serde(alias = "fan_speed")]
    pub fan_speed: u32,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TempSensor {
    pub id: String,
    pub name: String,
    pub temperature: i32,
    #[serde(alias = "warn_threshold")]
    pub warn_threshold: Option<i32>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsInfo {
    pub enabled: bool,
    pub model: Option<String>,
    pub status: String,
    #[serde(alias = "battery_charge")]
    pub battery_charge: Option<f64>,
    #[serde(alias = "load_percent")]
    pub load_percent: Option<f64>,
    #[serde(alias = "runtime_minutes")]
    pub runtime_minutes: Option<u32>,
    #[serde(alias = "server_type")]
    pub server_type: Option<String>, // "usb" or "snmp"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerSchedule {
    pub enabled: bool,
    pub entries: Vec<PowerScheduleEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerScheduleEntry {
    pub action: String,
    pub hour: u32,
    pub minute: u32,
    pub weekday: Vec<u32>,
    pub enabled: bool,
}

// ── Logs ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: u64,
    pub time: String,
    pub msg: String,
    pub level: String,
    pub user: Option<String>,
    pub event: Option<String>,
    #[serde(alias = "log_type")]
    pub log_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionEntry {
    pub time: String,
    pub ip: String,
    pub user: String,
    pub r#type: String,
    #[serde(alias = "is_login")]
    pub is_login: bool,
    pub success: bool,
}

// ── Notifications ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationConfig {
    #[serde(alias = "email_enabled")]
    pub email_enabled: bool,
    #[serde(alias = "email_address")]
    pub email_address: Option<String>,
    #[serde(alias = "smtp_server")]
    pub smtp_server: Option<String>,
    #[serde(alias = "sms_enabled")]
    pub sms_enabled: bool,
    #[serde(alias = "push_enabled")]
    pub push_enabled: bool,
}

// ── Dashboard (aggregate) ───────────────────────────────────────────

/// Combined dashboard overview for the Synology NAS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynologyDashboard {
    #[serde(alias = "system_info")]
    pub system_info: Option<DsmInfo>,
    pub utilization: Option<SystemUtilization>,
    pub storage: Option<StorageOverview>,
    pub network: Option<NetworkOverview>,
    pub hardware: Option<HardwareInfo>,
}
