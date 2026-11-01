import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ExternalLink,
  Maximize2,
  MoreVertical,
  SquareStack,
  X,
} from "lucide-react";
import {
  ConnectionSession,
  TabLayout,
} from "../../types/connection/connection";
import { useTabLayoutManager } from "../../hooks/session/useTabLayoutManager";
import MenuSurface from "../ui/overlays/MenuSurface";
import { isMosaicMode } from "../../utils/session/tabLayoutBuilder";
import { SessionRenderActivityProvider } from "./SessionRenderActivity";
import {
  isSuspendableSshViewer,
  useSshViewerMountBudget,
} from "../../hooks/session/useSshViewerMountBudget";

/* Shared with SessionTabs so dragging a tab into a tile works. */
export const SESSION_TAB_DND_TYPE = "application/x-session-tab";

/* ── Tile header overlay for mosaic modes ─────────────── */

interface TileHeaderProps {
  session: ConnectionSession;
  isActive: boolean;
  slotIndex: number;
  totalSlots: number;
  otherSessions: ConnectionSession[];
  onSelect: () => void;
  onDetach: () => void;
  onClose: () => void;
  onShowInTile: (otherSessionId: string) => void;
  /** Switch the whole layout to tabs mode focused on this session. */
  onMaximize: () => void;
}

const TileHeader: React.FC<TileHeaderProps> = ({
  session,
  isActive,
  slotIndex,
  totalSlots,
  otherSessions,
  onSelect,
  onDetach,
  onClose,
  onShowInTile,
  onMaximize,
}) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [showSubmenu, setShowSubmenu] = useState(false);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuOpen({ x: rect.left, y: rect.bottom });
  };

  return (
    <>
      <div
        className={`absolute top-0 left-0 right-0 z-10 bg-[var(--color-surface)] border-b px-2 py-1 flex items-center justify-between cursor-pointer select-none ${
          isActive ? "border-primary" : "border-[var(--color-border)]"
        }`}
        onClick={onSelect}
        data-testid={`tile-header-${slotIndex}`}
      >
        <div className="flex items-center min-w-0 gap-1.5 select-none">
          <span className="text-[10px] text-[var(--color-textMuted)] shrink-0 select-none">
            {slotIndex + 1}/{totalSlots}
          </span>
          <span className="text-[var(--color-text)] text-sm truncate select-none">
            {session.name}
          </span>
        </div>
        <div className="flex items-center space-x-0.5">
          <button
            onClick={openMenu}
            className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)] p-0.5 rounded hover:bg-[var(--color-border)]"
            title={t("session.tabLayout.tile.menu", "Tile menu")}
            aria-label={t("session.tabLayout.tile.menu", "Tile menu")}
            data-testid={`tile-menu-trigger-${slotIndex}`}
          >
            <MoreVertical size={12} />
          </button>
          <button
            onClick={(ev) => {
              ev.stopPropagation();
              onDetach();
            }}
            className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)] p-0.5 rounded hover:bg-[var(--color-border)]"
            title={t("session.tabLayout.tile.detach", "Detach")}
            aria-label={t("session.tabLayout.tile.detach", "Detach")}
          >
            <ExternalLink size={12} />
          </button>
          <button
            onClick={(ev) => {
              ev.stopPropagation();
              onClose();
            }}
            className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)] p-0.5 rounded hover:bg-[var(--color-border)]"
            title={t("session.tabLayout.tile.close", "Close")}
            aria-label={t("session.tabLayout.tile.close", "Close")}
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <MenuSurface
        isOpen={menuOpen !== null}
        onClose={() => {
          setMenuOpen(null);
          setShowSubmenu(false);
        }}
        position={menuOpen}
        className="min-w-[200px]"
        dataTestId={`tile-menu-${slotIndex}`}
        ariaLabel={t("session.tabLayout.tile.actionsAria", "Tile actions")}
      >
        <div className="px-3 py-1.5 text-[10px] text-[var(--color-textMuted)] border-b border-[var(--color-border)]">
          {t("session.tabLayout.tile.label", "Tile")} {slotIndex + 1}{" "}
          {t("session.tabLayout.tile.of", "of")} {totalSlots}
        </div>
        <div
          className="sor-menu-submenu"
          data-submenu-open={showSubmenu ? "true" : "false"}
          onMouseEnter={() => setShowSubmenu(true)}
          onMouseLeave={() => setShowSubmenu(false)}
        >
          <button
            className="sor-menu-item"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={showSubmenu}
            onClick={() => setShowSubmenu((v) => !v)}
          >
            <SquareStack size={14} className="mr-2" />
            <span className="flex-1">
              {t("session.tabLayout.tile.showInThisTile", "Show in this tile…")}
            </span>
          </button>
          <div
            className="sor-menu-submenu-panel"
            role="menu"
            tabIndex={-1}
            aria-label={t(
              "session.tabLayout.tile.showInThisTileAria",
              "Show session in this tile",
            )}
          >
            {otherSessions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--color-textMuted)]">
                {t(
                  "session.tabLayout.tile.noOtherSessions",
                  "No other sessions",
                )}
              </div>
            ) : (
              otherSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    onShowInTile(s.id);
                    setMenuOpen(null);
                    setShowSubmenu(false);
                  }}
                  className="sor-menu-item"
                  role="menuitem"
                >
                  <span className="truncate">{s.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
        <button
          onClick={() => {
            onMaximize();
            setMenuOpen(null);
          }}
          className="sor-menu-item"
        >
          <Maximize2 size={14} className="mr-2" />{" "}
          {t("session.tabLayout.tile.maximize", "Maximize (switch to tabs)")}
        </button>
        <div className="sor-menu-divider" />
        <button
          onClick={() => {
            onDetach();
            setMenuOpen(null);
          }}
          className="sor-menu-item"
        >
          <ExternalLink size={14} className="mr-2" />{" "}
          {t("session.tabLayout.tile.detachWindow", "Detach to new window")}
        </button>
        <button
          onClick={() => {
            onClose();
            setMenuOpen(null);
          }}
          className="sor-menu-item sor-menu-item-danger"
        >
          <X size={14} className="mr-2" />{" "}
          {t("session.tabLayout.tile.closeSession", "Close session")}
        </button>
      </MenuSurface>
    </>
  );
};

