import { describe, it, expect } from 'vitest';
import {
  buildTabLayout,
  clampGridDim,
  hasFreeSlot,
  isMosaicMode,
  layoutCapacity,
  MAX_CUSTOM_GRID_DIM,
  MIN_CUSTOM_GRID_DIM,
  TAB_LAYOUT_MODES,
} from '../../../src/utils/session/tabLayoutBuilder';
import type {
  ConnectionSession,
  TabLayoutMode,
} from '../../../src/types/connection/connection';

const makeSession = (id: string): ConnectionSession => ({
  id,
  connectionId: `conn-${id}`,
  name: `Session ${id}`,
  status: 'connected',
  startTime: new Date('2026-01-01T00:00:00.000Z'),
  protocol: 'ssh',
  hostname: `host-${id}`,
});

const sessionList = (n: number) =>
  Array.from({ length: n }, (_, i) => makeSession(String(i)));

describe('clampGridDim', () => {
  it('clamps below minimum', () => {
    expect(clampGridDim(0)).toBe(MIN_CUSTOM_GRID_DIM);
    expect(clampGridDim(-3)).toBe(MIN_CUSTOM_GRID_DIM);
  });

  it('clamps above maximum', () => {
    expect(clampGridDim(MAX_CUSTOM_GRID_DIM + 1)).toBe(MAX_CUSTOM_GRID_DIM);
    expect(clampGridDim(99999)).toBe(MAX_CUSTOM_GRID_DIM);
  });

  it('floors fractional values', () => {
    expect(clampGridDim(2.9)).toBe(2);
  });

  it('falls back to 2 for undefined / non-finite values (NaN, Infinity)', () => {
    // Non-finite values are treated as "unknown" — we fall back
    // to the default rather than guessing the user's intent.
    expect(clampGridDim(undefined)).toBe(2);
    expect(clampGridDim(Number.NaN)).toBe(2);
    expect(clampGridDim(Number.POSITIVE_INFINITY)).toBe(2);
    expect(clampGridDim(Number.NEGATIVE_INFINITY)).toBe(2);
  });
});

describe('buildTabLayout — universal invariants', () => {
  it.each(TAB_LAYOUT_MODES)('mode %s never throws and returns the same mode tag', (mode) => {
    const layout = buildTabLayout(mode, sessionList(3), {
      activeSessionId: '0',
      customCols: 2,
      customRows: 2,
    });
    expect(layout.mode).toBe(mode);
  });

  it.each(TAB_LAYOUT_MODES)(
    'mode %s with empty session list emits empty positions',
    (mode) => {
      const layout = buildTabLayout(mode, [], { customCols: 2, customRows: 2 });
      expect(layout.sessions).toEqual([]);
    },
  );

  it.each(TAB_LAYOUT_MODES)(
    'mode %s positions never extend past 100%% of the container',
    (mode) => {
      const layout = buildTabLayout(mode, sessionList(12), {
        activeSessionId: '0',
        customCols: 4,
        customRows: 3,
      });
      for (const s of layout.sessions) {
        expect(s.position.x + s.position.width).toBeLessThanOrEqual(100 + 0.001);
        expect(s.position.y + s.position.height).toBeLessThanOrEqual(100 + 0.001);
      }
    },
  );
});

describe('buildTabLayout — mode specifics', () => {
  it('tabs: one position per session, full container', () => {
    const layout = buildTabLayout('tabs', sessionList(4));
    expect(layout.sessions).toHaveLength(4);
    for (const s of layout.sessions) {
      expect(s.position.width).toBe(100);
      expect(s.position.height).toBe(100);
    }
  });

  it('splitVertical: 2 cols, ceil(N/2) rows', () => {
    const layout = buildTabLayout('splitVertical', sessionList(3), { activeSessionId: '0' });
    expect(layout.sessions[0].position.width).toBe(50);
    expect(layout.sessions[0].position.height).toBe(50);
    // 3rd session lands on row 2, starting at x=0
    expect(layout.sessions[2].position.x).toBe(0);
    expect(layout.sessions[2].position.y).toBe(50);
  });

  it('grid2 / grid4 / grid6 cap session count', () => {
    expect(buildTabLayout('grid2', sessionList(10)).sessions).toHaveLength(2);
    expect(buildTabLayout('grid4', sessionList(10)).sessions).toHaveLength(4);
    expect(buildTabLayout('grid6', sessionList(10)).sessions).toHaveLength(6);
  });

  it('mosaic: cols = ceil(sqrt(N))', () => {
    const layout = buildTabLayout('mosaic', sessionList(5));
    // ceil(sqrt(5)) = 3 cols → width ≈ 33.33
    expect(layout.sessions[0].position.width).toBeCloseTo(33.33, 0);
    expect(layout.sessions).toHaveLength(5);
  });

  it('customGrid: writes customCols/customRows on the layout and caps slots', () => {
    const layout = buildTabLayout('customGrid', sessionList(20), {
      customCols: 3,
      customRows: 2,
    });
    expect(layout.customCols).toBe(3);
    expect(layout.customRows).toBe(2);
    expect(layout.sessions).toHaveLength(6);
  });

  it('customGrid: clamps out-of-range custom dims (defends against stale persisted state)', () => {
    const layout = buildTabLayout('customGrid', sessionList(4), {
      customCols: 99,
      customRows: -3,
    });
    expect(layout.customCols).toBe(MAX_CUSTOM_GRID_DIM);
    expect(layout.customRows).toBe(MIN_CUSTOM_GRID_DIM);
  });

  it('activeSessionId moves the active session to slot 0', () => {
    const layout = buildTabLayout('mosaic', sessionList(4), { activeSessionId: '2' });
    expect(layout.sessions[0].sessionId).toBe('2');
  });

  it('activeSessionId that does not exist is ignored, not thrown', () => {
    const layout = buildTabLayout('mosaic', sessionList(3), { activeSessionId: 'ghost' });
    expect(layout.sessions[0].sessionId).toBe('0');
  });
});

