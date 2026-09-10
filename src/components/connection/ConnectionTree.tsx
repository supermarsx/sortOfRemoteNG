import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Monitor } from "lucide-react";
import { useConnectionTree } from "../../hooks/connection/useConnectionTree";
import { useConnections } from "../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { isToolProtocol } from "../app/toolSession";
import {
  createWinmgmtSession,
  type WindowsToolId,
} from "../windows/WindowsToolPanel.helpers";
import { ConnectionTreeRow } from "./connectionTree/ConnectionTreeItem";
import RenameModal from "./connectionTree/RenameModal";
import ConnectOptionsModal from "./connectionTree/ConnectOptionsModal";
import PanelContextMenu from "./connectionTree/PanelContextMenu";
import { resolveFolderIconColor } from "../../utils/settings/folderIconColor";

const ROW_HEIGHT = 32;
const OVERSCAN = 8;
const ignoreDragLeave = () => {};

interface ConnectionTreeProps {
  onConnect: (connection: Connection) => void;
  onDisconnect: (connection: Connection) => void;
  onEdit: (connection: Connection) => void;
  onNewConnection?: (parentId: string) => void;
  onDelete: (connection: Connection) => void;
  onDiagnostics?: (connection: Connection) => void;
  onSessionDetach?: (id: string) => void;
  onOpenImport?: () => void;
  onActivateSession?: (sessionId: string) => void;
  enableReorder?: boolean;
}

export const ConnectionTree: React.FC<ConnectionTreeProps> = (props) => {
  const { databaseAvailability } = useConnections();
  if (databaseAvailability?.status !== "ready") {
    return (
      <div
        role="tree"
        aria-label="Connections"
        className="select-none p-4 text-sm text-[var(--color-textSecondary)]"
      >
        {databaseAvailability?.status === "loading"
          ? "Loading database…"
          : databaseAvailability?.status === "error"
            ? "Database could not be loaded. Retry opening it to view connections."
            : databaseAvailability?.status === "suspended"
              ? "Database locked. Unlock it to view connections."
              : "Open and unlock a database to view connections."}
      </div>
    );
  }
  return (
    <AvailableConnectionTree
      key={`${databaseAvailability.databaseId}:${databaseAvailability.generation}`}
      {...props}
    />
  );
};

