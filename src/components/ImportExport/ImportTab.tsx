import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FileCode,
  FileText,
  Filter,
  FolderOpen,
  Database,
  Search,
  Shield,
  Upload,
  X,
} from 'lucide-react';
import {
  ExportDatabaseOption,
  ImportFilterState,
  ImportOptions,
  ImportPreviewItem,
  ImportResult,
  ImportSourceMetadata,
  ImportTargetMode,
} from './types';
import {
  IMPORT_FORMAT_COMPATIBILITY,
  IMPORT_FORMAT_ORDER,
  type ImportFormat,
} from './utils';
import { useToastContext } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { Select, type SelectOption } from '../ui/forms';
import { DatabasePickerRow } from './DatabasePickerRow';

interface ImportTabProps {
  isProcessing: boolean;
  handleImport: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  importResult: ImportResult | null;
  handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleFileDrop?: (file: File) => void | Promise<void>;
  confirmImport: () => void | Promise<void>;
  cancelImport: () => void;
  detectedFormat?: string;
  importDatabaseOptions?: ExportDatabaseOption[];
  importTargetMode?: ImportTargetMode;
  setImportTargetMode?: (mode: ImportTargetMode) => void | Promise<void>;
  selectedImportDatabaseId?: string;
  setSelectedImportDatabaseId?: (databaseId: string) => void | Promise<void>;
  importFormatSelection?: 'auto' | ImportFormat;
  setImportFormatSelection?: (selection: 'auto' | ImportFormat) => void | Promise<void>;
  importAnalysis?: ImportSourceMetadata | null;
  importFilters?: ImportFilterState;
  updateImportFilters?: (updates: Partial<ImportFilterState>) => void;
  resetImportFilters?: () => void;
  importOptions?: ImportOptions;
  updateImportOptions?: (updates: Partial<ImportOptions>) => void;
  previewItems?: ImportPreviewItem[];
  visiblePreviewItems?: ImportPreviewItem[];
  availableProtocols?: string[];
  selectedPreviewIds?: Set<string>;
  selectedCount?: number;
  togglePreviewSelection?: (itemId: string) => void;
  selectAllVisiblePreviewItems?: () => void;
  deselectAllVisiblePreviewItems?: () => void;
  selectAllImportablePreviewItems?: () => void;
  onUnlockDatabase?: (databaseId: string) => Promise<boolean> | void;
}

const FALLBACK_FILTERS: ImportFilterState = {
  search: '',
  protocol: 'all',
  issueSeverity: 'all',
  itemKind: 'all',
  selection: 'all',
  conflict: 'all',
  missingHostnameOnly: false,
  withCredentialsOnly: false,
};

const FALLBACK_OPTIONS: ImportOptions = {
  preserveFolders: true,
  includeCredentials: true,
  includeVpnData: true,
  includeTunnelChains: true,
  includeSshTunnels: true,
  conflictPolicy: 'duplicate',
  addTags: '',
  switchToTargetDatabaseAfterImport: false,
};

const CSV_TEMPLATE = `Name,Protocol,Hostname,Port,Username,Domain,Description,ParentId,IsGroup,Tags
"Web Server 1",SSH,192.168.1.10,22,admin,,Web server in datacenter,,false,"production;linux"
"Database Server",RDP,192.168.1.20,3389,administrator,DOMAIN,SQL Server,,false,"production;database"
"Dev Folder",SSH,,,,,Development servers,,true,""
"Dev Server 1",SSH,10.0.0.5,22,devuser,,Dev environment,Dev Folder,false,"development;test"
"Router Admin",HTTP,192.168.1.1,80,admin,,Network router,,false,"network;router"
"VNC Desktop",VNC,192.168.1.30,5900,,,Remote desktop access,,false,"desktop;vnc"`;

const JSON_TEMPLATE = {
  version: '1.0',
  exportDate: new Date().toISOString(),
  connections: [
    {
      name: 'Web Server 1',
      protocol: 'SSH',
      hostname: '192.168.1.10',
      port: 22,
      username: 'admin',
      domain: '',
      description: 'Web server in datacenter',
      parentId: null,
      isGroup: false,
      tags: ['production', 'linux'],
    },
    {
      name: 'Database Server',
      protocol: 'RDP',
      hostname: '192.168.1.20',
      port: 3389,
      username: 'administrator',
      domain: 'DOMAIN',
      description: 'SQL Server',
      parentId: null,
      isGroup: false,
      tags: ['production', 'database'],
    },
  ],
};

const XML_TEMPLATE = `<?xml version="1.0" encoding="utf-8"?>
<sortOfRemoteNG version="1.0">
  <connections>
    <connection name="Web Server 1" protocol="SSH" hostname="192.168.1.10" port="22" username="admin" description="Web server in datacenter" tags="production;linux" />
    <connection name="Database Server" protocol="RDP" hostname="192.168.1.20" port="3389" username="administrator" domain="DOMAIN" description="SQL Server" tags="production;database" />
    <group name="Dev Folder">
      <connection name="Dev Server 1" protocol="SSH" hostname="10.0.0.5" port="22" username="devuser" description="Dev environment" tags="development;test" />
    </group>
  </connections>
</sortOfRemoteNG>`;

const INI_TEMPLATE = `; sortOfRemoteNG import template (INI)
; One section per connection. Tags are semicolon-separated.

[Web Server 1]
Protocol=SSH
Hostname=192.168.1.10
Port=22
Username=admin
Description=Web server in datacenter
Tags=production;linux

[Database Server]
Protocol=RDP
Hostname=192.168.1.20
Port=3389
Username=administrator
Domain=DOMAIN
Description=SQL Server
Tags=production;database`;

