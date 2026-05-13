import React, { useState } from 'react';
import { Download, FileText, Database, Settings, Lock, ShieldCheck, AlertTriangle, KeyRound, FolderTree, Tags, SlidersHorizontal, ChevronDown, ChevronRight, Server, Tag as TagIcon, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PasswordInput, Checkbox, NumberInput, Select } from '../ui/forms';
import { Connection } from '../../types/connection/connection';
import type { ExportConfig, ExportConfigUpdate, ExportInclusionConfig } from './types';
import { analyzePasswordStrength } from '../../hooks/security/usePasswordStrength';

export type { ExportConfig } from './types';

interface ExportTabProps {
  connections: Connection[];
  config: ExportConfig;
  onConfigChange: (update: ExportConfigUpdate) => void;
  isProcessing: boolean;
  handleExport: () => void;
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
  const byId = new Map(connections.map((connection) => [connection.id, connection]));
  const leaves = connections.filter(
    (connection) =>
      !connection.isGroup &&
      (!includedProtocolSet || includedProtocolSet.has(connection.protocol)) &&
      (!includedConnectionSet || includedConnectionSet.has(connection.id)) &&
      (!includedTextTagSet ||
        (connection.tags ?? []).some((tag) => includedTextTagSet.has(tag))) &&
      (!includedColorTagSet ||
        (connection.colorTag != null && includedColorTagSet.has(connection.colorTag))),
  );
  const leafIds = new Set(leaves.map((connection) => connection.id));
  const folderIds = new Set<string>();

  if (inclusion.includeFolderItems) {
    if (inclusion.includeEmptyFolders) {
      connections
        .filter((connection) => connection.isGroup)
        .forEach((connection) => folderIds.add(connection.id));
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

interface AccordionSectionProps {
  id: string;
  title: string;
  description?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  dataTestId?: string;
}

const AccordionSection: React.FC<AccordionSectionProps> = ({
  id,
  title,
  description,
  icon: Icon,
  badge,
  open,
  onToggle,
  children,
  dataTestId,
}) => (
  <section
    aria-labelledby={`${id}-heading`}
    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)]"
    data-testid={dataTestId}
  >
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={`${id}-panel`}
      className="flex w-full items-center gap-3 px-4 py-3 text-left"
    >
      <span className="text-[var(--color-textSecondary)] shrink-0">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </span>
      <Icon size={16} className="text-primary shrink-0" />
      <span className="flex-1 min-w-0">
        <span
          id={`${id}-heading`}
          className="block text-sm font-medium text-[var(--color-text)]"
        >
          {title}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs text-[var(--color-textSecondary)]">
            {description}
          </span>
        )}
      </span>
      {badge && <span className="shrink-0 text-xs">{badge}</span>}
    </button>
    {open && (
      <div
        id={`${id}-panel`}
        className="border-t border-[var(--color-border)] px-4 py-3 space-y-3"
      >
        {children}
      </div>
    )}
  </section>
);