const AvailableConnectionTree: React.FC<ConnectionTreeProps> = ({
  onConnect,
  onDisconnect,
  onEdit,
  onNewConnection,
  onDelete,
  onDiagnostics,
  onSessionDetach,
  onOpenImport,
  onActivateSession,
  enableReorder = true,
}) => {
  const { t } = useTranslation();
  const mgr = useConnectionTree(onConnect, enableReorder);
  const treeRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(640);
  const [revealId, setRevealId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const { buildTree, filteredConnections, hasActiveConnectionFilter } = mgr;
  const { dispatch } = mgr;
  const { connections } = mgr.state;
  const { openWinmgmtToolInBackground } = mgr.settings;
  const rows = useMemo(() => {
    const result: {
      connection: Connection;
      level: number;
      setSize: number;
      posInSet: number;
    }[] = [];
    const visited = new Set<string>();
    const visit = (siblings: Connection[], level: number) => {
      siblings.forEach((connection, index) => {
        if (visited.has(connection.id)) return;
        visited.add(connection.id);
        result.push({
          connection,
          level,
          setSize: siblings.length,
          posInSet: index + 1,
        });
        if (
          connection.isGroup &&
          (connection.expanded || hasActiveConnectionFilter)
        ) {
          visit(buildTree(filteredConnections, connection.id), level + 1);
        }
      });
    };
    visit(buildTree(filteredConnections), 0);
    return result;
  }, [buildTree, filteredConnections, hasActiveConnectionFilter]);
  const sessionsByConnection = useMemo(() => {
    const index = new Map<string, ConnectionSession>();
    for (const session of mgr.state.sessions) {
      if (
        !isToolProtocol(session.protocol) &&
        !index.has(session.connectionId)
      ) {
        index.set(session.connectionId, session);
      }
    }
    return index;
  }, [mgr.state.sessions]);
  const virtual = rows.length > 200;
  const viewportTop = Math.min(
    scrollTop,
    Math.max(0, rows.length * ROW_HEIGHT - height),
  );
  const firstRow = virtual
    ? Math.max(0, Math.floor(viewportTop / ROW_HEIGHT) - OVERSCAN)
    : 0;
  const lastRow = virtual
    ? Math.min(
        rows.length,
        Math.ceil((viewportTop + height) / ROW_HEIGHT) + OVERSCAN,
      )
    : rows.length;

  useLayoutEffect(() => {
    // Small trees scroll entirely in the browser. When growth or expansion
    // enables virtualization, start its viewport at the current DOM offset.
    if (virtual) setScrollTop(treeRef.current?.scrollTop ?? 0);
  }, [virtual]);

  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const resize = () => setHeight(tree.clientHeight || 640);
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(tree);
    return () => observer.disconnect();
  }, []);

  const scrollToRow = useCallback(
    (id: string) => {
      const index = rows.findIndex((row) => row.connection.id === id);
      const tree = treeRef.current;
      if (index < 0 || !tree) return;
      const top = index * ROW_HEIGHT;
      if (top < tree.scrollTop || top + ROW_HEIGHT > tree.scrollTop + height) {
        tree.scrollTop = Math.max(0, top - Math.floor(height / 2));
        setScrollTop(tree.scrollTop);
      }
    },
    [rows, height],
  );

  useLayoutEffect(() => {
    const selected = mgr.state.selectedConnection?.id;
    if (selected) scrollToRow(selected);
  }, [mgr.state.selectedConnection?.id, scrollToRow]);

  useLayoutEffect(() => {
    if (!focusId) return;
    scrollToRow(focusId);
    const el = treeRef.current?.querySelector(
      `[data-connection-id="${CSS.escape(focusId)}"]`,
    );
    if (el) {
      (el.closest('[role="treeitem"]') as HTMLElement)?.focus({
        preventScroll: true,
      });
      setFocusId(null);
    }
  }, [focusId, scrollToRow, firstRow, lastRow]);

  useEffect(() => {
    const handler = (e: Event) => {
      const connectionId = (e as CustomEvent).detail?.connectionId;
      if (!connectionId) return;
      const byId = new Map(
        connections.map((connection) => [connection.id, connection]),
      );
      let parentId = byId.get(connectionId)?.parentId;
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = byId.get(parentId);
        if (!parent) break;
        if (!parent.expanded)
          dispatch({
            type: "UPDATE_CONNECTION",
            payload: { ...parent, expanded: true },
          });
        parentId = parent.parentId;
      }
      setRevealId(connectionId);
    };
    window.addEventListener("reveal-connection", handler);
    return () => window.removeEventListener("reveal-connection", handler);
  }, [connections, dispatch]);

  useEffect(() => {
    if (!revealId) return;
    scrollToRow(revealId);
    const el = treeRef.current?.querySelector(
      `[data-connection-id="${CSS.escape(revealId)}"]`,
    );
    if (!el) return;
    el.classList.add("sor-tree-item-blink");
    const timer = setTimeout(() => {
      el.classList.remove("sor-tree-item-blink");
      setRevealId(null);
    }, 2000);
    return () => {
      clearTimeout(timer);
      el.classList.remove("sor-tree-item-blink");
    };
  }, [revealId, scrollToRow, firstRow, lastRow]);

  const handleConnectAll = useCallback(
    (folder: Connection) => {
      const children = buildTree(mgr.state.connections, folder.id).filter(
        (c) => !c.isGroup,
      );
      children.forEach((conn, i) => {
        setTimeout(() => onConnect(conn), i * 200);
      });
    },
    [buildTree, mgr.state.connections, onConnect],
  );

  const handleConnectAllRecursive = useCallback(
    (folder: Connection) => {
      const collectConnections = (parentId: string): Connection[] => {
        const result: Connection[] = [];
        for (const conn of buildTree(mgr.state.connections, parentId)) {
          if (conn.isGroup) {
            result.push(...collectConnections(conn.id));
          } else {
            result.push(conn);
          }
        }
        return result;
      };
      const allConns = collectConnections(folder.id);
      allConns.forEach((conn, i) => {
        setTimeout(() => onConnect(conn), i * 200);
      });
    },
    [buildTree, mgr.state.connections, onConnect],
  );

  const handleWindowsTool = useCallback(
    (c: Connection, tool: string) => {
      const session = createWinmgmtSession(
        tool as WindowsToolId,
        c.id,
        c.name,
        c.hostname || c.name,
      );
      dispatch({ type: "ADD_SESSION", payload: session });

      // Per-connection focusOnWinmgmtTool overrides the global setting
      const shouldFocus = c.focusOnWinmgmtTool ?? !openWinmgmtToolInBackground;
      if (shouldFocus && onActivateSession) {
        onActivateSession(session.id);
      }
    },
    [dispatch, openWinmgmtToolInBackground, onActivateSession],
  );

  const renderRows = () =>
    rows
      .slice(firstRow, lastRow)
      .map(({ connection, level, setSize, posInSet }) => (
        <ConnectionTreeRow
          key={connection.id}
          connection={connection}
          folderIconColor={resolveFolderIconColor(mgr.settings)}
          level={level}
          setSize={setSize}
          posInSet={posInSet}
          expanded={connection.expanded || hasActiveConnectionFilter}
          dispatch={mgr.dispatch}
          isSelected={mgr.state.selectedConnectionIds.has(connection.id)}
          isMultiSelected={mgr.state.selectedConnectionIds.size > 1}
          activeSession={sessionsByConnection.get(connection.id)}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onEdit={onEdit}
          onNewConnection={onNewConnection}
          onDelete={onDelete}
          onCopyHostname={mgr.handleCopyHostname}
          onRename={mgr.handleRename}
          onExport={mgr.handleExportConnection}
          onConnectWithOptions={mgr.handleConnectWithOptions}
          onConnectWithoutCredentials={mgr.handleConnectWithoutCredentials}
          onExecuteScripts={mgr.handleExecuteScripts}
          onDiagnostics={onDiagnostics}
          onDetachSession={onSessionDetach}
          onDuplicate={mgr.handleDuplicate}
          onCheckConnection={mgr.handleCheckConnection}
          onWindowsTool={handleWindowsTool}
          onConnectAll={handleConnectAll}
          onConnectAllRecursive={handleConnectAllRecursive}
          enableReorder={enableReorder}
          isDragging={mgr.draggedId === connection.id}
          isDragOver={
            mgr.dragOverId === connection.id && mgr.draggedId !== connection.id
          }
          dropPosition={
            mgr.dragOverId === connection.id && mgr.draggedId !== connection.id
              ? mgr.dropPosition
              : null
          }
          singleClickConnect={mgr.settings.singleClickConnect}
          singleClickDisconnect={mgr.settings.singleClickDisconnect}
          doubleClickRename={mgr.settings.doubleClickRename}
          folderSingleClickToggle={mgr.settings.folderSingleClickToggle}
          folderDoubleClickToggle={mgr.settings.folderDoubleClickToggle}
          onDragStart={mgr.handleItemDragStart}
          onDragOver={mgr.handleItemDragOver}
          onDragLeave={ignoreDragLeave}
          onDragEnd={mgr.handleItemDragEnd}
          onDrop={mgr.handleItemDrop}
        />
      ));

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest("button, input, [role=menu]"))
      return;
    const element = (event.target as HTMLElement).closest('[role="treeitem"]');
    const id = element
      ?.querySelector("[data-connection-id]")
      ?.getAttribute("data-connection-id");
    let index = Math.max(
      0,
      rows.findIndex(
        (row) => row.connection.id === (id ?? mgr.state.selectedConnection?.id),
      ),
    );
    const row = rows[index];
    if (!row) return;
    const { connection } = row;
    switch (event.key) {
      case "ArrowDown":
        index = Math.min(rows.length - 1, index + 1);
        break;
      case "ArrowUp":
        index = Math.max(0, index - 1);
        break;
      case "Home":
        index = 0;
        break;
      case "End":
        index = rows.length - 1;
        break;
      case "ArrowRight":
        if (
          connection.isGroup &&
          !connection.expanded &&
          !hasActiveConnectionFilter
        ) {
          mgr.dispatch({
            type: "UPDATE_CONNECTION",
            payload: { ...connection, expanded: true },
          });
        } else if (rows[index + 1]?.level > row.level) index++;
        break;
      case "ArrowLeft":
        if (
          connection.isGroup &&
          connection.expanded &&
          !hasActiveConnectionFilter
        ) {
          mgr.dispatch({
            type: "UPDATE_CONNECTION",
            payload: { ...connection, expanded: false },
          });
        } else {
          const parentIndex = rows.findIndex(
            (item) => item.connection.id === connection.parentId,
          );
          if (parentIndex >= 0) index = parentIndex;
        }
        break;
      case "Enter":
        if (connection.isGroup)
          mgr.dispatch({
            type: "UPDATE_CONNECTION",
            payload: { ...connection, expanded: !connection.expanded },
          });
        else onConnect(connection);
        break;
      case " ":
        break;
      default:
        return;
    }
    event.preventDefault();
    mgr.dispatch({
      type: "SELECT_CONNECTION",
      payload: rows[index].connection,
    });
    setFocusId(rows[index].connection.id);
  };

  return (
    <>
      <div
        ref={treeRef}
        data-testid="connection-tree"
        className={`flex-1 overflow-y-auto select-none ${mgr.draggedId ? "min-h-[100px]" : ""}`}
        data-tauri-disable-drag="true"
        role="tree"
        tabIndex={mgr.state.selectedConnectionIds.size === 0 ? 0 : -1}
        aria-label={t("connections.connectionTree", "Connection tree")}
        onContextMenu={mgr.handlePanelContextMenu}
        onDragOver={mgr.handlePanelDragOver}
        onDrop={mgr.handlePanelDrop}
        onKeyDown={handleKeyDown}
        onScroll={
          virtual
            ? (event) => setScrollTop(event.currentTarget.scrollTop)
            : undefined
        }
      >
        {mgr.filteredConnections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-[var(--color-textMuted)]">
            <Monitor size={24} className="mb-2" />
            <p className="text-sm">
              {t("connections.noConnectionsFound", "No connections found")}
            </p>
          </div>
        ) : (
          <>
            {virtual && (
              <div
                role="presentation"
                style={{ height: firstRow * ROW_HEIGHT }}
              />
            )}
            {renderRows()}
            {virtual && (
              <div
                role="presentation"
                style={{ height: (rows.length - lastRow) * ROW_HEIGHT }}
              />
            )}
          </>
        )}
      </div>

      <PanelContextMenu mgr={mgr} onOpenImport={onOpenImport} />
      <RenameModal mgr={mgr} />
      <ConnectOptionsModal mgr={mgr} />
    </>
  );
};
