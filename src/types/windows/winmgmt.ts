// ─── Windows Management TypeScript types ────────────────────────────
// Maps to Rust structs in sorng-winmgmt crate (camelCase via serde)

// ─── Services ───────────────────────────────────────────────────────

export type ServiceState =
  | "running"
  | "stopped"
  | "startPending"
  | "stopPending"
  | "continuePending"
  | "pausePending"
  | "paused"
  | "unknown";

export type ServiceStartMode =
  | "auto"
  | "manual"
  | "disabled"
  | "boot"
  | "system"
  | "delayedAuto"
  | "unknown";

export interface WindowsService {
  name: string;
  displayName: string;
  description: string | null;
  state: ServiceState;
  startMode: ServiceStartMode;
  serviceType: string;
  pathName: string | null;
  processId: number | null;
  exitCode: number | null;
  status: string;
  started: boolean;
  acceptPause: boolean;
  acceptStop: boolean;
  startName: string | null;
  delayedAutoStart: boolean | null;
  dependsOn: string[];
  dependentServices: string[];
}

// ─── Processes ──────────────────────────────────────────────────────

export interface WindowsProcess {
  processId: number;
  parentProcessId: number;
  name: string;
  executablePath: string | null;
  commandLine: string | null;
  creationDate: string | null;
  status: string | null;
  threadCount: number;
  handleCount: number;
  workingSetSize: number;
  virtualSize: number;
  peakWorkingSetSize: number;
  pageFaults: number;
  pageFileUsage: number;
  peakPageFileUsage: number;
  kernelModeTime: number;
  userModeTime: number;
  priority: number;
  sessionId: number;
  owner: string | null;
  readOperationCount: number | null;
  writeOperationCount: number | null;
  readTransferCount: number | null;
  writeTransferCount: number | null;
}

export interface ProcessTreeNode {
  process: WindowsProcess;
  children: ProcessTreeNode[];
}

export interface ProcessStatistics {
  totalProcesses: number;
  totalThreads: number;
  totalHandles: number;
  totalWorkingSet: number;
  topCpuProcesses: WindowsProcess[];
  topMemoryProcesses: WindowsProcess[];
}

// ─── Event Log ──────────────────────────────────────────────────────

export type EventLogLevel =
  | "error"
  | "warning"
  | "information"
  | "auditSuccess"
  | "auditFailure"
  | "unknown";

export interface EventLogEntry {
  recordNumber: number;
  logFile: string;
  eventCode: number;
  eventIdentifier: number;
  eventType: EventLogLevel;
  sourceName: string;
  category: number | null;
  categoryString: string | null;
  timeGenerated: string;
  timeWritten: string;
  message: string | null;
  computerName: string;
  user: string | null;
  insertionStrings: string[];
  data: number[];
}

export interface EventLogInfo {
  name: string;
  fileName: string;
  numberOfRecords: number;
  maxFileSize: number;
  currentSize: number;
  overwritePolicy: string;
  overwriteOutdated: number | null;
  sources: string[];
  status: string;
}

export interface EventLogFilter {
  logNames: string[];
  levels: EventLogLevel[];
  sources: string[];
  eventIds: number[];
  startTime: string | null;
  endTime: string | null;
  messageContains: string | null;
  computerName: string | null;
  maxResults: number;
  newestFirst: boolean;
}

// ─── Registry ───────────────────────────────────────────────────────

export type RegistryHive =
  | "hkeyClassesRoot"
  | "hkeyCurrentUser"
  | "hkeyLocalMachine"
  | "hkeyUsers"
  | "hkeyCurrentConfig";

export type RegistryValueType =
  | "string"
  | "expandString"
  | "binary"
  | "dWord"
  | "multiString"
  | "qWord"
  | "unknown";

export interface RegistryValue {
  name: string;
  valueType: RegistryValueType;
  data: unknown;
}

export interface RegistryKeyInfo {
  hive: RegistryHive;
  path: string;
  subkeys: string[];
  values: RegistryValue[];
}

