import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Connection } from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import { useToastContext } from "../../contexts/ToastContext";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { resolveConnectionDeleteConfirmation } from "../../utils/behavior/legacyBehavior";

type EditableField = "name" | "hostname" | "port" | "username";
type PendingConnectionDelete = {
  kind: "single" | "selected";
  ids: readonly string[];
};

export function useBulkConnectionEditor(
  isOpen: boolean,
  onClose: () => void,
  onEditConnection?: (connection: Connection) => void,
) {
  const { state, dispatch, dispatchAndFlush, flushPendingSave } =
    useConnections();
  const { t } = useTranslation();
  const { toast } = useToastContext();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: EditableField;
  } | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [sortField, setSortField] = useState<
    "name" | "protocol" | "hostname" | "favorite"
  >("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [pendingDelete, setPendingDelete] =
    useState<PendingConnectionDelete | null>(null);
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
      if (sortField === "favorite") {
        const aFav = a.favorite ? 1 : 0;
        const bFav = b.favorite ? 1 : 0;
        return sortDirection === "asc" ? bFav - aFav : aFav - bFav;
      }
      const aVal = a[sortField] || "";
      const bVal = b[sortField] || "";
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return [...result];
  }, [connections, searchTerm, sortField, sortDirection, showFavoritesFirst]);

  const selectionState = useMemo(() => {
    if (selectedIds.size === 0) return "none" as const;
    if (selectedIds.size === filteredConnections.length) return "all" as const;
    return "partial" as const;
  }, [selectedIds.size, filteredConnections.length]);

  // Sort
  const toggleSort = useCallback(
    (field: "name" | "protocol" | "hostname" | "favorite") => {
      if (sortField === field) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDirection("asc");
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

    const updates: Partial<Connection> = {
      updatedAt: new Date().toISOString(),
    };
    if (editingCell.field === "port") {
      updates.port = parseInt(editValue) || connection.port;
    } else {
      updates[editingCell.field] = editValue;
    }

    dispatch({
      type: "UPDATE_CONNECTION",
      payload: { ...connection, ...updates },
    });
    setEditingCell(null);
    setEditValue("");
  }, [editingCell, editValue, connections, dispatch]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue("");
  }, []);

  const handleDoubleClick = useCallback(
    (
      connectionId: string,
      field: EditableField,
      currentValue: string | number | undefined,
    ) => {
      setEditingCell({ id: connectionId, field });
      setEditValue(String(currentValue || ""));
    },
    [],
  );

  // Favorites
  const toggleFavorite = useCallback(
    (connection: Connection) => {
      dispatch({
        type: "UPDATE_CONNECTION",
        payload: {
          ...connection,
          favorite: !connection.favorite,
          updatedAt: new Date().toISOString(),
        },
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
            type: "UPDATE_CONNECTION",
            payload: {
              ...connection,
              favorite,
              updatedAt: new Date().toISOString(),
            },
          });
        }
      });
    },
    [selectedIds, connections, dispatch],
  );

  // Clone (backend stamps id/timestamps, strips secrets unless opt-in)
  const duplicateConnection = useCallback(
    async (
      connection: Connection,
      options?: { includeCredentials?: boolean },
    ): Promise<Connection | undefined> => {
      try {
        const includeCredentials = options?.includeCredentials ?? false;
        const { invoke } = await import("@tauri-apps/api/core");
        const cloned = await invoke<Connection>("clone_connection", {
          connection,
          newName: null,
          includeCredentials,
        });
        await dispatchAndFlush({ type: "ADD_CONNECTION", payload: cloned });
        toast.success(t("connections.cloned"));
        return cloned;
      } catch (e) {
        console.error("clone_connection failed", e);
        toast.error(t("connections.cloneFailed"));
        throw e;
      }
    },
    [dispatchAndFlush, t, toast],
  );

  const duplicateSelected = useCallback(
    async (options?: { includeCredentials?: boolean }) => {
      const ids = Array.from(selectedIds);
      for (const id of ids) {
        const connection = connections.find((c) => c.id === id);
        if (!connection) continue;
        try {
          await duplicateConnection(connection, options);
        } catch {
          // individual errors already toasted; continue with remaining
        }
      }
      setSelectedIds(new Set());
    },
    [selectedIds, connections, duplicateConnection],
  );

  // Delete
  const deleteConnection = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await dispatchAndFlush({ type: "DELETE_CONNECTION", payload: id });
        return true;
      } catch (error) {
        console.error("Failed to persist connection deletion:", error);
        toast.error(
          t(
            "connections.deletePersistenceFailed",
            "The deletion could not be saved. Retry after storage is available.",
          ),
        );
        return false;
      }
    },
    [dispatchAndFlush, t, toast],
  );

  const deleteSelected = useCallback(
    async (ids: readonly string[]): Promise<boolean> => {
      ids.forEach((id) => {
        dispatch({ type: "DELETE_CONNECTION", payload: id });
      });
      try {
        await flushPendingSave();
        setSelectedIds((current) => {
          const remaining = new Set(current);
          ids.forEach((id) => remaining.delete(id));
          return remaining;
        });
        return true;
      } catch (error) {
        console.error("Failed to persist bulk connection deletion:", error);
        toast.error(
          t(
            "connections.deletePersistenceFailed",
            "The deletion could not be saved. Retry after storage is available.",
          ),
        );
        return false;
      }
    },
    [dispatch, flushPendingSave, t, toast],
  );

  const shouldConfirmDelete = useCallback(
    () =>
      resolveConnectionDeleteConfirmation(
        SettingsManager.getInstance().getSettings().confirmDeleteConnection,
      ),
    [],
  );

  const requestDeleteConnection = useCallback(
    async (id: string): Promise<boolean | undefined> => {
      if (shouldConfirmDelete()) {
        setPendingDelete({ kind: "single", ids: [id] });
        return undefined;
      }
      return deleteConnection(id);
    },
    [deleteConnection, shouldConfirmDelete],
  );

  const requestDeleteSelected = useCallback(async (): Promise<
    boolean | undefined
  > => {
    if (selectedIds.size === 0) return undefined;
    const requestedIds = [...selectedIds];
    if (shouldConfirmDelete()) {
      setPendingDelete({ kind: "selected", ids: requestedIds });
      return undefined;
    }
    return deleteSelected(requestedIds);
  }, [deleteSelected, selectedIds, shouldConfirmDelete]);

  const cancelDeleteConfirmation = useCallback(() => {
    setPendingDelete(null);
  }, []);

  const confirmDelete = useCallback(async (): Promise<boolean> => {
    if (!pendingDelete) return false;
    const persisted =
      pendingDelete.kind === "single"
        ? await deleteConnection(pendingDelete.ids[0])
        : await deleteSelected(pendingDelete.ids);
    if (persisted) {
      setPendingDelete(null);
    }
    return persisted;
  }, [deleteConnection, deleteSelected, pendingDelete]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape" && editingCell) {
        cancelEdit();
      }
      if (e.key === "Enter" && editingCell) saveEdit();
      if (e.key === "Tab" && editingCell) {
        e.preventDefault();
        saveEdit();
      }
    },
    [isOpen, editingCell, saveEdit, cancelEdit],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleEditInFullEditor = useCallback(
    (connection: Connection) => {
      onEditConnection?.(connection);
    },
    [onEditConnection],
  );

  return {
    // State
    searchTerm,
    selectedIds,
    editingCell,
    editValue,
    sortField,
    sortDirection,
    showDeleteConfirm: pendingDelete !== null,
    pendingDeleteId:
      pendingDelete?.kind === "single" ? pendingDelete.ids[0] : null,
    pendingDeleteIds: pendingDelete?.ids ?? [],
    pendingDeleteKind: pendingDelete?.kind ?? null,
    pendingDeleteCount: pendingDelete?.ids.length ?? 0,
    showFavoritesFirst,
    // Derived
    connections,
    filteredConnections,
    selectionState,
    // Setters
    setSearchTerm,
    setEditValue,
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
    requestDeleteConnection,
    requestDeleteSelected,
    cancelDeleteConfirmation,
    confirmDelete,
    handleEditInFullEditor,
    // Props pass-through
    onClose,
    hasEditConnection: !!onEditConnection,
  };
}

export type BulkConnectionEditorMgr = ReturnType<
  typeof useBulkConnectionEditor
>;
