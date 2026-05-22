import React, { useCallback, useMemo, useState } from "react";
import {
  Columns,
  ExternalLink,
  Grid3X3,
  LayoutGrid,
  Minimize2,
  MoreVertical,
  Rows,
  Settings2,
  Square,
  SquareStack,
  X,
} from "lucide-react";
import { ConnectionSession, TabLayout, TabLayoutMode } from "../../types/connection/connection";
import { PopoverSurface } from "../ui/overlays/PopoverSurface";
import { useTabLayoutManager } from "../../hooks/session/useTabLayoutManager";
import { Slider } from '../ui/forms';
import MenuSurface from "../ui/overlays/MenuSurface";
import { isMosaicMode } from "../../utils/session/tabLayoutBuilder";

type Mgr = ReturnType<typeof useTabLayoutManager>;

/* ── DnD payload key ────────────────────────────────────
 * Shared with SessionTabs so dragging a tab into a tile works
 * across the two components.
 */
export const SESSION_TAB_DND_TYPE = "application/x-session-tab";

/* ── Sub-components ──────────────────────────────────── */

const LayoutModeButton: React.FC<{
  mode: TabLayoutMode;
  currentMode: TabLayoutMode;
  title: string;
  icon: React.ReactNode;
  onClick: (mode: TabLayoutMode) => void;
  testId?: string;
}> = ({ mode, currentMode, title, icon, onClick, testId }) => (
  <button
    onClick={() => onClick(mode)}
    data-testid={testId}
    aria-pressed={currentMode === mode}
    className={`p-2 rounded transition-colors ${
      currentMode === mode
        ? "bg-primary text-[var(--color-text)]"
        : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
    }`}
    title={title}
  >
    {icon}
  </button>
);

