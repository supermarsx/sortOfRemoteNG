// ─── Synology NAS Management Types ──────────────────────────────────────────

// ─── Config ─────────────────────────────────────────────────────
export interface SynologyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  useHttps: boolean;
  insecure: boolean;
  timeoutSecs: number;
  otpCode?: string;
  deviceToken?: string;
  accessToken?: string;
}

export interface SynologyConfigSafe {
  host: string;
  port: number;
  username: string;
  useHttps: boolean;
}

// ─── System ─────────────────────────────────────────────────────
export interface DsmInfo {
  model: string;
  ram?: number;
  serial?: string;
  temperature?: number;
  temperature_warn?: boolean;
  uptime?: number;
  version?: string;
  version_string: string;
  external_ip?: string;
  hostname?: string;
}

export interface SystemUtilization {
  cpu?: CpuUtilization;
  memory?: MemoryUtilization;
  network?: NetworkUtilization[];
  disk?: DiskUtilization[];
}

export interface CpuUtilization {
  one_min_load?: number;
  five_min_load?: number;
  fifteen_min_load?: number;
  system_load?: number;
  user_load?: number;
  other_load?: number;
}

export interface MemoryUtilization {
  total_real?: number;
  avail_real?: number;
  total_swap?: number;
  avail_swap?: number;
  cached?: number;
  buffer?: number;
  memory_size?: number;
}

export interface NetworkUtilization {
  device: string;
  rx: number;
  tx: number;
}

export interface DiskUtilization {
  device: string;
  display_name?: string;
  read_access?: number;
  write_access?: number;
  utilization?: number;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  user?: string;
  cpu?: number;
  mem?: number;
  threads?: number;
}

// ─── Storage ────────────────────────────────────────────────────
export interface StorageOverview {
  disks: DiskInfo[];
  volumes: VolumeInfo[];
  storage_pools: StoragePool[];
  ssd_caches: SsdCache[];
  hot_spares: HotSpare[];
}

export interface DiskInfo {
  id: string;
  name: string;
  vendor?: string;
  model?: string;
  firmware?: string;
  serial?: string;
  size_total?: number;
  temp?: number;
  status?: string;
  disk_type?: string;
  smart_status?: string;
  container?: DiskContainer;
}

export interface DiskContainer {
  type_field?: string;
  id?: string;
}

export interface VolumeInfo {
  id: string;
  status: string;
  fs_type?: string;
  size_total_bytes?: number;
  size_used_bytes?: number;
  size_free_bytes?: number;
  percentage_used?: number;
  desc?: string;
  pool_path?: string;
  crash_report?: string;
}

export interface StoragePool {
  id: string;
  status: string;
  raid_type?: string;
  size?: number;
  disks?: string[];
  can_do?: string[];
}

export interface SsdCache {
  id: string;
  status: string;
  size?: number;
  read_hit?: number;
  write_hit?: number;
}

export interface HotSpare {
  disk_id: string;
  status: string;
}

export interface SmartInfo {
  disk: string;
  health_status?: string;
  temperature?: number;
  attributes?: SmartAttribute[];
}

export interface SmartAttribute {
  id: number;
  name: string;
  current: number;
  worst: number;
  threshold: number;
  raw_value: string;
  status?: string;
}

export interface IscsiLun {
  uuid: string;
  name: string;
  status?: string;
  size?: number;
  used_size?: number;
  location?: string;
}

export interface IscsiTarget {
  target_id: string;
  name: string;
  iqn?: string;
  status?: string;
  mapped_luns?: string[];
}

// ─── File Station ───────────────────────────────────────────────
export interface FileStationInfo {
  hostname?: string;
  is_manager?: boolean;
  support_sharing?: boolean;
  support_virtual_protocol?: string;
}

export interface FileListResult {
  total: number;
  offset: number;
  files?: FileListItem[];
}

export interface FileListItem {
  path: string;
  name: string;
  isdir: boolean;
  additional?: FileAdditional;
}

