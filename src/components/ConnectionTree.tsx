import React, { useState, useRef } from "react";
import { PasswordInput } from "./ui/PasswordInput";
import {
  ChevronRight,
  ChevronDown,
  Monitor,
  Terminal,
  Eye,
  Globe,
  Phone,
  Folder,
  FolderOpen,
  MoreVertical,
  Edit,
  Trash2,
  Copy,
  Play,
  Power,
  Database,
  Star,
  Cloud,
  ExternalLink,
  FileDown,
  HardDrive,
  Server,
  Shield,
  SlidersHorizontal,
  UserX,
  Activity,
  Upload,
  X,
} from "lucide-react";
import { Connection } from "../types/connection";
import { useConnections } from "../contexts/useConnections";
import { Modal, ModalHeader } from "./ui/Modal";
import { MenuSurface } from "./ui/MenuSurface";
import { useConnectionTree, type ConnectionTreeMgr } from "../hooks/useConnectionTree";

/* ── Static helpers (module-level) ─────────────────────────────── */

const getProtocolIcon = (protocol: string) => {
  switch (protocol) {
    case "rdp": return Monitor;
    case "ssh": return Terminal;
    case "vnc": return Eye;
    case "http": case "https": return Globe;
    case "telnet": case "rlogin": return Phone;
    case "mysql": return Database;
    default: return Monitor;
  }
};

const iconRegistry: Record<string, typeof Monitor> = {
  monitor: Monitor, terminal: Terminal, globe: Globe, database: Database,
  server: Server, shield: Shield, cloud: Cloud, folder: Folder,
  star: Star, drive: HardDrive,
};

const getConnectionIcon = (connection: Connection) => {
  const key = (connection.icon || "").toLowerCase();
  if (key && iconRegistry[key]) return iconRegistry[key];
  return getProtocolIcon(connection.protocol);
};

const getStatusColor = (status?: string) => {
  switch (status) {
    case "connected": return "text-green-400";
    case "connecting": return "text-yellow-400";
    case "error": return "text-red-400";
    default: return "text-[var(--color-textSecondary)]";
  }
};

/* ── ConnectionTreeItem ────────────────────────────────────────── */

interface ConnectionTreeItemProps {
  connection: Connection;
  level: number;
  onConnect: (connection: Connection) => void;
  onDisconnect: (connection: Connection) => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onCopyHostname: (connection: Connection) => void;
  onRename: (connection: Connection) => void;
  onExport: (connection: Connection) => void;
  onConnectWithOptions: (connection: Connection) => void;
  onConnectWithoutCredentials: (connection: Connection) => void;
  onExecuteScripts: (connection: Connection, sessionId?: string) => void;
  onDiagnostics: (connection: Connection) => void;
  onDetachSession: (sessionId: string) => void;
  onDuplicate: (connection: Connection) => void;
  enableReorder: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  dropPosition: "before" | "after" | "inside" | null;
  onDragStart: (connectionId: string) => void;
  onDragOver: (connectionId: string, position: "before" | "after" | "inside") => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onDrop: (connectionId: string, position: "before" | "after" | "inside") => void;
  singleClickConnect?: boolean;
  singleClickDisconnect?: boolean;
  doubleClickRename?: boolean;
}