const ExportTab: React.FC<ExportTabProps> = ({
  connections,
  config,
  onConfigChange,
  isProcessing,
  handleExport,
}) => {
  const { t } = useTranslation();
  const [sectionsOpen, setSectionsOpen] = useState({
    inclusion: true,
    connections: false,
    textTags: false,
    colorTags: false,
  });
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

  const selectableConnections = React.useMemo(
    () => connections.filter((c) => !c.isGroup),
    [connections],
  );

  const selectedConnectionIdSet = new Set(inclusion.includedConnectionIds ?? []);
  const selectedTextTagSet = new Set(inclusion.includedTextTags ?? []);
  const selectedColorTagIdSet = new Set(inclusion.includedColorTagIds ?? []);

  const toggleConnectionId = (id: string, checked: boolean) => {
    const next = new Set(selectedConnectionIdSet);
    if (checked) next.add(id);
    else next.delete(id);
    onConfigChange({
      inclusion: {
        includedConnectionIds:
          next.size === selectableConnections.length ? [] : Array.from(next),
      },
    });
  };

  const toggleTextTag = (tag: string, checked: boolean) => {
    const next = new Set(selectedTextTagSet);
    if (checked) next.add(tag);
    else next.delete(tag);
    onConfigChange({
      inclusion: {
        includedTextTags:
          next.size === availableTextTags.length ? [] : Array.from(next),
      },
    });
  };

  const toggleColorTagId = (id: string, checked: boolean) => {
    const next = new Set(selectedColorTagIdSet);
    if (checked) next.add(id);
    else next.delete(id);
    onConfigChange({
      inclusion: {
        includedColorTagIds:
          next.size === availableColorTagIds.length ? [] : Array.from(next),
      },
    });
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
  const formatOptions = [
    { value: 'json' as const, label: 'JSON', icon: FileText, desc: t('exportTab.formatJson') },
    { value: 'xml' as const, label: 'XML', icon: Database, desc: t('exportTab.formatXml') },
    { value: 'csv' as const, label: 'CSV', icon: Settings, desc: t('exportTab.formatCsv') },
    { value: 'txt' as const, label: 'TXT', icon: FileText, desc: t('exportTab.formatTxt') },
    { value: 'markdown' as const, label: 'Markdown', icon: FileText, desc: t('exportTab.formatMarkdown') },
    { value: 'html' as const, label: 'HTML', icon: FileText, desc: t('exportTab.formatHtml') },
    { value: 'excel' as const, label: 'Excel', icon: Settings, desc: t('exportTab.formatExcel') },
    { value: 'mremoteng' as const, label: 'XML - mRemoteNG compatible', icon: Database, desc: t('exportTab.formatMRemoteNG') },
  ];
  const selectedFormat = formatOptions.find((format) => format.value === config.format) ?? formatOptions[0];
  const SelectedFormatIcon = selectedFormat.icon;
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

  const toggleProtocol = (protocol: Connection['protocol'], checked: boolean) => {
    const current = inclusion.includedProtocols.length > 0
      ? new Set(inclusion.includedProtocols)
      : new Set(availableProtocols);

    if (checked) {
      current.add(protocol);
    } else {
      current.delete(protocol);
    }

    updateInclusion({
      includedProtocols:
        current.size === availableProtocols.length ? [] : Array.from(current).sort(),
    });
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
              <label
                key={database.id}
                data-testid={`export-database-option-${database.id}`}
                className={`flex items-start gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 ${
                  database.isExportable ? 'cursor-pointer' : 'opacity-70'
                }`}
              >
                <Checkbox
                  checked={database.isExportable && selectedDatabaseIdSet.has(database.id)}
                  disabled={!database.isExportable}
                  onChange={(checked: boolean) => toggleDatabaseSelection(database.id, checked)}
                  className="mt-0.5 rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                  aria-label={database.name}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                    <span>{database.name}</span>
                    {database.isCurrent && (
                      <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-normal text-primary">
                        {t('exportTab.currentBadge')}
                      </span>
                    )}
                    {database.isEncrypted && (
                      <span className="inline-flex items-center gap-1 text-xs text-warning">
                        <Lock size={13} />
                        {database.isExportable ? t('exportTab.unlockedBadge') : t('exportTab.lockedBadge')}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-textSecondary)]">
                    {database.isExportable
                      ? database.connectionCount !== undefined
                        ? t('exportTab.currentDatabaseCount', { count: database.connectionCount })
                        : t('exportTab.databaseExportable')
                      : database.lockedReason || t('exportTab.databaseLockedReason')}
                  </div>
                </div>
              </label>
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
          options={formatOptions.map((format) => ({
            value: format.value,
            label: format.label,
            icon: format.icon,
            title: format.desc,
          }))}
          variant="form"
          className="w-full sm:max-w-md"
        />

        <div id="export-format-details" data-testid="export-format-details" className="mt-3 flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)] p-3">
          <SelectedFormatIcon size={20} className="mt-0.5 shrink-0 text-[var(--color-textSecondary)]" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--color-text)]">{selectedFormat.label}</div>
            <div className="mt-1 text-xs text-[var(--color-textSecondary)]">{selectedFormat.desc}</div>
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

          <div className="space-y-2" data-testid="export-protocol-filter">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-medium text-[var(--color-text)]">
                {t('exportTab.protocolFilterTitle', { defaultValue: 'Protocols' })}
              </div>
              <button
                type="button"
                className="self-start text-xs text-primary hover:text-primary/80 disabled:text-[var(--color-textMuted)]"
                disabled={!inclusion.includeConnections || inclusion.includedProtocols.length === 0}
                onClick={() => updateInclusion({ includedProtocols: [] })}
              >
                {t('exportTab.protocolFilterAll', { defaultValue: 'Include all protocols' })}
              </button>
            </div>
            {availableProtocols.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {availableProtocols.map((protocol) => {
                  const checked =
                    inclusion.includedProtocols.length === 0 ||
                    inclusion.includedProtocols.includes(protocol);
                  return (
                    <label
                      key={protocol}
                      className={`inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs ${inclusion.includeConnections ? 'cursor-pointer' : 'opacity-60'}`}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!inclusion.includeConnections}
                        onChange={(value: boolean) => toggleProtocol(protocol, value)}
                        className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                        aria-label={protocol.toUpperCase()}
                      />
                      <span className="font-medium text-[var(--color-textSecondary)]">{protocol.toUpperCase()}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-[var(--color-textMuted)]">
                {t('exportTab.protocolFilterEmpty', { defaultValue: 'No protocols are visible in the open database yet.' })}
              </p>
            )}
          </div>
        </AccordionSection>

        <AccordionSection
          id="export-connections"
          title={t('exportTab.connectionsTitle', { defaultValue: 'Specific connections' })}
          description={t('exportTab.connectionsDescription', { defaultValue: 'Restrict the export to specific connections. Leave the list empty to include every connection that matches the other filters.' })}
          icon={Server}
          open={sectionsOpen.connections}
          onToggle={() => toggleSection('connections')}
          dataTestId="export-connections-section"
          badge={
            selectedConnectionIdSet.size > 0 ? (
              <span className="rounded-sm bg-primary/15 px-2 py-0.5 text-primary">
                {selectedConnectionIdSet.size}
              </span>
            ) : (
              <span className="text-[var(--color-textMuted)]">all</span>
            )
          }
        >
          <div className="flex items-center justify-end">
            <button
              type="button"
              className="text-xs text-primary hover:text-primary/80 disabled:text-[var(--color-textMuted)]"
              disabled={selectedConnectionIdSet.size === 0}
              onClick={() => updateInclusion({ includedConnectionIds: [] })}
            >
              {t('exportTab.connectionsClear', { defaultValue: 'Include all connections' })}
            </button>
          </div>
          {selectableConnections.length === 0 ? (
            <p className="text-xs text-[var(--color-textMuted)]">
              {t('exportTab.connectionsEmpty', { defaultValue: 'No connections in the open database yet.' })}
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
              {selectableConnections.map((connection) => {
                const checked =
                  selectedConnectionIdSet.size === 0 ||
                  selectedConnectionIdSet.has(connection.id);
                return (
                  <label
                    key={connection.id}
                    className="flex items-center gap-3 border-b border-[var(--color-border)] last:border-b-0 px-3 py-2 cursor-pointer hover:bg-[var(--color-surfaceHover)]"
                  >
                    <Checkbox
                      checked={checked}
                      onChange={(value: boolean) => toggleConnectionId(connection.id, value)}
                      className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                      aria-label={connection.name}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[var(--color-text)]">
                        {connection.name}
                      </span>
                      <span className="block truncate text-[10px] text-[var(--color-textMuted)]">
                        {connection.protocol.toUpperCase()}
                        {connection.hostname ? ` — ${connection.hostname}` : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </AccordionSection>

        <AccordionSection
          id="export-text-tags"
          title={t('exportTab.textTagsTitle', { defaultValue: 'Specific text tags' })}
          description={t('exportTab.textTagsDescription', { defaultValue: 'Restrict the export to connections carrying any of these text tags. Leave empty to include connections with or without tags.' })}
          icon={TagIcon}
          open={sectionsOpen.textTags}
          onToggle={() => toggleSection('textTags')}
          dataTestId="export-text-tags-section"
          badge={
            selectedTextTagSet.size > 0 ? (
              <span className="rounded-sm bg-primary/15 px-2 py-0.5 text-primary">
                {selectedTextTagSet.size}
              </span>
            ) : (
              <span className="text-[var(--color-textMuted)]">all</span>
            )
          }
        >
          <div className="flex items-center justify-end">
            <button
              type="button"
              className="text-xs text-primary hover:text-primary/80 disabled:text-[var(--color-textMuted)]"
              disabled={selectedTextTagSet.size === 0}
              onClick={() => updateInclusion({ includedTextTags: [] })}
            >
              {t('exportTab.textTagsClear', { defaultValue: 'Include all tags' })}
            </button>
          </div>
          {availableTextTags.length === 0 ? (
            <p className="text-xs text-[var(--color-textMuted)]">
              {t('exportTab.textTagsEmpty', { defaultValue: 'No text tags are used in the open database yet.' })}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableTextTags.map((tag) => {
                const checked =
                  selectedTextTagSet.size === 0 || selectedTextTagSet.has(tag);
                return (
                  <label
                    key={tag}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      onChange={(value: boolean) => toggleTextTag(tag, value)}
                      className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                      aria-label={tag}
                    />
                    <span className="font-medium text-[var(--color-textSecondary)]">{tag}</span>
                  </label>
                );
              })}
            </div>
          )}
        </AccordionSection>

        <AccordionSection
          id="export-color-tags"
          title={t('exportTab.colorTagsTitle', { defaultValue: 'Specific color tags' })}
          description={t('exportTab.colorTagsDescription', { defaultValue: 'Restrict the export to connections tagged with a chosen color. Leave empty to ignore color when filtering.' })}
          icon={Palette}
          open={sectionsOpen.colorTags}
          onToggle={() => toggleSection('colorTags')}
          dataTestId="export-color-tags-section"
          badge={
            selectedColorTagIdSet.size > 0 ? (
              <span className="rounded-sm bg-primary/15 px-2 py-0.5 text-primary">
                {selectedColorTagIdSet.size}
              </span>
            ) : (
              <span className="text-[var(--color-textMuted)]">all</span>
            )
          }
        >
          <div className="flex items-center justify-end">
            <button
              type="button"
              className="text-xs text-primary hover:text-primary/80 disabled:text-[var(--color-textMuted)]"
              disabled={selectedColorTagIdSet.size === 0}
              onClick={() => updateInclusion({ includedColorTagIds: [] })}
            >
              {t('exportTab.colorTagsClear', { defaultValue: 'Include all colors' })}
            </button>
          </div>
          {availableColorTagIds.length === 0 ? (
            <p className="text-xs text-[var(--color-textMuted)]">
              {t('exportTab.colorTagsEmpty', { defaultValue: 'No color tags are used in the open database yet.' })}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableColorTagIds.map((colorTagId) => {
                const checked =
                  selectedColorTagIdSet.size === 0 ||
                  selectedColorTagIdSet.has(colorTagId);
                return (
                  <label
                    key={colorTagId}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      onChange={(value: boolean) => toggleColorTagId(colorTagId, value)}
                      className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                      aria-label={colorTagId}
                    />
                    <span className="font-mono text-[var(--color-textSecondary)]">{colorTagId}</span>
                  </label>
                );
              })}
            </div>
          )}
        </AccordionSection>

        <label className="flex items-center space-x-2">
          <Checkbox checked={config.encrypted} onChange={(val: boolean) => onConfigChange({ encrypted: val })} data-testid="export-encrypt" className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary" />
          <span className="text-[var(--color-textSecondary)]">{t('exportTab.encryptExport')}</span>
          <Lock size={16} className="text-warning" />
        </label>

        {config.encrypted && (
          <div className="space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)] p-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                {t('exportTab.encryptionPassword')}
              </label>
              <PasswordInput
                value={config.password}
                onChange={e => onConfigChange({ password: e.target.value })}
                className="sor-form-input"
                placeholder={t('exportTab.enterPassword')}
                autoComplete="new-password"
                data-testid="export-password"
                aria-describedby="export-password-strength"
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                <KeyRound size={16} />
                <span>{t('exportTab.keyDerivationIterations', { defaultValue: 'PBKDF2 iterations' })}</span>
              </label>
              <NumberInput
                value={config.keyDerivationIterations}
                onChange={(value: number) => onConfigChange({ keyDerivationIterations: value })}
                min={10000}
                max={5000000}
                step={10000}
                variant="form"
                className="w-full"
                data-testid="export-kdf-iterations"
                aria-label={t('exportTab.keyDerivationIterations', { defaultValue: 'PBKDF2 iterations' })}
              />
              <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                {t('exportTab.iterationsHelp', { defaultValue: 'Higher values make password guessing slower, but export and import take longer.' })}
              </p>
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
