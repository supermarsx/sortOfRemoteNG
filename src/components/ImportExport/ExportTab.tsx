import React, { useState } from 'react';
import { Download, FileText, Database, Settings, Lock, ShieldCheck, AlertTriangle, KeyRound, FolderTree, Tags, SlidersHorizontal, Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PasswordInput, Checkbox, NumberInput, Select } from '../ui/forms';
import { Connection } from '../../types/connection/connection';
import type { ExportConfig, ExportConfigUpdate, ExportInclusionConfig } from './types';
import { AccordionSection } from './AccordionSection';
import { DatabasePickerRow } from './DatabasePickerRow';
import {
  InclusionItemPickers,
  InclusionProtocolFilter,
  type InclusionConnectionOption,
  type InclusionFolderOption,
  type InclusionListOption,
} from './InclusionPickers';
import { analyzePasswordStrength } from '../../hooks/security/usePasswordStrength';
import { SettingsManager } from '../../utils/settings/settingsManager';
import { proxyCollectionManager } from '../../utils/connection/proxyCollectionManager';
import { ProxyOpenVPNManager } from '../../utils/network/proxyOpenVPNManager';

export type { ExportConfig } from './types';

interface ExportTabProps {
  connections: Connection[];
  config: ExportConfig;
  onConfigChange: (update: ExportConfigUpdate) => void;
  isProcessing: boolean;
  handleExport: () => void;
  /** Inline-unlock handler triggered from each locked row's
   *  "Unlock…" button. Comes from the parent hook so all three
   *  pickers share the same prompt loop. */
  onUnlockDatabase?: (databaseId: string) => Promise<boolean> | void;
}

const hasExportableCredentials = (connection: Connection): boolean =>
  Boolean(
    connection.password ||
      connection.privateKey ||
      connection.passphrase ||
      connection.totpSecret ||
      connection.basicAuthPassword ||
      connection.rustdeskPassword,
  );

const getEffectiveExportDatabaseIds = (config: ExportConfig): string[] => {
  const exportableOptions = config.databaseOptions.filter((option) => option.isExportable);
  if (config.scopeMode === 'current') {
    const currentOption = exportableOptions.find((option) => option.isCurrent);
    return currentOption ? [currentOption.id] : [];
  }

  if (config.scopeMode === 'all') {
    return exportableOptions.map((option) => option.id);
  }

  const exportableIds = new Set(exportableOptions.map((option) => option.id));
  return config.selectedDatabaseIds.filter((id) => exportableIds.has(id));
};

const getAncestorFolderIds = (
  connection: Connection,
  connectionsById: Map<string, Connection>,
): string[] => {
  const ids: string[] = [];
  const visited = new Set<string>();
  let parentId = connection.parentId;

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = connectionsById.get(parentId);
    if (!parent?.isGroup) break;
    ids.push(parent.id);
    parentId = parent.parentId;
  }

  return ids;
};

const getConnectionDisplayPath = (
  connection: Connection,
  connectionsById: Map<string, Connection>,
): string => {
  const names = [connection.name || 'Unnamed item'];
  const visited = new Set<string>();
  let parentId = connection.parentId;

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = connectionsById.get(parentId);
    if (!parent) break;
    names.unshift(parent.name || 'Unnamed folder');
    parentId = parent.parentId;
  }

  return names.join(' / ');
};

const filterPreviewConnections = (
  connections: Connection[],
  inclusion: ExportInclusionConfig,
): Connection[] => {
  if (!inclusion.includeConnections) return [];

  const includedProtocolSet = inclusion.includedProtocols.length > 0
    ? new Set(inclusion.includedProtocols)
    : null;
  const includedConnectionSet = (inclusion.includedConnectionIds ?? []).length > 0
    ? new Set(inclusion.includedConnectionIds)
    : null;
  const includedTextTagSet = (inclusion.includedTextTags ?? []).length > 0
    ? new Set(inclusion.includedTextTags)
    : null;
  const includedColorTagSet = (inclusion.includedColorTagIds ?? []).length > 0
    ? new Set(inclusion.includedColorTagIds)
    : null;
  const includedFolderSet = (inclusion.includedFolderIds ?? []).length > 0
    ? new Set(inclusion.includedFolderIds)
    : null;
  const byId = new Map(connections.map((connection) => [connection.id, connection]));
  const leaves = connections.filter(
    (connection) =>
      !connection.isGroup &&
      (!includedProtocolSet || includedProtocolSet.has(connection.protocol)) &&
      (!includedConnectionSet || includedConnectionSet.has(connection.id)) &&
      (!includedTextTagSet ||
        (connection.tags ?? []).some((tag) => includedTextTagSet.has(tag))) &&
      (!includedColorTagSet ||
        (connection.colorTag != null && includedColorTagSet.has(connection.colorTag))) &&
      (!includedFolderSet ||
        getAncestorFolderIds(connection, byId).some((id) => includedFolderSet.has(id))),
  );
  const leafIds = new Set(leaves.map((connection) => connection.id));
  const folderIds = new Set<string>();

  if (inclusion.includeFolderItems) {
    if (inclusion.includeEmptyFolders) {
      const selectedFolderAncestorIds = new Set<string>();
      if (includedFolderSet) {
        includedFolderSet.forEach((folderId) => {
          const folder = byId.get(folderId);
          if (folder?.isGroup) {
            getAncestorFolderIds(folder, byId).forEach((id) =>
              selectedFolderAncestorIds.add(id),
            );
          }
        });
      }

      connections
        .filter((connection) => connection.isGroup)
        .forEach((connection) => {
          if (!includedFolderSet) {
            folderIds.add(connection.id);
            return;
          }
          const ancestors = getAncestorFolderIds(connection, byId);
          if (
            includedFolderSet.has(connection.id) ||
            selectedFolderAncestorIds.has(connection.id) ||
            ancestors.some((id) => includedFolderSet.has(id))
          ) {
            folderIds.add(connection.id);
          }
        });
    } else {
      leaves.forEach((connection) => {
        let parentId = connection.parentId;
        const visited = new Set<string>();
        while (parentId && !visited.has(parentId)) {
          visited.add(parentId);
          const parent = byId.get(parentId);
          if (!parent?.isGroup) break;
          folderIds.add(parent.id);
          parentId = parent.parentId;
        }
      });
    }
  }

  return connections.filter((connection) =>
    connection.isGroup
      ? inclusion.includeFolderItems && folderIds.has(connection.id)
      : leafIds.has(connection.id),
  );
};

