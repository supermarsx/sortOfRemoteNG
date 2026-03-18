import { ConnectionTreeItemProps, getConnectionIcon, getStatusColor } from "./helpers";
import TreeItemMenu from "./TreeItemMenu";
import MultiSelectMenu from "./MultiSelectMenu";
import React, { useState, useRef } from "react";
import { useConnections } from "../../../contexts/useConnections";
import { ChevronDown, ChevronRight, Folder, FolderOpen, MoreVertical, Play, Power, Star } from "lucide-react";

const ConnectionTreeItem: React.FC<ConnectionTreeItemProps> = ({
  connection, level,
  onConnect, onDisconnect, onEdit, onDelete, onCopyHostname, onRename, onExport,
  onConnectWithOptions, onConnectWithoutCredentials, onExecuteScripts,
  onDiagnostics, onDetachSession, onDuplicate, onWindowsTool,
  onConnectAll, onConnectAllRecursive,
  enableReorder, isDragging, isDragOver, dropPosition,
  onDragStart, onDragOver, onDragLeave, onDragEnd, onDrop,
  singleClickConnect, singleClickDisconnect, doubleClickRename,
}) => {
  const { state, dispatch } = useConnections();
  const [showMenu, setShowMenu] = useState(false);
  const [showMultiMenu, setShowMultiMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(connection.expanded || false);

  const ProtocolIcon = getConnectionIcon(connection);
  const isSelected = state.selectedConnectionIds.has(connection.id);
  const isMultiSelected = state.selectedConnectionIds.size > 1;
  const activeSession = state.sessions.find((s) => s.connectionId === connection.id);

  const handleToggleExpand = () => {
    if (connection.isGroup) {
      setIsExpanded(!isExpanded);
      dispatch({ type: "UPDATE_CONNECTION", payload: { ...connection, expanded: !isExpanded } });
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      dispatch({
        type: "TOGGLE_SELECT_CONNECTION",
        payload: { id: connection.id, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey },
      });
      return;
    }
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

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicking on an item that's part of a multi-selection, keep the multi-select
    if (isMultiSelected && isSelected) {
      setMenuPosition({ x: e.clientX, y: e.clientY });
      setShowMultiMenu(true);
      return;
    }
    // Otherwise, select this item and show normal menu
    if (e.ctrlKey || e.metaKey) {
      dispatch({
        type: "TOGGLE_SELECT_CONNECTION",
        payload: { id: connection.id, ctrl: true, shift: false },
      });
    } else {
      dispatch({ type: "SELECT_CONNECTION", payload: connection });
    }
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setShowMenu(true);
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
        data-connection-id={connection.id}
        data-tauri-disable-drag="true"
        className={`group flex items-center h-8 px-2 cursor-pointer hover:bg-[var(--color-border)]/50 transition-colors relative ${
          isSelected ? "bg-primary/20 text-primary" : "text-[var(--color-textSecondary)]"
        } ${isDragging ? "opacity-50 scale-95" : ""} ${
          isDragOver && dropPosition === "inside" ? "bg-primary/20 ring-2 ring-primary/50 ring-inset" : ""
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
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
        {isDragOver && dropPosition === "before" && <div className="absolute left-0 right-0 top-0 h-0.5 bg-primary z-10" />}
        {isDragOver && dropPosition === "after" && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-primary z-10" />}

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
            isExpanded ? <FolderOpen size={16} className="mr-2 text-warning" /> : <Folder size={16} className="mr-2 text-warning" />
          ) : (
            <ProtocolIcon size={16} className={`mr-2 ${getStatusColor(activeSession?.status)}`} />
          )}
          {connection.favorite && (
            <Star size={11} className="mr-1 text-warning flex-shrink-0" fill="currentColor" />
          )}
          <span className="truncate text-sm">{connection.name}</span>
          {activeSession && (
            <div className={`ml-2 w-2 h-2 rounded-full ${
              activeSession.status === "connected" ? "bg-success"
                : activeSession.status === "connecting" ? "bg-warning" : "bg-error"
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
              if (isMultiSelected && isSelected) {
                setShowMultiMenu((prev) => !prev);
              } else {
                setShowMenu((prev) => !prev);
              }
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
            onWindowsTool={onWindowsTool}
            onConnectAll={onConnectAll}
            onConnectAllRecursive={onConnectAllRecursive}
          />
        )}
        {showMultiMenu && (
          <MultiSelectMenu
            showMenu={showMultiMenu}
            menuPosition={menuPosition}
            triggerRef={triggerRef}
            onClose={() => setShowMultiMenu(false)}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onDelete={onDelete}
            onExport={onExport}
          />
        )}
      </div>
    </div>
  );
};

export default ConnectionTreeItem;