/* ── Compute per-session CSS from layout ──────────────── */

interface SessionStyle {
  position: "absolute";
  left: string;
  top: string;
  width: string;
  height: string;
  visibility: "visible" | "hidden";
  zIndex: number;
}

function computeSessionStyles(
  sessions: ConnectionSession[],
  layout: TabLayout,
  activeSessionId?: string,
): Map<string, SessionStyle> {
  const styles = new Map<string, SessionStyle>();
  const isTabsMode = layout.mode === "tabs";
  const isMiniMosaic = layout.mode === "miniMosaic";

  if (isTabsMode) {
    for (const session of sessions) {
      const isActive = session.id === activeSessionId;
      styles.set(session.id, {
        position: "absolute",
        left: "0",
        top: "0",
        width: "100%",
        height: "100%",
        visibility: isActive ? "visible" : "hidden",
        zIndex: isActive ? 1 : 0,
      });
    }
  } else if (isMiniMosaic) {
    for (const session of sessions) {
      styles.set(session.id, {
        position: "absolute",
        left: "0",
        top: "0",
        width: "0",
        height: "0",
        visibility: "hidden",
        zIndex: 0,
      });
    }
  } else {
    const layoutMap = new Map(
      layout.sessions.map((s) => [s.sessionId, s.position]),
    );
    for (const session of sessions) {
      const pos = layoutMap.get(session.id);
      const isActive = session.id === activeSessionId;
      if (pos) {
        styles.set(session.id, {
          position: "absolute",
          left: `${pos.x}%`,
          top: `${pos.y}%`,
          width: `${pos.width}%`,
          height: `${pos.height}%`,
          visibility: "visible",
          zIndex: isActive ? 10 : 1,
        });
      } else {
        styles.set(session.id, {
          position: "absolute",
          left: "0",
          top: "0",
          width: "0",
          height: "0",
          visibility: "hidden",
          zIndex: 0,
        });
      }
    }
  }
  return styles;
}