export interface FileAdditional {
  size?: number;
  time?: FileTime;
  type_field?: string;
  perm?: FilePerm;
  owner?: FileOwner;
  real_path?: string;
}

export interface FileTime {
  atime?: number;
  mtime?: number;
  ctime?: number;
  crtime?: number;
}

export interface FileOwner {
  user?: string;
  group?: string;
  uid?: number;
  gid?: number;
}

export interface FilePerm {
  posix?: number;
  acl_enable?: boolean;
  is_acl_mode?: boolean;
  share_right?: string;
}

export interface ShareLinkInfo {
  id?: string;
  url?: string;
  link?: string;
  qrcode?: string;
  date_expired?: string;
  date_available?: string;
  status?: string;
  has_password?: boolean;
  path?: string;
}

export interface BackgroundTask {
  taskid: string;
  finished?: boolean;
  progress?: number;
  path?: string;
  dest_folder_path?: string;
}

// ─── Shared Folders ─────────────────────────────────────────────
export interface SharedFolder {
  name: string;
  path?: string;
  vol_path?: string;
  desc?: string;
  status?: string;
  encryption?: number;
  is_aclmode?: boolean;
  unite_permission?: boolean;
  additional?: SharedFolderAdditional;
}

export interface SharedFolderAdditional {
  volume_status?: Record<string, unknown>;
  encryption?: number;
  hidden?: boolean;
  recyclebin?: boolean;
}

export interface SharePermission {
  name: string;
  is_admin?: boolean;
  is_readonly?: boolean;
  is_writable?: boolean;
  is_deny?: boolean;
  is_custom?: boolean;
}

// ─── Network ────────────────────────────────────────────────────
export interface NetworkOverview {
  dns?: string[];
  gateway?: string;
  hostname?: string;
  workgroup?: string;
  interfaces?: NetworkInterface[];
}

export interface NetworkInterface {
  id: string;
  name?: string;
  ip?: string;
  mask?: string;
  mac?: string;
  type_field?: string;
  status?: string;
  ipv6?: string[];
  mtu?: number;
  speed?: number;
}

export interface FirewallRule {
  policy?: string;
  action?: string;
  protocol?: string;
  ports?: string;
  source_ip?: string;
  direction?: string;
  ruleType?: string;
  enabled?: boolean;
  enable?: boolean;
}

export interface DhcpLease {
  hostname?: string;
  ip?: string;
  mac?: string;
  expire?: string;
  iface?: string;
}

export interface VpnProfile {
  id: string;
  name?: string;
  protocol?: string;
  server?: string;
  status?: string;
}

// ─── Users & Groups ─────────────────────────────────────────────
export interface SynoUser {
  name: string;
  uid?: number;
  description?: string;
  email?: string;
  expired?: string;
  is_admin?: boolean;
}

export interface SynoGroup {
  name: string;
  gid?: number;
  description?: string;
  members?: string[];
}

export interface UserQuota {
  volume?: string;
  share_quota?: number;
  share_used?: number;
}

export interface CreateUserParams {
  name: string;
  password: string;
  description?: string;
  email?: string;
  expired?: string;
  cannotChangePassword: boolean;
}

// ─── Packages ───────────────────────────────────────────────────
export interface PackageInfo {
  id: string;
  name?: string;
  dname?: string;
  version?: string;
  status?: string;
  is_uninstallable?: boolean;
  additional?: PackageAdditional;
}

export interface PackageAdditional {
  description?: string;
  description_enu?: string;
  status?: string;
  dependent_packages?: Record<string, unknown>;
  dsm_apps?: string;
  dsm_app_page?: string;
  icon?: string;
}

// ─── Services ───────────────────────────────────────────────────
export interface ServiceStatus {
  id?: string;
  name?: string;
  enabled?: boolean;
  status?: string;
}

