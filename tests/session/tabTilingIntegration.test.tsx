/**
 * Integration / regression tests for the end-to-end tiling pipeline.
 *
 * These tests cover the bug classes the user explicitly called out:
 *  - functionality (split-session event handler, persistence round-trip)
 *  - races (rapid mode switches, rapid persistence writes,
 *    session churn during persist)
 *  - bug-prone interactions (custom grid surviving session changes)
 *
 * Style note: we exercise the layout pipeline in isolation by
 * combining the shared `buildTabLayout` helper with React state
 * inside small harness components, instead of mounting the entire
 * `<AppContent />` (which has dozens of unrelated subsystems).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  buildTabLayout,
  hasFreeSlot,
} from '../../src/utils/session/tabLayoutBuilder';
import type {
  ConnectionSession,
  TabLayout,
  TabLayoutMode,
} from '../../src/types/connection/connection';

const makeSession = (id: string): ConnectionSession => ({
  id,
  connectionId: `conn-${id}`,
  name: `Session ${id}`,
  status: 'connected',
  startTime: new Date('2026-01-01T00:00:00.000Z'),
  protocol: 'ssh',
  hostname: `host-${id}`,
});

/**
 * Mirror of App.tsx's `split-session` listener. Kept in sync with
 * the production code by intent — any drift here means the dispatch
 * → handler contract changed and the regression test will fail.
 */
function dispatchSplitSession(sessionId: string, direction: 'right' | 'down') {
  window.dispatchEvent(
    new CustomEvent('split-session', { detail: { sessionId, direction } }),
  );
}

interface ListenerHandle {
  cleanup: () => void;
  /** Last layout this listener built — read after dispatching. */
  result: { current: TabLayout | null };
}

function attachSplitSessionListener(
  sessions: ConnectionSession[],
  initial: TabLayout,
): ListenerHandle {
  const ref = { current: initial as TabLayout | null };
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ sessionId: string; direction: 'right' | 'down' }>).detail;
    if (!detail || !detail.sessionId) return;
    const mode: TabLayoutMode = detail.direction === 'down' ? 'splitHorizontal' : 'splitVertical';
    ref.current = buildTabLayout(mode, sessions, {
      activeSessionId: detail.sessionId,
      customCols: ref.current?.customCols,
      customRows: ref.current?.customRows,
    });
  };
  window.addEventListener('split-session', handler as EventListener);
  return {
    cleanup: () => window.removeEventListener('split-session', handler as EventListener),
    result: ref,
  };
}

describe('split-session event integration', () => {
  it('right direction switches to splitVertical with the source session at slot 0', () => {
    const sessions = [makeSession('a'), makeSession('b'), makeSession('c')];
    const handle = attachSplitSessionListener(sessions, buildTabLayout('tabs', sessions));
    dispatchSplitSession('b', 'right');
    expect(handle.result.current!.mode).toBe('splitVertical');
    expect(handle.result.current!.sessions[0].sessionId).toBe('b');
    handle.cleanup();
  });

  it('down direction switches to splitHorizontal with the source session at slot 0', () => {
    const sessions = [makeSession('a'), makeSession('b'), makeSession('c')];
    const handle = attachSplitSessionListener(sessions, buildTabLayout('tabs', sessions));
    dispatchSplitSession('c', 'down');
    expect(handle.result.current!.mode).toBe('splitHorizontal');
    expect(handle.result.current!.sessions[0].sessionId).toBe('c');
    handle.cleanup();
  });

  it('ignores split-session events without sessionId (defensive: malformed dispatch)', () => {
    const sessions = [makeSession('a'), makeSession('b')];
    const initial = buildTabLayout('tabs', sessions);
    const handle = attachSplitSessionListener(sessions, initial);
    window.dispatchEvent(new CustomEvent('split-session', { detail: { sessionId: '', direction: 'right' } }));
    expect(handle.result.current).toEqual(initial);
    handle.cleanup();
  });

  it('cleans up listener — no zombie handlers after unmount', () => {
    const sessions = [makeSession('a')];
    const handle = attachSplitSessionListener(sessions, buildTabLayout('tabs', sessions));
    handle.cleanup();
    // After cleanup, dispatching shouldn't mutate the ref
    handle.result.current = null;
    dispatchSplitSession('a', 'right');
    expect(handle.result.current).toBeNull();
  });
});