export interface RegistryTreeNode {
  hive: RegistryHive;
  path: string;
  name: string;
  values: RegistryValue[];
  children: RegistryTreeNode[];
}

export interface RegistrySearchFilter {
  hive: RegistryHive;
  rootPath: string;
  pattern: string;
  isRegex: boolean;
  searchKeys: boolean;
  searchValueNames: boolean;
  searchValueData: boolean;
  maxDepth: number;
  maxResults: number;
}

export interface RegistrySearchResult {
  hive: RegistryHive;
  path: string;
  matchType: "keyName" | "valueName" | "valueData";
  matchedText: string;
  value: RegistryValue | null;
}

// ─── Scheduled Tasks ────────────────────────────────────────────────

export type ScheduledTaskState =
  | "ready"
  | "running"
  | "disabled"
  | "queued"
  | "unknown";

export interface ScheduledTaskAction {
  actionType: string;
  execute: string | null;
  arguments: string | null;
  workingDirectory: string | null;
}

export interface ScheduledTaskTrigger {
  triggerType: string;
  enabled: boolean;
  startBoundary: string | null;
  endBoundary: string | null;
  repetitionInterval: string | null;
  repetitionDuration: string | null;
}

export interface ScheduledTaskPrincipal {
  userId: string | null;
  runLevel: string | null;
  logonType: string | null;
}

export interface ScheduledTask {
  taskName: string;
  taskPath: string;
  state: ScheduledTaskState;
  description: string | null;
  author: string | null;
  date: string | null;
  uri: string | null;
  lastRunTime: string | null;
  lastTaskResult: number | null;
  nextRunTime: string | null;
  numberOfMissedRuns: number | null;
  actions: ScheduledTaskAction[];
  triggers: ScheduledTaskTrigger[];
  principal: ScheduledTaskPrincipal | null;
}

// ─── Performance ────────────────────────────────────────────────────

export interface CpuPerformance {
  totalUsagePercent: number;
  perCoreUsage: number[];
  privilegedTimePercent: number;
  userTimePercent: number;
  interruptTimePercent: number;
  dpcTimePercent: number;
  idleTimePercent: number;
  processorQueueLength: number;
  contextSwitchesPerSec: number;
  systemCallsPerSec: number;
}

export interface MemoryPerformance {
  totalPhysicalBytes: number;
  availableBytes: number;
  usedPercent: number;
  committedBytes: number;
  commitLimit: number;
  pagesPerSec: number;
  pageFaultsPerSec: number;
  cacheBytes: number;
  poolPagedBytes: number;
  poolNonpagedBytes: number;
}

export interface DiskPerformance {
  name: string;
  readBytesPerSec: number;
  writeBytesPerSec: number;
  readsPerSec: number;
  writesPerSec: number;
  avgDiskQueueLength: number;
  percentDiskTime: number;
  avgSecPerRead: number;
  avgSecPerWrite: number;
  freeSpaceBytes: number | null;
  totalSizeBytes: number | null;
}

export interface NetworkPerformance {
  name: string;
  bytesReceivedPerSec: number;
  bytesSentPerSec: number;
  bytesTotalPerSec: number;
  packetsReceivedPerSec: number;
  packetsSentPerSec: number;
  currentBandwidth: number;
  outputQueueLength: number;
  packetsReceivedErrors: number;
  packetsOutboundErrors: number;
  packetsReceivedDiscarded: number;
  packetsOutboundDiscarded: number;
}

export interface SystemCounters {
  processes: number;
  threads: number;
  systemUpTime: number;
  fileDataOperationsPerSec: number;
  fileReadOperationsPerSec: number;
  fileWriteOperationsPerSec: number;
  handleCount: number | null;
}

// Note: contextSwitchesPerSec and systemCallsPerSec are on CpuPerformance, not SystemCounters

export interface SystemPerformanceSnapshot {
  timestamp: string;
  cpu: CpuPerformance;
  memory: MemoryPerformance;
  disks: DiskPerformance[];
  network: NetworkPerformance[];
  system: SystemCounters;
}

