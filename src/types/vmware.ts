// VMware / vSphere integration types — camelCase 1:1 mirror of the Rust backend.
//
// Source of truth:
//   src-tauri/crates/sorng-vmware/src/types.rs        (all structs/enums below)
//   src-tauri/crates/sorng-vmware/src/metrics.rs      (InventorySummary, HostResourceStats)
//   src-tauri/crates/sorng-vmware/src/service.rs       (VsphereConfigSafe)
//
// All Rust structs use `#[serde(rename_all = "camelCase")]`, so field names here
// are the camelCase forms. Enums map to string-literal unions (Rust
// SCREAMING_SNAKE_CASE / explicit `#[serde(rename)]` values preserved verbatim).
// `serde_json::Value` fields become `unknown`.

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Connection / Config
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Connection options nested under the `args` parameter of `vmware_connect`. */
export interface VmwareConnectArgs {
  host: string;
  port?: number;
  username: string;
  password: string;
  insecure?: boolean;
  timeoutSecs?: number;
  proxyUrl?: string;
}

/** Full config shape (`VsphereConfig`). Password included — used only in memory. */
export interface VsphereConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  insecure: boolean;
  timeoutSecs: number;
  proxyUrl?: string | null;
}

/** Config without the password, returned by `vmware_get_config`. */
export interface VsphereConfigSafe {
  host: string;
  port: number;
  username: string;
  insecure: boolean;
}