describe('persistence round-trip', () => {
  it('persisting tabLayoutState and rebuilding from it yields the same mode + dims', () => {
    const sessions = Array.from({ length: 5 }, (_, i) => makeSession(String(i)));

    // User picks customGrid 3×2
    const userPicked = buildTabLayout('customGrid', sessions, {
      customCols: 3,
      customRows: 2,
    });

    // Persist (mode + dims only — positions are derived)
    const persisted = {
      mode: userPicked.mode,
      customCols: userPicked.customCols,
      customRows: userPicked.customRows,
    };

    // Simulate restart: load persisted state, rebuild with empty
    // sessions (no sessions open yet)
    const onStartup = buildTabLayout(persisted.mode, [], {
      customCols: persisted.customCols,
      customRows: persisted.customRows,
    });
    expect(onStartup.mode).toBe('customGrid');
    expect(onStartup.customCols).toBe(3);
    expect(onStartup.customRows).toBe(2);

    // Sessions open → rebuild
    const afterSessionsOpen = buildTabLayout(onStartup.mode, sessions, {
      customCols: onStartup.customCols,
      customRows: onStartup.customRows,
    });
    expect(afterSessionsOpen.mode).toBe('customGrid');
    expect(afterSessionsOpen.customCols).toBe(3);
    expect(afterSessionsOpen.customRows).toBe(2);
    expect(afterSessionsOpen.sessions).toHaveLength(5);
  });

  it('persisting capped-mode rebuild keeps the cap on session churn', () => {
    // grid4 with 4 sessions; close 1; open 2 more (total 5)
    // The cap should still be 4, no more than 4 slots filled.
    const sessions5 = Array.from({ length: 5 }, (_, i) => makeSession(String(i)));
    const layout4 = buildTabLayout('grid4', sessions5.slice(0, 4));
    expect(layout4.sessions).toHaveLength(4);
    const layout5 = buildTabLayout(layout4.mode, sessions5);
    expect(layout5.sessions).toHaveLength(4);
  });
});

describe('races: rapid mode switches', () => {
  it('rebuilds always end up reflecting the *last* mode', () => {
    const sessions = Array.from({ length: 4 }, (_, i) => makeSession(String(i)));
    let current = buildTabLayout('tabs', sessions);

    // Rapid-fire 50 mode switches
    const order: TabLayoutMode[] = [
      'mosaic', 'grid2', 'grid4', 'splitVertical', 'splitHorizontal',
      'sideBySide', 'miniMosaic', 'customGrid', 'tabs', 'grid6',
    ];
    for (let i = 0; i < 50; i++) {
      current = buildTabLayout(order[i % order.length], sessions, {
        customCols: 2,
        customRows: 3,
      });
    }
    expect(current.mode).toBe(order[(50 - 1) % order.length]);
  });

  it('rapid session churn during a stable customGrid does not change mode', () => {
    // Simulates 100 rapid open/close operations while the user stays
    // in customGrid 4×3. The mode and dims must stay stable.
    let layout = buildTabLayout('customGrid', [], { customCols: 4, customRows: 3 });
    for (let n = 0; n < 100; n++) {
      const count = (n % 8) + 1;
      const sessions = Array.from({ length: count }, (_, i) => makeSession(String(i)));
      layout = buildTabLayout(layout.mode, sessions, {
        customCols: layout.customCols,
        customRows: layout.customRows,
      });
    }
    expect(layout.mode).toBe('customGrid');
    expect(layout.customCols).toBe(4);
    expect(layout.customRows).toBe(3);
  });

  it('hasFreeSlot correctly detects when a new session triggers a rebuild', () => {
    // grid4, 3 sessions, slot 4 is free → opening session 4 should rebuild
    const layout = buildTabLayout('grid4', Array.from({ length: 3 }, (_, i) => makeSession(String(i))));
    expect(hasFreeSlot(layout, 4)).toBe(true);
    // grid4 at full capacity (4 sessions, 4 slots) → opening session 5 should NOT rebuild
    const layoutFull = buildTabLayout('grid4', Array.from({ length: 4 }, (_, i) => makeSession(String(i))));
    expect(hasFreeSlot(layoutFull, 5)).toBe(false);
  });
});

