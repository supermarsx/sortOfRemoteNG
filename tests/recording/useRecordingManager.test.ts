import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRecordingManager } from '../../src/hooks/recording/useRecordingManager';

// ── Service mock ───────────────────────────────────────────────────

const mockSshRecordings = [
  {
    id: 'ssh1',
    name: 'SSH Session 1',
    description: 'Deployment session',
    recording: {
      metadata: {
        session_id: 'sess1',
        start_time: '2025-01-01T00:00:00Z',
        end_time: '2025-01-01T00:05:00Z',
        host: 'server1.example.com',
        username: 'admin',
        cols: 80,
        rows: 24,
        duration_ms: 300000,
        entry_count: 100,
      },
      entries: [],
    },
    savedAt: '2025-01-01T00:06:00Z',
    tags: ['prod'],
  },
  {
    id: 'ssh2',
    name: 'SSH Session 2',
    recording: {
      metadata: {
        session_id: 'sess2',
        start_time: '2025-02-01T00:00:00Z',
        end_time: '2025-02-01T00:02:00Z',
        host: 'server2.example.com',
        username: 'root',
        cols: 120,
        rows: 40,
        duration_ms: 120000,
        entry_count: 50,
      },
      entries: [],
    },
    savedAt: '2025-02-01T00:03:00Z',
    tags: ['staging'],
  },
];

const mockRdpRecordings = [
  {
    id: 'rdp1',
    name: 'RDP Session 1',
    connectionName: 'Production RDP',
    host: 'rdp-host.example.com',
    durationMs: 600000,
    sizeBytes: 5242880,
    format: 'webm',
    width: 1920,
    height: 1080,
    data: 'base64data',
    savedAt: '2025-01-15T00:00:00Z',
    tags: ['rdp-prod'],
  },
];

const mockWebRecordings = [
  {
    id: 'web1',
    name: 'Web Session 1',
    host: 'api.example.com',
    connectionName: 'API Monitor',
    recording: {
      metadata: {
        session_id: 'ws1',
        start_time: '2025-03-01T00:00:00Z',
        end_time: '2025-03-01T00:01:00Z',
        host: 'api.example.com',
        target_url: 'https://api.example.com/v1/health',
        duration_ms: 60000,
        entry_count: 10,
        total_bytes_transferred: 1024,
      },
      entries: [],
    },
    savedAt: '2025-03-01T00:02:00Z',
  },
];

const mockWebVideoRecordings = [
  {
    id: 'wv1',
    name: 'Web Video 1',
    host: 'app.example.com',
    connectionName: 'App Dashboard',
    durationMs: 30000,
    sizeBytes: 2097152,
    format: 'webm',
    data: 'base64data',
    savedAt: '2025-04-01T00:00:00Z',
  },
];

vi.mock('../../src/utils/recording/macroService', () => ({
  loadRecordings: vi.fn(),
  loadRdpRecordings: vi.fn(),
  loadWebRecordings: vi.fn(),
  loadWebVideoRecordings: vi.fn(),
  saveRecording: vi.fn(),
  deleteRecording: vi.fn(),
  saveRecordings: vi.fn(),
  exportRecording: vi.fn().mockResolvedValue('exported-data'),
  saveRdpRecording: vi.fn(),
  deleteRdpRecording: vi.fn(),
  saveRdpRecordings: vi.fn(),
  rdpRecordingToBlob: vi.fn().mockReturnValue(new Blob(['test'])),
  saveWebRecording: vi.fn(),
  deleteWebRecording: vi.fn(),
  saveWebRecordings: vi.fn(),
  exportWebRecording: vi.fn().mockResolvedValue('{"log":{}}'),
  saveWebVideoRecording: vi.fn(),
  deleteWebVideoRecording: vi.fn(),
  saveWebVideoRecordings: vi.fn(),
  webVideoRecordingToBlob: vi.fn().mockReturnValue(new Blob(['video'])),
}));

import * as macroService from '../../src/utils/recording/macroService';

// ── Tests ──────────────────────────────────────────────────────────

