import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
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
import { useSettings } from "../contexts/SettingsContext";
import { generateId } from "../utils/id";
import { ScriptEngine } from "../utils/scriptEngine";
import { canMoveToParent } from "../utils/dragDropManager";
import { Modal, ModalHeader } from "./ui/Modal";
import { MenuSurface } from "./ui/MenuSurface";

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

// Use 'typeof Monitor' to match Lucide icon type exactly
const iconRegistry: Record<string, typeof Monitor> = {
  monitor: Monitor,
  terminal: Terminal,
  globe: Globe,
  database: Database,
  server: Server,
  shield: Shield,
  cloud: Cloud,
  folder: Folder,
  star: Star,
  drive: HardDrive,
};

const getConnectionIcon = (connection: Connection) => {
  const key = (connection.icon || "").toLowerCase();
  if (key && iconRegistry[key]) {
    return iconRegistry[key];
  }
  return getProtocolIcon(connection.protocol);
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
      return "text-[var(--color-textSecondary)]";
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
  onCopyHostname: (connection: Connection) => void;
  onRename: (connection: Connection) => void;
  onExport: (connection: Connection) => void;
  onConnectWithOptions: (connection: Connection) => void;
  onConnectWithoutCredentials: (connection: Connection) => void;
  onExecuteScripts: (connection: Connection, sessionId?: string) => void;
  onDiagnostics: (connection: Connection) => void;
  onDetachSession: (sessionId: string) => void;
  enableReorder: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  dropPosition: "before" | "after" | "inside" | null;
  onDragStart: (connectionId: string) => void;
  onDragOver: (
    connectionId: string,
    position: "before" | "after" | "inside",
  ) => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onDrop: (
    connectionId: string,
    position: "before" | "after" | "inside",
  ) => void;
  singleClickConnect?: boolean;
  singleClickDisconnect?: boolean;
  doubleClickRename?: boolean;
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
  onCopyHostname,
  onRename,
  onExport,
  onConnectWithOptions,
  onConnectWithoutCredentials,
  onExecuteScripts,
  onDiagnostics,
  onDetachSession,
  enableReorder,
  isDragging,
  isDragOver,
  dropPosition,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDragEnd,
  onDrop,
  singleClickConnect,
  singleClickDisconnect,
  doubleClickRename,
}) => {
  const { state, dispatch } = useConnections();
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(connection.expanded || false);

  const ProtocolIcon = getConnectionIcon(connection);
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

    // Handle single-click actions
    if (!connection.isGroup) {
      if (activeSession && singleClickDisconnect) {
        onDisconnect(connection);
      } else if (!activeSession && singleClickConnect) {
        onConnect(connection);
      }
    }
  };

  const handleDoubleClick = () => {
    if (connection.isGroup) return;

    if (doubleClickRename) {
      onRename(connection);
    } else {
      onConnect(connection);
    }
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

  return (
    <div className="relative">
      <div
        data-connection-item="true"
        data-tauri-disable-drag="true"
        className={`group flex items-center h-8 px-2 cursor-pointer hover:bg-[var(--color-border)]/50 transition-colors relative ${
          isSelected
            ? "bg-blue-600/20 text-blue-400"
            : "text-[var(--color-textSecondary)]"
        } ${isDragging ? "opacity-50 scale-95" : ""} ${
          isDragOver && dropPosition === "inside"
            ? "bg-blue-500/20 ring-2 ring-blue-500/50 ring-inset"
            : ""
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleSelect}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
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
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";

          // Calculate drop position based on mouse Y position within the element
          const rect = e.currentTarget.getBoundingClientRect();
          const y = e.clientY - rect.top;
          const height = rect.height;

          let position: "before" | "after" | "inside";
          if (connection.isGroup) {
            // For groups: top 25% = before, middle 50% = inside, bottom 25% = after
            if (y < height * 0.25) {
              position = "before";
            } else if (y > height * 0.75) {
              position = "after";
            } else {
              position = "inside";
            }
          } else {
            // For non-groups: top 50% = before, bottom 50% = after
            position = y < height * 0.5 ? "before" : "after";
          }

          onDragOver(connection.id, position);
        }}
        onDragLeave={(e) => {
          // Only trigger leave if we're actually leaving this element
          const relatedTarget = e.relatedTarget as HTMLElement;
          if (!e.currentTarget.contains(relatedTarget)) {
            onDragLeave();
          }
        }}
        onDragEnd={onDragEnd}
        onDrop={(e) => {
          if (!enableReorder) return;
          e.preventDefault();
          e.stopPropagation();

          // Calculate final drop position
          const rect = e.currentTarget.getBoundingClientRect();
          const y = e.clientY - rect.top;
          const height = rect.height;

          let position: "before" | "after" | "inside";
          if (connection.isGroup) {
            if (y < height * 0.25) {
              position = "before";
            } else if (y > height * 0.75) {
              position = "after";
            } else {
              position = "inside";
            }
          } else {
            position = y < height * 0.5 ? "before" : "after";
          }

          onDrop(connection.id, position);
        }}
      >
        {/* Drop indicator lines */}
        {isDragOver && dropPosition === "before" && (
          <div className="absolute left-0 right-0 top-0 h-0.5 bg-blue-500 z-10" />
        )}
        {isDragOver && dropPosition === "after" && (
          <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500 z-10" />
        )}
        {/* Group expand/collapse button */}
        {connection.isGroup && (
          <button
            onClick={handleToggleExpand}
            className="flex items-center justify-center w-4 h-4 mr-1 hover:bg-[var(--color-border)] rounded transition-colors"
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
                  className="p-1 hover:bg-[var(--color-border)] rounded transition-colors"
                  data-tooltip="Disconnect"
                >
                  <Power size={12} />
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  className="p-1 hover:bg-[var(--color-border)] rounded transition-colors"
                  data-tooltip="Connect"
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
              const rect = (
                e.currentTarget as HTMLButtonElement
              ).getBoundingClientRect();
              setMenuPosition({
                x: Math.max(8, rect.right - 140),
                y: rect.bottom + 6,
              });
              setShowMenu((prev) => !prev);
            }}
            className="p-1 hover:bg-[var(--color-border)] rounded transition-colors"
          >
            <MoreVertical size={12} />
          </button>
        </div>

        {showMenu && (
          <MenuSurface
            isOpen={showMenu}
            onClose={() => setShowMenu(false)}
            position={menuPosition}
            ignoreRefs={[triggerRef]}
            className="min-w-[140px]"
            dataTestId="connection-tree-item-menu"
          >
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
                className="sor-menu-item"
              >
                {activeSession ? (
                  <Power size={14} className="mr-2" />
                ) : (
                  <Play size={14} className="mr-2" />
                )}
                {activeSession ? "Disconnect" : "Connect"}
              </button>
            )}
            {!connection.isGroup && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onConnectWithOptions(connection);
                    setShowMenu(false);
                  }}
                  className="sor-menu-item"
                >
                  <SlidersHorizontal size={14} className="mr-2" />
                  Connect with options
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onConnectWithoutCredentials(connection);
                    setShowMenu(false);
                  }}
                  className="sor-menu-item"
                >
                  <UserX size={14} className="mr-2" />
                  Connect without credentials
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onExecuteScripts(connection, activeSession?.id);
                    setShowMenu(false);
                  }}
                  className="sor-menu-item"
                >
                  <Play size={14} className="mr-2" />
                  Execute scripts
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDiagnostics(connection);
                    setShowMenu(false);
                  }}
                  className="sor-menu-item"
                >
                  <Activity size={14} className="mr-2" />
                  Diagnostics
                </button>
                {activeSession && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDetachSession(activeSession.id);
                      setShowMenu(false);
                    }}
                    className="sor-menu-item"
                  >
                    <ExternalLink size={14} className="mr-2" />
                    Detach window
                  </button>
                )}
              </>
            )}
            {!connection.isGroup && <div className="sor-menu-divider" />}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(connection);
                setShowMenu(false);
              }}
              className="sor-menu-item"
            >
              <Edit size={14} className="mr-2" />
              Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRename(connection);
                setShowMenu(false);
              }}
              className="sor-menu-item"
            >
              <Edit size={14} className="mr-2" />
              Rename
            </button>
            {!connection.isGroup && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({
                    type: "UPDATE_CONNECTION",
                    payload: { ...connection, favorite: !connection.favorite },
                  });
                  setShowMenu(false);
                }}
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
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyHostname(connection);
                  setShowMenu(false);
                }}
                className="sor-menu-item"
              >
                <Copy size={14} className="mr-2" />
                Copy hostname
              </button>
            )}
            {!connection.isGroup && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExport(connection);
                  setShowMenu(false);
                }}
                className="sor-menu-item"
              >
                <FileDown size={14} className="mr-2" />
                Export to file
              </button>
            )}
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
              className="sor-menu-item"
            >
              <Copy size={14} className="mr-2" />
              Duplicate
            </button>
            <div className="sor-menu-divider" />
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(connection);
                setShowMenu(false);
              }}
              className="sor-menu-item sor-menu-item-danger"
            >
              <Trash2 size={14} className="mr-2" />
              Delete
            </button>
          </MenuSurface>
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
  onDiagnostics: (connection: Connection) => void;
  onSessionDetach: (sessionId: string) => void;
  onOpenImport?: () => void;
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
  onDiagnostics,
  onSessionDetach,
  onOpenImport,
  enableReorder = true,
}) => {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<
    "before" | "after" | "inside" | null
  >(null);
  const [renameTarget, setRenameTarget] = useState<Connection | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [panelMenuPosition, setPanelMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [connectOptionsTarget, setConnectOptionsTarget] =
    useState<Connection | null>(null);
  const [connectOptionsData, setConnectOptionsData] = useState<{
    username: string;
    authType: "password" | "key";
    password: string;
    privateKey: string;
    passphrase: string;
    saveToConnection: boolean;
  } | null>(null);

  const handleCopyHostname = useCallback((connection: Connection) => {
    if (!connection.hostname) return;
    navigator.clipboard.writeText(connection.hostname).catch(() => undefined);
  }, []);

  const handleExportConnection = useCallback((connection: Connection) => {
    const safeConnection = {
      ...connection,
      password: undefined,
      privateKey: undefined,
      passphrase: undefined,
      totpSecret: undefined,
      basicAuthPassword: undefined,
    };
    const payload = {
      exportedAt: new Date().toISOString(),
      connection: safeConnection,
    };
    const content = JSON.stringify(payload, null, 2);
    const filename = `connection-${connection.name || connection.id}.json`
      .replace(/[^a-z0-9-_]+/gi, "-")
      .toLowerCase();
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  const handleRename = useCallback((connection: Connection) => {
    setRenameTarget(connection);
    setRenameValue(connection.name || "");
  }, []);

  const handleConnectWithOptions = useCallback((connection: Connection) => {
    setConnectOptionsTarget(connection);
    setConnectOptionsData({
      username: connection.username || "",
      authType: connection.authType === "key" ? "key" : "password",
      password: connection.password || "",
      privateKey: connection.privateKey || "",
      passphrase: connection.passphrase || "",
      saveToConnection: false,
    });
  }, []);

  const handleConnectWithoutCredentials = useCallback(
    (connection: Connection) => {
      const stripped: Connection = {
        ...connection,
        username: undefined,
        password: undefined,
        privateKey: undefined,
        passphrase: undefined,
        totpSecret: undefined,
        basicAuthPassword: undefined,
      };
      onConnect(stripped);
    },
    [onConnect],
  );

  const handleExecuteScripts = useCallback(
    async (connection: Connection, sessionId?: string) => {
      try {
        const engine = ScriptEngine.getInstance();
        const session = state.sessions.find((item) => item.id === sessionId);
        const scripts = engine.getScriptsForTrigger(
          "manual",
          connection.protocol,
        );
        for (const script of scripts) {
          await engine.executeScript(script, {
            trigger: "manual",
            connection,
            session,
          });
        }
      } catch (error) {
        console.error("Failed to execute scripts:", error);
      }
    },
    [state.sessions],
  );

  const handleConnectOptionsSubmit = useCallback(() => {
    if (!connectOptionsTarget || !connectOptionsData) return;
    const isSsh = connectOptionsTarget.protocol === "ssh";
    const overrides: Partial<Connection> = {
      username: connectOptionsData.username || undefined,
    };

    if (isSsh) {
      overrides.authType = connectOptionsData.authType;
      if (connectOptionsData.authType === "password") {
        overrides.password = connectOptionsData.password;
        overrides.privateKey = undefined;
        overrides.passphrase = undefined;
      } else {
        overrides.privateKey = connectOptionsData.privateKey;
        overrides.passphrase = connectOptionsData.passphrase || undefined;
        overrides.password = undefined;
      }
    } else {
      overrides.password = connectOptionsData.password || undefined;
    }

    const nextConnection = { ...connectOptionsTarget, ...overrides };
    if (connectOptionsData.saveToConnection) {
      dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...nextConnection, updatedAt: new Date() },
      });
    }
    onConnect(nextConnection);
    setConnectOptionsTarget(null);
    setConnectOptionsData(null);
  }, [connectOptionsData, connectOptionsTarget, dispatch, onConnect]);

  const buildTree = useCallback(
    (connections: Connection[], parentId?: string): Connection[] => {
      const sortBy = state.filter.sortBy || "name";
      const sortDirection = state.filter.sortDirection || "asc";
      const multiplier = sortDirection === "desc" ? -1 : 1;

      return connections
        .filter((conn) => conn.parentId === parentId)
        .sort((a, b) => {
          // Groups always come first
          if (a.isGroup && !b.isGroup) return -1;
          if (!a.isGroup && b.isGroup) return 1;

          // Custom order takes precedence when enabled and sortBy is custom
          if (enableReorder && sortBy === "custom") {
            const orderA = a.order ?? 0;
            const orderB = b.order ?? 0;
            if (orderA !== orderB) return (orderA - orderB) * multiplier;
          }

          // Sort based on selected criteria
          switch (sortBy) {
            case "protocol":
              return a.protocol.localeCompare(b.protocol) * multiplier;
            case "hostname":
              return (
                (a.hostname || "").localeCompare(b.hostname || "") * multiplier
              );
            case "createdAt": {
              const dateA = new Date(a.createdAt).getTime();
              const dateB = new Date(b.createdAt).getTime();
              return (dateA - dateB) * multiplier;
            }
            case "updatedAt": {
              const dateA = new Date(a.updatedAt).getTime();
              const dateB = new Date(b.updatedAt).getTime();
              return (dateA - dateB) * multiplier;
            }
            case "recentlyUsed": {
              const dateA = a.lastConnected
                ? new Date(a.lastConnected).getTime()
                : 0;
              const dateB = b.lastConnected
                ? new Date(b.lastConnected).getTime()
                : 0;
              // Recently used should default to descending (most recent first)
              return (dateB - dateA) * (sortDirection === "asc" ? -1 : 1);
            }
            case "custom":
              // Already handled above with enableReorder
              return a.name.localeCompare(b.name) * multiplier;
            case "name":
            default:
              return a.name.localeCompare(b.name) * multiplier;
          }
        });
    },
    [enableReorder, state.filter.sortBy, state.filter.sortDirection],
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
          onCopyHostname={handleCopyHostname}
          onRename={handleRename}
          onExport={handleExportConnection}
          onConnectWithOptions={handleConnectWithOptions}
          onConnectWithoutCredentials={handleConnectWithoutCredentials}
          onExecuteScripts={handleExecuteScripts}
          onDiagnostics={onDiagnostics}
          onDetachSession={onSessionDetach}
          enableReorder={enableReorder}
          isDragging={draggedId === connection.id}
          isDragOver={
            dragOverId === connection.id && draggedId !== connection.id
          }
          dropPosition={
            dragOverId === connection.id && draggedId !== connection.id
              ? dropPosition
              : null
          }
          singleClickConnect={settings.singleClickConnect}
          singleClickDisconnect={settings.singleClickDisconnect}
          doubleClickRename={settings.doubleClickRename}
          onDragStart={(connectionId) => {
            setDraggedId(connectionId);
            setDropPosition(null);
          }}
          onDragOver={(connectionId, position) => {
            if (connectionId === draggedId) return;
            setDragOverId(connectionId);
            setDropPosition(position);
          }}
          onDragLeave={() => {
            // Don't clear immediately - let the next dragOver set the new target
          }}
          onDragEnd={() => {
            setDraggedId(null);
            setDragOverId(null);
            setDropPosition(null);
          }}
          onDrop={(targetId, position) => {
            if (!draggedId || draggedId === targetId) {
              setDraggedId(null);
              setDragOverId(null);
              setDropPosition(null);
              return;
            }

            const draggedConnection = state.connections.find(
              (conn) => conn.id === draggedId,
            );
            const targetConnection = state.connections.find(
              (conn) => conn.id === targetId,
            );

            if (!draggedConnection || !targetConnection) {
              setDraggedId(null);
              setDragOverId(null);
              setDropPosition(null);
              return;
            }

            // Prevent dropping a folder into itself or its descendants
            if (draggedConnection.isGroup && position === "inside") {
              let checkId: string | undefined = targetId;
              while (checkId) {
                if (checkId === draggedId) {
                  console.warn(
                    "Cannot drop a folder into itself or its descendants",
                  );
                  setDraggedId(null);
                  setDragOverId(null);
                  setDropPosition(null);
                  return;
                }
                const parent = state.connections.find((c) => c.id === checkId);
                checkId = parent?.parentId;
              }
            }

            // Determine the new parent ID based on drop position
            let newParentId: string | undefined;
            if (position === "inside" && targetConnection.isGroup) {
              newParentId = targetConnection.id;
            } else {
              newParentId = targetConnection.parentId;
            }

            // Check nesting depth constraints
            if (!canMoveToParent(draggedId, newParentId, state.connections)) {
              console.warn("Cannot move: would exceed maximum nesting depth");
              setDraggedId(null);
              setDragOverId(null);
              setDropPosition(null);
              return;
            }

            // Get siblings at the target level
            const targetSiblings = state.connections.filter(
              (c) => c.parentId === newParentId,
            );

            // Calculate the new order
            let newOrder: number;
            if (position === "inside") {
              // When dropping inside a folder, add at the beginning
              newOrder = 0;
              // Shift existing children's order
              targetSiblings.forEach((sibling) => {
                if (sibling.id !== draggedId) {
                  dispatch({
                    type: "UPDATE_CONNECTION",
                    payload: { ...sibling, order: (sibling.order ?? 0) + 1 },
                  });
                }
              });
            } else {
              // Find the target's position among its siblings
              const sortedSiblings = [...targetSiblings].sort(
                (a, b) => (a.order ?? 0) - (b.order ?? 0),
              );
              const targetIndex = sortedSiblings.findIndex(
                (s) => s.id === targetId,
              );

              if (position === "before") {
                newOrder = targetIndex >= 0 ? targetIndex : 0;
              } else {
                newOrder =
                  targetIndex >= 0 ? targetIndex + 1 : sortedSiblings.length;
              }

              // Reorder siblings to make room
              const filteredSiblings = sortedSiblings.filter(
                (s) => s.id !== draggedId,
              );
              filteredSiblings.forEach((sibling, index) => {
                const adjustedOrder = index >= newOrder ? index + 1 : index;
                if (sibling.order !== adjustedOrder) {
                  dispatch({
                    type: "UPDATE_CONNECTION",
                    payload: { ...sibling, order: adjustedOrder },
                  });
                }
              });
            }

            // Update the dragged connection with new parent and order
            dispatch({
              type: "UPDATE_CONNECTION",
              payload: {
                ...draggedConnection,
                parentId: newParentId,
                order: newOrder,
                updatedAt: new Date(),
              },
            });

            // If dropping into a collapsed folder, expand it
            if (
              position === "inside" &&
              targetConnection.isGroup &&
              !targetConnection.expanded
            ) {
              dispatch({
                type: "UPDATE_CONNECTION",
                payload: { ...targetConnection, expanded: true },
              });
            }

            setDraggedId(null);
            setDragOverId(null);
            setDropPosition(null);
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
      if (state.filter.showFavorites && !conn.favorite) {
        return false;
      }
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

  // Handle panel-level context menu (right-click on empty area)
  const handlePanelContextMenu = useCallback((e: React.MouseEvent) => {
    // Only show if clicking on the panel itself, not on a connection item
    const target = e.target as HTMLElement;
    if (target.closest("[data-connection-item]")) {
      return;
    }
    e.preventDefault();
    setPanelMenuPosition({ x: e.clientX, y: e.clientY });
  }, []);

  // Handle dropping on the panel (root level drop)
  const handlePanelDragOver = useCallback(
    (e: React.DragEvent) => {
      // Always prevent default to allow drop (prevents forbidden cursor)
      e.preventDefault();
      e.stopPropagation();
      if (!enableReorder) return;
      e.dataTransfer.dropEffect = "move";
      // Clear the dragOver target when over empty space
      if (draggedId) {
        setDragOverId(null);
        setDropPosition(null);
      }
    },
    [enableReorder, draggedId],
  );

  const handlePanelDrop = useCallback(
    (e: React.DragEvent) => {
      if (!enableReorder || !draggedId) return;
      e.preventDefault();

      const draggedConnection = state.connections.find(
        (conn) => conn.id === draggedId,
      );
      if (!draggedConnection) {
        setDraggedId(null);
        setDragOverId(null);
        setDropPosition(null);
        return;
      }

      // Check if we can move to root
      if (!canMoveToParent(draggedId, undefined, state.connections)) {
        console.warn("Cannot move: would exceed maximum nesting depth");
        setDraggedId(null);
        setDragOverId(null);
        setDropPosition(null);
        return;
      }

      // Move to root level at the end
      const rootSiblings = state.connections.filter((c) => !c.parentId);
      const maxOrder = rootSiblings.reduce(
        (max, c) => Math.max(max, c.order ?? 0),
        -1,
      );

      dispatch({
        type: "UPDATE_CONNECTION",
        payload: {
          ...draggedConnection,
          parentId: undefined,
          order: maxOrder + 1,
          updatedAt: new Date(),
        },
      });

      setDraggedId(null);
      setDragOverId(null);
      setDropPosition(null);
    },
    [enableReorder, draggedId, state.connections, dispatch],
  );

  return (
    <>
      <div
        className={`flex-1 overflow-y-auto ${draggedId ? "min-h-[100px]" : ""}`}
        data-tauri-disable-drag="true"
        onContextMenu={handlePanelContextMenu}
        onDragOver={handlePanelDragOver}
        onDrop={handlePanelDrop}
      >
        {filteredConnections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <Monitor size={24} className="mb-2" />
            <p className="text-sm">No connections found</p>
          </div>
        ) : (
          renderTree(buildTree(filteredConnections))
        )}
      </div>

      {/* Panel context menu */}
      {panelMenuPosition && onOpenImport && (
        <MenuSurface
          isOpen={Boolean(panelMenuPosition && onOpenImport)}
          onClose={() => setPanelMenuPosition(null)}
          position={panelMenuPosition}
          className="min-w-[160px] rounded-lg py-1"
          dataTestId="connection-tree-panel-menu"
        >
          <button
            onClick={() => {
              onOpenImport();
              setPanelMenuPosition(null);
            }}
            className="sor-menu-item"
          >
            <Upload size={14} />
            Import Connections
          </button>
        </MenuSurface>
      )}

      {renameTarget && (
        <Modal
          isOpen={Boolean(renameTarget)}
          onClose={() => setRenameTarget(null)}
          panelClassName="max-w-md mx-4"
          dataTestId="connection-tree-rename-modal"
        >
          <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full relative">
            <ModalHeader
              onClose={() => setRenameTarget(null)}
              className="relative h-12 border-b border-[var(--color-border)]"
              titleClassName="absolute left-5 top-3 text-sm font-semibold text-[var(--color-text)]"
              title="Rename Connection"
            />
            <div className="p-6">
              <label className="block text-sm text-[var(--color-textSecondary)] mb-2">
                Connection Name
              </label>
              <input
                type="text"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (!renameTarget) return;
                  const trimmed = renameValue.trim();
                  if (!trimmed) return;
                  dispatch({
                    type: "UPDATE_CONNECTION",
                    payload: {
                      ...renameTarget,
                      name: trimmed,
                      updatedAt: new Date(),
                    },
                  });
                  setRenameTarget(null);
                }}
                className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="New name"
              />
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  className="px-4 py-2 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!renameTarget) return;
                    const trimmed = renameValue.trim();
                    if (!trimmed) return;
                    dispatch({
                      type: "UPDATE_CONNECTION",
                      payload: {
                        ...renameTarget,
                        name: trimmed,
                        updatedAt: new Date(),
                      },
                    });
                    setRenameTarget(null);
                  }}
                  className="px-4 py-2 text-[var(--color-text)] bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {connectOptionsTarget && connectOptionsData && (
        <Modal
          isOpen={Boolean(connectOptionsTarget && connectOptionsData)}
          onClose={() => {
            setConnectOptionsTarget(null);
            setConnectOptionsData(null);
          }}
          closeOnEscape={false}
          panelClassName="max-w-md mx-4"
          dataTestId="connection-tree-connect-options-modal"
        >
          <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full overflow-hidden">
            <div className="border-b border-[var(--color-border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                Connect with Options
              </h3>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                  Username
                </label>
                <input
                  type="text"
                  value={connectOptionsData.username}
                  onChange={(e) =>
                    setConnectOptionsData({
                      ...connectOptionsData,
                      username: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              {connectOptionsTarget.protocol === "ssh" ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                      Auth Type
                    </label>
                    <select
                      value={connectOptionsData.authType}
                      onChange={(e) =>
                        setConnectOptionsData({
                          ...connectOptionsData,
                          authType: e.target.value as "password" | "key",
                        })
                      }
                      className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="password">Password</option>
                      <option value="key">Private Key</option>
                    </select>
                  </div>
                  {connectOptionsData.authType === "password" ? (
                    <div>
                      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                        Password
                      </label>
                      <PasswordInput
                        value={connectOptionsData.password}
                        onChange={(e) =>
                          setConnectOptionsData({
                            ...connectOptionsData,
                            password: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                          Private Key
                        </label>
                        <textarea
                          value={connectOptionsData.privateKey}
                          onChange={(e) =>
                            setConnectOptionsData({
                              ...connectOptionsData,
                              privateKey: e.target.value,
                            })
                          }
                          rows={3}
                          className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                          Passphrase (optional)
                        </label>
                        <PasswordInput
                          value={connectOptionsData.passphrase}
                          onChange={(e) =>
                            setConnectOptionsData({
                              ...connectOptionsData,
                              passphrase: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
                    Password
                  </label>
                  <PasswordInput
                    value={connectOptionsData.password}
                    onChange={(e) =>
                      setConnectOptionsData({
                        ...connectOptionsData,
                        password: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={connectOptionsData.saveToConnection}
                  onChange={(e) =>
                    setConnectOptionsData({
                      ...connectOptionsData,
                      saveToConnection: e.target.checked,
                    })
                  }
                />
                <span>Save credentials to this connection</span>
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConnectOptionsTarget(null);
                    setConnectOptionsData(null);
                  }}
                  className="px-3 py-2 text-sm text-[var(--color-textSecondary)] bg-[var(--color-border)] hover:bg-[var(--color-border)] rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConnectOptionsSubmit}
                  className="px-3 py-2 text-sm text-[var(--color-text)] bg-blue-600 hover:bg-blue-700 rounded-md"
                >
                  Connect
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};
