import React, { useMemo, useRef } from "react";
import { Columns, Grid3X3, LayoutGrid, Layers, Minimize2, Rows } from "lucide-react";
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const orderedSessions = useMemo(
    () => orderSessions(sessions, activeSessionId),
    [sessions, activeSessionId],
  );

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
      case "cascade2": {
        const tiles = orderedSessions.slice(0, 2);
        updatedLayout = {
          mode,
          sessions: tiles.map((session, index) => ({
            sessionId: session.id,
            position: {
              x: index * 12,
              y: index * 12,
              width: 75,
              height: 75,
            },
          })),
        };
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
    const active = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];

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
        <div className="flex-1 overflow-hidden">{active ? renderSession(active) : null}</div>
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
          <button
            onClick={() => handleLayoutModeChange("cascade2")}
            className={`p-2 rounded transition-colors ${
              layout.mode === "cascade2" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
            }`}
            title="2 cascade"
          >
            <Layers size={16} />
          </button>
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
          layout.mode === "grid6" ||
          layout.mode === "cascade2") && renderMosaicLayout()}
        {layout.mode === "miniMosaic" && renderMiniMosaicLayout()}
      </div>
    </div>
  );
};
