import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTabLayoutManager } from '../../src/hooks/session/useTabLayoutManager';
import type { ConnectionSession, TabLayout } from '../../src/types/connection/connection';

// ── Helpers ───────────────────────────────────────────────────

function makeSession(id: string): ConnectionSession {
  return {
    id,
    connectionId: `conn-${id}`,
    name: `Session ${id}`,
    status: 'connected',
    startTime: new Date(),
    protocol: 'ssh',
    hostname: `host-${id}`,
  };
}

function defaultLayout(): TabLayout {
  return {
    mode: 'tabs',
    sessions: [],
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('useTabLayoutManager', () => {
  let onLayoutChange: ReturnType<typeof vi.fn<(layout: TabLayout) => void>>;
  let onSessionClose: ReturnType<typeof vi.fn<(sessionId: string) => void>>;

  beforeEach(() => {
    onLayoutChange = vi.fn<(layout: TabLayout) => void>();
    onSessionClose = vi.fn<(sessionId: string) => void>();
  });

  // ── orderedSessions ────────────────────────────────────────

  describe('orderedSessions', () => {
    it('puts active session first', () => {
      const sessions = [makeSession('a'), makeSession('b'), makeSession('c')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'b', defaultLayout(), onLayoutChange, onSessionClose, false),
      );
      expect(result.current.orderedSessions[0].id).toBe('b');
      expect(result.current.orderedSessions).toHaveLength(3);
    });

    it('returns original order when no activeSessionId', () => {
      const sessions = [makeSession('a'), makeSession('b')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, undefined, defaultLayout(), onLayoutChange, onSessionClose, false),
      );
      expect(result.current.orderedSessions[0].id).toBe('a');
    });

    it('returns original order when activeSessionId not found', () => {
      const sessions = [makeSession('a'), makeSession('b')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'nonexistent', defaultLayout(), onLayoutChange, onSessionClose, false),
      );
      expect(result.current.orderedSessions[0].id).toBe('a');
    });

    it('handles single session', () => {
      const sessions = [makeSession('only')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'only', defaultLayout(), onLayoutChange, onSessionClose, false),
      );
      expect(result.current.orderedSessions).toHaveLength(1);
      expect(result.current.orderedSessions[0].id).toBe('only');
    });
  });

  // ── handleMiddleClick ──────────────────────────────────────

  describe('handleMiddleClick', () => {
    it('calls onSessionClose on middle click when middleClickCloseTab is true', () => {
      const sessions = [makeSession('a')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'a', defaultLayout(), onLayoutChange, onSessionClose, true),
      );

      const event = { button: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent;

      act(() => {
        result.current.handleMiddleClick('a', event);
      });

      expect(onSessionClose).toHaveBeenCalledWith('a');
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('ignores non-middle button clicks', () => {
      const sessions = [makeSession('a')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'a', defaultLayout(), onLayoutChange, onSessionClose, true),
      );

      const event = { button: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent;

      act(() => {
        result.current.handleMiddleClick('a', event);
      });

      expect(onSessionClose).not.toHaveBeenCalled();
    });

    it('ignores middle click when middleClickCloseTab is false', () => {
      const sessions = [makeSession('a')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'a', defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      const event = { button: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent;

      act(() => {
        result.current.handleMiddleClick('a', event);
      });

      expect(onSessionClose).not.toHaveBeenCalled();
    });

    it('ignores right click even with middleClickCloseTab', () => {
      const sessions = [makeSession('a')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'a', defaultLayout(), onLayoutChange, onSessionClose, true),
      );

      const event = { button: 2, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent;

      act(() => {
        result.current.handleMiddleClick('a', event);
      });

      expect(onSessionClose).not.toHaveBeenCalled();
    });
  });

  // ── handleLayoutModeChange ─────────────────────────────────

  describe('handleLayoutModeChange', () => {
    it('creates tabs layout (default)', () => {
      const sessions = [makeSession('a'), makeSession('b')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'a', defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      act(() => {
        result.current.handleLayoutModeChange('tabs');
      });

      expect(onLayoutChange).toHaveBeenCalledTimes(1);
      const layout = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(layout.mode).toBe('tabs');
    });

    it('creates splitVertical layout with 2 columns', () => {
      const sessions = [makeSession('a'), makeSession('b')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'a', defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      act(() => {
        result.current.handleLayoutModeChange('splitVertical');
      });

      const layout = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(layout.mode).toBe('splitVertical');
      expect(layout.sessions).toHaveLength(2);
      // 2 columns → each 50% wide
      expect(layout.sessions[0].position.width).toBe(50);
      expect(layout.sessions[1].position.width).toBe(50);
    });

    it('creates splitHorizontal layout', () => {
      const sessions = [makeSession('a'), makeSession('b')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'a', defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      act(() => {
        result.current.handleLayoutModeChange('splitHorizontal');
      });

      const layout = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(layout.mode).toBe('splitHorizontal');
      expect(layout.sessions).toHaveLength(2);
      // 2 rows → each 50% tall
      expect(layout.sessions[0].position.height).toBe(50);
    });

    it('creates grid2 layout with max 2 sessions', () => {
      const sessions = [makeSession('a'), makeSession('b'), makeSession('c')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'a', defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      act(() => {
        result.current.handleLayoutModeChange('grid2');
      });

      const layout = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(layout.mode).toBe('grid2');
      expect(layout.sessions).toHaveLength(2);
      expect(layout.sessions[0].position.width).toBe(50);
    });

    it('creates grid4 layout with max 4 sessions', () => {
      const sessions = Array.from({ length: 6 }, (_, i) => makeSession(String(i)));
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, '0', defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      act(() => {
        result.current.handleLayoutModeChange('grid4');
      });

      const layout = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(layout.mode).toBe('grid4');
      expect(layout.sessions).toHaveLength(4);
      // 2x2 grid → each 50% wide, 50% tall
      expect(layout.sessions[0].position.width).toBe(50);
      expect(layout.sessions[0].position.height).toBe(50);
    });

    it('creates grid6 layout with max 6 sessions', () => {
      const sessions = Array.from({ length: 8 }, (_, i) => makeSession(String(i)));
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, '0', defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      act(() => {
        result.current.handleLayoutModeChange('grid6');
      });

      const layout = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(layout.mode).toBe('grid6');
      expect(layout.sessions).toHaveLength(6);
      // 3 cols × 2 rows → width ≈ 33.33, height = 50
      expect(layout.sessions[0].position.width).toBeCloseTo(33.33, 0);
      expect(layout.sessions[0].position.height).toBe(50);
    });

    it('creates mosaic layout using sqrt-based columns', () => {
      const sessions = Array.from({ length: 4 }, (_, i) => makeSession(String(i)));
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, '0', defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      act(() => {
        result.current.handleLayoutModeChange('mosaic');
      });

      const layout = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(layout.mode).toBe('mosaic');
      expect(layout.sessions).toHaveLength(4);
      // sqrt(4) = 2 cols → 50% wide each
      expect(layout.sessions[0].position.width).toBe(50);
    });

    it('creates miniMosaic layout (positions are full-bleed since the renderer shows a preview grid)', () => {
      const sessions = Array.from({ length: 9 }, (_, i) => makeSession(String(i)));
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, '0', defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      act(() => {
        result.current.handleLayoutModeChange('miniMosaic');
      });

      const layout = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(layout.mode).toBe('miniMosaic');
      // miniMosaic doesn't actually position tiles — the renderer
      // hides them and shows a preview grid instead. We still emit
      // one position record per session so click-to-promote works.
      expect(layout.sessions).toHaveLength(9);
      expect(layout.sessions[0].position.width).toBe(100);
    });

    it('creates sideBySide layout with 2 columns', () => {
      const sessions = [makeSession('a'), makeSession('b'), makeSession('c')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'a', defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      act(() => {
        result.current.handleLayoutModeChange('sideBySide');
      });

      const layout = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(layout.mode).toBe('sideBySide');
      expect(layout.sessions).toHaveLength(3);
      expect(layout.sessions[0].position.width).toBe(50);
    });
  });

  // ── handleCustomGridApply ──────────────────────────────────

  describe('handleCustomGridApply', () => {
    it('creates custom grid layout with default 2×2', () => {
      const sessions = Array.from({ length: 5 }, (_, i) => makeSession(String(i)));
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, '0', defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      act(() => {
        result.current.handleCustomGridApply();
      });

      const layout = onLayoutChange.mock.calls[0][0] as TabLayout;
      // Default 2 cols × 2 rows = max 4 sessions
      expect(layout.sessions).toHaveLength(4);
      expect(layout.sessions[0].position.width).toBe(50);
      expect(layout.sessions[0].position.height).toBe(50);
    });

    it('respects custom columns and rows', () => {
      const sessions = Array.from({ length: 12 }, (_, i) => makeSession(String(i)));
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, '0', defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      act(() => {
        result.current.setCustomCols(3);
        result.current.setCustomRows(3);
      });

      act(() => {
        result.current.handleCustomGridApply();
      });

      const layout = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(layout.sessions).toHaveLength(9); // 3×3
      expect(layout.sessions[0].position.width).toBeCloseTo(33.33, 0);
      expect(layout.sessions[0].position.height).toBeCloseTo(33.33, 0);
    });

    it('hides custom grid popover after apply', () => {
      const sessions = [makeSession('a')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'a', defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      act(() => {
        result.current.setShowCustomGrid(true);
      });
      expect(result.current.showCustomGrid).toBe(true);

      act(() => {
        result.current.handleCustomGridApply();
      });

      expect(result.current.showCustomGrid).toBe(false);
    });
  });

  // ── swapSessionsInSlots ────────────────────────────────────

  describe('swapSessionsInSlots', () => {
    const layoutWithSlots: TabLayout = {
      mode: 'grid2',
      sessions: [
        { sessionId: 'a', position: { x: 0, y: 0, width: 50, height: 100 } },
        { sessionId: 'b', position: { x: 50, y: 0, width: 50, height: 100 } },
      ],
    };

    it('swaps two sessions both in the layout, preserving positions', () => {
      const { result } = renderHook(() =>
        useTabLayoutManager(
          [makeSession('a'), makeSession('b')],
          'a',
          layoutWithSlots,
          onLayoutChange,
          onSessionClose,
          false,
        ),
      );
      act(() => result.current.swapSessionsInSlots('a', 'b'));
      const next = onLayoutChange.mock.calls[0][0] as TabLayout;
      // Positions are unchanged, only session ids flip
      expect(next.sessions[0].sessionId).toBe('b');
      expect(next.sessions[1].sessionId).toBe('a');
      expect(next.sessions[0].position).toEqual(layoutWithSlots.sessions[0].position);
    });

    it('promotes a hidden session into the destination slot', () => {
      const { result } = renderHook(() =>
        useTabLayoutManager(
          [makeSession('a'), makeSession('b'), makeSession('hidden')],
          'a',
          layoutWithSlots,
          onLayoutChange,
          onSessionClose,
          false,
        ),
      );
      act(() => result.current.swapSessionsInSlots('hidden', 'a'));
      const next = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(next.sessions[0].sessionId).toBe('hidden');
      expect(next.sessions[1].sessionId).toBe('b');
    });

    it('is a no-op when source equals destination', () => {
      const { result } = renderHook(() =>
        useTabLayoutManager(
          [makeSession('a'), makeSession('b')],
          'a',
          layoutWithSlots,
          onLayoutChange,
          onSessionClose,
          false,
        ),
      );
      act(() => result.current.swapSessionsInSlots('a', 'a'));
      expect(onLayoutChange).not.toHaveBeenCalled();
    });

    it('is a no-op when neither id is in the layout', () => {
      const { result } = renderHook(() =>
        useTabLayoutManager(
          [makeSession('a'), makeSession('b')],
          'a',
          layoutWithSlots,
          onLayoutChange,
          onSessionClose,
          false,
        ),
      );
      act(() => result.current.swapSessionsInSlots('ghost1', 'ghost2'));
      expect(onLayoutChange).not.toHaveBeenCalled();
    });
  });

  // ── assignSessionToSlot ────────────────────────────────────

  describe('assignSessionToSlot', () => {
    const layoutWithSlots: TabLayout = {
      mode: 'grid2',
      sessions: [
        { sessionId: 'a', position: { x: 0, y: 0, width: 50, height: 100 } },
        { sessionId: 'b', position: { x: 50, y: 0, width: 50, height: 100 } },
      ],
    };

    it('moves a session to a slot, displacing the previous occupant to its old slot', () => {
      const { result } = renderHook(() =>
        useTabLayoutManager(
          [makeSession('a'), makeSession('b')],
          'a',
          layoutWithSlots,
          onLayoutChange,
          onSessionClose,
          false,
        ),
      );
      // Move 'a' into slot 1, displacing 'b' into slot 0
      act(() => result.current.assignSessionToSlot('a', 1));
      const next = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(next.sessions[0].sessionId).toBe('b');
      expect(next.sessions[1].sessionId).toBe('a');
    });

    it('replaces the destination slot when source is hidden', () => {
      const { result } = renderHook(() =>
        useTabLayoutManager(
          [makeSession('a'), makeSession('b'), makeSession('hidden')],
          'a',
          layoutWithSlots,
          onLayoutChange,
          onSessionClose,
          false,
        ),
      );
      act(() => result.current.assignSessionToSlot('hidden', 0));
      const next = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(next.sessions[0].sessionId).toBe('hidden');
      expect(next.sessions[1].sessionId).toBe('b');
    });

    it('ignores out-of-range slot indices', () => {
      const { result } = renderHook(() =>
        useTabLayoutManager(
          [makeSession('a'), makeSession('b')],
          'a',
          layoutWithSlots,
          onLayoutChange,
          onSessionClose,
          false,
        ),
      );
      act(() => result.current.assignSessionToSlot('a', 99));
      act(() => result.current.assignSessionToSlot('a', -1));
      expect(onLayoutChange).not.toHaveBeenCalled();
    });
  });

  // ── hiddenSessions ─────────────────────────────────────────

  describe('hiddenSessions', () => {
    it('reports sessions that arent in the layout', () => {
      const layout: TabLayout = {
        mode: 'grid2',
        sessions: [
          { sessionId: 'a', position: { x: 0, y: 0, width: 50, height: 100 } },
          { sessionId: 'b', position: { x: 50, y: 0, width: 50, height: 100 } },
        ],
      };
      const sessions = [makeSession('a'), makeSession('b'), makeSession('c'), makeSession('d')];
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, 'a', layout, onLayoutChange, onSessionClose, false),
      );
      expect(result.current.hiddenSessions.map((s) => s.id).sort()).toEqual(['c', 'd']);
    });

    it('is empty when all sessions fit', () => {
      const layout: TabLayout = {
        mode: 'tabs',
        sessions: [{ sessionId: 'a', position: { x: 0, y: 0, width: 100, height: 100 } }],
      };
      const { result } = renderHook(() =>
        useTabLayoutManager([makeSession('a')], 'a', layout, onLayoutChange, onSessionClose, false),
      );
      expect(result.current.hiddenSessions).toHaveLength(0);
    });
  });

  // ── customGrid mode integration ────────────────────────────

  describe('handleCustomGridApply mode tagging', () => {
    it('sets mode to customGrid (not mosaic) so persistence preserves user intent', () => {
      const sessions = Array.from({ length: 6 }, (_, i) => makeSession(String(i)));
      const { result } = renderHook(() =>
        useTabLayoutManager(sessions, '0', defaultLayout(), onLayoutChange, onSessionClose, false),
      );
      act(() => {
        result.current.setCustomCols(3);
        result.current.setCustomRows(2);
      });
      act(() => result.current.handleCustomGridApply());
      const layout = onLayoutChange.mock.calls[0][0] as TabLayout;
      expect(layout.mode).toBe('customGrid');
      expect(layout.customCols).toBe(3);
      expect(layout.customRows).toBe(2);
    });
  });

  // ── showCustomGrid / setShowCustomGrid ─────────────────────

  describe('custom grid state', () => {
    it('defaults showCustomGrid to false', () => {
      const { result } = renderHook(() =>
        useTabLayoutManager([], undefined, defaultLayout(), onLayoutChange, onSessionClose, false),
      );
      expect(result.current.showCustomGrid).toBe(false);
    });

    it('toggles showCustomGrid', () => {
      const { result } = renderHook(() =>
        useTabLayoutManager([], undefined, defaultLayout(), onLayoutChange, onSessionClose, false),
      );

      act(() => result.current.setShowCustomGrid(true));
      expect(result.current.showCustomGrid).toBe(true);

      act(() => result.current.setShowCustomGrid(false));
      expect(result.current.showCustomGrid).toBe(false);
    });

    it('defaults customCols and customRows to 2', () => {
      const { result } = renderHook(() =>
        useTabLayoutManager([], undefined, defaultLayout(), onLayoutChange, onSessionClose, false),
      );
      expect(result.current.customCols).toBe(2);
      expect(result.current.customRows).toBe(2);
    });
  });
});
