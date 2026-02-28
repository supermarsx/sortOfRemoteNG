import { useState, useMemo, useCallback } from "react";
import { Connection } from "../types/connection";
import { useConnections } from "../contexts/useConnections";
import { useSettings } from "../contexts/SettingsContext";
import { generateId } from "../utils/id";
import { ScriptEngine } from "../utils/scriptEngine";
import { canMoveToParent } from "../utils/dragDropManager";

/* ── Types ─────────────────────────────────────────────────────── */

export interface ConnectOptionsData {
  username: string;
  authType: "password" | "key";
  password: string;
  privateKey: string;
  passphrase: string;
  saveToConnection: boolean;
}

/* ── Hook ──────────────────────────────────────────────────────── */

export function useConnectionTree(
  onConnect: (connection: Connection) => void,
  enableReorder: boolean,
) {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();

  /* ── Drag / drop state ── */
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after" | "inside" | null>(null);

  /* ── Rename state ── */
  const [renameTarget, setRenameTarget] = useState<Connection | null>(null);
  const [renameValue, setRenameValue] = useState("");

  /* ── Panel context menu state ── */
  const [panelMenuPosition, setPanelMenuPosition] = useState<{ x: number; y: number } | null>(null);

  /* ── Connect-with-options state ── */
  const [connectOptionsTarget, setConnectOptionsTarget] = useState<Connection | null>(null);
  const [connectOptionsData, setConnectOptionsData] = useState<ConnectOptionsData | null>(null);

  /* ── Callbacks ── */

  const handleCopyHostname = useCallback((connection: Connection) => {
    if (!connection.hostname) return;
    navigator.clipboard.writeText(connection.hostname).catch(() => undefined);
  }, []);

  const handleExportConnection = useCallback((connection: Connection) => {
    const safeConnection = {
      ...connection,
      password: undefined,
      privateKey: undefined,
      passphrase: undefined,
      totpSecret: undefined,
      basicAuthPassword: undefined,
    };
    const payload = { exportedAt: new Date().toISOString(), connection: safeConnection };
    const content = JSON.stringify(payload, null, 2);
    const filename = `connection-${connection.name || connection.id}.json`.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  const handleRename = useCallback((connection: Connection) => {
    setRenameTarget(connection);
    setRenameValue(connection.name || "");
  }, []);

  const handleConnectWithOptions = useCallback((connection: Connection) => {
    setConnectOptionsTarget(connection);
    setConnectOptionsData({
      username: connection.username || "",
      authType: connection.authType === "key" ? "key" : "password",
      password: connection.password || "",
      privateKey: connection.privateKey || "",
      passphrase: connection.passphrase || "",
      saveToConnection: false,
    });
  }, []);

  const handleConnectWithoutCredentials = useCallback((connection: Connection) => {
    const stripped: Connection = {
      ...connection,
      username: undefined,
      password: undefined,
      privateKey: undefined,
      passphrase: undefined,
      totpSecret: undefined,
      basicAuthPassword: undefined,
    };
    onConnect(stripped);
  }, [onConnect]);

  const handleExecuteScripts = useCallback(async (connection: Connection, sessionId?: string) => {
    try {
      const engine = ScriptEngine.getInstance();
      const session = state.sessions.find((item) => item.id === sessionId);
      const scripts = engine.getScriptsForTrigger("manual", connection.protocol);
      for (const script of scripts) {
        await engine.executeScript(script, { trigger: "manual", connection, session });
      }
    } catch (error) {
      console.error("Failed to execute scripts:", error);
    }
  }, [state.sessions]);

  const handleConnectOptionsSubmit = useCallback(() => {
    if (!connectOptionsTarget || !connectOptionsData) return;
    const isSsh = connectOptionsTarget.protocol === "ssh";
    const overrides: Partial<Connection> = { username: connectOptionsData.username || undefined };

    if (isSsh) {
      overrides.authType = connectOptionsData.authType;
      if (connectOptionsData.authType === "password") {
        overrides.password = connectOptionsData.password;
        overrides.privateKey = undefined;
        overrides.passphrase = undefined;
      } else {
        overrides.privateKey = connectOptionsData.privateKey;
        overrides.passphrase = connectOptionsData.passphrase || undefined;
        overrides.password = undefined;
      }
    } else {
      overrides.password = connectOptionsData.password || undefined;
    }

    const nextConnection = { ...connectOptionsTarget, ...overrides };
    if (connectOptionsData.saveToConnection) {
      dispatch({ type: "UPDATE_CONNECTION", payload: { ...nextConnection, updatedAt: new Date() } });
    }
    onConnect(nextConnection);
    setConnectOptionsTarget(null);
    setConnectOptionsData(null);
  }, [connectOptionsData, connectOptionsTarget, dispatch, onConnect]);

  const handleRenameSubmit = useCallback(() => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    dispatch({ type: "UPDATE_CONNECTION", payload: { ...renameTarget, name: trimmed, updatedAt: new Date() } });
    setRenameTarget(null);
  }, [dispatch, renameTarget, renameValue]);

  const handleDuplicate = useCallback((connection: Connection) => {
    const now = new Date();
    const newConnection = structuredClone(connection);
    newConnection.id = generateId();
    newConnection.createdAt = now;
    newConnection.updatedAt = now;
    dispatch({ type: "ADD_CONNECTION", payload: newConnection });
  }, [dispatch]);

  /* ── Tree building ── */

  const buildTree = useCallback((connections: Connection[], parentId?: string): Connection[] => {
    const sortBy = state.filter.sortBy || "name";
    const sortDirection = state.filter.sortDirection || "asc";
    const multiplier = sortDirection === "desc" ? -1 : 1;

    return connections
      .filter((conn) => conn.parentId === parentId)
      .sort((a, b) => {
        if (a.isGroup && !b.isGroup) return -1;
        if (!a.isGroup && b.isGroup) return 1;

        if (enableReorder && sortBy === "custom") {
          const orderA = a.order ?? 0;
          const orderB = b.order ?? 0;
          if (orderA !== orderB) return (orderA - orderB) * multiplier;
        }

        switch (sortBy) {
          case "protocol":
            return a.protocol.localeCompare(b.protocol) * multiplier;
          case "hostname":
            return (a.hostname || "").localeCompare(b.hostname || "") * multiplier;
          case "createdAt": {
            const dateA = new Date(a.createdAt).getTime();
            const dateB = new Date(b.createdAt).getTime();
            return (dateA - dateB) * multiplier;
          }
          case "updatedAt": {
            const dateA = new Date(a.updatedAt).getTime();
            const dateB = new Date(b.updatedAt).getTime();
            return (dateA - dateB) * multiplier;
          }
          case "recentlyUsed": {
            const dateA = a.lastConnected ? new Date(a.lastConnected).getTime() : 0;
            const dateB = b.lastConnected ? new Date(b.lastConnected).getTime() : 0;
            return (dateB - dateA) * (sortDirection === "asc" ? -1 : 1);
          }
          case "custom":
            return a.name.localeCompare(b.name) * multiplier;
          case "name":
          default:
            return a.name.localeCompare(b.name) * multiplier;
        }
      });
  }, [enableReorder, state.filter.sortBy, state.filter.sortDirection]);

  const filteredConnections = useMemo(() => {
    return state.connections.filter((conn) => {
      if (state.filter.showFavorites && !conn.favorite) return false;
      if (state.filter.searchTerm) {
        const searchLower = state.filter.searchTerm.toLowerCase();
        return (
          conn.name.toLowerCase().includes(searchLower) ||
          conn.hostname?.toLowerCase().includes(searchLower) ||
          conn.description?.toLowerCase().includes(searchLower)
        );
      }
      return true;
    });
  }, [state.connections, state.filter]);

  /* ── Panel-level handlers ── */

  const handlePanelContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-connection-item]")) return;
    e.preventDefault();
    setPanelMenuPosition({ x: e.clientX, y: e.clientY });
  }, []);

  const handlePanelDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!enableReorder) return;
    e.dataTransfer.dropEffect = "move";
    if (draggedId) { setDragOverId(null); setDropPosition(null); }
  }, [enableReorder, draggedId]);

  const handlePanelDrop = useCallback((e: React.DragEvent) => {
    if (!enableReorder || !draggedId) return;
    e.preventDefault();

    const draggedConnection = state.connections.find((conn) => conn.id === draggedId);
    if (!draggedConnection) { setDraggedId(null); setDragOverId(null); setDropPosition(null); return; }

    if (!canMoveToParent(draggedId, undefined, state.connections)) {
      console.warn("Cannot move: would exceed maximum nesting depth");
      setDraggedId(null); setDragOverId(null); setDropPosition(null);
      return;
    }

    const rootSiblings = state.connections.filter((c) => !c.parentId);
    const maxOrder = rootSiblings.reduce((max, c) => Math.max(max, c.order ?? 0), -1);

    dispatch({ type: "UPDATE_CONNECTION", payload: { ...draggedConnection, parentId: undefined, order: maxOrder + 1, updatedAt: new Date() } });

    setDraggedId(null); setDragOverId(null); setDropPosition(null);
  }, [enableReorder, draggedId, state.connections, dispatch]);

  /* ── Per-item drag handlers (passed to each tree item) ── */

  const handleItemDragStart = useCallback((connectionId: string) => {
    setDraggedId(connectionId);
    setDropPosition(null);
  }, []);

  const handleItemDragOver = useCallback((connectionId: string, position: "before" | "after" | "inside") => {
    if (connectionId === draggedId) return;
    setDragOverId(connectionId);
    setDropPosition(position);
  }, [draggedId]);

  const handleItemDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverId(null);
    setDropPosition(null);
  }, []);

  const handleItemDrop = useCallback((targetId: string, position: "before" | "after" | "inside") => {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null); setDragOverId(null); setDropPosition(null);
      return;
    }

    const draggedConnection = state.connections.find((conn) => conn.id === draggedId);
    const targetConnection = state.connections.find((conn) => conn.id === targetId);
    if (!draggedConnection || !targetConnection) {
      setDraggedId(null); setDragOverId(null); setDropPosition(null);
      return;
    }

    if (draggedConnection.isGroup && position === "inside") {
      let checkId: string | undefined = targetId;
      while (checkId) {
        if (checkId === draggedId) {
          console.warn("Cannot drop a folder into itself or its descendants");
          setDraggedId(null); setDragOverId(null); setDropPosition(null);
          return;
        }
        const parent = state.connections.find((c) => c.id === checkId);
        checkId = parent?.parentId;
      }
    }

    let newParentId: string | undefined;
    if (position === "inside" && targetConnection.isGroup) {
      newParentId = targetConnection.id;
    } else {
      newParentId = targetConnection.parentId;
    }

    if (!canMoveToParent(draggedId, newParentId, state.connections)) {
      console.warn("Cannot move: would exceed maximum nesting depth");
      setDraggedId(null); setDragOverId(null); setDropPosition(null);
      return;
    }

    const targetSiblings = state.connections.filter((c) => c.parentId === newParentId);

    let newOrder: number;
    if (position === "inside") {
      newOrder = 0;
      targetSiblings.forEach((sibling) => {
        if (sibling.id !== draggedId) {
          dispatch({ type: "UPDATE_CONNECTION", payload: { ...sibling, order: (sibling.order ?? 0) + 1 } });
        }
      });
    } else {
      const sortedSiblings = [...targetSiblings].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const targetIndex = sortedSiblings.findIndex((s) => s.id === targetId);

      if (position === "before") {
        newOrder = targetIndex >= 0 ? targetIndex : 0;
      } else {
        newOrder = targetIndex >= 0 ? targetIndex + 1 : sortedSiblings.length;
      }

      const filteredSiblings = sortedSiblings.filter((s) => s.id !== draggedId);
      filteredSiblings.forEach((sibling, index) => {
        const adjustedOrder = index >= newOrder ? index + 1 : index;
        if (sibling.order !== adjustedOrder) {
          dispatch({ type: "UPDATE_CONNECTION", payload: { ...sibling, order: adjustedOrder } });
        }
      });
    }

    dispatch({ type: "UPDATE_CONNECTION", payload: { ...draggedConnection, parentId: newParentId, order: newOrder, updatedAt: new Date() } });

    if (position === "inside" && targetConnection.isGroup && !targetConnection.expanded) {
      dispatch({ type: "UPDATE_CONNECTION", payload: { ...targetConnection, expanded: true } });
    }

    setDraggedId(null); setDragOverId(null); setDropPosition(null);
  }, [draggedId, state.connections, dispatch]);

  return {
    state,
    dispatch,
    settings,
    /* drag/drop */
    draggedId,
    dragOverId,
    dropPosition,
    handleItemDragStart,
    handleItemDragOver,
    handleItemDragEnd,
    handleItemDrop,
    handlePanelContextMenu,
    handlePanelDragOver,
    handlePanelDrop,
    /* rename */
    renameTarget,
    setRenameTarget,
    renameValue,
    setRenameValue,
    handleRename,
    handleRenameSubmit,
    /* panel menu */
    panelMenuPosition,
    setPanelMenuPosition,
    /* connect options */
    connectOptionsTarget,
    setConnectOptionsTarget,
    connectOptionsData,
    setConnectOptionsData,
    handleConnectWithOptions,
    handleConnectWithoutCredentials,
    handleConnectOptionsSubmit,
    /* tree actions */
    handleCopyHostname,
    handleExportConnection,
    handleExecuteScripts,
    handleDuplicate,
    buildTree,
    filteredConnections,
  };
}

export type ConnectionTreeMgr = ReturnType<typeof useConnectionTree>;
