// Native Synology IPC DTOs. Field names match src-tauri/crates/sorng-synology/src/types.rs.
// Optional native values are null; unknown data is never a successful zero/false.

export interface ApiInfoEntry {
  path: string;
  minVersion: number;
  maxVersion: number;
  requestFormat?: string | null;
}

export interface SynologyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  useHttps: boolean;
  insecure: boolean;
  timeoutSecs: number;
  otpCode?: string | null;
  deviceToken?: string | null;
  accessToken?: string | null;
}

export interface SynologyConfigSafe {
  host: string;
  port: number;
  username: string;
  useHttps: boolean;
  dsmVersion?: string | null;
  model?: string | null;
}

export interface LoginResult {
  sid: string;
  synotoken?: string | null;
  did?: string | null;
}

export interface DsmInfo {
  model: string;
  ram: number;
  serial: string;
  temperature: number;
  temperatureWarn?: boolean | null;
  uptime: number;
  version: string;
  versionString: string;
  cpuClockSpeed?: number | null;
  cpuCores?: string | null;
  cpuFamily?: string | null;
  cpuVendor?: string | null;
  sysTemp?: number | null;
}

export interface SystemUtilization {
  cpu: CpuUtilization;
  memory: MemoryUtilization;
  network: NetworkUtilization[];
  disk: DiskUtilization[];
}

export interface CpuUtilization {
  userLoad: number;
  systemLoad: number;
  otherLoad?: number | null;
  "15min_load"?: number | null;
  "5min_load"?: number | null;
  "1min_load"?: number | null;
  device?: string | null;
}

export interface MemoryUtilization {
  totalReal: number;
  availReal: number;
  totalSwap: number;
  availSwap: number;
  cached?: number | null;
  buffer?: number | null;
  siDisk?: number | null;
  soDisk?: number | null;
  memorySize?: number | null;
  realUsage?: number | null;
  swapUsage?: number | null;
}

export interface NetworkUtilization {
  device: string;
  rx: number;
  tx: number;
}

export interface DiskUtilization {
  device: string;
  displayName?: string | null;
  readAccess?: number | null;
  writeAccess?: number | null;
  readByte?: number | null;
  writeByte?: number | null;
  utilization?: number | null;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  user: string;
  cpu: number;
  memory: number;
  threads?: number | null;
}

export interface StorageOverview {
  disks: DiskInfo[];
  volumes: VolumeInfo[];
  storagePools: StoragePool[];
  ssdCaches: SsdCache[];
  hotSpares: HotSpare[];
}

export interface DiskInfo {
  id: string;
  name: string;
  device: string;
  model: string;
  vendor?: string | null;
  serial?: string | null;
  firmware?: string | null;
  sizeTotal: number;
  temp?: number | null;
  status: string;
  smartStatus?: string | null;
  diskType?: string | null;
  exceedBadSectorThr?: boolean | null;
  intf?: string | null;
  container?: DiskContainer | null;
}

export interface DiskContainer {
  pool?: string | null;
  volume?: string | null;
  type?: string | null;
}

export interface VolumeInfo {
  id: string;
  displayName?: string | null;
  status: string;
  fsType?: string | null;
  sizeTotal: number;
  sizeUsed: number;
  sizeFree: number;
  usagePercent?: number | null;
  poolPath?: string | null;
  desc?: string | null;
  container?: string | null;
}

export interface StoragePool {
  id: string;
  status: string;
  raidType?: string | null;
  sizeTotal?: number | null;
  sizeUsed?: number | null;
  disks: string[];
  desc?: string | null;
}

export interface SsdCache {
  id: string;
  status: string;
  size: number;
  readHit?: number | null;
  disks: string[];
}

export interface HotSpare {
  diskId: string;
  poolId?: string | null;
}

export interface SmartInfo {
  diskId: string;
  diskName: string;
  healthStatus: string;
  temperature?: number | null;
  powerOnHours?: number | null;
  reallocatedSectors?: number | null;
  attributes: SmartAttribute[];
}

export interface SmartAttribute {
  id: number;
  name: string;
  current: number;
  worst: number;
  threshold: number;
  raw: string;
  status: string;
}

export interface IscsiLun {
  lunId: string;
  name: string;
  size: number;
  status: string;
  usedSize?: number | null;
  location?: string | null;
  mappedTargets?: string[] | null;
}

export interface IscsiTarget {
  targetId: string;
  name: string;
  iqn: string;
  status: string;
  maxSessions?: number | null;
  mappedLuns: string[];
}

export interface FileStationInfo {
  hostname: string;
  isManager: boolean;
  supportSharing: boolean;
  supportVirtualProtocol?: string[] | null;
}

export interface FileListItem {
  path: string;
  name: string;
  isdir: boolean;
  additional?: FileAdditional | null;
}

export interface FileAdditional {
  size?: number | null;
  time?: FileTime | null;
  owner?: FileOwner | null;
  perm?: FilePerm | null;
  realPath?: string | null;
  type?: string | null;
  mountPointType?: string | null;
}

export interface FileTime {
  atime?: number | null;
  mtime?: number | null;
  ctime?: number | null;
  crtime?: number | null;
}