describe('hasFreeSlot', () => {
  it('reports free slots for capped modes when sessions exceed cap minus current', () => {
    const layout = buildTabLayout('grid4', sessionList(3));
    // grid4 has 4 slots, 3 are filled → adding a 4th session should fill the gap
    expect(hasFreeSlot(layout, 4)).toBe(true);
  });

  it('reports no free slots when cap is reached', () => {
    const layout = buildTabLayout('grid4', sessionList(4));
    expect(hasFreeSlot(layout, 5)).toBe(false);
  });

  it('uncapped modes always have free slots when session count grows', () => {
    const layout = buildTabLayout('mosaic', sessionList(3));
    expect(hasFreeSlot(layout, 4)).toBe(true);
  });
});

describe('layoutCapacity', () => {
  it('returns fixed values for capped modes', () => {
    expect(layoutCapacity({ mode: 'grid2', sessions: [] }, 100)).toBe(2);
    expect(layoutCapacity({ mode: 'grid4', sessions: [] }, 100)).toBe(4);
    expect(layoutCapacity({ mode: 'grid6', sessions: [] }, 100)).toBe(6);
  });

  it('uses sessionCount for uncapped modes', () => {
    expect(layoutCapacity({ mode: 'mosaic', sessions: [] }, 7)).toBe(7);
    expect(layoutCapacity({ mode: 'tabs', sessions: [] }, 12)).toBe(12);
  });

  it('multiplies cols × rows for customGrid', () => {
    expect(
      layoutCapacity(
        { mode: 'customGrid', sessions: [], customCols: 3, customRows: 4 },
        100,
      ),
    ).toBe(12);
  });

  it('clamps customGrid capacity to safe range', () => {
    expect(
      layoutCapacity(
        { mode: 'customGrid', sessions: [], customCols: 999, customRows: 999 },
        100,
      ),
    ).toBe(MAX_CUSTOM_GRID_DIM * MAX_CUSTOM_GRID_DIM);
  });
});

describe('isMosaicMode', () => {
  it('returns true for tile-rendering modes', () => {
    expect(isMosaicMode('mosaic')).toBe(true);
    expect(isMosaicMode('grid4')).toBe(true);
    expect(isMosaicMode('splitVertical')).toBe(true);
    expect(isMosaicMode('customGrid')).toBe(true);
  });

  it('returns false for tabs and miniMosaic', () => {
    expect(isMosaicMode('tabs')).toBe(false);
    expect(isMosaicMode('miniMosaic')).toBe(false);
  });
});

describe('performance / stress', () => {
  it('handles 200 sessions in mosaic without timing out', () => {
    const start = performance.now();
    const layout = buildTabLayout('mosaic', sessionList(200), { activeSessionId: '0' });
    const elapsed = performance.now() - start;
    // Should be well under 50ms even on slow CI
    expect(elapsed).toBeLessThan(50);
    expect(layout.sessions).toHaveLength(200);
  });

  it('handles 200 sessions in customGrid 6×6 by capping correctly', () => {
    const layout = buildTabLayout('customGrid', sessionList(200), {
      customCols: 6,
      customRows: 6,
    });
    expect(layout.sessions).toHaveLength(36);
  });

  it('all session ids in the output are unique', () => {
    const layout = buildTabLayout('grid4', sessionList(20));
    const ids = layout.sessions.map((s) => s.sessionId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('regression: custom grid does not collapse to mosaic on rebuild', () => {
  it('rebuilding customGrid layout with new session count keeps cols/rows', () => {
    // Simulates the App.tsx useEffect that rebuilds the layout when
    // the visible session set changes. The user's customGrid choice
    // must survive a rebuild — previously, the wrong mode tag caused
    // the rebuild to fall through to the mosaic case and wipe the
    // user's dimensions.
    const before = buildTabLayout('customGrid', sessionList(4), {
      customCols: 3,
      customRows: 2,
    });
    expect(before.customCols).toBe(3);
    expect(before.customRows).toBe(2);

    // A session opens → rebuild with the same mode/dims
    const after = buildTabLayout(before.mode, sessionList(5), {
      customCols: before.customCols,
      customRows: before.customRows,
    });

    expect(after.mode).toBe('customGrid');
    expect(after.customCols).toBe(3);
    expect(after.customRows).toBe(2);
    expect(after.sessions).toHaveLength(5); // 5 sessions fit in 6 slots
  });

  it('regression: grid4 does not reset to tabs when a session closes', () => {
    const before = buildTabLayout('grid4', sessionList(4));
    const after = buildTabLayout(before.mode, sessionList(3));
    expect(after.mode).toBe('grid4');
    expect(after.sessions).toHaveLength(3);
  });
});

describe('regression: split-session ordering', () => {
  it('splitVertical with activeSessionId puts active at slot 0', () => {
    const layout = buildTabLayout('splitVertical', sessionList(4), { activeSessionId: '3' });
    expect(layout.sessions[0].sessionId).toBe('3');
    // The dispatched session is on the primary side (top-left = x=0,y=0)
    expect(layout.sessions[0].position.x).toBe(0);
    expect(layout.sessions[0].position.y).toBe(0);
  });

  it('splitHorizontal with activeSessionId puts active at slot 0', () => {
    const layout = buildTabLayout('splitHorizontal', sessionList(4), { activeSessionId: '2' });
    expect(layout.sessions[0].sessionId).toBe('2');
    expect(layout.sessions[0].position.x).toBe(0);
    expect(layout.sessions[0].position.y).toBe(0);
  });
});
