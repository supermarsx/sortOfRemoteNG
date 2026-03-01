
function PanelContextMenu({ mgr, onOpenImport }: { mgr: ConnectionTreeMgr; onOpenImport?: () => void }) {
  if (!mgr.panelMenuPosition || !onOpenImport) return null;
  return (
    <MenuSurface
      isOpen={Boolean(mgr.panelMenuPosition && onOpenImport)}
      onClose={() => mgr.setPanelMenuPosition(null)}
      position={mgr.panelMenuPosition}
      className="min-w-[160px] rounded-lg py-1"
      dataTestId="connection-tree-panel-menu"
    >
      <button
        onClick={() => { onOpenImport(); mgr.setPanelMenuPosition(null); }}
        className="sor-menu-item"
      >
        <Upload size={14} />
        Import Connections
      </button>
    </MenuSurface>
  );
}

/* ── Root component ────────────────────────────────────────────── */

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


export default PanelContextMenu;
