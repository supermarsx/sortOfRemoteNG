import React, { useMemo } from "react";
import {
  Columns,
  Grid3X3,
  LayoutGrid,
  Minimize2,
  Rows,
  Settings2,
} from "lucide-react";
import { ConnectionSession, TabLayout } from "../../types/connection/connection";
import { PopoverSurface } from "../ui/overlays/PopoverSurface";
import { useTabLayoutManager } from "../../hooks/session/useTabLayoutManager";
import { Slider } from '../ui/forms';

type Mgr = ReturnType<typeof useTabLayoutManager>;

/* ── Sub-components ──────────────────────────────────── */

const LayoutModeButton: React.FC<{
  mode: TabLayout["mode"];
  currentMode: TabLayout["mode"];
  title: string;
  icon: React.ReactNode;
  onClick: (mode: TabLayout["mode"]) => void;
}> = ({ mode, currentMode, title, icon, onClick }) => (
  <button
    onClick={() => onClick(mode)}
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
            <Slider value={mgr.customCols} onChange={(v: number) => mgr.setCustomCols(v)} min={1} max={4} className="flex-1" />
            <span className="text-[var(--color-text)] text-sm w-6">{mgr.customCols}</span>
          </div>
        </div>
        <div>
          <label className="text-[var(--color-textSecondary)] text-xs block mb-1">Rows</label>
          <div className="flex items-center space-x-2">
            <Slider value={mgr.customRows} onChange={(v: number) => mgr.setCustomRows(v)} min={1} max={4} className="flex-1" />
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

/* ── Tile header overlay for mosaic modes ─────────────── */

const TileHeader: React.FC<{
  session: ConnectionSession;
  isActive: boolean;
  onSelect: () => void;
  onDetach: () => void;
  onClose: () => void;
}> = ({ session, isActive, onSelect, onDetach, onClose }) => (
  <div
    className={`absolute top-0 left-0 right-0 z-10 bg-[var(--color-surface)] border-b px-2 py-1 flex items-center justify-between cursor-pointer ${
      isActive ? "border-primary" : "border-[var(--color-border)]"
    }`}
    onClick={onSelect}
  >
    <span className="text-[var(--color-text)] text-sm truncate">{session.name}</span>
    <div className="flex items-center space-x-1">
      <button onClick={(ev) => { ev.stopPropagation(); onDetach(); }} className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]" title="Detach">↗</button>
      <button onClick={(ev) => { ev.stopPropagation(); onClose(); }} className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">x</button>
    </div>
  </div>
);

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
    // Tabs: all sessions fill the container, only active is visible
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
    // Mini mosaic: hide all real sessions (preview grid is separate)
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
    // Mosaic / grid / split modes: position from layout.sessions
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
        // Session not in layout — hide but keep mounted
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
  showTabBar?: boolean;
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
  showTabBar = true,
  middleClickCloseTab = true,
}) => {
  const mgr = useTabLayoutManager(sessions, activeSessionId, layout, onLayoutChange, onSessionClose, middleClickCloseTab);

  const isTabsMode = layout.mode === "tabs";
  const isMiniMosaic = layout.mode === "miniMosaic";
  const isMosaicMode = !isTabsMode && !isMiniMosaic;

  const sessionStyles = useMemo(
    () => computeSessionStyles(sessions, layout, activeSessionId),
    [sessions, layout, activeSessionId],
  );

  return (
    <div className="flex flex-col h-full">
      {/* ── Layout toolbar ───────────────────────────── */}
      <div className="sor-toolbar-row">
        <div className="flex items-center space-x-2">
          <LayoutModeButton mode="tabs" currentMode={layout.mode} title="Tabs" icon={<Minimize2 size={16} />} onClick={mgr.handleLayoutModeChange} />
          <LayoutModeButton mode="splitVertical" currentMode={layout.mode} title="Split left/right" icon={<Columns size={16} />} onClick={mgr.handleLayoutModeChange} />
          <LayoutModeButton mode="splitHorizontal" currentMode={layout.mode} title="Split top/bottom" icon={<Rows size={16} />} onClick={mgr.handleLayoutModeChange} />
          <LayoutModeButton mode="grid2" currentMode={layout.mode} title="2 side by side" icon={<LayoutGrid size={16} />} onClick={mgr.handleLayoutModeChange} />
          <LayoutModeButton mode="grid4" currentMode={layout.mode} title="4 squares" icon={<Grid3X3 size={16} />} onClick={mgr.handleLayoutModeChange} />
          <LayoutModeButton mode="grid6" currentMode={layout.mode} title="6 squares" icon={<Grid3X3 size={16} />} onClick={mgr.handleLayoutModeChange} />
          <CustomGridPopover mgr={mgr} sessionCount={sessions.length} />
        </div>
        <div className="text-[var(--color-textSecondary)] text-sm">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* ── Tab bar (tabs mode only) ─────────────────── */}
      {isTabsMode && showTabBar && (
        <div className="flex bg-[var(--color-surface)] border-b border-[var(--color-border)] overflow-x-auto">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`flex items-center px-4 py-2 border-r border-[var(--color-border)] cursor-pointer min-w-0 ${
                session.id === activeSessionId
                  ? "bg-[var(--color-border)] text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-border)]/50"
              }`}
              onClick={() => onSessionSelect(session.id)}
              onAuxClick={(e) => mgr.handleMiddleClick(session.id, e)}
            >
              <span className="truncate mr-2">{session.name}</span>
              <button onClick={(ev) => { ev.stopPropagation(); onSessionDetach(session.id); }} className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)] mr-2" title="Detach">↗</button>
              <button onClick={(ev) => { ev.stopPropagation(); onSessionClose(session.id); }} className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">x</button>
            </div>
          ))}
        </div>
      )}

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
          return (
            <div
              key={session.id}
              className={isMosaicMode && style.visibility === 'visible' ? `border-2 transition-colors ${isActive ? "border-primary" : "border-[var(--color-border)]"}` : ''}
              style={style}
            >
              {/* Tile header for mosaic modes */}
              {isMosaicMode && style.visibility === 'visible' && (
                <TileHeader
                  session={session}
                  isActive={isActive}
                  onSelect={() => onSessionSelect(session.id)}
                  onDetach={() => onSessionDetach(session.id)}
                  onClose={() => onSessionClose(session.id)}
                />
              )}
              {/* Session content — stable, never remounts */}
              <div className={isMosaicMode && style.visibility === 'visible' ? "absolute inset-0 top-[29px]" : "h-full"}>
                {renderSession(session)}
              </div>
            </div>
          );
        })}

        {/* Mini mosaic preview grid (sessions are hidden, just show previews) */}
        {isMiniMosaic && (
          <div className="grid grid-cols-4 gap-2 h-full p-2">
            {sessions.map((session) => (
              <div
                key={`preview-${session.id}`}
                className={`border-2 rounded cursor-pointer transition-all ${
                  session.id === activeSessionId ? "border-primary bg-primary/20" : "border-[var(--color-border)] hover:border-[var(--color-border)]"
                }`}
                onClick={() => onSessionSelect(session.id)}
              >
                <div className="bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] truncate">{session.name}</div>
                <div className="h-full bg-[var(--color-background)] flex items-center justify-center">
                  <span className="text-[var(--color-textMuted)] text-xs">Preview</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
