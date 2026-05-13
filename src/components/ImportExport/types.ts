import { Connection } from '../../types/connection/connection';
import type { ExportFormat, ExportSecuritySettings } from '../../types/settings/settings';
import {
  OpenVPNConnection,
  WireGuardConnection,
  TailscaleConnection,
  ZeroTierConnection,
} from '../../utils/network/proxyOpenVPNManager';
import { SavedTunnelChain } from '../../types/settings/settings';

export type ExportScopeMode = 'current' | 'selected' | 'all';

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
  /** Specific text tags to include. Empty array = all tags. */
  includedTextTags?: string[];
  /** Specific color tag ids to include. Empty array = all colors. */
  includedColorTagIds?: string[];
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

export type ImportPreviewItemKind = 'connection' | 'folder' | 'vpn' | 'tunnelChain';

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
  conflictPolicy: 'duplicate' | 'skip' | 'rename';
  addTags: string;
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
