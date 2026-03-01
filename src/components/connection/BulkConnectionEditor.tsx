import React from 'react';
import {
  X, Search, Trash2, Copy, Check, ChevronDown, ChevronUp,
  FolderOpen, Server, Globe, Database, Terminal, Monitor,
  CheckSquare, Square, Minus, Star, RefreshCw, Edit3,
} from 'lucide-react';
import { Connection } from '../../types/connection';
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
  rdp: <Monitor size={14} className="text-blue-400" />,
  ssh: <Terminal size={14} className="text-green-400" />,
  vnc: <Server size={14} className="text-purple-400" />,
  http: <Globe size={14} className="text-orange-400" />,
  https: <Globe size={14} className="text-orange-400" />,
  mysql: <Database size={14} className="text-cyan-400" />,
  ftp: <FolderOpen size={14} className="text-yellow-400" />,
  sftp: <FolderOpen size={14} className="text-yellow-400" />,
};

// ── Sub-components ─────────────────────────────────────────────────

function BulkEditorHeader({ mgr }: { mgr: BulkConnectionEditorMgr }) {
  return (
    <DialogHeader
      icon={RefreshCw}
      iconColor="text-blue-500"
      iconBg="bg-blue-500/20"
      title="Bulk Connection Editor"
      subtitle={`${mgr.connections.length} connections • Double-click any cell to edit`}
      onClose={mgr.onClose}
      className="relative z-10 bg-[var(--color-surface)]"
    />
  );
}

