import React, { useState, useRef, useEffect } from "react";
import {
  X,
  XCircle,
  Monitor,
  Terminal,
  Eye,
  Globe,
  Phone,
  Wifi,
  WifiOff,
  ExternalLink,
  ShieldOff,
  Gauge,
  ScrollText,
  Keyboard,
  Network,
  Server,
  Radio,
  TerminalSquare,
  FileCode,
  ListVideo,
  Circle,
  Wrench,
  Pencil,
  RefreshCw,
  Copy,
  ArrowLeft,
  ArrowRight,
  ArrowRightFromLine,
} from "lucide-react";
import { useConnections } from "../../contexts/useConnections";
import { getToolKeyFromProtocol, isToolProtocol } from "../app/toolSession";
import { isWinmgmtProtocol, getWinmgmtToolId, getWindowsToolIcon } from "../windows/WindowsToolPanel";
import MenuSurface from "../ui/overlays/MenuSurface";

const getToolIcon = (toolKey: string) => {
  switch (toolKey) {
    case 'performanceMonitor': return Gauge;
    case 'actionLog': return ScrollText;
    case 'shortcutManager': return Keyboard;
    case 'proxyChain': return Network;
    case 'internalProxy': return Server;
    case 'wol': return Radio;
    case 'bulkSsh': return TerminalSquare;
    case 'scriptManager': return FileCode;
    case 'macroManager': return ListVideo;
    case 'recordingManager': return Circle;
    default: return Wrench;
  }
};

const getProtocolIcon = (protocol: string) => {
  if (isToolProtocol(protocol)) {
    const toolKey = getToolKeyFromProtocol(protocol);
    return toolKey ? getToolIcon(toolKey) : Wrench;
  }
  if (isWinmgmtProtocol(protocol)) {
    const toolId = getWinmgmtToolId(protocol);
    return toolId ? getWindowsToolIcon(toolId) : Monitor;
  }
  switch (protocol) {
    case "rdp":
      return Monitor;
    case "ssh":
      return Terminal;
    case "vnc":
      return Eye;
    case "http":
    case "https":
      return Globe;
    case "telnet":
    case "rlogin":
      return Phone;
    case "winrm":
      return Server;
    default:
      return Monitor;
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case "connected":
      return Wifi;
    case "connecting":
      return Wifi;
    case "disconnected":
    case "error":
      return WifiOff;
    default:
      return WifiOff;
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "connected":
      return "text-success";
    case "connecting":
      return "text-warning animate-pulse";
    case "error":
      return "text-error";
    default:
      return "text-[var(--color-textSecondary)]";
  }
};

interface SessionTabsProps {
  activeSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onSessionDetach: (sessionId: string) => void;
  onSessionReconnect?: (sessionId: string) => void;
  onSessionDuplicate?: (sessionId: string) => void;
  enableReorder?: boolean;
  middleClickCloseTab?: boolean;
}

