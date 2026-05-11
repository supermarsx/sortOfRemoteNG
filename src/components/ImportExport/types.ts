import { Connection } from '../../types/connection/connection';
import {
  OpenVPNConnection,
  WireGuardConnection,
  TailscaleConnection,
  ZeroTierConnection,
} from '../../utils/network/proxyOpenVPNManager';
import { SavedTunnelChain } from '../../types/settings/settings';

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
    shape: 'array' | 'connections-object' | 'collection-export' | 'object' | 'unknown';
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