export interface FileOwner {
  user?: string | null;
  group?: string | null;
  uid?: number | null;
  gid?: number | null;
}

export interface FilePerm {
  posix?: number | null;
  acl?: unknown | null;
  is_acl_mode?: boolean | null;
}

export interface FileListResult {
  files: FileListItem[];
  total: number;
  offset: number;
}

export interface ShareLinkInfo {
  id: string;
  path: string;
  url: string;
  isFolder: boolean;
  dateExpired?: string | null;
  dateAvailable?: string | null;
  status: string;
  hasPassword: boolean;
}

export interface BackgroundTask {
  taskid: string;
  finished: boolean;
  progress?: number | null;
  path?: string | null;
  destFolderPath?: string | null;
}

export interface SharedFolder {
  name: string;
  path: string;
  volPath?: string | null;
  desc?: string | null;
  isAclmode?: boolean | null;
  enableRecycleBin?: boolean | null;
  encryption?: number | null;
  isShareMoving?: boolean | null;
  additional?: SharedFolderAdditional | null;
}

export interface SharedFolderAdditional {
  realPath?: string | null;
  owner?: FileOwner | null;
  perm?: FilePerm | null;
  mountPointType?: string | null;
  volumeStatus?: unknown | null;
}

export interface SharePermission {
  name: string;
  isReadonly: boolean;
  isWritable: boolean;
  isDeny: boolean;
  isCustom?: boolean | null;
}

export interface NetworkOverview {
  hostname: string;
  workgroup?: string | null;
  dns: string[];
  gateway?: string | null;
  interfaces: NetworkInterface[];
}

export interface NetworkInterface {
  id: string;
  name?: string | null;
  mac: string;
  ip: string[];
  ipv6: string[];
  subnet?: string | null;
  mtu?: number | null;
  linkSpeed?: string | null;
  status: string;
  interfaceType?: string | null;
}

export interface FirewallRule {
  id?: string | null;
  srcIp: string;
  srcPort: string;
  direction: string;
  action: string;
  protocol: string;
  enabled: boolean;
}

export interface DhcpLease {
  hostname: string;
  mac: string;
  ip: string;
  expires?: string | null;
}

export interface VpnProfile {
  id: string;
  name: string;
  protocol: string;
  status: string;
  server?: string | null;
}

export interface SynoUser {
  name: string;
  uid: number;
  description?: string | null;
  email?: string | null;
  expired?: string | null;
  enableHomeService?: boolean | null;
}

export interface SynoGroup {
  name: string;
  gid: number;
  description?: string | null;
  members: string[];
}

export interface UserQuota {
  user: string;
  share: string;
  quotaValue: number;
  used: number;
}

export interface CreateUserParams {
  name: string;
  password: string;
  description?: string | null;
  email?: string | null;
  sendNotification?: boolean | null;
  expired?: string | null;
  cannotChangePassword: boolean;
}

export interface PackageInfo {
  id: string;
  name: string;
  version: string;
  description?: string | null;
  status: string;
  isUninstallPages?: boolean | null;
  updateVersion?: string | null;
  additional?: PackageAdditional | null;
}

export interface PackageAdditional {
  description?: string | null;
  maintainer?: string | null;
  dsmApps?: string | null;
  dsmAppPage?: string | null;
}

export interface ServiceStatus {
  id: string;
  name: string;
  enabled: boolean;
  running: boolean;
  port?: number | null;
  serviceType: string;
}

export interface SmbConfig {
  enabled: boolean;
  workgroup?: string | null;
  description?: string | null;
  minProtocol?: string | null;
  maxProtocol?: string | null;
  enableSmb2?: boolean | null;
  enableSmb3?: boolean | null;
}

export interface NfsConfig {
  enabled: boolean;
  enableNfsV4?: boolean | null;
  domain?: string | null;
}

export interface SshConfig {
  enabled: boolean;
  port: number;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created?: string | null;
  finishedAt?: string | null;
  upTime?: number | null;
  cpuPercent?: number | null;
  memoryUsage?: number | null;
  memoryLimit?: number | null;
  ports: DockerPortBinding[];
  volumes: DockerVolumeMount[];
}

export interface DockerPortBinding {
  containerPort: number;
  hostPort: number;
  protocol: string;
  hostIp?: string | null;
}

export interface DockerVolumeMount {
  source: string;
  destination: string;
  mode?: string | null;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  created?: string | null;
  size: number;
  virtualSize?: number | null;
}

export interface DockerRegistry {
  name: string;
  url: string;
  enableRegistryMirror?: boolean | null;
  username?: string | null;
}

export interface DockerNetwork {
  name: string;
  id: string;
  driver: string;
  scope: string;
  subnet?: string | null;
  gateway?: string | null;
  containers?: number | null;
}

export interface DockerProject {
  name: string;
  status: string;
  services: string[];
  path?: string | null;
}

export interface VmGuest {
  guestId: string;
  guestName: string;
  status: string;
  description?: string | null;
  vcpuNum: number;
  vramSize: number;
  autorun?: boolean | null;
  storageName?: string | null;
  storageSize?: number | null;
  vncPort?: number | null;
}

