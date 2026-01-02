import React, { useState, useMemo, useCallback } from "react";
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
} from "lucide-react";
import { Connection } from "../types/connection";
import { useConnections } from "../contexts/useConnections";
import { generateId } from "../utils/id";

/**
 * Maps a connection protocol to a Lucide icon component.
 *
 * @param protocol - Identifier for the protocol (e.g. `rdp`, `ssh`).
 * @returns The icon component representing the protocol. Defaults to
 * `Monitor` when no specific mapping exists.
 */
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

/**
 * Converts a session status into a Tailwind CSS text color.
 *
 * @param status - Session state (`connected`, `connecting`, `error`).
 * @returns Tailwind text color class, gray when status is undefined.
 */
const getStatusColor = (status?: string) => {
  switch (status) {
    case "connected":
      return "text-green-400";
    case "connecting":
      return "text-yellow-400";
    case "error":
      return "text-red-400";
    default:
      return "text-gray-400";
  }
};

/**
 * Props for {@link ConnectionTreeItem}.
 *
 * @property connection - Connection or group to render.
 * @property level - Depth in the tree, used for indentation.
 * @property onConnect - Invoked when a non-group connection is opened.
 * @property onEdit - Handler for editing the connection.
 * @property onDelete - Handler for removing the connection.
 */
interface ConnectionTreeItemProps {
  connection: Connection;
  level: number;
  onConnect: (connection: Connection) => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
}

/**
 * Renders a single row in the connection tree. Handles selection state,
 * group expansion, context menu actions and session status indication.
 */
