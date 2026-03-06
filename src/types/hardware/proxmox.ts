// ── TypeScript types for sorng-proxmox crate ─────────────────────────────────
//
// These types mirror the Rust types in src-tauri/crates/sorng-proxmox/src/types.rs
// and are used by the frontend hooks / components to interact with Proxmox VE.

// ── Configuration & Auth ─────────────────────────────────────────────────────

export type ProxmoxAuthMethod =
  | { type: "Password"; password: string }
  | { type: "ApiToken"; tokenId: string; tokenSecret: string };

export interface ProxmoxConfig {
  host: string;
  port: number;
  username: string;
  auth: ProxmoxAuthMethod;
  insecure: boolean;
  timeoutSecs: number;
}

/** Config without secrets, safe to display in UI. */
export interface ProxmoxConfigSafe {
  host: string;
  port: number;
  username: string;
  insecure: boolean;
}

// ── Cluster ──────────────────────────────────────────────────────────────────

export interface ClusterStatus {
  id?: string;
  name?: string;
  type?: string;
  ip?: string;
  online?: number;
  quorate?: number;
  nodeid?: number;
  version?: number;
  nodes?: number;
  level?: string;
  local?: number;
}

export interface ClusterResource {
  id?: string;
  type?: string;
  node?: string;
  status?: string;
  vmid?: number;
  name?: string;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  pool?: string;
  template?: boolean;
  hastate?: string;
}

export interface ClusterOptions {
  keyboard?: string;
  language?: string;
  httpProxy?: string;
  console?: string;
  emailFrom?: string;
  migration?: string;
  migrationUnsecure?: number;
}

export interface ClusterJoinInfo {
  configDigest?: string;
  nodelist?: ClusterNodeInfo[];
  preferredNode?: string;
  totem?: Record<string, unknown>;
}

export interface ClusterNodeInfo {
  name?: string;
  nodeid?: number;
  pveAddr?: string;
  quorumVotes?: number;
  ring0Addr?: string;
}

// ── Nodes ────────────────────────────────────────────────────────────────────

export interface NodeSummary {
  node: string;
  status: string;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  level?: string;
  sslFingerprint?: string;
}

export interface NodeStatus {
  cpu?: number;
  cpuinfo?: CpuInfo;
  memory?: MemoryInfo;
  rootfs?: DiskInfo;
  swap?: MemoryInfo;
  uptime?: number;
  loadavg?: number[];
  kversion?: string;
  pveversion?: string;
  ksm?: KsmInfo;
  currentKernel?: Record<string, unknown>;
  bootInfo?: Record<string, unknown>;
}

export interface CpuInfo {
  cpus?: number;
  model?: string;
  mhz?: string;
  sockets?: number;
  cores?: number;
  threads?: number;
  userHz?: number;
  hvm?: boolean;
  flags?: string;
}

export interface MemoryInfo {
  total?: number;
  used?: number;
  free?: number;
}

export interface DiskInfo {
  total?: number;
  used?: number;
  free?: number;
  avail?: number;
}

export interface KsmInfo {
  shared?: number;
}

export interface NodeService {
  service: string;
  name?: string;
  desc?: string;
  state?: string;
}

export interface NodeDns {
  search?: string;
  dns1?: string;
  dns2?: string;
  dns3?: string;
}

export interface NodeTime {
  timezone?: string;
  time?: number;
  localtime?: number;
}

export interface AptUpdate {
  package?: string;
  title?: string;
  description?: string;
  version?: string;
  oldVersion?: string;
  origin?: string;
  priority?: string;
  section?: string;
  changeLogUrl?: string;
}

export interface SyslogEntry {
  n: number;
  t: string;
}

// ── QEMU VMs ─────────────────────────────────────────────────────────────────

export type QemuStatus = "running" | "stopped" | "paused" | "suspended" | "unknown";

export interface QemuVmSummary {
  vmid: number;
  name?: string;
  status: QemuStatus;
  cpu?: number;
  cpus?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  pid?: number;
  template?: boolean;
  qmpstatus?: string;
  lock?: string;
  tags?: string;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
}