export interface VmSnapshot {
  snapId: string;
  desc?: string | null;
  takenAt?: string | null;
  lock?: boolean | null;
  parentSnapId?: string | null;
}

export interface VmNetwork {
  networkId: string;
  networkName: string;
  vswitchName?: string | null;
  interface?: string | null;
}

export interface DownloadTask {
  id: string;
  title: string;
  status: string;
  size: number;
  sizeDownloaded: number;
  sizeUploaded?: number | null;
  speedDownload?: number | null;
  speedUpload?: number | null;
  percentDn?: number | null;
  type: string;
  destination?: string | null;
  uri?: string | null;
  username?: string | null;
  createdTime?: string | null;
}

export interface DownloadStationInfo {
  isManager: boolean;
  version: string;
  versionString?: string | null;
}

export interface DownloadStationStats {
  speedDownload: number;
  speedUpload: number;
  emuleSpeedDownload?: number | null;
  emuleSpeedUpload?: number | null;
}

export interface SurveillanceInfo {
  version: SurveillanceVersion;
  cameraCount: number;
  licenseCount?: number | null;
}

export interface SurveillanceVersion {
  major: number;
  minor: number;
  build?: string | null;
}

export interface Camera {
  id: number;
  name: string;
  ip: string;
  port: number;
  model?: string | null;
  vendor?: string | null;
  status: number;
  enabled: boolean;
  recording?: boolean | null;
  resolution?: string | null;
  fps?: number | null;
  streamPath?: string | null;
  snapshotPath?: string | null;
}

export interface Recording {
  id: string;
  cameraId: number;
  cameraName?: string | null;
  startTime: string;
  stopTime: string;
  fileSize: number;
  eventType?: string | null;
}

export interface BackupTaskInfo {
  taskId: number;
  name: string;
  status: string;
  lastBackupTime?: string | null;
  nextBackupTime?: string | null;
  destType?: string | null;
  destPath?: string | null;
  totalSize?: number | null;
  transferredSize?: number | null;
  progress?: number | null;
}

export interface BackupVersion {
  versionId: number;
  createdTime: string;
  size: number;
}

export interface ActiveBackupDevice {
  deviceId: number;
  deviceName: string;
  deviceType: string;
  status: string;
  lastBackup?: string | null;
  agentVersion?: string | null;
  ipAddress?: string | null;
}

export interface SecurityOverview {
  autoBlockEnabled: boolean;
  firewallEnabled: boolean;
  httpsEnabled: boolean;
  advisorScore?: number | null;
  blockedIps: BlockedIp[];
  certificateInfo?: CertificateInfo | null;
}

export interface BlockedIp {
  ip: string;
  blockedAt: string;
  reason?: string | null;
}

export interface CertificateInfo {
  id: string;
  desc: string;
  subject: unknown;
  issuer: unknown;
  validFrom: string;
  validTill: string;
  isDefault: boolean;
  isBroken?: boolean | null;
  signatureAlgorithm?: string | null;
}

export interface AutoBlockConfig {
  enabled: boolean;
  attempts: number;
  withinMinutes: number;
  blockForever: boolean;
  expireMinutes?: number | null;
}

export interface HardwareInfo {
  fanSpeed?: string | null;
  fanSpeeds: FanInfo[];
  temperatures: TempSensor[];
  ups?: UpsInfo | null;
  beepEnabled?: boolean | null;
  ledBrightness?: number | null;
  powerSchedule?: PowerSchedule | null;
}

export interface FanInfo {
  id: string;
  fanSpeed: number;
  status: string;
}

export interface TempSensor {
  id: string;
  name: string;
  temperature: number;
  warnThreshold?: number | null;
  status: string;
}

export interface UpsInfo {
  enabled: boolean;
  model?: string | null;
  status: string;
  batteryCharge?: number | null;
  loadPercent?: number | null;
  runtimeMinutes?: number | null;
  serverType?: string | null;
}

export interface PowerSchedule {
  enabled: boolean;
  entries: PowerScheduleEntry[];
}

export interface PowerScheduleEntry {
  action: string;
  hour: number;
  minute: number;
  weekday: number[];
  enabled: boolean;
}

export interface LogEntry {
  id: number;
  time: string;
  msg: string;
  level: string;
  user?: string | null;
  event?: string | null;
  logType?: string | null;
}

export interface ConnectionEntry {
  time: string;
  ip: string;
  user: string;
  type: string;
  isLogin: boolean;
  success: boolean;
}

export interface NotificationConfig {
  emailEnabled: boolean;
  emailAddress?: string | null;
  smtpServer?: string | null;
  smsEnabled: boolean;
  pushEnabled: boolean;
}

export interface SynologyDashboard {
  systemInfo?: DsmInfo | null;
  utilization?: SystemUtilization | null;
  storage?: StorageOverview | null;
  network?: NetworkOverview | null;
  hardware?: HardwareInfo | null;
}

export interface SynologyConnectionState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  config: SynologyConfigSafe | null;
}
