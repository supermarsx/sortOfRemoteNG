import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Download,
  File,
  FileCode,
  FileText,
  Filter,
  FolderOpen,
  Search,
  Shield,
} from 'lucide-react';
import {
  ImportFilterState,
  ImportOptions,
  ImportPreviewItem,
  ImportResult,
  ImportSourceMetadata,
} from './types';
import { useToastContext } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';

interface ImportTabProps {
  isProcessing: boolean;
  handleImport: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  importResult: ImportResult | null;
  handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  confirmImport: () => void | Promise<void>;
  cancelImport: () => void;
  detectedFormat?: string;
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
  conflictPolicy: 'duplicate',
  addTags: '',
};

// Template data for CSV
const CSV_TEMPLATE = `Name,Protocol,Hostname,Port,Username,Domain,Description,ParentId,IsGroup,Tags
"Web Server 1",SSH,192.168.1.10,22,admin,,Web server in datacenter,,false,"production;linux"
"Database Server",RDP,192.168.1.20,3389,administrator,DOMAIN,SQL Server,,false,"production;database"
"Dev Folder",SSH,,,,,Development servers,,true,""
"Dev Server 1",SSH,10.0.0.5,22,devuser,,Dev environment,Dev Folder,false,"development;test"
"Router Admin",HTTP,192.168.1.1,80,admin,,Network router,,false,"network;router"
"VNC Desktop",VNC,192.168.1.30,5900,,,Remote desktop access,,false,"desktop;vnc"`;

// Template data for JSON
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
    }),
    null,
    2,
  );
}

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2">
    <div className="text-[10px] uppercase text-[var(--color-textMuted)]">{label}</div>
    <div className="text-sm font-medium text-[var(--color-text)]">{value}</div>
  </div>
);