function BulkEditorToolbar({ mgr }: { mgr: BulkConnectionEditorMgr }) {
  return (
    <div className="relative z-10 border-b border-[var(--color-border)] px-4 py-3 flex items-center justify-between gap-4 bg-[var(--color-surfaceHover)]/50">
      <div className="relative flex-1 max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-textMuted)]" />
        <input
          type="text"
          placeholder="Search by name, hostname, protocol, or tag..."
          value={mgr.searchTerm}
          onChange={(e) => mgr.setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
        />
      </div>

      <div className="flex items-center space-x-2">
        <label className="flex items-center space-x-2 text-xs text-[var(--color-textSecondary)] cursor-pointer hover:text-[var(--color-text)] transition-colors">
          <Checkbox checked={mgr.showFavoritesFirst} onChange={(v: boolean) => mgr.setShowFavoritesFirst(v)} className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-yellow-500 w-3.5 h-3.5" />
          <Star size={12} className="text-yellow-400" />
          <span>Favorites first</span>
        </label>
      </div>

      {mgr.selectedIds.size > 0 && (
        <div className="flex items-center space-x-2 pl-4 border-l border-[var(--color-border)]">
          <span className="text-sm text-blue-400 font-medium">{mgr.selectedIds.size} selected</span>
          <button
            onClick={() => mgr.toggleSelectedFavorites(true)}
            className="px-2.5 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
            title="Add to favorites"
          >
            <Star size={12} />
          </button>
          <button
            onClick={mgr.duplicateSelected}
            className="px-2.5 py-1.5 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
          >
            <Copy size={12} />
            <span>Duplicate</span>
          </button>
          <button
            onClick={() => mgr.setShowDeleteConfirm(true)}
            className="px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
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
        className="w-full px-2 py-1 bg-[var(--color-input)] border border-blue-500 rounded text-[var(--color-text)] text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
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
  return (
    <tr
      className={`hover:bg-[var(--color-surfaceHover)]/30 transition-colors group ${
        mgr.selectedIds.has(connection.id) ? 'bg-blue-500/10' : ''
      }`}
    >
      <td className="px-3 py-2.5">
        <button
          onClick={() => mgr.toggleSelect(connection.id)}
          className="p-1 hover:bg-[var(--color-surfaceHover)] rounded transition-colors"
        >
          {mgr.selectedIds.has(connection.id) ? (
            <CheckSquare size={16} className="text-blue-500" />
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
              ? 'text-yellow-400 hover:text-yellow-300'
              : 'text-[var(--color-textMuted)] hover:text-yellow-400'
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
              className="p-1.5 hover:bg-blue-500/20 rounded-lg text-[var(--color-textMuted)] hover:text-blue-500 transition-colors"
              title="Edit in full editor"
            >
              <Edit3 size={14} />
            </button>
          )}
          <button
            onClick={() => mgr.duplicateConnection(connection)}
            className="p-1.5 hover:bg-[var(--color-surfaceHover)] rounded-lg text-[var(--color-textMuted)] hover:text-[var(--color-text)] transition-colors"
            title="Duplicate"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={() => mgr.deleteConnection(connection.id)}
            className="p-1.5 hover:bg-red-500/20 rounded-lg text-[var(--color-textMuted)] hover:text-red-500 transition-colors"
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
  return (
    <div className="relative z-10 flex-1 overflow-auto bg-[var(--color-surface)]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[var(--color-surface)] text-[var(--color-textSecondary)] text-xs uppercase z-10">
          <tr className="border-b border-[var(--color-border)]">
            <th className="w-10 px-3 py-3 text-left">
              <button
                onClick={mgr.toggleSelectAll}
                className="p-1 hover:bg-[var(--color-surfaceHover)] rounded transition-colors"
              >
                {mgr.selectionState === 'all' && <CheckSquare size={16} className="text-blue-500" />}
                {mgr.selectionState === 'partial' && <Minus size={16} className="text-blue-500" />}
                {mgr.selectionState === 'none' && <Square size={16} />}
              </button>
            </th>
            <th className="w-10 px-2 py-3">
              <button
                onClick={() => mgr.toggleSort('favorite')}
                className="flex items-center space-x-1 hover:text-[var(--color-text)] transition-colors"
              >
                <Star size={12} />
                <SortIcon field="favorite" mgr={mgr} />
              </button>
            </th>
            <th className="px-3 py-3 text-left cursor-pointer hover:text-[var(--color-text)] transition-colors" onClick={() => mgr.toggleSort('name')}>
              <div className="flex items-center space-x-1">
                <span>Name</span>
                <SortIcon field="name" mgr={mgr} />
              </div>
            </th>
            <th className="w-28 px-3 py-3 text-left cursor-pointer hover:text-[var(--color-text)] transition-colors" onClick={() => mgr.toggleSort('protocol')}>
              <div className="flex items-center space-x-1">
                <span>Protocol</span>
                <SortIcon field="protocol" mgr={mgr} />
              </div>
            </th>
            <th className="px-3 py-3 text-left cursor-pointer hover:text-[var(--color-text)] transition-colors" onClick={() => mgr.toggleSort('hostname')}>
              <div className="flex items-center space-x-1">
                <span>Hostname</span>
                <SortIcon field="hostname" mgr={mgr} />
              </div>
            </th>
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
          <span className="flex items-center space-x-1 text-yellow-500/80">
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
          <div className="p-2 bg-red-500/20 rounded-lg">
            <Trash2 size={20} className="text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-[var(--color-text)]">Delete Connections</h3>
        </div>
        <p className="text-[var(--color-textSecondary)] mb-6">
          Are you sure you want to delete{' '}
          <span className="text-red-500 font-medium">{mgr.selectedIds.size}</span> selected
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
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-[var(--color-text)] rounded-lg transition-colors flex items-center space-x-2"
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
      panelClassName="relative max-w-6xl rounded-xl border border-[var(--color-border)] shadow-2xl shadow-blue-500/10 h-[85vh] overflow-hidden"
      contentClassName="relative bg-[var(--color-surface)]"
    >
      <div className="relative flex flex-1 min-h-0 flex-col">
        {/* Scattered glow effect */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute w-[300px] h-[200px] bg-blue-500/8 rounded-full blur-[100px] top-[15%] left-[10%]" />
          <div className="absolute w-[250px] h-[250px] bg-cyan-500/6 rounded-full blur-[120px] top-[40%] left-[35%]" />
          <div className="absolute w-[280px] h-[180px] bg-indigo-500/6 rounded-full blur-[100px] top-[60%] right-[15%]" />
          <div className="absolute w-[200px] h-[200px] bg-blue-400/5 rounded-full blur-[80px] top-[25%] right-[25%]" />
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
