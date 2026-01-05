import React, { useState, useMemo, useCallback } from 'react';
import { 
  X, Search, Trash2, Copy, Check, ChevronDown, ChevronUp, 
  FolderOpen, Server, Globe, Database, Terminal, Monitor, 
  CheckSquare, Square, Minus, Star, RefreshCw
} from 'lucide-react';
import { Connection } from '../types/connection';
import { useConnections } from '../contexts/useConnections';
import { generateId } from '../utils/id';

interface BulkConnectionEditorProps {
  isOpen: boolean;
  onClose: () => void;
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
          className="w-full px-2 py-1 bg-gray-600 border border-blue-500 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          autoFocus
        />
      );
    }

    return (
      <span 
        className={`cursor-text hover:bg-gray-600/50 px-1 py-0.5 rounded transition-colors inline-flex items-center ${className || ''}`}
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
      {/* Glow effect behind the modal */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
        <div className="w-[800px] h-[600px] bg-blue-500/20 rounded-full blur-[120px] animate-pulse" />
      </div>
      
      <div className="relative bg-gray-800/95 backdrop-blur-xl rounded-xl shadow-2xl shadow-blue-500/10 w-full max-w-6xl mx-4 h-[85vh] overflow-hidden flex flex-col border border-gray-700/50">
        {/* Header */}
        <div className="border-b border-gray-700/80 px-5 py-4 flex items-center justify-between bg-gradient-to-r from-gray-800 to-gray-800/80">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <RefreshCw size={18} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                Bulk Connection Editor
              </h2>
              <p className="text-xs text-gray-400">
                {connections.length} connections • Double-click any cell to edit
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="border-b border-gray-700/80 px-4 py-3 flex items-center justify-between gap-4 bg-gray-800/50">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, hostname, protocol, or tag..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
            />
          </div>

          <div className="flex items-center space-x-2">
            <label className="flex items-center space-x-2 text-xs text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
              <input
                type="checkbox"
                checked={showFavoritesFirst}
                onChange={(e) => setShowFavoritesFirst(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-yellow-500 w-3.5 h-3.5"
              />
              <Star size={12} className="text-yellow-400" />
              <span>Favorites first</span>
            </label>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center space-x-2 pl-4 border-l border-gray-700">
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
                className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
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
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-900/95 backdrop-blur-sm text-gray-400 text-xs uppercase z-10">
              <tr className="border-b border-gray-700/50">
                <th className="w-10 px-3 py-3 text-left">
                  <button
                    onClick={toggleSelectAll}
                    className="p-1 hover:bg-gray-700 rounded transition-colors"
                  >
                    {selectionState === 'all' && <CheckSquare size={16} className="text-blue-400" />}
                    {selectionState === 'partial' && <Minus size={16} className="text-blue-400" />}
                    {selectionState === 'none' && <Square size={16} />}
                  </button>
                </th>
                <th className="w-10 px-2 py-3">
                  <button
                    onClick={() => toggleSort('favorite')}
                    className="flex items-center space-x-1 hover:text-white transition-colors"
                  >
                    <Star size={12} />
                    <SortIcon field="favorite" />
                  </button>
                </th>
                <th 
                  className="px-3 py-3 text-left cursor-pointer hover:text-white transition-colors"
                  onClick={() => toggleSort('name')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Name</span>
                    <SortIcon field="name" />
                  </div>
                </th>
                <th 
                  className="w-28 px-3 py-3 text-left cursor-pointer hover:text-white transition-colors"
                  onClick={() => toggleSort('protocol')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Protocol</span>
                    <SortIcon field="protocol" />
                  </div>
                </th>
                <th 
                  className="px-3 py-3 text-left cursor-pointer hover:text-white transition-colors"
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
            <tbody className="divide-y divide-gray-700/30">
              {filteredConnections.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-gray-400">
                    <div className="flex flex-col items-center space-y-2">
                      <Search size={32} className="text-gray-600" />
                      <span>{searchTerm ? 'No connections match your search' : 'No connections found'}</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredConnections.map((connection) => (
                  <tr 
                    key={connection.id}
                    className={`hover:bg-gray-700/30 transition-colors group ${
                      selectedIds.has(connection.id) ? 'bg-blue-500/10' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => toggleSelect(connection.id)}
                        className="p-1 hover:bg-gray-600 rounded transition-colors"
                      >
                        {selectedIds.has(connection.id) ? (
                          <CheckSquare size={16} className="text-blue-400" />
                        ) : (
                          <Square size={16} className="text-gray-500 group-hover:text-gray-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        onClick={() => toggleFavorite(connection)}
                        className={`p-1 rounded transition-all ${
                          connection.favorite 
                            ? 'text-yellow-400 hover:text-yellow-300' 
                            : 'text-gray-600 hover:text-yellow-400'
                        }`}
                      >
                        <Star size={14} fill={connection.favorite ? 'currentColor' : 'none'} />
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      {renderEditableCell(connection, 'name', connection.name, 'text-white font-medium')}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center space-x-1.5">
                        {protocolIcons[connection.protocol] || <Server size={14} />}
                        <span className="text-gray-300 uppercase text-xs font-medium">{connection.protocol}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {renderEditableCell(connection, 'hostname', connection.hostname, 'text-gray-300')}
                    </td>
                    <td className="px-3 py-2.5">
                      {renderEditableCell(connection, 'port', connection.port, 'text-gray-400 font-mono')}
                    </td>
                    <td className="px-3 py-2.5">
                      {renderEditableCell(connection, 'username', connection.username, 'text-gray-400')}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => duplicateConnection(connection)}
                          className="p-1.5 hover:bg-gray-600 rounded-lg text-gray-400 hover:text-white transition-colors"
                          title="Duplicate"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={() => deleteConnection(connection.id)}
                          className="p-1.5 hover:bg-red-500/20 rounded-lg text-gray-400 hover:text-red-400 transition-colors"
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
        <div className="border-t border-gray-700/80 px-4 py-3 flex items-center justify-between text-xs bg-gray-800/50">
          <div className="flex items-center space-x-4">
            <span className="text-gray-400">
              Showing <span className="text-white font-medium">{filteredConnections.length}</span> of <span className="text-white font-medium">{connections.length}</span> connections
            </span>
            {filteredConnections.filter(c => c.favorite).length > 0 && (
              <span className="flex items-center space-x-1 text-yellow-400/80">
                <Star size={10} fill="currentColor" />
                <span>{filteredConnections.filter(c => c.favorite).length} favorites</span>
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3 text-gray-500">
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-[10px]">Double-click</kbd> to edit
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-[10px]">Enter</kbd> to save
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-[10px]">Esc</kbd> to close
            </span>
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-20">
            <div className="bg-gray-800 rounded-xl shadow-2xl p-6 max-w-md border border-gray-700">
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2 bg-red-500/20 rounded-lg">
                  <Trash2 size={20} className="text-red-400" />
                </div>
                <h3 className="text-lg font-semibold text-white">Delete Connections</h3>
              </div>
              <p className="text-gray-300 mb-6">
                Are you sure you want to delete <span className="text-red-400 font-medium">{selectedIds.size}</span> selected connection(s)? 
                This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={deleteSelected}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors flex items-center space-x-2"
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
