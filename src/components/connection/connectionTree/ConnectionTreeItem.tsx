import { ConnectionTreeItemProps, getConnectionIcon, getStatusColor } from "./helpers";
import TreeItemMenu from "./TreeItemMenu";

const ConnectionTreeItem: React.FC<ConnectionTreeItemProps> = ({
  connection, level,
  onConnect, onDisconnect, onEdit, onDelete, onCopyHostname, onRename, onExport,
  onConnectWithOptions, onConnectWithoutCredentials, onExecuteScripts,
  onDiagnostics, onDetachSession, onDuplicate,
  enableReorder, isDragging, isDragOver, dropPosition,
  onDragStart, onDragOver, onDragLeave, onDragEnd, onDrop,
  singleClickConnect, singleClickDisconnect, doubleClickRename,
}) => {
  const { state, dispatch } = useConnections();
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(connection.expanded || false);

  const ProtocolIcon = getConnectionIcon(connection);
  const isSelected = state.selectedConnection?.id === connection.id;
  const activeSession = state.sessions.find((s) => s.connectionId === connection.id);

  const handleToggleExpand = () => {
    if (connection.isGroup) {
      setIsExpanded(!isExpanded);
      dispatch({ type: "UPDATE_CONNECTION", payload: { ...connection, expanded: !isExpanded } });
    }
  };

  const handleSelect = () => {
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
        data-tauri-disable-drag="true"
        className={`group flex items-center h-8 px-2 cursor-pointer hover:bg-[var(--color-border)]/50 transition-colors relative ${
          isSelected ? "bg-blue-600/20 text-blue-400" : "text-[var(--color-textSecondary)]"
        } ${isDragging ? "opacity-50 scale-95" : ""} ${
          isDragOver && dropPosition === "inside" ? "bg-blue-500/20 ring-2 ring-blue-500/50 ring-inset" : ""
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleSelect}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenuPosition({ x: e.clientX, y: e.clientY }); setShowMenu(true); }}
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
        {isDragOver && dropPosition === "before" && <div className="absolute left-0 right-0 top-0 h-0.5 bg-blue-500 z-10" />}
        {isDragOver && dropPosition === "after" && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500 z-10" />}

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
            isExpanded ? <FolderOpen size={16} className="mr-2 text-yellow-400" /> : <Folder size={16} className="mr-2 text-yellow-400" />
          ) : (
            <ProtocolIcon size={16} className={`mr-2 ${getStatusColor(activeSession?.status)}`} />
          )}
          <span className="truncate text-sm">{connection.name}</span>
          {activeSession && (
            <div className={`ml-2 w-2 h-2 rounded-full ${
              activeSession.status === "connected" ? "bg-green-400"
                : activeSession.status === "connecting" ? "bg-yellow-400" : "bg-red-400"
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
              setShowMenu((prev) => !prev);
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
          />
        )}
      </div>
    </div>
  );
};

export default ConnectionTreeItem;