export const SessionTabs: React.FC<SessionTabsProps> = ({
  activeSessionId,
  onSessionSelect,
  onSessionClose,
  onSessionDetach,
  onSessionReconnect,
  onSessionDuplicate,
  enableReorder = true,
  middleClickCloseTab = true,
}) => {
  const { state, dispatch } = useConnections();
  const sessions = state.sessions.filter((session) => !session.layout?.isDetached);
  const [draggedSessionId, setDraggedSessionId] = React.useState<string | null>(null);
  const [dragOverSessionId, setDragOverSessionId] = React.useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingSessionId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingSessionId]);

  const closeContextMenu = () => setContextMenu(null);

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
  };

  const handleStartRename = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    setRenameValue(session.name);
    setRenamingSessionId(sessionId);
    closeContextMenu();
  };

  const handleCommitRename = () => {
    if (renamingSessionId && renameValue.trim()) {
      const session = state.sessions.find((s) => s.id === renamingSessionId);
      if (session) {
        dispatch({
          type: "UPDATE_SESSION",
          payload: { ...session, name: renameValue.trim() },
        });
      }
    }
    setRenamingSessionId(null);
    setRenameValue("");
  };

  const handleCancelRename = () => {
    setRenamingSessionId(null);
    setRenameValue("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCommitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelRename();
    }
  };

  const handleMoveTab = (sessionId: string, direction: "left" | "right") => {
    const fromIndex = state.sessions.findIndex((s) => s.id === sessionId);
    if (fromIndex === -1) return;
    const toIndex = direction === "left" ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= state.sessions.length) return;
    dispatch({
      type: "REORDER_SESSIONS",
      payload: { fromIndex, toIndex },
    });
    closeContextMenu();
  };

  const handleCloseOtherTabs = (sessionId: string) => {
    sessions.forEach((session) => {
      if (session.id !== sessionId) {
        onSessionClose(session.id);
      }
    });
    closeContextMenu();
  };

  const handleCloseTabsToRight = (sessionId: string) => {
    const idx = sessions.findIndex((s) => s.id === sessionId);
    if (idx === -1) return;
    sessions.slice(idx + 1).forEach((session) => {
      onSessionClose(session.id);
    });
    closeContextMenu();
  };

  const handleCloseSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSessionClose(sessionId);
  };

  const handleMiddleClick = (sessionId: string, e: React.MouseEvent) => {
    // Middle mouse button is button 1
    if (e.button === 1 && middleClickCloseTab) {
      e.preventDefault();
      e.stopPropagation();
      onSessionClose(sessionId);
    }
  };

  const handleDetachSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSessionDetach(sessionId);
  };

  const handleDragStart = (e: React.DragEvent, sessionId: string) => {
    if (!enableReorder) return;
    setDraggedSessionId(sessionId);
    e.dataTransfer.effectAllowed = "all";
    e.dataTransfer.dropEffect = "move";
    e.dataTransfer.setData("text/plain", sessionId);
    e.dataTransfer.setData("application/x-session-tab", sessionId);
  };

  const handleDragOver = (e: React.DragEvent, sessionId: string) => {
    if (!enableReorder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverSessionId(sessionId);
  };

  const handleDragEnd = (e: React.DragEvent, sessionId: string) => {
    // Check if the drop happened outside the window
    const { clientX, clientY } = e;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // If dropped outside the viewport bounds, detach the tab
    const outsideWindow = 
      clientX <= 0 || 
      clientY <= 0 || 
      clientX >= windowWidth || 
      clientY >= windowHeight;
    
    if (outsideWindow && draggedSessionId) {
      onSessionDetach(sessionId);
    }
    
    setDraggedSessionId(null);
    setDragOverSessionId(null);
  };

  const handleDrop = (e: React.DragEvent, dropSessionId: string) => {
    if (!enableReorder) return;
    e.preventDefault();
    if (draggedSessionId && draggedSessionId !== dropSessionId) {
      const fromIndex = state.sessions.findIndex((session) => session.id === draggedSessionId);
      const toIndex = state.sessions.findIndex((session) => session.id === dropSessionId);
      if (fromIndex === -1 || toIndex === -1) return;
      dispatch({
        type: "REORDER_SESSIONS",
        payload: { fromIndex, toIndex },
      });
    }
    setDraggedSessionId(null);
    setDragOverSessionId(null);
  };

  if (sessions.length === 0) {
    return (
      <div className="h-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center justify-center">
        <span className="text-[var(--color-textMuted)] text-sm">No active sessions</span>
      </div>
    );
  }

  return (
    <div className="h-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center overflow-x-auto" data-tauri-disable-drag="true">
      {sessions.map((session) => {
        const ProtocolIcon = getProtocolIcon(session.protocol);
        const StatusIcon = getStatusIcon(session.status);
        const isActive = session.id === activeSessionId;

        return (
          <div
            key={session.id}
            draggable={enableReorder}
            data-tauri-disable-drag="true"
            className={`flex items-center h-full px-3 cursor-pointer border-r border-[var(--color-border)] min-w-0 ${
              isActive
                ? "bg-[var(--color-border)] text-[var(--color-text)]"
                : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]/50"
            } ${
              draggedSessionId === session.id ? "opacity-50" : ""
            } ${
              dragOverSessionId === session.id && draggedSessionId !== session.id
                ? "border-l-2 border-primary"
                : ""
            } transition-all`}
            onClick={() => onSessionSelect(session.id)}
            onAuxClick={(e) => handleMiddleClick(session.id, e)}
            onContextMenu={(e) => handleContextMenu(e, session.id)}
            onDragStart={(e) => handleDragStart(e, session.id)}
            onDragOver={(e) => handleDragOver(e, session.id)}
            onDragEnd={(e) => handleDragEnd(e, session.id)}
            onDrop={(e) => handleDrop(e, session.id)}
          >
            <ProtocolIcon size={14} className="mr-2 flex-shrink-0" />
            {renamingSessionId === session.id ? (
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={handleCommitRename}
                onClick={(e) => e.stopPropagation()}
                className="text-sm mr-2 max-w-32 bg-[var(--color-surface)] border border-[var(--color-borderActive)] rounded px-1 py-0 outline-none text-[var(--color-text)]"
              />
            ) : (
              <span className="truncate text-sm mr-2 max-w-32">
                {session.name}
              </span>
            )}
            {(() => {
              const conn = state.connections.find(c => c.id === session.connectionId);
              if (conn && (conn.protocol === 'https') && conn.httpVerifySsl === false) {
                return (
                  <span title="SSL verification disabled" className="flex-shrink-0 mr-1">
                    <ShieldOff size={12} className="text-error" />
                  </span>
                );
              }
              return null;
            })()}
            {!isToolProtocol(session.protocol) && (
              <>
                <StatusIcon
                  size={12}
                  className={`mr-2 flex-shrink-0 ${getStatusColor(session.status)}`}
                />
                <button
                  onClick={(e) => handleDetachSession(session.id, e)}
                  className="flex-shrink-0 p-1 hover:bg-[var(--color-border)] rounded transition-colors"
                  data-tooltip="Detach"
                >
                  <ExternalLink size={12} />
                </button>
              </>
            )}
            <button
              onClick={(e) => handleCloseSession(session.id, e)}
              className="flex-shrink-0 p-1 hover:bg-[var(--color-border)] rounded transition-colors"
              data-tooltip="Close"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}

      {/* Tab context menu */}
      <MenuSurface
        isOpen={contextMenu !== null}
        onClose={closeContextMenu}
        position={contextMenu}
        className="min-w-[180px]"
        dataTestId="session-tab-context-menu"
      >
        {contextMenu && (() => {
          const sessionId = contextMenu.sessionId;
          const sessionIndex = sessions.findIndex((s) => s.id === sessionId);
          const isFirst = sessionIndex === 0;
          const isLast = sessionIndex === sessions.length - 1;
          const hasTabsToRight = sessionIndex < sessions.length - 1;
          const hasOtherTabs = sessions.length > 1;

          return (
            <>
              <button
                onClick={() => handleStartRename(sessionId)}
                className="sor-menu-item"
              >
                <Pencil size={14} className="mr-2" />
                Rename Tab
              </button>
              {onSessionReconnect && (
                <button
                  onClick={() => { onSessionReconnect(sessionId); closeContextMenu(); }}
                  className="sor-menu-item"
                >
                  <RefreshCw size={14} className="mr-2" />
                  Reconnect
                </button>
              )}
              {onSessionDuplicate && (
                <button
                  onClick={() => { onSessionDuplicate(sessionId); closeContextMenu(); }}
                  className="sor-menu-item"
                >
                  <Copy size={14} className="mr-2" />
                  Duplicate Tab
                </button>
              )}
              <div className="sor-menu-divider" />
              <button
                onClick={() => { onSessionDetach(sessionId); closeContextMenu(); }}
                className="sor-menu-item"
              >
                <ExternalLink size={14} className="mr-2" />
                Detach to Window
              </button>
              <button
                onClick={() => handleMoveTab(sessionId, "left")}
                className={`sor-menu-item ${isFirst ? "opacity-40 pointer-events-none" : ""}`}
                disabled={isFirst}
              >
                <ArrowLeft size={14} className="mr-2" />
                Move to Left
              </button>
              <button
                onClick={() => handleMoveTab(sessionId, "right")}
                className={`sor-menu-item ${isLast ? "opacity-40 pointer-events-none" : ""}`}
                disabled={isLast}
              >
                <ArrowRight size={14} className="mr-2" />
                Move to Right
              </button>
              <div className="sor-menu-divider" />
              <button
                onClick={() => { onSessionClose(sessionId); closeContextMenu(); }}
                className="sor-menu-item sor-menu-item-danger"
              >
                <X size={14} className="mr-2" />
                Close Tab
              </button>
              <button
                onClick={() => handleCloseOtherTabs(sessionId)}
                className={`sor-menu-item sor-menu-item-danger ${!hasOtherTabs ? "opacity-40 pointer-events-none" : ""}`}
                disabled={!hasOtherTabs}
              >
                <XCircle size={14} className="mr-2" />
                Close Other Tabs
              </button>
              <button
                onClick={() => handleCloseTabsToRight(sessionId)}
                className={`sor-menu-item sor-menu-item-danger ${!hasTabsToRight ? "opacity-40 pointer-events-none" : ""}`}
                disabled={!hasTabsToRight}
              >
                <ArrowRightFromLine size={14} className="mr-2" />
                Close Tabs to Right
              </button>
            </>
          );
        })()}
      </MenuSurface>
    </div>
  );
};
