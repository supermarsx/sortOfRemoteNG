import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback || key }),
}));

const mockDispatch = vi.fn();

const defaultConnection = {
  id: 'conn-1',
  name: 'Test HTTP',
  hostname: 'example.com',
  port: 443,
  protocol: 'https',
  username: 'admin',
  password: 'secret',
  authType: 'basic',
  basicAuthUsername: 'admin',
  basicAuthPassword: 'secret',
  httpVerifySsl: true,
  isGroup: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

let mockConnection = { ...defaultConnection };

vi.mock('../../src/contexts/useConnections', () => ({
  useConnections: vi.fn(() => ({
    state: { connections: [mockConnection] },
    dispatch: mockDispatch,
  })),
}));

vi.mock('../../src/contexts/SettingsContext', () => ({
  useSettings: vi.fn().mockReturnValue({ settings: {} }),
}));

import { useHTTPViewer } from '../../src/hooks/protocol/useHTTPViewer';
import type { ConnectionSession } from '../../src/types/connection/connection';

const mockInvoke = vi.mocked(invoke);

const mockSession: ConnectionSession = {
  id: 's1',
  connectionId: 'conn-1',
  protocol: 'https',
  hostname: 'example.com',
  name: 'Test HTTP',
  status: 'connected',
  startTime: new Date(),
};

function setupInvokeMock() {
  mockInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case 'start_basic_auth_proxy':
        return { local_port: 8080, session_id: 'ps1', proxy_url: 'http://localhost:8080' };
      case 'stop_basic_auth_proxy':
        return undefined;
      default:
        return undefined;
    }
  });
}

describe('useHTTPViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnection = { ...defaultConnection };
    setupInvokeMock();
  });

  it('has correct initial connection reference', () => {
    const { result } = renderHook(() => useHTTPViewer(mockSession));
    expect(result.current.connection).toBeDefined();
    expect(result.current.connection?.hostname).toBe('example.com');
  });

  it('buildTargetUrl builds https URL with default port omitted', () => {
    const { result } = renderHook(() => useHTTPViewer(mockSession));
    const url = result.current.buildTargetUrl();
    expect(url).toBe('https://example.com');
  });

  it('buildTargetUrl includes non-default port', () => {
    mockConnection = { ...defaultConnection, port: 8443 };

    const { result } = renderHook(() => useHTTPViewer(mockSession));
    const url = result.current.buildTargetUrl();
    expect(url).toBe('https://example.com:8443');
  });

  it('resolveCredentials returns basic auth credentials', () => {
    const { result } = renderHook(() => useHTTPViewer(mockSession));
    const creds = result.current.resolveCredentials();
    expect(creds).toEqual({ username: 'admin', password: 'secret' });
  });

  it('resolveCredentials returns null when no credentials configured', () => {
    mockConnection = {
      ...defaultConnection,
      authType: undefined as any,
      basicAuthUsername: undefined as any,
      basicAuthPassword: undefined as any,
      username: undefined as any,
      password: undefined as any,
    };

    const { result } = renderHook(() => useHTTPViewer(mockSession));
    const creds = result.current.resolveCredentials();
    expect(creds).toBeNull();
  });

  it('initProxy starts proxy when credentials are present', async () => {
    const { result } = renderHook(() => useHTTPViewer(mockSession));

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });

    expect(mockInvoke).toHaveBeenCalledWith('start_basic_auth_proxy', expect.objectContaining({
      config: expect.objectContaining({
        username: 'admin',
        password: 'secret',
      }),
    }));
    expect(result.current.proxyUrl).toBe('http://localhost:8080');
    expect(result.current.proxySessionId).toBe('ps1');
  });

  it('initProxy sets target URL directly when no credentials', async () => {
    mockConnection = {
      ...defaultConnection,
      port: 80,
      authType: undefined as any,
      basicAuthUsername: undefined as any,
      basicAuthPassword: undefined as any,
      username: undefined as any,
      password: undefined as any,
    };

    const httpSession = { ...mockSession, protocol: 'http' };
    const { result } = renderHook(() => useHTTPViewer(httpSession));

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });

    expect(mockInvoke).not.toHaveBeenCalledWith('start_basic_auth_proxy', expect.any(Object));
    expect(result.current.proxyUrl).toBe('http://example.com');
  });

  it('initProxy sets error on failure', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'start_basic_auth_proxy') throw new Error('Proxy failed');
      return undefined;
    });

    const { result } = renderHook(() => useHTTPViewer(mockSession));

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.error).toBe('Proxy failed');
  });

  it('navigation: goBack at start does not change index', async () => {
    const { result } = renderHook(() => useHTTPViewer(mockSession));

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });

    expect(result.current.history.length).toBeGreaterThanOrEqual(1);
    expect(result.current.historyIndex).toBe(0);

    act(() => {
      result.current.goBack();
    });
    expect(result.current.historyIndex).toBe(0);
  });

  it('isSecure is true for https connections', async () => {
    const { result } = renderHook(() => useHTTPViewer(mockSession));

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });

    expect(result.current.isSecure).toBe(true);
  });

  it('cleanup stops proxy on unmount', async () => {
    const { result, unmount } = renderHook(() => useHTTPViewer(mockSession));

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });

    expect(result.current.proxySessionId).toBe('ps1');

    unmount();

    expect(mockInvoke).toHaveBeenCalledWith('stop_basic_auth_proxy', { sessionId: 'ps1' });
  });

  it('toggleFullscreen toggles state', () => {
    const { result } = renderHook(() => useHTTPViewer(mockSession));

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

  it('showSettings can be toggled', () => {
    const { result } = renderHook(() => useHTTPViewer(mockSession));

    expect(result.current.showSettings).toBe(false);

    act(() => {
      result.current.setShowSettings(true);
    });
    expect(result.current.showSettings).toBe(true);
  });
});
