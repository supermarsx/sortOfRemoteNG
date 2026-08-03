/**
 * Frontend mirror of `sorng-ftp/src/ftp/types.rs` for the direct FTP session
 * client. Serde uses camelCase for every DTO in that crate.
 */

export type FtpSecurityMode = "none" | "explicit" | "implicit";
export type FtpTransferType = "ascii" | "binary";
export type FtpDataChannelMode =
  | "passive"
  | "extendedPassive"
  | "active"
  | "extendedActive";

export interface FtpConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  security: FtpSecurityMode;
  allowPlaintext: boolean;
  transferType: FtpTransferType;
  dataChannelMode: FtpDataChannelMode;
  initialDirectory: string | null;
  connectTimeoutSec: number;
  dataTimeoutSec: number;
  keepaliveIntervalSec: number;
  acceptInvalidCerts: boolean;
  /**
   * Separate, explicit acknowledgement required when `acceptInvalidCerts` is
   * enabled. It must never be inferred from the certificate-bypass toggle.
   */
  acknowledgeInvalidCertRisk: boolean;
  /**
   * Keep partially downloaded files after a failed transfer. The saved
   * connection UI intentionally does not expose this until it can explain the
   * disk-retention and local-data privacy consequences.
   */
  retainIncompleteDownloads: boolean;
  utf8: boolean;
  activeBindAddress: string | null;
  label: string | null;
}

export interface FtpSessionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  security: FtpSecurityMode;
  connected: boolean;
  currentDirectory: string;
  serverBanner: string | null;
  systemType: string | null;
  features: string[];
  connectedAt: string;
  lastActivity: string;
  transferType: FtpTransferType;
  label: string | null;
  bytesUploaded: number;
  bytesDownloaded: number;
}

export type FtpEntryKind = "file" | "directory" | "symlink" | "unknown";
export type FtpSortField = "name" | "size" | "modified" | "kind";
export type FtpSortOrder = "asc" | "desc";

export interface FtpEntry {
  name: string;
  kind: FtpEntryKind;
  size: number;
  modified: string | null;
  permissions: string | null;
  owner: string | null;
  group: string | null;
  linkTarget: string | null;
  raw: string | null;
  facts: Record<string, string>;
}

export interface FtpListOptions {
  filter?: string | null;
  sortBy?: FtpSortField | null;
  sortOrder?: FtpSortOrder | null;
  showHidden?: boolean;
  preferMlsd?: boolean;
}

/**
 * Optional saved fields consumed by the FTP client. The editor/runtime
 * integration can add these to `Connection` without changing the backend DTO.
 */
export interface FtpSavedConnectionOptions {
  ftpSecurity?: FtpSecurityMode;
  /** Explicit, persisted consent to send credentials and files over plain FTP. */
  ftpAllowPlaintext?: boolean;
  ftpDataChannelMode?: Extract<
    FtpDataChannelMode,
    "passive" | "extendedPassive"
  >;
  ftpConnectTimeoutSec?: number;
  ftpDataTimeoutSec?: number;
  ftpAcceptInvalidCerts?: boolean;
  /**
   * Explicit per-connection consent for invalid FTPS certificates. Missing on
   * legacy profiles by design, so those profiles fail closed.
   */
  ftpAcknowledgeInvalidCertRisk?: boolean;
  ftpUtf8?: boolean;
}

export interface FtpTransferResult {
  direction: "upload" | "download";
  localPath: string;
  remotePath: string;
  bytesTransferred: number;
}

/** Source-audited surface exposed by the direct saved-session client. */
export const FTP_RUNTIME_CAPABILITIES = Object.freeze({
  list: true,
  mkdir: true,
  deleteFile: true,
  deleteDirectoryRecursive: true,
  rename: true,
  chmod: true,
  uploadFile: true,
  downloadFile: true,
  resumeUpload: false,
  resumeDownload: false,
  nativeFilesystemPaths: true,
  browserFileBytes: false,
  directTransferProgress: false,
  queueExecution: false,
  automaticKeepalive: false,
  asciiDirectTransfer: false,
  activeDataChannel: false,
  routedConnections: false,
} as const);
