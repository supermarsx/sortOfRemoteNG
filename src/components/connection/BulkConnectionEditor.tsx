import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  X, Search, Trash2, Copy, Check, ChevronDown, ChevronUp,
  FolderOpen, Server, Globe, Database, Terminal, Monitor,
  CheckSquare, Square, Minus, Star, RefreshCw, Edit3, KeyRound,
} from 'lucide-react';
import { Connection } from '../../types/connection/connection';
import { Modal } from '../ui/overlays/Modal';
import { DialogHeader } from '../ui/overlays/DialogHeader';
import {
  useBulkConnectionEditor,
  type BulkConnectionEditorMgr,
} from '../../hooks/connection/useBulkConnectionEditor';
import { Checkbox } from '../ui/forms';

interface BulkConnectionEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onEditConnection?: (connection: Connection) => void;
}

type EditableField = 'name' | 'hostname' | 'port' | 'username';

const protocolIcons: Record<string, React.ReactNode> = {
  rdp: <Monitor size={14} className="text-primary" />,
  ssh: <Terminal size={14} className="text-success" />,
  vnc: <Server size={14} className="text-primary" />,
  http: <Globe size={14} className="text-warning" />,
  https: <Globe size={14} className="text-warning" />,
  mysql: <Database size={14} className="text-info" />,
  ftp: <FolderOpen size={14} className="text-warning" />,
  sftp: <FolderOpen size={14} className="text-warning" />,
  winrm: <Server size={14} className="text-amber-400" />,
};

// ── Sub-components ─────────────────────────────────────────────────

function BulkEditorHeader({ mgr }: { mgr: BulkConnectionEditorMgr }) {
  return (
    <DialogHeader
      icon={RefreshCw}
      iconColor="text-primary"
      iconBg="bg-primary/20"
      title="Bulk Connection Editor"
      subtitle={`${mgr.connections.length} connections • Double-click any cell to edit`}
      onClose={mgr.onClose}
      className="relative z-10 bg-[var(--color-surface)]"
    />
  );
}