export interface QemuConfig {
  name?: string;
  description?: string;
  memory?: number;
  balloon?: number;
  cores?: number;
  sockets?: number;
  cpu?: string;
  numa?: boolean;
  ostype?: string;
  machine?: string;
  bios?: string;
  boot?: string;
  bootdisk?: string;
  scsihw?: string;
  agent?: string;
  onboot?: boolean;
  hotplug?: string;
  tablet?: boolean;
  vga?: string;
  args?: string;
  tags?: string;
  protection?: boolean;
  // Storage — IDE
  ide0?: string;
  ide1?: string;
  ide2?: string;
  ide3?: string;
  // Storage — SCSI
  scsi0?: string;
  scsi1?: string;
  scsi2?: string;
  scsi3?: string;
  // Storage — VirtIO
  virtio0?: string;
  virtio1?: string;
  virtio2?: string;
  virtio3?: string;
  // Storage — SATA
  sata0?: string;
  sata1?: string;
  sata2?: string;
  sata3?: string;
  // NICs
  net0?: string;
  net1?: string;
  net2?: string;
  net3?: string;
  // Cloud-init
  ciuser?: string;
  cipassword?: string;
  citype?: string;
  ipconfig0?: string;
  ipconfig1?: string;
  nameserver?: string;
  searchdomain?: string;
  sshkeys?: string;
  // Special
  efidisk0?: string;
  tpmstate0?: string;
  serial0?: string;
  serial1?: string;
  // Additional key-value pairs
  [key: string]: unknown;
}

export interface QemuCreateParams {
  vmid: number;
  name?: string;
  memory?: number;
  cores?: number;
  sockets?: number;
  cpu?: string;
  ostype?: string;
  ide0?: string;
  ide2?: string;
  scsi0?: string;
  virtio0?: string;
  net0?: string;
  boot?: string;
  bios?: string;
  machine?: string;
  scsihw?: string;
  agent?: string;
  onboot?: boolean;
  start?: boolean;
  pool?: string;
  storage?: string;
  ciuser?: string;
  cipassword?: string;
  ipconfig0?: string;
  sshkeys?: string;
  efidisk0?: string;
  tpmstate0?: string;
}

export interface QemuCloneParams {
  newid: number;
  name?: string;
  description?: string;
  target?: string;
  pool?: string;
  storage?: string;
  format?: string;
  full?: boolean;
  snapname?: string;
}

export interface QemuMigrateParams {
  target: string;
  online?: boolean;
  force?: boolean;
  withLocalDisks?: boolean;
  targetstorage?: string;
}

export interface DiskResizeParams {
  disk: string;
  size: string;
}

export interface QemuStatusCurrent {
  status?: QemuStatus;
  vmid?: number;
  name?: string;
  qmpstatus?: string;
  pid?: number;
  uptime?: number;
  cpus?: number;
  cpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
  ha?: Record<string, unknown>;
  spice?: number;
  agent?: number;
  lock?: string;
  tags?: string;
  runningMachine?: string;
  runningQemu?: string;
}

export interface QemuAgentInfo {
  result?: unknown;
}

export interface QemuFeatureCheck {
  hasFeature?: boolean;
  nodes?: string[];
}

// ── LXC Containers ───────────────────────────────────────────────────────────

export type LxcStatus = "running" | "stopped" | "unknown";

export interface LxcSummary {
  vmid: number;
  name?: string;
  status: LxcStatus;
  cpu?: number;
  cpus?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  uptime?: number;
  template?: boolean;
  lock?: string;
  tags?: string;
  swap?: number;
  maxswap?: number;
  type?: string;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
}

