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
  enableReorder?: boolean;
}

export const SessionTabs: React.FC<SessionTabsProps> = ({
  activeSessionId,
  onSessionSelect,
  onSessionClose,
  enableReorder = true,
}) => {
  const { state, dispatch } = useConnections();
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);

  const handleCloseSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSessionClose(sessionId);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (!enableReorder) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (!enableReorder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    if (!enableReorder) return;
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      dispatch({
        type: "REORDER_SESSIONS",
        payload: { fromIndex: draggedIndex, toIndex: dropIndex },
      });
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  if (state.sessions.length === 0) {
    return (
      <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center justify-center">
        <span className="text-gray-500 text-sm">No active sessions</span>
      </div>
    );
  }

  return (
    <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center overflow-x-auto">
      {state.sessions.map((session, index) => {
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
              draggedIndex === index ? "opacity-50" : ""
            } ${
              dragOverIndex === index && draggedIndex !== index ? "border-l-2 border-blue-500" : ""
            } transition-all`}
            onClick={() => onSessionSelect(session.id)}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            onDrop={(e) => handleDrop(e, index)}
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
