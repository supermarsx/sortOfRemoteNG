import React from "react";
import {
  X,
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
} from "lucide-react";
import { useConnections } from "../contexts/useConnections";
import { isToolProtocol, getToolKeyFromProtocol } from "./ToolPanel";

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
      return "text-green-400";
    case "connecting":
      return "text-yellow-400 animate-pulse";
    case "error":
      return "text-red-400";
    default:
      return "text-[var(--color-textSecondary)]";
  }
};

interface SessionTabsProps {
  activeSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onSessionDetach: (sessionId: string) => void;
  enableReorder?: boolean;
  middleClickCloseTab?: boolean;
}

export const SessionTabs: React.FC<SessionTabsProps> = ({
  activeSessionId,
  onSessionSelect,
  onSessionClose,
  onSessionDetach,
  enableReorder = true,
  middleClickCloseTab = true,
}) => {
  const { state, dispatch } = useConnections();
  const sessions = state.sessions.filter((session) => !session.layout?.isDetached);
  const [draggedSessionId, setDraggedSessionId] = React.useState<string | null>(null);
  const [dragOverSessionId, setDragOverSessionId] = React.useState<string | null>(null);

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
        <span className="text-gray-500 text-sm">No active sessions</span>
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
                ? "border-l-2 border-blue-500"
                : ""
            } transition-all`}
            onClick={() => onSessionSelect(session.id)}
            onAuxClick={(e) => handleMiddleClick(session.id, e)}
            onDragStart={(e) => handleDragStart(e, session.id)}
            onDragOver={(e) => handleDragOver(e, session.id)}
            onDragEnd={(e) => handleDragEnd(e, session.id)}
            onDrop={(e) => handleDrop(e, session.id)}
          >
            <ProtocolIcon size={14} className="mr-2 flex-shrink-0" />
            <span className="truncate text-sm mr-2 max-w-32">
              {session.name}
            </span>
            {(() => {
              const conn = state.connections.find(c => c.id === session.connectionId);
              if (conn && (conn.protocol === 'https') && conn.httpVerifySsl === false) {
                return (
                  <span title="SSL verification disabled" className="flex-shrink-0 mr-1">
                    <ShieldOff size={12} className="text-red-400" />
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
                  title="Detach"
                >
                  <ExternalLink size={12} />
                </button>
              </>
            )}
            <button
              onClick={(e) => handleCloseSession(session.id, e)}
              className="flex-shrink-0 p-1 hover:bg-[var(--color-border)] rounded transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
