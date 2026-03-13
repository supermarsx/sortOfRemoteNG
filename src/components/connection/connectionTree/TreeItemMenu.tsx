
import React from "react";
import MenuSurface from "../../ui/overlays/MenuSurface";
import { useConnections } from "../../../contexts/useConnections";
import type { Connection } from "../../../types/connection/connection";
import {
  Activity, ChevronRight, ClipboardList, Cog, Copy, Cpu, Edit,
  ExternalLink, FileDown, FileText, HardDrive, Monitor, Play,
  Power, SlidersHorizontal, Star, Terminal, Trash2, UserX,
} from "lucide-react";
function TreeItemMenu({
  connection, activeSession, showMenu, menuPosition, triggerRef, onClose,
  onConnect, onDisconnect, onEdit, onDelete, onCopyHostname, onRename,
  onExport, onConnectWithOptions, onConnectWithoutCredentials,
  onExecuteScripts, onDiagnostics, onDetachSession, onDuplicate, onWindowsTool,
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
  onDiagnostics?: (c: Connection) => void;
  onDetachSession?: (sessionId: string) => void;
  onDuplicate: (c: Connection) => void;
  onWindowsTool?: (c: Connection, tool: string) => void;
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
          {onDiagnostics && <button onClick={act(() => onDiagnostics(connection))} className="sor-menu-item">
            <Activity size={14} className="mr-2" />Diagnostics
          </button>}
          {activeSession && onDetachSession && (
            <button onClick={act(() => onDetachSession(activeSession.id))} className="sor-menu-item">
              <ExternalLink size={14} className="mr-2" />Detach window
            </button>
          )}
        </>
      )}
      {/* Windows Management submenu */}
      {!connection.isGroup && (connection.osType === 'windows' || (!connection.osType && connection.protocol === 'rdp')) && (
        <>
          <div className="sor-menu-divider" />
          <div className="sor-menu-submenu">
            <button className="sor-menu-submenu-trigger">
              <Monitor size={14} className="mr-2" />
              Windows Management
              <ChevronRight size={12} className="ml-auto opacity-50" />
            </button>
            <div className="sor-menu-submenu-panel">
              <div className="sor-menu-submenu-label">Remote Tools</div>
              <button onClick={act(() => onWindowsTool?.(connection, 'services'))} className="sor-menu-item">
                <Cog size={14} className="mr-2" />Services
              </button>
              <button onClick={act(() => onWindowsTool?.(connection, 'processes'))} className="sor-menu-item">
                <Cpu size={14} className="mr-2" />Processes
              </button>
              <button onClick={act(() => onWindowsTool?.(connection, 'eventlog'))} className="sor-menu-item">
                <FileText size={14} className="mr-2" />Event Viewer
              </button>
              <button onClick={act(() => onWindowsTool?.(connection, 'registry'))} className="sor-menu-item">
                <HardDrive size={14} className="mr-2" />Registry
              </button>
              <button onClick={act(() => onWindowsTool?.(connection, 'tasks'))} className="sor-menu-item">
                <ClipboardList size={14} className="mr-2" />Scheduled Tasks
              </button>
              <button onClick={act(() => onWindowsTool?.(connection, 'perfmon'))} className="sor-menu-item">
                <Activity size={14} className="mr-2" />Performance
              </button>
              <div className="sor-menu-divider" />
              <button onClick={act(() => onWindowsTool?.(connection, 'powershell'))} className="sor-menu-item">
                <Terminal size={14} className="mr-2" />PowerShell
              </button>
              <button onClick={act(() => onWindowsTool?.(connection, 'sysinfo'))} className="sor-menu-item">
                <Monitor size={14} className="mr-2" />System Info
              </button>
            </div>
          </div>
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
            className={`mr-2 ${connection.favorite ? "text-warning" : "text-[var(--color-textSecondary)]"}`}
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

export default TreeItemMenu;