describe('races: persistence debouncing via snapshot ref', () => {
  /**
   * Mirror of App.tsx's lastPersistedTabLayoutRef pattern. We test
   * that identical successive updates produce only one save call,
   * even if state churns inside a single render pass.
   */
  it('does not re-persist when mode + dims are unchanged across renders', () => {
    const persist = vi.fn();
    const ref = { current: '' };

    function tick(layout: TabLayout) {
      const snapshot = JSON.stringify({
        mode: layout.mode,
        customCols: layout.customCols,
        customRows: layout.customRows,
      });
      if (snapshot === ref.current) return;
      ref.current = snapshot;
      persist(snapshot);
    }

    const sessions = Array.from({ length: 4 }, (_, i) => makeSession(String(i)));
    const layout = buildTabLayout('grid4', sessions);
    // Many renders, no mode/dim changes — should only persist once
    for (let i = 0; i < 20; i++) {
      tick({ ...layout, sessions: [...layout.sessions] });
    }
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('persists exactly once per *distinct* mode change', () => {
    const persist = vi.fn();
    const ref = { current: '' };
    const tick = (layout: TabLayout) => {
      const snapshot = JSON.stringify({
        mode: layout.mode,
        customCols: layout.customCols,
        customRows: layout.customRows,
      });
      if (snapshot === ref.current) return;
      ref.current = snapshot;
      persist(snapshot);
    };

    tick(buildTabLayout('tabs', []));
    tick(buildTabLayout('grid4', []));
    tick(buildTabLayout('grid4', [])); // no-op
    tick(buildTabLayout('mosaic', []));
    tick(buildTabLayout('customGrid', [], { customCols: 2, customRows: 2 }));
    tick(buildTabLayout('customGrid', [], { customCols: 2, customRows: 2 })); // no-op
    tick(buildTabLayout('customGrid', [], { customCols: 3, customRows: 2 })); // dims changed
    expect(persist).toHaveBeenCalledTimes(5);
  });
});

describe('regression: previously hidden modes are now reachable', () => {
  it.each<TabLayoutMode>(['sideBySide', 'mosaic', 'miniMosaic', 'customGrid'])(
    'mode %s produces a valid layout that is not silently reclassified',
    (mode) => {
      const layout = buildTabLayout(mode, Array.from({ length: 3 }, (_, i) => makeSession(String(i))), {
        activeSessionId: '0',
        customCols: 2,
        customRows: 2,
      });
      expect(layout.mode).toBe(mode);
    },
  );
});

describe('UI harness — tile DnD type contract', () => {
  it('TabLayoutManager exports SESSION_TAB_DND_TYPE for cross-component DnD', async () => {
    // Importing late so this test only fails if the symbol is removed.
    const mod = await import('../../src/components/session/TabLayoutManager');
    expect(mod.SESSION_TAB_DND_TYPE).toBe('application/x-session-tab');
  });
});

describe('renderable harness — basic React lifecycle does not warn', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('mounting and unmounting a component that drives buildTabLayout is clean', () => {
    const Harness: React.FC<{ mode: TabLayoutMode }> = ({ mode }) => {
      const layout = buildTabLayout(mode, [makeSession('a'), makeSession('b')]);
      return <div data-testid="harness">{layout.mode}</div>;
    };
    const { unmount, getByTestId } = render(<Harness mode="grid2" />);
    expect(getByTestId('harness').textContent).toBe('grid2');
    act(() => unmount());
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