function BulkEditorToolbar({ mgr }: { mgr: BulkConnectionEditorMgr }) {
  const { t } = useTranslation();
  return (
    <div className="relative z-10 border-b border-[var(--color-border)] px-4 py-3 flex items-center justify-between gap-4 bg-[var(--color-surfaceHover)]/50">
      <div className="relative flex-1 max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-textMuted)]" />
        <input
          type="text"
          placeholder="Search by name, hostname, protocol, or tag..."
          value={mgr.searchTerm}
          onChange={(e) => mgr.setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
        />
      </div>

      <div className="flex items-center space-x-2">
        <label className="flex items-center space-x-2 text-xs text-[var(--color-textSecondary)] cursor-pointer hover:text-[var(--color-text)] transition-colors">
          <Checkbox checked={mgr.showFavoritesFirst} onChange={(v: boolean) => mgr.setShowFavoritesFirst(v)} className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-warning w-3.5 h-3.5" />
          <Star size={12} className="text-warning" />
          <span>Favorites first</span>
        </label>
      </div>

      {mgr.selectedIds.size > 0 && (
        <div className="flex items-center space-x-2 pl-4 border-l border-[var(--color-border)]">
          <span className="text-sm text-primary font-medium">{mgr.selectedIds.size} selected</span>
          <button
            onClick={() => mgr.toggleSelectedFavorites(true)}
            className="px-2.5 py-1.5 bg-warning/10 hover:bg-warning/20 text-warning rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
            title="Add to favorites"
            data-testid="bulk-favorite"
          >
            <Star size={12} />
          </button>
          <button
            onClick={() => mgr.duplicateSelected()}
            className="px-2.5 py-1.5 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
            data-testid="bulk-duplicate"
            title={t('connections.clone')}
          >
            <Copy size={12} />
            <span>{t('connections.clone')}</span>
          </button>
          <button
            onClick={() => mgr.duplicateSelected({ includeCredentials: true })}
            className="px-2.5 py-1.5 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
            data-testid="bulk-duplicate-with-credentials"
            title={t('connections.cloneWithCredentials')}
          >
            <KeyRound size={12} />
            <span>{t('connections.cloneWithCredentials')}</span>
          </button>
          <button
            onClick={() => mgr.setShowDeleteConfirm(true)}
            className="px-2.5 py-1.5 bg-error/10 hover:bg-error/20 text-error rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
            data-testid="bulk-delete"
          >
            <Trash2 size={12} />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
}

function SortIcon({ field, mgr }: { field: string; mgr: BulkConnectionEditorMgr }) {
  if (mgr.sortField !== field) return null;
  return mgr.sortDirection === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
}

function EditableCell({
  connection,
  field,
  value,
  className,
  mgr,
}: {
  connection: Connection;
  field: EditableField;
  value: string | number | undefined;
  className?: string;
  mgr: BulkConnectionEditorMgr;
}) {
  const isEditing = mgr.editingCell?.id === connection.id && mgr.editingCell?.field === field;

  if (isEditing) {
    return (
      <input
        type={field === 'port' ? 'number' : 'text'}
        value={mgr.editValue}
        onChange={(e) => mgr.setEditValue(e.target.value)}
        onBlur={mgr.saveEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); mgr.saveEdit(); }
          if (e.key === 'Escape') { e.preventDefault(); mgr.cancelEdit(); }
        }}
        className="sor-form-input-sm"
        autoFocus
      />
    );
  }

  return (
    <span
      className={`cursor-text hover:bg-[var(--color-surfaceHover)]/50 px-1 py-0.5 rounded transition-colors inline-flex items-center ${className || ''}`}
      onDoubleClick={() => mgr.handleDoubleClick(connection.id, field, value)}
      title="Double-click to edit"
    >
      {field === 'name' && connection.colorTag && (
        <span
          className="inline-block w-2 h-2 rounded-full mr-2 flex-shrink-0"
          style={{ backgroundColor: connection.colorTag }}
        />
      )}
      {value || (field === 'username' ? '-' : '')}
    </span>
  );
}

function ConnectionRow({
  connection,
  mgr,
}: {
  connection: Connection;
  mgr: BulkConnectionEditorMgr;
}) {
  const { t } = useTranslation();
  return (
    <tr
      className={`hover:bg-[var(--color-surfaceHover)]/30 transition-colors group ${
        mgr.selectedIds.has(connection.id) ? 'bg-primary/10' : ''
      }`}
    >
      <td className="px-3 py-2.5">
        <button
          onClick={() => mgr.toggleSelect(connection.id)}
          className="p-1 hover:bg-[var(--color-surfaceHover)] rounded transition-colors"
        >
          {mgr.selectedIds.has(connection.id) ? (
            <CheckSquare size={16} className="text-primary" />
          ) : (
            <Square size={16} className="text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
          )}
        </button>
      </td>
      <td className="px-2 py-2.5">
        <button
          onClick={() => mgr.toggleFavorite(connection)}
          className={`p-1 rounded transition-all ${
            connection.favorite
              ? 'text-warning hover:text-warning/80'
              : 'text-[var(--color-textMuted)] hover:text-warning'
          }`}
        >
          <Star size={14} fill={connection.favorite ? 'currentColor' : 'none'} />
        </button>
      </td>
      <td className="px-3 py-2.5">
        <EditableCell connection={connection} field="name" value={connection.name} className="text-[var(--color-text)] font-medium" mgr={mgr} />
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center space-x-1.5">
          {protocolIcons[connection.protocol] || <Server size={14} />}
          <span className="text-[var(--color-textSecondary)] uppercase text-xs font-medium">{connection.protocol}</span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <EditableCell connection={connection} field="hostname" value={connection.hostname} className="text-[var(--color-textSecondary)]" mgr={mgr} />
      </td>
      <td className="px-3 py-2.5">
        <EditableCell connection={connection} field="port" value={connection.port} className="text-[var(--color-textMuted)] font-mono" mgr={mgr} />
      </td>
      <td className="px-3 py-2.5">
        <EditableCell connection={connection} field="username" value={connection.username} className="text-[var(--color-textMuted)]" mgr={mgr} />
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {mgr.hasEditConnection && (
            <button
              onClick={() => mgr.handleEditInFullEditor(connection)}
              className="p-1.5 hover:bg-primary/20 rounded-lg text-[var(--color-textMuted)] hover:text-primary transition-colors"
              title="Edit in full editor"
            >
              <Edit3 size={14} />
            </button>
          )}
          <button
            onClick={() => mgr.duplicateConnection(connection)}
            className="p-1.5 hover:bg-[var(--color-surfaceHover)] rounded-lg text-[var(--color-textMuted)] hover:text-[var(--color-text)] transition-colors"
            title={t('connections.clone')}
            data-testid="row-clone"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={() => mgr.duplicateConnection(connection, { includeCredentials: true })}
            className="p-1.5 hover:bg-[var(--color-surfaceHover)] rounded-lg text-[var(--color-textMuted)] hover:text-[var(--color-text)] transition-colors"
            title={t('connections.cloneWithCredentials')}
            data-testid="row-clone-with-credentials"
          >
            <KeyRound size={14} />
          </button>
          <button
            onClick={() => mgr.deleteConnection(connection.id)}
            className="p-1.5 hover:bg-error/20 rounded-lg text-[var(--color-textMuted)] hover:text-error transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function ConnectionTable({ mgr }: { mgr: BulkConnectionEditorMgr }) {
  const ariaSortFor = (
    field: 'name' | 'protocol' | 'hostname' | 'favorite',
  ): React.AriaAttributes['aria-sort'] => {
    if (mgr.sortField !== field) return 'none';
    return mgr.sortDirection === 'asc' ? 'ascending' : 'descending';
  };

  const renderSortableHeader = (
    label: React.ReactNode,
    field: 'name' | 'protocol' | 'hostname' | 'favorite',
    className: string,
    buttonClassName = 'flex w-full items-center space-x-1 text-left hover:text-[var(--color-text)] transition-colors',
    ariaLabel?: string,
  ) => (
    <th className={className} aria-sort={ariaSortFor(field)}>
      <button
        type="button"
        onClick={() => mgr.toggleSort(field)}
        className={buttonClassName}
        aria-label={ariaLabel}
      >
        {label}
        <SortIcon field={field} mgr={mgr} />
      </button>
    </th>
  );

  return (
    <div className="relative z-10 flex-1 overflow-auto bg-[var(--color-surface)]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[var(--color-surface)] text-[var(--color-textSecondary)] text-xs uppercase z-10">
          <tr className="border-b border-[var(--color-border)]">
            <th className="w-10 px-3 py-3 text-left">
              <button
                onClick={mgr.toggleSelectAll}
                className="p-1 hover:bg-[var(--color-surfaceHover)] rounded transition-colors"
                aria-label={
                  mgr.selectionState === 'all'
                    ? 'Clear current selection'
                    : 'Select all visible connections'
                }
              >
                {mgr.selectionState === 'all' && <CheckSquare size={16} className="text-primary" />}
                {mgr.selectionState === 'partial' && <Minus size={16} className="text-primary" />}
                {mgr.selectionState === 'none' && <Square size={16} />}
              </button>
            </th>
            {renderSortableHeader(
              <Star size={12} />,
              'favorite',
              'w-10 px-2 py-3',
              'flex items-center space-x-1 hover:text-[var(--color-text)] transition-colors',
              'Sort by favorite status',
            )}
            {renderSortableHeader(<span>Name</span>, 'name', 'px-3 py-3 text-left')}
            {renderSortableHeader(<span>Protocol</span>, 'protocol', 'w-28 px-3 py-3 text-left')}
            {renderSortableHeader(<span>Hostname</span>, 'hostname', 'px-3 py-3 text-left')}
            <th className="w-20 px-3 py-3 text-left">Port</th>
            <th className="px-3 py-3 text-left">Username</th>
            <th className="w-24 px-3 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]/30">
          {mgr.filteredConnections.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-16 text-center text-[var(--color-textSecondary)]">
                <div className="flex flex-col items-center space-y-2">
                  <Search size={32} className="text-[var(--color-textMuted)]" />
                  <span>{mgr.searchTerm ? 'No connections match your search' : 'No connections found'}</span>
                </div>
              </td>
            </tr>
          ) : (
            mgr.filteredConnections.map((connection) => (
              <ConnectionRow key={connection.id} connection={connection} mgr={mgr} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function BulkEditorFooter({ mgr }: { mgr: BulkConnectionEditorMgr }) {
  return (
    <div className="border-t border-[var(--color-border)] px-4 py-3 flex items-center justify-between text-xs bg-[var(--color-surfaceHover)]/50">
      <div className="flex items-center space-x-4">
        <span className="text-[var(--color-textSecondary)]">
          Showing{' '}
          <span className="text-[var(--color-text)] font-medium">{mgr.filteredConnections.length}</span> of{' '}
          <span className="text-[var(--color-text)] font-medium">{mgr.connections.length}</span> connections
        </span>
        {mgr.filteredConnections.filter((c) => c.favorite).length > 0 && (
          <span className="flex items-center space-x-1 text-warning/80">
            <Star size={10} fill="currentColor" />
            <span>{mgr.filteredConnections.filter((c) => c.favorite).length} favorites</span>
          </span>
        )}
      </div>
      <div className="flex items-center space-x-3 text-[var(--color-textMuted)]">
        <span>
          <kbd className="px-1.5 py-0.5 bg-[var(--color-surfaceHover)] rounded text-[10px]">Double-click</kbd> to edit
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-[var(--color-surfaceHover)] rounded text-[10px]">Enter</kbd> to save
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 bg-[var(--color-surfaceHover)] rounded text-[10px]">Esc</kbd> to close
        </span>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({ mgr }: { mgr: BulkConnectionEditorMgr }) {
  if (!mgr.showDeleteConfirm) return null;
  return (
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-20">
      <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl p-6 max-w-md border border-[var(--color-border)]">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2 bg-error/20 rounded-lg">
            <Trash2 size={20} className="text-error" />
          </div>
          <h3 className="text-lg font-semibold text-[var(--color-text)]">Delete Connections</h3>
        </div>
        <p className="text-[var(--color-textSecondary)] mb-6">
          Are you sure you want to delete{' '}
          <span className="text-error font-medium">{mgr.selectedIds.size}</span> selected
          connection(s)? This action cannot be undone.
        </p>
        <div className="flex justify-end space-x-3">
          <button
            onClick={() => mgr.setShowDeleteConfirm(false)}
            className="px-4 py-2 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={mgr.deleteSelected}
            className="px-4 py-2 bg-error hover:bg-error/80 text-[var(--color-text)] rounded-lg transition-colors flex items-center space-x-2"
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Root component ─────────────────────────────────────────────────

export const BulkConnectionEditor: React.FC<BulkConnectionEditorProps> = ({
  isOpen,
  onClose,
  onEditConnection,
}) => {
  const mgr = useBulkConnectionEditor(isOpen, onClose, onEditConnection);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEscape={false}
      backdropClassName="bg-black/60 backdrop-blur-sm"
      panelClassName="relative max-w-6xl rounded-xl border border-[var(--color-border)] shadow-2xl shadow-primary/10 h-[85vh] overflow-hidden"
      contentClassName="relative bg-[var(--color-surface)]"
      dataTestId="bulk-editor"
    >
      <div className="relative flex flex-1 min-h-0 flex-col">
        {/* Scattered glow effect */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute w-[300px] h-[200px] bg-primary/[0.08] rounded-full blur-[100px] top-[15%] left-[10%]" />
          <div className="absolute w-[250px] h-[250px] bg-info/[0.06] rounded-full blur-[120px] top-[40%] left-[35%]" />
          <div className="absolute w-[280px] h-[180px] bg-primary/[0.06] rounded-full blur-[100px] top-[60%] right-[15%]" />
          <div className="absolute w-[200px] h-[200px] bg-primary/[0.05] rounded-full blur-[80px] top-[25%] right-[25%]" />
        </div>

        <BulkEditorHeader mgr={mgr} />
        <BulkEditorToolbar mgr={mgr} />
        <ConnectionTable mgr={mgr} />
        <BulkEditorFooter mgr={mgr} />
        <DeleteConfirmDialog mgr={mgr} />
      </div>
    </Modal>
  );
};
