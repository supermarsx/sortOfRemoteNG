import React, { useMemo, useRef, useState } from "react";
import { Columns, Grid3X3, LayoutGrid, Minimize2, Rows, Settings2 } from "lucide-react";
import { ConnectionSession, TabLayout } from "../types/connection";
import { Resizable } from "react-resizable";

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

const orderSessions = (sessions: ConnectionSession[], activeSessionId?: string) => {
  if (!activeSessionId) return sessions;
  const active = sessions.find((session) => session.id === activeSessionId);
  if (!active) return sessions;
  return [active, ...sessions.filter((session) => session.id !== activeSessionId)];
};

const buildGridLayout = (
  mode: TabLayout["mode"],
  sessions: ConnectionSession[],
  cols: number,
  rows?: number,
) => {
  const totalRows = (rows ?? Math.ceil(sessions.length / cols)) || 1;
  const width = 100 / cols;
  const height = 100 / totalRows;

  return {
    mode,
    sessions: sessions.map((session, index) => {
      const colIndex = index % cols;
      const rowIndex = Math.floor(index / cols);
      return {
        sessionId: session.id,
        position: {
          x: colIndex * width,
          y: rowIndex * height,
          width,
          height,
        },
      };
    }),
  };
};

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [showCustomGrid, setShowCustomGrid] = useState(false);
  const [customCols, setCustomCols] = useState(2);
  const [customRows, setCustomRows] = useState(2);

  const handleMiddleClick = (sessionId: string, e: React.MouseEvent) => {
    if (e.button === 1 && middleClickCloseTab) {
      e.preventDefault();
      e.stopPropagation();
      onSessionClose(sessionId);
    }
  };

  const orderedSessions = useMemo(
    () => orderSessions(sessions, activeSessionId),
    [sessions, activeSessionId],
  );

  const handleCustomGridApply = () => {
    const maxSessions = customCols * customRows;
    const sessionsToUse = orderedSessions.slice(0, maxSessions);
    const customLayout = buildGridLayout("customGrid" as TabLayout["mode"], sessionsToUse, customCols, customRows);
    onLayoutChange({ ...customLayout, mode: "mosaic" as TabLayout["mode"] });
    setShowCustomGrid(false);
  };

  const handleLayoutModeChange = (mode: TabLayout["mode"]) => {
    let updatedLayout: TabLayout;

    switch (mode) {
      case "splitVertical": {
        const cols = 2;
        const rows = Math.ceil(orderedSessions.length / cols) || 1;
        updatedLayout = buildGridLayout(mode, orderedSessions, cols, rows);
        break;
      }
      case "splitHorizontal": {
        const rows = 2;
        const cols = Math.ceil(orderedSessions.length / rows) || 1;
        updatedLayout = buildGridLayout(mode, orderedSessions, cols, rows);
        break;
      }
      case "grid2": {
        updatedLayout = buildGridLayout(mode, orderedSessions.slice(0, 2), 2, 1);
        break;
      }
      case "grid4": {
        updatedLayout = buildGridLayout(mode, orderedSessions.slice(0, 4), 2, 2);
        break;
      }
      case "grid6": {
        updatedLayout = buildGridLayout(mode, orderedSessions.slice(0, 6), 3, 2);
        break;
      }
      case "sideBySide": {
        updatedLayout = buildGridLayout(mode, orderedSessions, 2);
        break;
      }
      case "mosaic": {
        const cols = Math.ceil(Math.sqrt(orderedSessions.length)) || 1;
        updatedLayout = buildGridLayout(mode, orderedSessions, cols);
        break;
      }
      case "miniMosaic": {
        const cols = Math.ceil(Math.sqrt(orderedSessions.length)) || 1;
        updatedLayout = buildGridLayout(mode, orderedSessions, cols);
        break;
      }
      default:
        updatedLayout = buildGridLayout("tabs", orderedSessions, 1, 1);
        break;
    }

    onLayoutChange(updatedLayout);
  };

  const handleSessionResize = (sessionId: string, width: number, height: number) => {
    const sessionLayout = layout.sessions.find((s) => s.sessionId === sessionId);
    if (!sessionLayout) return;

    const containerWidth = containerRef.current?.clientWidth || 1;
    const containerHeight = containerRef.current?.clientHeight || 1;

    const newLayout: TabLayout = {
      ...layout,
      sessions: layout.sessions.map((s) =>
        s.sessionId === sessionId
          ? {
              ...s,
              position: {
                ...s.position,
                width: (width / containerWidth) * 100,
                height: (height / containerHeight) * 100,
              },
            }
          : s,
      ),
    };

    onLayoutChange(newLayout);
  };

  const renderTabsLayout = () => {
    return (
      <div className="flex flex-col h-full">
        {showTabBar && (
          <div className="flex bg-gray-800 border-b border-gray-700 overflow-x-auto">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`flex items-center px-4 py-2 border-r border-gray-700 cursor-pointer min-w-0 ${
                  session.id === activeSessionId
                    ? "bg-gray-700 text-white"
                    : "text-gray-300 hover:bg-gray-700/50"
                }`}
                onClick={() => onSessionSelect(session.id)}
                onAuxClick={(e) => handleMiddleClick(session.id, e)}
              >
                <span className="truncate mr-2">{session.name}</span>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onSessionDetach(session.id);
                  }}
                  className="text-gray-400 hover:text-white mr-2"
                  title="Detach"
                >
                  ↗
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onSessionClose(session.id);
                  }}
                  className="text-gray-400 hover:text-white"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-hidden relative">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="absolute inset-0"
              style={{
                visibility: session.id === activeSessionId ? "visible" : "hidden",
                zIndex: session.id === activeSessionId ? 1 : 0,
              }}
            >
              {renderSession(session)}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMosaicLayout = () => (
    <div ref={containerRef} className="relative h-full">
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
            width={(sessionLayout.position.width / 100) * (containerRef.current?.clientWidth || 1)}
            height={(sessionLayout.position.height / 100) * (containerRef.current?.clientHeight || 1)}
            onResize={(event, { size }) => {
              handleSessionResize(session.id, size.width, size.height);
            }}
            minConstraints={[200, 150]}
          >
            <div
              style={style}
              className={`border-2 transition-all ${
                isActive ? "border-blue-500" : "border-gray-600"
              }`}
              onClick={() => onSessionSelect(session.id)}
            >
              <div className="bg-gray-800 border-b border-gray-700 px-2 py-1 flex items-center justify-between">
                <span className="text-white text-sm truncate">{session.name}</span>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onSessionDetach(session.id);
                    }}
                    className="text-gray-400 hover:text-white"
                    title="Detach"
                  >
                    ↗
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onSessionClose(session.id);
                    }}
                    className="text-gray-400 hover:text-white"
                  >
                    x
                  </button>
                </div>
              </div>
              <div className="h-full">{renderSession(session)}</div>
            </div>
          </Resizable>
        );
      })}
    </div>
  );

  const renderMiniMosaicLayout = () => (
    <div className="grid grid-cols-4 gap-2 h-full p-2">
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`border-2 rounded cursor-pointer transition-all ${
            session.id === activeSessionId
              ? "border-blue-500 bg-blue-900/20"
              : "border-gray-600 hover:border-gray-500"
          }`}
          onClick={() => onSessionSelect(session.id)}
        >
          <div className="bg-gray-800 px-2 py-1 text-xs text-white truncate">{session.name}</div>
          <div className="h-full bg-gray-900 flex items-center justify-center">
            <span className="text-gray-500 text-xs">Preview</span>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => handleLayoutModeChange("tabs")}
            className={`p-2 rounded transition-colors ${
              layout.mode === "tabs" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
            }`}
            title="Tabs"
          >
            <Minimize2 size={16} />
          </button>
          <button
            onClick={() => handleLayoutModeChange("splitVertical")}
            className={`p-2 rounded transition-colors ${
              layout.mode === "splitVertical"
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
            title="Split left/right"
          >
            <Columns size={16} />
          </button>
          <button
            onClick={() => handleLayoutModeChange("splitHorizontal")}
            className={`p-2 rounded transition-colors ${
              layout.mode === "splitHorizontal"
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
            title="Split top/bottom"
          >
            <Rows size={16} />
          </button>
          <button
            onClick={() => handleLayoutModeChange("grid2")}
            className={`p-2 rounded transition-colors ${
              layout.mode === "grid2" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
            }`}
            title="2 side by side"
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => handleLayoutModeChange("grid4")}
            className={`p-2 rounded transition-colors ${
              layout.mode === "grid4" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
            }`}
            title="4 squares"
          >
            <Grid3X3 size={16} />
          </button>
          <button
            onClick={() => handleLayoutModeChange("grid6")}
            className={`p-2 rounded transition-colors ${
              layout.mode === "grid6" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
            }`}
            title="6 squares"
          >
            <Grid3X3 size={16} />
          </button>
          
          {/* Custom Grid Button */}
          <div className="relative">
            <button
              onClick={() => setShowCustomGrid(!showCustomGrid)}
              className={`p-2 rounded transition-colors ${
                showCustomGrid ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
              }`}
              title="Custom grid layout"
            >
              <Settings2 size={16} />
            </button>
            
            {showCustomGrid && (
              <div className="absolute top-full left-0 mt-2 bg-gray-800 border border-gray-600 rounded-lg p-4 z-50 shadow-lg min-w-[200px]">
                <div className="text-white text-sm font-medium mb-3">Custom Grid Layout</div>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-gray-400 text-xs block mb-1">Columns</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="range"
                        min="1"
                        max="4"
                        value={customCols}
                        onChange={(e) => setCustomCols(parseInt(e.target.value))}
                        className="flex-1 accent-blue-500"
                      />
                      <span className="text-white text-sm w-6">{customCols}</span>
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-gray-400 text-xs block mb-1">Rows</label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="range"
                        min="1"
                        max="4"
                        value={customRows}
                        onChange={(e) => setCustomRows(parseInt(e.target.value))}
                        className="flex-1 accent-blue-500"
                      />
                      <span className="text-white text-sm w-6">{customRows}</span>
                    </div>
                  </div>
                  
                  {/* Grid Preview */}
                  <div className="border border-gray-600 rounded p-2">
                    <div 
                      className="grid gap-1"
                      style={{ 
                        gridTemplateColumns: `repeat(${customCols}, 1fr)`,
                        gridTemplateRows: `repeat(${customRows}, 1fr)`,
                      }}
                    >
                      {Array.from({ length: customCols * customRows }).map((_, i) => (
                        <div 
                          key={i} 
                          className={`h-4 rounded ${i < sessions.length ? 'bg-blue-500' : 'bg-gray-600'}`}
                        />
                      ))}
                    </div>
                    <div className="text-gray-500 text-xs mt-1 text-center">
                      {customCols * customRows} tiles ({Math.min(sessions.length, customCols * customRows)} sessions)
                    </div>
                  </div>
                  
                  <button
                    onClick={handleCustomGridApply}
                    className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors"
                  >
                    Apply Layout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="text-gray-400 text-sm">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {layout.mode === "tabs" && renderTabsLayout()}
        {(layout.mode === "sideBySide" ||
          layout.mode === "mosaic" ||
          layout.mode === "splitVertical" ||
          layout.mode === "splitHorizontal" ||
          layout.mode === "grid2" ||
          layout.mode === "grid4" ||
          layout.mode === "grid6") && renderMosaicLayout()}
        {layout.mode === "miniMosaic" && renderMiniMosaicLayout()}
      </div>
    </div>
  );
};