export interface SmbConfig {
  enable_smb?: boolean;
  workgroup?: string;
  local_master_browser?: boolean;
  max_protocol?: string;
  min_protocol?: string;
}

export interface NfsConfig {
  enable_nfs?: boolean;
  enable_nfs_v4?: boolean;
  nfs_version?: string;
}

export interface SshConfig {
  enable_ssh?: boolean;
  ssh_port?: number;
  enable_telnet?: boolean;
}

// ─── Docker / Container Manager ─────────────────────────────────
export interface DockerContainer {
  id?: string;
  name: string;
  image: string;
  status?: string;
  state?: string;
  created?: string;
  up_time?: string;
  ports?: DockerPortBinding[];
  volumes?: DockerVolumeMount[];
  cpu_percent?: number;
  memory_usage?: number;
  memory_limit?: number;
  network_rx?: number;
  network_tx?: number;
}

export interface DockerPortBinding {
  container_port: number;
  host_port: number;
  protocol?: string;
  host_ip?: string;
}

export interface DockerVolumeMount {
  host_path: string;
  mount_path: string;
  readonly_field?: boolean;
}

export interface DockerImage {
  repository: string;
  tag: string;
  tags?: string[];
  id?: string;
  created?: string;
  size?: number;
  virtual_size?: number;
}

export interface DockerRegistry {
  name: string;
  url?: string;
  username?: string;
  mirror?: boolean;
}

export interface DockerNetwork {
  name: string;
  driver?: string;
  scope?: string;
  subnet?: string;
  gateway?: string;
  containers?: string[];
}

export interface DockerProject {
  name: string;
  status?: string;
  path?: string;
  services?: string[];
  created?: string;
}

// ─── Virtual Machines ───────────────────────────────────────────
export interface VmGuest {
  guest_id: string;
  guest_name: string;
  name?: string;
  status?: string;
  description?: string;
  vcpu_num?: number;
  vram_size?: number;
  autorun?: boolean;
  storage_name?: string;
  storage_id?: string;
}

export interface VmSnapshot {
  snap_id: string;
  desc?: string;
  create_time?: string;
  parent_snap_id?: string;
  status?: string;
}

export interface VmNetwork {
  name: string;
  vswitch_id?: string;
  vlan_id?: number;
}

// ─── Download Station ───────────────────────────────────────────
export interface DownloadTask {
  id: string;
  title: string;
  type_field?: string;
  status?: string;
  size?: number;
  size_downloaded?: number;
  size_uploaded?: number;
  speed_download?: number;
  speed_upload?: number;
  percent_done?: number;
  destination?: string;
  uri?: string;
  username?: string;
  seedelapsed?: number;
  waiting_seconds?: number;
  additional?: Record<string, unknown>;
}

export interface DownloadStationInfo {
  version?: number;
  version_string?: string;
  is_manager?: boolean;
}

export interface DownloadStationStats {
  speed_download: number;
  speed_upload: number;
  emule_speed_download?: number;
  emule_speed_upload?: number;
}

// ─── Surveillance Station ───────────────────────────────────────
export interface SurveillanceInfo {
  version?: number;
  version_string?: string;
  total_cam?: number;
  activated_cam?: number;
  used_cam_license?: number;
  total_cam_license?: number;
}

export interface Camera {
  id: number;
  name: string;
  ip?: string;
  port?: number;
  model?: string;
  vendor?: string;
  status?: number;
  enabled?: boolean;
  recording?: boolean;
  host?: string;
  resolution?: string;
}

export interface Recording {
  id: string;
  camera_id?: number;
  camera_name?: string;
  start_time?: string;
  stop_time?: string;
  size?: number;
  recording_type?: string;
}

// ─── Backup ─────────────────────────────────────────────────────
export interface BackupTaskInfo {
  task_id: string;
  name?: string;
  status?: string;
  state?: string;
  target_type?: string;
  schedule?: string;
  last_backup_time?: string;
  next_backup_time?: string;
  transfer_size?: number;
}