export interface LxcConfig {
  hostname?: string;
  description?: string;
  memory?: number;
  swap?: number;
  cores?: number;
  cpulimit?: number;
  cpuunits?: number;
  ostype?: string;
  arch?: string;
  rootfs?: string;
  onboot?: boolean;
  startup?: string;
  protection?: boolean;
  unprivileged?: boolean;
  features?: string;
  tags?: string;
  // Mount points
  mp0?: string;
  mp1?: string;
  mp2?: string;
  mp3?: string;
  // Network
  net0?: string;
  net1?: string;
  net2?: string;
  net3?: string;
  // Nameserver
  nameserver?: string;
  searchdomain?: string;
  // Additional key-value pairs
  [key: string]: unknown;
}

export interface LxcCreateParams {
  vmid: number;
  ostemplate: string;
  hostname?: string;
  memory?: number;
  swap?: number;
  cores?: number;
  rootfs?: string;
  net0?: string;
  password?: string;
  sshPublicKeys?: string;
  onboot?: boolean;
  unprivileged?: boolean;
  start?: boolean;
  pool?: string;
  storage?: string;
  nameserver?: string;
  searchdomain?: string;
}

export interface LxcCloneParams {
  newid: number;
  hostname?: string;
  description?: string;
  target?: string;
  pool?: string;
  storage?: string;
  full?: boolean;
  snapname?: string;
}

export interface LxcMigrateParams {
  target: string;
  online?: boolean;
  restart?: boolean;
  force?: boolean;
  targetstorage?: string;
}

export interface LxcStatusCurrent {
  status?: LxcStatus;
  vmid?: number;
  name?: string;
  pid?: number;
  uptime?: number;
  cpus?: number;
  cpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  swap?: number;
  maxswap?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
  ha?: Record<string, unknown>;
  lock?: string;
  tags?: string;
  type?: string;
}

// ── Storage ──────────────────────────────────────────────────────────────────

export interface StorageSummary {
  storage: string;
  type?: string;
  content?: string;
  active?: number;
  enabled?: number;
  shared?: number;
  total?: number;
  used?: number;
  avail?: number;
  usedFraction?: number;
}

export interface StorageContent {
  volid: string;
  content?: string;
  format?: string;
  size?: number;
  used?: number;
  ctime?: number;
  vmid?: number;
  notes?: string;
  parent?: string;
  encrypted?: string;
  verified?: boolean;
}

export interface StorageConfig {
  storage: string;
  type?: string;
  content?: string;
  path?: string;
  server?: string;
  export?: string;
  pool?: string;
  nodes?: string;
  shared?: boolean;
  disable?: boolean;
  maxfiles?: number;
  pruneBackups?: string;
}

// ── Network ──────────────────────────────────────────────────────────────────

export interface NetworkInterface {
  iface: string;
  type?: string;
  method?: string;
  method6?: string;
  active?: boolean;
  autostart?: boolean;
  address?: string;
  netmask?: string;
  gateway?: string;
  address6?: string;
  netmask6?: string;
  gateway6?: string;
  cidr?: string;
  cidr6?: string;
  bridgePorts?: string;
  bridgeStp?: string;
  bridgeFd?: number;
  bridgeVlanAware?: boolean;
  bondSlaves?: string;
  bondMode?: string;
  bondPrimary?: string;
  vlanId?: number;
  vlanRawDevice?: string;
  mtu?: number;
  comments?: string;
  ovsType?: string;
  ovsBridge?: string;
  ovsPorts?: string;
  ovsTag?: number;
  ovsBonds?: string;
  ovsOptions?: string;
  families?: string[];
}

export interface CreateNetworkParams {
  iface: string;
  type: string;
  address?: string;
  netmask?: string;
  gateway?: string;
  address6?: string;
  netmask6?: string;
  gateway6?: string;
  autostart?: boolean;
  bridgePorts?: string;
  bridgeVlanAware?: boolean;
  bondSlaves?: string;
  bondMode?: string;
  mtu?: number;
  comments?: string;
  vlanId?: number;
  vlanRawDevice?: string;
}

// ── Snapshots ────────────────────────────────────────────────────────────────

