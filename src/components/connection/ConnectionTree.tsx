import React, { useCallback, useEffect } from "react";
import { Monitor } from "lucide-react";
import { useConnectionTree } from "../../hooks/connection/useConnectionTree";
import { useToastContext } from "../../contexts/ToastContext";
import type { Connection } from "../../types/connection/connection";
import { createWinmgmtSession, type WindowsToolId } from "../windows/WindowsToolPanel";
import ConnectionTreeItem from "./connectionTree/ConnectionTreeItem";
import RenameModal from "./connectionTree/RenameModal";
import ConnectOptionsModal from "./connectionTree/ConnectOptionsModal";
import PanelContextMenu from "./connectionTree/PanelContextMenu";

interface ConnectionTreeProps {
  onConnect: (connection: Connection) => void;
  onDisconnect: (connection: Connection) => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onDiagnostics?: (connection: Connection) => void;
  onSessionDetach?: (id: string) => void;
  onOpenImport?: () => void;
  onActivateSession?: (sessionId: string) => void;
  enableReorder?: boolean;
}

export const ConnectionTree: React.FC<ConnectionTreeProps> = ({
  onConnect, onDisconnect, onEdit, onDelete, onDiagnostics,
  onSessionDetach, onOpenImport, onActivateSession, enableReorder = true,
}) => {
  const mgr = useConnectionTree(onConnect, enableReorder);
  const { toast } = useToastContext();

  useEffect(() => {
    const handler = (e: Event) => {
      const connectionId = (e as CustomEvent).detail?.connectionId;
      if (!connectionId) return;
      const el = document.querySelector(`[data-connection-id="${connectionId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('sor-tree-item-blink');
      const timer = setTimeout(() => el.classList.remove('sor-tree-item-blink'), 2000);
      return () => clearTimeout(timer);
    };
    window.addEventListener('reveal-connection', handler);
    return () => window.removeEventListener('reveal-connection', handler);
  }, []);

  const handleConnectAll = useCallback((folder: Connection) => {
    const children = mgr.state.connections.filter(c => c.parentId === folder.id && !c.isGroup);
    children.forEach((conn, i) => {
      setTimeout(() => onConnect(conn), i * 200);
    });
  }, [mgr.state.connections, onConnect]);

  const handleConnectAllRecursive = useCallback((folder: Connection) => {
    const collectConnections = (parentId: string): Connection[] => {
      const result: Connection[] = [];
      for (const conn of mgr.state.connections) {
        if (conn.parentId === parentId) {
          if (conn.isGroup) {
            result.push(...collectConnections(conn.id));
          } else {
            result.push(conn);
          }
        }
      }
      return result;
    };
    const allConns = collectConnections(folder.id);
    allConns.forEach((conn, i) => {
      setTimeout(() => onConnect(conn), i * 200);
    });
  }, [mgr.state.connections, onConnect]);

  const handleWindowsTool = useCallback((c: Connection, tool: string) => {
    const session = createWinmgmtSession(
      tool as WindowsToolId,
      c.id,
      c.name,
      c.hostname || c.name,
    );
    mgr.dispatch({ type: 'ADD_SESSION', payload: session });

    // Per-connection focusOnWinmgmtTool overrides the global setting
    const shouldFocus = c.focusOnWinmgmtTool ?? !mgr.settings.openWinmgmtToolInBackground;
    if (shouldFocus && onActivateSession) {
      onActivateSession(session.id);
    }
  }, [mgr, onActivateSession]);

  const renderTree = (connections: Connection[], level: number = 0): React.ReactNode => {
    return connections.map((connection) => (
      <div key={connection.id}>
        <ConnectionTreeItem
          connection={connection}
          level={level}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onEdit={onEdit}
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
          onWindowsTool={handleWindowsTool}
          onConnectAll={handleConnectAll}
          onConnectAllRecursive={handleConnectAllRecursive}
          enableReorder={enableReorder}
          isDragging={mgr.draggedId === connection.id}
          isDragOver={mgr.dragOverId === connection.id && mgr.draggedId !== connection.id}
          dropPosition={mgr.dragOverId === connection.id && mgr.draggedId !== connection.id ? mgr.dropPosition : null}
          singleClickConnect={mgr.settings.singleClickConnect}
          singleClickDisconnect={mgr.settings.singleClickDisconnect}
          doubleClickRename={mgr.settings.doubleClickRename}
          onDragStart={mgr.handleItemDragStart}
          onDragOver={mgr.handleItemDragOver}
          onDragLeave={() => { /* let next dragOver set the new target */ }}
          onDragEnd={mgr.handleItemDragEnd}
          onDrop={mgr.handleItemDrop}
        />
        {connection.isGroup && connection.expanded && (
          <div>{renderTree(mgr.buildTree(mgr.state.connections, connection.id), level + 1)}</div>
        )}
      </div>
    ));
  };

  return (
    <>
      <div
        className={`flex-1 overflow-y-auto ${mgr.draggedId ? "min-h-[100px]" : ""}`}
        data-tauri-disable-drag="true"
        onContextMenu={mgr.handlePanelContextMenu}
        onDragOver={mgr.handlePanelDragOver}
        onDrop={mgr.handlePanelDrop}
      >
        {mgr.filteredConnections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-[var(--color-textMuted)]">
            <Monitor size={24} className="mb-2" />
            <p className="text-sm">No connections found</p>
          </div>
        ) : (
          renderTree(mgr.buildTree(mgr.filteredConnections))
        )}
      </div>

      <PanelContextMenu mgr={mgr} onOpenImport={onOpenImport} />
      <RenameModal mgr={mgr} />
      <ConnectOptionsModal mgr={mgr} />
    </>
  );
};