/* ── Main Component ──────────────────────────────────── */

interface TabLayoutManagerProps {
  sessions: ConnectionSession[];
  activeSessionId?: string;
  layout: TabLayout;
  onLayoutChange: (layout: TabLayout) => void;
  onSessionSelect: (sessionId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onSessionDetach: (sessionId: string) => void;
  renderSession: (session: ConnectionSession) => React.ReactNode;
  middleClickCloseTab?: boolean;
  maxMountedSshViewers?: number;
}

export const TabLayoutManager: React.FC<TabLayoutManagerProps> = ({
  sessions,
  activeSessionId,
  layout,
  onLayoutChange,
  onSessionSelect,
  onSessionClose,
  onSessionDetach,
  renderSession,
  middleClickCloseTab = true,
  maxMountedSshViewers,
}) => {
  const { t } = useTranslation();
  const mgr = useTabLayoutManager(
    sessions,
    activeSessionId,
    layout,
    onLayoutChange,
    onSessionClose,
    middleClickCloseTab,
  );

  const isTabsMode = layout.mode === "tabs";
  const isMiniMosaic = layout.mode === "miniMosaic";
  const mosaicMode = isMosaicMode(layout.mode);

  const sessionStyles = useMemo(
    () => computeSessionStyles(sessions, layout, activeSessionId),
    [sessions, layout, activeSessionId],
  );
  const sshViewerPriorityIds = useMemo(() => {
    const priority: string[] = [];
    if (activeSessionId) priority.push(activeSessionId);
    for (const session of sessions) {
      if (sessionStyles.get(session.id)?.visibility === "visible") {
        priority.push(session.id);
      }
    }
    return [...new Set(priority)];
  }, [activeSessionId, sessionStyles, sessions]);
  const sshViewerMountBudget = useSshViewerMountBudget(
    sessions,
    sshViewerPriorityIds,
    maxMountedSshViewers,
  );

  /* ── Drag-and-drop drop zones ──────────────────────
   * In mosaic modes, dragging a tab from SessionTabs over a tile
   * shows a drop indicator; releasing assigns that session to the
   * tile (swapping with whatever was there).
   */
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);

