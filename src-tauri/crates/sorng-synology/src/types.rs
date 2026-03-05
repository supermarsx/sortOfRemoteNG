//! Synology NAS data types.
//!
//! All types use `#[serde(rename_all = "camelCase")]` for TypeScript interop.

use serde::{Deserialize, Serialize};

// ── Generic DSM response wrappers ───────────────────────────────────

/// Top-level response from every DSM API call.
#[derive(Debug, Deserialize)]
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
    pub min_version: u32,
    #[serde(rename = "maxVersion")]
    pub max_version: u32,
    #[serde(rename = "requestFormat")]
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
    pub use_https: bool,
    pub insecure: bool,
    pub timeout_secs: u64,
    /// Optional 2FA code
    pub otp_code: Option<String>,
    /// Remembered device token (skip 2FA on subsequent logins)
    pub device_token: Option<String>,
    /// Personal access token (DSM 7.2+) — use instead of user/pass
    pub access_token: Option<String>,
}

/// Safe configuration (no secrets), suitable for UI display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynologyConfigSafe {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub use_https: bool,
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
    pub temperature_warn: Option<bool>,
    pub uptime: u64,
    pub version: String,
    pub version_string: String,
    pub cpu_clock_speed: Option<u32>,
    pub cpu_cores: Option<String>,
    pub cpu_family: Option<String>,
    pub cpu_vendor: Option<String>,
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
    pub user_load: f64,
    pub system_load: f64,
    pub other_load: Option<f64>,
    #[serde(rename = "15min_load")]
    pub fifteen_min_load: Option<f64>,
    #[serde(rename = "5min_load")]
    pub five_min_load: Option<f64>,
    #[serde(rename = "1min_load")]
    pub one_min_load: Option<f64>,
    pub device: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUtilization {
    pub total_real: u64,
    pub avail_real: u64,
    pub total_swap: u64,
    pub avail_swap: u64,
    pub cached: Option<u64>,
    pub buffer: Option<u64>,
    pub si_disk: Option<u64>,
    pub so_disk: Option<u64>,
    pub memory_size: Option<u64>,
    pub real_usage: Option<f64>,
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
    pub display_name: Option<String>,
    pub read_access: Option<u64>,
    pub write_access: Option<u64>,
    pub read_byte: Option<u64>,
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
    pub storage_pools: Vec<StoragePool>,
    pub ssd_caches: Vec<SsdCache>,
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
    pub size_total: u64,
    pub temp: Option<i32>,
    pub status: String,
    pub smart_status: Option<String>,
    pub disk_type: Option<String>,
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
    pub display_name: Option<String>,
    pub status: String,
    pub fs_type: Option<String>,
    pub size_total: u64,
    pub size_used: u64,
    pub size_free: u64,
    pub usage_percent: Option<f64>,
    pub pool_path: Option<String>,
    pub desc: Option<String>,
    pub container: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePool {
    pub id: String,
    pub status: String,
    pub raid_type: Option<String>,
    pub size_total: Option<u64>,
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
    pub read_hit: Option<f64>,
    pub disks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotSpare {
    pub disk_id: String,
    pub pool_id: Option<String>,
}

/// SMART data for a single disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartInfo {
    pub disk_id: String,
    pub disk_name: String,
    pub health_status: String,
    pub temperature: Option<i32>,
    pub power_on_hours: Option<u64>,
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
    pub lun_id: String,
    pub name: String,
    pub size: u64,
    pub status: String,
    pub used_size: Option<u64>,
    pub location: Option<String>,
    pub mapped_targets: Vec<String>,
}

/// iSCSI target
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IscsiTarget {
    pub target_id: String,
    pub name: String,
    pub iqn: String,
    pub status: String,
    pub max_sessions: Option<u32>,
    pub mapped_luns: Vec<String>,
}

// ── File Station ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStationInfo {
    pub hostname: String,
    pub is_manager: bool,
    pub support_sharing: bool,
    pub support_virtual_protocol: Option<String>,
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
    pub real_path: Option<String>,
    pub r#type: Option<String>,
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
    pub is_folder: bool,
    pub date_expired: Option<String>,
    pub date_available: Option<String>,
    pub status: String,
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
    pub dest_folder_path: Option<String>,
}