export interface BackupVersion {
  version_id: string;
  backup_time?: string;
  size?: number;
  status?: string;
}

export interface ActiveBackupDevice {
  device_id: string;
  device_name?: string;
  device_type?: string;
  os_name?: string;
  status?: string;
  ip_address?: string;
  last_backup_time?: string;
}

// ─── Security ───────────────────────────────────────────────────
export interface SecurityOverview {
  risk_count?: number;
  risk_score?: number;
  overall_status?: string;
  check_items?: SecurityCheckItem[];
  items?: SecurityCheckItem[];
  last_scan_time?: string;
  is_scanning?: boolean;
}

export interface SecurityCheckItem {
  category?: string;
  severity?: string;
  status?: string;
  title?: string;
  suggest?: string;
}

export interface BlockedIp {
  ip: string;
  reason?: string;
  expire?: string;
  expire_time?: string;
  recorded_time?: string;
  blocked_time?: string;
}

export interface CertificateInfo {
  id: string;
  desc?: string;
  is_default?: boolean;
  issuer?: string | { common_name?: string; [k: string]: unknown };
  subject?: string | { common_name?: string; [k: string]: unknown };
  valid_from?: string;
  valid_till?: string;
  services?: CertificateService[];
}

export interface CertificateService {
  display_name?: string;
  is_broken?: boolean;
  service?: string;
  subscriber?: string;
}

export interface AutoBlockConfig {
  enabled?: boolean;
  enable?: boolean;
  login_attempts?: number;
  login_attempts_minutes?: number;
  within_minutes?: number;
  expire_days?: number;
  allow_list?: string[];
}

// ─── Hardware ───────────────────────────────────────────────────
export interface HardwareInfo {
  model: string;
  ram_size: number;
  serial: string;
  cpu_family?: string;
  cpu_series?: string;
  cpu_vendor?: string;
  cpu_clock_speed?: number;
  cpu_cores?: number;
  fans: FanInfo[];
  temperatures: TempSensor[];
  temps?: TempSensor[];
}

export interface FanInfo {
  id: string;
  name?: string;
  fan_speed?: number;
  speed?: number;
  status?: string;
}

export interface TempSensor {
  id: string;
  name?: string;
  value?: number;
  unit?: string;
  status?: string;
}

export interface UpsInfo {
  ups_enable?: boolean;
  ups_mode?: string;
  ups_model?: string;
  model?: string;
  ups_status?: string;
  status?: string;
  battery_charge?: number;
  battery_runtime?: number;
  power_nominal?: number;
}

export interface PowerSchedule {
  schedule_enable?: boolean;
  entries: PowerScheduleEntry[];
}

export interface PowerScheduleEntry {
  day?: string;
  hour?: number;
  minute?: number;
  action?: string;
  enabled?: boolean;
}

// ─── Logs ───────────────────────────────────────────────────────
export interface LogEntry {
  id?: number;
  log_type?: string;
  time?: string;
  level?: string;
  user?: string;
  event?: string;
  description?: string;
  descr?: string;
  message?: string;
}

export interface ConnectionEntry {
  who?: string;
  user?: string;
  ip?: string;
  type_field?: string;
  service?: string;
  action?: string;
  time?: string;
  from_field?: string;
  descr?: string;
}

// ─── Notifications ──────────────────────────────────────────────
export interface NotificationConfig {
  email_enabled?: boolean;
  push_enabled?: boolean;
  sms_enabled?: boolean;
  webhook_enabled?: boolean;
}

// ─── Dashboard ──────────────────────────────────────────────────
export interface SynologyDashboard {
  system_info?: DsmInfo;
  utilization?: SystemUtilization;
  storage?: StorageOverview;
  network?: NetworkOverview;
  hardware?: HardwareInfo;
}

// ─── Connection State ───────────────────────────────────────────
export interface SynologyConnectionState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  config: SynologyConfigSafe | null;
}
