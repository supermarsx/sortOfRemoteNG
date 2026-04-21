// SFTP TypeScript types — mirror of `src-tauri/crates/sorng-sftp/src/sftp/types.rs`.
// Keep in sync with the Rust side. Serde uses `rename_all = "camelCase"`, so all
// fields here are camelCase.

// ─── Connection & Authentication ──────────────────────────────────────────────

export type KnownHostsPolicy = 'ask' | 'acceptNew' | 'strict' | 'ignore';

export type SftpProxyType = 'socks5' | 'http' | 'jumpHost';

export interface SftpProxyConfig {
  proxyType: SftpProxyType;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

export interface SftpConnectionConfig {
  host: string;
  port?: number;
  username: string;
  password?: string | null;
  privateKeyPath?: string | null;
  privateKeyPassphrase?: string | null;
  privateKeyData?: string | null;
  useAgent?: boolean;
  knownHostsPolicy?: KnownHostsPolicy;
  timeoutSecs?: number;
  keepaliveIntervalSecs?: number;
  proxy?: SftpProxyConfig | null;
  bannerCallback?: boolean;
  compress?: boolean;
  initialDirectory?: string | null;
  label?: string | null;
  colorTag?: string | null;
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface SftpSessionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  authMethod: string;
  connected: boolean;
  label?: string | null;
  colorTag?: string | null;
  serverBanner: string | null;
  remoteHome: string | null;
  currentDirectory: string;
  connectedAt: string; // ISO-8601
  lastActivity: string;
  bytesUploaded: number;
  bytesDownloaded: number;
  operationsCount: number;
}

// ─── Directory Listing ────────────────────────────────────────────────────────

export type SftpEntryType =
  | 'file'
  | 'directory'
  | 'symlink'
  | 'blockDevice'
  | 'charDevice'
  | 'namedPipe'
  | 'socket'
  | 'unknown';

export type SftpSortField = 'name' | 'size' | 'modified' | 'type' | 'permissions';

export interface SftpDirEntry {
  name: string;
  path: string;
  entryType: SftpEntryType;
  size: number;
  permissions: number;
  permissionsString: string;
  ownerUid: number;
  groupGid: number;
  accessed: number | null;
  modified: number | null;
  isHidden: boolean;
  linkTarget: string | null;
}

export interface SftpListOptions {
  includeHidden?: boolean;
  sortBy?: SftpSortField;
  ascending?: boolean;
  filterGlob?: string | null;
  filterType?: SftpEntryType | null;
  recursive?: boolean;
  maxDepth?: number | null;
}

// ─── File Stat ────────────────────────────────────────────────────────────────

export interface SftpFileStat {
  path: string;
  size: number;
  permissions: number;
  permissionsString: string;
  ownerUid: number;
  groupGid: number;
  accessed: number | null;
  modified: number | null;
  entryType: SftpEntryType;
  linkTarget: string | null;
  isReadonly: boolean;
}

// ─── Permissions helpers ──────────────────────────────────────────────────────

export interface SftpChmodRequest {
  path: string;
  mode: number;
  recursive?: boolean;
}

export interface SftpChownRequest {
  path: string;
  uid?: number | null;
  gid?: number | null;
  recursive?: boolean;
}

// ─── Disk usage ───────────────────────────────────────────────────────────────

export interface DiskUsageResult {
  path: string;
  totalBytes: number;
  fileCount: number;
  directoryCount: number;
}

// ─── Transfer ─────────────────────────────────────────────────────────────────

export type TransferDirection = 'upload' | 'download';

export type ConflictResolution = 'overwrite' | 'skip' | 'rename' | 'resume' | 'ask';

export type TransferStatus =
  | 'queued'
  | 'inProgress'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'verifying';

export interface SftpTransferRequest {
  sessionId: string;
  localPath: string;
  remotePath: string;
  direction: TransferDirection;
  chunkSize?: number;
  resume?: boolean;
  onConflict?: ConflictResolution;
  preserveTimestamps?: boolean;
  preservePermissions?: boolean;
  bandwidthLimitKbps?: number | null;
  retryCount?: number;
  retryDelayMs?: number;
  verifyChecksum?: boolean;
}

export interface TransferProgress {
  transferId: string;
  sessionId: string;
  direction: TransferDirection;
  localPath: string;
  remotePath: string;
  totalBytes: number;
  transferredBytes: number;
  percent: number;
  speedBytesPerSec: number;
  etaSecs: number | null;
  status: TransferStatus;
  startedAt: string;
  error: string | null;
  retryAttempt: number;
}

export interface TransferResult {
  transferId: string;
  success: boolean;
  bytesTransferred: number;
  durationMs: number;
  averageSpeedBps: number;
  checksum: string | null;
  error: string | null;
}

// ─── Batch / Bulk ─────────────────────────────────────────────────────────────

export type BatchErrorPolicy = 'continue' | 'abort' | 'skip';

export interface SftpBatchItem {
  localPath: string;
  remotePath: string;
  direction: TransferDirection;
}

export interface SftpBatchTransfer {
  sessionId: string;
  items: SftpBatchItem[];
  concurrency?: number;
  onError?: BatchErrorPolicy;
  chunkSize?: number;
  verifyChecksums?: boolean;
}

export interface BatchTransferResult {
  totalItems: number;
  succeeded: number;
  failed: number;
  skipped: number;
  totalBytes: number;
  durationMs: number;
  results: TransferResult[];
}

// ─── Queue ────────────────────────────────────────────────────────────────────

export interface QueueEntry {
  id: string;
  request: SftpTransferRequest;
  priority: number;
  addedAt: string;
  status: TransferStatus;
  progress: TransferProgress | null;
}

export interface QueueStatus {
  total: number;
  pending: number;
  active: number;
  completed: number;
  failed: number;
  totalBytesRemaining: number;
  isRunning: boolean;
}

// ─── Watch / Sync ─────────────────────────────────────────────────────────────

export interface WatchConfig {
  sessionId: string;
  remotePath: string;
  localPath: string;
  intervalSecs?: number;
  autoDownload?: boolean;
  autoUpload?: boolean;
  recursive?: boolean;
  ignorePatterns?: string[];
}

export type WatchEventType = 'created' | 'modified' | 'deleted' | 'renamed';

export interface WatchEvent {
  watchId: string;
  eventType: WatchEventType;
  path: string;
  timestamp: string;
}

export interface WatchInfo {
  id: string;
  remotePath: string;
  localPath: string;
  sessionId: string;
  active: boolean;
  intervalSecs: number;
}

export interface SyncResult {
  direction: string;
  filesTransferred: number;
  filesSkipped: number;
  filesErrored: number;
  timestamp: string; // ISO-8601
}

// ─── Bookmarks ────────────────────────────────────────────────────────────────

export interface SftpBookmark {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  remotePath: string;
  localPath?: string | null;
  colorTag?: string | null;
  group?: string | null;
  createdAt: string;
  lastUsed: string | null;
  useCount: number;
}

// ─── Diagnostics ──────────────────────────────────────────────────────────────

export interface SftpDiagnosticStep {
  name: string;
  passed: boolean;
  message: string;
  durationMs: number;
}

export interface ThroughputResult {
  uploadBps: number;
  downloadBps: number;
  testSizeBytes: number;
}

export interface SftpDiagnosticReport {
  sessionId: string;
  host: string;
  protocolVersion: string;
  serverExtensions: string[];
  maxPacketSize: number;
  latencyMs: number;
  throughputTest: ThroughputResult | null;
  steps: SftpDiagnosticStep[];
}
