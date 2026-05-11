import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Connection } from '../../types/connection/connection';
import { useConnections } from '../../contexts/useConnections';
import { useToastContext } from '../../contexts/ToastContext';
import { CollectionManager } from '../../utils/connection/collectionManager';
import { SettingsManager } from '../../utils/settings/settingsManager';
import {
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
} from '../../utils/crypto/webCryptoAes';
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

const connectionHasCredentials = (connection: Connection): boolean =>
  Boolean(
    connection.password ||
      connection.privateKey ||
      connection.passphrase ||
      connection.totpSecret ||
      connection.basicAuthPassword,
  );

const stripConnectionCredentials = (connection: Connection): Connection => {
  const next = { ...connection };
  delete next.password;
  delete next.privateKey;
  delete next.passphrase;
  delete next.totpSecret;
  delete next.basicAuthPassword;
  delete next.rustdeskPassword;
  return next;
};

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
    const shape = Array.isArray(parsed.connections)
      ? keys.includes('version') || keys.includes('exportDate')
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
  const [activeTab, setActiveTab] = useState<'export' | 'import'>(initialTab);
  const [exportFormat, setExportFormat] = useState<'json' | 'xml' | 'csv'>(
    'json',
  );
  const [exportEncrypted, setExportEncrypted] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [includePasswords, setIncludePasswords] = useState(false);
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

  const collectionManager = CollectionManager.getInstance();
  const settingsManager = SettingsManager.getInstance();

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

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

  const exportToXML = (): string => {
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const xmlRoot = '<sortOfRemoteNG>\n';
    const xmlConnections = state.connections
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

  const exportToCSV = (): string => {
    const headers = [
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
    const rows = state.connections.map((conn) => [
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
      conn.createdAt,
      conn.updatedAt,
    ]);
    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  };

  const handleExport = async () => {
    setIsProcessing(true);
    try {
      let content: string;
      let filename: string;
      let mimeType: string;
      const shouldUsePasswordEncryption = exportEncrypted && Boolean(exportPassword);

      const currentCollection = collectionManager.getCurrentCollection();
      if (!currentCollection) throw new Error('No collection selected');

      switch (exportFormat) {
        case 'json': {
          content = await collectionManager.exportCollection(
            currentCollection.id,
            includePasswords,
            shouldUsePasswordEncryption ? exportPassword : undefined,
          );

          // Enrich with VPN connections and tunnel chain templates
          try {
            const parsed = JSON.parse(content);
            const proxyMgr = ProxyOpenVPNManager.getInstance();

            const [vpnOpenVPN, vpnWireGuard, vpnTailscale, vpnZeroTier] =
              await Promise.allSettled([
                proxyMgr.listOpenVPNConnections(),
                proxyMgr.listWireGuardConnections(),
                proxyMgr.listTailscaleConnections(),
                proxyMgr.listZeroTierConnections(),
              ]);

            const tunnelChains = proxyCollectionManager.getTunnelChains();

            parsed.vpnConnections = {
              openvpn:
                vpnOpenVPN.status === 'fulfilled' ? vpnOpenVPN.value : [],
              wireguard:
                vpnWireGuard.status === 'fulfilled' ? vpnWireGuard.value : [],
              tailscale:
                vpnTailscale.status === 'fulfilled' ? vpnTailscale.value : [],
              zerotier:
                vpnZeroTier.status === 'fulfilled' ? vpnZeroTier.value : [],
            };
            parsed.tunnelChainTemplates = tunnelChains;

            content = JSON.stringify(parsed, null, 2);
          } catch (e) {
            console.warn('Failed to include VPN data in export:', e);
          }

          filename = generateExportFilename('json');
          mimeType = 'application/json';
          break;
        }
        case 'xml':
          content = exportToXML();
          filename = generateExportFilename('xml');
          mimeType = 'application/xml';
          break;
        case 'csv':
          content = exportToCSV();
          filename = generateExportFilename('csv');
          mimeType = 'text/csv';
          break;
        default:
          throw new Error('Unsupported export format');
      }

      if (shouldUsePasswordEncryption && exportFormat !== 'json') {
        content = await encryptWithPassword(content, exportPassword);
        filename = filename.replace(/\.[^.]+$/, '.encrypted$&');
      }

      downloadFile(content, filename, mimeType);
      toast.success(`Exported successfully: ${filename}`);
      settingsManager.logAction(
        'info',
        'Data exported',
        undefined,
        `Exported ${state.connections.length} connections to ${exportFormat.toUpperCase()}${shouldUsePasswordEncryption ? ' (encrypted)' : ''}`,
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
        filename.split('.').pop()?.toLowerCase() === 'encrypted';
      if (
        encryptedWrapper
      ) {
        const password = await requestPassword({
          title: 'Decrypt import file',
          description: 'This file is encrypted. Enter the password used during export to decrypt it.',
        });
        if (!password) throw new Error('Password required for encrypted file');
        let decrypted: string | null = null;
        // Try new WebCrypto format first (salt.iv.ciphertext).
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
    exportEncrypted,
    setExportEncrypted,
    exportPassword,
    setExportPassword,
    includePasswords,
    setIncludePasswords,
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
