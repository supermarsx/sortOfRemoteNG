import React, { useState, useRef, useEffect, useMemo } from "react";
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
  ArrowLeftFromLine,
  ClipboardCopy,
  Pin,
  PinOff,
  Settings2,
  Info,
  Maximize2,
  Columns,
  Rows,
  ChevronRight,
  ChevronDown,
  FolderPlus,
  FolderMinus,
  Palette,
  Layers,
  Send,
} from "lucide-react";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import { getToolKeyFromProtocol, isToolProtocol } from "../app/toolSession";
import { isWinmgmtProtocol, getWinmgmtToolId, getWindowsToolIcon } from "../windows/WindowsToolPanel";
import MenuSurface from "../ui/overlays/MenuSurface";
import type { ConnectionSession, TabGroup } from "../../types/connection/connection";

const GROUP_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
];

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
  const { settings: appSettings } = useSettings();
  const sessions = state.sessions.filter((session) => !session.layout?.isDetached);
  const tabGroups = state.tabGroups;
  const [draggedSessionId, setDraggedSessionId] = React.useState<string | null>(null);
  const [dragOverSessionId, setDragOverSessionId] = React.useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = React.useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number; groupId: string } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // New group creation dialog state
  const [newGroupDialog, setNewGroupDialog] = useState<{ sessionId: string } | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[5].value);
  const newGroupInputRef = useRef<HTMLInputElement>(null);

  // Group label rename state
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [groupRenameValue, setGroupRenameValue] = useState("");
  const groupRenameInputRef = useRef<HTMLInputElement>(null);

  // Group submenu hover state
  const [groupSubmenuOpen, setGroupSubmenuOpen] = useState(false);
  const [sendToSubmenuOpen, setSendToSubmenuOpen] = useState(false);
  const [detachedWindows, setDetachedWindows] = useState<Array<{ label: string; title: string }>>([]);

  useEffect(() => {
    if (renamingSessionId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingSessionId]);

  useEffect(() => {
    if (newGroupDialog && newGroupInputRef.current) {
      newGroupInputRef.current.focus();
    }
  }, [newGroupDialog]);

  useEffect(() => {
    if (renamingGroupId && groupRenameInputRef.current) {
      groupRenameInputRef.current.focus();
      groupRenameInputRef.current.select();
    }
  }, [renamingGroupId]);

  // Build ordered tab list: ungrouped tabs first, then each group's tabs together
  const orderedTabs = useMemo(() => {
    const ungrouped = sessions.filter((s) => !s.tabGroupId);
    const grouped: { group: TabGroup; sessions: ConnectionSession[] }[] = [];

    for (const group of tabGroups) {
      const groupSessions = sessions.filter((s) => s.tabGroupId === group.id);
      if (groupSessions.length > 0) {
        grouped.push({ group, sessions: groupSessions });
      }
    }

    return { ungrouped, grouped };
  }, [sessions, tabGroups]);

  const closeContextMenu = () => {
    setContextMenu(null);
    setGroupSubmenuOpen(false);
  };

  const closeGroupContextMenu = () => setGroupContextMenu(null);

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setGroupContextMenu(null);
    setSendToSubmenuOpen(false);
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
    // Fetch list of detached windows with their actual titles
    import("@tauri-apps/api/window").then(({ getAllWindows }) =>
      getAllWindows().then(async (wins) => {
        const detached = wins.filter(w => w.label !== "main" && w.label.startsWith("detached-"));
        const entries = await Promise.all(
          detached.map(async (w) => {
            const title = await w.title().catch(() => w.label);
            return { label: w.label, title: title || w.label };
          })
        );
        setDetachedWindows(entries);
      })
    ).catch(() => setDetachedWindows([]));
  };

  const handleGroupContextMenu = (e: React.MouseEvent, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu(null);
    setGroupContextMenu({ x: e.clientX, y: e.clientY, groupId });
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
    setDragOverGroupId(null);
  };

  const handleDragEnd = (e: React.DragEvent, sessionId: string) => {
    const { clientX, clientY } = e;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    const outsideWindow =
      clientX <= 0 ||
      clientY <= 0 ||
      clientX >= windowWidth ||
      clientY >= windowHeight;

    if (outsideWindow && draggedSessionId) {
      // Let the WindowManager decide: drop onto existing detached window
      // or create a new one. It checks screen coords against all windows.
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        win.outerPosition().then((pos) => {
          import("@tauri-apps/api/event").then(({ emit }) => {
            emit("wm:command", {
              type: "DROP_ON_WINDOW",
              sessionId,
              sourceWindow: "main",
              screenX: pos.x + clientX,
              screenY: pos.y + clientY,
            });
          });
        });
      }).catch(() => {
        // Fallback: create new detached window
        onSessionDetach(sessionId);
      });
    }

    setDraggedSessionId(null);
    setDragOverSessionId(null);
    setDragOverGroupId(null);
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
    setDragOverGroupId(null);
  };

  // ── Group label drag handlers ──
  const handleGroupLabelDragOver = (e: React.DragEvent, groupId: string) => {
    if (!enableReorder || !draggedSessionId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverGroupId(groupId);
    setDragOverSessionId(null);
  };

  const handleGroupLabelDrop = (e: React.DragEvent, groupId: string) => {
    if (!enableReorder || !draggedSessionId) return;
    e.preventDefault();
    // Add dragged session to this group
    const session = state.sessions.find((s) => s.id === draggedSessionId);
    if (session) {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...session, tabGroupId: groupId },
      });
    }
    setDraggedSessionId(null);
    setDragOverSessionId(null);
    setDragOverGroupId(null);
  };

  // ── Tab group actions ──
  const handleCreateNewGroup = (sessionId: string) => {
    closeContextMenu();
    setNewGroupName("");
    setNewGroupColor(GROUP_COLORS[5].value);
    setNewGroupDialog({ sessionId });
  };

  const handleConfirmNewGroup = () => {
    if (!newGroupDialog || !newGroupName.trim()) return;
    const groupId = crypto.randomUUID();
    const newGroup: TabGroup = {
      id: groupId,
      name: newGroupName.trim(),
      color: newGroupColor,
      collapsed: false,
    };
    dispatch({ type: "ADD_TAB_GROUP", payload: newGroup });

    // Assign the session to this group
    const session = state.sessions.find((s) => s.id === newGroupDialog.sessionId);
    if (session) {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...session, tabGroupId: groupId },
      });
    }
    setNewGroupDialog(null);
  };

  const handleCancelNewGroup = () => {
    setNewGroupDialog(null);
  };

  const handleNewGroupKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirmNewGroup();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelNewGroup();
    }
  };

  const handleAddToGroup = (sessionId: string, groupId: string) => {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (session) {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...session, tabGroupId: groupId },
      });
    }
    closeContextMenu();
  };

  const handleRemoveFromGroup = (sessionId: string) => {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (session) {
      dispatch({
        type: "UPDATE_SESSION",
        payload: { ...session, tabGroupId: undefined },
      });
    }
    closeContextMenu();
  };

  const handleToggleGroupCollapse = (groupId: string) => {
    const group = tabGroups.find((g) => g.id === groupId);
    if (group) {
      dispatch({
        type: "UPDATE_TAB_GROUP",
        payload: { ...group, collapsed: !group.collapsed },
      });
    }
  };

  const handleStartGroupRename = (groupId: string) => {
    const group = tabGroups.find((g) => g.id === groupId);
    if (!group) return;
    setGroupRenameValue(group.name);
    setRenamingGroupId(groupId);
    closeGroupContextMenu();
  };

  const handleCommitGroupRename = () => {
    if (renamingGroupId && groupRenameValue.trim()) {
      const group = tabGroups.find((g) => g.id === renamingGroupId);
      if (group) {
        dispatch({
          type: "UPDATE_TAB_GROUP",
          payload: { ...group, name: groupRenameValue.trim() },
        });
      }
    }
    setRenamingGroupId(null);
    setGroupRenameValue("");
  };

  const handleGroupRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCommitGroupRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setRenamingGroupId(null);
      setGroupRenameValue("");
    }
  };

  const handleChangeGroupColor = (groupId: string, color: string) => {
    const group = tabGroups.find((g) => g.id === groupId);
    if (group) {
      dispatch({
        type: "UPDATE_TAB_GROUP",
        payload: { ...group, color },
      });
    }
    closeGroupContextMenu();
  };

  const handleUngroupAll = (groupId: string) => {
    dispatch({ type: "REMOVE_TAB_GROUP", payload: groupId });
    closeGroupContextMenu();
  };

  const handleCloseAllInGroup = (groupId: string) => {
    const groupSessions = sessions.filter((s) => s.tabGroupId === groupId);
    groupSessions.forEach((s) => onSessionClose(s.id));
    dispatch({ type: "REMOVE_TAB_GROUP", payload: groupId });
    closeGroupContextMenu();
  };

  // ── Render a single tab ──
  /** Resolve the tab tint color: connection → parent folder → global default */
  const resolveTabColor = (session: ConnectionSession): string | undefined => {
    const conn = state.connections.find(c => c.id === session.connectionId);
    if (conn?.tabColor) return conn.tabColor;
    // Walk up to parent folder
    if (conn?.parentId) {
      const parent = state.connections.find(c => c.id === conn.parentId);
      if (parent?.tabColor) return parent.tabColor;
    }
    return appSettings.defaultTabColor || undefined;
  };

  const renderTab = (session: ConnectionSession, groupColor?: string) => {
    const ProtocolIcon = getProtocolIcon(session.protocol);
    const StatusIcon = getStatusIcon(session.status);
    const isActive = session.id === activeSessionId;
    const tabTint = resolveTabColor(session);

    return (
      <div
        key={session.id}
        draggable={enableReorder}
        data-tauri-disable-drag="true"
        className={`relative flex items-center h-full px-3 cursor-pointer border-r border-[var(--color-border)] min-w-0 ${
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
        style={tabTint ? {
          backgroundColor: isActive
            ? `color-mix(in srgb, ${tabTint} 18%, var(--color-border))`
            : undefined,
          backgroundImage: !isActive
            ? `linear-gradient(to right, color-mix(in srgb, ${tabTint} 10%, transparent), color-mix(in srgb, ${tabTint} 10%, transparent))`
            : undefined,
        } : undefined}
        onClick={() => onSessionSelect(session.id)}
        onAuxClick={(e) => handleMiddleClick(session.id, e)}
        onContextMenu={(e) => handleContextMenu(e, session.id)}
        onDragStart={(e) => handleDragStart(e, session.id)}
        onDragOver={(e) => handleDragOver(e, session.id)}
        onDragEnd={(e) => handleDragEnd(e, session.id)}
        onDrop={(e) => handleDrop(e, session.id)}
      >
        {/* Tab tint indicator — left edge bar */}
        {tabTint && (
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px]"
            style={{ backgroundColor: tabTint }}
          />
        )}
        {/* Group color indicator bar at bottom */}
        {groupColor && (
          <div
            className="absolute bottom-0 left-0 right-0 h-[2px]"
            style={{ backgroundColor: groupColor }}
          />
        )}
        <ProtocolIcon size={14} className="mr-2 flex-shrink-0" />
        {(session as any).pinned && <Pin size={10} className="mr-1 flex-shrink-0 text-[var(--color-textMuted)]" />}
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
        {!isToolProtocol(session.protocol) && !isWinmgmtProtocol(session.protocol) && (
          <StatusIcon
            size={12}
            className={`mr-2 flex-shrink-0 ${getStatusColor(session.status)}`}
          />
        )}
        <button
          onClick={(e) => handleDetachSession(session.id, e)}
          className="flex-shrink-0 p-1 hover:bg-[var(--color-border)] rounded transition-colors"
          data-tooltip="Detach"
        >
          <ExternalLink size={12} />
        </button>
        <button
          onClick={(e) => handleCloseSession(session.id, e)}
          className="flex-shrink-0 p-1 hover:bg-[var(--color-border)] rounded transition-colors"
          data-tooltip="Close"
        >
          <X size={12} />
        </button>
      </div>
    );
  };

  // ── Render a group label chip ──
  const renderGroupLabel = (group: TabGroup, count: number) => {
    const isCollapsed = group.collapsed;
    const isDragOver = dragOverGroupId === group.id;

    return (
      <div
        key={`group-label-${group.id}`}
        className={`flex items-center h-full px-2 cursor-pointer select-none border-r border-[var(--color-border)] transition-all ${
          isDragOver ? "ring-2 ring-inset" : ""
        }`}
        style={{
          backgroundColor: `${group.color}18`,
          borderBottom: `2px solid ${group.color}`,
          ...(isDragOver ? { ringColor: group.color } : {}),
        }}
        onClick={() => handleToggleGroupCollapse(group.id)}
        onContextMenu={(e) => handleGroupContextMenu(e, group.id)}
        onDragOver={(e) => handleGroupLabelDragOver(e, group.id)}
        onDrop={(e) => handleGroupLabelDrop(e, group.id)}
        data-tauri-disable-drag="true"
      >
        {/* Color dot */}
        <span
          className="w-2 h-2 rounded-full flex-shrink-0 mr-1.5"
          style={{ backgroundColor: group.color }}
        />
        {/* Editable label or static label */}
        {renamingGroupId === group.id ? (
          <input
            ref={groupRenameInputRef}
            type="text"
            value={groupRenameValue}
            onChange={(e) => setGroupRenameValue(e.target.value)}
            onKeyDown={handleGroupRenameKeyDown}
            onBlur={handleCommitGroupRename}
            onClick={(e) => e.stopPropagation()}
            className="text-xs max-w-20 bg-[var(--color-surface)] border border-[var(--color-borderActive)] rounded px-1 py-0 outline-none text-[var(--color-text)]"
          />
        ) : (
          <span className="text-xs font-medium truncate max-w-20" style={{ color: group.color }}>
            {group.name}
          </span>
        )}
        {/* Count badge */}
        <span className="text-[10px] text-[var(--color-textMuted)] ml-1">{count}</span>
        {/* Collapse chevron */}
        {isCollapsed ? (
          <ChevronRight size={12} className="ml-0.5 flex-shrink-0 text-[var(--color-textMuted)]" />
        ) : (
          <ChevronDown size={12} className="ml-0.5 flex-shrink-0 text-[var(--color-textMuted)]" />
        )}
      </div>
    );
  };

  if (sessions.length === 0) {
    return (
      <div className="h-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center justify-center">
        <span className="text-[var(--color-textMuted)] text-sm">No active sessions</span>
      </div>
    );
  }

  return (
    <>
      <div className="h-10 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center overflow-x-auto" data-tauri-disable-drag="true">
        {/* Ungrouped tabs first */}
        {orderedTabs.ungrouped.map((session) => renderTab(session))}

        {/* Grouped tabs */}
        {orderedTabs.grouped.map(({ group, sessions: groupSessions }) => (
          <React.Fragment key={`group-${group.id}`}>
            {renderGroupLabel(group, groupSessions.length)}
            {!group.collapsed && groupSessions.map((session) => renderTab(session, group.color))}
          </React.Fragment>
        ))}
      </div>

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
          const targetSession = sessions[sessionIndex];
          const isFirst = sessionIndex === 0;
          const isLast = sessionIndex === sessions.length - 1;
          const hasTabsToRight = sessionIndex < sessions.length - 1;
          const hasTabsToLeft = sessionIndex > 0;
          const hasOtherTabs = sessions.length > 1;
          const conn = targetSession ? state.connections.find(c => c.id === targetSession.connectionId) : null;
          const isPinned = (targetSession as any)?.pinned ?? false;
          const isInGroup = !!targetSession?.tabGroupId;
          const isTool = targetSession ? isToolProtocol(targetSession.protocol) : false;
          const isWinTool = targetSession ? isWinmgmtProtocol(targetSession.protocol) : false;
          const isRealConnection = !isTool && !isWinTool;

          const act = (fn: () => void) => { fn(); closeContextMenu(); };

          return (
            <>
              {/* ── Tab info (non-interactive) ────────── */}
              <div className="px-3 py-1.5 text-[10px] text-[var(--color-textMuted)] border-b border-[var(--color-border)] select-text">
                <div className="font-medium text-[var(--color-textSecondary)]">{targetSession?.name}</div>
                {isRealConnection && targetSession?.hostname && <div className="font-mono">{targetSession.hostname}{conn?.port ? `:${conn.port}` : ''}</div>}
                {isRealConnection && targetSession?.status && <div>Status: {targetSession.status}</div>}
                {!isRealConnection && <div>{isTool ? "Tool" : "Windows Management"}</div>}
              </div>

              {/* ── Tab group actions ──────────────────────── */}
              <div
                className="sor-menu-item relative"
                onMouseEnter={() => setGroupSubmenuOpen(true)}
                onMouseLeave={() => setGroupSubmenuOpen(false)}
              >
                <Layers size={14} className="mr-2" />
                <span className="flex-1">Add to Group</span>
                <ChevronRight size={12} className="ml-2" />
                {groupSubmenuOpen && (
                  <div
                    className="sor-menu-surface absolute left-full top-0 min-w-[160px] z-[10000]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {tabGroups.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => handleAddToGroup(sessionId, g.id)}
                        className="sor-menu-item"
                      >
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0 mr-2"
                          style={{ backgroundColor: g.color }}
                        />
                        {g.name}
                      </button>
                    ))}
                    {tabGroups.length > 0 && <div className="sor-menu-divider" />}
                    <button
                      onClick={() => handleCreateNewGroup(sessionId)}
                      className="sor-menu-item"
                    >
                      <FolderPlus size={14} className="mr-2" /> New Group...
                    </button>
                  </div>
                )}
              </div>
              {isInGroup && (
                <button onClick={() => handleRemoveFromGroup(sessionId)} className="sor-menu-item">
                  <FolderMinus size={14} className="mr-2" /> Remove from Group
                </button>
              )}
              <button onClick={() => handleCreateNewGroup(sessionId)} className="sor-menu-item">
                <FolderPlus size={14} className="mr-2" /> New Group from Tab
              </button>

              <div className="sor-menu-divider" />

              {/* ── Edit actions ────────────────────────────── */}
              <button onClick={() => handleStartRename(sessionId)} className="sor-menu-item">
                <Pencil size={14} className="mr-2" /> Rename Tab
              </button>
              {isRealConnection && (
                <>
                  <button onClick={() => act(() => {
                    if (targetSession?.hostname) {
                      navigator.clipboard.writeText(targetSession.hostname).catch(() => {});
                    }
                  })} className="sor-menu-item">
                    <ClipboardCopy size={14} className="mr-2" /> Copy Hostname
                  </button>
                  <button onClick={() => act(() => {
                    const info = [
                      targetSession?.name,
                      `${targetSession?.protocol ?? ''}://${targetSession?.hostname ?? ''}${conn?.port ? ':' + conn.port : ''}`,
                      `Status: ${targetSession?.status ?? 'unknown'}`,
                      conn?.username ? `User: ${conn.username}` : '',
                    ].filter(Boolean).join('\n');
                    navigator.clipboard.writeText(info).catch(() => {});
                  })} className="sor-menu-item">
                    <Info size={14} className="mr-2" /> Copy Connection Info
                  </button>
                  <button onClick={() => act(() => {
                    if (targetSession?.connectionId) {
                      window.dispatchEvent(new CustomEvent('reveal-connection', { detail: { connectionId: targetSession.connectionId } }));
                    }
                  })} className="sor-menu-item">
                    <Eye size={14} className="mr-2" /> Reveal in Sidebar
                  </button>
                </>
              )}

              <div className="sor-menu-divider" />

              {/* ── Session actions (connections only) ────────── */}
              {isRealConnection && onSessionReconnect && (
                <button onClick={() => act(() => onSessionReconnect(sessionId))} className="sor-menu-item">
                  <RefreshCw size={14} className="mr-2" /> Reconnect
                </button>
              )}
              {isRealConnection && onSessionDuplicate && (
                <button onClick={() => act(() => onSessionDuplicate(sessionId))} className="sor-menu-item">
                  <Copy size={14} className="mr-2" /> Duplicate Tab
                </button>
              )}
              <button onClick={() => act(() => {
                dispatch({ type: 'UPDATE_SESSION', payload: { ...targetSession!, pinned: !isPinned } as any });
              })} className="sor-menu-item">
                {isPinned
                  ? <><PinOff size={14} className="mr-2" /> Unpin Tab</>
                  : <><Pin size={14} className="mr-2" /> Pin Tab</>}
              </button>

              <div className="sor-menu-divider" />

              {/* ── Window / layout ─────────────────────────── */}
              <button onClick={() => act(() => onSessionDetach(sessionId))} className="sor-menu-item">
                <ExternalLink size={14} className="mr-2" /> Detach to New Window
              </button>
              {detachedWindows.length > 0 && (
                <div
                  className="sor-menu-item relative"
                  onMouseEnter={() => setSendToSubmenuOpen(true)}
                  onMouseLeave={() => setSendToSubmenuOpen(false)}
                >
                  <Send size={14} className="mr-2" />
                  <span className="flex-1">Send to Window</span>
                  <ChevronRight size={12} className="ml-2" />
                  {sendToSubmenuOpen && (
                    <div className="sor-menu-surface absolute left-full top-0 min-w-[160px] z-[10000]" onClick={(e) => e.stopPropagation()}>
                      {detachedWindows.map(w => (
                        <button
                          key={w.label}
                          onClick={() => act(() => {
                            import("@tauri-apps/api/event").then(({ emit }) => {
                              emit("wm:command", { type: "MOVE_SESSION", sessionId, targetWindow: w.label });
                            });
                          })}
                          className="sor-menu-item"
                        >
                          <Monitor size={14} className="mr-2" />
                          {w.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button onClick={() => act(() => onSessionSelect(sessionId))} className="sor-menu-item">
                <Maximize2 size={14} className="mr-2" /> Focus Tab
              </button>
              <button onClick={() => act(() => {
                window.dispatchEvent(new CustomEvent('split-session', { detail: { sessionId, direction: 'right' } }));
              })} className="sor-menu-item">
                <Columns size={14} className="mr-2" /> Split Right
              </button>
              <button onClick={() => act(() => {
                window.dispatchEvent(new CustomEvent('split-session', { detail: { sessionId, direction: 'down' } }));
              })} className="sor-menu-item">
                <Rows size={14} className="mr-2" /> Split Down
              </button>
              <button
                onClick={() => handleMoveTab(sessionId, "left")}
                className={`sor-menu-item ${isFirst ? "opacity-40 pointer-events-none" : ""}`}
                disabled={isFirst}
              >
                <ArrowLeft size={14} className="mr-2" /> Move to Left
              </button>
              <button
                onClick={() => handleMoveTab(sessionId, "right")}
                className={`sor-menu-item ${isLast ? "opacity-40 pointer-events-none" : ""}`}
                disabled={isLast}
              >
                <ArrowRight size={14} className="mr-2" /> Move to Right
              </button>

              <div className="sor-menu-divider" />

              {/* ── Close actions ───────────────────────────── */}
              <button onClick={() => act(() => onSessionClose(sessionId))} className="sor-menu-item sor-menu-item-danger">
                <X size={14} className="mr-2" /> Close Tab
              </button>
              <button
                onClick={() => handleCloseOtherTabs(sessionId)}
                className={`sor-menu-item sor-menu-item-danger ${!hasOtherTabs ? "opacity-40 pointer-events-none" : ""}`}
                disabled={!hasOtherTabs}
              >
                <XCircle size={14} className="mr-2" /> Close Other Tabs
              </button>
              <button
                onClick={() => handleCloseTabsToRight(sessionId)}
                className={`sor-menu-item sor-menu-item-danger ${!hasTabsToRight ? "opacity-40 pointer-events-none" : ""}`}
                disabled={!hasTabsToRight}
              >
                <ArrowRightFromLine size={14} className="mr-2" /> Close Tabs to Right
              </button>
              <button
                onClick={() => {
                  sessions.slice(0, sessionIndex).forEach(s => onSessionClose(s.id));
                  closeContextMenu();
                }}
                className={`sor-menu-item sor-menu-item-danger ${!hasTabsToLeft ? "opacity-40 pointer-events-none" : ""}`}
                disabled={!hasTabsToLeft}
              >
                <ArrowLeftFromLine size={14} className="mr-2" /> Close Tabs to Left
              </button>
            </>
          );
        })()}
      </MenuSurface>

      {/* Group label context menu */}
      <MenuSurface
        isOpen={groupContextMenu !== null}
        onClose={closeGroupContextMenu}
        position={groupContextMenu}
        className="min-w-[180px]"
        dataTestId="group-context-menu"
      >
        {groupContextMenu && (() => {
          const group = tabGroups.find((g) => g.id === groupContextMenu.groupId);
          if (!group) return null;

          return (
            <>
              {/* Group info header */}
              <div className="px-3 py-1.5 text-[10px] text-[var(--color-textMuted)] border-b border-[var(--color-border)] flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: group.color }} />
                <span className="font-medium text-[var(--color-textSecondary)]">{group.name}</span>
              </div>

              <button onClick={() => handleStartGroupRename(group.id)} className="sor-menu-item">
                <Pencil size={14} className="mr-2" /> Rename
              </button>

              {/* Change color with swatches */}
              <div className="px-3 py-2">
                <div className="text-[10px] text-[var(--color-textMuted)] mb-1.5 flex items-center gap-1">
                  <Palette size={10} /> Change Color
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {GROUP_COLORS.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => handleChangeGroupColor(group.id, c.value)}
                      className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                        group.color === c.value ? "border-white" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c.value }}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>

              <div className="sor-menu-divider" />

              <button onClick={() => handleUngroupAll(group.id)} className="sor-menu-item">
                <FolderMinus size={14} className="mr-2" /> Ungroup All
              </button>
              <button onClick={() => handleCloseAllInGroup(group.id)} className="sor-menu-item sor-menu-item-danger">
                <X size={14} className="mr-2" /> Close All in Group
              </button>
            </>
          );
        })()}
      </MenuSurface>

      {/* New Group mini-dialog */}
      {newGroupDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30" onClick={handleCancelNewGroup}>
          <div
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl p-4 min-w-[280px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium text-[var(--color-text)] mb-3">New Tab Group</div>

            {/* Group name input */}
            <input
              ref={newGroupInputRef}
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={handleNewGroupKeyDown}
              placeholder="Group name"
              className="w-full text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1.5 mb-3 outline-none focus:border-[var(--color-borderActive)] text-[var(--color-text)]"
            />

            {/* Color swatches */}
            <div className="text-[10px] text-[var(--color-textMuted)] mb-1.5">Color</div>
            <div className="flex gap-2 mb-4">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setNewGroupColor(c.value)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                    newGroupColor === c.value ? "border-white scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelNewGroup}
                className="px-3 py-1 text-sm text-[var(--color-textSecondary)] hover:text-[var(--color-text)] rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmNewGroup}
                disabled={!newGroupName.trim()}
                className="px-3 py-1 text-sm bg-[var(--color-primary)] text-white rounded disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