export interface QuickHealthSummary {
  cpuUsagePercent: number;
  memoryUsedPercent: number;
  topCpuProcess: string | null;
  topMemoryProcess: string | null;
  diskQueueLength: number;
  networkUtilizationPercent: number;
  systemUpTimeSeconds: number;
  processCount: number;
  threadCount: number;
}

// ─── System Info ────────────────────────────────────────────────────

export interface ComputerSystemInfo {
  name: string;
  domain: string;
  manufacturer: string;
  model: string;
  totalPhysicalMemory: number;
  numberOfProcessors: number;
  numberOfLogicalProcessors: number;
  domainRole: string;
  partOfDomain: boolean;
  currentTimeZone: number | null;
  dnsHostName: string | null;
  workgroup: string | null;
  systemType: string;
  primaryOwnerName: string | null;
  userName: string | null;
}

export interface OperatingSystemInfo {
  caption: string;
  version: string;
  buildNumber: string;
  osArchitecture: string;
  serialNumber: string;
  installDate: string | null;
  lastBootUpTime: string | null;
  localDateTime: string | null;
  registeredUser: string | null;
  organization: string | null;
  windowsDirectory: string;
  systemDirectory: string;
  freePhysicalMemory: number;
  totalVisibleMemorySize: number;
  freeVirtualMemory: number;
  totalVirtualMemorySize: number;
  numberOfProcesses: number;
  numberOfUsers: number;
  servicePackMajorVersion: number | null;
  servicePackMinorVersion: number | null;
  csName: string;
  status: string;
}

export interface BiosInfo {
  manufacturer: string;
  name: string;
  serialNumber: string;
  version: string;
  smbiosBiosVersion: string | null;
  releaseDate: string | null;
}

export interface ProcessorInfo {
  name: string;
  deviceId: string;
  manufacturer: string;
  numberOfCores: number;
  numberOfLogicalProcessors: number;
  maxClockSpeed: number;
  currentClockSpeed: number;
  l2CacheSize: number | null;
  l3CacheSize: number | null;
  architecture: string;
  loadPercentage: number | null;
  addressWidth: number;
  status: string;
}

export interface LogicalDiskInfo {
  deviceId: string;
  driveType: string;
  fileSystem: string | null;
  freeSpace: number;
  size: number;
  volumeName: string | null;
  volumeSerialNumber: string | null;
  compressed: boolean;
  usedPercent: number;
}

export interface NetworkAdapterInfo {
  description: string;
  adapterType: string | null;
  macAddress: string | null;
  ipAddresses: string[];
  ipSubnets: string[];
  defaultIpGateway: string[];
  dnsServers: string[];
  dhcpEnabled: boolean;
  dhcpServer: string | null;
  speed: number | null;
  interfaceIndex: number;
  netConnectionId: string | null;
  netConnectionStatus: string | null;
}

export interface PhysicalMemoryInfo {
  bankLabel: string | null;
  capacity: number;
  deviceLocator: string;
  formFactor: string | null;
  manufacturer: string | null;
  memoryType: string | null;
  partNumber: string | null;
  serialNumber: string | null;
  speed: number | null;
  configuredClockSpeed: number | null;
}

export interface SystemInfo {
  computerSystem: ComputerSystemInfo;
  operatingSystem: OperatingSystemInfo;
  bios: BiosInfo;
  processors: ProcessorInfo[];
  logicalDisks: LogicalDiskInfo[];
  networkAdapters: NetworkAdapterInfo[];
  physicalMemory: PhysicalMemoryInfo[];
}

export interface QuickSystemSummary {
  hostname: string;
  osCaption: string;
  osVersion: string;
  totalMemoryGb: number;
  processorCount: number;
}

// ─── Session ────────────────────────────────────────────────────────

export interface SessionSummary {
  sessionId: string;
  hostname: string;
  protocol: string;
  port: number;
  namespace: string;
  state: string;
}