const ConnectionTreeItem: React.FC<ConnectionTreeItemProps> = ({
  connection,
  level,
  onConnect,
  onEdit,
  onDelete,
}) => {
  const { state, dispatch } = useConnections();
  const [showMenu, setShowMenu] = useState(false);
  const [isExpanded, setIsExpanded] = useState(connection.expanded || false);

  const ProtocolIcon = getProtocolIcon(connection.protocol);
  const isSelected = state.selectedConnection?.id === connection.id;
  const activeSession = state.sessions.find(
    (s) => s.connectionId === connection.id,
  );

  const handleToggleExpand = () => {
    if (connection.isGroup) {
      setIsExpanded(!isExpanded);
      dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...connection, expanded: !isExpanded },
      });
    }
  };

  const handleSelect = () => {
    dispatch({ type: "SELECT_CONNECTION", payload: connection });
  };

  const handleConnect = (e: React.MouseEvent) => {
    e.stopPropagation();
    onConnect(connection);
  };

  return (
    <div className="relative">
      <div
        className={`group flex items-center h-8 px-2 cursor-pointer hover:bg-gray-700/50 transition-colors ${
          isSelected ? "bg-blue-600/20 text-blue-400" : "text-gray-300"
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleSelect}
        onDoubleClick={() => !connection.isGroup && onConnect(connection)}
      >
        {/* Group expand/collapse button */}
        {connection.isGroup && (
          <button
            onClick={handleToggleExpand}
            className="flex items-center justify-center w-4 h-4 mr-1 hover:bg-gray-600 rounded transition-colors"
          >
            {isExpanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
          </button>
        )}

        <div className="flex items-center min-w-0 flex-1">
          {connection.isGroup ? (
            isExpanded ? (
              <FolderOpen size={16} className="mr-2 text-yellow-400" />
            ) : (
              <Folder size={16} className="mr-2 text-yellow-400" />
            )
          ) : (
            <ProtocolIcon
              size={16}
              className={`mr-2 ${getStatusColor(activeSession?.status)}`}
            />
          )}

          <span className="truncate text-sm">{connection.name}</span>

          {/* Dot representing current session state */}
          {activeSession && (
            <div
              className={`ml-2 w-2 h-2 rounded-full ${
                activeSession.status === "connected"
                  ? "bg-green-400"
                  : activeSession.status === "connecting"
                    ? "bg-yellow-400"
                    : "bg-red-400"
              }`}
            />
          )}
        </div>

        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
          {!connection.isGroup && (
            <button
              onClick={handleConnect}
              className="p-1 hover:bg-gray-600 rounded transition-colors"
              title="Connect"
            >
              <Play size={12} />
            </button>
          )}

          {/* Context menu trigger */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1 hover:bg-gray-600 rounded transition-colors"
          >
            <MoreVertical size={12} />
          </button>
        </div>

        {showMenu && (
          <div className="absolute right-0 top-8 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-10 min-w-[120px]">
            {/* Edit action */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(connection);
                setShowMenu(false);
              }}
              className="flex items-center w-full px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
            >
              <Edit size={14} className="mr-2" />
              Edit
            </button>
            {/* Duplicate action */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                const now = new Date();
                const newConnection = structuredClone(connection);
                newConnection.id = generateId();
                newConnection.createdAt = now;
                newConnection.updatedAt = now;
                dispatch({ type: "ADD_CONNECTION", payload: newConnection });
                setShowMenu(false);
              }}
              className="flex items-center w-full px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
            >
              <Copy size={14} className="mr-2" />
              Duplicate
            </button>
            <hr className="border-gray-700" />
            {/* Delete action */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(connection);
                setShowMenu(false);
              }}
              className="flex items-center w-full px-3 py-2 text-sm text-red-400 hover:bg-gray-700 transition-colors"
            >
              <Trash2 size={14} className="mr-2" />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Props for {@link ConnectionTree}.
 *
 * @property onConnect - Called when a user attempts to open a connection.
 * @property onEdit - Invoked to edit a specific connection.
 * @property onDelete - Invoked to delete a connection or group.
 */
interface ConnectionTreeProps {
  onConnect: (connection: Connection) => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
}

/**
 * Displays a hierarchical tree of connections and groups. Handles filtering
 * and delegates selection, expansion and action callbacks to
 * {@link ConnectionTreeItem}.
 */
export const ConnectionTree: React.FC<ConnectionTreeProps> = ({
  onConnect,
  onEdit,
  onDelete,
}) => {
  const { state } = useConnections();

  const buildTree = useCallback(
    (connections: Connection[], parentId?: string): Connection[] =>
      connections
        .filter((conn) => conn.parentId === parentId)
        .sort((a, b) => {
          if (a.isGroup && !b.isGroup) return -1;
          if (!a.isGroup && b.isGroup) return 1;
          return a.name.localeCompare(b.name);
        }),
    [],
  );

  const renderTree = (
    connections: Connection[],
    level: number = 0,
  ): React.ReactNode => {
    return connections.map((connection) => (
      <div key={connection.id}>
        <ConnectionTreeItem
          connection={connection}
          level={level}
          onConnect={onConnect}
          onEdit={onEdit}
          onDelete={onDelete}
        />
        {connection.isGroup && connection.expanded && (
          <div>
            {/* Recursively render children when group is expanded */}
            {renderTree(buildTree(state.connections, connection.id), level + 1)}
          </div>
        )}
      </div>
    ));
  };

  const filteredConnections = useMemo(() => {
    return state.connections.filter((conn) => {
      if (state.filter.searchTerm) {
        const searchLower = state.filter.searchTerm.toLowerCase();
        return (
          conn.name.toLowerCase().includes(searchLower) ||
          conn.hostname?.toLowerCase().includes(searchLower) ||
          conn.description?.toLowerCase().includes(searchLower)
        );
      }
      return true;
    });
  }, [state.connections, state.filter]);

  return (
    <div className="flex-1 overflow-y-auto">
      {filteredConnections.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-gray-500">
          <Monitor size={24} className="mb-2" />
          <p className="text-sm">No connections found</p>
        </div>
      ) : (
        renderTree(buildTree(filteredConnections))
      )}
    </div>
  );
};
