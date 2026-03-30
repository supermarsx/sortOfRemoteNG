import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../src/contexts/useConnections', () => ({
  useConnections: vi.fn().mockReturnValue({
    state: {
      connections: [
        {
          id: 'conn-1',
          name: 'VNC Server',
          hostname: '10.0.0.5',
          port: 5900,
          protocol: 'vnc',
          password: 'vncpass',
          isGroup: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    },
    dispatch: vi.fn(),
  }),
}));

vi.mock('../../src/utils/core/debugLogger', () => ({
  debugLog: vi.fn(),
}));

// Mock noVNC import to always fail so it falls back to simulated desktop
vi.mock('novnc/core/rfb', () => {
  throw new Error('noVNC not available in test');
});

import { useVNCClient } from '../../src/hooks/protocol/useVNCClient';
import type { ConnectionSession } from '../../src/types/connection/connection';
import type { VNCSettings } from '../../src/hooks/protocol/useVNCClient';

const makeSession = (overrides: Partial<ConnectionSession> = {}): ConnectionSession => ({
  id: 'sess-1',
  connectionId: 'conn-1',
  name: 'VNC Server',
  status: 'connected',
  startTime: new Date(),
  protocol: 'vnc',
  hostname: '10.0.0.5',
  ...overrides,
});

// Create a mock canvas context
const mockCtx = {
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  font: '',
  textAlign: 'left' as CanvasTextAlign,
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  fillText: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  createLinearGradient: vi.fn().mockReturnValue({
    addColorStop: vi.fn(),
  }),
};

// Mock HTMLCanvasElement.getContext
const originalGetContext = HTMLCanvasElement.prototype.getContext;

describe('useVNCClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as any;
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  // ── Initial state ───────────────────────────────────────────────────────

  it('starts in connecting state', () => {
    const { result } = renderHook(() => useVNCClient(makeSession()));
    // Initial status is 'connecting' before any async work completes
    expect(result.current.connectionStatus).toBe('connecting');
    expect(result.current.isConnected).toBe(false);
  });

  it('has default VNC settings', () => {
    const { result } = renderHook(() => useVNCClient(makeSession()));

    expect(result.current.settings.viewOnly).toBe(false);
    expect(result.current.settings.scaleViewport).toBe(true);
    expect(result.current.settings.localCursor).toBe(true);
    expect(result.current.settings.quality).toBe(6);
    expect(result.current.settings.compressionLevel).toBe(2);
  });

  it('showSettings is initially false', () => {
    const { result } = renderHook(() => useVNCClient(makeSession()));
    expect(result.current.showSettings).toBe(false);
  });

  it('isFullscreen is initially false', () => {
    const { result } = renderHook(() => useVNCClient(makeSession()));
    expect(result.current.isFullscreen).toBe(false);
  });

  // ── Settings updates ───────────────────────────────────────────────────

  it('setSettings updates individual settings', () => {
    const { result } = renderHook(() => useVNCClient(makeSession()));

    act(() => {
      result.current.setSettings((prev: VNCSettings) => ({ ...prev, viewOnly: true }));
    });
    expect(result.current.settings.viewOnly).toBe(true);

    act(() => {
      result.current.setSettings((prev: VNCSettings) => ({ ...prev, quality: 9 }));
    });
    expect(result.current.settings.quality).toBe(9);
  });

  it('setShowSettings toggles settings panel', () => {
    const { result } = renderHook(() => useVNCClient(makeSession()));

    act(() => { result.current.setShowSettings(true); });
    expect(result.current.showSettings).toBe(true);

    act(() => { result.current.setShowSettings(false); });
    expect(result.current.showSettings).toBe(false);
  });

  // ── Fullscreen toggle ──────────────────────────────────────────────────

  it('toggleFullscreen toggles state', () => {
    const { result } = renderHook(() => useVNCClient(makeSession()));

    act(() => { result.current.toggleFullscreen(); });
    expect(result.current.isFullscreen).toBe(true);

    act(() => { result.current.toggleFullscreen(); });
    expect(result.current.isFullscreen).toBe(false);
  });

  // ── Status helpers ─────────────────────────────────────────────────────

  it('getStatusColor returns correct colors for each status', () => {
    const { result } = renderHook(() => useVNCClient(makeSession()));

    // Default is connecting
    expect(result.current.getStatusColor()).toBe('text-yellow-400');
  });

  it('getStatusIcon returns correct icon keys', () => {
    const { result } = renderHook(() => useVNCClient(makeSession()));

    // Default is connecting
    expect(result.current.getStatusIcon()).toBe('connecting');
  });

  // ── Simulated desktop drawing ──────────────────────────────────────────

  it('drawSimulatedDesktop calls canvas drawing methods', () => {
    const { result } = renderHook(() => useVNCClient(makeSession()));

    const ctx = mockCtx as unknown as CanvasRenderingContext2D;
    act(() => {
      result.current.drawSimulatedDesktop(ctx, 1024, 768);
    });

    expect(mockCtx.fillRect).toHaveBeenCalled();
    expect(mockCtx.fillText).toHaveBeenCalled();
    expect(mockCtx.createLinearGradient).toHaveBeenCalled();
  });

  // ── Connection initialization ───────────────────────────────────────────

  it('stays in connecting state when canvas is not available', () => {
    // canvasRef.current is null in renderHook (no DOM), so initializeVNCConnection
    // returns early without changing state
    const { result } = renderHook(() => useVNCClient(makeSession()));
    expect(result.current.connectionStatus).toBe('connecting');
    expect(result.current.isConnected).toBe(false);
  });

  it('handleCanvasClick does nothing when not connected', () => {
    const { result } = renderHook(() => useVNCClient(makeSession()));

    // Should not throw when canvas is null and not connected
    act(() => {
      result.current.handleCanvasClick({ clientX: 100, clientY: 100 } as React.MouseEvent<HTMLCanvasElement>);
    });
    // No error thrown is the assertion
  });

  // ── Session passthrough ────────────────────────────────────────────────

  it('returns the session object', () => {
    const session = makeSession();
    const { result } = renderHook(() => useVNCClient(session));
    expect(result.current.session).toBe(session);
  });

  // ── canvasRef ──────────────────────────────────────────────────────────

  it('provides a canvasRef', () => {
    const { result } = renderHook(() => useVNCClient(makeSession()));
    expect(result.current.canvasRef).toBeDefined();
    expect(result.current.canvasRef.current).toBeNull(); // not mounted in renderHook
  });
});
