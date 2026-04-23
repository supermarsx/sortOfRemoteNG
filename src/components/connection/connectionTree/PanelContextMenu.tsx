
import MenuSurface from "../../ui/overlays/MenuSurface";
import type { ConnectionTreeMgr } from "../../../hooks/connection/useConnectionTree";
import type { Connection } from "../../../types/connection/connection";
import { Upload, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";
function PanelContextMenu({ mgr, onOpenImport }: { mgr: ConnectionTreeMgr; onOpenImport?: () => void }) {
  const { t } = useTranslation();
  const open = Boolean(mgr.panelMenuPosition);
  if (!open) return null;
  const selectedIds = mgr.state.selectedConnectionIds;
  const selected: Connection[] = mgr.state.connections.filter(
    (c) => selectedIds.has(c.id) && !c.isGroup,
  );
  const hasSelection = selected.length > 0;
  return (
    <MenuSurface
      isOpen={open}
      onClose={() => mgr.setPanelMenuPosition(null)}
      position={mgr.panelMenuPosition}
      className="min-w-[160px] rounded-lg py-1"
      dataTestId="connection-tree-panel-menu"
      ariaLabel="Connection tree context menu"
    >
      {onOpenImport && (
        <button
          onClick={() => { onOpenImport(); mgr.setPanelMenuPosition(null); }}
          className="sor-menu-item"
        >
          <Upload size={14} />
          Import Connections
        </button>
      )}
      {hasSelection && (
        <button
          onClick={() => { mgr.handleCheckConnections(selected); mgr.setPanelMenuPosition(null); }}
          className="sor-menu-item"
        >
          <Wifi size={14} />
          {t('connections.checkTheseConnections')}
        </button>
      )}
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
