import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Connection, ConnectionDatabase } from '../../types/connection/connection';
import { useConnections } from '../../contexts/useConnections';
import { useToastContext } from '../../contexts/ToastContext';
import { DatabaseManager, type DatabaseExportSnapshot } from '../../utils/connection/databaseManager';
import { SettingsManager } from '../../utils/settings/settingsManager';
import {
  ExportDatabaseOption,
  ExportInclusionConfig,
  ExportScopeMode,
  ImportFilterState,
  ImportOptions,
  ImportPreviewItem,
  ImportResult,
  ImportSourceMetadata,
  ImportVpnData,
} from '../../components/ImportExport/types';
import {
  encryptWithPassword,
  decryptWithPassword,
  isWebCryptoPayload,
  normalizePbkdf2Iterations,
} from '../../utils/crypto/webCryptoAes';
import {
  encryptExport,
  type ExportFormat,
} from '../../utils/crypto/exportEncryption';
import { analyzePasswordStrength } from '../security/usePasswordStrength';
import {
  defaultExportSecuritySettings,
  type ExportFormat,
  type ExportSecuritySettings,
} from '../../types/settings/settings';
import {
  importConnections,
  detectImportFormat,
  getFormatName,
  detectMRemoteNGEncryption,
  decryptMRemoteNGXml,
  verifyMRemoteNGPassword,
  MREMOTENG_DEFAULT_MASTER_PASSWORD,
} from '../../components/ImportExport/utils';
import { ProxyOpenVPNManager } from '../../utils/network/proxyOpenVPNManager';
import { proxyCollectionManager } from '../../utils/connection/proxyCollectionManager';
import { generateId } from '../../utils/core/id';

const DEFAULT_IMPORT_FILTERS: ImportFilterState = {
  search: '',
  protocol: 'all',
  issueSeverity: 'all',
  itemKind: 'all',
  selection: 'all',
  conflict: 'all',
  missingHostnameOnly: false,
  withCredentialsOnly: false,
};

const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  preserveFolders: true,
  includeCredentials: true,
  includeVpnData: true,
  includeTunnelChains: true,
  conflictPolicy: 'duplicate',
  addTags: '',
};

const EMPTY_IMPORT_PREVIEW_ITEMS: ImportPreviewItem[] = [];

interface ExportInventoryRow {
  databaseId: string;
  databaseName: string;
  id: string;
  name: string;
  kind: string;
  protocol: string;
  hostname: string;
  port: string;
  username: string;
  domain: string;
  description: string;
  path: string;
  parentId: string;
  tags: string;
  hasCredentials: string;
  createdAt: string;
  updatedAt: string;
}

interface ExportInventorySummary {
  totalItems: number;
  folders: number;
  leafConnections: number;
  credentialConnections: number;
  protocolCount: number;
}

interface ExportDatabaseDataset {
  databaseId: string;
  databaseName: string;
  databaseDescription?: string;
  isCurrent: boolean;
  isEncrypted: boolean;
  connections: Connection[];
  settings: Record<string, unknown>;
  tabGroups: DatabaseExportSnapshot['tabGroups'];
  colorTags: DatabaseExportSnapshot['colorTags'];
}

interface ExportSidecars {
  vpnConnections?: ImportVpnData;
  tunnelChainTemplates?: ImportResult['tunnelChainTemplates'];
  proxyProfiles?: ReturnType<typeof proxyCollectionManager.getProfiles>;
  proxyChains?: ReturnType<typeof proxyCollectionManager.getChains>;
}

interface ExportBuildResult {
  datasets: ExportDatabaseDataset[];
  options: ExportDatabaseOption[];
  effectiveDatabaseIds: string[];
}

const EXPORT_PACKAGE_SCHEMA = 'sortOfRemoteNG.database-export-package';
const EXPORT_PACKAGE_VERSION = 1;
const EXPORT_SINGLE_DATABASE_SCHEMA = 'sortOfRemoteNG.database-export';
const EXPORT_CLIENT_ID_STORAGE_KEY = 'mremote-export-client-id';
const SECRET_PLACEHOLDER = '***ENCRYPTED***';

const createDefaultExportInclusion = (
  settings: ExportSecuritySettings,
): ExportInclusionConfig => ({
  includeConnections: settings.includeConnectionsByDefault,
  includeCredentials: settings.includePasswordsByDefault,
  includeSettings: settings.includeSettingsByDefault,
  includeFolderItems: settings.includeFolderItemsByDefault,
  includeEmptyFolders: settings.includeEmptyFoldersByDefault,
  includeTabGroups: settings.includeTabGroupsByDefault,
  includeColorTags: settings.includeColorTagsByDefault,
  includeVpnData: settings.includeVpnDataByDefault,
  includeTunnelChains: settings.includeTunnelChainsByDefault,
  includeExportMetadata: settings.includeExportMetadataByDefault,
  includeDatabaseMetadata: settings.includeDatabaseMetadataByDefault,
  includedProtocols: [],
});

const EXPORT_INVENTORY_COLUMNS: Array<{
  key: keyof ExportInventoryRow;
  label: string;
}> = [
  { key: 'name', label: 'Name' },
  { key: 'kind', label: 'Kind' },
  { key: 'protocol', label: 'Protocol' },
  { key: 'hostname', label: 'Hostname' },
  { key: 'port', label: 'Port' },
  { key: 'username', label: 'Username' },
  { key: 'domain', label: 'Domain' },
  { key: 'path', label: 'Path' },
  { key: 'tags', label: 'Tags' },
  { key: 'hasCredentials', label: 'Has credentials' },
  { key: 'description', label: 'Description' },
  { key: 'createdAt', label: 'Created' },
  { key: 'updatedAt', label: 'Updated' },
];

const EXPORT_INVENTORY_DATABASE_COLUMNS: Array<{
  key: keyof ExportInventoryRow;
  label: string;
}> = [
  { key: 'databaseName', label: 'Database' },
  { key: 'databaseId', label: 'Database ID' },
];

const getExportInventoryColumns = (
  includeDatabaseColumns: boolean,
): Array<{ key: keyof ExportInventoryRow; label: string }> =>
  includeDatabaseColumns
    ? [...EXPORT_INVENTORY_DATABASE_COLUMNS, ...EXPORT_INVENTORY_COLUMNS]
    : EXPORT_INVENTORY_COLUMNS;

const getExportSecuritySettings = (
  settingsManager: SettingsManager,
): ExportSecuritySettings => {
  try {
    const managerWithOptionalGetter = settingsManager as SettingsManager & {
      getSettings?: () => { exportSecurity?: Partial<ExportSecuritySettings>; exportEncryption?: boolean };
    };
    const settings = managerWithOptionalGetter.getSettings?.();
    return {
      ...defaultExportSecuritySettings,
      ...(settings?.exportSecurity ?? {}),
      encryptByDefault:
        settings?.exportSecurity?.encryptByDefault ??
        settings?.exportEncryption ??
        defaultExportSecuritySettings.encryptByDefault,
      keyDerivationIterations: normalizePbkdf2Iterations(
        settings?.exportSecurity?.keyDerivationIterations ??
          defaultExportSecuritySettings.keyDerivationIterations,
      ),
    };
  } catch {
    return defaultExportSecuritySettings;
  }
};

const normalizeSearch = (value: string): string => value.trim().toLowerCase();

const safeString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
};

const safeTrimmedLower = (value: unknown): string =>
  safeString(value).trim().toLowerCase();

const safeTags = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((tag) => safeString(tag)).filter(Boolean) : [];

const splitTags = (value: string): string[] =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

const SECRET_FIELD_NAMES = new Set([
  'password',
  'basicauthpassword',
  'rustdeskpassword',
  'proxypassword',
  'privatekey',
  'passphrase',
  'totpsecret',
  'apikey',
  'accesstoken',
  'clientsecret',
  'serviceaccountkey',
  'presharedkey',
  'authkey',
  'authtoken',
  'seedphrase',
  'answer',
]);

const SECRET_HEADER_NAMES = /authorization|cookie|token|secret|password|api[-_ ]?key/i;

const normalizeSecretFieldName = (value: string): string =>
  value.replace(/[^a-z0-9]/gi, '').toLowerCase();

const hasSecretishValue = (value: unknown, fieldName?: string): boolean => {
  const normalizedFieldName = fieldName ? normalizeSecretFieldName(fieldName) : '';
  if (normalizedFieldName && SECRET_FIELD_NAMES.has(normalizedFieldName)) {
    return value !== undefined && value !== null && value !== '';
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasSecretishValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, nestedValue]) =>
      hasSecretishValue(nestedValue, key),
    );
  }
  return false;
};

const connectionHasCredentials = (connection: Connection): boolean =>
  hasSecretishValue(connection);

const redactSecretFields = <T,>(value: T, fieldName?: string): T | undefined => {
  const normalizedFieldName = fieldName ? normalizeSecretFieldName(fieldName) : '';
  if (normalizedFieldName && SECRET_FIELD_NAMES.has(normalizedFieldName)) {
    return normalizedFieldName.includes('password') ? (SECRET_PLACEHOLDER as T) : undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => redactSecretFields(item))
      .filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
      if (key === 'httpHeaders' && nestedValue && typeof nestedValue === 'object') {
        next[key] = Object.fromEntries(
          Object.entries(nestedValue as Record<string, unknown>).filter(
            ([headerName]) => !SECRET_HEADER_NAMES.test(headerName),
          ),
        );
        return;
      }

      const redactedValue = redactSecretFields(nestedValue, key);
      if (redactedValue !== undefined) {
        next[key] = redactedValue;
      }
    });
    return next as T;
  }

  return value;
};

const redactConnectionSecretsForExport = (connection: Connection): Connection => {
  return redactSecretFields(connection) ?? { ...connection };
};

const stripSecretFields = <T,>(value: T, fieldName?: string): T | undefined => {
  const normalizedFieldName = fieldName ? normalizeSecretFieldName(fieldName) : '';
  if (normalizedFieldName && SECRET_FIELD_NAMES.has(normalizedFieldName)) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => stripSecretFields(item))
      .filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
      if (key === 'httpHeaders' && nestedValue && typeof nestedValue === 'object') {
        next[key] = Object.fromEntries(
          Object.entries(nestedValue as Record<string, unknown>).filter(
            ([headerName]) => !SECRET_HEADER_NAMES.test(headerName),
          ),
        );
        return;
      }

      const strippedValue = stripSecretFields(nestedValue, key);
      if (strippedValue !== undefined) {
        next[key] = strippedValue;
      }
    });
    return next as T;
  }

  return value;
};

