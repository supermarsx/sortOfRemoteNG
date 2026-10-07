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
import { useDocumentSession } from "../../hooks/documents/useDocumentSession";
import { hasPendingDocumentDraft } from "../../utils/documents/documentDrafts";
import { DocumentTreeRow } from "./connectionTree/DocumentTreeRow";
import { DocumentTreeFilters } from "./connectionTree/DocumentTreeFilters";
import { useTreeDocuments } from "./connectionTree/useTreeDocuments";
import {
  buildConnectionDocumentRows,
  connectionRowKey,
  documentRowKey,
  type TreeDocumentMetadata,
  type TreeEntryFilter,
  type TreeDocumentTypeFilter,
} from "./connectionTree/documentTreeModel";

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
  const openDocuments = useDocumentSession(onActivateSession);
  const mgr = useConnectionTree(onConnect, enableReorder);
  const context = useConnections();
  const latestContext = useRef(context);
  latestContext.current = context;
  const documentsEnabled = mgr.settings.showDocumentsInConnectionTree === true;
  const [entryFilter, setEntryFilter] = useState<TreeEntryFilter>("all");
  const [documentType, setDocumentType] =
    useState<TreeDocumentTypeFilter>("all");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  );
  const [documentNotice, setDocumentNotice] = useState("");
  const mode = documentsEnabled ? entryFilter : "connections";
  const documentData = useTreeDocuments(
    documentsEnabled,
    mgr.state.filter.searchTerm,
    mode !== "connections" && mgr.settings.searchDocumentContents === true,
  );
  const treeRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(640);
  const [revealId, setRevealId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const { buildTree, filteredConnections, hasActiveConnectionFilter } = mgr;
  const { dispatch } = mgr;
  const { connections } = mgr.state;
  const { openWinmgmtToolInBackground } = mgr.settings;
  const rows = useMemo(
    () =>
      buildConnectionDocumentRows({
        connections,
        filteredConnections,
        documents: documentData.entries,
        mode,
        documentType,
        searchTerm: mgr.state.filter.searchTerm,
        contentMatches: documentData.contentMatches,
        hasActiveConnectionFilter,
        buildTree,
      }),
    [
      connections,
      filteredConnections,
      documentData.entries,
      mode,
      documentType,
      mgr.state.filter.searchTerm,
      documentData.contentMatches,
      hasActiveConnectionFilter,
      buildTree,
    ],
  );

  useEffect(() => {
    if (!documentsEnabled) {
      setEntryFilter("all");
      setDocumentType("all");
      setSelectedDocumentId(null);
      setDocumentNotice("");
    }
  }, [documentsEnabled]);

  useEffect(() => {
    if (
      selectedDocumentId &&
      !rows.some(
        (row) =>
          row.kind === "document" && row.document.id === selectedDocumentId,
      )
    )
      setSelectedDocumentId(null);
  }, [rows, selectedDocumentId]);

  const selectDocument = (document: TreeDocumentMetadata) => {
    setSelectedDocumentId(document.id);
    if (mgr.state.selectedConnection || mgr.state.selectedConnectionIds.size)
      mgr.dispatch({ type: "CLEAR_SELECTION" });
  };
  const activateDocument = (document: TreeDocumentMetadata) => {
    const owner = documentData.scope;
    const current = latestContext.current;
    const scope = current.documents?.scope;
    if (
      !documentsEnabled ||
      !owner ||
      current.databaseAvailability?.status !== "ready" ||
      current.databaseAvailability.databaseId !== owner.databaseId ||
      current.databaseAvailability.generation !== owner.generation ||
      !scope ||
      (scope.kind ?? "database") !== "database" ||
      scope.databaseId !== owner.databaseId ||
      scope.generation !== owner.generation ||
      current.documents?.changeRevision !== documentData.revision ||
      !documentData.entries.some((entry) => entry.id === document.id)
    )
      return;
    if (hasPendingDocumentDraft(owner.databaseId)) {
      setDocumentNotice(
        "Save or discard the current document draft before opening another document.",
      );
      return;
    }
    setDocumentNotice("");
    openDocuments({ scope: "database", documentId: document.id });
  };
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
      const index = rows.findIndex((row) => row.key === id);
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
    if (selected) {
      setSelectedDocumentId(null);
      scrollToRow(connectionRowKey(selected));
    }
  }, [mgr.state.selectedConnection?.id, scrollToRow]);

  useLayoutEffect(() => {
    if (!focusId) return;
    scrollToRow(focusId);
    const row = rows.find((entry) => entry.key === focusId);
    const selector =
      row?.kind === "document"
        ? `[data-document-id="${CSS.escape(row.document.id)}"]`
        : row?.kind === "connection"
          ? `[data-connection-id="${CSS.escape(row.connection.id)}"]`
          : "";
    const el = selector ? treeRef.current?.querySelector(selector) : null;
    if (el) {
      (el.closest('[role="treeitem"]') as HTMLElement)?.focus({
        preventScroll: true,
      });
      setFocusId(null);
    }
  }, [focusId, scrollToRow, firstRow, lastRow, rows]);

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
    scrollToRow(connectionRowKey(revealId));
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
    rows.slice(firstRow, lastRow).map((row) => {
      if (row.kind === "document")
        return (
          <DocumentTreeRow
            key={row.key}
            row={row}
            selected={selectedDocumentId === row.document.id}
            onSelect={() => selectDocument(row.document)}
            onOpen={() => activateDocument(row.document)}
          />
        );
      const { connection, level, setSize, posInSet } = row;
      return (
        <ConnectionTreeRow
          key={row.key}
          connection={connection}
          folderIconColor={resolveFolderIconColor(mgr.settings)}
          level={level}
          setSize={setSize}
          posInSet={posInSet}
          expanded={row.expanded}
          dispatch={mgr.dispatch}
          isSelected={mgr.state.selectedConnectionIds.has(connection.id)}
          isMultiSelected={mgr.state.selectedConnectionIds.size > 1}
          activeSession={sessionsByConnection.get(connection.id)}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onEdit={onEdit}
          onNewConnection={onNewConnection}
          onDocuments={(parentFolderId, create) =>
            openDocuments({ parentFolderId, create })
          }
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
      );
    });

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      (event.target as HTMLElement).closest(
        'button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role=menu], [role=textbox]',
      )
    )
      return;
    const element = (event.target as HTMLElement).closest('[role="treeitem"]');
    const id = element
      ?.querySelector("[data-connection-id]")
      ?.getAttribute("data-connection-id");
    const documentId = element?.getAttribute("data-document-id");
    const key = documentId
      ? documentRowKey(documentId)
      : id
        ? connectionRowKey(id)
        : selectedDocumentId
          ? documentRowKey(selectedDocumentId)
          : mgr.state.selectedConnection
            ? connectionRowKey(mgr.state.selectedConnection.id)
            : undefined;
    if (event.altKey && !id && !documentId && !mgr.state.selectedConnection)
      return;
    let index = Math.max(
      0,
      rows.findIndex((row) => row.key === key),
    );
    const row = rows[index];
    if (!row) return;
    const connection = row.kind === "connection" ? row.connection : null;
    if (
      row.kind === "document" &&
      (event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        ["Delete", "Backspace", "F2"].includes(event.key))
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.altKey) {
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        connection &&
        mode !== "documents" &&
        documentType === "all" &&
        mgr.handleFolderKeyboardMove(connection.id, event.key)
      ) {
        event.preventDefault();
        setFocusId(connectionRowKey(connection.id));
      }
      return;
    }
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
          connection?.isGroup &&
          !connection.expanded &&
          row.kind === "connection" &&
          !row.expanded
        ) {
          mgr.dispatch({
            type: "UPDATE_CONNECTION",
            payload: { ...connection, expanded: true },
          });
        } else if (rows[index + 1]?.level > row.level) index++;
        break;
      case "ArrowLeft":
        if (
          connection?.isGroup &&
          connection.expanded &&
          !hasActiveConnectionFilter &&
          mode !== "documents" &&
          documentType === "all"
        ) {
          mgr.dispatch({
            type: "UPDATE_CONNECTION",
            payload: { ...connection, expanded: false },
          });
        } else {
          const parentIndex = rows.findIndex(
            (item) => item.key === row.parentKey,
          );
          if (parentIndex >= 0) index = parentIndex;
        }
        break;
      case "Enter":
        if (row.kind === "document") activateDocument(row.document);
        else if (connection?.isGroup)
          mgr.dispatch({
            type: "UPDATE_CONNECTION",
            payload: { ...connection, expanded: !connection.expanded },
          });
        else if (connection) onConnect(connection);
        break;
      case " ":
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = rows[index];
    if (target.kind === "document") selectDocument(target.document);
    else {
      setSelectedDocumentId(null);
      mgr.dispatch({ type: "SELECT_CONNECTION", payload: target.connection });
    }
    setFocusId(target.key);
  };

  return (
    <>
      {documentsEnabled && (
        <>
          <DocumentTreeFilters
            mode={mode}
            documentType={documentType}
            fullText={mgr.settings.searchDocumentContents === true}
            connectionFilters={
              !!(
                mgr.state.filter.protocols.length ||
                mgr.state.filter.tags.length ||
                mgr.state.filter.colorTags.length ||
                mgr.state.filter.showFavorites ||
                mgr.state.filter.showRecent
              )
            }
            onMode={(value) => {
              setEntryFilter(value);
              setDocumentType("all");
              setDocumentNotice("");
            }}
            onType={(value) => {
              setDocumentType(value);
              if (value !== "all") setEntryFilter("documents");
            }}
          />
          {(documentData.loading ||
            documentData.searching ||
            documentData.error ||
            documentNotice) && (
            <div
              className="px-2 py-1 text-xs text-[var(--color-textSecondary)]"
              role="status"
            >
              {documentNotice ||
                documentData.error ||
                (documentData.loading
                  ? "Loading documents…"
                  : "Searching document contents…")}
              {documentData.error && (
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary ml-1"
                  onClick={documentData.retry}
                >
                  Retry documents
                </button>
              )}
              {documentNotice && (
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary ml-1"
                  onClick={() => openDocuments({ scope: "database" })}
                >
                  Open Documents
                </button>
              )}
            </div>
          )}
        </>
      )}
      <div
        ref={treeRef}
        data-testid="connection-tree"
        className={`flex-1 overflow-y-auto select-none ${mgr.draggedId ? "min-h-[100px]" : ""}`}
        data-tauri-disable-drag="true"
        role="tree"
        tabIndex={
          mgr.state.selectedConnectionIds.size === 0 && !selectedDocumentId
            ? 0
            : -1
        }
        aria-label={t("connections.connectionTree", "Connection tree")}
        onContextMenu={mgr.handlePanelContextMenu}
        onDragOver={mgr.handlePanelDragOver}
        onDrop={mgr.handlePanelDrop}
        onKeyDown={handleKeyDown}
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest("[data-connection-item]"))
            setSelectedDocumentId(null);
        }}
        onScroll={
          virtual
            ? (event) => setScrollTop(event.currentTarget.scrollTop)
            : undefined
        }
      >
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-[var(--color-textMuted)]">
            <Monitor size={24} className="mb-2" />
            <p className="text-sm">
              {mode === "documents"
                ? "No matching documents"
                : mode === "all"
                  ? "No matching connections or documents"
                  : t("connections.noConnectionsFound", "No connections found")}
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

      <PanelContextMenu
        mgr={mgr}
        onOpenImport={onOpenImport}
        onDocuments={() => openDocuments()}
      />
      <RenameModal mgr={mgr} />
      <ConnectOptionsModal mgr={mgr} />
    </>
  );
};
