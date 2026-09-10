import {
  ConnectionTreeItemProps,
  getConnectionIconResolution,
  getStatusColor,
} from "./helpers";
import TreeItemMenu from "./TreeItemMenu";
import MultiSelectMenu from "./MultiSelectMenu";
import React, { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useConnections } from "../../../contexts/useConnections";
import { useSettings } from "../../../contexts/SettingsContext";
import { resolveFolderIconColor } from "../../../utils/settings/folderIconColor";
import { isToolProtocol } from "../../app/toolSession";
import { getExpandedFolderIcon } from "../../../utils/icons/resolveConnectionIcon";
import { useIconLibraryRevision } from "../../../utils/icons/iconLibraryRuntime";
import {
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Play,
  Power,
  Shield,
  Star,
} from "lucide-react";

interface RowState {
  folderIconColor?: string;
  dispatch: ReturnType<typeof useConnections>["dispatch"];
  isSelected: boolean;
  isMultiSelected: boolean;
  activeSession?: ReturnType<
    typeof useConnections
  >["state"]["sessions"][number];
  expanded?: boolean;
  setSize?: number;
  posInSet?: number;
}

export const ConnectionTreeRow = React.memo(function ConnectionTreeRow({
  folderIconColor = "var(--color-warning)",
  dispatch,
  isSelected,
  isMultiSelected,
  activeSession,
  expanded,
  setSize,
  posInSet,
  connection,
  level,
  onConnect,
  onDisconnect,
  onEdit,
  onNewConnection,
  onDelete,
  onCopyHostname,
  onRename,
  onExport,
  onConnectWithOptions,
  onConnectWithoutCredentials,
  onExecuteScripts,
  onDiagnostics,
  onDetachSession,
  onDuplicate,
  onCheckConnection,
  onWindowsTool,
  onConnectAll,
  onConnectAllRecursive,
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
  folderSingleClickToggle,
  folderDoubleClickToggle,
}: ConnectionTreeItemProps & RowState) {
  useIconLibraryRevision();
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const [showMultiMenu, setShowMultiMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Expansion is driven entirely by the reducer's `connection.expanded`
  // (the same source ConnectionTree uses to decide whether to render
  // children). Keeping a separate local copy here caused the chevron /
  // icon / aria-expanded to drift out of sync whenever `expanded` was
  // changed from outside this component (drag-drop auto-expand,
  // collection reload, cross-window settings sync), so the displayed
  // state was not applied in real time. Read it directly instead.
  const isExpanded = expanded ?? connection.expanded ?? false;

  const iconResolution = getConnectionIconResolution(connection);
  const ProtocolIcon = getExpandedFolderIcon(
    iconResolution,
    !!connection.isGroup && isExpanded,
  );

  const handleToggleExpand = () => {
    if (connection.isGroup) {
      dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...connection, expanded: !isExpanded },
      });
    }
  };

  const handleFolderRowClick = (clickCount: number) => {
    if (!folderSingleClickToggle || clickCount > 1) return;
    handleToggleExpand();
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      dispatch({
        type: "TOGGLE_SELECT_CONNECTION",
        payload: {
          id: connection.id,
          ctrl: e.ctrlKey || e.metaKey,
          shift: e.shiftKey,
        },
      });
      return;
    }
    dispatch({ type: "SELECT_CONNECTION", payload: connection });
    if (connection.isGroup) {
      // Folder rows: toggle expand on any click within the row
      // (not just the chevron) when the setting is on. The chevron
      // button keeps its own onClick + stopPropagation so it still
      // works either way. Ignore the second click from a double-click
      // gesture so two click events do not cancel each other out.
      handleFolderRowClick(e.detail);
    } else {
      if (activeSession && singleClickDisconnect) onDisconnect(connection);
      else if (!activeSession && singleClickConnect) onConnect(connection);
    }
  };

  const handleDoubleClick = () => {
    if (connection.isGroup) {
      if (folderDoubleClickToggle && !folderSingleClickToggle) {
        handleToggleExpand();
      }
      return;
    }
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

  const calcDropPosition = (
    clientY: number,
    rect: DOMRect,
  ): "before" | "after" | "inside" => {
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
    <div
      data-testid={
        connection.isGroup ? "connection-group" : "connection-tree-item"
      }
      className="relative"
      role="treeitem"
      aria-level={level + 1}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      aria-expanded={connection.isGroup ? isExpanded : undefined}
      aria-selected={isSelected}
      tabIndex={isSelected ? 0 : -1}
    >
      <div
        data-connection-item="true"
        data-connection-id={connection.id}
        data-tauri-disable-drag="true"
        className={`group flex items-center h-8 px-2 cursor-pointer hover:bg-[var(--color-border)]/50 transition-colors relative ${
          isSelected
            ? "bg-primary/20 text-primary"
            : "text-[var(--color-textSecondary)]"
        } ${isDragging ? "opacity-50 scale-95" : ""} ${
          isDragOver && dropPosition === "inside"
            ? "bg-primary/20 ring-2 ring-primary/50 ring-inset"
            : ""
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        draggable={enableReorder}
        onDragStart={(e) => {
          if (!enableReorder) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          e.dataTransfer.effectAllowed = "all";
          e.dataTransfer.dropEffect = "move";
          e.dataTransfer.setData("text/plain", connection.id);
          onDragStart(connection.id);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!enableReorder) {
            e.dataTransfer.dropEffect = "none";
            return;
          }
          e.dataTransfer.dropEffect = "move";
          onDragOver(
            connection.id,
            calcDropPosition(
              e.clientY,
              e.currentTarget.getBoundingClientRect(),
            ),
          );
        }}
        onDragLeave={(e) => {
          const relatedTarget = e.relatedTarget as HTMLElement;
          if (!e.currentTarget.contains(relatedTarget)) onDragLeave();
        }}
        onDragEnd={onDragEnd}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!enableReorder) {
            e.dataTransfer.dropEffect = "none";
            return;
          }
          onDrop(
            connection.id,
            calcDropPosition(
              e.clientY,
              e.currentTarget.getBoundingClientRect(),
            ),
          );
        }}
      >
        {isDragOver && dropPosition === "before" && (
          <div className="absolute left-0 right-0 top-0 h-0.5 bg-primary z-10" />
        )}
        {isDragOver && dropPosition === "after" && (
          <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-primary z-10" />
        )}

        {connection.isGroup && (
          <button
            onClick={(e) => {
              // When the row-click toggle is on, the row's own
              // onClick already calls handleToggleExpand; letting
              // the chevron click bubble would toggle twice (net
              // no-op). When it's off, the chevron must fire and
              // the row click only selects, so we don't stop
              // propagation in that mode.
              if (folderSingleClickToggle) {
                e.stopPropagation();
                handleToggleExpand();
              } else {
                handleToggleExpand();
              }
            }}
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
          <ProtocolIcon
            size={16}
            aria-label={iconResolution.ariaLabel}
            className={`mr-2 ${connection.isGroup ? "text-warning" : getStatusColor(activeSession?.status)}`}
            style={connection.isGroup ? { color: folderIconColor } : undefined}
          />
          {connection.favorite && (
            <Star
              size={11}
              className="mr-1 text-warning flex-shrink-0"
              fill="currentColor"
            />
          )}
          <span className="truncate text-sm">{connection.name}</span>
          {!connection.isGroup &&
            ((connection.security?.tunnelChain?.length ?? 0) > 0 ||
              connection.proxyChainId ||
              connection.connectionChainId) && (
              <span
                className="ml-1 flex-shrink-0 text-[var(--color-textMuted)]"
                title={t(
                  "connections.vpnProxyChainConfigured",
                  "VPN/Proxy chain configured",
                )}
              >
                <Shield size={10} />
              </span>
            )}
          {activeSession && (
            <div
              className={`ml-2 w-2 h-2 rounded-full ${
                activeSession.status === "connected"
                  ? "bg-success"
                  : activeSession.status === "connecting"
                    ? "bg-warning"
                    : "bg-error"
              }`}
            />
          )}
        </div>

        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
          {!connection.isGroup &&
            (activeSession ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDisconnect(connection);
                }}
                className="p-1 hover:bg-[var(--color-border)] rounded transition-colors"
                data-tooltip={t("connections.disconnect", "Disconnect")}
              >
                <Power size={12} />
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onConnect(connection);
                }}
                className="p-1 hover:bg-[var(--color-border)] rounded transition-colors"
                data-tooltip={t("quickConnect.connect", "Connect")}
              >
                <Play size={12} />
              </button>
            ))}
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
            onCheckConnection={onCheckConnection}
            onWindowsTool={onWindowsTool}
            onConnectAll={onConnectAll}
            onConnectAllRecursive={onConnectAllRecursive}
            onNewConnection={onNewConnection}
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
});

// Standalone consumers keep the context adapter. The tree passes indexed row
// state directly so unrelated session/context changes do not wake every row.
const ConnectionTreeItem: React.FC<ConnectionTreeItemProps> = (props) => {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  return (
    <ConnectionTreeRow
      {...props}
      folderIconColor={resolveFolderIconColor(settings)}
      dispatch={dispatch}
      isSelected={state.selectedConnectionIds.has(props.connection.id)}
      isMultiSelected={state.selectedConnectionIds.size > 1}
      activeSession={state.sessions.find(
        (s) =>
          s.connectionId === props.connection.id && !isToolProtocol(s.protocol),
      )}
    />
  );
};

export default ConnectionTreeItem;
