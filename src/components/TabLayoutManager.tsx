import React from "react";
import {
  Columns,
  Grid3X3,
  LayoutGrid,
  Minimize2,
  Rows,
  Settings2,
} from "lucide-react";
import { ConnectionSession, TabLayout } from "../types/connection";
import { Resizable } from "react-resizable";
import { PopoverSurface } from "./ui/PopoverSurface";
import { useTabLayoutManager } from "../hooks/useTabLayoutManager";

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
        ? "bg-blue-600 text-[var(--color-text)]"
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
          ? "bg-blue-600 text-[var(--color-text)]"
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
            <input type="range" min="1" max="4" value={mgr.customCols} onChange={(e) => mgr.setCustomCols(parseInt(e.target.value))} className="sor-settings-range flex-1" />
            <span className="text-[var(--color-text)] text-sm w-6">{mgr.customCols}</span>
          </div>
        </div>
        <div>
          <label className="text-[var(--color-textSecondary)] text-xs block mb-1">Rows</label>
          <div className="flex items-center space-x-2">
            <input type="range" min="1" max="4" value={mgr.customRows} onChange={(e) => mgr.setCustomRows(parseInt(e.target.value))} className="sor-settings-range flex-1" />
            <span className="text-[var(--color-text)] text-sm w-6">{mgr.customRows}</span>
          </div>
        </div>
        <div className="border border-[var(--color-border)] rounded p-2">
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${mgr.customCols}, 1fr)`, gridTemplateRows: `repeat(${mgr.customRows}, 1fr)` }}>
            {Array.from({ length: mgr.customCols * mgr.customRows }).map((_, i) => (
              <div key={i} className={`h-4 rounded ${i < sessionCount ? "bg-blue-500" : "bg-gray-600"}`} />
            ))}
          </div>
          <div className="text-gray-500 text-xs mt-1 text-center">
            {mgr.customCols * mgr.customRows} tiles ({Math.min(sessionCount, mgr.customCols * mgr.customRows)} sessions)
          </div>
        </div>
        <button onClick={mgr.handleCustomGridApply} className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded text-sm transition-colors">Apply Layout</button>
      </div>
    </PopoverSurface>
  </div>
);

const TabsLayout: React.FC<{
  sessions: ConnectionSession[];
  activeSessionId?: string;
  showTabBar: boolean;
  mgr: Mgr;
  onSessionSelect: (id: string) => void;
  onSessionDetach: (id: string) => void;
  onSessionClose: (id: string) => void;
  renderSession: (session: ConnectionSession) => React.ReactNode;
}> = ({ sessions, activeSessionId, showTabBar, mgr, onSessionSelect, onSessionDetach, onSessionClose, renderSession }) => (
  <div className="flex flex-col h-full">
    {showTabBar && (
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
    <div className="flex-1 overflow-hidden relative">
      {sessions.map((session) => (
        <div key={session.id} className="absolute inset-0" style={{ visibility: session.id === activeSessionId ? "visible" : "hidden", zIndex: session.id === activeSessionId ? 1 : 0 }}>
          {renderSession(session)}
        </div>
      ))}
    </div>
  </div>
);

const MosaicLayout: React.FC<{
  sessions: ConnectionSession[];
  activeSessionId?: string;
  layout: TabLayout;
  mgr: Mgr;
  onSessionSelect: (id: string) => void;
  onSessionDetach: (id: string) => void;
  onSessionClose: (id: string) => void;
  renderSession: (session: ConnectionSession) => React.ReactNode;
}> = ({ sessions, activeSessionId, layout, mgr, onSessionSelect, onSessionDetach, onSessionClose, renderSession }) => (
  <div ref={mgr.containerRef} className="relative h-full">
    {layout.sessions.map((sessionLayout) => {
      const session = sessions.find((s) => s.id === sessionLayout.sessionId);
      if (!session) return null;
      const isActive = session.id === activeSessionId;
      const style = {
        position: "absolute" as const,
        left: `${sessionLayout.position.x}%`,
        top: `${sessionLayout.position.y}%`,
        width: `${sessionLayout.position.width}%`,
        height: `${sessionLayout.position.height}%`,
        zIndex: isActive ? 10 : 1,
      };
      return (
        <Resizable
          key={session.id}
          width={(sessionLayout.position.width / 100) * (mgr.containerRef.current?.clientWidth || 1)}
          height={(sessionLayout.position.height / 100) * (mgr.containerRef.current?.clientHeight || 1)}
          onResize={(_event, { size }) => { mgr.handleSessionResize(session.id, size.width, size.height); }}
          minConstraints={[200, 150]}
        >
          <div style={style} className={`border-2 transition-all ${isActive ? "border-blue-500" : "border-[var(--color-border)]"}`} onClick={() => onSessionSelect(session.id)}>
            <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-2 py-1 flex items-center justify-between">
              <span className="text-[var(--color-text)] text-sm truncate">{session.name}</span>
              <div className="flex items-center space-x-1">
                <button onClick={(ev) => { ev.stopPropagation(); onSessionDetach(session.id); }} className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]" title="Detach">↗</button>
                <button onClick={(ev) => { ev.stopPropagation(); onSessionClose(session.id); }} className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">x</button>
              </div>
            </div>
            <div className="h-full">{renderSession(session)}</div>
          </div>
        </Resizable>
      );
    })}
  </div>
);

const MiniMosaicLayout: React.FC<{
  sessions: ConnectionSession[];
  activeSessionId?: string;
  onSessionSelect: (id: string) => void;
}> = ({ sessions, activeSessionId, onSessionSelect }) => (
  <div className="grid grid-cols-4 gap-2 h-full p-2">
    {sessions.map((session) => (
      <div
        key={session.id}
        className={`border-2 rounded cursor-pointer transition-all ${
          session.id === activeSessionId ? "border-blue-500 bg-blue-900/20" : "border-[var(--color-border)] hover:border-[var(--color-border)]"
        }`}
        onClick={() => onSessionSelect(session.id)}
      >
        <div className="bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] truncate">{session.name}</div>
        <div className="h-full bg-[var(--color-background)] flex items-center justify-center">
          <span className="text-gray-500 text-xs">Preview</span>
        </div>
      </div>
    ))}
  </div>
);

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

  const isMosaicMode = layout.mode === "sideBySide" || layout.mode === "mosaic" || layout.mode === "splitVertical" || layout.mode === "splitHorizontal" || layout.mode === "grid2" || layout.mode === "grid4" || layout.mode === "grid6";

  return (
    <div className="flex flex-col h-full">
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-2 flex items-center justify-between">
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

      <div className="flex-1 overflow-hidden">
        {layout.mode === "tabs" && (
          <TabsLayout sessions={sessions} activeSessionId={activeSessionId} showTabBar={showTabBar} mgr={mgr} onSessionSelect={onSessionSelect} onSessionDetach={onSessionDetach} onSessionClose={onSessionClose} renderSession={renderSession} />
        )}
        {isMosaicMode && (
          <MosaicLayout sessions={sessions} activeSessionId={activeSessionId} layout={layout} mgr={mgr} onSessionSelect={onSessionSelect} onSessionDetach={onSessionDetach} onSessionClose={onSessionClose} renderSession={renderSession} />
        )}
        {layout.mode === "miniMosaic" && (
          <MiniMosaicLayout sessions={sessions} activeSessionId={activeSessionId} onSessionSelect={onSessionSelect} />
        )}
      </div>
    </div>
  );
};
