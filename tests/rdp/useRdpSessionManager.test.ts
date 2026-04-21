import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import {
  useRDPSessionManager,
  formatUptime,
  formatBytes,
  type RDPSessionInfo,
  type RDPStats,
} from '../../src/hooks/rdp/useRdpSessionManager';

// ── Helpers ───────────────────────────────────────────────────

function makeSession(overrides: Partial<RDPSessionInfo> = {}): RDPSessionInfo {
  return {
    id: 'sess-1',
    host: '10.0.0.1',
    port: 3389,
    username: 'admin',
    connected: true,
    desktop_width: 1920,
    desktop_height: 1080,
    ...overrides,
  };
}

function makeStats(overrides: Partial<RDPStats> = {}): RDPStats {
  return {
    session_id: 'sess-1',
    uptime_secs: 600,
    bytes_received: 1024,
    bytes_sent: 512,
    pdus_received: 100,
    pdus_sent: 80,
    frame_count: 300,
    fps: 30,
    input_events: 42,
    errors_recovered: 0,
    reactivations: 0,
    phase: 'active',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('useRDPSessionManager', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  // ── Initial state ──────────────────────────────────────────

  it('returns empty sessions and default state when not open', () => {
    const { result } = renderHook(() => useRDPSessionManager(false));
    expect(result.current.sessions).toEqual([]);
    expect(result.current.statsMap).toEqual({});
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe('');
    expect(result.current.autoRefresh).toBe(true);
    expect(result.current.totalTraffic).toBe(0);
  });

  // ── fetchData success ──────────────────────────────────────

  it('fetches sessions and stats when opened', async () => {
    const s1 = makeSession({ id: 'a' });
    const s2 = makeSession({ id: 'b', host: '10.0.0.2' });
    const st1 = makeStats({ session_id: 'a', bytes_received: 100, bytes_sent: 50 });
    const st2 = makeStats({ session_id: 'b', bytes_received: 200, bytes_sent: 100 });

    vi.mocked(invoke)
      .mockResolvedValueOnce([s1, s2]) // list_rdp_sessions
      .mockResolvedValueOnce(st1) // get_rdp_stats a
      .mockResolvedValueOnce(st2); // get_rdp_stats b

    const { result } = renderHook(() => useRDPSessionManager(true));

    // Wait for the initial fetch triggered by useEffect
    await vi.waitFor(() => {
      expect(result.current.sessions).toHaveLength(2);
    });

    expect(result.current.sessions[0].id).toBe('a');
    expect(result.current.sessions[1].id).toBe('b');
    expect(result.current.statsMap['a']).toEqual(st1);
    expect(result.current.statsMap['b']).toEqual(st2);
    expect(result.current.error).toBe('');
  });

  it('computes totalTraffic from statsMap', async () => {
    const s1 = makeSession({ id: 'x' });
    const st1 = makeStats({ session_id: 'x', bytes_received: 1000, bytes_sent: 500 });

    vi.mocked(invoke)
      .mockResolvedValueOnce([s1])
      .mockResolvedValueOnce(st1);

    const { result } = renderHook(() => useRDPSessionManager(true));

    await vi.waitFor(() => {
      expect(result.current.totalTraffic).toBe(1500);
    });
  });

  it('handles multiple sessions for totalTraffic', async () => {
    const s1 = makeSession({ id: 'a' });
    const s2 = makeSession({ id: 'b' });
    const st1 = makeStats({ session_id: 'a', bytes_received: 100, bytes_sent: 200 });
    const st2 = makeStats({ session_id: 'b', bytes_received: 300, bytes_sent: 400 });

    vi.mocked(invoke)
      .mockResolvedValueOnce([s1, s2])
      .mockResolvedValueOnce(st1)
      .mockResolvedValueOnce(st2);

    const { result } = renderHook(() => useRDPSessionManager(true));

    await vi.waitFor(() => {
      expect(result.current.totalTraffic).toBe(1000); // 100+200+300+400
    });
  });

  // ── fetchData error handling ───────────────────────────────

  it('sets error when list_rdp_sessions fails', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useRDPSessionManager(true));

    await vi.waitFor(() => {
      expect(result.current.error).toContain('Network error');
    });
    expect(result.current.sessions).toEqual([]);
  });

  it('tolerates individual stats fetch failures', async () => {
    const s1 = makeSession({ id: 'ok' });
    const s2 = makeSession({ id: 'fail' });

    vi.mocked(invoke)
      .mockResolvedValueOnce([s1, s2])
      .mockResolvedValueOnce(makeStats({ session_id: 'ok' }))
      .mockRejectedValueOnce(new Error('gone'));

    const { result } = renderHook(() => useRDPSessionManager(true));

    await vi.waitFor(() => {
      expect(result.current.sessions).toHaveLength(2);
    });
    expect(result.current.statsMap['ok']).toBeDefined();
    expect(result.current.statsMap['fail']).toBeUndefined();
    expect(result.current.error).toBe('');
  });

  // ── handleDisconnect ───────────────────────────────────────

  it('removes session from state on disconnect', async () => {
    const s1 = makeSession({ id: 'k1' });
    const s2 = makeSession({ id: 'k2' });

    vi.mocked(invoke)
      .mockResolvedValueOnce([s1, s2])
      .mockResolvedValueOnce(makeStats({ session_id: 'k1' }))
      .mockResolvedValueOnce(makeStats({ session_id: 'k2' }));

    const { result } = renderHook(() => useRDPSessionManager(true));

    await vi.waitFor(() => {
      expect(result.current.sessions).toHaveLength(2);
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined); // disconnect_rdp

    await act(async () => {
      await result.current.handleDisconnect('k1');
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].id).toBe('k2');
  });

  it('sets error when disconnect fails', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([makeSession({ id: 'x' })])
      .mockResolvedValueOnce(makeStats({ session_id: 'x' }));

    const { result } = renderHook(() => useRDPSessionManager(true));

    await vi.waitFor(() => expect(result.current.sessions).toHaveLength(1));

    vi.mocked(invoke).mockRejectedValueOnce(new Error('refused'));

    await act(async () => {
      await result.current.handleDisconnect('x');
    });

    expect(result.current.error).toContain('Disconnect failed');
  });

  // ── handleDetach ───────────────────────────────────────────

  it('calls detach and re-fetches sessions', async () => {
    const session = makeSession({ id: 'd1' });
    const stats = makeStats({ session_id: 'd1' });

    vi.mocked(invoke)
      .mockResolvedValueOnce([session]) // initial list
      .mockResolvedValueOnce(stats); // initial stats

    const { result } = renderHook(() => useRDPSessionManager(true));

    await vi.waitFor(() => expect(result.current.sessions).toHaveLength(1));

    // detach + re-fetch
    vi.mocked(invoke)
      .mockResolvedValueOnce(undefined) // detach_rdp_session
      .mockResolvedValueOnce([]) // re-fetch list
    ;

    await act(async () => {
      await result.current.handleDetach('d1');
    });

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('detach_rdp_session', { sessionId: 'd1' });
  });

  it('sets error when detach fails', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce([makeSession({ id: 'x' })])
      .mockResolvedValueOnce(makeStats({ session_id: 'x' }));

    const { result } = renderHook(() => useRDPSessionManager(true));

    await vi.waitFor(() => expect(result.current.sessions).toHaveLength(1));

    vi.mocked(invoke).mockRejectedValueOnce(new Error('detach fail'));

    await act(async () => {
      await result.current.handleDetach('x');
    });

    expect(result.current.error).toContain('Detach failed');
  });

  // ── handleDisconnectAll ────────────────────────────────────

  it('disconnects all sessions and clears state', async () => {
    const s1 = makeSession({ id: 'a' });
    const s2 = makeSession({ id: 'b' });

    vi.mocked(invoke)
      .mockResolvedValueOnce([s1, s2])
      .mockResolvedValueOnce(makeStats({ session_id: 'a' }))
      .mockResolvedValueOnce(makeStats({ session_id: 'b' }));

    const { result } = renderHook(() => useRDPSessionManager(true));

    await vi.waitFor(() => expect(result.current.sessions).toHaveLength(2));

    vi.mocked(invoke)
      .mockResolvedValueOnce(undefined) // disconnect a
      .mockResolvedValueOnce(undefined); // disconnect b

    await act(async () => {
      await result.current.handleDisconnectAll();
    });

    expect(result.current.sessions).toEqual([]);
    expect(result.current.statsMap).toEqual({});
  });

  it('clears state even if individual disconnects fail', async () => {
    const s1 = makeSession({ id: 'a' });

    vi.mocked(invoke)
      .mockResolvedValueOnce([s1])
      .mockResolvedValueOnce(makeStats({ session_id: 'a' }));

    const { result } = renderHook(() => useRDPSessionManager(true));

    await vi.waitFor(() => expect(result.current.sessions).toHaveLength(1));

    vi.mocked(invoke).mockRejectedValueOnce(new Error('best effort'));

    await act(async () => {
      await result.current.handleDisconnectAll();
    });

    expect(result.current.sessions).toEqual([]);
    expect(result.current.statsMap).toEqual({});
  });

  // ── clearError ─────────────────────────────────────────────

  it('clears the error state', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useRDPSessionManager(true));

    await vi.waitFor(() => expect(result.current.error).not.toBe(''));

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBe('');
  });

  // ── setAutoRefresh ─────────────────────────────────────────

  it('toggles autoRefresh', () => {
    const { result } = renderHook(() => useRDPSessionManager(false));
    expect(result.current.autoRefresh).toBe(true);

    act(() => {
      result.current.setAutoRefresh(false);
    });

    expect(result.current.autoRefresh).toBe(false);
  });

  // ── Auto-refresh timer ─────────────────────────────────────

  it('auto-refreshes every 3 seconds when isOpen is true', async () => {
    vi.useFakeTimers();

    // initial fetch
    vi.mocked(invoke).mockResolvedValue([]);

    const { result } = renderHook(() => useRDPSessionManager(true));

    // Wait for initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const callCountAfterInit = vi.mocked(invoke).mock.calls.length;

    // Advance 3 seconds — should trigger another fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(vi.mocked(invoke).mock.calls.length).toBeGreaterThan(callCountAfterInit);

    vi.useRealTimers();
  });

  it('does not auto-refresh when isOpen is false', async () => {
    vi.useFakeTimers();

    vi.mocked(invoke).mockResolvedValue([]);

    renderHook(() => useRDPSessionManager(false));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const callCount = vi.mocked(invoke).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    // No additional calls should have been made
    expect(vi.mocked(invoke).mock.calls.length).toBe(callCount);

    vi.useRealTimers();
  });

  it('does not call fetchData on interval when autoRefresh is false', async () => {
    vi.useFakeTimers();

    vi.mocked(invoke).mockResolvedValue([]);

    const { result } = renderHook(() => useRDPSessionManager(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      result.current.setAutoRefresh(false);
    });

    const callCount = vi.mocked(invoke).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    // No additional invoke calls since autoRefresh was turned off
    expect(vi.mocked(invoke).mock.calls.length).toBe(callCount);

    vi.useRealTimers();
  });

  // ── handleRefresh ──────────────────────────────────────────

  it('handleRefresh triggers fetchData', async () => {
    vi.mocked(invoke).mockResolvedValue([]);

    const { result } = renderHook(() => useRDPSessionManager(false));

    await act(async () => {
      result.current.handleRefresh();
    });

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('list_rdp_sessions');
  });
});

// ── Utility function tests ───────────────────────────────────

describe('formatUptime', () => {
  it('formats seconds only', () => {
    expect(formatUptime(45)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatUptime(125)).toBe('2m 5s');
  });

  it('formats hours, minutes and seconds', () => {
    expect(formatUptime(3661)).toBe('1h 1m 1s');
  });

  it('formats zero', () => {
    expect(formatUptime(0)).toBe('0s');
  });

  it('formats exactly one hour', () => {
    expect(formatUptime(3600)).toBe('1h 0m 0s');
  });

  it('handles large values', () => {
    expect(formatUptime(86400)).toBe('24h 0m 0s');
  });
});

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
  });

  it('formats fractional KB', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});