const AnalysisSummary: React.FC<{ analysis: ImportSourceMetadata }> = ({ analysis }) => (
  <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
          <FileText size={16} />
          <span>{analysis.filename}</span>
          <span className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">
            {analysis.formatName}
          </span>
          {analysis.encrypted && (
            <span className="inline-flex items-center gap-1 rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs text-warning">
              <Shield size={11} />
              Encrypted
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-[var(--color-textMuted)]">
          {formatBytes(analysis.sizeBytes)} | Confidence {analysis.confidence}
          {analysis.rootName ? ` | Root ${analysis.rootName}` : ''}
        </div>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Stat label="Connections" value={analysis.counts.connections} />
      <Stat label="Folders" value={analysis.counts.folders} />
      <Stat label="Conflicts" value={analysis.counts.conflicts} />
      <Stat label="Warnings" value={analysis.counts.warnings} />
      <Stat label="VPN" value={analysis.counts.vpnConnections} />
      <Stat label="Tunnels" value={analysis.counts.tunnelChains} />
    </div>

    <div className="grid gap-2 text-xs text-[var(--color-textSecondary)] md:grid-cols-2">
      {analysis.encryption && (
        <div>
          Encryption: protected={String(analysis.encryption.protected)}, full-file={String(analysis.encryption.fullFileEncryption)}, password required={String(analysis.encryption.requiresPassword)}
        </div>
      )}
      {analysis.csv && (
        <div>
          CSV: {analysis.csv.dataRows} data row(s), headers {analysis.csv.headers.join(', ') || 'none'}
        </div>
      )}
      {analysis.json && (
        <div>
          JSON: {analysis.json.shape}, keys {analysis.json.topLevelKeys.join(', ') || 'none'}
        </div>
      )}
      {analysis.xml && (
        <div>
          XML: {analysis.xml.rootElement || 'unknown root'}, {analysis.xml.nodeCount} source node(s)
        </div>
      )}
    </div>
  </div>
);

const ImportFilters: React.FC<{
  filters: ImportFilterState;
  updateFilters: (updates: Partial<ImportFilterState>) => void;
  resetFilters: () => void;
  availableProtocols: string[];
}> = ({ filters, updateFilters, resetFilters, availableProtocols }) => (
  <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
    <div className="flex items-center gap-2 text-xs font-medium uppercase text-[var(--color-textMuted)]">
      <Filter size={13} />
      Preview Filters
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="flex min-h-8 items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-xs focus-within:border-primary sm:col-span-2">
        <Search size={14} className="shrink-0 text-[var(--color-textMuted)]" />
        <input
          value={filters.search}
          onChange={(event) => updateFilters({ search: event.target.value })}
          placeholder="Search name, host, folder, tags, issues"
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[var(--color-text)] outline-none placeholder:text-[var(--color-textMuted)]"
        />
      </label>
      <select
        value={filters.protocol}
        onChange={(event) => updateFilters({ protocol: event.target.value as ImportFilterState['protocol'] })}
        className="sor-form-input-xs"
        aria-label="Protocol filter"
      >
        <option value="all">All protocols</option>
        {availableProtocols.map((protocol) => (
          <option key={protocol} value={protocol}>{protocol.toUpperCase()}</option>
        ))}
      </select>
      <select
        value={filters.issueSeverity}
        onChange={(event) => updateFilters({ issueSeverity: event.target.value as ImportFilterState['issueSeverity'] })}
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
        onChange={(event) => updateFilters({ itemKind: event.target.value as ImportFilterState['itemKind'] })}
        className="sor-form-input-xs"
        aria-label="Item type filter"
      >
        <option value="all">All item types</option>
        <option value="connection">Connections</option>
        <option value="folder">Folders</option>
      </select>
      <select
        value={filters.selection}
        onChange={(event) => updateFilters({ selection: event.target.value as ImportFilterState['selection'] })}
        className="sor-form-input-xs"
        aria-label="Selection filter"
      >
        <option value="all">Any selection</option>
        <option value="selected">Selected only</option>
        <option value="unselected">Unselected only</option>
      </select>
      <select
        value={filters.conflict}
        onChange={(event) => updateFilters({ conflict: event.target.value as ImportFilterState['conflict'] })}
        className="sor-form-input-xs"
        aria-label="Conflict filter"
      >
        <option value="all">All conflicts</option>
        <option value="conflicts">Conflicts only</option>
        <option value="clean">Clean only</option>
      </select>
      <button type="button" onClick={resetFilters} className="sor-btn-secondary-sm justify-center">
        Reset filters
      </button>
    </div>
    <div className="flex flex-wrap gap-4 text-xs text-[var(--color-textSecondary)]">
      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={filters.missingHostnameOnly}
          onChange={(event) => updateFilters({ missingHostnameOnly: event.target.checked })}
        />
        Missing host
      </label>
      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={filters.withCredentialsOnly}
          onChange={(event) => updateFilters({ withCredentialsOnly: event.target.checked })}
        />
        Has credentials
      </label>
    </div>
  </div>
);

const ImportOptionsPanel: React.FC<{
  options: ImportOptions;
  updateOptions: (updates: Partial<ImportOptions>) => void;
}> = ({ options, updateOptions }) => (
  <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
    <div className="text-xs font-medium uppercase text-[var(--color-textMuted)]">Import Options</div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs text-[var(--color-textSecondary)]">
        Conflict policy
        <select
          value={options.conflictPolicy}
          onChange={(event) => updateOptions({ conflictPolicy: event.target.value as ImportOptions['conflictPolicy'] })}
          className="sor-form-input-xs w-full"
        >
          <option value="duplicate">Import as duplicate</option>
          <option value="rename">Rename conflicts</option>
          <option value="skip">Skip conflicts</option>
        </select>
      </label>
      <label className="space-y-1 text-xs text-[var(--color-textSecondary)]">
        Add tags to imported items
        <input
          value={options.addTags}
          onChange={(event) => updateOptions({ addTags: event.target.value })}
          placeholder="comma-separated tags"
          className="sor-form-input-xs w-full"
        />
      </label>
    </div>
    <div className="grid gap-2 text-xs text-[var(--color-textSecondary)] sm:grid-cols-2">
      {[
        ['preserveFolders', 'Preserve folders'],
        ['includeCredentials', 'Include credentials'],
        ['includeVpnData', 'Import VPN data'],
        ['includeTunnelChains', 'Import tunnel chains'],
      ].map(([key, label]) => (
        <label key={key} className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(options[key as keyof ImportOptions])}
            onChange={(event) => updateOptions({ [key]: event.target.checked } as Partial<ImportOptions>)}
          />
          {label}
        </label>
      ))}
    </div>
  </div>
);

const PreviewTable: React.FC<{
  items: ImportPreviewItem[];
  selectedIds: Set<string>;
  focusedItemId?: string;
  toggleSelection: (itemId: string) => void;
  onFocusItem: (itemId: string) => void;
}> = ({ items, selectedIds, focusedItemId, toggleSelection, onFocusItem }) => (
  <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="sticky top-0 bg-[var(--color-background)] text-[var(--color-textMuted)]">
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
            <tr
              key={item.id}
              tabIndex={0}
              onClick={() => onFocusItem(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onFocusItem(item.id);
                }
              }}
              className={`${selected ? 'bg-primary/10' : 'bg-[var(--color-surface)]'} cursor-pointer outline-none transition-colors hover:bg-[var(--color-surfaceHover)] ${focused ? 'ring-1 ring-inset ring-primary' : ''}`}
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
                  className="text-left font-medium text-[var(--color-text)] hover:text-primary"
                >
                  {item.name}
                </button>
                {item.username && <div className="text-[var(--color-textMuted)]">{item.username}</div>}
              </td>
              <td className="px-3 py-2 align-top">
                <span className="rounded border border-[var(--color-border)] px-2 py-0.5 uppercase text-[var(--color-textSecondary)]">
                  {item.kind === 'folder' ? 'folder' : item.protocol}
                </span>
              </td>
              <td className="px-3 py-2 align-top text-[var(--color-textSecondary)]">
                {item.hostname || '-'}{item.port ? `:${item.port}` : ''}
              </td>
              <td className="px-3 py-2 align-top text-[var(--color-textSecondary)]">{item.sourcePath}</td>
              <td className="px-3 py-2 align-top">
                <div className="flex flex-wrap gap-1">
                  {item.tags.length === 0 && <span className="text-[var(--color-textMuted)]">-</span>}
                  {item.tags.map((tag) => (
                    <span key={tag} className="rounded bg-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-textSecondary)]">
                      {tag}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-3 py-2 align-top">
                <div className="flex flex-wrap gap-1">
                  {item.issues.length === 0 && (
                    <span className="rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-success">clean</span>
                  )}
                  {item.issues.slice(0, 3).map((issue) => (
                    <span key={`${issue.code}-${issue.message}`} className={`rounded border px-1.5 py-0.5 ${severityClass(issue.severity)}`}>
                      {issue.code}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-[var(--color-textMuted)]">
                No preview rows match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

const PreviewDetails: React.FC<{ item: ImportPreviewItem }> = ({ item }) => (
  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="font-medium text-[var(--color-text)]">{item.name}</div>
        <div className="mt-1 text-[var(--color-textMuted)]">
          Source #{item.sourceIndex} | {item.kind} | {item.conflictStatus}
        </div>
      </div>
      <span className={`rounded border px-2 py-0.5 ${item.importable ? 'border-success/30 bg-success/10 text-success' : 'border-error/30 bg-error/10 text-error'}`}>
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
          <span key={`${issue.code}-${issue.message}`} className={`rounded border px-1.5 py-0.5 ${severityClass(issue.severity)}`}>
            {issue.message}
          </span>
        ))}
      </div>
    )}

    <div className="text-[var(--color-textMuted)]">Full parsed record</div>
    <pre className="mt-2 max-h-[360px] overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-[11px] leading-relaxed text-[var(--color-textSecondary)]">
      {buildPreviewDetailJson(item)}
    </pre>
  </div>
);

const ImportTab: React.FC<ImportTabProps> = ({
  isProcessing,
  handleImport,
  fileInputRef,
  importResult,
  handleFileSelect,
  confirmImport,
  cancelImport,
  detectedFormat,
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
}) => {
  const { toast } = useToastContext();
  const { t } = useTranslation();
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  const focusedItem = useMemo(
    () => previewItems.find((item) => item.id === focusedItemId) || previewItems[0],
    [focusedItemId, previewItems],
  );
  const selectedRows = selectedCount ?? selectedPreviewIds.size;
  const canImport = importResult?.success && (previewItems.length === 0 || selectedRows > 0);

  const downloadTemplate = (format: 'csv' | 'json') => {
    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === 'csv') {
      content = CSV_TEMPLATE;
      filename = 'sortofremoteng-import-template.csv';
      mimeType = 'text/csv';
    } else {
      content = JSON.stringify(JSON_TEMPLATE, null, 2);
      filename = 'sortofremoteng-import-template.json';
      mimeType = 'application/json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(t('import.templateDownloaded', {
      filename,
      defaultValue: `Template "${filename}" downloaded to your Downloads folder`,
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-4 text-lg font-medium text-[var(--color-text)]">Import into this database</h3>
        <p className="mb-2 text-[var(--color-textSecondary)]">
          Bring content into the currently open database. Connection lists from
          third-party tools are parsed, you can inspect the preview, filter and
          choose exactly which entries to add — they get appended to the
          database alongside its existing connections, tab groups and tags.
        </p>
        <p className="mb-4 text-xs text-[var(--color-textMuted)]">
          To restore or merge a whole database file (connections + tab groups
          + color tags) you previously exported from this app, use{" "}
          <span className="font-medium">Databases &rarr; Import</span> instead;
          that creates a new database entry rather than merging into the
          current one.
        </p>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="sor-info-pill"><FileCode className="h-4 w-4 text-primary" />mRemoteNG</div>
          <div className="sor-info-pill"><FileCode className="h-4 w-4 text-success" />RDCMan</div>
          <div className="sor-info-pill"><FileCode className="h-4 w-4 text-primary" />MobaXterm</div>
          <div className="sor-info-pill"><FileCode className="h-4 w-4 text-warning" />PuTTY</div>
          <div className="sor-info-pill"><FileCode className="h-4 w-4 text-info" />Termius</div>
          <div className="sor-info-pill"><FileText className="h-4 w-4 text-warning" />CSV / JSON</div>
        </div>
      </div>

      {!importResult && (
        <div className="rounded-lg border-2 border-dashed border-[var(--color-border)] p-8 text-center">
          <FolderOpen size={48} className="mx-auto mb-4 text-[var(--color-textSecondary)]" />
          <p className="mb-4 text-[var(--color-textSecondary)]">Select a file to import connections</p>
          <button
            onClick={handleImport}
            disabled={isProcessing}
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
            Formats auto-detected: .json, .xml, .csv, .ini, .reg
          </p>

          <div className="mt-6 border-t border-[var(--color-border)] pt-4">
            <p className="mb-3 text-sm text-[var(--color-textSecondary)]">Download import templates:</p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => downloadTemplate('csv')}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-textSecondary)] transition-colors hover:bg-[var(--color-border)]"
              >
                <Download size={14} />
                <span>CSV Template</span>
              </button>
              <button
                onClick={() => downloadTemplate('json')}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-textSecondary)] transition-colors hover:bg-[var(--color-border)]"
              >
                <Download size={14} />
                <span>JSON Template</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {importResult && (
        <div className="space-y-4" data-testid="import-preview">
          <div className={`rounded-lg border p-4 ${importResult.success ? 'border-success bg-success/10' : 'border-error bg-error/10'}`}>
            <div className="mb-2 flex items-center space-x-2">
              {importResult.success ? (
                <CheckCircle size={20} className="text-success" />
              ) : (
                <AlertCircle size={20} className="text-error" />
              )}
              <span className={`font-medium ${importResult.success ? 'text-success' : 'text-error'}`}>
                {importResult.success ? 'Import Successful' : 'Import Failed'}
              </span>
              {detectedFormat && importResult.success && (
                <span className="rounded bg-primary/30 px-2 py-0.5 text-xs text-primary">
                  {detectedFormat}
                </span>
              )}
            </div>

            {importResult.success && (
              <>
                <p className="text-[var(--color-textSecondary)]">Found {importResult.imported} connections ready to import.</p>
                {previewItems.length > 0 && (
                  <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                    {selectedRows} selected | {visiblePreviewItems.length} visible after filters | {previewItems.length} total preview rows
                  </p>
                )}
              </>
            )}

            {importResult.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-sm font-medium text-error">Errors:</p>
                <ul className="mt-1 text-sm text-error">
                  {importResult.errors.map((error, index) => (
                    <li key={`err-${error.slice(0, 50)}-${index}`}>- {error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {importResult.success && importAnalysis && <AnalysisSummary analysis={importAnalysis} />}

          {importResult.success && previewItems.length > 0 && (
            <>
              <ImportFilters
                filters={importFilters}
                updateFilters={updateImportFilters}
                resetFilters={resetImportFilters}
                availableProtocols={availableProtocols}
              />

              <ImportOptionsPanel options={importOptions} updateOptions={updateImportOptions} />

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={selectAllVisiblePreviewItems} className="sor-btn-secondary-sm">
                  Select visible
                </button>
                <button type="button" onClick={deselectAllVisiblePreviewItems} className="sor-btn-secondary-sm">
                  Clear visible
                </button>
                <button type="button" onClick={selectAllImportablePreviewItems} className="sor-btn-secondary-sm">
                  Select all importable
                </button>
                <div className="ml-auto text-xs text-[var(--color-textMuted)]">
                  {selectedRows} selected
                </div>
              </div>

              <div className="space-y-3 min-w-0">
                <PreviewTable
                  items={visiblePreviewItems}
                  selectedIds={selectedPreviewIds}
                  focusedItemId={focusedItem?.id}
                  toggleSelection={togglePreviewSelection}
                  onFocusItem={setFocusedItemId}
                />
                {focusedItem && (
                  <aside className="min-w-0" aria-label="Connection import details">
                    <PreviewDetails item={focusedItem} />
                  </aside>
                )}
              </div>
            </>
          )}

          {importResult.success && (
            <div className="flex space-x-3">
              <button
                onClick={confirmImport}
                disabled={!canImport}
                data-testid="import-confirm"
                className="flex-1 rounded-lg bg-success py-2 text-[var(--color-text)] transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Import {previewItems.length > 0 ? selectedRows : importResult.imported} Selected
              </button>
              <button
                onClick={cancelImport}
                className="rounded-lg bg-[var(--color-surfaceHover)] px-4 py-2 text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)]"
              >
                Cancel
              </button>
            </div>
          )}

          {!importResult.success && (
            <button
              onClick={cancelImport}
              className="w-full rounded-lg bg-primary py-2 text-[var(--color-text)] transition-colors hover:bg-primary/90"
            >
              Try Again
            </button>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.xml,.csv,.ini,.reg,.encrypted"
        onChange={handleFileSelect}
        className="hidden"
        data-testid="import-file-input"
      />
    </div>
  );
};

export default ImportTab;
