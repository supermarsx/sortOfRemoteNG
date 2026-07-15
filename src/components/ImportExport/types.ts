import { Connection, type TunnelChainLayer } from '../../types/connection/connection';
import type { ExportFormat, ExportSecuritySettings } from '../../types/settings/settings';
import {
  OpenVPNConnection,
  WireGuardConnection,
  TailscaleConnection,
  ZeroTierConnection,
} from '../../utils/network/proxyOpenVPNManager';
import { SavedTunnelChain } from '../../types/settings/settings';

export type ExportScopeMode = 'current' | 'selected' | 'all';
export type ImportTargetMode = 'current' | 'selected' | 'all';

export interface ExportInclusionConfig {
  includeConnections: boolean;
  includeCredentials: boolean;
  includeSettings: boolean;
  includeFolderItems: boolean;
  includeEmptyFolders: boolean;
  includeTabGroups: boolean;
  includeColorTags: boolean;
  includeVpnData: boolean;
  includeTunnelChains: boolean;
  includeExportMetadata: boolean;
  includeDatabaseMetadata: boolean;
  includedProtocols: Connection['protocol'][];
  /** Specific connection ids to include. Empty array = all connections. */
  includedConnectionIds?: string[];
  /** Specific folder/group ids to include. Empty array = all folders. */
  includedFolderIds?: string[];
  /** Specific text tags to include. Empty array = all tags. */
  includedTextTags?: string[];
  /** Specific color tag ids to include. Empty array = all colors. */
  includedColorTagIds?: string[];
  /** Specific proxy profile ids. Empty array = all proxy profiles. */
  includedProxyProfileIds?: string[];
  /** Specific proxy chain ids. Empty array = all proxy chains. */
  includedProxyChainIds?: string[];
  /** Specific VPN connection ids. Empty array = all VPN connections. */
  includedVpnConnectionIds?: string[];
}

export interface ExportConfigUpdate extends Partial<Omit<ExportConfig, 'inclusion'>> {
  inclusion?: Partial<ExportInclusionConfig>;
}

export interface ExportDatabaseOption {
  id: string;
  name: string;
  description?: string;
  isCurrent: boolean;
  isEncrypted: boolean;
  isUnlocked: boolean;
  isExportable: boolean;
  lockedReason?: string;
  connectionCount?: number;
  lastAccessed?: string;
}

export interface ExportConfig {
  format: ExportFormat;
  scopeMode: ExportScopeMode;
  selectedDatabaseIds: string[];
  databaseOptions: ExportDatabaseOption[];
  inclusion: ExportInclusionConfig;
  includePasswords: boolean;
  encrypted: boolean;
  password: string;
  keyDerivationIterations: number;
  includeVpnData: boolean;
  includeTunnelChains: boolean;
  includeTabGroups: boolean;
  includeColorTags: boolean;
  strengthSettings: Pick<
    ExportSecuritySettings,
    | 'showPasswordStrength'
    | 'showEntropyBits'
    | 'minimumPasswordScore'
    | 'enforceMinimumPasswordScore'
    | 'detectCommonPasswords'
    | 'detectRepeatedCharacters'
    | 'detectSequentialPatterns'
    | 'rewardUncommonSymbols'
    | 'customCommonPasswords'
  >;
}

export interface ImportVpnData {
  openvpn: OpenVPNConnection[];
  wireguard: WireGuardConnection[];
  tailscale: TailscaleConnection[];
  zerotier: ZeroTierConnection[];
}

export type ImportIssueSeverity = 'error' | 'warning' | 'info';

export interface ImportIssue {
  severity: ImportIssueSeverity;
  code: string;
  message: string;
  field?: string;
  source?: string;
}

export type ImportPreviewItemKind = 'connection' | 'folder' | 'vpn' | 'tunnelChain' | 'sshTunnel';

export type ImportConflictStatus =
  | 'none'
  | 'sameId'
  | 'sameName'
  | 'sameEndpoint';

export interface ImportPreviewItem {
  id: string;
  kind: ImportPreviewItemKind;
  sourceIndex: number;
  sourcePath: string;
  name: string;
  protocol?: Connection['protocol'];
  hostname?: string;
  port?: number;
  username?: string;
  parentName?: string;
  tags: string[];
  connection?: Connection;
  vpnType?: keyof ImportVpnData;
  vpnConnection?: ImportVpnData[keyof ImportVpnData][number];
  tunnelChainTemplate?: SavedTunnelChain;
  sshTunnelConnectionId?: string;
  sshTunnelLayers?: TunnelChainLayer[];
  importable: boolean;
  selectedByDefault: boolean;
  conflictStatus: ImportConflictStatus;
  duplicateOf?: string;
  issues: ImportIssue[];
}