// AccordionSection lifted to its own module so CloneTab can reuse
// the same look + a11y surface without copy-pasting 60 lines.

const ExportTab: React.FC<ExportTabProps> = ({
  connections,
  config,
  onConfigChange,
  isProcessing,
  handleExport,
  onUnlockDatabase,
}) => {
  const { t } = useTranslation();
  const [sectionsOpen, setSectionsOpen] = useState({
    inclusion: true,
    connections: false,
    folders: false,
    textTags: false,
    colorTags: false,
    proxyProfiles: false,
    proxyChains: false,
    vpnConnections: false,
    encryption: false,
  });
  const [vpnConnections, setVpnConnections] = useState<
    Array<{ id: string; name: string; kind: string }>
  >([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mgr = ProxyOpenVPNManager.getInstance();
        const [ovpn, wg, tailscale, zerotier] = await Promise.all([
          mgr.listOpenVPNConnections().catch(() => [] as any[]),
          mgr.listWireGuardConnections().catch(() => [] as any[]),
          mgr.listTailscaleConnections().catch(() => [] as any[]),
          mgr.listZeroTierConnections().catch(() => [] as any[]),
        ]);
        if (cancelled) return;
        setVpnConnections([
          ...ovpn.map((c) => ({ id: c.id, name: c.name, kind: 'OpenVPN' })),
          ...wg.map((c) => ({ id: c.id, name: c.name, kind: 'WireGuard' })),
          ...tailscale.map((c) => ({ id: c.id, name: c.name, kind: 'Tailscale' })),
          ...zerotier.map((c) => ({ id: c.id, name: c.name, kind: 'ZeroTier' })),
        ]);
      } catch {
        // ignore — keep list empty
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const proxyProfiles = React.useMemo(
    () => proxyCollectionManager.getProfiles(),
    [],
  );
  const proxyChains = React.useMemo(() => proxyCollectionManager.getChains(), []);
  const tunnelChains = React.useMemo(
    () => proxyCollectionManager.getTunnelChains(),
    [],
  );
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);
  const toggleSection = (key: keyof typeof sectionsOpen) =>
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  const inclusion: ExportInclusionConfig = {
    ...config.inclusion,
    includeCredentials: config.includePasswords,
    includeVpnData: config.includeVpnData,
    includeTunnelChains: config.includeTunnelChains,
    includeTabGroups: config.includeTabGroups,
    includeColorTags: config.includeColorTags,
  };

  const availableTextTags = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of connections) {
      if (Array.isArray(c.tags)) {
        for (const tag of c.tags) {
          if (tag) set.add(tag);
        }
      }
    }
    return Array.from(set).sort();
  }, [connections]);

  const availableColorTagIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of connections) {
      if (c.colorTag) set.add(c.colorTag);
    }
    return Array.from(set).sort();
  }, [connections]);

  const selectableConnections: InclusionConnectionOption[] = React.useMemo(
    () =>
      connections
        .filter((c) => !c.isGroup)
        .map((connection) => ({
          id: connection.id,
          name: connection.name,
          protocol: connection.protocol,
          hostname: connection.hostname,
        })),
    [connections],
  );

  const selectableFolders: InclusionFolderOption[] = React.useMemo(() => {
    const byId = new Map(connections.map((connection) => [connection.id, connection]));
    return connections
      .filter((connection) => connection.isGroup)
      .map((folder) => ({
        id: folder.id,
        name: folder.name,
        sourcePath: getConnectionDisplayPath(folder, byId),
      }));
  }, [connections]);

  const proxyProfileOptions: InclusionListOption[] = React.useMemo(
    () =>
      proxyProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        kind: (profile.config?.type ?? '').toUpperCase(),
        description: profile.config?.host,
        searchText: [
          profile.name,
          profile.config?.type,
          profile.config?.host,
          profile.description,
        ]
          .filter(Boolean)
          .join(' '),
      })),
    [proxyProfiles],
  );

  const proxyChainOptions: InclusionListOption[] = React.useMemo(
    () => [
      ...proxyChains.map((chain) => ({
        id: chain.id,
        key: `proxy:${chain.id}`,
        name: chain.name,
        kind: 'Proxy chain',
        description: `${chain.layers?.length ?? 0} ${
          (chain.layers?.length ?? 0) === 1 ? 'layer' : 'layers'
        }`,
        searchText: [chain.name, chain.description, ...(chain.tags ?? [])]
          .filter(Boolean)
          .join(' '),
      })),
      ...tunnelChains.map((chain) => ({
        id: chain.id,
        key: `tunnel:${chain.id}`,
        name: chain.name,
        kind: 'Tunnel chain',
        description: `${chain.layers?.length ?? 0} ${
          (chain.layers?.length ?? 0) === 1 ? 'layer' : 'layers'
        }`,
        searchText: [chain.name, chain.description, ...(chain.tags ?? [])]
          .filter(Boolean)
          .join(' '),
      })),
    ],
    [proxyChains, tunnelChains],
  );

  const vpnConnectionOptions: InclusionListOption[] = React.useMemo(
    () =>
      vpnConnections.map((connection) => ({
        id: connection.id,
        name: connection.name,
        kind: connection.kind,
        searchText: `${connection.name} ${connection.kind}`,
      })),
    [vpnConnections],
  );

  const runPbkdf2Benchmark = async () => {
    setBenchmarkError(null);
    setIsBenchmarking(true);
    try {
      const optimal = await SettingsManager.getInstance().benchmarkKeyDerivation(10);
      onConfigChange({ keyDerivationIterations: optimal });
    } catch (err) {
      setBenchmarkError(err instanceof Error ? err.message : 'Benchmark failed');
    } finally {
      setIsBenchmarking(false);
    }
  };

  const previewConnections = filterPreviewConnections(connections, inclusion);
  const folderCount = previewConnections.filter((connection) => connection.isGroup).length;
  const leafConnectionCount = previewConnections.filter((connection) => !connection.isGroup).length;
  const credentialConnectionCount = previewConnections.filter(hasExportableCredentials).length;
  const protocolCount = new Set(
    previewConnections
      .filter((connection) => !connection.isGroup)
      .map((connection) => connection.protocol),
  ).size;
  const availableProtocols = Array.from(
    new Set(
      connections
        .filter((connection) => !connection.isGroup)
        .map((connection) => connection.protocol),
    ),
  ).sort();
  const effectiveDatabaseIds = getEffectiveExportDatabaseIds(config);
  const effectiveDatabaseCount = effectiveDatabaseIds.length;
  const exportableDatabaseCount = config.databaseOptions.filter((option) => option.isExportable).length;
  const lockedDatabaseCount = config.databaseOptions.filter(
    (option) => option.isEncrypted && !option.isExportable,
  ).length;
  const selectedExportableOptions = config.databaseOptions.filter((option) =>
    effectiveDatabaseIds.includes(option.id),
  );
  const hasUnknownSelectedCounts = selectedExportableOptions.some(
    (option) => !option.isCurrent && option.connectionCount === undefined,
  );
  const connectionsPreviewLabel = hasUnknownSelectedCounts
    ? t('exportTab.previewConnectionsLoadedOnly', {
        count: leafConnectionCount,
        defaultValue: `${leafConnectionCount} from the open database; other selected databases are counted during export`,
      })
    : t('exportTab.previewConnectionsCount', {
        count: leafConnectionCount,
        defaultValue: `${leafConnectionCount} connection(s)`,
      });
  const multiDatabaseExport = effectiveDatabaseCount > 1;
  const singleDatabaseFormatBlocked =
    multiDatabaseExport && (config.format === 'xml' || config.format === 'mremoteng');
  const compatibilityWarnings = [
    ...(config.format === 'json'
      ? []
      : [
          config.format === 'xml'
            ? t('exportTab.warningXmlLimited')
            : config.format === 'mremoteng'
              ? t('exportTab.warningMRemoteNGLimited')
              : t('exportTab.warningInventoryOnly'),
        ]),
    ...(config.format !== 'json' && inclusion.includeCredentials
      ? [t('exportTab.warningPasswordsSkipped')]
      : []),
    ...(config.format !== 'json' && (
      inclusion.includeVpnData ||
      inclusion.includeTunnelChains ||
      inclusion.includeTabGroups ||
      inclusion.includeColorTags ||
      inclusion.includeSettings ||
      inclusion.includeExportMetadata ||
      inclusion.includeDatabaseMetadata
    )
      ? [t('exportTab.warningSidecarsLimited')]
      : []),
    ...(!inclusion.includeConnections
      ? [t('exportTab.warningConnectionsExcluded', { defaultValue: 'Connections are excluded; this export can still carry settings and metadata.' })]
      : []),
    ...(inclusion.includedProtocols.length > 0
      ? [t('exportTab.warningProtocolFilter', {
          protocols: inclusion.includedProtocols.join(', '),
          defaultValue: `Protocol filter active: ${inclusion.includedProtocols.join(', ')}`,
        })]
      : []),
    ...(hasUnknownSelectedCounts
      ? [t('exportTab.warningUnknownDatabaseCounts', { defaultValue: 'Counts for non-open databases are checked when the export runs.' })]
      : []),
    ...(config.format === 'mremoteng' && config.encrypted
      ? [t('exportTab.warningMRemoteNGEncrypted')]
      : []),
    ...(singleDatabaseFormatBlocked
      ? [t('exportTab.warningSingleDatabaseFormat')]
      : []),
  ];
  type FormatGroup = 'native' | 'readable' | 'mremoteng';
  type EncryptionScheme = 'aes-gcm' | 'aes-cbc' | 'office' | 'mremoteng';
  interface FormatOption {
    value: ExportConfig['format'];
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    desc: string;
    group: FormatGroup;
    encryption: EncryptionScheme;
  }

  const formatOptions: FormatOption[] = [
    // Native sortOfRemoteNG file formats — full-fidelity, AES-GCM envelope.
    { value: 'json', label: 'JSON', icon: FileText, desc: t('exportTab.formatJson'), group: 'native', encryption: 'aes-gcm' },
    { value: 'xml', label: 'XML', icon: Database, desc: t('exportTab.formatXml'), group: 'native', encryption: 'aes-gcm' },
    { value: 'csv', label: 'CSV', icon: Settings, desc: t('exportTab.formatCsv'), group: 'native', encryption: 'aes-gcm' },
    // Readable / inventory formats — simple AES-CBC for the text outputs,
    // OOXML password protection for Excel.
    { value: 'txt', label: 'TXT', icon: FileText, desc: t('exportTab.formatTxt'), group: 'readable', encryption: 'aes-cbc' },
    { value: 'markdown', label: 'Markdown', icon: FileText, desc: t('exportTab.formatMarkdown'), group: 'readable', encryption: 'aes-cbc' },
    { value: 'html', label: 'HTML', icon: FileText, desc: t('exportTab.formatHtml'), group: 'readable', encryption: 'aes-cbc' },
    { value: 'excel', label: 'Excel', icon: Settings, desc: t('exportTab.formatExcel'), group: 'readable', encryption: 'office' },
    // Foreign-tool target.
    { value: 'mremoteng', label: 'XML - mRemoteNG compatible', icon: Database, desc: t('exportTab.formatMRemoteNG'), group: 'mremoteng', encryption: 'mremoteng' },
  ];
  const selectedFormat = formatOptions.find((format) => format.value === config.format) ?? formatOptions[0];
  const SelectedFormatIcon = selectedFormat.icon;

  const formatGroups: Array<{
    id: FormatGroup;
    label: string;
    description: string;
  }> = [
    {
      id: 'native',
      label: t('exportTab.formatGroupNativeTitle', { defaultValue: 'Native sortOfRemoteNG formats' }) as string,
      description: t('exportTab.formatGroupNativeDescription', { defaultValue: 'Full-fidelity round-trip. Supports the full AES-GCM + PBKDF2 envelope when encrypted.' }) as string,
    },
    {
      id: 'readable',
      label: t('exportTab.formatGroupReadableTitle', { defaultValue: 'Readable / plain exports' }) as string,
      description: t('exportTab.formatGroupReadableDescription', { defaultValue: 'Inventory list only, intended for humans or spreadsheets. Text outputs use a simple AES envelope; Excel uses the standard XLSX password (OOXML).' }) as string,
    },
    {
      id: 'mremoteng',
      label: t('exportTab.formatGroupMRemoteNGTitle', { defaultValue: 'mRemoteNG native' }) as string,
      description: t('exportTab.formatGroupMRemoteNGDescription', { defaultValue: 'Targets mRemoteNG\'s own .xml format. Uses mRemoteNG\'s native password scheme when encrypted, so the file imports back into mRemoteNG cleanly.' }) as string,
    },
  ];

  const encryptionSchemeLabel = (scheme: EncryptionScheme): string => {
    switch (scheme) {
      case 'aes-gcm':
        return t('exportTab.encScheme.aesGcm', { defaultValue: 'AES-GCM + PBKDF2' }) as string;
      case 'aes-cbc':
        return t('exportTab.encScheme.aesCbc', { defaultValue: 'AES (simple)' }) as string;
      case 'office':
        return t('exportTab.encScheme.office', { defaultValue: 'XLSX password (OOXML)' }) as string;
      case 'mremoteng':
        return t('exportTab.encScheme.mremoteng', { defaultValue: 'mRemoteNG native' }) as string;
    }
  };
  const strength = analyzePasswordStrength(config.password, {
    detectCommonPasswords: config.strengthSettings.detectCommonPasswords,
    detectRepeatedCharacters: config.strengthSettings.detectRepeatedCharacters,
    detectSequentialPatterns: config.strengthSettings.detectSequentialPatterns,
    rewardUncommonSymbols: config.strengthSettings.rewardUncommonSymbols,
    customCommonPasswords: config.strengthSettings.customCommonPasswords,
  });
  const passwordTooWeak =
    config.encrypted &&
    Boolean(config.password) &&
    config.strengthSettings.enforceMinimumPasswordScore &&
    strength.score < config.strengthSettings.minimumPasswordScore;
  const disableExport =
    isProcessing ||
    effectiveDatabaseCount === 0 ||
    singleDatabaseFormatBlocked ||
    (config.encrypted && !config.password) ||
    passwordTooWeak;
  const scorePercent = Math.max(8, ((strength.score + 1) / 5) * 100);
  const scoreColor =
    strength.score >= 3
      ? 'bg-success'
      : strength.score === 2
        ? 'bg-warning'
        : 'bg-danger';
  const selectedDatabaseIdSet = new Set(config.selectedDatabaseIds);
  const scopeOptions: Array<{
    value: ExportConfig['scopeMode'];
    label: string;
    description: string;
  }> = [
    {
      value: 'current',
      label: t('exportTab.scopeCurrent'),
      description: t('exportTab.scopeCurrentDescription'),
    },
    {
      value: 'selected',
      label: t('exportTab.scopeSelected'),
      description: t('exportTab.scopeSelectedDescription'),
    },
    {
      value: 'all',
      label: t('exportTab.scopeAll'),
      description: t('exportTab.scopeAllDescription'),
    },
  ];

  const toggleDatabaseSelection = (databaseId: string, selected: boolean) => {
    const next = new Set(config.selectedDatabaseIds);
    if (selected) {
      next.add(databaseId);
    } else {
      next.delete(databaseId);
    }
    onConfigChange({ selectedDatabaseIds: Array.from(next) });
  };

  const updateInclusion = (updates: Partial<ExportInclusionConfig>) => {
    onConfigChange({ inclusion: updates });
  };

  const updateCredentialInclusion = (includeCredentials: boolean) => {
    onConfigChange({ includePasswords: includeCredentials });
    updateInclusion({ includeCredentials });
  };

  const inclusionOptions: Array<{
    id: keyof Omit<ExportInclusionConfig, 'includedProtocols'>;
    label: string;
    description: string;
    disabled?: boolean;
  }> = [
    {
      id: 'includeConnections',
      label: t('exportTab.includeConnections', { defaultValue: 'Include connections' }),
      description: t('exportTab.includeConnectionsDescription', { defaultValue: 'Export connection records from the selected databases.' }),
    },
    {
      id: 'includeCredentials',
      label: t('exportTab.includePasswords'),
      description: t('exportTab.includeCredentialsDescription', { defaultValue: 'Keep passwords, keys, tokens, and other private fields in JSON exports.' }),
      disabled: !inclusion.includeConnections,
    },
    {
      id: 'includeSettings',
      label: t('exportTab.includeSettings', { defaultValue: 'Include settings' }),
      description: t('exportTab.includeSettingsDescription', { defaultValue: 'Include database/app settings stored with each exported database.' }),
    },
    {
      id: 'includeFolderItems',
      label: t('exportTab.includeFolderItems', { defaultValue: 'Include folders/groups' }),
      description: t('exportTab.includeFolderItemsDescription', { defaultValue: 'Keep folder records and parent relationships for included connections.' }),
      disabled: !inclusion.includeConnections,
    },
    {
      id: 'includeEmptyFolders',
      label: t('exportTab.includeEmptyFolders', { defaultValue: 'Include empty folders' }),
      description: t('exportTab.includeEmptyFoldersDescription', { defaultValue: 'Keep folders even when no exported connection is inside them.' }),
      disabled: !inclusion.includeConnections || !inclusion.includeFolderItems,
    },
    {
      id: 'includeTabGroups',
      label: t('exportTab.includeTabGroups', { defaultValue: 'Include tab groups' }),
      description: t('exportTab.includeTabGroupsDescription', { defaultValue: 'Include saved tab group definitions when the format supports them.' }),
    },
    {
      id: 'includeColorTags',
      label: t('exportTab.includeColorTags', { defaultValue: 'Include color tags' }),
      description: t('exportTab.includeColorTagsDescription', { defaultValue: 'Include the color tag palette and tag metadata.' }),
    },
    {
      id: 'includeVpnData',
      label: t('exportTab.includeVpnData', { defaultValue: 'Include VPN definitions' }),
      description: t('exportTab.includeVpnDataDescription', { defaultValue: 'Include saved OpenVPN, WireGuard, Tailscale, and ZeroTier definitions.' }),
    },
    {
      id: 'includeTunnelChains',
      label: t('exportTab.includeTunnelChains', { defaultValue: 'Include tunnel chains' }),
      description: t('exportTab.includeTunnelChainsDescription', { defaultValue: 'Include reusable tunnel chain templates.' }),
    },
    {
      id: 'includeExportMetadata',
      label: t('exportTab.includeExportMetadata', { defaultValue: 'Include export metadata' }),
      description: t('exportTab.includeExportMetadataDescription', { defaultValue: 'Include export id, timestamp, selected databases, inclusion flags, totals, and client id.' }),
    },
    {
      id: 'includeDatabaseMetadata',
      label: t('exportTab.includeDatabaseMetadata', { defaultValue: 'Include database metadata' }),
      description: t('exportTab.includeDatabaseMetadataDescription', { defaultValue: 'Include non-secret database ids, names, descriptions, encryption state, and counts.' }),
    },
  ];

  const previewSection = (
    <section
      aria-labelledby="export-preview-heading"
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)] p-4"
      data-testid="export-preview-panel"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 id="export-preview-heading" className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            <SlidersHorizontal size={16} className="text-primary" />
            {t('exportTab.previewTitle', { defaultValue: 'Export preview' })}
          </h4>
          <p className="mt-1 text-xs text-[var(--color-textSecondary)]">
            {t('exportTab.previewDescription', { defaultValue: 'What will be written with the current scope, format, and inclusion settings.' })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-sm bg-primary/15 px-2 py-1 text-primary" data-testid="export-counter-databases">
            {t('exportTab.previewDatabaseBadge', { count: effectiveDatabaseCount, defaultValue: `${effectiveDatabaseCount} database(s)` })}
          </span>
          <span className="rounded-sm bg-[var(--color-surface)] px-2 py-1 text-[var(--color-textSecondary)]">
            {selectedFormat.label}
          </span>
          <span className={`rounded-sm px-2 py-1 ${config.encrypted ? 'bg-warning/15 text-warning' : 'bg-[var(--color-surface)] text-[var(--color-textSecondary)]'}`}>
            {config.encrypted
              ? t('exportTab.previewEncrypted', { defaultValue: 'Encrypted' })
              : t('exportTab.previewNotEncrypted', { defaultValue: 'Not encrypted' })}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="grid grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm" data-testid="export-preview-summary">
              <span className="text-[var(--color-textMuted)]">{t('exportTab.previewDatabases', { defaultValue: 'Databases' })}</span>
              <span className="font-medium text-[var(--color-text)]">
                {t('exportTab.previewDatabaseSummary', {
                  selected: effectiveDatabaseCount,
                  exportable: exportableDatabaseCount,
                  locked: lockedDatabaseCount,
                  defaultValue: `${effectiveDatabaseCount} selected, ${exportableDatabaseCount} exportable, ${lockedDatabaseCount} locked skipped`,
                })}
              </span>
              <span className="text-[var(--color-textMuted)]">{t('exportTab.previewConnections', { defaultValue: 'Connections' })}</span>
              <span className="font-medium text-[var(--color-text)]" data-testid="export-counter-leaf">{connectionsPreviewLabel}</span>
              <span className="text-[var(--color-textMuted)]">{t('exportTab.previewFolders', { defaultValue: 'Folders/groups' })}</span>
              <span className="font-medium text-[var(--color-text)]" data-testid="export-counter-folders">
                {inclusion.includeFolderItems
                  ? t('exportTab.previewFolderSummary', { count: folderCount, defaultValue: `${folderCount} included` })
                  : t('exportTab.previewFoldersOff', { defaultValue: 'Folder records excluded; parents normalized' })}
              </span>
              <span className="text-[var(--color-textMuted)]">{t('exportTab.previewCredentials', { defaultValue: 'Credentials' })}</span>
              <span className="font-medium text-[var(--color-text)]" data-testid="export-counter-credentials">
                {inclusion.includeCredentials
                  ? t('exportTab.previewCredentialsIncluded', { count: credentialConnectionCount, defaultValue: `${credentialConnectionCount} credential-bearing connection(s) included` })
                  : t('exportTab.previewCredentialsRedacted', { count: credentialConnectionCount, defaultValue: `${credentialConnectionCount} credential-bearing connection(s) redacted` })}
              </span>
              <span className="text-[var(--color-textMuted)]">{t('exportTab.previewProtocols', { defaultValue: 'Protocols' })}</span>
              <span className="font-medium text-[var(--color-text)]" data-testid="export-counter-protocols">
                {inclusion.includedProtocols.length > 0
                  ? inclusion.includedProtocols.map((protocol) => protocol.toUpperCase()).join(', ')
                  : t('exportTab.previewAllProtocols', { count: protocolCount, defaultValue: `All current protocols (${protocolCount})` })}
              </span>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <FileText size={16} className="mt-0.5 shrink-0 text-[var(--color-textSecondary)]" />
              <div>
                <div className="font-medium text-[var(--color-text)]">{t('exportTab.previewContent', { defaultValue: 'Included content' })}</div>
                <div className="mt-1 text-xs text-[var(--color-textSecondary)]">
                  {[
                    inclusion.includeSettings ? t('exportTab.previewSettingsOn', { defaultValue: 'settings' }) : undefined,
                    inclusion.includeExportMetadata ? t('exportTab.previewExportMetadataOn', { defaultValue: 'export metadata' }) : undefined,
                    inclusion.includeDatabaseMetadata ? t('exportTab.previewDatabaseMetadataOn', { defaultValue: 'database metadata' }) : undefined,
                  ].filter(Boolean).join(', ') || t('exportTab.previewMetadataOff', { defaultValue: 'metadata and settings excluded' })}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <FolderTree size={16} className="mt-0.5 shrink-0 text-[var(--color-textSecondary)]" />
              <div>
                <div className="font-medium text-[var(--color-text)]">{t('exportTab.previewStructure', { defaultValue: 'Structure' })}</div>
                <div className="mt-1 text-xs text-[var(--color-textSecondary)]">
                  {inclusion.includeFolderItems
                    ? inclusion.includeEmptyFolders
                      ? t('exportTab.previewStructureAllFolders', { defaultValue: 'Folders and empty folders are preserved.' })
                      : t('exportTab.previewStructureAncestors', { defaultValue: 'Only folders that contain exported connections are preserved.' })
                    : t('exportTab.previewStructureFlat', { defaultValue: 'Connections are exported at the root.' })}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Tags size={16} className="mt-0.5 shrink-0 text-[var(--color-textSecondary)]" />
              <div>
                <div className="font-medium text-[var(--color-text)]">{t('exportTab.previewSidecars', { defaultValue: 'Sidecars' })}</div>
                <div className="mt-1 text-xs text-[var(--color-textSecondary)]">
                  {[
                    inclusion.includeTabGroups ? t('exportTab.includeTabGroups', { defaultValue: 'tab groups' }) : undefined,
                    inclusion.includeColorTags ? t('exportTab.includeColorTags', { defaultValue: 'color tags' }) : undefined,
                    inclusion.includeVpnData ? t('exportTab.includeVpnData', { defaultValue: 'VPN definitions' }) : undefined,
                    inclusion.includeTunnelChains ? t('exportTab.includeTunnelChains', { defaultValue: 'tunnel chains' }) : undefined,
                  ].filter(Boolean).join(', ') || t('exportTab.previewSidecarsOff', { defaultValue: 'No sidecars selected' })}
                </div>
              </div>
            </div>
          </div>
        </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-textMuted)]">
        <span data-testid="export-counter-total">
          {t('exportTab.previewTotalItems', { count: previewConnections.length, defaultValue: `${previewConnections.length} item(s) from the open database preview` })}
        </span>
        <span data-testid="export-counter-exportableDatabases">
          {t('exportTab.previewExportableDatabases', { count: exportableDatabaseCount, defaultValue: `${exportableDatabaseCount} exportable database(s)` })}
        </span>
        <span data-testid="export-counter-lockedDatabases">
          {t('exportTab.previewLockedDatabases', { count: lockedDatabaseCount, defaultValue: `${lockedDatabaseCount} locked skipped` })}
        </span>
        <span data-testid="export-counter-warnings">
          {t('exportTab.previewWarnings', { count: compatibilityWarnings.length, defaultValue: `${compatibilityWarnings.length} warning(s)` })}
        </span>
      </div>
    </section>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">{t('exportTab.title')}</h3>
        <p className="text-[var(--color-textSecondary)] mb-4">
          {t('exportTab.description')}
        </p>
      </div>

      <section
        aria-labelledby="export-scope-heading"
        className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)] p-4"
        data-testid="export-scope-section"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 id="export-scope-heading" className="text-sm font-medium text-[var(--color-text)]">
              {t('exportTab.scopeTitle')}
            </h4>
            <p className="mt-1 text-xs text-[var(--color-textSecondary)]">
              {t('exportTab.scopeDescription')}
            </p>
          </div>
          <div className="text-xs text-[var(--color-textMuted)]" data-testid="export-scope-count">
            {t('exportTab.scopeCount', { count: effectiveDatabaseCount })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label={t('exportTab.scopeTitle')}>
          {scopeOptions.map((scope) => {
            const active = config.scopeMode === scope.value;
            return (
              <button
                key={scope.value}
                type="button"
                data-testid={`export-scope-${scope.value}`}
                onClick={() => onConfigChange({ scopeMode: scope.value })}
                className={`rounded-md border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-primary bg-primary/15 text-[var(--color-text)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-textSecondary)] hover:border-primary/60 hover:text-[var(--color-text)]'
                }`}
                aria-pressed={active}
              >
                <span className="block text-sm font-medium">{scope.label}</span>
                <span className="mt-1 block text-xs text-[var(--color-textMuted)]">{scope.description}</span>
              </button>
            );
          })}
        </div>

        {config.scopeMode === 'selected' && (
          <div className="space-y-2" data-testid="export-database-checklist">
            {config.databaseOptions.map((database) => (
              <DatabasePickerRow
                key={database.id}
                option={database}
                dataTestId={`export-database-option-${database.id}`}
                onUnlock={onUnlockDatabase}
                control={
                  <Checkbox
                    checked={database.isExportable && selectedDatabaseIdSet.has(database.id)}
                    disabled={!database.isExportable}
                    onChange={(checked: boolean) => toggleDatabaseSelection(database.id, checked)}
                    className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                    aria-label={database.name}
                  />
                }
                detail={
                  database.isExportable
                    ? database.connectionCount !== undefined
                      ? t('exportTab.currentDatabaseCount', { count: database.connectionCount })
                      : t('exportTab.databaseExportable')
                    : database.lockedReason || t('exportTab.databaseLockedReason')
                }
              />
            ))}
          </div>
        )}

        {effectiveDatabaseCount > 0 && (
          <div className="text-xs text-[var(--color-textMuted)]" data-testid="export-scope-summary">
            {selectedExportableOptions.map((database) => database.name).join(', ')}
          </div>
        )}
      </section>

      <div data-testid="export-format">
        <label htmlFor="export-format-select" className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          {t('exportTab.exportFormat')}
        </label>
        <Select
          id="export-format-select"
          data-testid="export-format-select"
          label={t('exportTab.exportFormat')}
          value={config.format}
          onChange={(format) => onConfigChange({ format: format as ExportConfig['format'] })}
          options={
            formatGroups.flatMap((group) => {
              const optionsInGroup = formatOptions.filter((option) => option.group === group.id);
              if (optionsInGroup.length === 0) return [];
              return [
                {
                  value: `__group_${group.id}`,
                  label: `── ${group.label} ──`,
                  disabled: true,
                  title: group.description,
                },
                ...optionsInGroup.map((option) => ({
                  value: option.value as string,
                  label: option.label,
                  icon: option.icon,
                  title: `${option.desc} • ${encryptionSchemeLabel(option.encryption)}`,
                })),
              ];
            }) as unknown as Parameters<typeof Select>[0]['options']
          }
          variant="form"
          className="w-full sm:max-w-md"
        />

        <div id="export-format-details" data-testid="export-format-details" className="mt-3 flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)] p-3">
          <SelectedFormatIcon size={20} className="mt-0.5 shrink-0 text-[var(--color-textSecondary)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-[var(--color-text)]">{selectedFormat.label}</div>
              <span className="rounded-sm bg-[var(--color-surface)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-textSecondary)]">
                {formatGroups.find((g) => g.id === selectedFormat.group)?.label}
              </span>
            </div>
            <div className="mt-1 text-xs text-[var(--color-textSecondary)]">{selectedFormat.desc}</div>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-[var(--color-surface)] px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--color-textSecondary)]">
              <Lock size={10} />
              {encryptionSchemeLabel(selectedFormat.encryption)}
            </div>
          </div>
        </div>

        {compatibilityWarnings.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning" data-testid="export-format-warnings">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <ul className="space-y-1">
              {compatibilityWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <AccordionSection
          id="export-inclusion"
          title={t('exportTab.inclusionTitle', { defaultValue: 'Content to include' })}
          description={t('exportTab.inclusionDescription', { defaultValue: 'Choose exactly which export parts are written. JSON keeps full fidelity; inventory formats use the filtered connection list.' })}
          icon={SlidersHorizontal}
          open={sectionsOpen.inclusion}
          onToggle={() => toggleSection('inclusion')}
          dataTestId="export-inclusion-section"
        >
          <div className="grid grid-cols-1 gap-3">
            {inclusionOptions.map((option) => (
              <label
                key={option.id}
                className={`flex items-start gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 ${option.disabled ? 'opacity-60' : 'cursor-pointer'}`}
                data-testid={`export-inclusion-${option.id}`}
              >
                <Checkbox
                  checked={Boolean(inclusion[option.id])}
                  disabled={option.disabled}
                  onChange={(value: boolean) => {
                    if (option.id === 'includeCredentials') {
                      updateCredentialInclusion(value);
                      return;
                    }
                    updateInclusion({ [option.id]: value } as Partial<ExportInclusionConfig>);
                    if (option.id === 'includeTabGroups') onConfigChange({ includeTabGroups: value });
                    if (option.id === 'includeColorTags') onConfigChange({ includeColorTags: value });
                    if (option.id === 'includeVpnData') onConfigChange({ includeVpnData: value });
                    if (option.id === 'includeTunnelChains') onConfigChange({ includeTunnelChains: value });
                  }}
                  className="mt-0.5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                  aria-label={option.label}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--color-text)]">{option.label}</span>
                  <span className="mt-1 block text-xs text-[var(--color-textMuted)]">{option.description}</span>
                </span>
              </label>
            ))}
          </div>

          <InclusionProtocolFilter
            inclusion={inclusion}
            updateInclusion={updateInclusion}
            availableProtocols={availableProtocols}
            disabled={!inclusion.includeConnections}
            dataTestId="export-protocol-filter"
          />
        </AccordionSection>

        <InclusionItemPickers
          inclusion={inclusion}
          updateInclusion={updateInclusion}
          sectionsOpen={sectionsOpen}
          onToggleSection={(section) => toggleSection(section)}
          connections={selectableConnections}
          folders={selectableFolders}
          textTags={availableTextTags}
          colorTagIds={availableColorTagIds}
          proxyProfiles={proxyProfileOptions}
          proxyChains={proxyChainOptions}
          vpnConnections={vpnConnectionOptions}
          testIdPrefix="export"
        />

        <AccordionSection
          id="export-encryption"
          title={t('exportTab.encryptionTitle', { defaultValue: 'Encryption' })}
          description={t('exportTab.encryptionDescription', { defaultValue: 'Optionally protect the export file with a password. AES-GCM with PBKDF2 key derivation; tune iterations for the speed/strength trade-off you want.' })}
          icon={Lock}
          open={sectionsOpen.encryption || config.encrypted}
          onToggle={() => toggleSection('encryption')}
          dataTestId="export-encryption-section"
          badge={
            config.encrypted ? (
              <span className="rounded-sm bg-warning/15 px-2 py-0.5 text-warning">
                {t('exportTab.previewEncrypted', { defaultValue: 'Encrypted' })}
              </span>
            ) : (
              <span className="text-[var(--color-textMuted)]">
                {t('exportTab.previewNotEncrypted', { defaultValue: 'Plaintext' })}
              </span>
            )
          }
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={config.encrypted}
                onChange={(val: boolean) => onConfigChange({ encrypted: val })}
                data-testid="export-encrypt"
                className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
              />
              <span className="text-sm text-[var(--color-text)]">
                {t('exportTab.encryptExport')}
              </span>
              <span className="rounded-sm bg-success/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-success">
                {t('exportTab.recommended', { defaultValue: 'Recommended' })}
              </span>
            </label>
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">
              <Lock size={10} />
              {encryptionSchemeLabel(selectedFormat.encryption)}
            </span>
          </div>
          <p className="text-xs text-[var(--color-textMuted)]">
            {t('exportTab.encryptionAlwaysOptional', { defaultValue: 'Always optional, always recommended. The scheme used adapts to the chosen export format.' })}
          </p>

          {config.encrypted && (
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
                  {t('exportTab.encryptionPassword')}
                </label>
                <PasswordInput
                  value={config.password}
                  onChange={e => onConfigChange({ password: e.target.value })}
                  className="sor-form-input w-full"
                  placeholder={t('exportTab.enterPassword')}
                  autoComplete="new-password"
                  data-testid="export-password"
                  aria-describedby="export-password-strength"
                />
              </div>

              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-textSecondary)]">
                  <KeyRound size={14} />
                  <span>{t('exportTab.keyDerivationIterations', { defaultValue: 'PBKDF2 iterations' })}</span>
                </label>
                <div className="flex items-center gap-2">
                  <NumberInput
                    value={config.keyDerivationIterations}
                    onChange={(value: number) => onConfigChange({ keyDerivationIterations: value })}
                    min={10000}
                    max={5000000}
                    step={10000}
                    variant="form"
                    className="flex-1"
                    data-testid="export-kdf-iterations"
                    aria-label={t('exportTab.keyDerivationIterations', { defaultValue: 'PBKDF2 iterations' })}
                  />
                  <button
                    type="button"
                    onClick={runPbkdf2Benchmark}
                    disabled={isBenchmarking}
                    data-testid="export-kdf-benchmark"
                    className="sor-btn-secondary-sm flex-shrink-0"
                    title={t('exportTab.benchmarkHint', { defaultValue: 'Run a 10-second benchmark to find the highest iteration count that completes in roughly 10 seconds on this machine.' }) as string}
                  >
                    <Gauge size={14} />
                    <span>
                      {isBenchmarking
                        ? t('exportTab.benchmarking', { defaultValue: 'Benchmarking…' })
                        : t('exportTab.benchmark10s', { defaultValue: 'Benchmark (10s)' })}
                    </span>
                  </button>
                </div>
                <p className="text-xs text-[var(--color-textMuted)]">
                  {t('exportTab.iterationsHelp', { defaultValue: 'Higher values make password guessing slower, but export and import take longer. The benchmark picks the count that runs for ~10 seconds on this machine.' })}
                </p>
                {benchmarkError && (
                  <p className="text-xs text-danger" data-testid="export-kdf-benchmark-error">
                    {benchmarkError}
                  </p>
                )}
              </div>

              {config.strengthSettings.showPasswordStrength && (
                <div id="export-password-strength" data-testid="export-password-strength" className="space-y-3 rounded-md bg-[var(--color-surface)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                      <ShieldCheck size={16} />
                      <span>{strength.label}</span>
                    </div>
                    {config.strengthSettings.showEntropyBits && (
                      <span className="text-xs text-[var(--color-textMuted)]" data-testid="export-password-entropy">
                        {strength.entropy} bits
                      </span>
                    )}
                  </div>
                  <div className="h-2 rounded-full bg-[var(--color-border)] overflow-hidden" aria-hidden="true">
                    <div className={`h-full ${scoreColor}`} style={{ width: `${scorePercent}%` }} />
                  </div>
                  {passwordTooWeak && (
                    <div className="flex items-start gap-2 text-xs text-danger" data-testid="export-password-too-weak">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>{t('exportTab.passwordTooWeak', { defaultValue: 'This password is below the configured minimum strength.' })}</span>
                    </div>
                  )}
                  {strength.warnings.length > 0 && (
                    <ul className="space-y-1 text-xs text-warning" data-testid="export-password-warnings">
                      {strength.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  {strength.positiveSignals.length > 0 && (
                    <ul className="space-y-1 text-xs text-success" data-testid="export-password-positive-signals">
                      {strength.positiveSignals.map((signal) => (
                        <li key={signal}>{signal}</li>
                      ))}
                    </ul>
                  )}
                  {strength.suggestions.length > 0 && (
                    <ul className="space-y-1 text-xs text-[var(--color-textMuted)]" data-testid="export-password-suggestions">
                      {strength.suggestions.map((suggestion) => (
                        <li key={suggestion}>{suggestion}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </AccordionSection>
      </div>

      {previewSection}

      <button
        onClick={handleExport}
        disabled={disableExport}
        data-testid="export-confirm"
        className="w-full py-3 bg-primary hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)] disabled:cursor-not-allowed text-[var(--color-text)] rounded-lg transition-colors flex items-center justify-center space-x-2"
      >
        {isProcessing ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[var(--color-border)]"></div>
            <span>{t('exportTab.exporting')}</span>
          </>
        ) : (
          <>
            <Download size={16} />
            <span>{t('exportTab.exportButton')}</span>
          </>
        )}
      </button>
    </div>
  );
};

export default ExportTab;