const CustomGridPopover: React.FC<{ mgr: Mgr; sessionCount: number }> = ({ mgr, sessionCount }) => (
  <div className="relative" ref={mgr.customGridButtonRef}>
    <button
      onClick={() => mgr.setShowCustomGrid(!mgr.showCustomGrid)}
      className={`p-2 rounded transition-colors ${
        mgr.showCustomGrid
          ? "bg-primary text-[var(--color-text)]"
          : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
      }`}
      title="Custom grid layout"
    >
      <Settings2 size={16} />
    </button>

    <PopoverSurface
      isOpen={mgr.showCustomGrid}
      onClose={() => mgr.setShowCustomGrid(false)}
      anchorRef={mgr.customGridButtonRef}
      align="start"
      className="sor-popover-panel p-4 min-w-[200px]"
      dataTestId="tab-layout-custom-grid-popover"
    >
      <div className="text-[var(--color-text)] text-sm font-medium mb-3">Custom Grid Layout</div>
      <div className="space-y-3">
        <div>
          <label className="text-[var(--color-textSecondary)] text-xs block mb-1">Columns</label>
          <div className="flex items-center space-x-2">
            <Slider value={mgr.customCols} onChange={(v: number) => mgr.setCustomCols(v)} min={1} max={mgr.maxCustomGridDim} className="flex-1" />
            <span className="text-[var(--color-text)] text-sm w-6">{mgr.customCols}</span>
          </div>
        </div>
        <div>
          <label className="text-[var(--color-textSecondary)] text-xs block mb-1">Rows</label>
          <div className="flex items-center space-x-2">
            <Slider value={mgr.customRows} onChange={(v: number) => mgr.setCustomRows(v)} min={1} max={mgr.maxCustomGridDim} className="flex-1" />
            <span className="text-[var(--color-text)] text-sm w-6">{mgr.customRows}</span>
          </div>
        </div>
        <div className="border border-[var(--color-border)] rounded p-2">
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${mgr.customCols}, 1fr)`, gridTemplateRows: `repeat(${mgr.customRows}, 1fr)` }}>
            {Array.from({ length: mgr.customCols * mgr.customRows }).map((_, i) => (
              <div key={i} className={`h-4 rounded ${i < sessionCount ? "bg-primary" : "bg-[var(--color-surfaceHover)]"}`} />
            ))}
          </div>
          <div className="text-[var(--color-textMuted)] text-xs mt-1 text-center">
            {mgr.customCols * mgr.customRows} tiles ({Math.min(sessionCount, mgr.customCols * mgr.customRows)} sessions)
          </div>
        </div>
        <button onClick={mgr.handleCustomGridApply} className="w-full px-3 py-2 bg-primary hover:bg-primary/90 text-[var(--color-text)] rounded text-sm transition-colors">Apply Layout</button>
      </div>
    </PopoverSurface>
  </div>
);

/* ── Hidden sessions pill ─────────────────────────────
 * In capped modes (grid2/4/6, customGrid), sessions past the
 * capacity are open but not rendered. We surface them here so
 * the user can promote one into a slot and see they exist.
 */
const HiddenSessionsMenu: React.FC<{
  hiddenSessions: ConnectionSession[];
  onPromote: (sessionId: string) => void;
}> = ({ hiddenSessions, onPromote }) => {
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  if (hiddenSessions.length === 0) return null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        data-testid="tab-layout-hidden-pill"
        className="text-warning text-xs px-2 py-1 rounded border border-warning/40 hover:bg-warning/10 transition-colors"
        title={`${hiddenSessions.length} session(s) not visible in the current tiling — click to promote one into a tile`}
      >
        +{hiddenSessions.length} hidden
      </button>
      <PopoverSurface
        isOpen={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        align="end"
        className="sor-popover-panel min-w-[220px] max-h-[280px] overflow-y-auto"
      >
        <div className="px-3 py-1.5 text-[10px] text-[var(--color-textMuted)] border-b border-[var(--color-border)]">
          Hidden sessions — click to promote
        </div>
        {hiddenSessions.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              onPromote(s.id);
              setOpen(false);
            }}
            className="sor-menu-item w-full text-left"
          >
            <span className="truncate">{s.name}</span>
          </button>
        ))}
      </PopoverSurface>
    </div>
  );
};

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
}) => {
  const [menuOpen, setMenuOpen] = useState<{ x: number; y: number } | null>(null);
  const [showSubmenu, setShowSubmenu] = useState(false);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuOpen({ x: rect.left, y: rect.bottom });
  };

  return (
    <>
      <div
        className={`absolute top-0 left-0 right-0 z-10 bg-[var(--color-surface)] border-b px-2 py-1 flex items-center justify-between cursor-pointer ${
          isActive ? "border-primary" : "border-[var(--color-border)]"
        }`}
        onClick={onSelect}
        data-testid={`tile-header-${slotIndex}`}
      >
        <div className="flex items-center min-w-0 gap-1.5">
          <span className="text-[10px] text-[var(--color-textMuted)] shrink-0">
            {slotIndex + 1}/{totalSlots}
          </span>
          <span className="text-[var(--color-text)] text-sm truncate">{session.name}</span>
        </div>
        <div className="flex items-center space-x-0.5">
          <button
            onClick={openMenu}
            className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)] p-0.5 rounded hover:bg-[var(--color-border)]"
            title="Tile menu"
            aria-label="Tile menu"
            data-testid={`tile-menu-trigger-${slotIndex}`}
          >
            <MoreVertical size={12} />
          </button>
          <button
            onClick={(ev) => { ev.stopPropagation(); onDetach(); }}
            className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)] p-0.5 rounded hover:bg-[var(--color-border)]"
            title="Detach"
            aria-label="Detach"
          >
            <ExternalLink size={12} />
          </button>
          <button
            onClick={(ev) => { ev.stopPropagation(); onClose(); }}
            className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)] p-0.5 rounded hover:bg-[var(--color-border)]"
            title="Close"
            aria-label="Close"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <MenuSurface
        isOpen={menuOpen !== null}
        onClose={() => { setMenuOpen(null); setShowSubmenu(false); }}
        position={menuOpen}
        className="min-w-[200px]"
        dataTestId={`tile-menu-${slotIndex}`}
        ariaLabel="Tile actions"
      >
        <div className="px-3 py-1.5 text-[10px] text-[var(--color-textMuted)] border-b border-[var(--color-border)]">
          Tile {slotIndex + 1} of {totalSlots}
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
            <span className="flex-1">Show in this tile…</span>
          </button>
          <div
            className="sor-menu-submenu-panel"
            role="menu"
            tabIndex={-1}
            aria-label="Show session in this tile"
          >
            {otherSessions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--color-textMuted)]">
                No other sessions
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
        <div className="sor-menu-divider" />
        <button onClick={() => { onDetach(); setMenuOpen(null); }} className="sor-menu-item">
          <ExternalLink size={14} className="mr-2" /> Detach to new window
        </button>
        <button onClick={() => { onClose(); setMenuOpen(null); }} className="sor-menu-item sor-menu-item-danger">
          <X size={14} className="mr-2" /> Close session
        </button>
      </MenuSurface>
    </>
  );
};

/* ── Compute per-session CSS from layout ──────────────── */

interface SessionStyle {
  position: 'absolute';
  left: string;
  top: string;
  width: string;
  height: string;
  visibility: 'visible' | 'hidden';
  zIndex: number;
}

function computeSessionStyles(
  sessions: ConnectionSession[],
  layout: TabLayout,
  activeSessionId?: string,
): Map<string, SessionStyle> {
  const styles = new Map<string, SessionStyle>();
  const isTabsMode = layout.mode === 'tabs';
  const isMiniMosaic = layout.mode === 'miniMosaic';

  if (isTabsMode) {
    for (const session of sessions) {
      const isActive = session.id === activeSessionId;
      styles.set(session.id, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        visibility: isActive ? 'visible' : 'hidden',
        zIndex: isActive ? 1 : 0,
      });
    }
  } else if (isMiniMosaic) {
    for (const session of sessions) {
      styles.set(session.id, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '0',
        height: '0',
        visibility: 'hidden',
        zIndex: 0,
      });
    }
  } else {
    const layoutMap = new Map(layout.sessions.map((s) => [s.sessionId, s.position]));
    for (const session of sessions) {
      const pos = layoutMap.get(session.id);
      const isActive = session.id === activeSessionId;
      if (pos) {
        styles.set(session.id, {
          position: 'absolute',
          left: `${pos.x}%`,
          top: `${pos.y}%`,
          width: `${pos.width}%`,
          height: `${pos.height}%`,
          visibility: 'visible',
          zIndex: isActive ? 10 : 1,
        });
      } else {
        styles.set(session.id, {
          position: 'absolute',
          left: '0',
          top: '0',
          width: '0',
          height: '0',
          visibility: 'hidden',
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
}) => {
  const mgr = useTabLayoutManager(sessions, activeSessionId, layout, onLayoutChange, onSessionClose, middleClickCloseTab);

  const isTabsMode = layout.mode === "tabs";
  const isMiniMosaic = layout.mode === "miniMosaic";
  const mosaicMode = isMosaicMode(layout.mode);

  const sessionStyles = useMemo(
    () => computeSessionStyles(sessions, layout, activeSessionId),
    [sessions, layout, activeSessionId],
  );

  /**
   * Resolve a session id → record. Used by the tile header to
   * render the "Show in this tile" submenu (list of all other
   * sessions, including hidden ones).
   */
  const sessionsById = useMemo(
    () => new Map(sessions.map((s) => [s.id, s])),
    [sessions],
  );

  const sessionCountForCounter = useMemo(
    () => sessions.filter((s) => !s.protocol.startsWith("tool:") && !s.protocol.startsWith("winmgmt:")).length,
    [sessions],
  );

  /** Promote a hidden session into the active tile slot. */
  const promoteHidden = useCallback(
    (sessionId: string) => {
      // Find the active slot, fall back to the first slot.
      const activeSlot = layout.sessions.findIndex((s) => s.sessionId === activeSessionId);
      const targetSlot = activeSlot >= 0 ? activeSlot : 0;
      mgr.assignSessionToSlot(sessionId, targetSlot);
      onSessionSelect(sessionId);
    },
    [layout.sessions, activeSessionId, mgr, onSessionSelect],
  );

  /* ── Drag-and-drop drop zones ──────────────────────
   * In mosaic modes, dragging a tab from SessionTabs over a tile
   * shows a drop indicator; releasing assigns that session to the
   * tile (swapping with whatever was there).
   */
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);

  const handleSlotDragOver = useCallback((e: React.DragEvent, slotIndex: number) => {
    if (!mosaicMode) return;
    if (!e.dataTransfer.types.includes(SESSION_TAB_DND_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverSlot(slotIndex);
  }, [mosaicMode]);

  const handleSlotDrop = useCallback((e: React.DragEvent, slotIndex: number) => {
    if (!mosaicMode) return;
    const sessionId = e.dataTransfer.getData(SESSION_TAB_DND_TYPE);
    if (!sessionId) return;
    e.preventDefault();
    setDragOverSlot(null);
    mgr.assignSessionToSlot(sessionId, slotIndex);
    onSessionSelect(sessionId);
  }, [mosaicMode, mgr, onSessionSelect]);

  return (
    <div className="flex flex-col h-full">
      {/* ── Layout toolbar ───────────────────────────── */}
      <div className="sor-toolbar-row" data-testid="tab-layout-toolbar">
        <div className="flex items-center space-x-2">
          <LayoutModeButton mode="tabs" currentMode={layout.mode} title="Tabs (single pane)" icon={<Minimize2 size={16} />} onClick={mgr.handleLayoutModeChange} testId="layout-mode-tabs" />
          <LayoutModeButton mode="splitVertical" currentMode={layout.mode} title="Split left/right" icon={<Columns size={16} />} onClick={mgr.handleLayoutModeChange} testId="layout-mode-splitVertical" />
          <LayoutModeButton mode="splitHorizontal" currentMode={layout.mode} title="Split top/bottom" icon={<Rows size={16} />} onClick={mgr.handleLayoutModeChange} testId="layout-mode-splitHorizontal" />
          <LayoutModeButton mode="sideBySide" currentMode={layout.mode} title="Side-by-side (2 cols, fill rows)" icon={<SquareStack size={16} />} onClick={mgr.handleLayoutModeChange} testId="layout-mode-sideBySide" />
          <LayoutModeButton mode="grid2" currentMode={layout.mode} title="2 side by side (capped)" icon={<LayoutGrid size={16} />} onClick={mgr.handleLayoutModeChange} testId="layout-mode-grid2" />
          <LayoutModeButton mode="grid4" currentMode={layout.mode} title="4 squares (capped)" icon={<Grid3X3 size={16} />} onClick={mgr.handleLayoutModeChange} testId="layout-mode-grid4" />
          <LayoutModeButton mode="grid6" currentMode={layout.mode} title="6 squares (capped)" icon={<Grid3X3 size={16} />} onClick={mgr.handleLayoutModeChange} testId="layout-mode-grid6" />
          <LayoutModeButton mode="mosaic" currentMode={layout.mode} title="Auto mosaic (sqrt grid)" icon={<Square size={16} />} onClick={mgr.handleLayoutModeChange} testId="layout-mode-mosaic" />
          <LayoutModeButton mode="miniMosaic" currentMode={layout.mode} title="Mini mosaic (preview grid)" icon={<Grid3X3 size={14} />} onClick={mgr.handleLayoutModeChange} testId="layout-mode-miniMosaic" />
          <CustomGridPopover mgr={mgr} sessionCount={sessions.length} />
        </div>
        <div className="flex items-center gap-3">
          <HiddenSessionsMenu hiddenSessions={mgr.hiddenSessions} onPromote={promoteHidden} />
          <div className="text-[var(--color-textSecondary)] text-sm">
            {sessionCountForCounter} session{sessionCountForCounter !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* ── Stable session container ─────────────────── */}
      {/*
        ALL sessions are always rendered here. Layout mode only
        changes the CSS positioning. Sessions never unmount on
        layout changes — this preserves RDP/SSH connections.
      */}
      <div ref={mgr.containerRef} className="flex-1 overflow-hidden relative">
        {sessions.map((session) => {
          const style = sessionStyles.get(session.id);
          if (!style) return null;
          const isActive = session.id === activeSessionId;
          const slotIndex = layout.sessions.findIndex((s) => s.sessionId === session.id);
          const isVisibleTile = mosaicMode && style.visibility === 'visible' && slotIndex >= 0;
          const isDropTarget = isVisibleTile && dragOverSlot === slotIndex;
          return (
            <div
              key={session.id}
              className={isVisibleTile
                ? `border-2 transition-colors ${
                    isDropTarget
                      ? "border-primary ring-2 ring-primary/40"
                      : isActive ? "border-primary" : "border-[var(--color-border)]"
                  }`
                : ''}
              style={style}
              onDragOver={isVisibleTile ? (e) => handleSlotDragOver(e, slotIndex) : undefined}
              onDragLeave={isVisibleTile ? () => setDragOverSlot(null) : undefined}
              onDrop={isVisibleTile ? (e) => handleSlotDrop(e, slotIndex) : undefined}
              data-testid={isVisibleTile ? `tile-slot-${slotIndex}` : undefined}
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
                />
              )}
              <div className={isVisibleTile ? "absolute inset-0 top-[29px]" : "h-full"}>
                {renderSession(session)}
              </div>
            </div>
          );
        })}

        {/* Mini mosaic preview grid (sessions are hidden, just show previews) */}
        {isMiniMosaic && (
          <div className="grid grid-cols-4 gap-2 h-full p-2" data-testid="mini-mosaic-grid">
            {sessions.map((session) => (
              <button
                key={`preview-${session.id}`}
                type="button"
                className={`border-2 rounded cursor-pointer transition-all text-left overflow-hidden ${
                  session.id === activeSessionId ? "border-primary bg-primary/20" : "border-[var(--color-border)] hover:border-primary/60"
                }`}
                onClick={() => {
                  onSessionSelect(session.id);
                  // Promote the click target to "tabs" mode so the
                  // user actually gets to interact with it.
                  onLayoutChange({ ...layout, mode: 'tabs', sessions: [] });
                }}
              >
                <div className="bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] truncate">{session.name}</div>
                <div className="h-full bg-[var(--color-background)] flex items-center justify-center">
                  <span className="text-[var(--color-textMuted)] text-xs">Click to focus</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Empty-state guidance for tabs mode + 0 sessions handled by App.tsx welcome panel. */}
        {/* When tabs mode but multiple sessions, the single visible session fills the container. */}
        {isTabsMode && sessions.length === 0 && (
          <div className="h-full flex items-center justify-center text-[var(--color-textMuted)] text-sm">
            No active sessions
          </div>
        )}
      </div>
    </div>
  );
};

export default TabLayoutManager;