export interface ImportSourceMetadata {
  filename: string;
  extension?: string;
  sizeBytes?: number;
  format: string;
  formatName: string;
  detectedFormat?: string;
  detectedFormatName?: string;
  formatForced?: boolean;
  formatWarning?: string;
  detectedAt: string;
  confidence: 'high' | 'medium' | 'low';
  encrypted: boolean;
  sourceApplication?: string;
  rootName?: string;
  counts: {
    totalItems: number;
    connections: number;
    folders: number;
    vpnConnections: number;
    tunnelChains: number;
    sshTunnels: number;
    warnings: number;
    errors: number;
    conflicts: number;
  };
  encryption?: {
    protected: boolean;
    fullFileEncryption: boolean;
    requiresPassword: boolean;
    defaultMasterPasswordAccepted?: boolean;
  };
  csv?: {
    headers: string[];
    dataRows: number;
  };
  json?: {
    shape: 'array' | 'connections-object' | 'collection-export' | 'database-package' | 'object' | 'unknown';
    topLevelKeys: string[];
  };
  xml?: {
    rootElement?: string;
    nodeCount: number;
  };
}

export interface ImportFilterState {
  search: string;
  protocol: 'all' | Connection['protocol'];
  issueSeverity: 'all' | ImportIssueSeverity;
  itemKind: 'all' | ImportPreviewItemKind;
  selection: 'all' | 'selected' | 'unselected';
  conflict: 'all' | 'conflicts' | 'clean';
  missingHostnameOnly: boolean;
  withCredentialsOnly: boolean;
}

export interface ImportOptions {
  preserveFolders: boolean;
  includeCredentials: boolean;
  includeVpnData: boolean;
  includeTunnelChains: boolean;
  includeSshTunnels: boolean;
  conflictPolicy: 'duplicate' | 'skip' | 'rename';
  addTags: string;
  switchToTargetDatabaseAfterImport: boolean;
}

export interface ImportResult {
  success: boolean;
  imported: number;
  errors: string[];
  connections: Connection[];
  vpnConnections?: ImportVpnData;
  tunnelChainTemplates?: SavedTunnelChain[];
  analysis?: ImportSourceMetadata;
  previewItems?: ImportPreviewItem[];
  selectedIds?: string[];
  selectedCount?: number;
}

// ─── Clone ───────────────────────────────────────────────────────────
//
// Clone runs Export's source-scope + inclusion pipeline and pipes the
// result into one or more *other* databases via
// `databaseManager.appendConnectionsToDatabase`. Sidecar definitions
// are app-global, so they are cloned once per operation and cloned
// connections are remapped to the new sidecar ids.

export interface CloneConfig {
  /** Same scope semantics as Export: current open / explicitly
   *  selected / every available database. */
  sourceMode: ExportScopeMode;
  selectedSourceDatabaseIds: string[];
  /** Reused so the connection-level filters (protocol / tags / color
   *  tags / ids) work the same way users already know from Export. */
  inclusion: ExportInclusionConfig;

  /** Destinations the clone fans out to. Multi-target from V1 —
   *  the same connections are duplicated into every selected target. */
  targetDatabaseIds: string[];

  /** Conflict-resolution policy applied per target. Defaults to
   *  `duplicate` since clone is an explicit copy action. */
  conflictPolicy: ImportOptions['conflictPolicy'];

  /** Optional comma-separated list of tags to add to every cloned
   *  connection (mirrors Import's `addTags` field). */
  addTags: string;

  preserveFolders: boolean;

  /** Whether to carry credentials across. Defaults true for Clone
   *  (no trust-boundary crossing) — distinct from Import's default
   *  of false. */
  includeCredentials: boolean;

  /** When set, the active database becomes the (first) target
   *  after a successful clone. */
  switchToTargetDatabaseAfterClone: boolean;
}

export interface CloneConfigUpdate extends Partial<Omit<CloneConfig, 'inclusion'>> {
  inclusion?: Partial<ExportInclusionConfig>;
}

export interface CloneSourceCatalogItem {
  key: string;
  sourceDatabaseId: string;
  sourceDatabaseName: string;
  connectionId: string;
  name: string;
  path: string;
  protocol: Connection['protocol'];
  protocolLabel?: string;
  hostname?: string;
  tags: string[];
  colorTag?: string;
  isGroup: boolean;
  parentId?: string;
  ancestorKeys: string[];
}

/** Outcome of a clone run, suitable for the result toast. */
export interface CloneResult {
  success: boolean;
  /** Total connections written across every target. */
  cloned: number;
  renamed: number;
  skipped: number;
  sidecarsCloned?: {
    total: number;
    proxyProfiles: number;
    proxyChains: number;
    tunnelChains: number;
    vpnConnections: number;
  };
  errors: string[];
  /** Per-destination outcome so the UI can show which target landed
   *  fully, which failed, and which had nothing to copy. */
  perTarget: Array<{
    databaseId: string;
    databaseName: string;
    cloned: number;
    error?: string;
  }>;
}