type TemplateKind = 'csv' | 'json' | 'xml' | 'ini';

interface TemplateSpec {
  kind: TemplateKind;
  label: string;
  filename: string;
  mimeType: string;
  build: () => string;
}

const TEMPLATES: TemplateSpec[] = [
  {
    kind: 'csv',
    label: 'CSV Template',
    filename: 'sortofremoteng-import-template.csv',
    mimeType: 'text/csv',
    build: () => CSV_TEMPLATE,
  },
  {
    kind: 'json',
    label: 'JSON Template',
    filename: 'sortofremoteng-import-template.json',
    mimeType: 'application/json',
    build: () => JSON.stringify(JSON_TEMPLATE, null, 2),
  },
  {
    kind: 'xml',
    label: 'XML Template',
    filename: 'sortofremoteng-import-template.xml',
    mimeType: 'application/xml',
    build: () => XML_TEMPLATE,
  },
  {
    kind: 'ini',
    label: 'INI Template',
    filename: 'sortofremoteng-import-template.ini',
    mimeType: 'text/plain',
    build: () => INI_TEMPLATE,
  },
];

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function severityClass(severity: string): string {
  if (severity === 'error') return 'text-error bg-error/10 border-error/30';
  if (severity === 'warning') return 'text-warning bg-warning/10 border-warning/30';
  return 'text-info bg-info/10 border-info/30';
}

const SENSITIVE_DETAIL_KEYS = [
  'password',
  'passphrase',
  'privatekey',
  'secret',
  'token',
  'apikey',
  'clientsecret',
  'serviceaccountkey',
];

function redactDetailValue(value: unknown, keyName = ''): unknown {
  const normalizedKey = keyName.toLowerCase();
  if (
    value !== null &&
    value !== undefined &&
    SENSITIVE_DETAIL_KEYS.some((key) => normalizedKey.includes(key))
  ) {
    return '[hidden]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactDetailValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        redactDetailValue(entryValue, key),
      ]),
    );
  }

  return value;
}

function buildPreviewDetailJson(item: ImportPreviewItem): string {
  return JSON.stringify(
    redactDetailValue({
      preview: {
        id: item.id,
        kind: item.kind,
        sourceIndex: item.sourceIndex,
        sourcePath: item.sourcePath,
        parentName: item.parentName,
        importable: item.importable,
        selectedByDefault: item.selectedByDefault,
        conflictStatus: item.conflictStatus,
        duplicateOf: item.duplicateOf,
        issues: item.issues,
      },
      connection: item.connection ?? null,
      vpnType: item.vpnType ?? null,
      vpnConnection: item.vpnConnection ?? null,
      tunnelChainTemplate: item.tunnelChainTemplate ?? null,
      sshTunnelLayers: item.sshTunnelLayers ?? null,
    }),
    null,
    2,
  );
}

/* ── Source header (replaces the old AnalysisSummary banner) ──────── */

const Stat: React.FC<{ label: string; value: React.ReactNode; accent?: string }> = ({
  label,
  value,
  accent,
}) => (
  <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2">
    <div className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">{label}</div>
    <div className={`text-sm font-semibold ${accent ?? 'text-[var(--color-text)]'}`}>{value}</div>
  </div>
);

