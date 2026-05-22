import { useState, useRef, useMemo, useCallback } from 'react';
import { ConnectionSession, TabLayout, TabLayoutMode } from '../../types/connection/connection';
import {
  buildTabLayout,
  clampGridDim,
  layoutCapacity,
  MAX_CUSTOM_GRID_DIM,
} from '../../utils/session/tabLayoutBuilder';

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
  const [customCols, setCustomColsRaw] = useState<number>(
    () => clampGridDim(layout.customCols ?? 2),
  );
  const [customRows, setCustomRowsRaw] = useState<number>(
    () => clampGridDim(layout.customRows ?? 2),
  );

  // Wrap the col/row setters so out-of-band values can never reach
  // the renderer (e.g. a stale slider event).
  const setCustomCols = useCallback(
    (n: number) => setCustomColsRaw(clampGridDim(n)),
    [],
  );
  const setCustomRows = useCallback(
    (n: number) => setCustomRowsRaw(clampGridDim(n)),
    [],
  );

  const orderedSessions = useMemo(() => {
    if (!activeSessionId) return sessions;
    const active = sessions.find((s) => s.id === activeSessionId);
    if (!active) return sessions;
    return [active, ...sessions.filter((s) => s.id !== activeSessionId)];
  }, [sessions, activeSessionId]);

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
    onLayoutChange(
      buildTabLayout('customGrid', orderedSessions, {
        activeSessionId,
        customCols,
        customRows,
      }),
    );
    setShowCustomGrid(false);
  }, [customCols, customRows, orderedSessions, activeSessionId, onLayoutChange]);

  const handleLayoutModeChange = useCallback(
    (mode: TabLayoutMode) => {
      onLayoutChange(
        buildTabLayout(mode, orderedSessions, {
          activeSessionId,
          customCols,
          customRows,
        }),
      );
    },
    [orderedSessions, activeSessionId, customCols, customRows, onLayoutChange],
  );

  /**
   * Swap two slots in the current layout. Used by tile drag-and-drop
   * and by the "Show in this tile" menu item. The mode stays the
   * same; only the slot-to-session mapping changes. If the target
   * session isn't currently in the layout (capped mode, overflow),
   * it replaces the session at the destination slot.
   */
  const swapSessionsInSlots = useCallback(
    (sourceSessionId: string, destSessionId: string) => {
      if (sourceSessionId === destSessionId) return;
      const srcIdx = layout.sessions.findIndex((s) => s.sessionId === sourceSessionId);
      const dstIdx = layout.sessions.findIndex((s) => s.sessionId === destSessionId);
      const nextSessions = [...layout.sessions];
      if (srcIdx >= 0 && dstIdx >= 0) {
        // Both in layout — swap their session ids, keep positions
        nextSessions[srcIdx] = { ...nextSessions[srcIdx], sessionId: destSessionId };
        nextSessions[dstIdx] = { ...nextSessions[dstIdx], sessionId: sourceSessionId };
      } else if (dstIdx >= 0) {
        // Source is hidden — promote it into the destination slot
        nextSessions[dstIdx] = { ...nextSessions[dstIdx], sessionId: sourceSessionId };
      } else if (srcIdx >= 0) {
        // Destination is hidden — promote it into the source slot
        nextSessions[srcIdx] = { ...nextSessions[srcIdx], sessionId: destSessionId };
      } else {
        return;
      }
      onLayoutChange({ ...layout, sessions: nextSessions });
    },
    [layout, onLayoutChange],
  );

  /**
   * Move a session into a specific slot index. Used by the tab
   * context menu's "Move to tile N" submenu. Slots out of range
   * are no-ops so the caller doesn't need to bounds-check.
   */
  const assignSessionToSlot = useCallback(
    (sessionId: string, slotIndex: number) => {
      if (slotIndex < 0 || slotIndex >= layout.sessions.length) return;
      const existingSlot = layout.sessions.findIndex((s) => s.sessionId === sessionId);
      const nextSessions = [...layout.sessions];
      const previousOccupant = nextSessions[slotIndex].sessionId;
      nextSessions[slotIndex] = { ...nextSessions[slotIndex], sessionId };
      if (existingSlot >= 0 && existingSlot !== slotIndex) {
        nextSessions[existingSlot] = { ...nextSessions[existingSlot], sessionId: previousOccupant };
      }
      onLayoutChange({ ...layout, sessions: nextSessions });
    },
    [layout, onLayoutChange],
  );

  /**
   * Sessions that are open but not assigned to a slot in the current
   * layout — only meaningful in capped modes (grid2/4/6, customGrid).
   * The TabLayoutManager toolbar shows a "+N hidden" pill so the user
   * can promote one of these into a slot.
   */
  const hiddenSessions = useMemo(() => {
    const visibleSet = new Set(layout.sessions.map((s) => s.sessionId));
    return sessions.filter((s) => !visibleSet.has(s.id));
  }, [layout.sessions, sessions]);

  const capacity = useMemo(
    () => layoutCapacity(layout, sessions.length),
    [layout, sessions.length],
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
    maxCustomGridDim: MAX_CUSTOM_GRID_DIM,
    orderedSessions,
    handleMiddleClick,
    handleCustomGridApply,
    handleLayoutModeChange,
    swapSessionsInSlots,
    assignSessionToSlot,
    hiddenSessions,
    capacity,
  };
}