  const handleSlotDragOver = useCallback(
    (e: React.DragEvent, slotIndex: number) => {
      if (!mosaicMode) return;
      if (!e.dataTransfer.types.includes(SESSION_TAB_DND_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverSlot(slotIndex);
    },
    [mosaicMode],
  );

  const handleSlotDrop = useCallback(
    (e: React.DragEvent, slotIndex: number) => {
      if (!mosaicMode) return;
      const sessionId = e.dataTransfer.getData(SESSION_TAB_DND_TYPE);
      if (!sessionId) return;
      e.preventDefault();
      setDragOverSlot(null);
      mgr.assignSessionToSlot(sessionId, slotIndex);
      onSessionSelect(sessionId);
    },
    [mosaicMode, mgr, onSessionSelect],
  );

  return (
    <div className="flex flex-col h-full">
      {/* ── Stable session container ─────────────────── */}
      {/*
        Session containers remain stable across layout changes. Protocols whose
        React viewer owns transport stay mounted. Established inactive SSH
        actors may release their xterm-only viewer under the bounded MRU budget;
        the native actor remains alive and replays into a fresh viewer on focus.
      */}
      <div ref={mgr.containerRef} className="flex-1 overflow-hidden relative">
        {sessions.map((session) => {
          const style = sessionStyles.get(session.id);
          if (!style) return null;
          const isActive = session.id === activeSessionId;
          const slotIndex = layout.sessions.findIndex(
            (s) => s.sessionId === session.id,
          );
          const isVisibleTile =
            mosaicMode && style.visibility === "visible" && slotIndex >= 0;
          const isRendererActive = isVisibleTile || (isTabsMode && isActive);
          const isViewerMounted =
            !isSuspendableSshViewer(session) ||
            sshViewerMountBudget.mountedSessionIds.has(session.id);
          const isDropTarget = isVisibleTile && dragOverSlot === slotIndex;
          return (
            <div
              key={session.id}
              className={
                isVisibleTile
                  ? `border-2 transition-colors ${
                      isDropTarget
                        ? "border-primary ring-2 ring-primary/40"
                        : isActive
                          ? "border-primary"
                          : "border-[var(--color-border)]"
                    }`
                  : ""
              }
              style={style}
              onDragOver={
                isVisibleTile
                  ? (e) => handleSlotDragOver(e, slotIndex)
                  : undefined
              }
              onDragLeave={
                isVisibleTile ? () => setDragOverSlot(null) : undefined
              }
              onDrop={
                isVisibleTile ? (e) => handleSlotDrop(e, slotIndex) : undefined
              }
              data-testid={isVisibleTile ? `tile-slot-${slotIndex}` : undefined}
              data-session-id={session.id}
              data-session-viewer-state={
                isViewerMounted ? "mounted" : "suspended"
              }
            >
              {isVisibleTile && (
                <TileHeader
                  session={session}
                  isActive={isActive}
                  slotIndex={slotIndex}
                  totalSlots={layout.sessions.length}
                  otherSessions={sessions.filter((s) => s.id !== session.id)}
                  onSelect={() => onSessionSelect(session.id)}
                  onDetach={() => onSessionDetach(session.id)}
                  onClose={() => onSessionClose(session.id)}
                  onShowInTile={(otherId) => {
                    mgr.swapSessionsInSlots(session.id, otherId);
                    onSessionSelect(otherId);
                  }}
                  onMaximize={() => {
                    onSessionSelect(session.id);
                    onLayoutChange({ mode: "tabs", sessions: [] });
                  }}
                />
              )}
              <div
                className={
                  isVisibleTile ? "absolute inset-0 top-[29px]" : "h-full"
                }
              >
                <SessionRenderActivityProvider isActive={isRendererActive}>
                  {isViewerMounted ? renderSession(session) : null}
                </SessionRenderActivityProvider>
              </div>
            </div>
          );
        })}

        {/* Mini mosaic preview grid (sessions are hidden, just show previews) */}
        {isMiniMosaic && (
          <div
            className="grid grid-cols-4 gap-2 h-full p-2"
            data-testid="mini-mosaic-grid"
          >
            {sessions.map((session) => (
              <button
                key={`preview-${session.id}`}
                type="button"
                className={`border-2 rounded cursor-pointer transition-all text-left overflow-hidden select-none ${
                  session.id === activeSessionId
                    ? "border-primary bg-primary/20"
                    : "border-[var(--color-border)] hover:border-primary/60"
                }`}
                onClick={() => {
                  onSessionSelect(session.id);
                  // Promote the click target to "tabs" mode so the
                  // user actually gets to interact with it.
                  onLayoutChange({ ...layout, mode: "tabs", sessions: [] });
                }}
              >
                <div className="bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] truncate">
                  {session.name}
                </div>
                <div className="h-full bg-[var(--color-background)] flex items-center justify-center">
                  <span className="text-[var(--color-textMuted)] text-xs">
                    {t("session.tabLayout.clickToFocus", "Click to focus")}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Empty-state guidance for tabs mode + 0 sessions handled by App.tsx welcome panel. */}
        {/* When tabs mode but multiple sessions, the single visible session fills the container. */}
        {isTabsMode && sessions.length === 0 && (
          <div className="h-full flex items-center justify-center text-[var(--color-textMuted)] text-sm select-none">
            {t("session.tabLayout.noSessionSelected", "No session selected")}
          </div>
        )}
      </div>
    </div>
  );
};

export default TabLayoutManager;