export interface VsphereSession {
  host: string;
  username: string;
  sessionId: string;
  connectedAt: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  VM power state
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type VmPowerState =
  | "POWERED_ON"
  | "POWERED_OFF"
  | "SUSPENDED"
  | "UNKNOWN";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  VM types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface VmSummary {
  vm: string;
  name: string;
  powerState: VmPowerState;
  cpuCount?: number;
  memorySizeMib?: number;
}

export interface VmInfo {
  name: string;
  powerState: VmPowerState;
  guestOs?: string;
  hardware?: VmHardware;
  cpu?: VmCpu;
  memory?: VmMemory;
  boot?: VmBoot;
  bootDevices?: VmBootDevice[];
  nics?: unknown;
  disks?: unknown;
  cdroms?: unknown;
  floppies?: unknown;
  parallelPorts?: unknown;
  serialPorts?: unknown;
  scsiAdapters?: unknown;
  sataAdapters?: unknown;
  nvmeAdapters?: unknown;
}

export interface VmHardware {
  version?: string;
  upgradePolicy?: string;
  upgradeVersion?: string;
}

export interface VmCpu {
  count?: number;
  coresPerSocket?: number;
  hotAddEnabled?: boolean;
  hotRemoveEnabled?: boolean;
}

export interface VmMemory {
  sizeMib?: number;
  hotAddEnabled?: boolean;
  hotAddIncrementSizeMib?: number;
  hotAddLimitMib?: number;
}

export interface VmBoot {
  delay?: number;
  type?: string;
  efiLegacyBoot?: boolean;
  enterSetupMode?: boolean;
  networkProtocol?: string;
  retry?: boolean;
  retryDelay?: number;
}

export interface VmBootDevice {
  type: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  VM create / update
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface VmCreateSpec {
  name: string;
  guestOs?: string;
  placement?: VmPlacement;
  cpu?: VmCpuSpec;
  memory?: VmMemorySpec;
  boot?: VmBootSpec;
  bootDevices?: VmBootDeviceSpec[];
  nics?: VmNicSpec[];
  disks?: VmDiskSpec[];
  cdroms?: VmCdromSpec[];
  scsiAdapters?: VmScsiAdapterSpec[];
  sataAdapters?: VmSataAdapterSpec[];
  hardwareVersion?: string;
  powerOn?: boolean;
  storagePolicy?: StoragePolicySpec;
}

export interface VmPlacement {
  folder?: string;
  resourcePool?: string;
  host?: string;
  cluster?: string;
  datastore?: string;
}

export interface VmCpuSpec {
  count?: number;
  coresPerSocket?: number;
  hotAddEnabled?: boolean;
  hotRemoveEnabled?: boolean;
}

export interface VmMemorySpec {
  sizeMib?: number;
  hotAddEnabled?: boolean;
}

export interface VmBootSpec {
  delay?: number;
  type?: string;
  efiLegacyBoot?: boolean;
  enterSetupMode?: boolean;
  networkProtocol?: string;
  retry?: boolean;
  retryDelay?: number;
}

export interface VmBootDeviceSpec {
  type: string;
}

export interface VmNicSpec {
  type?: string;
  network?: string;
  macType?: string;
  macAddress?: string;
  startConnected?: boolean;
  allowGuestControl?: boolean;
  wakeOnLanEnabled?: boolean;
  uptCompatibilityEnabled?: boolean;
}

export interface VmDiskSpec {
  type?: string;
  newVmdk?: VmdkCreateSpec;
  backing?: DiskBackingSpec;
  scsi?: ScsiAddressSpec;
  sata?: SataAddressSpec;
  nvme?: NvmeAddressSpec;
  ide?: IdeAddressSpec;
}

export interface VmdkCreateSpec {
  capacity?: number;
  name?: string;
  storagePolicy?: StoragePolicySpec;
}

export interface DiskBackingSpec {
  type?: string;
  vmdkFile?: string;
}

export interface ScsiAddressSpec {
  bus?: number;
  unit?: number;
}

export interface SataAddressSpec {
  bus?: number;
  unit?: number;
}

export interface NvmeAddressSpec {
  bus?: number;
  unit?: number;
}

export interface IdeAddressSpec {
  primary?: boolean;
  master?: boolean;
}

export interface VmCdromSpec {
  type?: string;
  backing?: CdromBackingSpec;
  startConnected?: boolean;
  allowGuestControl?: boolean;
  sata?: SataAddressSpec;
  ide?: IdeAddressSpec;
}

export interface CdromBackingSpec {
  type?: string;
  isoFile?: string;
  deviceAccessType?: string;
  hostDevice?: string;
}

export interface VmScsiAdapterSpec {
  type?: string;
  bus?: number;
  sharing?: string;
}

export interface VmSataAdapterSpec {
  bus?: number;
}

export interface StoragePolicySpec {
  policy: string;
}

export interface VmCpuUpdate {
  count?: number;
  coresPerSocket?: number;
  hotAddEnabled?: boolean;
  hotRemoveEnabled?: boolean;
}

export interface VmMemoryUpdate {
  sizeMib?: number;
  hotAddEnabled?: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Guest OS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface GuestInfo {
  name?: string;
  family?: string;
  fullName?: string;
  hostName?: string;
  ipAddress?: string;
  osId?: string;
}

export interface GuestIdentity {
  name?: string;
  family?: string;
  fullName?: string;
  hostName?: string;
  ipAddress?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Snapshots
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface SnapshotSummary {
  snapshot: string;
  name?: string;
  description?: string;
  parent?: string;
  children?: string[];
  powerState?: VmPowerState;
  size?: number;
  creationTime?: string;
}

export interface SnapshotTree {
  snapshots: SnapshotSummary[];
}

export interface CreateSnapshotSpec {
  name: string;
  description?: string;
  memory?: boolean;
  quiesce?: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Host (ESXi)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type HostConnectionState =
  | "CONNECTED"
  | "DISCONNECTED"
  | "NOT_RESPONDING"
  | "UNKNOWN";

export type HostPowerState =
  | "POWERED_ON"
  | "POWERED_OFF"
  | "STANDBY"
  | "UNKNOWN";

export interface HostSummary {
  host: string;
  name: string;
  connectionState: HostConnectionState;
  powerState?: HostPowerState;
}

export interface HostInfo {
  name: string;
  connectionState: HostConnectionState;
  powerState?: HostPowerState;
  serverGuid?: string;
  ntpServers?: string[];
}

/** Per-host resource summary (metrics.rs). */
export interface HostResourceStats {
  host: string;
  name: string;
  connectionState: HostConnectionState;
  powerState: HostPowerState;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Datastore / Storage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface DatastoreSummary {
  datastore: string;
  name: string;
  type?: string;
  freeSpace?: number;
  capacity?: number;
}

export interface DatastoreInfo {
  name: string;
  type?: string;
  accessible?: boolean;
  freeSpace?: number;
  multipleHostAccess?: boolean;
  thinProvisioningSupported?: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Network
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface NetworkSummary {
  network: string;
  name: string;
  type?: string;
}

export interface NetworkInfo {
  name: string;
  type?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Cluster / Datacenter / Folder / Resource pool
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ClusterSummary {
  cluster: string;
  name: string;
  haEnabled?: boolean;
  drsEnabled?: boolean;
}

export interface DatacenterSummary {
  datacenter: string;
  name: string;
}

export interface FolderSummary {
  folder: string;
  name: string;
  type?: string;
}

export interface ResourcePoolSummary {
  resourcePool: string;
  name: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Content Library
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ContentLibrary {
  id: string;
  name: string;
  description?: string;
  type?: string;
  creationTime?: string;
  storageBackings?: unknown[];
}

export interface LibraryItem {
  id: string;
  name: string;
  description?: string;
  libraryId?: string;
  type?: string;
  creationTime?: string;
  size?: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tags
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TagCategory {
  id: string;
  name: string;
  description?: string;
  cardinality?: string;
  associableTypes?: string[];
}

export interface Tag {
  id: string;
  name: string;
  description?: string;
  categoryId?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Task
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TaskInfo {
  task?: string;
  status?: string;
  description?: unknown;
  result?: unknown;
  error?: unknown;
  startTime?: string;
  endTime?: string;
  progress?: number;
  cancelable?: boolean;
  target?: unknown;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Console ticket / session (cross-platform WebSocket)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type ConsoleTicketType = "WEBMKS" | "VNC" | "MKS";

export interface ConsoleTicket {
  ticket: string;
  host?: string;
  port?: number;
  sslThumbprint?: string;
}

export interface OpenConsoleRequest {
  vmId: string;
  ticketType: ConsoleTicketType;
  insecure: boolean;
}

export interface ConsoleSession {
  sessionId: string;
  vmId: string;
  ticketType: string;
  directUrl: string;
  proxyUrl?: string;
  proxyPort?: number;
  startedAt: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  VMRC / Horizon (binary fallback)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface VmrcConnectionConfig {
  host: string;
  port: number;
  vmMoid: string;
  username?: string;
  password?: string;
  useHorizon: boolean;
  desktopName?: string;
  domain?: string;
}

export interface VmrcSession {
  sessionId: string;
  vmMoid: string;
  host: string;
  processId: number;
  startedAt: string;
  useHorizon: boolean;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Metrics
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface VmQuickStats {
  vm: string;
  name: string;
  powerState: VmPowerState;
  cpuCount?: number;
  memorySizeMib?: number;
  cpuUsageMhz?: number;
  memoryUsageMib?: number;
  storageUsedBytes?: number;
  uptimeSeconds?: number;
  guestOs?: string;
  ipAddress?: string;
  hostName?: string;
  toolsStatus?: string;
  toolsVersion?: string;
}

/** Top-level vCenter inventory counts (metrics.rs `InventorySummary`). */
export interface InventorySummary {
  datacenterCount: number;
  clusterCount: number;
  hostCount: number;
  vmCount: number;
  vmPoweredOn: number;
  datastoreCount: number;
  networkCount: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  VM clone / relocate
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface VmCloneSpec {
  name: string;
  source: string;
  placement?: VmPlacement;
  powerOn?: boolean;
  customizationSpec?: string;
  diskProvisionType?: string;
}

export interface VmRelocateSpec {
  host?: string;
  datastore?: string;
  resourcePool?: string;
  folder?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OVF / Template
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface OvfDeploySpec {
  libraryItemId: string;
  name: string;
  placement?: VmPlacement;
  acceptAllEula?: boolean;
  powerOn?: boolean;
  networkMappings?: unknown;
  storageMappings?: unknown;
}

export interface TemplateConvertSpec {
  library?: string;
  description?: string;
}