describe('useRecordingManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (macroService.loadRecordings as Mock).mockResolvedValue([...mockSshRecordings]);
    (macroService.loadRdpRecordings as Mock).mockResolvedValue([...mockRdpRecordings]);
    (macroService.loadWebRecordings as Mock).mockResolvedValue([...mockWebRecordings]);
    (macroService.loadWebVideoRecordings as Mock).mockResolvedValue([...mockWebVideoRecordings]);
  });

  it('loads all recording types when isOpen is true', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => {
      expect(result.current.sshRecordings).toHaveLength(2);
      expect(result.current.rdpRecordings).toHaveLength(1);
      expect(result.current.webRecordings).toHaveLength(1);
      expect(result.current.webVideoRecordings).toHaveLength(1);
    });
  });

  it('does not load when isOpen is false', () => {
    renderHook(() => useRecordingManager(false));
    expect(macroService.loadRecordings).not.toHaveBeenCalled();
  });

  it('defaults to ssh tab', () => {
    const { result } = renderHook(() => useRecordingManager(true));
    expect(result.current.activeTab).toBe('ssh');
  });

  it('switchTab updates activeTab and clears expandedId', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => expect(result.current.sshRecordings).toHaveLength(2));
    act(() => result.current.setExpandedId('ssh1'));
    expect(result.current.expandedId).toBe('ssh1');
    act(() => result.current.switchTab('rdp'));
    expect(result.current.activeTab).toBe('rdp');
    expect(result.current.expandedId).toBeNull();
  });

  it('filters SSH recordings by search query', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => expect(result.current.sshRecordings).toHaveLength(2));
    act(() => result.current.setSearchQuery('server1'));
    expect(result.current.filteredSsh).toHaveLength(1);
    expect(result.current.filteredSsh[0].id).toBe('ssh1');
  });

  it('filters RDP recordings by connection name', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => expect(result.current.rdpRecordings).toHaveLength(1));
    act(() => result.current.setSearchQuery('Production'));
    expect(result.current.filteredRdp).toHaveLength(1);
  });

  it('filters web recordings by URL', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => expect(result.current.webRecordings).toHaveLength(1));
    act(() => result.current.setSearchQuery('health'));
    expect(result.current.filteredWeb).toHaveLength(1);
  });

  it('returns all recordings when search is empty', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => expect(result.current.sshRecordings).toHaveLength(2));
    expect(result.current.filteredSsh).toHaveLength(2);
    expect(result.current.filteredRdp).toHaveLength(1);
  });

  it('calculates SSH total duration correctly', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => expect(result.current.sshRecordings).toHaveLength(2));
    expect(result.current.sshTotalDuration).toBe(300000 + 120000);
  });

  it('calculates RDP total size and duration', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => expect(result.current.rdpRecordings).toHaveLength(1));
    expect(result.current.rdpTotalSize).toBe(5242880);
    expect(result.current.rdpTotalDuration).toBe(600000);
  });

  it('handleDeleteSsh calls service and reloads', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => expect(result.current.sshRecordings).toHaveLength(2));
    await act(async () => {
      await result.current.handleDeleteSsh('ssh1');
    });
    expect(macroService.deleteRecording).toHaveBeenCalledWith('ssh1');
    expect(macroService.loadRecordings).toHaveBeenCalledTimes(2);
  });

  it('handleRenameSsh updates recording name', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => expect(result.current.sshRecordings).toHaveLength(2));
    const rec = { ...mockSshRecordings[0] };
    await act(async () => {
      await result.current.handleRenameSsh(rec as any, 'Renamed SSH');
    });
    expect(macroService.saveRecording).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed SSH' }),
    );
  });

  it('handleDeleteAllSsh clears all SSH recordings', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => expect(result.current.sshRecordings).toHaveLength(2));
    await act(async () => {
      await result.current.handleDeleteAllSsh();
    });
    expect(macroService.saveRecordings).toHaveBeenCalledWith([]);
  });

  it('handleDeleteRdp removes RDP recording', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => expect(result.current.rdpRecordings).toHaveLength(1));
    await act(async () => {
      await result.current.handleDeleteRdp('rdp1');
    });
    expect(macroService.deleteRdpRecording).toHaveBeenCalledWith('rdp1');
  });

  it('search returning no results gives empty filtered arrays', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => expect(result.current.sshRecordings).toHaveLength(2));
    act(() => result.current.setSearchQuery('zzz_no_match'));
    expect(result.current.filteredSsh).toHaveLength(0);
    expect(result.current.filteredRdp).toHaveLength(0);
    expect(result.current.filteredWeb).toHaveLength(0);
    expect(result.current.filteredWebVideo).toHaveLength(0);
  });

  it('filters SSH recordings by tag', async () => {
    const { result } = renderHook(() => useRecordingManager(true));
    await waitFor(() => expect(result.current.sshRecordings).toHaveLength(2));
    act(() => result.current.setSearchQuery('staging'));
    expect(result.current.filteredSsh).toHaveLength(1);
    expect(result.current.filteredSsh[0].id).toBe('ssh2');
  });
});