const ConnectionTreeItem: React.FC<ConnectionTreeItemProps> = ({
  connection, level,
  onConnect, onDisconnect, onEdit, onDelete, onCopyHostname, onRename, onExport,
  onConnectWithOptions, onConnectWithoutCredentials, onExecuteScripts,
  onDiagnostics, onDetachSession, onDuplicate,
  enableReorder, isDragging, isDragOver, dropPosition,
  onDragStart, onDragOver, onDragLeave, onDragEnd, onDrop,
  singleClickConnect, singleClickDisconnect, doubleClickRename,
}) => {
  const { state, dispatch } = useConnections();
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(connection.expanded || false);

  const ProtocolIcon = getConnectionIcon(connection);
  const isSelected = state.selectedConnection?.id === connection.id;
  const activeSession = state.sessions.find((s) => s.connectionId === connection.id);

  const handleToggleExpand = () => {
    if (connection.isGroup) {
      setIsExpanded(!isExpanded);
      dispatch({ type: "UPDATE_CONNECTION", payload: { ...connection, expanded: !isExpanded } });
    }
  };

  const handleSelect = () => {
    dispatch({ type: "SELECT_CONNECTION", payload: connection });
    if (!connection.isGroup) {
      if (activeSession && singleClickDisconnect) onDisconnect(connection);
      else if (!activeSession && singleClickConnect) onConnect(connection);
    }
  };

  const handleDoubleClick = () => {
    if (connection.isGroup) return;
    if (doubleClickRename) onRename(connection);
    else onConnect(connection);
  };

  const calcDropPosition = (clientY: number, rect: DOMRect): "before" | "after" | "inside" => {
    const y = clientY - rect.top;
    const height = rect.height;
    if (connection.isGroup) {
      if (y < height * 0.25) return "before";
      if (y > height * 0.75) return "after";
      return "inside";
    }
    return y < height * 0.5 ? "before" : "after";
  };

  return (
    <div className="relative">
      <div
        data-connection-item="true"
        data-tauri-disable-drag="true"
        className={`group flex items-center h-8 px-2 cursor-pointer hover:bg-[var(--color-border)]/50 transition-colors relative ${
          isSelected ? "bg-blue-600/20 text-blue-400" : "text-[var(--color-textSecondary)]"
        } ${isDragging ? "opacity-50 scale-95" : ""} ${
          isDragOver && dropPosition === "inside" ? "bg-blue-500/20 ring-2 ring-blue-500/50 ring-inset" : ""
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleSelect}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenuPosition({ x: e.clientX, y: e.clientY }); setShowMenu(true); }}
        draggable={enableReorder}
        onDragStart={(e) => {
          if (!enableReorder) return;
          e.dataTransfer.effectAllowed = "all";
          e.dataTransfer.dropEffect = "move";
          e.dataTransfer.setData("text/plain", connection.id);
          onDragStart(connection.id);
        }}
        onDragOver={(e) => {
          if (!enableReorder) return;
          e.preventDefault(); e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          onDragOver(connection.id, calcDropPosition(e.clientY, e.currentTarget.getBoundingClientRect()));
        }}
        onDragLeave={(e) => {
          const relatedTarget = e.relatedTarget as HTMLElement;
          if (!e.currentTarget.contains(relatedTarget)) onDragLeave();
        }}
        onDragEnd={onDragEnd}
        onDrop={(e) => {
          if (!enableReorder) return;
          e.preventDefault(); e.stopPropagation();
          onDrop(connection.id, calcDropPosition(e.clientY, e.currentTarget.getBoundingClientRect()));
        }}
      >
        {isDragOver && dropPosition === "before" && <div className="absolute left-0 right-0 top-0 h-0.5 bg-blue-500 z-10" />}
        {isDragOver && dropPosition === "after" && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500 z-10" />}

        {connection.isGroup && (
          <button
            onClick={handleToggleExpand}
            className="flex items-center justify-center w-4 h-4 mr-1 hover:bg-[var(--color-border)] rounded transition-colors"
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}

        <div className="flex items-center min-w-0 flex-1">
          {connection.isGroup ? (
            isExpanded ? <FolderOpen size={16} className="mr-2 text-yellow-400" /> : <Folder size={16} className="mr-2 text-yellow-400" />
          ) : (
            <ProtocolIcon size={16} className={`mr-2 ${getStatusColor(activeSession?.status)}`} />
          )}
          <span className="truncate text-sm">{connection.name}</span>
          {activeSession && (
            <div className={`ml-2 w-2 h-2 rounded-full ${
              activeSession.status === "connected" ? "bg-green-400"
                : activeSession.status === "connecting" ? "bg-yellow-400" : "bg-red-400"
            }`} />
          )}
        </div>

        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
          {!connection.isGroup && (
            activeSession ? (
              <button onClick={(e) => { e.stopPropagation(); onDisconnect(connection); }} className="p-1 hover:bg-[var(--color-border)] rounded transition-colors" data-tooltip="Disconnect"><Power size={12} /></button>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); onConnect(connection); }} className="p-1 hover:bg-[var(--color-border)] rounded transition-colors" data-tooltip="Connect"><Play size={12} /></button>
            )
          )}
          <button
            ref={triggerRef}
            onClick={(e) => {
              e.stopPropagation();
              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
              setMenuPosition({ x: Math.max(8, rect.right - 140), y: rect.bottom + 6 });
              setShowMenu((prev) => !prev);
            }}
            className="p-1 hover:bg-[var(--color-border)] rounded transition-colors"
          >
            <MoreVertical size={12} />
          </button>
        </div>

        {showMenu && (
          <TreeItemMenu
            connection={connection}
            activeSession={activeSession}
            showMenu={showMenu}
            menuPosition={menuPosition}
            triggerRef={triggerRef}
            onClose={() => setShowMenu(false)}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onEdit={onEdit}
            onDelete={onDelete}
            onCopyHostname={onCopyHostname}
            onRename={onRename}
            onExport={onExport}
            onConnectWithOptions={onConnectWithOptions}
            onConnectWithoutCredentials={onConnectWithoutCredentials}
            onExecuteScripts={onExecuteScripts}
            onDiagnostics={onDiagnostics}
            onDetachSession={onDetachSession}
            onDuplicate={onDuplicate}
          />
        )}
      </div>
    </div>
  );
};

/* ── TreeItemMenu ──────────────────────────────────────────────── */

function TreeItemMenu({
  connection, activeSession, showMenu, menuPosition, triggerRef, onClose,
  onConnect, onDisconnect, onEdit, onDelete, onCopyHostname, onRename,
  onExport, onConnectWithOptions, onConnectWithoutCredentials,
  onExecuteScripts, onDiagnostics, onDetachSession, onDuplicate,
}: {
  connection: Connection;
  activeSession: { id: string; status: string } | undefined;
  showMenu: boolean;
  menuPosition: { x: number; y: number } | null;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onConnect: (c: Connection) => void;
  onDisconnect: (c: Connection) => void;
  onEdit: (c: Connection) => void;
  onDelete: (c: Connection) => void;
  onCopyHostname: (c: Connection) => void;
  onRename: (c: Connection) => void;
  onExport: (c: Connection) => void;
  onConnectWithOptions: (c: Connection) => void;
  onConnectWithoutCredentials: (c: Connection) => void;
  onExecuteScripts: (c: Connection, sessionId?: string) => void;
  onDiagnostics: (c: Connection) => void;
  onDetachSession: (sessionId: string) => void;
  onDuplicate: (c: Connection) => void;
}) {
  const { dispatch } = useConnections();
  const act = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); onClose(); };

  return (
    <MenuSurface
      isOpen={showMenu}
      onClose={onClose}
      position={menuPosition}
      ignoreRefs={[triggerRef]}
      className="min-w-[140px]"
      dataTestId="connection-tree-item-menu"
    >
      {!connection.isGroup && (
        <button onClick={act(() => activeSession ? onDisconnect(connection) : onConnect(connection))} className="sor-menu-item">
          {activeSession ? <Power size={14} className="mr-2" /> : <Play size={14} className="mr-2" />}
          {activeSession ? "Disconnect" : "Connect"}
        </button>
      )}
      {!connection.isGroup && (
        <>
          <button onClick={act(() => onConnectWithOptions(connection))} className="sor-menu-item">
            <SlidersHorizontal size={14} className="mr-2" />Connect with options
          </button>
          <button onClick={act(() => onConnectWithoutCredentials(connection))} className="sor-menu-item">
            <UserX size={14} className="mr-2" />Connect without credentials
          </button>
          <button onClick={act(() => onExecuteScripts(connection, activeSession?.id))} className="sor-menu-item">
            <Play size={14} className="mr-2" />Execute scripts
          </button>
          <button onClick={act(() => onDiagnostics(connection))} className="sor-menu-item">
            <Activity size={14} className="mr-2" />Diagnostics
          </button>
          {activeSession && (
            <button onClick={act(() => onDetachSession(activeSession.id))} className="sor-menu-item">
              <ExternalLink size={14} className="mr-2" />Detach window
            </button>
          )}
        </>
      )}
      {!connection.isGroup && <div className="sor-menu-divider" />}
      <button onClick={act(() => onEdit(connection))} className="sor-menu-item">
        <Edit size={14} className="mr-2" />Edit
      </button>
      <button onClick={act(() => onRename(connection))} className="sor-menu-item">
        <Edit size={14} className="mr-2" />Rename
      </button>
      {!connection.isGroup && (
        <button
          onClick={act(() => dispatch({ type: "UPDATE_CONNECTION", payload: { ...connection, favorite: !connection.favorite } }))}
          className="sor-menu-item"
        >
          <Star
            size={12}
            className={`mr-2 ${connection.favorite ? "text-yellow-300" : "text-[var(--color-textSecondary)]"}`}
            fill={connection.favorite ? "currentColor" : "none"}
          />
          {connection.favorite ? "Remove favorite" : "Add to favorites"}
        </button>
      )}
      {!connection.isGroup && (
        <button onClick={act(() => onCopyHostname(connection))} className="sor-menu-item">
          <Copy size={14} className="mr-2" />Copy hostname
        </button>
      )}
      {!connection.isGroup && (
        <button onClick={act(() => onExport(connection))} className="sor-menu-item">
          <FileDown size={14} className="mr-2" />Export to file
        </button>
      )}
      <button onClick={act(() => onDuplicate(connection))} className="sor-menu-item">
        <Copy size={14} className="mr-2" />Duplicate
      </button>
      <div className="sor-menu-divider" />
      <button onClick={act(() => onDelete(connection))} className="sor-menu-item sor-menu-item-danger">
        <Trash2 size={14} className="mr-2" />Delete
      </button>
    </MenuSurface>
  );
}

/* ── RenameModal ───────────────────────────────────────────────── */

function RenameModal({ mgr }: { mgr: ConnectionTreeMgr }) {
  if (!mgr.renameTarget) return null;
  return (
    <Modal
      isOpen={Boolean(mgr.renameTarget)}
      onClose={() => mgr.setRenameTarget(null)}
      panelClassName="max-w-md mx-4"
      dataTestId="connection-tree-rename-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full relative">
        <ModalHeader
          onClose={() => mgr.setRenameTarget(null)}
          className="relative h-12 border-b border-[var(--color-border)]"
          titleClassName="absolute left-5 top-3 text-sm font-semibold text-[var(--color-text)]"
          title="Rename Connection"
        />
        <div className="p-6">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-2">Connection Name</label>
          <input
            type="text"
            autoFocus
            value={mgr.renameValue}
            onChange={(e) => mgr.setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); mgr.handleRenameSubmit(); } }}
            className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="New name"
          />
          <div className="flex justify-end space-x-3 mt-6">
            <button type="button" onClick={() => mgr.setRenameTarget(null)} className="px-4 py-2 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-md transition-colors">Cancel</button>
            <button type="button" onClick={mgr.handleRenameSubmit} className="px-4 py-2 text-[var(--color-text)] bg-blue-600 hover:bg-blue-700 rounded-md transition-colors">Save</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── ConnectOptionsModal ───────────────────────────────────────── */

function ConnectOptionsModal({ mgr }: { mgr: ConnectionTreeMgr }) {
  if (!mgr.connectOptionsTarget || !mgr.connectOptionsData) return null;
  const target = mgr.connectOptionsTarget;
  const data = mgr.connectOptionsData;
  const update = (patch: Partial<typeof data>) => mgr.setConnectOptionsData({ ...data, ...patch });
  const close = () => { mgr.setConnectOptionsTarget(null); mgr.setConnectOptionsData(null); };

  return (
    <Modal
      isOpen={Boolean(mgr.connectOptionsTarget && mgr.connectOptionsData)}
      onClose={close}
      closeOnEscape={false}
      panelClassName="max-w-md mx-4"
      dataTestId="connection-tree-connect-options-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Connect with Options</h3>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Username</label>
            <input
              type="text"
              value={data.username}
              onChange={(e) => update({ username: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          {target.protocol === "ssh" ? (
            <>
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Auth Type</label>
                <select
                  value={data.authType}
                  onChange={(e) => update({ authType: e.target.value as "password" | "key" })}
                  className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="password">Password</option>
                  <option value="key">Private Key</option>
                </select>
              </div>
              {data.authType === "password" ? (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Password</label>
                  <PasswordInput
                    value={data.password}
                    onChange={(e) => update({ password: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Private Key</label>
                    <textarea
                      value={data.privateKey}
                      onChange={(e) => update({ privateKey: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Passphrase (optional)</label>
                    <PasswordInput
                      value={data.passphrase}
                      onChange={(e) => update({ passphrase: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </>
              )}
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Password</label>
              <PasswordInput
                value={data.password}
                onChange={(e) => update({ password: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <input type="checkbox" checked={data.saveToConnection} onChange={(e) => update({ saveToConnection: e.target.checked })} />
            <span>Save credentials to this connection</span>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="px-3 py-2 text-sm text-[var(--color-textSecondary)] bg-[var(--color-border)] hover:bg-[var(--color-border)] rounded-md">Cancel</button>
            <button type="button" onClick={mgr.handleConnectOptionsSubmit} className="px-3 py-2 text-sm text-[var(--color-text)] bg-blue-600 hover:bg-blue-700 rounded-md">Connect</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── PanelContextMenu ──────────────────────────────────────────── */

function PanelContextMenu({ mgr, onOpenImport }: { mgr: ConnectionTreeMgr; onOpenImport?: () => void }) {
  if (!mgr.panelMenuPosition || !onOpenImport) return null;
  return (
    <MenuSurface
      isOpen={Boolean(mgr.panelMenuPosition && onOpenImport)}
      onClose={() => mgr.setPanelMenuPosition(null)}
      position={mgr.panelMenuPosition}
      className="min-w-[160px] rounded-lg py-1"
      dataTestId="connection-tree-panel-menu"
    >
      <button
        onClick={() => { onOpenImport(); mgr.setPanelMenuPosition(null); }}
        className="sor-menu-item"
      >
        <Upload size={14} />
        Import Connections
      </button>
    </MenuSurface>
  );
}

/* ── Root component ────────────────────────────────────────────── */

interface ConnectionTreeProps {
  onConnect: (connection: Connection) => void;
  onDisconnect: (connection: Connection) => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onDiagnostics: (connection: Connection) => void;
  onSessionDetach: (sessionId: string) => void;
  onOpenImport?: () => void;
  enableReorder?: boolean;
}

export const ConnectionTree: React.FC<ConnectionTreeProps> = ({
  onConnect, onDisconnect, onEdit, onDelete, onDiagnostics,
  onSessionDetach, onOpenImport, enableReorder = true,
}) => {
  const mgr = useConnectionTree(onConnect, enableReorder);

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
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
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
