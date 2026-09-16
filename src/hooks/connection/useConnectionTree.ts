import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Connection,
  ConnectionFilter,
} from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import { useToastContext } from "../../contexts/ToastContext";
import { ScriptEngine } from "../../utils/recording/scriptEngine";
import { canMoveToParent } from "../../utils/window/dragDropManager";

/* ── Types ─────────────────────────────────────────────────────── */

export interface ConnectOptionsData {
  username: string;
  authType: "password" | "key";
  password: string;
  privateKey: string;
  passphrase: string;
  saveToConnection: boolean;
}

type SortBy = NonNullable<ConnectionFilter["sortBy"]>;
type SortDirection = NonNullable<ConnectionFilter["sortDirection"]>;

/* ── Sibling ordering ──────────────────────────────────────────── */

/**
 * The single comparator a sibling group is displayed with. `buildTree` renders
 * each group through it and `handleItemDrop` measures a drop against the same
 * list, so a "third row from the top" means the same thing to both. Anything
 * that reads sibling order for a position must use this, not raw `order`: a
 * group whose members have never been dragged shares the implicit order 0 and
 * is displayed alphabetically, in no relation to the persisted array.
 */
export function createSiblingComparator(
  sortBy: SortBy,
  sortDirection: SortDirection,
): (a: Connection, b: Connection) => number {
  const multiplier = sortDirection === "desc" ? -1 : 1;
  return (a, b) => {
    if (a.isGroup && !b.isGroup) return -1;
    if (!a.isGroup && b.isGroup) return 1;

    if (sortBy === "custom") {
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
  };
}

/* ── Hook ──────────────────────────────────────────────────────── */

export function useConnectionTree(
  onConnect: (connection: Connection) => void,
  enableReorder: boolean,
) {
  const { state, dispatch, dispatchAndFlush } = useConnections();
  const { settings } = useSettings();
  const { t } = useTranslation();
  const { toast } = useToastContext();

  /* ── Drag / drop state ── */
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<
    "before" | "after" | "inside" | null
  >(null);
  const reorderEnabledRef = useRef(enableReorder);
  reorderEnabledRef.current = enableReorder;
  const currentDragRef = useRef(draggedId);
  currentDragRef.current = draggedId;
  useEffect(() => {
    if (!enableReorder) {
      setDraggedId(null);
      setDragOverId(null);
      setDropPosition(null);
    }
  }, [enableReorder]);

  /* ── Rename state ── */
  const [renameTarget, setRenameTarget] = useState<Connection | null>(null);
  const [renameValue, setRenameValue] = useState("");

  /* ── Panel context menu state ── */
  const [panelMenuPosition, setPanelMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  /* ── Connect-with-options state ── */
  const [connectOptionsTarget, setConnectOptionsTarget] =
    useState<Connection | null>(null);
  const [connectOptionsData, setConnectOptionsData] =
    useState<ConnectOptionsData | null>(null);

  /* ── Callbacks ── */

  const handleCopyHostname = useCallback((connection: Connection) => {
    if (!connection.hostname) return;
    navigator.clipboard
      .writeText(connection.hostname)
      .catch((e) => console.error("Clipboard write failed:", e));
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
    const payload = {
      exportedAt: new Date().toISOString(),
      connection: safeConnection,
    };
    const content = JSON.stringify(payload, null, 2);
    const filename = `connection-${connection.name || connection.id}.json`
      .replace(/[^a-z0-9-_]+/gi, "-")
      .toLowerCase();
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

  const handleConnectWithoutCredentials = useCallback(
    (connection: Connection) => {
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
    },
    [onConnect],
  );

  const handleExecuteScripts = useCallback(
    async (connection: Connection, sessionId?: string) => {
      try {
        const engine = ScriptEngine.getInstance();
        const session = state.sessions.find((item) => item.id === sessionId);
        const scripts = engine.getScriptsForTrigger(
          "manual",
          connection.protocol,
        );
        for (const script of scripts) {
          await engine.executeScript(script, {
            trigger: "manual",
            connection,
            session,
          });
        }
      } catch (error) {
        console.error("Failed to execute scripts:", error);
      }
    },
    [state.sessions],
  );

  const handleConnectOptionsSubmit = useCallback(() => {
    if (!connectOptionsTarget || !connectOptionsData) return;
    const isSsh = connectOptionsTarget.protocol === "ssh";
    const overrides: Partial<Connection> = {
      username: connectOptionsData.username || undefined,
    };

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
      dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...nextConnection, updatedAt: new Date().toISOString() },
      });
    }
    onConnect(nextConnection);
    setConnectOptionsTarget(null);
    setConnectOptionsData(null);
  }, [connectOptionsData, connectOptionsTarget, dispatch, onConnect]);

  const handleRenameSubmit = useCallback(() => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    dispatch({
      type: "UPDATE_CONNECTION",
      payload: {
        ...renameTarget,
        name: trimmed,
        updatedAt: new Date().toISOString(),
      },
    });
    setRenameTarget(null);
  }, [dispatch, renameTarget, renameValue]);

  const handleDuplicate = useCallback(
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
        return undefined;
      }
    },
    [dispatchAndFlush, t, toast],
  );

  const handleDuplicateWithCredentials = useCallback(
    (connection: Connection) =>
      handleDuplicate(connection, { includeCredentials: true }),
    [handleDuplicate],
  );

  // Check-connection dispatch: delegated to t5-e4's useBulkConnectionCheck via
  // window event. ConnectionTree subscribes and opens the modal. This keeps the
  // hook API stable whether or not the e4 hook/modal has landed yet.
  const handleCheckConnection = useCallback((connection: Connection) => {
    window.dispatchEvent(
      new CustomEvent("bulk-check-connections", {
        detail: { connections: [connection] },
      }),
    );
  }, []);

  const handleCheckConnections = useCallback((list: Connection[]) => {
    window.dispatchEvent(
      new CustomEvent("bulk-check-connections", {
        detail: { connections: list },
      }),
    );
  }, []);

  /* ── Tree building ── */

  // Each collection is indexed once per sort configuration. Expanding a folder
  // is then a lookup, rather than a scan of the entire collection per group.
  const treeIndexes = useMemo(
    () => new WeakMap<Connection[], Map<string | undefined, Connection[]>>(),
    // The cached sibling arrays are sorted, so changing the sort invalidates them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.filter.sortBy, state.filter.sortDirection],
  );
  const buildTree = useCallback(
    (connections: Connection[], parentId?: string): Connection[] => {
      const cached = treeIndexes.get(connections);
      if (cached) return cached.get(parentId) ?? [];
      const compareSiblings = createSiblingComparator(
        state.filter.sortBy || "name",
        state.filter.sortDirection || "asc",
      );

      const index = new Map<string | undefined, Connection[]>();
      for (const connection of connections) {
        const siblings = index.get(connection.parentId);
        if (siblings) siblings.push(connection);
        else index.set(connection.parentId, [connection]);
      }
      for (const siblings of index.values()) {
        siblings.sort(compareSiblings);
      }
      treeIndexes.set(connections, index);
      return index.get(parentId) ?? [];
    },
    [treeIndexes, state.filter.sortBy, state.filter.sortDirection],
  );

  const hasActiveConnectionFilter = useMemo(() => {
    const filter = state.filter;
    return Boolean(
      filter.showFavorites ||
      filter.showRecent ||
      filter.searchTerm.trim() ||
      filter.tags.some((tag) => tag.trim() !== "") ||
      filter.colorTags.length > 0 ||
      filter.protocols.length > 0,
    );
  }, [state.filter]);

  const filteredConnections = useMemo(() => {
    if (!hasActiveConnectionFilter) return state.connections;

    const searchLower = state.filter.searchTerm.trim().toLowerCase();
    const textTagFilters = state.filter.tags
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag !== "");
    const colorTagFilters = new Set(
      state.filter.colorTags.filter((tagId) => tagId.trim() !== ""),
    );
    const protocolFilters = new Set(
      state.filter.protocols.filter((protocol) => protocol.trim() !== ""),
    );
    const connectionsById = new Map(
      state.connections.map((conn) => [conn.id, conn]),
    );

    const matchesConnection = (conn: Connection): boolean => {
      if (state.filter.showFavorites && !conn.favorite) return false;
      if (state.filter.showRecent && !conn.lastConnected) return false;

      if (searchLower) {
        const matchesSearch =
          conn.name.toLowerCase().includes(searchLower) ||
          (conn.hostname?.toLowerCase().includes(searchLower) ?? false) ||
          (conn.description?.toLowerCase().includes(searchLower) ?? false);
        if (!matchesSearch) return false;
      }

      if (protocolFilters.size > 0 && !protocolFilters.has(conn.protocol))
        return false;

      if (textTagFilters.length > 0) {
        const connectionTags = new Set(
          (conn.tags || [])
            .map((tag) => tag.trim().toLowerCase())
            .filter((tag) => tag !== ""),
        );
        if (!textTagFilters.every((tag) => connectionTags.has(tag)))
          return false;
      }

      if (
        colorTagFilters.size > 0 &&
        (!conn.colorTag || !colorTagFilters.has(conn.colorTag))
      )
        return false;

      return true;
    };

    const includedIds = new Set<string>();
    const includeWithAncestors = (conn: Connection) => {
      includedIds.add(conn.id);
      let parentId = conn.parentId;
      const visitedIds = new Set<string>();

      while (parentId && !visitedIds.has(parentId)) {
        visitedIds.add(parentId);
        const parent = connectionsById.get(parentId);
        if (!parent) break;
        includedIds.add(parent.id);
        parentId = parent.parentId;
      }
    };

    for (const conn of state.connections) {
      if (matchesConnection(conn)) {
        includeWithAncestors(conn);
      }
    }

    return state.connections.filter((conn) => includedIds.has(conn.id));
  }, [hasActiveConnectionFilter, state.connections, state.filter]);

  /* ── Panel-level handlers ── */

  const handlePanelContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-connection-item]")) return;
    e.preventDefault();
    setPanelMenuPosition({ x: e.clientX, y: e.clientY });
  }, []);

  const handlePanelDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!reorderEnabledRef.current) {
        e.dataTransfer.dropEffect = "none";
        return;
      }
      e.dataTransfer.dropEffect = "move";
      if (draggedId) {
        setDragOverId(null);
        setDropPosition(null);
      }
    },
    [draggedId],
  );

  const handlePanelDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        !reorderEnabledRef.current ||
        !draggedId ||
        currentDragRef.current !== draggedId
      ) {
        e.dataTransfer.dropEffect = "none";
        return;
      }

      const draggedConnection = state.connections.find(
        (conn) => conn.id === draggedId,
      );
      if (!draggedConnection) {
        setDraggedId(null);
        setDragOverId(null);
        setDropPosition(null);
        return;
      }

      if (!canMoveToParent(draggedId, undefined, state.connections)) {
        console.warn("Cannot move: would exceed maximum nesting depth");
        setDraggedId(null);
        setDragOverId(null);
        setDropPosition(null);
        return;
      }

      const rootSiblings = state.connections.filter((c) => !c.parentId);
      const maxOrder = rootSiblings.reduce(
        (max, c) => Math.max(max, c.order ?? 0),
        -1,
      );

      dispatch({
        type: "UPDATE_CONNECTION",
        payload: {
          ...draggedConnection,
          parentId: undefined,
          order: maxOrder + 1,
          updatedAt: new Date().toISOString(),
        },
      });

      setDraggedId(null);
      setDragOverId(null);
      setDropPosition(null);
    },
    [draggedId, state.connections, dispatch],
  );

  /* ── Per-item drag handlers (passed to each tree item) ── */

  const handleItemDragStart = useCallback((connectionId: string) => {
    if (!reorderEnabledRef.current) return;
    setDraggedId(connectionId);
    setDropPosition(null);
  }, []);

  const handleItemDragOver = useCallback(
    (connectionId: string, position: "before" | "after" | "inside") => {
      if (
        !reorderEnabledRef.current ||
        !draggedId ||
        connectionId === draggedId
      )
        return;
      setDragOverId(connectionId);
      setDropPosition(position);
    },
    [draggedId],
  );

  const handleItemDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverId(null);
    setDropPosition(null);
  }, []);

  const handleItemDrop = useCallback(
    (targetId: string, position: "before" | "after" | "inside") => {
      if (
        !reorderEnabledRef.current ||
        !draggedId ||
        currentDragRef.current !== draggedId ||
        draggedId === targetId
      ) {
        setDraggedId(null);
        setDragOverId(null);
        setDropPosition(null);
        return;
      }

      const draggedConnection = state.connections.find(
        (conn) => conn.id === draggedId,
      );
      const targetConnection = state.connections.find(
        (conn) => conn.id === targetId,
      );
      if (!draggedConnection || !targetConnection) {
        setDraggedId(null);
        setDragOverId(null);
        setDropPosition(null);
        return;
      }

      if (draggedConnection.isGroup && position === "inside") {
        let checkId: string | undefined = targetId;
        while (checkId) {
          if (checkId === draggedId) {
            console.warn("Cannot drop a folder into itself or its descendants");
            setDraggedId(null);
            setDragOverId(null);
            setDropPosition(null);
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
        setDraggedId(null);
        setDragOverId(null);
        setDropPosition(null);
        return;
      }

      const sortBy = state.filter.sortBy || "name";
      const sortDirection = state.filter.sortDirection || "asc";

      // The list the drop is measured against is the one on screen: the target
      // group as `buildTree` renders it, minus the dragged row, which is about
      // to be re-inserted. Sorting by raw `order` here instead left siblings
      // that have never been dragged in persisted order, so the index the drop
      // computed described no row the user could see.
      const displayedSiblings = state.connections
        .filter((c) => c.parentId === newParentId && c.id !== draggedId)
        .sort(createSiblingComparator(sortBy, sortDirection));

      // Where the dragged row lands among them, top-down.
      const lastIndex = displayedSiblings.length;
      let insertIndex: number;
      if (position === "inside") {
        insertIndex = 0;
      } else {
        const targetIndex = displayedSiblings.findIndex(
          (s) => s.id === targetId,
        );
        if (targetIndex < 0)
          insertIndex = position === "before" ? 0 : lastIndex;
        else
          insertIndex = position === "before" ? targetIndex : targetIndex + 1;
      }

      // Dense orders are written from the top of the displayed list down. Only
      // a descending *custom* sort reads `order` back-to-front, so only there
      // do the values have to run backwards for the group to stay as rendered;
      // every other sort mode ignores `order` until the user picks custom, and
      // should then show them the list they dragged into shape.
      const descending = sortBy === "custom" && sortDirection === "desc";
      const orderAt = (displayIndex: number) =>
        descending ? lastIndex - displayIndex : displayIndex;

      displayedSiblings.forEach((sibling, index) => {
        const nextOrder = orderAt(index >= insertIndex ? index + 1 : index);
        if (sibling.order !== nextOrder) {
          dispatch({
            type: "UPDATE_CONNECTION",
            payload: { ...sibling, order: nextOrder },
          });
        }
      });
      const newOrder = orderAt(insertIndex);

      dispatch({
        type: "UPDATE_CONNECTION",
        payload: {
          ...draggedConnection,
          parentId: newParentId,
          order: newOrder,
          updatedAt: new Date().toISOString(),
        },
      });

      if (
        position === "inside" &&
        targetConnection.isGroup &&
        !targetConnection.expanded
      ) {
        dispatch({
          type: "UPDATE_CONNECTION",
          payload: { ...targetConnection, expanded: true },
        });
      }

      setDraggedId(null);
      setDragOverId(null);
      setDropPosition(null);
    },
    [
      draggedId,
      state.connections,
      state.filter.sortBy,
      state.filter.sortDirection,
      dispatch,
    ],
  );

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
    handleDuplicateWithCredentials,
    handleCheckConnection,
    handleCheckConnections,
    buildTree,
    filteredConnections,
    hasActiveConnectionFilter,
  };
}

export type ConnectionTreeMgr = ReturnType<typeof useConnectionTree>;
