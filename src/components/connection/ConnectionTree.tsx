import ConnectionTreeItem from "./connectionTree/ConnectionTreeItem";
import TreeItemMenu from "./connectionTree/TreeItemMenu";
import RenameModal from "./connectionTree/RenameModal";
import ConnectOptionsModal from "./connectionTree/ConnectOptionsModal";
import PanelContextMenu from "./connectionTree/PanelContextMenu";

export const ConnectionTree: React.FC<ConnectionTreeProps> = ({
  onConnect, onDisconnect, onEdit, onDelete, onDiagnostics,
  onSessionDetach, onOpenImport, enableReorder = true,
}) => {
  const mgr = useConnectionTree(onConnect, enableReorder);

  const renderTree = (connections: Connection[], level: number = 0): React.ReactNode => {
    return connections.map((connection) => (
      <div key={connection.id}>
        <ConnectionTreeItem
          connection={connection}
          level={level}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onEdit={onEdit}
          onDelete={onDelete}
          onCopyHostname={mgr.handleCopyHostname}
          onRename={mgr.handleRename}
          onExport={mgr.handleExportConnection}
          onConnectWithOptions={mgr.handleConnectWithOptions}
          onConnectWithoutCredentials={mgr.handleConnectWithoutCredentials}
          onExecuteScripts={mgr.handleExecuteScripts}
          onDiagnostics={onDiagnostics}
          onDetachSession={onSessionDetach}
          onDuplicate={mgr.handleDuplicate}
          enableReorder={enableReorder}
          isDragging={mgr.draggedId === connection.id}
          isDragOver={mgr.dragOverId === connection.id && mgr.draggedId !== connection.id}
          dropPosition={mgr.dragOverId === connection.id && mgr.draggedId !== connection.id ? mgr.dropPosition : null}
          singleClickConnect={mgr.settings.singleClickConnect}
          singleClickDisconnect={mgr.settings.singleClickDisconnect}
          doubleClickRename={mgr.settings.doubleClickRename}
          onDragStart={mgr.handleItemDragStart}
          onDragOver={mgr.handleItemDragOver}
          onDragLeave={() => { /* let next dragOver set the new target */ }}
          onDragEnd={mgr.handleItemDragEnd}
          onDrop={mgr.handleItemDrop}
        />
        {connection.isGroup && connection.expanded && (
          <div>{renderTree(mgr.buildTree(mgr.state.connections, connection.id), level + 1)}</div>
        )}
      </div>
    ));
  };

  return (
    <>
      <div
        className={`flex-1 overflow-y-auto ${mgr.draggedId ? "min-h-[100px]" : ""}`}
        data-tauri-disable-drag="true"
        onContextMenu={mgr.handlePanelContextMenu}
        onDragOver={mgr.handlePanelDragOver}
        onDrop={mgr.handlePanelDrop}
      >
        {mgr.filteredConnections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-[var(--color-textMuted)]">
            <Monitor size={24} className="mb-2" />
            <p className="text-sm">No connections found</p>
          </div>
        ) : (
          renderTree(mgr.buildTree(mgr.filteredConnections))
        )}
      </div>

      <PanelContextMenu mgr={mgr} onOpenImport={onOpenImport} />
      <RenameModal mgr={mgr} />
      <ConnectOptionsModal mgr={mgr} />
    </>
  );
};