const stripConnectionCredentials = (connection: Connection): Connection =>
  stripSecretFields(connection) ?? { ...connection };

const connectionEndpointKey = (connection: Connection): string =>
  [
    safeTrimmedLower(connection.protocol),
    safeTrimmedLower(connection.hostname),
    String(Number(connection.port) || 0),
    safeTrimmedLower(connection.username),
  ].join('|');

const getParentNameById = (connections: Connection[], parentId?: string): string | undefined => {
  if (!parentId) return undefined;
  const parent = connections.find((connection) => connection.id === parentId);
  return parent ? safeString(parent.name) : undefined;
};

const getConnectionPath = (
  connection: Connection,
  connectionsById: Map<string, Connection>,
): string => {
  const names = [safeString(connection.name) || 'Unnamed item'];
  let parentId = connection.parentId;
  const seen = new Set<string>();

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = connectionsById.get(parentId);
    if (!parent) break;
    names.unshift(safeString(parent.name) || 'Unnamed folder');
    parentId = parent.parentId;
  }

  return names.join(' / ');
};

const normalizeIncludedProtocols = (
  protocols: Connection['protocol'][] = [],
): Connection['protocol'][] => Array.from(new Set(protocols)).sort();

const getIncludedProtocolSet = (
  inclusion: ExportInclusionConfig,
): Set<Connection['protocol']> | null =>
  inclusion.includedProtocols.length > 0
    ? new Set(inclusion.includedProtocols)
    : null;

const filterConnectionsForExport = (
  connections: Connection[],
  inclusion: ExportInclusionConfig,
): Connection[] => {
  if (!inclusion.includeConnections) return [];

  const includedProtocolSet = getIncludedProtocolSet(inclusion);
  const includedConnectionIdSet =
    (inclusion.includedConnectionIds ?? []).length > 0
      ? new Set(inclusion.includedConnectionIds)
      : null;
  const includedTextTagSet =
    (inclusion.includedTextTags ?? []).length > 0
      ? new Set(inclusion.includedTextTags)
      : null;
  const includedColorTagIdSet =
    (inclusion.includedColorTagIds ?? []).length > 0
      ? new Set(inclusion.includedColorTagIds)
      : null;
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const leafConnections = connections.filter(
    (connection) =>
      !connection.isGroup &&
      (!includedProtocolSet || includedProtocolSet.has(connection.protocol)) &&
      (!includedConnectionIdSet || includedConnectionIdSet.has(connection.id)) &&
      (!includedTextTagSet ||
        (connection.tags ?? []).some((tag) => includedTextTagSet.has(tag))) &&
      (!includedColorTagIdSet ||
        (connection.colorTag != null && includedColorTagIdSet.has(connection.colorTag))),
  );
  const leafIds = new Set(leafConnections.map((connection) => connection.id));
  let keptFolderIds = new Set<string>();

  if (inclusion.includeFolderItems) {
    if (inclusion.includeEmptyFolders) {
      keptFolderIds = new Set(
        connections.filter((connection) => connection.isGroup).map((connection) => connection.id),
      );
    } else {
      leafConnections.forEach((connection) => {
        let parentId = connection.parentId;
        const visited = new Set<string>();
        while (parentId && !visited.has(parentId)) {
          visited.add(parentId);
          const parent = connectionsById.get(parentId);
          if (!parent || !parent.isGroup) break;
          keptFolderIds.add(parent.id);
          parentId = parent.parentId;
        }
      });
    }
  }

  const keptConnections = connections.filter((connection) =>
    connection.isGroup
      ? inclusion.includeFolderItems && keptFolderIds.has(connection.id)
      : leafIds.has(connection.id),
  );
  const keptIds = new Set(keptConnections.map((connection) => connection.id));

  return keptConnections.map((connection) =>
    connection.parentId && !keptIds.has(connection.parentId)
      ? { ...connection, parentId: undefined }
      : connection,
  );
};

const prepareConnectionsForExport = (
  connections: Connection[],
  inclusion: ExportInclusionConfig,
): Connection[] => {
  const filteredConnections = filterConnectionsForExport(connections, inclusion);
  return inclusion.includeCredentials
    ? filteredConnections
    : filteredConnections.map(redactConnectionSecretsForExport);
};

const getOrCreateExportClientId = (): string => {
  const fallback = () => `sorng-client-${generateId()}`;
  try {
    if (typeof localStorage === 'undefined') return fallback();
    const existing = localStorage.getItem(EXPORT_CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;
    const next = fallback();
    localStorage.setItem(EXPORT_CLIENT_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return fallback();
  }
};

const detectJsonShape = (content: string): ImportSourceMetadata['json'] => {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return { shape: 'array', topLevelKeys: [] };
    }
    if (!parsed || typeof parsed !== 'object') {
      return { shape: 'unknown', topLevelKeys: [] };
    }
    const keys = Object.keys(parsed);
    const shape = Array.isArray(parsed.databases)
      ? 'database-package'
      : Array.isArray(parsed.connections)
        ? keys.includes('version') || keys.includes('exportDate') || keys.includes('collection')
          ? 'collection-export'
          : 'connections-object'
        : 'object';
    return { shape, topLevelKeys: keys.slice(0, 20) };
  } catch {
    return { shape: 'unknown', topLevelKeys: [] };
  }
};

