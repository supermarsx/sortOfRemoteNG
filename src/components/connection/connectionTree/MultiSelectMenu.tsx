import React from "react";
import MenuSurface from "../../ui/overlays/MenuSurface";
import { useConnections } from "../../../contexts/useConnections";
import type { Connection } from "../../../types/connection/connection";
import {
  Copy, FileDown, Link, Play, Power, Star, Trash2, Unlink, X,
} from "lucide-react";

interface MultiSelectMenuProps {
  showMenu: boolean;
  menuPosition: { x: number; y: number } | null;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onConnect: (c: Connection) => void;
  onDisconnect: (c: Connection) => void;
  onDelete: (c: Connection) => void;
  onExport: (c: Connection) => void;
}

function MultiSelectMenu({
  showMenu,
  menuPosition,
  triggerRef,
  onClose,
  onConnect,
  onDisconnect,
  onDelete,
  onExport,
}: MultiSelectMenuProps) {
  const { state, dispatch } = useConnections();

  const selectedIds = state.selectedConnectionIds;
  const selected = state.connections.filter((c) => selectedIds.has(c.id));
  const nonGroups = selected.filter((c) => !c.isGroup);
  const connectedSessions = state.sessions.filter((s) =>
    selectedIds.has(s.connectionId),
  );
  const hasConnected = connectedSessions.length > 0;
  const hasDisconnected = nonGroups.length > connectedSessions.length;

  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
    onClose();
  };

  const handleConnectAll = () => {
    nonGroups
      .filter(
        (c) => !state.sessions.some((s) => s.connectionId === c.id),
      )
      .forEach((c) => onConnect(c));
  };

  const handleDisconnectAll = () => {
    nonGroups
      .filter((c) => state.sessions.some((s) => s.connectionId === c.id))
      .forEach((c) => onDisconnect(c));
  };

  const handleDeleteAll = () => {
    selected.forEach((c) => onDelete(c));
    dispatch({ type: "CLEAR_SELECTION" });
  };

  const handleFavoriteAll = () => {
    nonGroups.forEach((c) =>
      dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...c, favorite: true },
      }),
    );
  };

  const handleUnfavoriteAll = () => {
    nonGroups.forEach((c) =>
      dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...c, favorite: false },
      }),
    );
  };

  const handleCopyHostnames = () => {
    const hostnames = nonGroups
      .map((c) => c.hostname)
      .filter(Boolean)
      .join("\n");
    if (hostnames) navigator.clipboard.writeText(hostnames);
  };

  const handleExportAll = () => {
    nonGroups.forEach((c) => onExport(c));
  };

  return (
    <MenuSurface
      isOpen={showMenu}
      onClose={onClose}
      position={menuPosition}
      ignoreRefs={[triggerRef]}
      className="min-w-[180px]"
      dataTestId="multi-select-context-menu"
    >
      {/* Header showing count */}
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--color-textMuted)] border-b border-[var(--color-border)]/50">
        {selected.length} items selected
      </div>

      {hasDisconnected && (
        <button onClick={act(handleConnectAll)} className="sor-menu-item">
          <Play size={14} className="mr-2" />
          Connect All ({nonGroups.length - connectedSessions.length})
        </button>
      )}
      {hasConnected && (
        <button onClick={act(handleDisconnectAll)} className="sor-menu-item">
          <Power size={14} className="mr-2" />
          Disconnect All ({connectedSessions.length})
        </button>
      )}

      <div className="sor-menu-divider" />

      <button onClick={act(handleFavoriteAll)} className="sor-menu-item">
        <Star size={14} className="mr-2" />
        Favorite All
      </button>
      <button onClick={act(handleUnfavoriteAll)} className="sor-menu-item">
        <Star size={14} className="mr-2 text-[var(--color-textMuted)]" />
        Unfavorite All
      </button>

      <div className="sor-menu-divider" />

      <button onClick={act(handleCopyHostnames)} className="sor-menu-item">
        <Copy size={14} className="mr-2" />
        Copy All Hostnames
      </button>
      <button onClick={act(handleExportAll)} className="sor-menu-item">
        <FileDown size={14} className="mr-2" />
        Export Selected
      </button>

      <div className="sor-menu-divider" />

      <button
        onClick={act(() => dispatch({ type: "CLEAR_SELECTION" }))}
        className="sor-menu-item"
      >
        <X size={14} className="mr-2" />
        Clear Selection
      </button>
      <button onClick={act(handleDeleteAll)} className="sor-menu-item sor-menu-item-danger">
        <Trash2 size={14} className="mr-2" />
        Delete Selected ({selected.length})
      </button>
    </MenuSurface>
  );
}

export default MultiSelectMenu;