// ── Shared Folders ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedFolder {
    pub name: String,
    pub path: String,
    pub vol_path: Option<String>,
    pub desc: Option<String>,
    pub is_aclmode: Option<bool>,
    pub enable_recycle_bin: Option<bool>,
    pub encryption: Option<u32>,
    pub is_share_moving: Option<bool>,
    pub additional: Option<SharedFolderAdditional>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedFolderAdditional {
    pub real_path: Option<String>,
    pub owner: Option<FileOwner>,
    pub perm: Option<FilePerm>,
    pub mount_point_type: Option<String>,
    pub volume_status: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePermission {
    pub name: String,           // user or group name
    pub is_readonly: bool,
    pub is_writable: bool,
    pub is_deny: bool,
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
    pub link_speed: Option<String>,
    pub status: String,
    pub interface_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallRule {
    pub id: Option<String>,
    pub src_ip: String,
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
    pub send_notification: Option<bool>,
}

// ── Packages ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub status: String,       // "running", "stopped", "installed"
    pub is_uninstall_pages: Option<bool>,
    pub update_version: Option<String>,
    pub additional: Option<PackageAdditional>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageAdditional {
    pub description: Option<String>,
    pub maintainer: Option<String>,
    pub dsm_apps: Option<String>,
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
    pub service_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbConfig {
    pub enabled: bool,
    pub workgroup: Option<String>,
    pub description: Option<String>,
    pub min_protocol: Option<String>,
    pub max_protocol: Option<String>,
    pub enable_smb2: Option<bool>,
    pub enable_smb3: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NfsConfig {
    pub enabled: bool,
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
    pub finished_at: Option<String>,
    pub up_time: Option<u64>,
    pub cpu_percent: Option<f64>,
    pub memory_usage: Option<u64>,
    pub memory_limit: Option<u64>,
    pub ports: Vec<DockerPortBinding>,
    pub volumes: Vec<DockerVolumeMount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerPortBinding {
    pub container_port: u16,
    pub host_port: u16,
    pub protocol: String,
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
    pub virtual_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerRegistry {
    pub name: String,
    pub url: String,
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
    pub guest_id: String,
    pub guest_name: String,
    pub status: String,
    pub description: Option<String>,
    pub vcpu_num: u32,
    pub vram_size: u64,
    pub autorun: Option<bool>,
    pub storage_name: Option<String>,
    pub storage_size: Option<u64>,
    pub vnc_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmSnapshot {
    pub snap_id: String,
    pub desc: Option<String>,
    pub taken_at: Option<String>,
    pub lock: Option<bool>,
    pub parent_snap_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmNetwork {
    pub network_id: String,
    pub network_name: String,
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
    pub size_downloaded: u64,
    pub size_uploaded: Option<u64>,
    pub speed_download: Option<u64>,
    pub speed_upload: Option<u64>,
    pub percent_dn: Option<f64>,
    pub r#type: String,
    pub destination: Option<String>,
    pub uri: Option<String>,
    pub username: Option<String>,
    pub created_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadStationInfo {
    pub is_manager: bool,
    pub version: String,
    pub version_string: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadStationStats {
    pub speed_download: u64,
    pub speed_upload: u64,
    pub emule_speed_download: Option<u64>,
    pub emule_speed_upload: Option<u64>,
}

// ── Surveillance Station ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurveillanceInfo {
    pub version: SurveillanceVersion,
    pub camera_count: u32,
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
    pub status: u32,         // 1=normal, 0=disconnected, etc.
    pub enabled: bool,
    pub recording: Option<bool>,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    pub stream_path: Option<String>,
    pub snapshot_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: String,
    pub camera_id: u32,
    pub camera_name: Option<String>,
    pub start_time: String,
    pub stop_time: String,
    pub file_size: u64,
    pub event_type: Option<String>,
}

// ── Backup (Hyper Backup + Active Backup) ───────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupTaskInfo {
    pub task_id: u32,
    pub name: String,
    pub status: String,
    pub last_backup_time: Option<String>,
    pub next_backup_time: Option<String>,
    pub dest_type: Option<String>,
    pub dest_path: Option<String>,
    pub total_size: Option<u64>,
    pub transferred_size: Option<u64>,
    pub progress: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupVersion {
    pub version_id: u32,
    pub created_time: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveBackupDevice {
    pub device_id: u32,
    pub device_name: String,
    pub device_type: String,
    pub status: String,
    pub last_backup: Option<String>,
    pub agent_version: Option<String>,
    pub ip_address: Option<String>,
}

// ── Security ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityOverview {
    pub auto_block_enabled: bool,
    pub firewall_enabled: bool,
    pub https_enabled: bool,
    pub advisor_score: Option<u32>,
    pub blocked_ips: Vec<BlockedIp>,
    pub certificate_info: Option<CertificateInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedIp {
    pub ip: String,
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
    pub valid_from: String,
    pub valid_till: String,
    pub is_default: bool,
    pub is_broken: Option<bool>,
    pub signature_algorithm: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBlockConfig {
    pub enabled: bool,
    pub attempts: u32,
    pub within_minutes: u32,
    pub block_forever: bool,
    pub expire_minutes: Option<u32>,
}

// ── Hardware ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    pub fan_speed: Option<String>,      // "full_speed", "cool_mode", "quiet_mode"
    pub fan_speeds: Vec<FanInfo>,
    pub temperatures: Vec<TempSensor>,
    pub ups: Option<UpsInfo>,
    pub beep_enabled: Option<bool>,
    pub led_brightness: Option<u32>,
    pub power_schedule: Option<PowerSchedule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FanInfo {
    pub id: String,
    pub fan_speed: u32,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TempSensor {
    pub id: String,
    pub name: String,
    pub temperature: i32,
    pub warn_threshold: Option<i32>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsInfo {
    pub enabled: bool,
    pub model: Option<String>,
    pub status: String,
    pub battery_charge: Option<f64>,
    pub load_percent: Option<f64>,
    pub runtime_minutes: Option<u32>,
    pub server_type: Option<String>,  // "usb" or "snmp"
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
    pub log_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionEntry {
    pub time: String,
    pub ip: String,
    pub user: String,
    pub r#type: String,
    pub is_login: bool,
    pub success: bool,
}

// ── Notifications ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationConfig {
    pub email_enabled: bool,
    pub email_address: Option<String>,
    pub smtp_server: Option<String>,
    pub sms_enabled: bool,
    pub push_enabled: bool,
}

// ── Dashboard (aggregate) ───────────────────────────────────────────

/// Combined dashboard overview for the Synology NAS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynologyDashboard {
    pub dsm_info: Option<DsmInfo>,
    pub utilization: Option<SystemUtilization>,
    pub volumes: Vec<VolumeInfo>,
    pub disk_count: u32,
    pub package_count: u32,
    pub share_count: u32,
    pub user_count: u32,
    pub container_count: Option<u32>,
    pub vm_count: Option<u32>,
    pub camera_count: Option<u32>,
    pub recent_logs: Vec<LogEntry>,
}
