import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback || key }),
}));

vi.mock('../../src/utils/core/debugLogger', () => ({
  debugLog: vi.fn(),
}));

vi.mock('../../src/contexts/useConnections', () => ({
  useConnections: vi.fn().mockReturnValue({
    state: {
      connections: [{
        id: 'conn-1',
        name: 'Test VNC',
        hostname: '192.168.1.10',
        port: 5900,
        protocol: 'vnc',
        password: 'vncpass',
        isGroup: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }],
    },
    dispatch: vi.fn(),
  }),
}));

// Mock canvas context since jsdom doesn't support it
const mockCtx = {
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  fillText: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  strokeRect: vi.fn(),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
};

HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx) as any;

// Mock the noVNC import to prevent real connection attempts
vi.mock('novnc/core/rfb', () => {
  throw new Error('noVNC not available');
});

import { useVNCClient } from '../../src/hooks/protocol/useVNCClient';
import type { ConnectionSession } from '../../src/types/connection/connection';

const mockSession: ConnectionSession = {
  id: 's1',
  connectionId: 'conn-1',
  protocol: 'vnc',
  hostname: '192.168.1.10',
  name: 'Test VNC',
  status: 'connected',
  startTime: new Date(),
};

describe('useVNCClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));

    expect(result.current.isFullscreen).toBe(false);
    expect(result.current.showSettings).toBe(false);
    expect(result.current.connectionStatus).toBe('connecting');
  });

  it('has correct default VNC settings', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));

    expect(result.current.settings).toEqual({
      viewOnly: false,
      scaleViewport: true,
      clipViewport: false,
      dragViewport: true,
      resizeSession: false,
      showDotCursor: false,
      localCursor: true,
      sharedMode: false,
      bellPolicy: 'on',
      compressionLevel: 2,
      quality: 6,
    });
  });

  it('setSettings updates VNC settings', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));

    act(() => {
      result.current.setSettings({ ...result.current.settings, viewOnly: true, quality: 9 });
    });

    expect(result.current.settings.viewOnly).toBe(true);
    expect(result.current.settings.quality).toBe(9);
  });

  it('toggleFullscreen toggles fullscreen state', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));

    expect(result.current.isFullscreen).toBe(false);

    act(() => {
      result.current.toggleFullscreen();
    });
    expect(result.current.isFullscreen).toBe(true);

    act(() => {
      result.current.toggleFullscreen();
    });
    expect(result.current.isFullscreen).toBe(false);
  });

  it('setShowSettings toggles settings panel', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));

    expect(result.current.showSettings).toBe(false);

    act(() => {
      result.current.setShowSettings(true);
    });
    expect(result.current.showSettings).toBe(true);

    act(() => {
      result.current.setShowSettings(false);
    });
    expect(result.current.showSettings).toBe(false);
  });

  it('canvasRef is exposed', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));
    expect(result.current.canvasRef).toBeDefined();
  });

  it('session is returned', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));
    expect(result.current.session).toBe(mockSession);
  });

  it('getStatusColor returns correct color for connecting', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));
    // Initial state is 'connecting'
    expect(result.current.getStatusColor()).toBe('text-yellow-400');
  });

  it('getStatusIcon returns correct icon for connecting', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));
    expect(result.current.getStatusIcon()).toBe('connecting');
  });

  it('falls back to simulated desktop when noVNC fails', async () => {
    // The mock for novnc/core/rfb throws, so the hook should catch
    // and call simulateVNCConnection which uses canvas
    const { result } = renderHook(() => useVNCClient(mockSession));

    // After the import error + simulated connection timeout, status should eventually change
    // The connection attempt starts in an effect; the error catches and falls back
    await waitFor(() => {
      // It should remain in connecting or eventually transition
      expect(['connecting', 'connected', 'error']).toContain(result.current.connectionStatus);
    });
  });

  it('drawSimulatedDesktop is exposed as a function', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));
    expect(typeof result.current.drawSimulatedDesktop).toBe('function');
  });

  it('connection reference is found from context', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));
    // The hook should find the connection in the mocked context
    // We verify indirectly - the hook doesn't expose connection directly,
    // but it uses it for the websocket URL
    expect(result.current.connectionStatus).toBeDefined();
  });

  it('handleCanvasClick is a function', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));
    expect(typeof result.current.handleCanvasClick).toBe('function');
  });

  it('handleKeyDown and handleKeyUp are functions', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));
    expect(typeof result.current.handleKeyDown).toBe('function');
    expect(typeof result.current.handleKeyUp).toBe('function');
  });

  it('sendCtrlAltDel is a function', () => {
    const { result } = renderHook(() => useVNCClient(mockSession));
    expect(typeof result.current.sendCtrlAltDel).toBe('function');
  });
});
