// ─── Server Stats Types ─────────────────────────────────────────────────────
// Types for remote Linux server statistics gathered over SSH.

/** CPU usage and load information. */
export interface CpuStats {
  /** Overall CPU usage percentage (0–100) */
  usagePercent: number;
  /** Number of logical CPU cores */
  coreCount: number;
  /** 1-minute load average */
  loadAvg1: number;
  /** 5-minute load average */
  loadAvg5: number;
  /** 15-minute load average */
  loadAvg15: number;
  /** CPU model name (e.g. "Intel Xeon E5-2686 v4") */
  model: string;
}

/** Memory (RAM + swap) usage. */
export interface MemoryStats {
  /** Total physical RAM in bytes */
  totalBytes: number;
  /** Used RAM in bytes */
  usedBytes: number;
  /** Free RAM in bytes */
  freeBytes: number;
  /** Available RAM in bytes (includes buffers/cache) */
  availableBytes: number;
  /** RAM usage percentage (0–100) */
  usagePercent: number;
  /** Total swap in bytes */
  swapTotalBytes: number;
  /** Used swap in bytes */
  swapUsedBytes: number;
  /** Swap usage percentage (0–100) */
  swapUsagePercent: number;
}

/** A single mounted filesystem / disk partition. */
export interface DiskPartition {
  /** Filesystem / device name (e.g. "/dev/sda1") */
  filesystem: string;
  /** Mount point (e.g. "/", "/home") */
  mountPoint: string;
  /** Filesystem type (e.g. "ext4", "xfs") */
  fsType: string;
  /** Total capacity in bytes */
  totalBytes: number;
  /** Used space in bytes */
  usedBytes: number;
  /** Available space in bytes */
  availableBytes: number;
  /** Usage percentage (0–100) */
  usagePercent: number;
}

/** Disk I/O statistics (optional, requires /proc/diskstats access). */
export interface DiskIoStats {
  /** Total bytes read since boot */
  readBytes: number;
  /** Total bytes written since boot */
  writeBytes: number;
}

/** Overall disk stats. */
export interface DiskStats {
  /** Individual mount partitions */
  partitions: DiskPartition[];
  /** Disk I/O counters (may be null if not available) */
  io: DiskIoStats | null;
}

/** System uptime and basic OS identification. */
export interface SystemInfo {
  /** Human-readable uptime string (e.g. "14 days, 3:27") */
  uptime: string;
  /** Uptime in seconds */
  uptimeSeconds: number;
  /** Kernel version string (e.g. "5.15.0-91-generic") */
  kernelVersion: string;
  /** OS distribution pretty name (e.g. "Ubuntu 22.04.3 LTS") */
  osName: string;
  /** OS release version (e.g. "22.04") */
  osVersion: string;
  /** System hostname */
  hostname: string;
  /** CPU architecture (e.g. "x86_64", "aarch64") */
  architecture: string;
  /** Current server time (ISO 8601) */
  serverTime: string;
  /** Number of logged-in users */
  loggedInUsers: number;
}

/** A single firewall rule. */
export interface FirewallRule {
  /** Rule number / priority */
  ruleNumber: number;
  /** Chain (e.g. "INPUT", "OUTPUT", "FORWARD") */
  chain: string;
  /** Target action (e.g. "ACCEPT", "DROP", "REJECT") */
  target: string;
  /** Protocol (e.g. "tcp", "udp", "all") */
  protocol: string;
  /** Source address / CIDR */
  source: string;
  /** Destination address / CIDR */
  destination: string;
  /** Additional options or port specification */
  options: string;
}

/** Firewall configuration snapshot. */
export interface FirewallConfig {
  /** Which firewall tool is active ("iptables" | "nftables" | "ufw" | "firewalld" | "none") */
  backend: "iptables" | "nftables" | "ufw" | "firewalld" | "none";
  /** Whether the firewall is active / enabled */
  active: boolean;
  /** Parsed rules (best-effort) */
  rules: FirewallRule[];
  /** Raw firewall output for reference */
  rawOutput: string;
}

/** A single listening port / network socket. */
export interface ListeningPort {
  /** Protocol (tcp, tcp6, udp, udp6) */
  protocol: string;
  /** Local address (e.g. "0.0.0.0", "::") */
  localAddress: string;
  /** Local port number */
  localPort: number;
  /** Process name bound to the port (may be empty if permission denied) */
  processName: string;
  /** Process ID (0 if unknown) */
  pid: number;
  /** Socket state (e.g. "LISTEN", "ESTABLISHED") */
  state: string;
}

/** Port / network monitoring snapshot. */
export interface PortMonitorStats {
  /** Listening ports / services */
  listeningPorts: ListeningPort[];
  /** Total number of established connections */
  establishedConnections: number;
  /** Total number of TIME_WAIT sockets */
  timeWaitConnections: number;
}

/** Complete server stats snapshot gathered from a single collection run. */
export interface ServerStatsSnapshot {
  /** Timestamp when the snapshot was collected (ISO 8601) */
  collectedAt: string;
  /** SSH session ID that was used to gather stats */
  sessionId: string;
  /** Connection name / hostname for display */
  connectionName: string;
  /** CPU stats */
  cpu: CpuStats;
  /** Memory stats */
  memory: MemoryStats;
  /** Disk stats */
  disk: DiskStats;
  /** System / uptime info */
  system: SystemInfo;
  /** Firewall configuration */
  firewall: FirewallConfig;
  /** Port monitoring */
  ports: PortMonitorStats;
  /** Collection duration in milliseconds */
  collectionDurationMs: number;
  /** Any errors or warnings encountered during collection */
  warnings: string[];
  /** Which detection method worked for each section (e.g. cpu: "procfs", memory: "vm_stat") */
  detectedMethods?: Record<string, string>;
}

/** Which stats categories to collect (enables partial collection). */
export interface StatsCollectionOptions {
  cpu: boolean;
  memory: boolean;
  disk: boolean;
  system: boolean;
  firewall: boolean;
  ports: boolean;
}

/** Default: collect everything. */
export const defaultStatsCollectionOptions: StatsCollectionOptions = {
  cpu: true,
  memory: true,
  disk: true,
  system: true,
  firewall: true,
  ports: true,
};

/** Auto-refresh interval presets in seconds. */
export const REFRESH_INTERVALS = [
  { label: "Off", value: 0 },
  { label: "5s", value: 5 },
  { label: "10s", value: 10 },
  { label: "30s", value: 30 },
  { label: "60s", value: 60 },
] as const;
