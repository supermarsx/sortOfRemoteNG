import React, { useState, useMemo, useCallback } from 'react';
import { 
  X, Search, Trash2, Copy, Check, ChevronDown, ChevronUp, 
  FolderOpen, Server, Globe, Database, Terminal, Monitor, 
  CheckSquare, Square, Minus, Star, RefreshCw, Edit3
} from 'lucide-react';
import { Connection } from '../types/connection';
import { useConnections } from '../contexts/useConnections';
import { generateId } from '../utils/id';

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

export const BulkConnectionEditor: React.FC<BulkConnectionEditorProps> = ({
  isOpen,
  onClose,
  onEditConnection,
}) => {
  const { state, dispatch } = useConnections();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ id: string; field: EditableField } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [sortField, setSortField] = useState<'name' | 'protocol' | 'hostname' | 'favorite'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFavoritesFirst, setShowFavoritesFirst] = useState(true);

  // Filter only non-group connections
  const connections = useMemo(() => {
    return state.connections.filter(c => !c.isGroup);
  }, [state.connections]);

  // Filter and sort connections
  const filteredConnections = useMemo(() => {
    const result = connections.filter(c => {
      const searchLower = searchTerm.toLowerCase();
      return (
        c.name.toLowerCase().includes(searchLower) ||
        c.hostname.toLowerCase().includes(searchLower) ||
        c.protocol.toLowerCase().includes(searchLower) ||
        (c.tags || []).some(tag => tag.toLowerCase().includes(searchLower))
      );
    });

    result.sort((a, b) => {
      // Always sort favorites first if enabled
      if (showFavoritesFirst) {
        if (a.favorite && !b.favorite) return -1;
        if (!a.favorite && b.favorite) return 1;
      }
      
      if (sortField === 'favorite') {
        const aFav = a.favorite ? 1 : 0;
        const bFav = b.favorite ? 1 : 0;
        return sortDirection === 'asc' ? bFav - aFav : aFav - bFav;
      }
      
      const aVal = a[sortField] || '';
      const bVal = b[sortField] || '';
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return [...result];
  }, [connections, searchTerm, sortField, sortDirection, showFavoritesFirst]);

  const toggleSort = (field: 'name' | 'protocol' | 'hostname' | 'favorite') => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredConnections.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredConnections.map(c => c.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const saveEdit = useCallback(() => {
    if (!editingCell) return;
    const connection = connections.find(c => c.id === editingCell.id);
    if (!connection) return;

    const updates: Partial<Connection> = {
      updatedAt: new Date(),
    };

    if (editingCell.field === 'port') {
      updates.port = parseInt(editValue) || connection.port;
    } else {
      updates[editingCell.field] = editValue;
    }

    dispatch({
      type: 'UPDATE_CONNECTION',
      payload: { ...connection, ...updates },
    });
    setEditingCell(null);
    setEditValue('');
  }, [editingCell, editValue, connections, dispatch]);

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const toggleFavorite = (connection: Connection) => {
    dispatch({
      type: 'UPDATE_CONNECTION',
      payload: { ...connection, favorite: !connection.favorite, updatedAt: new Date() },
    });
  };

  const toggleSelectedFavorites = (favorite: boolean) => {
    selectedIds.forEach(id => {
      const connection = connections.find(c => c.id === id);
      if (connection) {
        dispatch({
          type: 'UPDATE_CONNECTION',
          payload: { ...connection, favorite, updatedAt: new Date() },
        });
      }
    });
  };

  const duplicateConnection = (connection: Connection) => {
    const newConnection: Connection = {
      ...connection,
      id: generateId(),
      name: `${connection.name} (Copy)`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    dispatch({ type: 'ADD_CONNECTION', payload: newConnection });
  };

  const duplicateSelected = () => {
    selectedIds.forEach(id => {
      const connection = connections.find(c => c.id === id);
      if (connection) {
        duplicateConnection(connection);
      }
    });
    setSelectedIds(new Set());
  };

  const deleteConnection = (id: string) => {
    const connection = connections.find(c => c.id === id);
    if (connection) {
      dispatch({ type: 'DELETE_CONNECTION', payload: id });
    }
  };

  const deleteSelected = () => {
    selectedIds.forEach(id => deleteConnection(id));
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
  };

  const selectionState = useMemo(() => {
    if (selectedIds.size === 0) return 'none';
    if (selectedIds.size === filteredConnections.length) return 'all';
    return 'partial';
  }, [selectedIds.size, filteredConnections.length]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      if (editingCell) {
        cancelEdit();
      } else {
        onClose();
      }
    }
    if (e.key === 'Enter' && editingCell) {
      saveEdit();
    }
    if (e.key === 'Tab' && editingCell) {
      e.preventDefault();
      saveEdit();
    }
  }, [isOpen, editingCell, onClose, saveEdit]);

  React.useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleDoubleClick = (connectionId: string, field: EditableField, currentValue: string | number | undefined) => {
    setEditingCell({ id: connectionId, field });
    setEditValue(String(currentValue || ''));
  };

  const renderEditableCell = (
    connection: Connection, 
    field: EditableField, 
    value: string | number | undefined,
    className?: string
  ) => {
    const isEditing = editingCell?.id === connection.id && editingCell?.field === field;
    
    if (isEditing) {
      return (
        <input
          type={field === 'port' ? 'number' : 'text'}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveEdit}
          className="w-full px-2 py-1 bg-[var(--color-input)] border border-blue-500 rounded text-[var(--color-text)] text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          autoFocus
        />
      );
    }

    return (
      <span 
        className={`cursor-text hover:bg-[var(--color-surfaceHover)]/50 px-1 py-0.5 rounded transition-colors inline-flex items-center ${className || ''}`}
        onDoubleClick={() => handleDoubleClick(connection.id, field, value)}
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
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative bg-[var(--color-surface)] rounded-xl shadow-2xl shadow-blue-500/10 w-full max-w-6xl mx-4 h-[85vh] overflow-hidden flex flex-col border border-[var(--color-border)]">
        {/* Scattered glow effect across the background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute w-[300px] h-[200px] bg-blue-500/8 rounded-full blur-[100px] top-[15%] left-[10%]" />
          <div className="absolute w-[250px] h-[250px] bg-cyan-500/6 rounded-full blur-[120px] top-[40%] left-[35%]" />
          <div className="absolute w-[280px] h-[180px] bg-indigo-500/6 rounded-full blur-[100px] top-[60%] right-[15%]" />
          <div className="absolute w-[200px] h-[200px] bg-blue-400/5 rounded-full blur-[80px] top-[25%] right-[25%]" />
        </div>
        {/* Header */}
        <div className="relative z-10 border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <RefreshCw size={18} className="text-blue-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                Bulk Connection Editor
              </h2>
              <p className="text-xs text-[var(--color-textSecondary)]">
                {connections.length} connections • Double-click any cell to edit
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="relative z-10 border-b border-[var(--color-border)] px-4 py-3 flex items-center justify-between gap-4 bg-[var(--color-surfaceHover)]/50">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-textMuted)]" />
            <input
              type="text"
              placeholder="Search by name, hostname, protocol, or tag..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
            />
          </div>

          <div className="flex items-center space-x-2">
            <label className="flex items-center space-x-2 text-xs text-[var(--color-textSecondary)] cursor-pointer hover:text-[var(--color-text)] transition-colors">
              <input
                type="checkbox"
                checked={showFavoritesFirst}
                onChange={(e) => setShowFavoritesFirst(e.target.checked)}
                className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-yellow-500 w-3.5 h-3.5"
              />
              <Star size={12} className="text-yellow-400" />
              <span>Favorites first</span>
            </label>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center space-x-2 pl-4 border-l border-[var(--color-border)]">
              <span className="text-sm text-blue-400 font-medium">
                {selectedIds.size} selected
              </span>
              <button
                onClick={() => toggleSelectedFavorites(true)}
                className="px-2.5 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
                title="Add to favorites"
              >
                <Star size={12} />
              </button>
              <button
                onClick={duplicateSelected}
                className="px-2.5 py-1.5 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
              >
                <Copy size={12} />
                <span>Duplicate</span>
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
              >
                <Trash2 size={12} />
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="relative z-10 flex-1 overflow-auto bg-[var(--color-surface)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--color-surface)] text-[var(--color-textSecondary)] text-xs uppercase z-10">
              <tr className="border-b border-[var(--color-border)]">
                <th className="w-10 px-3 py-3 text-left">
                  <button
                    onClick={toggleSelectAll}
                    className="p-1 hover:bg-[var(--color-surfaceHover)] rounded transition-colors"
                  >
                    {selectionState === 'all' && <CheckSquare size={16} className="text-blue-500" />}
                    {selectionState === 'partial' && <Minus size={16} className="text-blue-500" />}
                    {selectionState === 'none' && <Square size={16} />}
                  </button>
                </th>
                <th className="w-10 px-2 py-3">
                  <button
                    onClick={() => toggleSort('favorite')}
                    className="flex items-center space-x-1 hover:text-[var(--color-text)] transition-colors"
                  >
                    <Star size={12} />
                    <SortIcon field="favorite" />
                  </button>
                </th>
                <th 
                  className="px-3 py-3 text-left cursor-pointer hover:text-[var(--color-text)] transition-colors"
                  onClick={() => toggleSort('name')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Name</span>
                    <SortIcon field="name" />
                  </div>
                </th>
                <th 
                  className="w-28 px-3 py-3 text-left cursor-pointer hover:text-[var(--color-text)] transition-colors"
                  onClick={() => toggleSort('protocol')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Protocol</span>
                    <SortIcon field="protocol" />
                  </div>
                </th>
                <th 
                  className="px-3 py-3 text-left cursor-pointer hover:text-[var(--color-text)] transition-colors"
                  onClick={() => toggleSort('hostname')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Hostname</span>
                    <SortIcon field="hostname" />
                  </div>
                </th>
                <th className="w-20 px-3 py-3 text-left">Port</th>
                <th className="px-3 py-3 text-left">Username</th>
                <th className="w-24 px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]/30">
              {filteredConnections.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-[var(--color-textSecondary)]">
                    <div className="flex flex-col items-center space-y-2">
                      <Search size={32} className="text-[var(--color-textMuted)]" />
                      <span>{searchTerm ? 'No connections match your search' : 'No connections found'}</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredConnections.map((connection) => (
                  <tr 
                    key={connection.id}
                    className={`hover:bg-[var(--color-surfaceHover)]/30 transition-colors group ${
                      selectedIds.has(connection.id) ? 'bg-blue-500/10' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => toggleSelect(connection.id)}
                        className="p-1 hover:bg-[var(--color-surfaceHover)] rounded transition-colors"
                      >
                        {selectedIds.has(connection.id) ? (
                          <CheckSquare size={16} className="text-blue-500" />
                        ) : (
                          <Square size={16} className="text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
                        )}
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        onClick={() => toggleFavorite(connection)}
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
                      {renderEditableCell(connection, 'name', connection.name, 'text-[var(--color-text)] font-medium')}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center space-x-1.5">
                        {protocolIcons[connection.protocol] || <Server size={14} />}
                        <span className="text-[var(--color-textSecondary)] uppercase text-xs font-medium">{connection.protocol}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {renderEditableCell(connection, 'hostname', connection.hostname, 'text-[var(--color-textSecondary)]')}
                    </td>
                    <td className="px-3 py-2.5">
                      {renderEditableCell(connection, 'port', connection.port, 'text-[var(--color-textMuted)] font-mono')}
                    </td>
                    <td className="px-3 py-2.5">
                      {renderEditableCell(connection, 'username', connection.username, 'text-[var(--color-textMuted)]')}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {onEditConnection && (
                          <button
                            onClick={() => {
                              onEditConnection(connection);
                              onClose();
                            }}
                            className="p-1.5 hover:bg-blue-500/20 rounded-lg text-[var(--color-textMuted)] hover:text-blue-500 transition-colors"
                            title="Edit in full editor"
                          >
                            <Edit3 size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => duplicateConnection(connection)}
                          className="p-1.5 hover:bg-[var(--color-surfaceHover)] rounded-lg text-[var(--color-textMuted)] hover:text-[var(--color-text)] transition-colors"
                          title="Duplicate"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={() => deleteConnection(connection.id)}
                          className="p-1.5 hover:bg-red-500/20 rounded-lg text-[var(--color-textMuted)] hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--color-border)] px-4 py-3 flex items-center justify-between text-xs bg-[var(--color-surfaceHover)]/50">
          <div className="flex items-center space-x-4">
            <span className="text-[var(--color-textSecondary)]">
              Showing <span className="text-[var(--color-text)] font-medium">{filteredConnections.length}</span> of <span className="text-[var(--color-text)] font-medium">{connections.length}</span> connections
            </span>
            {filteredConnections.filter(c => c.favorite).length > 0 && (
              <span className="flex items-center space-x-1 text-yellow-500/80">
                <Star size={10} fill="currentColor" />
                <span>{filteredConnections.filter(c => c.favorite).length} favorites</span>
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

        {/* Delete Confirmation Dialog */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-20">
            <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl p-6 max-w-md border border-[var(--color-border)]">
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2 bg-red-500/20 rounded-lg">
                  <Trash2 size={20} className="text-red-500" />
                </div>
                <h3 className="text-lg font-semibold text-[var(--color-text)]">Delete Connections</h3>
              </div>
              <p className="text-[var(--color-textSecondary)] mb-6">
                Are you sure you want to delete <span className="text-red-500 font-medium">{selectedIds.size}</span> selected connection(s)? 
                This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteSelected}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-[var(--color-text)] rounded-lg transition-colors flex items-center space-x-2"
                >
                  <Trash2 size={14} />
                  <span>Delete</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
