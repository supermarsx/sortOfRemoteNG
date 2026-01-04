import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
    case "mysql":
      return Database;
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
  onDisconnect: (connection: Connection) => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  enableReorder: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (connectionId: string) => void;
  onDragOver: (connectionId: string) => void;
  onDragEnd: () => void;
  onDrop: (connectionId: string) => void;
}

/**
 * Renders a single row in the connection tree. Handles selection state,
 * group expansion, context menu actions and session status indication.
 */
const ConnectionTreeItem: React.FC<ConnectionTreeItemProps> = ({
  connection,
  level,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
  enableReorder,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}) => {
  const { state, dispatch } = useConnections();
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
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

  const handleDisconnect = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDisconnect(connection);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setShowMenu(true);
  };

  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target || null)) return;
      if (triggerRef.current?.contains(target || null)) return;
      setShowMenu(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  return (
    <div className="relative">
      <div
        className={`group flex items-center h-8 px-2 cursor-pointer hover:bg-gray-700/50 transition-colors ${
          isSelected ? "bg-blue-600/20 text-blue-400" : "text-gray-300"
        } ${isDragging ? "opacity-60" : ""} ${isDragOver ? "border-l-2 border-blue-500" : ""}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleSelect}
        onDoubleClick={() => !connection.isGroup && onConnect(connection)}
        onContextMenu={handleContextMenu}
        draggable={enableReorder}
        onDragStart={(e) => {
          if (!enableReorder) return;
          e.dataTransfer.effectAllowed = "move";
          onDragStart(connection.id);
        }}
        onDragOver={(e) => {
          if (!enableReorder) return;
          e.preventDefault();
          onDragOver(connection.id);
        }}
        onDragEnd={onDragEnd}
        onDrop={(e) => {
          if (!enableReorder) return;
          e.preventDefault();
          onDrop(connection.id);
        }}
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
            <>
              {activeSession ? (
                <button
                  onClick={handleDisconnect}
                  className="p-1 hover:bg-gray-600 rounded transition-colors"
                  title="Disconnect"
                >
                  <Power size={12} />
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  className="p-1 hover:bg-gray-600 rounded transition-colors"
                  title="Connect"
                >
                  <Play size={12} />
                </button>
              )}
            </>
          )}

          {/* Context menu trigger */}
          <button
            ref={triggerRef}
            onClick={(e) => {
              e.stopPropagation();
              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
              setMenuPosition({ x: Math.max(8, rect.right - 140), y: rect.bottom + 6 });
              setShowMenu((prev) => !prev);
            }}
            className="p-1 hover:bg-gray-600 rounded transition-colors"
          >
            <MoreVertical size={12} />
          </button>
        </div>

        {showMenu && (
          <div
            ref={menuRef}
            className="fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg z-50 min-w-[140px]"
            style={menuPosition ? { left: menuPosition.x, top: menuPosition.y } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Edit action */}
            {!connection.isGroup && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (activeSession) {
                    onDisconnect(connection);
                  } else {
                    onConnect(connection);
                  }
                  setShowMenu(false);
                }}
                className="flex items-center w-full px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
              >
                {activeSession ? <Power size={14} className="mr-2" /> : <Play size={14} className="mr-2" />}
                {activeSession ? "Disconnect" : "Connect"}
              </button>
            )}
            {!connection.isGroup && <hr className="border-gray-700" />}
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
  onDisconnect: (connection: Connection) => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  enableReorder?: boolean;
}

/**
 * Displays a hierarchical tree of connections and groups. Handles filtering
 * and delegates selection, expansion and action callbacks to
 * {@link ConnectionTreeItem}.
 */
export const ConnectionTree: React.FC<ConnectionTreeProps> = ({
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
  enableReorder = true,
}) => {
  const { state, dispatch } = useConnections();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const buildTree = useCallback(
    (connections: Connection[], parentId?: string): Connection[] =>
      connections
        .filter((conn) => conn.parentId === parentId)
        .sort((a, b) => {
          if (a.isGroup && !b.isGroup) return -1;
          if (!a.isGroup && b.isGroup) return 1;
          if (enableReorder) {
            const orderA = a.order ?? 0;
            const orderB = b.order ?? 0;
            if (orderA !== orderB) return orderA - orderB;
          }
          return a.name.localeCompare(b.name);
        }),
    [enableReorder],
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
          onDisconnect={onDisconnect}
          onEdit={onEdit}
          onDelete={onDelete}
          enableReorder={enableReorder}
          isDragging={draggedId === connection.id}
          isDragOver={dragOverId === connection.id && draggedId !== connection.id}
          onDragStart={(connectionId) => {
            setDraggedId(connectionId);
          }}
          onDragOver={(connectionId) => {
            setDragOverId(connectionId);
          }}
          onDragEnd={() => {
            setDraggedId(null);
            setDragOverId(null);
          }}
          onDrop={(connectionId) => {
            if (!draggedId || draggedId === connectionId) return;
            const draggedConnection = state.connections.find((conn) => conn.id === draggedId);
            const dropConnection = state.connections.find((conn) => conn.id === connectionId);
            if (!draggedConnection || !dropConnection) return;
            if (draggedConnection.parentId !== dropConnection.parentId) return;

            const siblings = buildTree(state.connections, draggedConnection.parentId);
            const orderedIds = siblings.map((conn) => conn.id);
            const fromIndex = orderedIds.indexOf(draggedId);
            const toIndex = orderedIds.indexOf(connectionId);
            if (fromIndex < 0 || toIndex < 0) return;

            const nextOrder = [...orderedIds];
            const [moved] = nextOrder.splice(fromIndex, 1);
            nextOrder.splice(toIndex, 0, moved);

            nextOrder.forEach((id, index) => {
              const current = state.connections.find((conn) => conn.id === id);
              if (current && current.order !== index) {
                dispatch({
                  type: "UPDATE_CONNECTION",
                  payload: { ...current, order: index },
                });
              }
            });

            setDraggedId(null);
            setDragOverId(null);
          }}
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