export interface SnapshotSummary {
  name: string;
  description?: string;
  snaptime?: number;
  vmstate?: boolean;
  parent?: string;
}

export interface CreateSnapshotParams {
  snapname: string;
  description?: string;
  vmstate?: boolean;
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export interface TaskSummary {
  upid: string;
  node?: string;
  pid?: number;
  pstart?: number;
  starttime?: number;
  endtime?: number;
  type?: string;
  id?: string;
  user?: string;
  status?: string;
}

export interface TaskStatus {
  status: string;
  type?: string;
  id?: string;
  node?: string;
  user?: string;
  pid?: number;
  pstart?: number;
  starttime?: number;
  upid?: string;
  exitstatus?: string;
}

export interface TaskLogLine {
  n: number;
  t: string;
}

// ── Backups ──────────────────────────────────────────────────────────────────

export interface BackupJobConfig {
  id?: string;
  type?: string;
  storage?: string;
  vmid?: string;
  schedule?: string;
  enabled?: boolean;
  mode?: string;
  compress?: string;
  mailnotification?: string;
  mailto?: string;
  node?: string;
  pool?: string;
  maxfiles?: number;
  pruneBackups?: string;
  notes?: string;
  exclude?: string;
  all?: boolean;
  dow?: string;
  starttime?: string;
  ionice?: number;
  bwlimit?: number;
  comment?: string;
}

export interface VzdumpParams {
  vmid?: string;
  storage?: string;
  mode?: string;
  compress?: string;
  maxfiles?: number;
  all?: boolean;
  node?: string;
  pool?: string;
  pigz?: number;
  bwlimit?: number;
  ionice?: number;
  notes?: string;
}

// ── Firewall ─────────────────────────────────────────────────────────────────

export interface FirewallRule {
  pos?: number;
  type?: string;
  action?: string;
  enabled?: number;
  comment?: string;
  source?: string;
  dest?: string;
  sport?: string;
  dport?: string;
  proto?: string;
  macro?: string;
  iface?: string;
  log?: string;
  digest?: string;
}

export interface FirewallAlias {
  name: string;
  cidr: string;
  comment?: string;
  digest?: string;
}

export interface FirewallIpSet {
  name: string;
  comment?: string;
  digest?: string;
}

export interface FirewallIpSetEntry {
  cidr: string;
  comment?: string;
  nomatch?: boolean;
  digest?: string;
}

export interface FirewallOptions {
  enable?: number;
  policyIn?: string;
  policyOut?: string;
  logLevelIn?: string;
  logLevelOut?: string;
  nfConntrackMax?: number;
  ndp?: number;
  radv?: number;
}

export interface FirewallSecurityGroup {
  group: string;
  comment?: string;
  digest?: string;
}

// ── Pools ────────────────────────────────────────────────────────────────────

export interface PoolSummary {
  poolid: string;
  comment?: string;
}

export interface PoolInfo {
  poolid?: string;
  comment?: string;
  members?: PoolMember[];
}

export interface PoolMember {
  id?: string;
  type?: string;
  node?: string;
  vmid?: number;
  storage?: string;
  name?: string;
  status?: string;
}

// ── HA ───────────────────────────────────────────────────────────────────────

export interface HaResource {
  sid: string;
  type?: string;
  state?: string;
  status?: string;
  group?: string;
  maxRelocate?: number;
  maxRestart?: number;
  comment?: string;
  digest?: string;
}

export interface HaGroup {
  group: string;
  nodes?: string;
  restricted?: boolean;
  nofailback?: boolean;
  comment?: string;
  digest?: string;
  type?: string;
}

export interface HaStatus {
  status?: Record<string, unknown>;
}

// ── Ceph ─────────────────────────────────────────────────────────────────────

export interface CephStatus {
  health?: Record<string, unknown>;
  pgmap?: Record<string, unknown>;
  osdmap?: Record<string, unknown>;
  monmap?: Record<string, unknown>;
  fsid?: string;
  quorumNames?: string[];
}

export interface CephOsd {
  id?: number;
  name?: string;
  host?: string;
  status?: string;
  crush_weight?: number;
  reweight?: number;
  deviceClass?: string;
}

export interface CephMonitor {
  name?: string;
  host?: string;
  addr?: string;
  rank?: number;
  service?: Record<string, unknown>;
}

export interface CephPool {
  poolName?: string;
  pool?: number;
  size?: number;
  minSize?: number;
  pgNum?: number;
  pgAutoscaleMode?: string;
  crushRule?: number;
  crushRuleName?: string;
  bytes_used?: number;
  percent_used?: number;
}

export interface CreateCephPoolParams {
  name: string;
  size?: number;
  minSize?: number;
  pgNum?: number;
  pgAutoscaleMode?: string;
  crushRule?: string;
  application?: string;
}

// ── SDN ──────────────────────────────────────────────────────────────────────

export interface SdnZone {
  zone: string;
  type?: string;
  dns?: string;
  reversedns?: string;
  dnszone?: string;
  mtu?: number;
  nodes?: string;
  ipam?: string;
  bridge?: string;
  tag?: number;
  vlanProtocol?: string;
  pending?: boolean;
  state?: string;
  digest?: string;
}

export interface SdnVnet {
  vnet: string;
  zone?: string;
  alias?: string;
  tag?: number;
  vlanaware?: boolean;
  type?: string;
  digest?: string;
  state?: string;
}

export interface SdnSubnet {
  subnet?: string;
  type?: string;
  vnet?: string;
  gateway?: string;
  snat?: boolean;
  dnszoneprefix?: string;
  digest?: string;
}

// ── Console ──────────────────────────────────────────────────────────────────

export type ConsoleType = "Vnc" | "Spice" | "Term";

export interface VncTicket {
  ticket: string;
  port: number;
  cert?: string;
  upid?: string;
  user?: string;
}

export interface SpiceTicket {
  host?: string;
  password?: string;
  proxy?: string;
  tlsPort?: number;
  type?: string;
  toggleFullscreen?: string;
  deleteThisFile?: number;
}

export interface TermProxyTicket {
  ticket?: string;
  port?: number;
  user?: string;
  upid?: string;
}

// ── Metrics / RRD ────────────────────────────────────────────────────────────

export type RrdTimeframe = "hour" | "day" | "week" | "month" | "year";

export interface RrdDataPoint {
  time?: number;
  [key: string]: unknown;
}

export interface ResourceMetrics {
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  netin?: number;
  netout?: number;
  uptime?: number;
}

// ── Templates ────────────────────────────────────────────────────────────────

export interface ApplianceTemplate {
  package?: string;
  template?: string;
  type?: string;
  section?: string;
  os?: string;
  headline?: string;
  description?: string;
  version?: string;
  infopage?: string;
  sha512sum?: string;
  location?: string;
  source?: string;
  maintainer?: string;
}

// ── Version ──────────────────────────────────────────────────────────────────

export interface PveVersion {
  version?: string;
  release?: string;
  repoid?: string;
  console?: string;
}

// ── Access / ACL ─────────────────────────────────────────────────────────────

export interface AclEntry {
  path?: string;
  type?: string;
  ugid?: string;
  roleid?: string;
  propagate?: boolean;
}

export interface PveUser {
  userid: string;
  enable?: boolean;
  expire?: number;
  firstname?: string;
  lastname?: string;
  email?: string;
  comment?: string;
  groups?: string;
  tokens?: Record<string, unknown>;
  realmType?: string;
}

export interface PveRole {
  roleid: string;
  privs?: string;
  special?: boolean;
}

export interface PveGroup {
  groupid: string;
  comment?: string;
  users?: string;
}

// ── Replication ──────────────────────────────────────────────────────────────

export interface ReplicationJob {
  id?: string;
  type?: string;
  source?: string;
  target?: string;
  guest?: number;
  jobnum?: number;
  schedule?: string;
  disable?: boolean;
  rate?: number;
  comment?: string;
}