const SourceHeader: React.FC<{
  analysis?: ImportSourceMetadata | null;
  detectedFormat?: string;
  importedCount?: number;
  onChangeFile: () => void;
}> = ({ analysis, detectedFormat, importedCount, onChangeFile }) => {
  const [showDetails, setShowDetails] = useState(true);
  const formatLabel = analysis?.formatName ?? detectedFormat;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <FileText size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-[var(--color-text)] truncate">
                {analysis?.filename ?? 'Imported file'}
              </span>
              {formatLabel && (
                <span className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  {formatLabel}
                </span>
              )}
              {analysis?.encrypted && (
                <span className="inline-flex items-center gap-1 rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs text-warning">
                  <Shield size={11} />
                  Encrypted
                </span>
              )}
              {analysis?.encryption?.defaultMasterPasswordAccepted && (
                <span
                  className="inline-flex items-center gap-1 rounded border border-error/30 bg-error/10 px-2 py-0.5 text-xs text-error"
                  title="The file is encrypted with mRemoteNG's default master password (mR3m). That password is public, so the encryption provides no protection. Re-export with a custom master password."
                >
                  <Shield size={11} />
                  Default master password
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-[var(--color-textMuted)]">
              <CheckCircle size={11} className="text-success" />
              <span className="text-success font-medium">Import Successful</span>
              {importedCount !== undefined && (
                <>
                  <span aria-hidden>·</span>
                  <span>Found {importedCount} connections ready to import.</span>
                </>
              )}
              {analysis?.sizeBytes !== undefined && (
                <>
                  <span aria-hidden>·</span>
                  <span>{formatBytes(analysis.sizeBytes)}</span>
                </>
              )}
              {analysis?.confidence && (
                <>
                  <span aria-hidden>·</span>
                  <span>Confidence {analysis.confidence}</span>
                </>
              )}
            </div>
            {analysis?.formatWarning && (
              <div className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {analysis.formatWarning}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-start gap-2">
          <button
            type="button"
            onClick={onChangeFile}
            className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-textSecondary)] transition-colors hover:border-primary/50 hover:text-[var(--color-text)]"
          >
            <Upload size={13} />
            Change file
          </button>
        </div>
      </div>

      {analysis && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-background)]/40">
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
            className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium uppercase tracking-wide text-[var(--color-textMuted)] hover:text-[var(--color-text)]"
          >
            <span className="flex items-center gap-2">
              {showDetails ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Analysis details
            </span>
            <span className="text-[10px] normal-case text-[var(--color-textMuted)]">
              {analysis.counts.connections} conn · {analysis.counts.folders} folders ·{' '}
              {analysis.counts.conflicts} conflicts
            </span>
          </button>

          {showDetails && (
            <div className="space-y-3 px-4 pb-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
                <Stat label="Connections" value={analysis.counts.connections} accent="text-primary" />
                <Stat label="Folders" value={analysis.counts.folders} />
                <Stat
                  label="Conflicts"
                  value={analysis.counts.conflicts}
                  accent={analysis.counts.conflicts > 0 ? 'text-warning' : undefined}
                />
                <Stat
                  label="Warnings"
                  value={analysis.counts.warnings}
                  accent={analysis.counts.warnings > 0 ? 'text-warning' : undefined}
                />
                <Stat label="VPN" value={analysis.counts.vpnConnections} />
                <Stat label="Tunnels" value={analysis.counts.tunnelChains} />
                <Stat label="SSH tunnels" value={analysis.counts.sshTunnels} />
              </div>

              {(analysis.encryption || analysis.csv || analysis.json || analysis.xml) && (
                <div className="grid gap-1 text-xs text-[var(--color-textSecondary)] md:grid-cols-2">
                  {analysis.encryption && (
                    <div>
                      Encryption: protected={String(analysis.encryption.protected)}, full-file=
                      {String(analysis.encryption.fullFileEncryption)}, password required=
                      {String(analysis.encryption.requiresPassword)}
                    </div>
                  )}
                  {analysis.csv && (
                    <div>
                      CSV: {analysis.csv.dataRows} data row(s), headers{' '}
                      {analysis.csv.headers.join(', ') || 'none'}
                    </div>
                  )}
                  {analysis.json && (
                    <div>
                      JSON: {analysis.json.shape}, keys{' '}
                      {analysis.json.topLevelKeys.join(', ') || 'none'}
                    </div>
                  )}
                  {analysis.xml && (
                    <div>
                      XML: {analysis.xml.rootElement || 'unknown root'},{' '}
                      {analysis.xml.nodeCount} source node(s)
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Generic section wrapper for pick-source state ──────────────── */

const ImportSection: React.FC<{
  title: string;
  description?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}> = ({ title, description, icon: Icon, children }) => (
  <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)]">
    <div className="flex items-start gap-3 border-b border-[var(--color-border)] px-4 py-3">
      <Icon size={16} className="mt-0.5 shrink-0 text-primary" />
      <div className="min-w-0">
        <h4 className="text-sm font-medium text-[var(--color-text)]">{title}</h4>
        {description && (
          <p className="mt-0.5 text-xs text-[var(--color-textSecondary)]">{description}</p>
        )}
      </div>
    </div>
    <div className="p-4">{children}</div>
  </section>
);

/* ── Target database ───────────────────────────────────────────── */

const TargetDatabaseSection: React.FC<{
  options: ExportDatabaseOption[];
  targetMode: ImportTargetMode;
  onSelectMode: (mode: ImportTargetMode) => void | Promise<void>;
  selectedDatabaseId: string;
  onSelect: (databaseId: string) => void | Promise<void>;
  onUnlockDatabase?: (databaseId: string) => Promise<boolean> | void;
}> = ({ options, targetMode, onSelectMode, selectedDatabaseId, onSelect, onUnlockDatabase }) => {
  const exportableOptions = options.filter((option) => option.isExportable);
  const currentOption = exportableOptions.find((option) => option.isCurrent);
  const selectedOption = options.find((option) => option.id === selectedDatabaseId);
  const selectedNames = targetMode === 'all'
    ? exportableOptions.map((option) => option.name)
    : targetMode === 'current'
      ? [currentOption?.name].filter(Boolean)
      : [selectedOption?.name].filter(Boolean);
  const targetModes: Array<{
    value: ImportTargetMode;
    label: string;
    description: string;
    disabled?: boolean;
  }> = [
    {
      value: 'current',
      label: 'Current database',
      description: currentOption
        ? `Merge into ${currentOption.name}.`
        : 'Use the open database when one is available.',
      disabled: !currentOption,
    },
    {
      value: 'selected',
      label: 'Choose database',
      description: 'Pick one unlocked database below.',
      disabled: exportableOptions.length === 0,
    },
    {
      value: 'all',
      label: 'All unlocked',
      description: `Import into ${exportableOptions.length} unlocked database(s).`,
      disabled: exportableOptions.length === 0,
    },
  ];

  return (
    <section
      aria-labelledby="import-target-heading"
      className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)] p-4"
      data-testid="import-target-section"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4
            id="import-target-heading"
            className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]"
          >
            <Database size={16} className="text-primary" />
            Target database
          </h4>
          <p className="mt-1 text-xs text-[var(--color-textSecondary)]">
            Choose where imported connections will be merged.
          </p>
        </div>
        <div
          className="text-xs text-[var(--color-textMuted)]"
          data-testid="import-target-count"
        >
          {targetMode === 'all'
            ? `${exportableOptions.length} target(s)`
            : selectedNames[0] || 'No target'}
        </div>
      </div>

      {options.length === 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          No open or unlocked database is available for import.
        </div>
      )}

      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        role="group"
        aria-label="Import target"
      >
        {targetModes.map((mode) => {
          const active = targetMode === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              data-testid={`import-target-${mode.value}`}
              onClick={() => {
                if (!mode.disabled) void onSelectMode(mode.value);
              }}
              disabled={mode.disabled}
              className={`rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                active
                  ? 'border-primary bg-primary/15 text-[var(--color-text)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-textSecondary)] hover:border-primary/60 hover:text-[var(--color-text)]'
              }`}
              aria-pressed={active}
            >
              <span className="block text-sm font-medium">{mode.label}</span>
              <span className="mt-1 block text-xs text-[var(--color-textMuted)]">
                {mode.description}
              </span>
            </button>
          );
        })}
      </div>

      {targetMode === 'selected' && (
        <div className="space-y-2" data-testid="import-database-radio-list">
          {options.map((database) => (
            <DatabasePickerRow
              key={database.id}
              option={database}
              dataTestId={`import-database-option-${database.id}`}
              onUnlock={onUnlockDatabase}
              control={
                <input
                  type="radio"
                  name="import-target-database"
                  value={database.id}
                  checked={database.isExportable && database.id === selectedDatabaseId}
                  disabled={!database.isExportable}
                  onChange={() => void onSelect(database.id)}
                  className="sor-form-checkbox rounded-full border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                  aria-label={database.name}
                />
              }
              detail={
                <>
                  <span className="block">
                    {database.isExportable
                      ? database.connectionCount !== undefined
                        ? `${database.connectionCount} existing item(s)`
                        : 'Available for import'
                      : database.lockedReason || 'Unlock this database before importing.'}
                  </span>
                  {database.description && (
                    <span className="mt-0.5 block text-[var(--color-textMuted)]">
                      {database.description}
                    </span>
                  )}
                </>
              }
            />
          ))}
        </div>
      )}

      {selectedNames.length > 0 && (
        <div
          className="text-xs text-[var(--color-textMuted)]"
          data-testid="import-target-summary"
        >
          {selectedNames.join(', ')}
        </div>
      )}
    </section>
  );
};

/* ── Format selection (forced parser) ───────────────────────────── */

const FormatSelectionSection: React.FC<{
  selection: 'auto' | ImportFormat;
  onSelect: (selection: 'auto' | ImportFormat) => void | Promise<void>;
  analysis?: ImportSourceMetadata | null;
}> = ({ selection, onSelect, analysis }) => {
  const [open, setOpen] = useState(false);
  const effectiveFormat = analysis?.format as ImportFormat | undefined;
  const selectedCompatibility =
    selection === 'auto'
      ? effectiveFormat
        ? IMPORT_FORMAT_COMPATIBILITY[effectiveFormat]
        : undefined
      : IMPORT_FORMAT_COMPATIBILITY[selection];

  const formatOptions: SelectOption[] = [
    {
      value: 'auto',
      label: 'Auto Detect',
      title: 'Detect the parser from file content and extension.',
    },
    {
      value: '__group_native',
      label: '── Native sortOfRemoteNG ──',
      disabled: true,
    },
    ...IMPORT_FORMAT_ORDER
      .filter((format) => IMPORT_FORMAT_COMPATIBILITY[format].group === 'native')
      .map((format) => ({
        value: format,
        label: IMPORT_FORMAT_COMPATIBILITY[format].label,
        title: IMPORT_FORMAT_COMPATIBILITY[format].description,
      })),
    {
      value: '__group_vendor',
      label: '── Compatible applications ──',
      disabled: true,
    },
    ...IMPORT_FORMAT_ORDER
      .filter((format) => IMPORT_FORMAT_COMPATIBILITY[format].group === 'vendor')
      .map((format) => ({
        value: format,
        label: IMPORT_FORMAT_COMPATIBILITY[format].label,
        title: IMPORT_FORMAT_COMPATIBILITY[format].description,
      })),
  ];

  const summary =
    selection === 'auto'
      ? analysis?.formatName
        ? `Auto-detect (matched ${analysis.formatName})`
        : 'Auto-detect from file content'
      : `Force ${selectedCompatibility?.label ?? selection}`;

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-start gap-3 min-w-0">
          <FileCode size={16} className="mt-0.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--color-text)]">Format</div>
            <div className="text-xs text-[var(--color-textSecondary)] truncate">{summary}</div>
          </div>
        </div>
        {open ? (
          <ChevronDown size={16} className="text-[var(--color-textMuted)]" />
        ) : (
          <ChevronRight size={16} className="text-[var(--color-textMuted)]" />
        )}
      </button>

      {open && (
        <div className="grid gap-3 border-t border-[var(--color-border)] p-4 md:grid-cols-[minmax(0,240px)_1fr]">
          <div className="space-y-1">
            <label
              htmlFor="import-format-select"
              className="block text-xs text-[var(--color-textSecondary)]"
            >
              Import format
            </label>
            <Select
              id="import-format-select"
              data-testid="import-format-select"
              label="Import format"
              value={selection}
              onChange={(value) => void onSelect(value as 'auto' | ImportFormat)}
              options={formatOptions}
              variant="form"
              className="w-full"
            />
          </div>

          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-xs text-[var(--color-textSecondary)]">
            <div className="flex flex-wrap items-center gap-2 text-[var(--color-text)]">
              <span className="font-medium">
                {selection === 'auto' ? 'Auto Detect' : selectedCompatibility?.label}
              </span>
              {analysis?.formatName && (
                <span className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary">
                  Effective: {analysis.formatName}
                </span>
              )}
              {analysis?.detectedFormatName && analysis.formatForced && (
                <span className="rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-warning">
                  Detected: {analysis.detectedFormatName}
                </span>
              )}
            </div>
            {selectedCompatibility && (
              <div className="mt-2 space-y-1">
                <div>{selectedCompatibility.description}</div>
                <div>Extensions: {selectedCompatibility.extensions.join(', ')}</div>
                <div>Data: {selectedCompatibility.dataClasses.join(', ')}</div>
                <div>Credentials: {selectedCompatibility.credentialSupport}</div>
              </div>
            )}
            {analysis?.formatWarning && (
              <div className="mt-2 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-warning">
                {analysis.formatWarning}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

/* ── Compact preview filter row ─────────────────────────────────── */

const countActiveFilters = (filters: ImportFilterState): number =>
  (filters.protocol !== 'all' ? 1 : 0) +
  (filters.issueSeverity !== 'all' ? 1 : 0) +
  (filters.itemKind !== 'all' ? 1 : 0) +
  (filters.selection !== 'all' ? 1 : 0) +
  (filters.conflict !== 'all' ? 1 : 0) +
  (filters.missingHostnameOnly ? 1 : 0) +
  (filters.withCredentialsOnly ? 1 : 0);

const ImportFilters: React.FC<{
  filters: ImportFilterState;
  updateFilters: (updates: Partial<ImportFilterState>) => void;
  resetFilters: () => void;
  availableProtocols: string[];
}> = ({ filters, updateFilters, resetFilters, availableProtocols }) => {
  const activeCount = countActiveFilters(filters);
  const [open, setOpen] = useState(true);

  return (
    <div className="space-y-2 border-b border-[var(--color-border)] bg-[var(--color-background)]/40 p-3">
      <div className="flex items-center gap-2">
        <label className="flex min-h-8 flex-1 items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-xs focus-within:border-primary">
          <Search size={14} className="shrink-0 text-[var(--color-textMuted)]" />
          <input
            value={filters.search}
            onChange={(event) => updateFilters({ search: event.target.value })}
            placeholder="Search name, host, folder, tags, issues"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[var(--color-text)] outline-none placeholder:text-[var(--color-textMuted)]"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => updateFilters({ search: '' })}
              className="shrink-0 text-[var(--color-textMuted)] hover:text-[var(--color-text)]"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </label>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs transition-colors ${
            activeCount > 0
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]'
          }`}
        >
          <Filter size={12} />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-primary/30 px-1.5 text-[10px] font-semibold text-primary">
              {activeCount}
            </span>
          )}
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          type="button"
          onClick={resetFilters}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-textSecondary)] transition-colors hover:text-[var(--color-text)]"
        >
          Reset filters
        </button>
      </div>

      {open && (
        <div className="grid gap-2 pt-2 sm:grid-cols-2 lg:grid-cols-3">
          <select
            value={filters.protocol}
            onChange={(event) =>
              updateFilters({ protocol: event.target.value as ImportFilterState['protocol'] })
            }
            className="sor-form-input-xs"
            aria-label="Protocol filter"
          >
            <option value="all">All protocols</option>
            {availableProtocols.map((protocol) => (
              <option key={protocol} value={protocol}>
                {protocol.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            value={filters.issueSeverity}
            onChange={(event) =>
              updateFilters({
                issueSeverity: event.target.value as ImportFilterState['issueSeverity'],
              })
            }
            className="sor-form-input-xs"
            aria-label="Issue filter"
          >
            <option value="all">All issue states</option>
            <option value="error">Errors</option>
            <option value="warning">Warnings</option>
            <option value="info">Info</option>
          </select>
          <select
            value={filters.itemKind}
            onChange={(event) =>
              updateFilters({ itemKind: event.target.value as ImportFilterState['itemKind'] })
            }
            className="sor-form-input-xs"
            aria-label="Item type filter"
          >
            <option value="all">All item types</option>
            <option value="connection">Connections</option>
            <option value="folder">Folders</option>
            <option value="vpn">VPN</option>
            <option value="tunnelChain">Tunnel chains</option>
            <option value="sshTunnel">SSH tunnels</option>
          </select>
          <select
            value={filters.selection}
            onChange={(event) =>
              updateFilters({ selection: event.target.value as ImportFilterState['selection'] })
            }
            className="sor-form-input-xs"
            aria-label="Selection filter"
          >
            <option value="all">Any selection</option>
            <option value="selected">Selected only</option>
            <option value="unselected">Unselected only</option>
          </select>
          <select
            value={filters.conflict}
            onChange={(event) =>
              updateFilters({ conflict: event.target.value as ImportFilterState['conflict'] })
            }
            className="sor-form-input-xs"
            aria-label="Conflict filter"
          >
            <option value="all">All conflicts</option>
            <option value="conflicts">Conflicts only</option>
            <option value="clean">Clean only</option>
          </select>
          <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--color-textSecondary)]">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.missingHostnameOnly}
                onChange={(event) =>
                  updateFilters({ missingHostnameOnly: event.target.checked })
                }
              />
              Missing host
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.withCredentialsOnly}
                onChange={(event) =>
                  updateFilters({ withCredentialsOnly: event.target.checked })
                }
              />
              Has credentials
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Import options (moved near action) ────────────────────────── */

const ImportOptionsPanel: React.FC<{
  options: ImportOptions;
  updateOptions: (updates: Partial<ImportOptions>) => void;
}> = ({ options, updateOptions }) => (
  <ImportSection
    title="Import options"
    description="Tune how imported items are merged into the target database."
    icon={Filter}
  >
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label
            htmlFor="import-options-conflict-policy"
            className="block text-xs text-[var(--color-textSecondary)]"
          >
            Conflict policy
          </label>
          <select
            id="import-options-conflict-policy"
            value={options.conflictPolicy}
            onChange={(event) =>
              updateOptions({
                conflictPolicy: event.target.value as ImportOptions['conflictPolicy'],
              })
            }
            className="sor-form-input-xs w-full"
          >
            <option value="duplicate">Import as duplicate</option>
            <option value="rename">Rename conflicts</option>
            <option value="skip">Skip conflicts</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="import-options-add-tags"
            className="block text-xs text-[var(--color-textSecondary)]"
          >
            Add tags to imported items
          </label>
          <input
            id="import-options-add-tags"
            value={options.addTags}
            onChange={(event) => updateOptions({ addTags: event.target.value })}
            placeholder="comma-separated tags"
            className="sor-form-input-xs w-full"
          />
        </div>
      </div>

      <div className="grid gap-2 text-xs text-[var(--color-textSecondary)] sm:grid-cols-2">
        {[
          ['preserveFolders', 'Preserve folders'],
          ['includeCredentials', 'Include credentials'],
          ['includeVpnData', 'Import VPN data'],
          ['includeTunnelChains', 'Import tunnel chains'],
          ['includeSshTunnels', 'Import SSH tunnels'],
          ['switchToTargetDatabaseAfterImport', 'Switch to target after import'],
        ].map(([key, label]) => (
          <label key={key} className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(options[key as keyof ImportOptions])}
              onChange={(event) =>
                updateOptions({ [key]: event.target.checked } as Partial<ImportOptions>)
              }
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  </ImportSection>
);

/* ── Preview details (rendered inside expanded row) ────────────── */

const PreviewDetails: React.FC<{ item: ImportPreviewItem }> = ({ item }) => (
  <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-xs">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="font-medium text-[var(--color-text)]">{item.name}</div>
        <div className="mt-1 text-[var(--color-textMuted)]">
          Source #{item.sourceIndex} | {item.kind} | {item.conflictStatus}
        </div>
      </div>
      <span
        className={`rounded border px-2 py-0.5 ${
          item.importable
            ? 'border-success/30 bg-success/10 text-success'
            : 'border-error/30 bg-error/10 text-error'
        }`}
      >
        {item.importable ? 'Importable' : 'Blocked'}
      </span>
    </div>

    <div className="mb-3 grid grid-cols-1 gap-1 text-[var(--color-textSecondary)] sm:grid-cols-2">
      <div>Path: {item.sourcePath}</div>
      <div>Parent: {item.parentName || '-'}</div>
      <div>Host: {item.hostname || '-'}</div>
      <div>Port: {item.port || '-'}</div>
      <div>Username: {item.username || '-'}</div>
      <div>Tags: {item.tags.join(', ') || '-'}</div>
    </div>

    {item.issues.length > 0 && (
      <div className="mb-3 flex flex-wrap gap-1">
        {item.issues.map((issue) => (
          <span
            key={`${issue.code}-${issue.message}`}
            className={`rounded border px-1.5 py-0.5 ${severityClass(issue.severity)}`}
          >
            {issue.message}
          </span>
        ))}
      </div>
    )}

    <div className="text-[var(--color-textMuted)]">Full parsed record</div>
    <pre className="mt-2 max-h-[320px] overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[11px] leading-relaxed text-[var(--color-textSecondary)]">
      {buildPreviewDetailJson(item)}
    </pre>
  </div>
);

/* ── Preview table with inline-expanded focused row ────────────── */

const PreviewTable: React.FC<{
  items: ImportPreviewItem[];
  selectedIds: Set<string>;
  focusedItemId?: string;
  toggleSelection: (itemId: string) => void;
  onFocusItem: (itemId: string) => void;
}> = ({ items, selectedIds, focusedItemId, toggleSelection, onFocusItem }) => (
  <div className="overflow-hidden border-t border-[var(--color-border)]">
    <div className="max-h-[460px] overflow-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="sticky top-0 z-10 bg-[var(--color-background)] text-[var(--color-textMuted)] shadow-[inset_0_-1px_0_var(--color-border)]">
          <tr>
            <th className="w-10 px-3 py-2">Use</th>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Host</th>
            <th className="px-3 py-2">Folder Path</th>
            <th className="px-3 py-2">Tags</th>
            <th className="px-3 py-2">Issues</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {items.map((item) => {
            const focused = focusedItemId === item.id;
            const selected = selectedIds.has(item.id);
            return (
              <React.Fragment key={item.id}>
                <tr
                  tabIndex={0}
                  onClick={() => onFocusItem(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onFocusItem(item.id);
                    }
                  }}
                  className={`${
                    selected ? 'bg-primary/10' : 'bg-[var(--color-surface)]'
                  } cursor-pointer outline-none transition-colors hover:bg-[var(--color-surfaceHover)] ${
                    focused ? 'ring-1 ring-inset ring-primary' : ''
                  }`}
                >
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      disabled={!item.importable}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleSelection(item.id)}
                      aria-label={`Select ${item.name}`}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onFocusItem(item.id);
                      }}
                      className="flex items-center gap-1.5 text-left font-medium text-[var(--color-text)] hover:text-primary"
                    >
                      {focused ? (
                        <ChevronDown size={11} className="text-[var(--color-textMuted)]" />
                      ) : (
                        <ChevronRight size={11} className="text-[var(--color-textMuted)]" />
                      )}
                      <span>{item.name}</span>
                    </button>
                    {item.username && (
                      <div className="mt-0.5 pl-[18px] text-[var(--color-textMuted)]">
                        {item.username}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="rounded border border-[var(--color-border)] px-2 py-0.5 uppercase text-[var(--color-textSecondary)]">
                      {item.kind === 'connection'
                        ? item.protocol
                        : item.kind === 'tunnelChain'
                          ? 'tunnel'
                          : item.kind === 'sshTunnel'
                            ? 'ssh tunnel'
                            : item.kind}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-[var(--color-textSecondary)]">
                    {item.hostname || '-'}
                    {item.port ? `:${item.port}` : ''}
                  </td>
                  <td className="px-3 py-2 align-top text-[var(--color-textSecondary)]">
                    {item.sourcePath}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1">
                      {item.tags.length === 0 && (
                        <span className="text-[var(--color-textMuted)]">-</span>
                      )}
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-textSecondary)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1">
                      {item.issues.length === 0 && (
                        <span className="rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-success">
                          clean
                        </span>
                      )}
                      {item.issues.slice(0, 3).map((issue) => (
                        <span
                          key={`${issue.code}-${issue.message}`}
                          className={`rounded border px-1.5 py-0.5 ${severityClass(issue.severity)}`}
                        >
                          {issue.code}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
                {focused && (
                  <tr className="bg-[var(--color-background)]/60">
                    <td colSpan={7} className="px-3 py-3">
                      <PreviewDetails item={item} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td
                colSpan={7}
                className="px-3 py-8 text-center text-[var(--color-textMuted)]"
              >
                No preview rows match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

/* ── Root component ───────────────────────────────────────────── */

const ImportTab: React.FC<ImportTabProps> = ({
  isProcessing,
  handleImport,
  fileInputRef,
  importResult,
  handleFileSelect,
  handleFileDrop,
  confirmImport,
  cancelImport,
  detectedFormat,
  importDatabaseOptions = [],
  importTargetMode = 'current',
  setImportTargetMode = () => undefined,
  selectedImportDatabaseId = '',
  setSelectedImportDatabaseId = () => undefined,
  importFormatSelection = 'auto',
  setImportFormatSelection = () => undefined,
  importAnalysis,
  importFilters = FALLBACK_FILTERS,
  updateImportFilters = () => undefined,
  resetImportFilters = () => undefined,
  importOptions = FALLBACK_OPTIONS,
  updateImportOptions = () => undefined,
  previewItems = [],
  visiblePreviewItems = previewItems,
  availableProtocols = [],
  selectedPreviewIds = new Set<string>(),
  selectedCount,
  togglePreviewSelection = () => undefined,
  selectAllVisiblePreviewItems = () => undefined,
  deselectAllVisiblePreviewItems = () => undefined,
  selectAllImportablePreviewItems = () => undefined,
  onUnlockDatabase,
}) => {
  const { toast } = useToastContext();
  const { t } = useTranslation();
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  const focusedItem = useMemo(
    () => previewItems.find((item) => item.id === focusedItemId) || previewItems[0],
    [focusedItemId, previewItems],
  );
  const selectedRows = selectedCount ?? selectedPreviewIds.size;
  const selectedTarget = importDatabaseOptions.find(
    (option) => option.id === selectedImportDatabaseId,
  );
  const selectedTargetLocked =
    importTargetMode === 'selected' && selectedTarget && !selectedTarget.isExportable;
  const canImport =
    importResult?.success &&
    !selectedTargetLocked &&
    (previewItems.length === 0 || selectedRows > 0);
  const isReview = !!importResult;
  const isSuccess = !!importResult?.success;
  const isFailure = !!importResult && !importResult.success;
  const previewItemCount = previewItems.length;
  const visibleCount = visiblePreviewItems.length;

  const downloadTemplate = (kind: TemplateKind) => {
    const spec = TEMPLATES.find((entry) => entry.kind === kind);
    if (!spec) return;

    const blob = new Blob([spec.build()], { type: spec.mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = spec.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(
      t('import.templateDownloaded', {
        filename: spec.filename,
        defaultValue: `Template "${spec.filename}" downloaded to your Downloads folder`,
      }),
    );
  };

  const onDropFile = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0];
    if (file && handleFileDrop) {
      void handleFileDrop(file);
    }
  };

  const dropZone = (
    <div
      className="rounded-lg border-2 border-dashed border-[var(--color-border)] p-8 text-center transition-colors hover:border-primary/50"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDropFile}
      data-testid="import-dropzone"
    >
      <FolderOpen size={48} className="mx-auto mb-4 text-[var(--color-textSecondary)]" />
      <p className="mb-4 text-[var(--color-textSecondary)]">
        Drag a file here or click below to choose one
      </p>
      <button
        onClick={handleImport}
        disabled={isProcessing || Boolean(selectedTargetLocked)}
        className="mx-auto flex items-center space-x-2 rounded-lg bg-primary px-6 py-2 text-[var(--color-text)] transition-colors hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)]"
      >
        {isProcessing ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-[var(--color-border)]" />
            <span>Processing...</span>
          </>
        ) : (
          <>
            <File size={16} />
            <span>Choose File</span>
          </>
        )}
      </button>
      <p className="mt-2 text-xs text-[var(--color-textMuted)]">
        Formats: .json, .xml, .csv, .ini, .reg, .rdg, .rtsz, .rtsx
      </p>
    </div>
  );

  const templatesRow = (
    <ImportSection
      title="Templates"
      description="Download native templates for hand-authored imports."
      icon={Download}
    >
      <div className="flex flex-wrap gap-2">
        {TEMPLATES.map((template) => (
          <button
            key={template.kind}
            onClick={() => downloadTemplate(template.kind)}
            className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-textSecondary)] transition-colors hover:border-primary/50 hover:text-[var(--color-text)]"
          >
            <Download size={13} />
            <span>{template.label}</span>
          </button>
        ))}
      </div>
    </ImportSection>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-[var(--color-text)] mb-2 select-none">
          {t('importTab.title', { defaultValue: 'Import' })}
        </h3>
        <p className="text-sm text-[var(--color-textSecondary)] select-none">
          {t('importTab.description', {
            defaultValue:
              'Bring connections, tags, VPN profiles, tunnel chains and SSH tunnels into a database from a native sortOfRemoteNG export or a compatible third-party file (mRemoteNG, RDP files, PuTTY, CSV, JSON, XML).',
          })}
        </p>
      </div>

      {/* ─── Pick-source state ─────────────────────────────────── */}
      {!isReview && (
        <>
          <TargetDatabaseSection
            options={importDatabaseOptions}
            targetMode={importTargetMode}
            onSelectMode={setImportTargetMode}
            selectedDatabaseId={selectedImportDatabaseId}
            onSelect={setSelectedImportDatabaseId}
            onUnlockDatabase={onUnlockDatabase}
          />

          <FormatSelectionSection
            selection={importFormatSelection}
            onSelect={setImportFormatSelection}
            analysis={importAnalysis}
          />

          <ImportSection
            title="Source file"
            description="Choose or drop a supported native or compatible application export."
            icon={FolderOpen}
          >
            {dropZone}
          </ImportSection>

          {templatesRow}
        </>
      )}

      {/* ─── Review state (success or failure) ────────────────── */}
      {isReview && (
        <div className="space-y-5" data-testid="import-preview">
          {isSuccess && (
            <>
              <SourceHeader
                analysis={importAnalysis}
                detectedFormat={detectedFormat}
                importedCount={importResult?.imported}
                onChangeFile={cancelImport}
              />

              {previewItemCount > importResult!.imported && (
                <p className="text-xs text-[var(--color-textMuted)]">
                  {previewItemCount - importResult!.imported} sidecar row(s) ready to review.
                </p>
              )}

              {importResult!.errors.length > 0 && (
                <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
                  <p className="text-sm font-medium text-warning">Errors:</p>
                  <ul className="mt-1 text-sm text-warning">
                    {importResult!.errors.map((error, index) => (
                      <li key={`err-${error.slice(0, 50)}-${index}`}>- {error}</li>
                    ))}
                  </ul>
                </div>
              )}

              <TargetDatabaseSection
                options={importDatabaseOptions}
                targetMode={importTargetMode}
                onSelectMode={setImportTargetMode}
                selectedDatabaseId={selectedImportDatabaseId}
                onSelect={setSelectedImportDatabaseId}
                onUnlockDatabase={onUnlockDatabase}
              />

              {previewItemCount > 0 && (
                <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)]">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div>
                      <h4 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                        <FileText size={16} className="text-primary" />
                        Preview
                      </h4>
                      <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                        {selectedRows} selected | {visibleCount} visible after filters |{' '}
                        {previewItemCount} total preview rows
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={selectAllImportablePreviewItems}
                        className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                      >
                        Select all importable
                      </button>
                      <button
                        type="button"
                        onClick={selectAllVisiblePreviewItems}
                        className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                      >
                        Select visible
                      </button>
                      <button
                        type="button"
                        onClick={deselectAllVisiblePreviewItems}
                        className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                      >
                        Clear visible
                      </button>
                    </div>
                  </div>

                  <ImportFilters
                    filters={importFilters}
                    updateFilters={updateImportFilters}
                    resetFilters={resetImportFilters}
                    availableProtocols={availableProtocols}
                  />

                  <PreviewTable
                    items={visiblePreviewItems}
                    selectedIds={selectedPreviewIds}
                    focusedItemId={focusedItem?.id}
                    toggleSelection={togglePreviewSelection}
                    onFocusItem={setFocusedItemId}
                  />
                </div>
              )}

              <ImportOptionsPanel
                options={importOptions}
                updateOptions={updateImportOptions}
              />

              <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur px-3 py-2 shadow-[0_-6px_16px_-8px_rgba(0,0,0,0.35)]">
                <div className="text-xs text-[var(--color-textMuted)]">
                  {previewItemCount > 0
                    ? `${selectedRows} of ${previewItemCount} selected`
                    : `${importResult!.imported} ready to import`}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={cancelImport}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm text-[var(--color-textSecondary)] transition-colors hover:text-[var(--color-text)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmImport}
                    disabled={!canImport}
                    data-testid="import-confirm"
                    className="flex items-center gap-2 rounded-lg bg-success px-5 py-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CheckCircle size={14} />
                    Import {previewItemCount > 0 ? selectedRows : importResult!.imported} Selected
                  </button>
                </div>
              </div>
            </>
          )}

          {isFailure && (
            <>
              <div className="rounded-lg border border-error/40 bg-error/10 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <AlertCircle size={20} className="text-error" />
                  <span className="font-medium text-error">Import Failed</span>
                  {detectedFormat && (
                    <span className="rounded bg-error/20 px-2 py-0.5 text-xs text-error">
                      {detectedFormat}
                    </span>
                  )}
                </div>
                {importResult!.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-error">Errors:</p>
                    <ul className="mt-1 text-sm text-error">
                      {importResult!.errors.map((error, index) => (
                        <li key={`err-${error.slice(0, 50)}-${index}`}>- {error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <button
                onClick={cancelImport}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 text-sm text-[var(--color-textSecondary)] transition-colors hover:border-primary/50 hover:text-[var(--color-text)]"
              >
                <Upload size={14} />
                Try Again
              </button>

              <FormatSelectionSection
                selection={importFormatSelection}
                onSelect={setImportFormatSelection}
                analysis={importAnalysis}
              />

              <ImportSection
                title="Try a different file"
                description="Pick another export or drop a file to retry parsing."
                icon={FolderOpen}
              >
                {dropZone}
              </ImportSection>

              {templatesRow}
            </>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.xml,.csv,.ini,.reg,.rdg,.rtsz,.rtsx,.encrypted"
        onChange={handleFileSelect}
        className="hidden"
        data-testid="import-file-input"
      />
    </div>
  );
};

export default ImportTab;