const detectCsvMetadata = (content: string): ImportSourceMetadata['csv'] => {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { headers: [], dataRows: 0 };
  const headers = lines[0].split(',').map((header) => header.trim().replace(/"/g, ''));
  return { headers, dataRows: Math.max(0, lines.length - 1) };
};

const detectXmlMetadata = (content: string): ImportSourceMetadata['xml'] => {
  try {
    const doc = new DOMParser().parseFromString(content, 'text/xml');
    const root = doc.documentElement;
    return {
      rootElement: root?.tagName,
      nodeCount: doc.querySelectorAll('Node, server, group, session').length,
    };
  } catch {
    return { nodeCount: 0 };
  }
};

const buildImportPreviewItems = (
  connections: Connection[],
  existingConnections: Connection[],
): ImportPreviewItem[] => {
  const importedById = new Map(
    connections.map((connection, index) => [
      safeString(connection.id) || `import-${index + 1}`,
      connection,
    ]),
  );
  const existingById = new Map(existingConnections.map((connection) => [connection.id, connection]));
  const existingNameKeys = new Map<string, Connection>();
  const existingEndpointKeys = new Map<string, Connection>();

  existingConnections.forEach((connection) => {
    const nameKey = `${connection.parentId || ''}|${safeTrimmedLower(connection.name)}`;
    existingNameKeys.set(nameKey, connection);
    if (!connection.isGroup && safeString(connection.hostname).trim()) {
      existingEndpointKeys.set(connectionEndpointKey(connection), connection);
    }
  });

  return connections.map((connection, index) => {
    const connectionId = safeString(connection.id) || `import-${index + 1}`;
    const name = safeString(connection.name);
    const hostname = safeString(connection.hostname);
    const username = safeString(connection.username);
    const port = Number(connection.port);
    const tags = safeTags(connection.tags);
    const issues: ImportPreviewItem['issues'] = [];
    let conflictStatus: ImportPreviewItem['conflictStatus'] = 'none';
    let duplicateOf: string | undefined;

    if (!name.trim()) {
      issues.push({
        severity: 'error',
        code: 'missing_name',
        field: 'name',
        message: 'Name is required.',
      });
    }

    if (!connection.isGroup && !hostname.trim()) {
      issues.push({
        severity: 'warning',
        code: 'missing_hostname',
        field: 'hostname',
        message: 'Hostname is empty.',
      });
    }

    if (!connection.isGroup && (!Number.isFinite(port) || port <= 0)) {
      issues.push({
        severity: 'warning',
        code: 'invalid_port',
        field: 'port',
        message: 'Port is missing or invalid.',
      });
    }

    const sameId = existingById.get(connectionId);
    if (sameId) {
      conflictStatus = 'sameId';
      duplicateOf = sameId.id;
    } else {
      const sameName = existingNameKeys.get(
        `${connection.parentId || ''}|${safeTrimmedLower(name)}`,
      );
      if (sameName) {
        conflictStatus = 'sameName';
        duplicateOf = sameName.id;
      } else if (!connection.isGroup && hostname.trim()) {
        const sameEndpoint = existingEndpointKeys.get(connectionEndpointKey(connection));
        if (sameEndpoint) {
          conflictStatus = 'sameEndpoint';
          duplicateOf = sameEndpoint.id;
        }
      }
    }

    if (conflictStatus !== 'none') {
      issues.push({
        severity: 'warning',
        code: `conflict_${conflictStatus}`,
        message:
          conflictStatus === 'sameEndpoint'
            ? 'Existing connection uses the same protocol, host, port, and username.'
            : conflictStatus === 'sameName'
              ? 'Existing item has the same name in the same folder.'
              : 'Existing item has the same id.',
      });
    }

    const importable = !issues.some((issue) => issue.severity === 'error');
    return {
      id: `${connection.isGroup ? 'folder' : 'connection'}:${connectionId}:${index}`,
      kind: connection.isGroup ? 'folder' : 'connection',
      sourceIndex: index + 1,
      sourcePath: getConnectionPath(connection, importedById),
      name: name || 'Unnamed item',
      protocol: connection.protocol,
      hostname,
      port: Number.isFinite(port) ? port : undefined,
      username,
      parentName: getParentNameById(connections, connection.parentId),
      tags,
      connection,
      importable,
      selectedByDefault: importable,
      conflictStatus,
      duplicateOf,
      issues,
    };
  });
};

const buildImportAnalysis = (params: {
  filename: string;
  sizeBytes?: number;
  format: string;
  formatName: string;
  content: string;
  connections: Connection[];
  previewItems: ImportPreviewItem[];
  vpnConnections?: ImportVpnData;
  tunnelChainTemplates?: ImportResult['tunnelChainTemplates'];
  encryption?: ImportSourceMetadata['encryption'];
}): ImportSourceMetadata => {
  const extension = params.filename
    .replace(/\.encrypted\./i, '.')
    .split('.')
    .pop()
    ?.toLowerCase();
  const warnings = params.previewItems.reduce(
    (count, item) =>
      count + item.issues.filter((issue) => issue.severity === 'warning').length,
    0,
  );
  const errors = params.previewItems.reduce(
    (count, item) =>
      count + item.issues.filter((issue) => issue.severity === 'error').length,
    0,
  );
  const conflicts = params.previewItems.filter(
    (item) => item.conflictStatus !== 'none',
  ).length;
  const rootName = (() => {
    if (!params.content.trim().startsWith('<')) return undefined;
    try {
      const doc = new DOMParser().parseFromString(params.content, 'text/xml');
      return (
        doc.documentElement?.getAttribute('Name') ||
        doc.documentElement?.tagName ||
        undefined
      );
    } catch {
      return undefined;
    }
  })();

  return {
    filename: params.filename,
    extension,
    sizeBytes: params.sizeBytes,
    format: params.format,
    formatName: params.formatName,
    detectedAt: new Date().toISOString(),
    confidence:
      params.format === 'csv' && !extension ? 'medium' : params.format === 'json' ? 'high' : 'high',
    encrypted: Boolean(params.encryption?.protected || params.encryption?.fullFileEncryption),
    sourceApplication: params.formatName,
    rootName,
    counts: {
      totalItems: params.previewItems.length,
      connections: params.connections.filter((connection) => !connection.isGroup).length,
      folders: params.connections.filter((connection) => connection.isGroup).length,
      vpnConnections: params.vpnConnections
        ? params.vpnConnections.openvpn.length +
          params.vpnConnections.wireguard.length +
          params.vpnConnections.tailscale.length +
          params.vpnConnections.zerotier.length
        : 0,
      tunnelChains: params.tunnelChainTemplates?.length || 0,
      warnings,
      errors,
      conflicts,
    },
    encryption: params.encryption,
    csv: params.format === 'csv' ? detectCsvMetadata(params.content) : undefined,
    json: params.format === 'json' ? detectJsonShape(params.content) : undefined,
    xml: params.content.trim().startsWith('<') ? detectXmlMetadata(params.content) : undefined,
  };
};

const filterImportPreviewItems = (
  items: ImportPreviewItem[],
  filters: ImportFilterState,
  selectedIds: Set<string>,
): ImportPreviewItem[] => {
  const query = normalizeSearch(filters.search);
  return items.filter((item) => {
    if (filters.protocol !== 'all' && item.protocol !== filters.protocol) return false;
    if (filters.issueSeverity !== 'all' && !item.issues.some((issue) => issue.severity === filters.issueSeverity)) {
      return false;
    }
    if (filters.itemKind !== 'all' && item.kind !== filters.itemKind) return false;
    if (filters.selection === 'selected' && !selectedIds.has(item.id)) return false;
    if (filters.selection === 'unselected' && selectedIds.has(item.id)) return false;
    if (filters.conflict === 'conflicts' && item.conflictStatus === 'none') return false;
    if (filters.conflict === 'clean' && item.conflictStatus !== 'none') return false;
    if (
      filters.missingHostnameOnly &&
      !item.issues.some((issue) => issue.code === 'missing_hostname')
    ) {
      return false;
    }
    if (filters.withCredentialsOnly && !item.connection) return false;
    if (
      filters.withCredentialsOnly &&
      item.connection &&
      !connectionHasCredentials(item.connection)
    ) {
      return false;
    }
    if (!query) return true;
    return [
      item.name,
      item.hostname,
      item.username,
      item.sourcePath,
      item.protocol,
      ...item.tags,
      ...item.issues.map((issue) => issue.message),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
};

interface UseImportExportParams {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'export' | 'import';
}

export function useImportExport({
  isOpen,
  onClose,
  initialTab = 'export',
}: UseImportExportParams) {
  const { state, dispatch } = useConnections();
  const { toast } = useToastContext();
  const databaseManager = useMemo(() => DatabaseManager.getInstance(), []);
  const settingsManager = useMemo(() => SettingsManager.getInstance(), []);
  const [exportSecuritySettings] = useState(() =>
    getExportSecuritySettings(settingsManager),
  );
  const [activeTab, setActiveTab] = useState<'export' | 'import'>(initialTab);
  const [exportFormat, setExportFormat] = useState<ExportFormat>(
    exportSecuritySettings.defaultFormat,
  );
  const [exportScopeMode, setExportScopeMode] =
    useState<ExportScopeMode>('current');
  const [selectedExportDatabaseIds, setSelectedExportDatabaseIds] = useState<string[]>([]);
  const [exportDatabaseOptions, setExportDatabaseOptions] = useState<ExportDatabaseOption[]>([]);
  const [exportEncrypted, setExportEncrypted] = useState(
    exportSecuritySettings.encryptByDefault,
  );
  const [exportPassword, setExportPassword] = useState('');
  const [exportInclusion, setExportInclusion] = useState<ExportInclusionConfig>(() =>
    createDefaultExportInclusion(exportSecuritySettings),
  );
  const [exportKeyDerivationIterations, setExportKeyDerivationIterations] =
    useState(exportSecuritySettings.keyDerivationIterations);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importFilename, setImportFilename] = useState<string>('');
  const [importAnalysis, setImportAnalysis] = useState<ImportSourceMetadata | null>(null);
  const [importFilters, setImportFilters] =
    useState<ImportFilterState>(DEFAULT_IMPORT_FILTERS);
  const [importOptions, setImportOptions] =
    useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // In-app password prompt state. `pendingPasswordRequest` carries the
  // resolver for the awaiting import flow; the dialog UI lives in
  // ImportExport/index.tsx and calls submit/cancel here.
  const [passwordPrompt, setPasswordPrompt] = useState<{
    title: string;
    description: string;
    error?: string;
  } | null>(null);
  const pendingPasswordResolverRef = useRef<((value: string | null) => void) | null>(null);

  const updateExportInclusion = useCallback(
    (updates: Partial<ExportInclusionConfig>) => {
      setExportInclusion((current) => ({
        ...current,
        ...updates,
        includedProtocols:
          updates.includedProtocols !== undefined
            ? normalizeIncludedProtocols(updates.includedProtocols)
            : current.includedProtocols,
      }));
    },
    [],
  );

  const includePasswords = exportInclusion.includeCredentials;
  const includeVpnData = exportInclusion.includeVpnData;
  const includeTunnelChains = exportInclusion.includeTunnelChains;
  const includeTabGroups = exportInclusion.includeTabGroups;
  const includeColorTags = exportInclusion.includeColorTags;

  const setIncludePasswords = useCallback(
    (value: boolean) => updateExportInclusion({ includeCredentials: value }),
    [updateExportInclusion],
  );
  const setIncludeVpnData = useCallback(
    (value: boolean) => updateExportInclusion({ includeVpnData: value }),
    [updateExportInclusion],
  );
  const setIncludeTunnelChains = useCallback(
    (value: boolean) => updateExportInclusion({ includeTunnelChains: value }),
    [updateExportInclusion],
  );
  const setIncludeTabGroups = useCallback(
    (value: boolean) => updateExportInclusion({ includeTabGroups: value }),
    [updateExportInclusion],
  );
  const setIncludeColorTags = useCallback(
    (value: boolean) => updateExportInclusion({ includeColorTags: value }),
    [updateExportInclusion],
  );

  const requestPassword = (opts: {
    title: string;
    description: string;
    error?: string;
  }): Promise<string | null> => {
    // Cancel any in-flight prompt before queuing a new one.
    if (pendingPasswordResolverRef.current) {
      pendingPasswordResolverRef.current(null);
      pendingPasswordResolverRef.current = null;
    }
    setPasswordPrompt(opts);
    return new Promise<string | null>((resolve) => {
      pendingPasswordResolverRef.current = resolve;
    });
  };

  const submitPasswordPrompt = (value: string) => {
    const resolve = pendingPasswordResolverRef.current;
    pendingPasswordResolverRef.current = null;
    setPasswordPrompt(null);
    resolve?.(value);
  };

  const cancelPasswordPrompt = () => {
    const resolve = pendingPasswordResolverRef.current;
    pendingPasswordResolverRef.current = null;
    setPasswordPrompt(null);
    resolve?.(null);
  };

  const refreshExportDatabaseOptions = useCallback(async () => {
    const managerWithExportability = databaseManager as DatabaseManager & {
      getExportableDatabases?: () => ReturnType<DatabaseManager['getExportableDatabases']>;
    };
    const currentDatabase = databaseManager.getCurrentDatabase();
    const exportableDatabases = managerWithExportability.getExportableDatabases
      ? await managerWithExportability.getExportableDatabases()
      : currentDatabase
        ? [{
            ...currentDatabase,
            isCurrent: true,
            isUnlocked: true,
            isExportable: true,
          }]
        : [];
    const options: ExportDatabaseOption[] = exportableDatabases.map((database) => ({
      id: database.id,
      name: database.name,
      description: database.description,
      isCurrent: database.id === currentDatabase?.id || database.isCurrent,
      isEncrypted: database.isEncrypted,
      isUnlocked: database.isUnlocked,
      isExportable: database.isExportable,
      lockedReason: database.lockedReason,
      connectionCount: database.id === currentDatabase?.id ? state.connections.length : undefined,
      lastAccessed: database.lastAccessed,
    }));

    setExportDatabaseOptions(options);
    setSelectedExportDatabaseIds((currentSelection) => {
      const exportableIds = new Set(
        options.filter((option) => option.isExportable).map((option) => option.id),
      );
      const retainedSelection = currentSelection.filter((id) => exportableIds.has(id));
      if (retainedSelection.length > 0) {
        return retainedSelection;
      }

      const currentOption = options.find(
        (option) => option.isCurrent && option.isExportable,
      );
      return currentOption ? [currentOption.id] : [];
    });
  }, [databaseManager, state.connections.length]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    void refreshExportDatabaseOptions();
  }, [isOpen, refreshExportDatabaseOptions]);

  // ── Helpers ──────────────────────────────────────────────────

  const escapeXml = (str: string): string =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const escapeCsv = (str: string): string => {
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const escapeHtml = (str: string): string =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const escapeMarkdownCell = (str: string): string =>
    escapeHtml(str).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

  const buildExportSummary = (connections: Connection[]): ExportInventorySummary => {
    const folders = connections.filter((connection) => connection.isGroup).length;
    const leafConnections = connections.length - folders;
    const credentialConnections = connections.filter(connectionHasCredentials).length;
    const protocolCount = new Set(
      connections
        .filter((connection) => !connection.isGroup)
        .map((connection) => connection.protocol),
    ).size;
    return {
      totalItems: connections.length,
      folders,
      leafConnections,
      credentialConnections,
      protocolCount,
    };
  };

  const buildExportInventoryRows = (
    dataset: ExportDatabaseDataset,
  ): ExportInventoryRow[] => {
    const connectionsById = new Map(
      dataset.connections.map((connection) => [connection.id, connection]),
    );

    return dataset.connections.map((connection) => ({
      databaseId: dataset.databaseId,
      databaseName: dataset.databaseName,
      id: safeString(connection.id),
      name: safeString(connection.name),
      kind: connection.isGroup ? 'Folder' : 'Connection',
      protocol: connection.isGroup ? '' : safeString(connection.protocol).toUpperCase(),
      hostname: safeString(connection.hostname),
      port: connection.isGroup ? '' : safeString(connection.port),
      username: safeString(connection.username),
      domain: safeString(connection.domain),
      description: safeString(connection.description),
      path: getConnectionPath(connection, connectionsById),
      parentId: safeString(connection.parentId),
      tags: (connection.tags || []).map((tag) => safeString(tag)).join('; '),
      hasCredentials: connectionHasCredentials(connection) ? 'Yes' : 'No',
      createdAt: safeString(connection.createdAt),
      updatedAt: safeString(connection.updatedAt),
    }));
  };

  const buildConnectionTree = (connections: Connection[]) => {
    const ids = new Set(connections.map((connection) => connection.id));
    const roots: Connection[] = [];
    const childrenByParent = new Map<string, Connection[]>();

    connections.forEach((connection) => {
      if (connection.parentId && ids.has(connection.parentId)) {
        const children = childrenByParent.get(connection.parentId) || [];
        children.push(connection);
        childrenByParent.set(connection.parentId, children);
      } else {
        roots.push(connection);
      }
    });

    return { roots, childrenByParent };
  };

  const mapToMRemoteNGProtocol = (protocol: Connection['protocol']): string => {
    switch (protocol) {
      case 'rdp':
        return 'RDP';
      case 'ssh':
      case 'sftp':
      case 'scp':
        return 'SSH2';
      case 'vnc':
        return 'VNC';
      case 'telnet':
        return 'Telnet';
      case 'rlogin':
        return 'Rlogin';
      case 'http':
        return 'HTTP';
      case 'https':
        return 'HTTPS';
      case 'winrm':
        return 'PowerShell';
      default:
        return 'RAW';
    }
  };

  const generateExportFilename = (format: string): string => {
    const now = new Date();
    const datetime = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const randomHex = Math.random().toString(16).substring(2, 8);
    return `sortofremoteng-exports-${datetime}-${randomHex}.${format}`;
  };

  const downloadFile = (
    content: string,
    filename: string,
    mimeType: string,
  ) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const normalizeVpnImportData = (value: unknown): ImportVpnData | undefined => {
    if (!value || typeof value !== 'object') return undefined;

    const candidate = value as Partial<Record<keyof ImportVpnData, unknown>>;

    return {
      openvpn: Array.isArray(candidate.openvpn) ? candidate.openvpn : [],
      wireguard: Array.isArray(candidate.wireguard) ? candidate.wireguard : [],
      tailscale: Array.isArray(candidate.tailscale) ? candidate.tailscale : [],
      zerotier: Array.isArray(candidate.zerotier) ? candidate.zerotier : [],
    };
  };

  const importPreviewItems = importResult?.previewItems ?? EMPTY_IMPORT_PREVIEW_ITEMS;
  const visiblePreviewItems = useMemo(
    () =>
      filterImportPreviewItems(
        importPreviewItems,
        importFilters,
        selectedPreviewIds,
      ),
    [importFilters, importPreviewItems, selectedPreviewIds],
  );
  const availableImportProtocols = useMemo(
    () =>
      Array.from(
        new Set(
          importPreviewItems
            .map((item) => item.protocol)
            .filter(Boolean) as Connection['protocol'][],
        ),
      ).sort(),
    [importPreviewItems],
  );
  const selectedImportCount = useMemo(
    () =>
      importPreviewItems.filter((item) => selectedPreviewIds.has(item.id))
        .length,
    [importPreviewItems, selectedPreviewIds],
  );

  const updateImportFilters = useCallback(
    (updates: Partial<ImportFilterState>) => {
      setImportFilters((current) => ({ ...current, ...updates }));
    },
    [],
  );

  const resetImportFilters = useCallback(() => {
    setImportFilters(DEFAULT_IMPORT_FILTERS);
  }, []);

  const updateImportOptions = useCallback(
    (updates: Partial<ImportOptions>) => {
      setImportOptions((current) => ({ ...current, ...updates }));
    },
    [],
  );

  const togglePreviewSelection = useCallback((itemId: string) => {
    setSelectedPreviewIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const selectPreviewItems = useCallback((itemIds: string[]) => {
    setSelectedPreviewIds((current) => {
      const next = new Set(current);
      itemIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const deselectPreviewItems = useCallback((itemIds: string[]) => {
    setSelectedPreviewIds((current) => {
      const next = new Set(current);
      itemIds.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const selectAllVisiblePreviewItems = useCallback(() => {
    selectPreviewItems(
      visiblePreviewItems.filter((item) => item.importable).map((item) => item.id),
    );
  }, [selectPreviewItems, visiblePreviewItems]);

  const deselectAllVisiblePreviewItems = useCallback(() => {
    deselectPreviewItems(visiblePreviewItems.map((item) => item.id));
  }, [deselectPreviewItems, visiblePreviewItems]);

  const selectAllImportablePreviewItems = useCallback(() => {
    setSelectedPreviewIds(
      new Set(
        importPreviewItems
          .filter((item) => item.importable)
          .map((item) => item.id),
      ),
    );
  }, [importPreviewItems]);

  // ── Export ───────────────────────────────────────────────────

  const getEffectiveExportDatabaseIds = useCallback(
    (
      options: ExportDatabaseOption[] = exportDatabaseOptions,
      mode: ExportScopeMode = exportScopeMode,
    ): string[] => {
      const exportableOptions = options.filter((option) => option.isExportable);
      if (mode === 'current') {
        const currentOption = exportableOptions.find((option) => option.isCurrent);
        return currentOption ? [currentOption.id] : [];
      }

      if (mode === 'all') {
        return exportableOptions.map((option) => option.id);
      }

      const exportableIds = new Set(exportableOptions.map((option) => option.id));
      return selectedExportDatabaseIds.filter((id) => exportableIds.has(id));
    },
    [exportDatabaseOptions, exportScopeMode, selectedExportDatabaseIds],
  );

  const buildCurrentDatabaseDataset = (
    currentDatabase: ConnectionDatabase,
  ): ExportDatabaseDataset => {
    const rawSettings = settingsManager.getSettings?.();
    const settings = (rawSettings ?? {}) as unknown as Record<string, unknown>;
    const colorTags = (
      includeColorTags && rawSettings?.colorTags ? rawSettings.colorTags : {}
    ) as DatabaseExportSnapshot['colorTags'];
    return {
      databaseId: currentDatabase.id,
      databaseName: currentDatabase.name,
      databaseDescription: currentDatabase.description,
      isCurrent: true,
      isEncrypted: currentDatabase.isEncrypted,
      connections: prepareConnectionsForExport(state.connections, exportInclusion),
      settings: exportInclusion.includeSettings ? settings : {},
      tabGroups: includeTabGroups ? state.tabGroups ?? [] : [],
      colorTags,
    };
  };

  const snapshotToDataset = (
    snapshot: DatabaseExportSnapshot,
  ): ExportDatabaseDataset => ({
    databaseId: snapshot.collection.id,
    databaseName: snapshot.collection.name,
    databaseDescription: snapshot.collection.description,
    isCurrent: false,
    isEncrypted: snapshot.collection.isEncrypted,
    connections: prepareConnectionsForExport(snapshot.connections, exportInclusion),
    settings: exportInclusion.includeSettings ? snapshot.settings ?? {} : {},
    tabGroups: includeTabGroups ? snapshot.tabGroups ?? [] : [],
    colorTags: includeColorTags ? snapshot.colorTags ?? {} : {},
  });

  const buildExportDatasets = async (): Promise<ExportBuildResult> => {
    const currentDatabase = databaseManager.getCurrentDatabase();
    if (!currentDatabase) throw new Error('No collection selected');

    const exportableDatabases = await databaseManager.getExportableDatabases();
    const options: ExportDatabaseOption[] = exportableDatabases.map((database) => ({
      id: database.id,
      name: database.name,
      description: database.description,
      isCurrent: database.id === currentDatabase.id || database.isCurrent,
      isEncrypted: database.isEncrypted,
      isUnlocked: database.isUnlocked,
      isExportable: database.isExportable,
      lockedReason: database.lockedReason,
      connectionCount: database.id === currentDatabase.id ? state.connections.length : undefined,
      lastAccessed: database.lastAccessed,
    }));
    setExportDatabaseOptions(options);

    const selectedIds = getEffectiveExportDatabaseIds(options);
    if (selectedIds.length === 0) {
      return { datasets: [], options, effectiveDatabaseIds: [] };
    }

    const datasets: ExportDatabaseDataset[] = [];
    for (const databaseId of selectedIds) {
      if (databaseId === currentDatabase.id) {
        datasets.push(buildCurrentDatabaseDataset(currentDatabase));
        continue;
      }

      const snapshot = await databaseManager.readExportableDatabaseSnapshot(
        databaseId,
        exportInclusion.includeConnections && exportInclusion.includeCredentials,
      );
      datasets.push(snapshotToDataset(snapshot));
    }

    return { datasets, options, effectiveDatabaseIds: selectedIds };
  };

  const loadExportSidecars = async (): Promise<ExportSidecars> => {
    const sidecars: ExportSidecars = {};

    if (includeVpnData) {
      const proxyMgr = ProxyOpenVPNManager.getInstance();
      const [vpnOpenVPN, vpnWireGuard, vpnTailscale, vpnZeroTier] =
        await Promise.allSettled([
          proxyMgr.listOpenVPNConnections(),
          proxyMgr.listWireGuardConnections(),
          proxyMgr.listTailscaleConnections(),
          proxyMgr.listZeroTierConnections(),
        ]);

      const includedVpnIds =
        (exportInclusion.includedVpnConnectionIds ?? []).length > 0
          ? new Set(exportInclusion.includedVpnConnectionIds)
          : null;
      const keepVpn = <T extends { id?: string | null }>(items: T[]): T[] =>
        includedVpnIds == null
          ? items
          : items.filter((item) => item.id != null && includedVpnIds.has(item.id));

      sidecars.vpnConnections = {
        openvpn: keepVpn(vpnOpenVPN.status === 'fulfilled' ? vpnOpenVPN.value : []),
        wireguard: keepVpn(vpnWireGuard.status === 'fulfilled' ? vpnWireGuard.value : []),
        tailscale: keepVpn(vpnTailscale.status === 'fulfilled' ? vpnTailscale.value : []),
        zerotier: keepVpn(vpnZeroTier.status === 'fulfilled' ? vpnZeroTier.value : []),
      };
    }

    if (includeTunnelChains) {
      const includedChainIds =
        (exportInclusion.includedProxyChainIds ?? []).length > 0
          ? new Set(exportInclusion.includedProxyChainIds)
          : null;
      const allChains = proxyCollectionManager.getTunnelChains();
      sidecars.tunnelChainTemplates = includedChainIds
        ? allChains.filter((chain) => includedChainIds.has(chain.id))
        : allChains;
    }

    const includedProxyProfileIds =
      (exportInclusion.includedProxyProfileIds ?? []).length > 0
        ? new Set(exportInclusion.includedProxyProfileIds)
        : null;
    const includedProxyChainIds =
      (exportInclusion.includedProxyChainIds ?? []).length > 0
        ? new Set(exportInclusion.includedProxyChainIds)
        : null;
    if (includedProxyProfileIds || includedProxyChainIds) {
      // Stash proxy collections in the sidecar payload so the exporter
      // picks them up alongside everything else.
      const allProfiles = proxyCollectionManager.getProfiles();
      const allChains = proxyCollectionManager.getChains();
      sidecars.proxyProfiles = includedProxyProfileIds
        ? allProfiles.filter((p) => includedProxyProfileIds.has(p.id))
        : allProfiles;
      sidecars.proxyChains = includedProxyChainIds
        ? allChains.filter((c) => includedProxyChainIds.has(c.id))
        : allChains;
    }

    return sidecars;
  };

  const buildDatabaseExportMetadata = (dataset: ExportDatabaseDataset) => ({
    collectionId: dataset.databaseId,
    name: dataset.databaseName,
    description: dataset.databaseDescription,
    isEncrypted: dataset.isEncrypted,
    wasCurrentAtExport: dataset.isCurrent,
    counts: buildExportSummary(dataset.connections),
  });

  const buildExportWarnings = (
    datasets: ExportDatabaseDataset[],
    options: ExportDatabaseOption[],
  ): string[] => {
    const warnings: string[] = [];
    const lockedSkippedCount = options.filter(
      (option) => option.isEncrypted && !option.isExportable,
    ).length;

    if (lockedSkippedCount > 0) {
      warnings.push(`${lockedSkippedCount} locked encrypted database(s) were skipped.`);
    }
    if (!exportInclusion.includeConnections) {
      warnings.push('Connections are excluded by the export inclusion settings.');
    }
    if (exportInclusion.includeConnections && !exportInclusion.includeCredentials) {
      warnings.push('Credentials and private secret fields were redacted.');
    }
    if (!exportInclusion.includeSettings) {
      warnings.push('Database settings are excluded by the export inclusion settings.');
    }
    if (!exportInclusion.includeFolderItems) {
      warnings.push('Folder/group records are excluded and exported connections are moved to the root.');
    } else if (!exportInclusion.includeEmptyFolders) {
      warnings.push('Empty folders/groups are excluded.');
    }
    if (exportInclusion.includedProtocols.length > 0) {
      warnings.push(`Protocol filter active: ${exportInclusion.includedProtocols.join(', ')}.`);
    }
    if (exportFormat !== 'json') {
      warnings.push('Selected non-JSON format is an inventory export and may not preserve every app-specific inclusion.');
    }
    if (datasets.some((dataset) => !dataset.isCurrent)) {
      warnings.push('Counts for non-current databases were calculated when the export ran.');
    }

    return warnings;
  };

  const buildExportMetadata = (params: {
    datasets: ExportDatabaseDataset[];
    options: ExportDatabaseOption[];
    sidecars: ExportSidecars;
    warnings: string[];
    encrypted: boolean;
    keyDerivationIterations: number;
  }) => {
    const exportedAt = new Date().toISOString();
    const aggregateConnections = params.datasets.flatMap((dataset) => dataset.connections);
    const aggregateSummary = buildExportSummary(aggregateConnections);
    const protocols = Array.from(
      new Set(
        aggregateConnections
          .filter((connection) => !connection.isGroup)
          .map((connection) => connection.protocol),
      ),
    ).sort();
    const vpnDefinitions = params.sidecars.vpnConnections
      ? params.sidecars.vpnConnections.openvpn.length +
        params.sidecars.vpnConnections.wireguard.length +
        params.sidecars.vpnConnections.tailscale.length +
        params.sidecars.vpnConnections.zerotier.length
      : 0;
    const lockedSkippedCount = params.options.filter(
      (option) => option.isEncrypted && !option.isExportable,
    ).length;
    const timezone = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return undefined;
      }
    })();
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const clientId = getOrCreateExportClientId();
    const exportId = generateId();

    return {
      id: exportId,
      exportId,
      createdAt: exportedAt,
      exportedAt,
      app: {
        name: 'sortOfRemoteNG',
        version: '0.0.0',
      },
      schema: {
        name: params.datasets.length > 1 ? EXPORT_PACKAGE_SCHEMA : EXPORT_SINGLE_DATABASE_SCHEMA,
        version: EXPORT_PACKAGE_VERSION,
      },
      format: exportFormat,
      scope: {
        mode: exportScopeMode,
        requestedDatabaseIds: exportScopeMode === 'selected' ? selectedExportDatabaseIds : undefined,
        effectiveDatabaseIds: params.datasets.map((dataset) => dataset.databaseId),
        selectedDatabases: params.datasets.map((dataset) => ({
          id: dataset.databaseId,
          name: dataset.databaseName,
          wasCurrentAtExport: dataset.isCurrent,
        })),
        exportableDatabaseCount: params.options.filter((option) => option.isExportable).length,
        lockedSkippedCount,
      },
      encrypted: params.encrypted,
      encryption: {
        encrypted: params.encrypted,
        keyDerivationIterations: params.encrypted ? params.keyDerivationIterations : undefined,
      },
      inclusion: exportInclusion,
      warnings: params.warnings,
      totals: {
        databases: params.datasets.length,
        totalItems: aggregateSummary.totalItems,
        connections: aggregateSummary.leafConnections,
        folders: aggregateSummary.folders,
        credentialConnections: aggregateSummary.credentialConnections,
        protocolCount: aggregateSummary.protocolCount,
        protocols,
        vpnDefinitions,
        tunnelChains: params.sidecars.tunnelChainTemplates?.length ?? 0,
        settingsObjects: exportInclusion.includeSettings ? params.datasets.length : 0,
      },
      sourceClient: {
        clientId,
        machineId: clientId,
        userAgent: nav?.userAgent,
        platform: nav?.platform,
        language: nav?.language,
        timezone,
      },
    };
  };

  const buildSingleDatabaseJsonPayload = (
    dataset: ExportDatabaseDataset,
    sidecars: ExportSidecars,
    exportMetadata?: ReturnType<typeof buildExportMetadata>,
  ) => ({
    collection: {
      id: dataset.databaseId,
      name: dataset.databaseName,
      description: dataset.databaseDescription,
      isEncrypted: dataset.isEncrypted,
      exportDate: new Date().toISOString(),
    },
    connections: dataset.connections,
    ...(exportInclusion.includeSettings ? { settings: dataset.settings } : {}),
    ...(includeTabGroups ? { tabGroups: dataset.tabGroups ?? [] } : {}),
    ...(includeColorTags ? { colorTags: dataset.colorTags ?? {} } : {}),
    ...(exportInclusion.includeDatabaseMetadata
      ? { databaseMetadata: buildDatabaseExportMetadata(dataset) }
      : {}),
    ...(exportMetadata ? { exportMetadata } : {}),
    ...(sidecars.vpnConnections ? { vpnConnections: sidecars.vpnConnections } : {}),
    ...(sidecars.tunnelChainTemplates
      ? { tunnelChainTemplates: sidecars.tunnelChainTemplates }
      : {}),
  });

  const buildMultiDatabaseJsonPackage = (
    datasets: ExportDatabaseDataset[],
    sidecars: ExportSidecars,
    exportMetadata?: ReturnType<typeof buildExportMetadata>,
  ) => ({
    schema: EXPORT_PACKAGE_SCHEMA,
    version: EXPORT_PACKAGE_VERSION,
    exportDate: new Date().toISOString(),
    ...(exportMetadata ? { exportMetadata } : {}),
    databases: datasets.map((dataset) => ({
      collection: {
        id: dataset.databaseId,
        name: dataset.databaseName,
        description: dataset.databaseDescription,
        isEncrypted: dataset.isEncrypted,
        wasCurrentAtExport: dataset.isCurrent,
      },
      connections: dataset.connections,
      ...(exportInclusion.includeSettings ? { settings: dataset.settings } : {}),
      ...(includeTabGroups ? { tabGroups: dataset.tabGroups ?? [] } : {}),
      ...(includeColorTags ? { colorTags: dataset.colorTags ?? {} } : {}),
      ...(exportInclusion.includeDatabaseMetadata
        ? { databaseMetadata: buildDatabaseExportMetadata(dataset) }
        : {}),
    })),
    ...(sidecars.vpnConnections ? { vpnConnections: sidecars.vpnConnections } : {}),
    ...(sidecars.tunnelChainTemplates
      ? { tunnelChainTemplates: sidecars.tunnelChainTemplates }
      : {}),
  });

  const exportToXML = (dataset: ExportDatabaseDataset): string => {
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const xmlRoot = '<sortOfRemoteNG>\n';
    const xmlConnections = dataset.connections
      .map((conn) => {
        const attributes = [
          `Id="${conn.id}"`,
          `Name="${escapeXml(conn.name)}"`,
          `Type="${conn.protocol.toUpperCase()}"`,
          `Server="${escapeXml(conn.hostname)}"`,
          `Port="${conn.port}"`,
          `Username="${escapeXml(conn.username || '')}"`,
          `Domain="${escapeXml(conn.domain || '')}"`,
          `Description="${escapeXml(conn.description || '')}"`,
          `ParentId="${conn.parentId || ''}"`,
          `IsGroup="${conn.isGroup}"`,
          `Tags="${escapeXml((conn.tags || []).join(','))}"`,
          `CreatedAt="${conn.createdAt}"`,
          `UpdatedAt="${conn.updatedAt}"`,
        ].join(' ');
        return `  <Connection ${attributes} />`;
      })
      .join('\n');
    const xmlFooter = '\n</sortOfRemoteNG>';
    return xmlHeader + xmlRoot + xmlConnections + xmlFooter;
  };

  const exportToCSV = (datasets: ExportDatabaseDataset[]): string => {
    const includeDatabaseColumns = datasets.length > 1;
    const headers = [
      ...(includeDatabaseColumns ? ['Database', 'DatabaseId'] : []),
      'ID',
      'Name',
      'Protocol',
      'Hostname',
      'Port',
      'Username',
      'Domain',
      'Description',
      'ParentId',
      'IsGroup',
      'Tags',
      'CreatedAt',
      'UpdatedAt',
    ];
    const rows = datasets.flatMap((dataset) =>
      dataset.connections.map((conn) => [
        ...(includeDatabaseColumns
          ? [escapeCsv(dataset.databaseName), dataset.databaseId]
          : []),
        conn.id,
        escapeCsv(conn.name),
        conn.protocol,
        escapeCsv(conn.hostname),
        conn.port.toString(),
        escapeCsv(conn.username || ''),
        escapeCsv(conn.domain || ''),
        escapeCsv(conn.description || ''),
        conn.parentId || '',
        conn.isGroup.toString(),
        escapeCsv((conn.tags || []).join(';')),
        safeString(conn.createdAt),
        safeString(conn.updatedAt),
      ]),
    );
    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  };

  const exportToText = (datasets: ExportDatabaseDataset[]): string => {
    const lines = [
      'sortOfRemoteNG connection inventory',
      `Generated: ${new Date().toISOString()}`,
      '',
      `Databases: ${datasets.length}`,
    ];

    const renderConnection = (
      connection: Connection,
      depth: number,
      childrenByParent: Map<string, Connection[]>,
      visited: Set<string>,
    ) => {
      if (visited.has(connection.id)) return;
      visited.add(connection.id);
      const indent = '  '.repeat(depth);
      const childIndent = `${indent}  `;
      lines.push(`${indent}- [${connection.isGroup ? 'Folder' : 'Connection'}] ${safeString(connection.name) || 'Unnamed item'}`);
      if (!connection.isGroup) {
        lines.push(`${childIndent}Protocol: ${safeString(connection.protocol).toUpperCase()}`);
        lines.push(`${childIndent}Host: ${safeString(connection.hostname)}${connection.port ? `:${connection.port}` : ''}`);
        if (connection.username) lines.push(`${childIndent}Username: ${safeString(connection.username)}`);
        if (connection.domain) lines.push(`${childIndent}Domain: ${safeString(connection.domain)}`);
        if (connectionHasCredentials(connection)) lines.push(`${childIndent}Credentials: present (not included)`);
      }
      if (connection.tags?.length) lines.push(`${childIndent}Tags: ${connection.tags.map((tag) => safeString(tag)).join(', ')}`);
      if (connection.description) lines.push(`${childIndent}Description: ${safeString(connection.description)}`);
      (childrenByParent.get(connection.id) || []).forEach((child) =>
        renderConnection(child, depth + 1, childrenByParent, visited),
      );
    };

    datasets.forEach((dataset, index) => {
      const summary = buildExportSummary(dataset.connections);
      const { roots, childrenByParent } = buildConnectionTree(dataset.connections);
      const visited = new Set<string>();
      if (index > 0) lines.push('');
      lines.push(`Database: ${dataset.databaseName}`);
      lines.push(`Database ID: ${dataset.databaseId}`);
      lines.push(`Total items: ${summary.totalItems}`);
      lines.push(`Folders/groups: ${summary.folders}`);
      lines.push(`Leaf connections: ${summary.leafConnections}`);
      lines.push(`Credential-bearing connections: ${summary.credentialConnections}`);
      lines.push(`Protocols: ${summary.protocolCount}`);
      lines.push('');
      lines.push('Inventory');
      roots.forEach((connection) =>
        renderConnection(connection, 0, childrenByParent, visited),
      );
    });

    return `${lines.join('\n')}\n`;
  };

  const exportToMarkdown = (datasets: ExportDatabaseDataset[]): string => {
    const includeDatabaseColumns = datasets.length > 1;
    const columns = getExportInventoryColumns(includeDatabaseColumns);
    const header = `| ${columns.map((column) => column.label).join(' | ')} |`;
    const separator = `| ${columns.map(() => '---').join(' | ')} |`;
    const lines = [
      '# sortOfRemoteNG Connection Inventory',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      `- Databases: ${datasets.length}`,
    ];

    datasets.forEach((dataset) => {
      const summary = buildExportSummary(dataset.connections);
      const rows = buildExportInventoryRows(dataset);
      const tableRows = rows.map((row) =>
        `| ${columns.map((column) => escapeMarkdownCell(row[column.key])).join(' | ')} |`,
      );

      lines.push(
        '',
        `## Database: ${dataset.databaseName}`,
        '',
        `- Database ID: ${dataset.databaseId}`,
        `- Total items: ${summary.totalItems}`,
        `- Folders/groups: ${summary.folders}`,
        `- Leaf connections: ${summary.leafConnections}`,
        `- Credential-bearing connections: ${summary.credentialConnections}`,
        `- Protocols: ${summary.protocolCount}`,
        '',
        header,
        separator,
        ...tableRows,
      );
    });

    return `${lines.join('\n')}\n`;
  };

  const buildHtmlTableDocument = (
    title: string,
    datasets: ExportDatabaseDataset[],
    excelCompatible = false,
  ): string => {
    const includeDatabaseColumns = datasets.length > 1;
    const columns = getExportInventoryColumns(includeDatabaseColumns);
    const rows = datasets.flatMap(buildExportInventoryRows);
    const aggregateConnections = datasets.flatMap((dataset) => dataset.connections);
    const summary = buildExportSummary(aggregateConnections);
    const htmlAttrs = excelCompatible
      ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"'
      : '';
    const generatedAt = new Date().toISOString();
    const summaryRows = [
      ['Databases', datasets.length],
      ['Total items', summary.totalItems],
      ['Folders/groups', summary.folders],
      ['Leaf connections', summary.leafConnections],
      ['Credential-bearing connections', summary.credentialConnections],
      ['Protocols', summary.protocolCount],
    ];
    const tableHeader = columns.map(
      (column) => `<th scope="col">${escapeHtml(column.label)}</th>`,
    ).join('');
    const tableRows = rows.map((row) =>
      `<tr>${columns.map((column) => `<td>${escapeHtml(row[column.key])}</td>`).join('')}</tr>`,
    ).join('\n');

    return `<!DOCTYPE html>
<html${htmlAttrs}>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #1f2937; margin: 24px; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    .meta { color: #4b5563; font-size: 12px; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #e5eef8; font-weight: 700; }
    .summary { margin: 0 0 16px; }
    .summary th { width: 220px; background: #f3f4f6; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Generated ${escapeHtml(generatedAt)}</p>
  <table class="summary" aria-label="Export summary">
    <tbody>
      ${summaryRows.map(([label, value]) => `<tr><th scope="row">${escapeHtml(String(label))}</th><td>${escapeHtml(String(value))}</td></tr>`).join('\n      ')}
    </tbody>
  </table>
  <table aria-label="Connection inventory">
    <thead><tr>${tableHeader}</tr></thead>
    <tbody>
${tableRows}
    </tbody>
  </table>
</body>
</html>`;
  };

  const exportToMRemoteNG = (dataset: ExportDatabaseDataset): string => {
    const { roots, childrenByParent } = buildConnectionTree(dataset.connections);
    const visited = new Set<string>();
    const renderNode = (connection: Connection, depth: number): string => {
      if (visited.has(connection.id)) return '';
      visited.add(connection.id);
      const indent = '  '.repeat(depth);
      const children = childrenByParent.get(connection.id) || [];
      const attributes = connection.isGroup
        ? [
            `Name="${escapeXml(safeString(connection.name) || 'Unnamed folder')}"`,
            'Type="Container"',
            `Descr="${escapeXml(safeString(connection.description))}"`,
            `Expanded="${connection.expanded === false ? 'False' : 'True'}"`,
            `Id="${escapeXml(safeString(connection.id))}"`,
          ]
        : [
            `Name="${escapeXml(safeString(connection.name) || 'Unnamed connection')}"`,
            'Type="Connection"',
            `Descr="${escapeXml(safeString(connection.description))}"`,
            `Protocol="${mapToMRemoteNGProtocol(connection.protocol)}"`,
            `Hostname="${escapeXml(safeString(connection.hostname))}"`,
            `Port="${escapeXml(safeString(connection.port))}"`,
            `Username="${escapeXml(safeString(connection.username))}"`,
            `Domain="${escapeXml(safeString(connection.domain))}"`,
            'Password=""',
            'Panel="General"',
            `Id="${escapeXml(safeString(connection.id))}"`,
          ];

      if (children.length === 0) {
        return `${indent}<Node ${attributes.join(' ')} />`;
      }

      const childXml = children
        .map((child) => renderNode(child, depth + 1))
        .filter(Boolean)
        .join('\n');
      return `${indent}<Node ${attributes.join(' ')}>\n${childXml}\n${indent}</Node>`;
    };

    const nodes = roots
      .map((connection) => renderNode(connection, 1))
      .filter(Boolean)
      .join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>\n<Connections Name="Connections" Export="False" Protected="" ConfVersion="2.6">\n${nodes}\n</Connections>`;
  };

  const handleExport = async () => {
    setIsProcessing(true);
    try {
      let content: string;
      let filename: string;
      let mimeType: string;
      const shouldUsePasswordEncryption = exportEncrypted && Boolean(exportPassword);
      const normalizedExportIterations = normalizePbkdf2Iterations(
        exportKeyDerivationIterations,
      );

      if (shouldUsePasswordEncryption && exportSecuritySettings.enforceMinimumPasswordScore) {
        const strength = analyzePasswordStrength(exportPassword, {
          detectCommonPasswords: exportSecuritySettings.detectCommonPasswords,
          detectRepeatedCharacters: exportSecuritySettings.detectRepeatedCharacters,
          detectSequentialPatterns: exportSecuritySettings.detectSequentialPatterns,
          rewardUncommonSymbols: exportSecuritySettings.rewardUncommonSymbols,
          customCommonPasswords: exportSecuritySettings.customCommonPasswords,
        });
        if (strength.score < exportSecuritySettings.minimumPasswordScore) {
          toast.error(
            `Export password is too weak. Minimum required strength is ${exportSecuritySettings.minimumPasswordScore}/4.`,
          );
          return;
        }
      }

      const exportBuild = await buildExportDatasets();
      const { datasets, options } = exportBuild;
      if (datasets.length === 0) {
        toast.error('No exportable databases are selected. Unlock encrypted databases or choose a different scope.');
        return;
      }

      if (
        datasets.length > 1 &&
        (exportFormat === 'xml' || exportFormat === 'mremoteng')
      ) {
        toast.error('XML and mRemoteNG exports support one database at a time. Choose JSON or an inventory format for a database package.');
        return;
      }

      switch (exportFormat) {
        case 'json': {
          const sidecars = await loadExportSidecars();
          const warnings = buildExportWarnings(datasets, options);
          const exportMetadata = exportInclusion.includeExportMetadata
            ? buildExportMetadata({
                datasets,
                options,
                sidecars,
                warnings,
                encrypted: shouldUsePasswordEncryption,
                keyDerivationIterations: normalizedExportIterations,
              })
            : undefined;
          const payload = datasets.length === 1
            ? buildSingleDatabaseJsonPayload(datasets[0], sidecars, exportMetadata)
            : buildMultiDatabaseJsonPackage(datasets, sidecars, exportMetadata);
          content = JSON.stringify(payload, null, 2);

          filename = generateExportFilename('json');
          mimeType = 'application/json';
          break;
        }
        case 'xml':
          content = exportToXML(datasets[0]);
          filename = generateExportFilename('xml');
          mimeType = 'application/xml';
          break;
        case 'csv':
          content = exportToCSV(datasets);
          filename = generateExportFilename('csv');
          mimeType = 'text/csv';
          break;
        case 'txt':
          content = exportToText(datasets);
          filename = generateExportFilename('txt');
          mimeType = 'text/plain';
          break;
        case 'markdown':
          content = exportToMarkdown(datasets);
          filename = generateExportFilename('md');
          mimeType = 'text/markdown';
          break;
        case 'html':
          content = buildHtmlTableDocument(
            datasets.length > 1
              ? 'sortOfRemoteNG Database Package Inventory'
              : 'sortOfRemoteNG Connection Inventory',
            datasets,
          );
          filename = generateExportFilename('html');
          mimeType = 'text/html';
          break;
        case 'excel':
          content = buildHtmlTableDocument(
            datasets.length > 1
              ? 'sortOfRemoteNG Database Package Inventory'
              : 'sortOfRemoteNG Connection Inventory',
            datasets,
            true,
          );
          filename = generateExportFilename('xls');
          mimeType = 'application/vnd.ms-excel';
          break;
        case 'mremoteng':
          content = exportToMRemoteNG(datasets[0]);
          filename = generateExportFilename('mremoteng.xml');
          mimeType = 'application/xml';
          break;
        default:
          throw new Error('Unsupported export format');
      }

      if (shouldUsePasswordEncryption) {
        const payloadBytes = new TextEncoder().encode(content);
        const result = await encryptExport(exportFormat as ExportFormat, {
          payload: payloadBytes,
          payloadString: content,
          password: exportPassword,
          iterations: normalizedExportIterations,
        });
        // The dispatcher may swap mime / extension when it falls back
        // (e.g. OOXML missing → AES-GCM JSON envelope) or finalize the
        // native filename (e.g. mRemoteNG returns the XML envelope).
        if (result.mimeType) mimeType = result.mimeType;
        if (result.extension) {
          filename = filename.replace(/\.[^.]+$/, '') + result.extension;
        } else {
          filename = filename.replace(/\.[^.]+$/, '.encrypted$&');
        }
        if (result.warning) {
          toast.warning(result.warning);
        }
        const encryptedBlob = new Blob([result.bytes as unknown as BlobPart], {
          type: mimeType,
        });
        const url = URL.createObjectURL(encryptedBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success(`Exported successfully: ${filename}`);
        settingsManager.logAction(
          'info',
          'Data exported',
          undefined,
          `Exported ${datasets.reduce((count, dataset) => count + dataset.connections.length, 0)} connections from ${datasets.length} database(s) to ${exportFormat.toUpperCase()} (encrypted via ${result.scheme}, ${normalizedExportIterations} PBKDF2 iterations)`,
        );
        setIsProcessing(false);
        return;
      }

      downloadFile(content, filename, mimeType);
      toast.success(`Exported successfully: ${filename}`);
      settingsManager.logAction(
        'info',
        'Data exported',
        undefined,
        `Exported ${datasets.reduce((count, dataset) => count + dataset.connections.length, 0)} connections from ${datasets.length} database(s) to ${exportFormat.toUpperCase()}${shouldUsePasswordEncryption ? ` (encrypted, ${normalizedExportIterations} PBKDF2 iterations)` : ''}`,
      );
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Export failed. Check the console for details.');
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Import ───────────────────────────────────────────────────

  const processImportFile = async (
    filename: string,
    content: string,
    sizeBytes?: number,
  ): Promise<ImportResult> => {
    const errors: string[] = [];
    try {
      let processedContent = content;
      const encryptedWrapper =
        filename.includes('.encrypted.') ||
        filename.split('.').pop()?.toLowerCase() === 'encrypted' ||
        isWebCryptoPayload(processedContent);
      if (
        encryptedWrapper
      ) {
        const password = await requestPassword({
          title: 'Decrypt import file',
          description: 'This file is encrypted. Enter the password used during export to decrypt it.',
        });
        if (!password) throw new Error('Password required for encrypted file');
        let decrypted: string | null = null;
        // Try WebCrypto export envelopes first, then legacy salt.iv.ciphertext.
        if (isWebCryptoPayload(processedContent)) {
          try {
            decrypted = await decryptWithPassword(processedContent, password);
          } catch {
            // fall through to legacy
          }
        }
        // Fallback: legacy CryptoJS-format ciphertext decrypted via Rust backend.
        if (!decrypted) {
          const invoke = (globalThis as any).__TAURI__?.core?.invoke;
          if (invoke) {
            try {
              decrypted = (await invoke(
                'crypto_legacy_decrypt_cryptojs',
                { ciphertext: processedContent, password },
              )) as string;
            } catch {
              decrypted = null;
            }
          }
        }
        if (!decrypted) {
          throw new Error('Failed to decrypt file. Check your password.');
        }
        processedContent = decrypted;
      }

      const detectedFormat = detectImportFormat(processedContent, filename);
      const detectedFormatName = getFormatName(detectedFormat);
      let encryptionAnalysis: ImportSourceMetadata['encryption'] | undefined =
        encryptedWrapper
          ? {
              protected: true,
              fullFileEncryption: false,
              requiresPassword: true,
            }
          : undefined;
      let vpnConnections: ImportVpnData | undefined;
      let tunnelChainTemplates: ImportResult['tunnelChainTemplates'];
      if (detectedFormat === 'json') {
        try {
          const parsed = JSON.parse(processedContent);
          vpnConnections = normalizeVpnImportData(parsed.vpnConnections);
          if (Array.isArray(parsed.tunnelChainTemplates)) {
            tunnelChainTemplates = parsed.tunnelChainTemplates;
          }
        } catch {
          // Not a JSON file or no VPN data -- ignore
        }
      }

      const hasJsonSidecarData =
        Boolean(
          vpnConnections &&
            (vpnConnections.openvpn.length > 0 ||
              vpnConnections.wireguard.length > 0 ||
              vpnConnections.tailscale.length > 0 ||
              vpnConnections.zerotier.length > 0),
        ) || Boolean(tunnelChainTemplates?.length);

      let connections: Connection[] = [];
      if (detectedFormat === 'mremoteng') {
        const enc = detectMRemoteNGEncryption(processedContent);
        encryptionAnalysis = {
          protected: enc.isEncrypted,
          fullFileEncryption: enc.fullFileEncryption,
          requiresPassword: enc.requiresPassword,
        };
        if (enc.isEncrypted) {
          // Step 1: figure out which master password to use by validating
          // against the file's `Protected` sentinel. If the user never set a
          // master password, the literal `mR3m` decrypts everything; only
          // prompt when the file uses a custom master.
          const defaultCheck = await verifyMRemoteNGPassword(
            processedContent,
            MREMOTENG_DEFAULT_MASTER_PASSWORD,
          );

          let masterPassword: string | null = null;
          if (defaultCheck.valid) {
            masterPassword = MREMOTENG_DEFAULT_MASTER_PASSWORD;
            encryptionAnalysis.defaultMasterPasswordAccepted = true;
          } else {
            // Custom master password set — prompt and re-validate.
            let attemptError: string | undefined;
            for (let attempt = 0; attempt < 3; attempt++) {
              const candidate = await requestPassword({
                title: 'Encrypted mRemoteNG file',
                description:
                  'Enter the mRemoteNG master password used to encrypt this export.',
                error: attemptError,
              });
              if (!candidate) break;
              const check = await verifyMRemoteNGPassword(
                processedContent,
                candidate,
              );
              if (check.valid) {
                masterPassword = candidate;
                encryptionAnalysis.defaultMasterPasswordAccepted = false;
                break;
              }
              attemptError = 'Incorrect master password — try again.';
            }
          }

          if (!masterPassword) {
            throw new Error('Password required for encrypted mRemoteNG file');
          }

          // Step 2: actual decryption. With the password validated this can
          // only fail on cipher-mode incompatibility or corrupted bodies.
          let decryptedXml: string;
          try {
            decryptedXml = await decryptMRemoteNGXml(
              processedContent,
              masterPassword,
            );
          } catch (e) {
            throw new Error(
              `Failed to decrypt mRemoteNG file: ${e instanceof Error ? e.message : String(e)}`,
            );
          }

          connections = await importConnections(
            decryptedXml,
            filename,
            detectedFormat,
          );
          console.log(
            `[mRemoteNG] decrypted import returned ${connections.length} connections (master=${defaultCheck.valid ? 'default mR3m' : 'user-supplied'})`,
          );
        } else {
          connections = await importConnections(
            processedContent,
            filename,
            detectedFormat,
          );
        }
      } else {
        try {
          connections = await importConnections(
            processedContent,
            filename,
            detectedFormat,
          );
        } catch (error) {
          if (!hasJsonSidecarData) {
            throw error;
          }
          connections = [];
        }
      }
      console.log(`Import format detected: ${detectedFormatName}`);

      const actualExtension = filename
        .replace('.encrypted', '')
        .split('.')
        .pop()
        ?.toLowerCase();

      const hasVpnData =
        vpnConnections &&
        (vpnConnections.openvpn.length > 0 ||
          vpnConnections.wireguard.length > 0 ||
          vpnConnections.tailscale.length > 0 ||
          vpnConnections.zerotier.length > 0);
      const hasTunnelChains =
        tunnelChainTemplates && tunnelChainTemplates.length > 0;

      if (
        (!connections || connections.length === 0) &&
        !hasVpnData &&
        !hasTunnelChains
      ) {
        throw new Error(
          `No connections found in ${actualExtension?.toUpperCase()} file`,
        );
      }
      const previewItems = buildImportPreviewItems(
        connections,
        state.connections,
      );
      const analysis = buildImportAnalysis({
        filename,
        sizeBytes,
        format: detectedFormat,
        formatName: detectedFormatName,
        content: processedContent,
        connections,
        previewItems,
        vpnConnections,
        tunnelChainTemplates,
        encryption: encryptionAnalysis,
      });

      return {
        success: true,
        imported: connections.length,
        errors,
        connections,
        vpnConnections,
        tunnelChainTemplates,
        analysis,
        previewItems,
        selectedIds: previewItems
          .filter((item) => item.selectedByDefault)
          .map((item) => item.id),
        selectedCount: previewItems.filter((item) => item.selectedByDefault)
          .length,
      };
    } catch (error) {
      return {
        success: false,
        imported: 0,
        errors: [error instanceof Error ? error.message : 'Import failed'],
        connections: [],
      };
    }
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File is too large. Maximum allowed size is 50 MB.');
      return;
    }
    setIsProcessing(true);
    setImportResult(null);
    setImportAnalysis(null);
    setSelectedPreviewIds(new Set());
    setImportFilters(DEFAULT_IMPORT_FILTERS);
    setImportFilename(file.name);
    try {
      const content = await readFileContent(file);
      const result = await processImportFile(file.name, content, file.size);
      setImportResult(result);
      setImportAnalysis(result.analysis ?? null);
      setSelectedPreviewIds(new Set(result.selectedIds ?? []));
      if (!result.success) {
        console.error('Import failed:', result.errors);
        toast.error('Import failed. Check the file format and try again.');
      }
    } catch (error) {
      console.error('Import failed:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      setImportResult({
        success: false,
        imported: 0,
        errors: [errorMessage],
        connections: [],
      });
      setImportAnalysis(null);
      setSelectedPreviewIds(new Set());
      toast.error('Import failed. Check the console for details.');
    } finally {
      setIsProcessing(false);
      // Clear the file input so re-selecting the same file fires onChange again
      // (browsers suppress change events when the value is unchanged, so a user
      // who cancels the password prompt and re-picks the same file would
      // otherwise see nothing happen).
      if (event.target) {
        try {
          (event.target as HTMLInputElement).value = '';
        } catch {
          // ignored — some test harnesses make .value read-only
        }
      }
    }
  };

  const confirmImport = async (filename?: string) => {
    if (importResult && importResult.success) {
      const selectedItems = importResult.previewItems
        ? importResult.previewItems.filter(
            (item) =>
              selectedPreviewIds.has(item.id) &&
              item.importable &&
              item.connection,
          )
        : importResult.connections.map((connection, index) => ({
            id: `legacy:${connection.id}:${index}`,
            connection,
            conflictStatus: 'none' as const,
          }));

      const addTags = splitTags(importOptions.addTags);
      const selectedOriginalIds = new Set(
        selectedItems
          .map((item) => item.connection?.id)
          .filter(Boolean) as string[],
      );
      const remappedIds = new Map<string, string>();

      selectedItems.forEach((item) => {
        const connection = item.connection;
        if (!connection) return;
        if (
          item.conflictStatus === 'sameId' ||
          importOptions.conflictPolicy === 'rename'
        ) {
          remappedIds.set(connection.id, generateId());
        }
      });

      const connectionsToImport = selectedItems
        .filter((item) => {
          if (importOptions.conflictPolicy !== 'skip') return true;
          return item.conflictStatus === 'none';
        })
        .flatMap((item) => {
          const connection = item.connection;
          if (!connection) return [];

          let next: Connection = { ...connection };
          const remappedId = remappedIds.get(next.id);
          if (remappedId) {
            next.id = remappedId;
          }
          if (
            next.parentId &&
            (!importOptions.preserveFolders || !selectedOriginalIds.has(next.parentId))
          ) {
            next.parentId = undefined;
          } else if (next.parentId && remappedIds.has(next.parentId)) {
            next.parentId = remappedIds.get(next.parentId);
          }
          if (
            importOptions.conflictPolicy === 'rename' &&
            item.conflictStatus !== 'none'
          ) {
            next.name = `${next.name} (imported)`;
          }
          if (addTags.length > 0) {
            next.tags = Array.from(new Set([...(next.tags || []), ...addTags]));
          }
          if (!importOptions.includeCredentials) {
            next = stripConnectionCredentials(next);
          }
          return [next];
        })
        .filter((connection) => importOptions.preserveFolders || !connection.isGroup);

      connectionsToImport.forEach((conn) => {
        dispatch({ type: 'ADD_CONNECTION', payload: conn });
      });

      // Restore VPN connections
      let vpnImportedCount = 0;
      if (importOptions.includeVpnData && importResult.vpnConnections) {
        const proxyMgr = ProxyOpenVPNManager.getInstance();

        for (const conn of importResult.vpnConnections.openvpn) {
          try {
            await proxyMgr.createOpenVPNConnection(conn.name, conn.config);
            vpnImportedCount++;
          } catch (e) {
            console.warn('VPN import skip (OpenVPN):', e);
          }
        }
        for (const conn of importResult.vpnConnections.wireguard) {
          try {
            await proxyMgr.createWireGuardConnection(conn.name, conn.config);
            vpnImportedCount++;
          } catch (e) {
            console.warn('VPN import skip (WireGuard):', e);
          }
        }
        for (const conn of importResult.vpnConnections.tailscale) {
          try {
            await proxyMgr.createTailscaleConnection(conn.name, conn.config);
            vpnImportedCount++;
          } catch (e) {
            console.warn('VPN import skip (Tailscale):', e);
          }
        }
        for (const conn of importResult.vpnConnections.zerotier) {
          try {
            await proxyMgr.createZeroTierConnection(conn.name, conn.config);
            vpnImportedCount++;
          } catch (e) {
            console.warn('VPN import skip (ZeroTier):', e);
          }
        }
      }

      // Restore tunnel chain templates
      let tunnelChainsImportedCount = 0;
      if (
        importOptions.includeTunnelChains &&
        importResult.tunnelChainTemplates?.length
      ) {
        for (const chain of importResult.tunnelChainTemplates) {
          try {
            await proxyCollectionManager.createTunnelChain(
              chain.name,
              chain.layers,
              { description: chain.description, tags: chain.tags },
            );
            tunnelChainsImportedCount++;
          } catch (e) {
            console.warn('Tunnel chain import skip:', e);
          }
        }
      }

      const connectionCount = connectionsToImport.length;
      const parts: string[] = [];
      if (connectionCount > 0) {
        parts.push(`${connectionCount} connection(s)`);
      }
      if (vpnImportedCount > 0) {
        parts.push(`${vpnImportedCount} VPN connection(s)`);
      }
      if (tunnelChainsImportedCount > 0) {
        parts.push(`${tunnelChainsImportedCount} tunnel chain(s)`);
      }
      const summary = parts.join(', ') || '0 items';

      toast.success(
        filename
          ? `Imported ${summary} from ${filename}`
          : `Imported ${summary} successfully`,
      );
      settingsManager.logAction(
        'info',
        'Data imported',
        undefined,
        `Imported ${summary}${filename ? ` from ${filename}` : ''}`,
      );
      setImportResult(null);
      setImportAnalysis(null);
      setSelectedPreviewIds(new Set());
      setImportFilters(DEFAULT_IMPORT_FILTERS);
      onClose();
    }
  };

  const cancelImport = () => {
    setImportResult(null);
    setImportFilename('');
    setImportAnalysis(null);
    setSelectedPreviewIds(new Set());
    setImportFilters(DEFAULT_IMPORT_FILTERS);
  };

  return {
    connections: state.connections,
    activeTab,
    setActiveTab,
    exportFormat,
    setExportFormat,
    exportScopeMode,
    setExportScopeMode,
    selectedExportDatabaseIds,
    setSelectedExportDatabaseIds,
    exportDatabaseOptions,
    refreshExportDatabaseOptions,
    exportEncrypted,
    setExportEncrypted,
    exportPassword,
    setExportPassword,
    exportInclusion,
    updateExportInclusion,
    includePasswords,
    setIncludePasswords,
    includeVpnData,
    setIncludeVpnData,
    includeTunnelChains,
    setIncludeTunnelChains,
    includeTabGroups,
    setIncludeTabGroups,
    includeColorTags,
    setIncludeColorTags,
    exportKeyDerivationIterations,
    setExportKeyDerivationIterations,
    exportSecuritySettings,
    importResult,
    importFilename,
    importAnalysis,
    importFilters,
    updateImportFilters,
    resetImportFilters,
    importOptions,
    updateImportOptions,
    importPreviewItems,
    visiblePreviewItems,
    availableImportProtocols,
    selectedPreviewIds,
    selectedImportCount,
    togglePreviewSelection,
    selectAllVisiblePreviewItems,
    deselectAllVisiblePreviewItems,
    selectAllImportablePreviewItems,
    isProcessing,
    fileInputRef,
    handleExport,
    handleImport,
    handleFileSelect,
    confirmImport,
    cancelImport,
    passwordPrompt,
    submitPasswordPrompt,
    cancelPasswordPrompt,
  };
}
