import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Connection } from '../../types/connection';
import { useConnections } from '../../contexts/useConnections';
import { generateId } from '../../utils/id';

type EditableField = 'name' | 'hostname' | 'port' | 'username';

export function useBulkConnectionEditor(
  isOpen: boolean,
  onClose: () => void,
  onEditConnection?: (connection: Connection) => void,
) {
  const { state, dispatch } = useConnections();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ id: string; field: EditableField } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [sortField, setSortField] = useState<'name' | 'protocol' | 'hostname' | 'favorite'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFavoritesFirst, setShowFavoritesFirst] = useState(true);

  // Non-group connections
  const connections = useMemo(() => {
    return state.connections.filter((c) => !c.isGroup);
  }, [state.connections]);

  // Filter and sort
  const filteredConnections = useMemo(() => {
    const result = connections.filter((c) => {
      const searchLower = searchTerm.toLowerCase();
      return (
        c.name.toLowerCase().includes(searchLower) ||
        c.hostname.toLowerCase().includes(searchLower) ||
        c.protocol.toLowerCase().includes(searchLower) ||
        (c.tags || []).some((tag) => tag.toLowerCase().includes(searchLower))
      );
    });

    result.sort((a, b) => {
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

  const selectionState = useMemo(() => {
    if (selectedIds.size === 0) return 'none' as const;
    if (selectedIds.size === filteredConnections.length) return 'all' as const;
    return 'partial' as const;
  }, [selectedIds.size, filteredConnections.length]);

  // Sort
  const toggleSort = useCallback(
    (field: 'name' | 'protocol' | 'hostname' | 'favorite') => {
      if (sortField === field) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDirection('asc');
      }
    },
    [sortField],
  );

  // Selection
  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredConnections.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredConnections.map((c) => c.id)));
    }
  }, [selectedIds.size, filteredConnections]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  }, []);

  // Inline editing
  const saveEdit = useCallback(() => {
    if (!editingCell) return;
    const connection = connections.find((c) => c.id === editingCell.id);
    if (!connection) return;

    const updates: Partial<Connection> = { updatedAt: new Date() };
    if (editingCell.field === 'port') {
      updates.port = parseInt(editValue) || connection.port;
    } else {
      updates[editingCell.field] = editValue;
    }

    dispatch({ type: 'UPDATE_CONNECTION', payload: { ...connection, ...updates } });
    setEditingCell(null);
    setEditValue('');
  }, [editingCell, editValue, connections, dispatch]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const handleDoubleClick = useCallback(
    (connectionId: string, field: EditableField, currentValue: string | number | undefined) => {
      setEditingCell({ id: connectionId, field });
      setEditValue(String(currentValue || ''));
    },
    [],
  );

  // Favorites
  const toggleFavorite = useCallback(
    (connection: Connection) => {
      dispatch({
        type: 'UPDATE_CONNECTION',
        payload: { ...connection, favorite: !connection.favorite, updatedAt: new Date() },
      });
    },
    [dispatch],
  );

  const toggleSelectedFavorites = useCallback(
    (favorite: boolean) => {
      selectedIds.forEach((id) => {
        const connection = connections.find((c) => c.id === id);
        if (connection) {
          dispatch({
            type: 'UPDATE_CONNECTION',
            payload: { ...connection, favorite, updatedAt: new Date() },
          });
        }
      });
    },
    [selectedIds, connections, dispatch],
  );

  // Duplicate
  const duplicateConnection = useCallback(
    (connection: Connection) => {
      const newConnection: Connection = {
        ...connection,
        id: generateId(),
        name: `${connection.name} (Copy)`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dispatch({ type: 'ADD_CONNECTION', payload: newConnection });
    },
    [dispatch],
  );

  const duplicateSelected = useCallback(() => {
    selectedIds.forEach((id) => {
      const connection = connections.find((c) => c.id === id);
      if (connection) {
        const newConnection: Connection = {
          ...connection,
          id: generateId(),
          name: `${connection.name} (Copy)`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        dispatch({ type: 'ADD_CONNECTION', payload: newConnection });
      }
    });
    setSelectedIds(new Set());
  }, [selectedIds, connections, dispatch]);

  // Delete
  const deleteConnection = useCallback(
    (id: string) => {
      dispatch({ type: 'DELETE_CONNECTION', payload: id });
    },
    [dispatch],
  );

  const deleteSelected = useCallback(() => {
    selectedIds.forEach((id) => {
      dispatch({ type: 'DELETE_CONNECTION', payload: id });
    });
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
  }, [selectedIds, dispatch]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        if (editingCell) cancelEdit();
        else onClose();
      }
      if (e.key === 'Enter' && editingCell) saveEdit();
      if (e.key === 'Tab' && editingCell) {
        e.preventDefault();
        saveEdit();
      }
    },
    [isOpen, editingCell, onClose, saveEdit, cancelEdit],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleEditInFullEditor = useCallback(
    (connection: Connection) => {
      onEditConnection?.(connection);
      onClose();
    },
    [onEditConnection, onClose],
  );

  return {
    // State
    searchTerm,
    selectedIds,
    editingCell,
    editValue,
    sortField,
    sortDirection,
    showDeleteConfirm,
    showFavoritesFirst,
    // Derived
    connections,
    filteredConnections,
    selectionState,
    // Setters
    setSearchTerm,
    setEditValue,
    setShowDeleteConfirm,
    setShowFavoritesFirst,
    // Handlers
    toggleSort,
    toggleSelectAll,
    toggleSelect,
    saveEdit,
    cancelEdit,
    handleDoubleClick,
    toggleFavorite,
    toggleSelectedFavorites,
    duplicateConnection,
    duplicateSelected,
    deleteConnection,
    deleteSelected,
    handleEditInFullEditor,
    // Props pass-through
    onClose,
    hasEditConnection: !!onEditConnection,
  };
}

export type BulkConnectionEditorMgr = ReturnType<typeof useBulkConnectionEditor>;
