import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSessionDetach } from '../../src/hooks/session/useSessionDetach';
import { invoke } from '@tauri-apps/api/core';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

const mockListen = vi.fn().mockResolvedValue(vi.fn());
const mockEmit = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: any[]) => mockListen(...args),
  emit: (...args: any[]) => mockEmit(...args),
}));

const mockSetFocus = vi.fn().mockResolvedValue(undefined);
const mockOnce = vi.fn((_, cb) => cb());

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: Object.assign(
    vi.fn().mockImplementation(() => ({
      once: mockOnce,
      setFocus: mockSetFocus,
    })),
    { getByLabel: vi.fn().mockResolvedValue(null) },
  ),
}));

vi.mock('@tauri-apps/api/window', () => ({
  availableMonitors: vi.fn().mockResolvedValue([]),
  currentMonitor: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/components/windows/WindowsToolPanel', () => ({
  isWinmgmtProtocol: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/utils/core/id', () => ({
  generateId: vi.fn().mockReturnValue('new-id'),
}));

// ── Test data ──────────────────────────────────────────────────────

const sessions = [
  {
    id: 's1',
    connectionId: 'c1',
    protocol: 'ssh',
    name: 'SSH Server',
    status: 'connected',
    backendSessionId: 'b1',
    hostname: 'host1',
    startTime: new Date(),
    reconnectAttempts: 0,
    maxReconnectAttempts: 3,
  },
  {
    id: 's2',
    connectionId: 'c2',
    protocol: 'rdp',
    name: 'RDP Server',
    status: 'connected',
    backendSessionId: 'b2',
    hostname: 'host2',
    startTime: new Date(),
    reconnectAttempts: 0,
    maxReconnectAttempts: 3,
  },
];

const connections = [
  { id: 'c1', name: 'SSH Server', hostname: 'host1', port: 22, protocol: 'ssh' },
  { id: 'c2', name: 'RDP Server', hostname: 'host2', port: 3389, protocol: 'rdp' },
];

function renderDetach(overrides: Record<string, any> = {}) {
  const dispatch = vi.fn();
  const setActiveSessionId = vi.fn();
  const registerWindow = vi.fn();

  const opts = {
    sessions,
    connections,
    visibleSessions: sessions,
    activeSessionId: 's1',
    dispatch,
    setActiveSessionId,
    registerWindow,
    ...overrides,
  };

  const hook = renderHook(() =>
    useSessionDetach(
      opts.sessions,
      opts.connections,
      opts.visibleSessions,
      opts.activeSessionId,
      opts.dispatch,
      opts.setActiveSessionId,
      opts.registerWindow,
    ),
  );

  return { ...hook, dispatch, setActiveSessionId, registerWindow };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('useSessionDetach', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Simulate Tauri environment
    (window as any).__TAURI_INTERNALS__ = true;
    // Default: invoke resolves successfully
    (invoke as Mock).mockResolvedValue(undefined);
    // Default: listen fires the callback immediately with empty buffer
    mockListen.mockImplementation((_event: string, cb: any) => {
      // Don't call the callback automatically for terminal-buffer-response
      // to simulate timeout / natural flow
      return Promise.resolve(vi.fn());
    });
  });

  it('returns handleSessionDetach and handleReattachRdpSession', () => {
    const { result } = renderDetach();
    expect(typeof result.current.handleSessionDetach).toBe('function');
    expect(typeof result.current.handleReattachRdpSession).toBe('function');
  });

  it('does nothing when session ID is not found', async () => {
    const { result, dispatch } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach('no-such-id');
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('saves session payload to localStorage on detach', async () => {
    const { result } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach('s1');
    });
    const stored = localStorage.getItem('detached-session-s1');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.session.id).toBe('s1');
    expect(parsed.connection).toBeDefined();
    expect(parsed.savedAt).toBeDefined();
  });

  it('dispatches UPDATE_SESSION with isDetached=true', async () => {
    const { result, dispatch } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach('s1');
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_SESSION',
        payload: expect.objectContaining({
          id: 's1',
          layout: expect.objectContaining({ isDetached: true }),
        }),
      }),
    );
  });

  it('switches active session to next visible session on detach', async () => {
    const { result, setActiveSessionId } = renderDetach({ activeSessionId: 's1' });
    await act(async () => {
      await result.current.handleSessionDetach('s1');
    });
    // Since s1 was active and is being detached, it should switch to s2
    expect(setActiveSessionId).toHaveBeenCalledWith('s2');
  });

  it('does not switch active session when detaching a non-active session', async () => {
    const { result, setActiveSessionId } = renderDetach({ activeSessionId: 's2' });
    await act(async () => {
      await result.current.handleSessionDetach('s1');
    });
    // setActiveSessionId should not be called since s1 was not the active session
    expect(setActiveSessionId).not.toHaveBeenCalled();
  });

  it('calls invoke(detach_rdp_session) for RDP sessions before opening window', async () => {
    const { result } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach('s2');
    });
    expect(invoke).toHaveBeenCalledWith('detach_rdp_session', { connectionId: 'c2' });
  });

  it('does not call detach_rdp_session for SSH sessions', async () => {
    const { result } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach('s1');
    });
    expect(invoke).not.toHaveBeenCalledWith('detach_rdp_session', expect.anything());
  });

  it('emits request-terminal-buffer for SSH sessions', async () => {
    const { result } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach('s1');
    });
    expect(mockEmit).toHaveBeenCalledWith('request-terminal-buffer', { sessionId: 's1' });
  });

  it('does not emit request-terminal-buffer for RDP sessions', async () => {
    const { result } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach('s2');
    });
    expect(mockEmit).not.toHaveBeenCalledWith('request-terminal-buffer', expect.anything());
  });

  it('calls registerWindow when creating a new Tauri window', async () => {
    const { result, registerWindow } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach('s1');
    });
    expect(registerWindow).toHaveBeenCalledWith('detached-s1', ['s1']);
  });

  // ── handleReattachRdpSession ──────────────────────────────────

  it('reattachRdpSession activates existing session by backendSessionId', () => {
    const { result, setActiveSessionId } = renderDetach();
    act(() => {
      result.current.handleReattachRdpSession('b2', 'c2');
    });
    expect(setActiveSessionId).toHaveBeenCalledWith('s2');
  });

  it('reattachRdpSession creates new session when none exists', () => {
    const { result, dispatch, setActiveSessionId } = renderDetach();
    act(() => {
      result.current.handleReattachRdpSession('new-backend', 'c1');
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_SESSION',
        payload: expect.objectContaining({
          id: 'new-id',
          backendSessionId: 'new-backend',
          protocol: 'rdp',
          status: 'connecting',
        }),
      }),
    );
    expect(setActiveSessionId).toHaveBeenCalledWith('new-id');
  });

  it('continutes gracefully when detach_rdp_session fails', async () => {
    (invoke as Mock).mockRejectedValueOnce(new Error('backend error'));
    const { result, dispatch } = renderDetach();
    await act(async () => {
      await result.current.handleSessionDetach('s2');
    });
    // Should still dispatch UPDATE_SESSION despite the invoke error
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_SESSION' }),
    );
  });
});
