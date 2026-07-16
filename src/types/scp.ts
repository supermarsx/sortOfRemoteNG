/**
 * Renderer contracts for `sorng-scp`.
 *
 * The Rust DTOs use `#[serde(rename_all = "camelCase")]`; keep the property
 * names here aligned with `src-tauri/crates/sorng-scp/src/scp/types.rs`.
 */

export type ScpKnownHostsPolicy = "ask" | "acceptNew" | "strict" | "ignore";

export interface ScpConnectionConfig {
  host: string;
  port?: number;
  username: string;
  password?: string | null;
  privateKeyPath?: string | null;
  privateKeyPassphrase?: string | null;
  privateKeyData?: string | null;
  useAgent?: boolean;
  knownHostsPolicy?: ScpKnownHostsPolicy;
  knownHostsPath?: string | null;
  timeoutSecs?: number;
  keepaliveIntervalSecs?: number;
  proxy?: null;
  compress?: boolean;
  label?: string | null;
  colorTag?: string | null;
  preferredCiphers?: string | null;
  preferredMacs?: string | null;
  preferredKex?: string | null;
}

export interface ScpSessionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  authMethod: string;
  connected: boolean;
  label?: string | null;
  colorTag?: string | null;
  serverBanner?: string | null;
  remoteHome?: string | null;
  connectedAt: string;
  lastActivity: string;
  bytesUploaded: number;
  bytesDownloaded: number;
  transfersCount: number;
  serverFingerprint?: string | null;
}

export interface ScpRemoteDirEntry {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
  mode?: string | null;
  mtime?: string | null;
  owner?: string | null;
  group?: string | null;
}

export interface ScpRemoteFileInfo {
  path: string;
  size: number;
  mode: number;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
  mtime?: string | null;
  atime?: string | null;
  owner?: string | null;
  group?: string | null;
}

export interface ScpTransferRequest {
  sessionId: string;
  localPath: string;
  remotePath: string;
  chunkSize?: number;
  verifyChecksum?: boolean;
  retryCount?: number;
  retryDelayMs?: number;
  fileMode?: number;
  preserveTimes?: boolean;
  createParents?: boolean;
  overwrite?: boolean;
}

export interface ScpDirectoryTransferRequest {
  sessionId: string;
  localPath: string;
  remotePath: string;
  chunkSize?: number;
  verifyChecksum?: boolean;
  retryCount?: number;
  retryDelayMs?: number;
  fileMode?: number;
  dirMode?: number;
  preserveTimes?: boolean;
  preservePermissions?: boolean;
  includePattern?: string | null;
  excludePattern?: string | null;
  followSymlinks?: boolean;
  maxDepth?: number | null;
  overwrite?: boolean;
}

export type ScpTransferDirection = "upload" | "download";

export type ScpTransferStatus =
  | "pending"
  | "inProgress"
  | "paused"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export interface ScpTransferResult {
  transferId: string;
  direction: ScpTransferDirection;
  localPath: string;
  remotePath: string;
  bytesTransferred: number;
  durationMs: number;
  averageSpeed: number;
  checksum?: string | null;
  success: boolean;
  error?: string | null;
}

export interface ScpDirectoryTransferResult {
  transferId: string;
  direction: ScpTransferDirection;
  localPath: string;
  remotePath: string;
  filesTransferred: number;
  filesFailed: number;
  filesSkipped: number;
  totalBytes: number;
  durationMs: number;
  averageSpeed: number;
  errors: string[];
}

export interface ScpTransferProgress {
  transferId: string;
  sessionId: string;
  direction: ScpTransferDirection;
  localPath: string;
  remotePath: string;
  totalBytes: number;
  transferredBytes: number;
  percent: number;
  speedBytesPerSec: number;
  etaSecs?: number | null;
  status: ScpTransferStatus;
  startedAt: string;
  error?: string | null;
  retryAttempt: number;
  currentFile?: string | null;
  filesTotal: number;
  filesCompleted: number;
}

/** Operations exposed by the direct saved-session client. */
export const SCP_RUNTIME_CAPABILITIES = Object.freeze({
  list: true,
  stat: true,
  mkdir: true,
  deleteFile: true,
  deleteDirectoryRecursive: true,
  uploadFile: true,
  downloadFile: true,
  uploadDirectory: true,
  downloadDirectory: true,
  checksum: true,
  cancelTransfer: false,
  liveTransferProgress: false,
  rename: false,
  copyRemote: false,
  moveRemote: false,
  chmod: false,
  chown: false,
  symlink: false,
  textEdit: false,
  resumableTransfer: false,
  pauseTransfer: false,
  automaticKeepalive: false,
  verifiedHostKey: true,
  customKnownHostsPath: true,
  interactiveHostKeyPrompt: false,
  proxyRouting: false,
  agentAuth: false,
} as const);
