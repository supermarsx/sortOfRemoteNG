import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWindowManager } from '../../src/hooks/window/useWindowManager';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

const mockEmitTo = vi.fn().mockResolvedValue(undefined);

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
  emit: vi.fn(),
  emitTo: (...args: any[]) => mockEmitTo(...args),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: { getByLabel: vi.fn() },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getAllWindows: vi.fn().mockResolvedValue([]),
}));

// ── Helpers ────────────────────────────────────────────────────────

function makeSession(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    connectionId: `conn-${id}`,
    protocol: 'ssh' as const,
    name: `Session ${id}`,
    status: 'connected' as const,
    backendSessionId: `be-${id}`,
    hostname: `host-${id}`,
    startTime: new Date(),
    reconnectAttempts: 0,
    maxReconnectAttempts: 3,
    ...overrides,
  };
}

function makeConnection(id: string) {
  return { id, name: `Conn ${id}`, hostname: `host-${id}`, port: 22, protocol: 'ssh' };
}

function renderWindowManager(overrides: Record<string, any> = {}) {
  const defaults = {
    sessions: [makeSession('s1'), makeSession('s2')],
    connections: [makeConnection('conn-s1'), makeConnection('conn-s2')],
    tabGroups: [],
    dispatch: vi.fn(),
    setActiveSessionId: vi.fn(),
    handleSessionClose: vi.fn().mockResolvedValue(undefined),
    handleSessionDetach: vi.fn(),
  };
  return renderHook(() => useWindowManager({ ...defaults, ...overrides }));
}

// ── Tests ──────────────────────────────────────────────────────────

describe('useWindowManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('initializes with a main window in the registry', () => {
    const { result } = renderWindowManager();
    const mainEntry = result.current.registry.current.windows.get('main');
    expect(mainEntry).toBeDefined();
    expect(mainEntry!.windowId).toBe('main');
  });

  it('main window entry contains session IDs for non-detached sessions', () => {
    const { result } = renderWindowManager();
    const mainEntry = result.current.registry.current.windows.get('main');
    expect(mainEntry!.sessionIds).toContain('s1');
    expect(mainEntry!.sessionIds).toContain('s2');
  });

  it('registerWindow adds a new window to the registry', () => {
    const { result } = renderWindowManager();
    act(() => {
      result.current.registerWindow('detached-s1', ['s1']);
    });
    const entry = result.current.registry.current.windows.get('detached-s1');
    expect(entry).toBeDefined();
    expect(entry!.sessionIds).toEqual(['s1']);
    expect(entry!.activeSessionId).toBe('s1');
  });

  it('registerWindow updates session ownership', () => {
    const { result } = renderWindowManager();
    act(() => {
      result.current.registerWindow('detached-s1', ['s1']);
    });
    expect(result.current.registry.current.sessionOwnership.get('s1')).toBe('detached-s1');
  });

  it('registerWindow with multiple sessions tracks all of them', () => {
    const { result } = renderWindowManager();
    act(() => {
      result.current.registerWindow('detached-multi', ['s1', 's2']);
    });
    const entry = result.current.registry.current.windows.get('detached-multi');
    expect(entry!.sessionIds).toEqual(['s1', 's2']);
    expect(result.current.registry.current.sessionOwnership.get('s1')).toBe('detached-multi');
    expect(result.current.registry.current.sessionOwnership.get('s2')).toBe('detached-multi');
  });

  it('tracks detached sessions via layout.isDetached', () => {
    const detachedSession = makeSession('s3', {
      layout: { x: 0, y: 0, width: 800, height: 600, zIndex: 1, isDetached: true, windowId: 'detached-s3' },
    });
    const { result } = renderWindowManager({
      sessions: [makeSession('s1'), detachedSession],
    });
    // registerWindow first so the window entry exists
    act(() => {
      result.current.registerWindow('detached-s3', []);
    });
    // Re-render to trigger the effect that processes detached sessions
    // The ownership is set in the useEffect based on sessions
    expect(result.current.registry.current.sessionOwnership.get('s3')).toBe('detached-s3');
  });

  it('syncWindow does nothing for the main window', async () => {
    const { result } = renderWindowManager();
    await act(async () => {
      await result.current.syncWindow('main');
    });
    expect(mockEmitTo).not.toHaveBeenCalled();
  });

  it('syncWindow does not throw for a registered detached window', async () => {
    const { result } = renderWindowManager();
    act(() => {
      result.current.registerWindow('detached-s1', ['s1']);
    });
    // syncWindow uses dynamic import(@tauri-apps/api/event).emitTo internally;
    // we verify it doesn't throw and completes for a registered window.
    await act(async () => {
      await expect(result.current.syncWindow('detached-s1')).resolves.not.toThrow();
    });
  });

  it('syncWindow ignores non-existent windows without error', async () => {
    const { result } = renderWindowManager();
    await act(async () => {
      await expect(result.current.syncWindow('detached-nope')).resolves.not.toThrow();
    });
  });

  it('returns registry, registerWindow, syncWindow, and detachRef', () => {
    const { result } = renderWindowManager();
    expect(result.current.registry).toBeDefined();
    expect(typeof result.current.registerWindow).toBe('function');
    expect(typeof result.current.syncWindow).toBe('function');
    expect(result.current.detachRef).toBeDefined();
  });

  it('detachRef holds the handleSessionDetach callback', () => {
    const detachFn = vi.fn();
    const { result } = renderWindowManager({ handleSessionDetach: detachFn });
    expect(result.current.detachRef.current).toBe(detachFn);
  });

  it('registry tracks creation timestamp for registered windows', () => {
    const before = Date.now();
    const { result } = renderWindowManager();
    act(() => {
      result.current.registerWindow('detached-ts', ['s1']);
    });
    const entry = result.current.registry.current.windows.get('detached-ts');
    expect(entry!.createdAt).toBeGreaterThanOrEqual(before);
    expect(entry!.createdAt).toBeLessThanOrEqual(Date.now());
  });
});
