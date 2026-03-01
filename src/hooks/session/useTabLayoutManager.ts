import { useState, useRef, useMemo, useCallback } from 'react';
import { ConnectionSession, TabLayout } from '../../types/connection';

const orderSessions = (sessions: ConnectionSession[], activeSessionId?: string) => {
  if (!activeSessionId) return sessions;
  const active = sessions.find((session) => session.id === activeSessionId);
  if (!active) return sessions;
  return [active, ...sessions.filter((session) => session.id !== activeSessionId)];
};

const buildGridLayout = (
  mode: TabLayout['mode'],
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
        position: { x: colIndex * width, y: rowIndex * height, width, height },
      };
    }),
  };
};

export function useTabLayoutManager(
  sessions: ConnectionSession[],
  activeSessionId: string | undefined,
  layout: TabLayout,
  onLayoutChange: (layout: TabLayout) => void,
  onSessionClose: (sessionId: string) => void,
  middleClickCloseTab: boolean,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const customGridButtonRef = useRef<HTMLDivElement>(null);
  const [showCustomGrid, setShowCustomGrid] = useState(false);
  const [customCols, setCustomCols] = useState(2);
  const [customRows, setCustomRows] = useState(2);

  const orderedSessions = useMemo(
    () => orderSessions(sessions, activeSessionId),
    [sessions, activeSessionId],
  );

  const handleMiddleClick = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      if (e.button === 1 && middleClickCloseTab) {
        e.preventDefault();
        e.stopPropagation();
        onSessionClose(sessionId);
      }
    },
    [middleClickCloseTab, onSessionClose],
  );

  const handleCustomGridApply = useCallback(() => {
    const maxSessions = customCols * customRows;
    const sessionsToUse = orderedSessions.slice(0, maxSessions);
    const customLayout = buildGridLayout(
      'customGrid' as TabLayout['mode'],
      sessionsToUse,
      customCols,
      customRows,
    );
    onLayoutChange({ ...customLayout, mode: 'mosaic' as TabLayout['mode'] });
    setShowCustomGrid(false);
  }, [customCols, customRows, orderedSessions, onLayoutChange]);

  const handleLayoutModeChange = useCallback(
    (mode: TabLayout['mode']) => {
      let updatedLayout: TabLayout;
      switch (mode) {
        case 'splitVertical': {
          const cols = 2;
          const rows = Math.ceil(orderedSessions.length / cols) || 1;
          updatedLayout = buildGridLayout(mode, orderedSessions, cols, rows);
          break;
        }
        case 'splitHorizontal': {
          const rows = 2;
          const cols = Math.ceil(orderedSessions.length / rows) || 1;
          updatedLayout = buildGridLayout(mode, orderedSessions, cols, rows);
          break;
        }
        case 'grid2':
          updatedLayout = buildGridLayout(mode, orderedSessions.slice(0, 2), 2, 1);
          break;
        case 'grid4':
          updatedLayout = buildGridLayout(mode, orderedSessions.slice(0, 4), 2, 2);
          break;
        case 'grid6':
          updatedLayout = buildGridLayout(mode, orderedSessions.slice(0, 6), 3, 2);
          break;
        case 'sideBySide':
          updatedLayout = buildGridLayout(mode, orderedSessions, 2);
          break;
        case 'mosaic': {
          const cols = Math.ceil(Math.sqrt(orderedSessions.length)) || 1;
          updatedLayout = buildGridLayout(mode, orderedSessions, cols);
          break;
        }
        case 'miniMosaic': {
          const cols = Math.ceil(Math.sqrt(orderedSessions.length)) || 1;
          updatedLayout = buildGridLayout(mode, orderedSessions, cols);
          break;
        }
        default:
          updatedLayout = buildGridLayout('tabs', orderedSessions, 1, 1);
          break;
      }
      onLayoutChange(updatedLayout);
    },
    [orderedSessions, onLayoutChange],
  );

  const handleSessionResize = useCallback(
    (sessionId: string, width: number, height: number) => {
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
    },
    [layout, onLayoutChange],
  );

  return {
    containerRef,
    customGridButtonRef,
    showCustomGrid,
    setShowCustomGrid,
    customCols,
    setCustomCols,
    customRows,
    setCustomRows,
    orderedSessions,
    handleMiddleClick,
    handleCustomGridApply,
    handleLayoutModeChange,
    handleSessionResize,
  };
}
