
function TreeItemMenu({
  connection, activeSession, showMenu, menuPosition, triggerRef, onClose,
  onConnect, onDisconnect, onEdit, onDelete, onCopyHostname, onRename,
  onExport, onConnectWithOptions, onConnectWithoutCredentials,
  onExecuteScripts, onDiagnostics, onDetachSession, onDuplicate,
}: {
  connection: Connection;
  activeSession: { id: string; status: string } | undefined;
  showMenu: boolean;
  menuPosition: { x: number; y: number } | null;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onConnect: (c: Connection) => void;
  onDisconnect: (c: Connection) => void;
  onEdit: (c: Connection) => void;
  onDelete: (c: Connection) => void;
  onCopyHostname: (c: Connection) => void;
  onRename: (c: Connection) => void;
  onExport: (c: Connection) => void;
  onConnectWithOptions: (c: Connection) => void;
  onConnectWithoutCredentials: (c: Connection) => void;
  onExecuteScripts: (c: Connection, sessionId?: string) => void;
  onDiagnostics: (c: Connection) => void;
  onDetachSession: (sessionId: string) => void;
  onDuplicate: (c: Connection) => void;
}) {
  const { dispatch } = useConnections();
  const act = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); onClose(); };

  return (
    <MenuSurface
      isOpen={showMenu}
      onClose={onClose}
      position={menuPosition}
      ignoreRefs={[triggerRef]}
      className="min-w-[140px]"
      dataTestId="connection-tree-item-menu"
    >
      {!connection.isGroup && (
        <button onClick={act(() => activeSession ? onDisconnect(connection) : onConnect(connection))} className="sor-menu-item">
          {activeSession ? <Power size={14} className="mr-2" /> : <Play size={14} className="mr-2" />}
          {activeSession ? "Disconnect" : "Connect"}
        </button>
      )}
      {!connection.isGroup && (
        <>
          <button onClick={act(() => onConnectWithOptions(connection))} className="sor-menu-item">
            <SlidersHorizontal size={14} className="mr-2" />Connect with options
          </button>
          <button onClick={act(() => onConnectWithoutCredentials(connection))} className="sor-menu-item">
            <UserX size={14} className="mr-2" />Connect without credentials
          </button>
          <button onClick={act(() => onExecuteScripts(connection, activeSession?.id))} className="sor-menu-item">
            <Play size={14} className="mr-2" />Execute scripts
          </button>
          <button onClick={act(() => onDiagnostics(connection))} className="sor-menu-item">
            <Activity size={14} className="mr-2" />Diagnostics
          </button>
          {activeSession && (
            <button onClick={act(() => onDetachSession(activeSession.id))} className="sor-menu-item">
              <ExternalLink size={14} className="mr-2" />Detach window
            </button>
          )}
        </>
      )}
      {!connection.isGroup && <div className="sor-menu-divider" />}
      <button onClick={act(() => onEdit(connection))} className="sor-menu-item">
        <Edit size={14} className="mr-2" />Edit
      </button>
      <button onClick={act(() => onRename(connection))} className="sor-menu-item">
        <Edit size={14} className="mr-2" />Rename
      </button>
      {!connection.isGroup && (
        <button
          onClick={act(() => dispatch({ type: "UPDATE_CONNECTION", payload: { ...connection, favorite: !connection.favorite } }))}
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
        <button onClick={act(() => onCopyHostname(connection))} className="sor-menu-item">
          <Copy size={14} className="mr-2" />Copy hostname
        </button>
      )}
      {!connection.isGroup && (
        <button onClick={act(() => onExport(connection))} className="sor-menu-item">
          <FileDown size={14} className="mr-2" />Export to file
        </button>
      )}
      <button onClick={act(() => onDuplicate(connection))} className="sor-menu-item">
        <Copy size={14} className="mr-2" />Duplicate
      </button>
      <div className="sor-menu-divider" />
      <button onClick={act(() => onDelete(connection))} className="sor-menu-item sor-menu-item-danger">
        <Trash2 size={14} className="mr-2" />Delete
      </button>
    </MenuSurface>
  );
}

export default TreeItemMenu;
