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
} from "lucide-react";
import { useConnections } from "../contexts/useConnections";

const getProtocolIcon = (protocol: string) => {
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
      return "text-gray-400";
  }
};

interface SessionTabsProps {
  activeSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onSessionDetach: (sessionId: string) => void;
  enableReorder?: boolean;
}

export const SessionTabs: React.FC<SessionTabsProps> = ({
  activeSessionId,
  onSessionSelect,
  onSessionClose,
  onSessionDetach,
  enableReorder = true,
}) => {
  const { state, dispatch } = useConnections();
  const sessions = state.sessions.filter((session) => !session.layout?.isDetached);
  const [draggedSessionId, setDraggedSessionId] = React.useState<string | null>(null);
  const [dragOverSessionId, setDragOverSessionId] = React.useState<string | null>(null);

  const handleCloseSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSessionClose(sessionId);
  };

  const handleDetachSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSessionDetach(sessionId);
  };

  const handleDragStart = (e: React.DragEvent, sessionId: string) => {
    if (!enableReorder) return;
    setDraggedSessionId(sessionId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, sessionId: string) => {
    if (!enableReorder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverSessionId(sessionId);
  };

  const handleDragEnd = () => {
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
      <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center justify-center">
        <span className="text-gray-500 text-sm">No active sessions</span>
      </div>
    );
  }

  return (
    <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center overflow-x-auto">
      {sessions.map((session) => {
        const ProtocolIcon = getProtocolIcon(session.protocol);
        const StatusIcon = getStatusIcon(session.status);
        const isActive = session.id === activeSessionId;

        return (
          <div
            key={session.id}
            draggable={enableReorder}
            className={`flex items-center h-full px-3 cursor-pointer border-r border-gray-700 min-w-0 ${
              isActive
                ? "bg-gray-700 text-white"
                : "text-gray-300 hover:bg-gray-700/50"
            } ${
              draggedSessionId === session.id ? "opacity-50" : ""
            } ${
              dragOverSessionId === session.id && draggedSessionId !== session.id
                ? "border-l-2 border-blue-500"
                : ""
            } transition-all`}
            onClick={() => onSessionSelect(session.id)}
            onDragStart={(e) => handleDragStart(e, session.id)}
            onDragOver={(e) => handleDragOver(e, session.id)}
            onDragEnd={handleDragEnd}
            onDrop={(e) => handleDrop(e, session.id)}
          >
            <ProtocolIcon size={14} className="mr-2 flex-shrink-0" />
            <span className="truncate text-sm mr-2 max-w-32">
              {session.name}
            </span>
            <StatusIcon
              size={12}
              className={`mr-2 flex-shrink-0 ${getStatusColor(session.status)}`}
            />
            <button
              onClick={(e) => handleDetachSession(session.id, e)}
              className="flex-shrink-0 p-1 hover:bg-gray-600 rounded transition-colors"
              title="Detach"
            >
              <ExternalLink size={12} />
            </button>
            <button
              onClick={(e) => handleCloseSession(session.id, e)}
              className="flex-shrink-0 p-1 hover:bg-gray-600 rounded transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
