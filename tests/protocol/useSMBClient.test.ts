import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback || key }),
}));

import { useSMBClient } from '../../src/hooks/protocol/useSMBClient';
import type { SMBFile } from '../../src/hooks/protocol/useSMBClient';
import type { ConnectionSession } from '../../src/types/connection/connection';

const mockSession: ConnectionSession = {
  id: 's1',
  connectionId: 'conn-1',
  protocol: 'smb',
  hostname: '192.168.1.100',
  name: 'Test SMB',
  status: 'connected',
  startTime: new Date(),
};

describe('useSMBClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  // Helper to flush mock timers through the setTimeout-based loading
  async function flushTimers() {
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
  }

  it('has correct initial state', () => {
    const { result } = renderHook(() => useSMBClient(mockSession));

    expect(result.current.currentPath).toBe('\\');
    expect(result.current.files).toEqual([]);
    expect(result.current.selectedFiles.size).toBe(0);
    expect(result.current.isLoading).toBe(true); // loading starts immediately from effects
    expect(result.current.shares).toEqual([]);
    expect(result.current.currentShare).toBe('');
  });

  it('loadShares populates shares and auto-selects first', async () => {
    const { result } = renderHook(() => useSMBClient(mockSession));

    await flushTimers();

    expect(result.current.shares).toEqual(['C$', 'D$', 'Users', 'Public', 'IPC$', 'ADMIN$']);
    expect(result.current.currentShare).toBe('C$');
  });

  it('loadDirectory populates files after share is set', async () => {
    const { result } = renderHook(() => useSMBClient(mockSession));

    // Flush loadShares (1000ms)
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });

    // Now currentShare is set which triggers loadDirectory effect (500ms)
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.files.length).toBe(5);
    expect(result.current.files[0].name).toBe('Windows');
    expect(result.current.files[3].name).toBe('config.ini');
  });

  it('navigateToPath updates path and clears selection', async () => {
    const { result } = renderHook(() => useSMBClient(mockSession));

    await flushTimers();

    act(() => {
      result.current.handleFileSelect('Windows');
    });
    expect(result.current.selectedFiles.has('Windows')).toBe(true);

    act(() => {
      result.current.navigateToPath('\\Windows');
    });

    expect(result.current.currentPath).toBe('\\Windows');
    expect(result.current.selectedFiles.size).toBe(0);
  });

  it('navigateUp goes to parent directory', async () => {
    const { result } = renderHook(() => useSMBClient(mockSession));

    await flushTimers();

    act(() => {
      result.current.navigateToPath('\\Windows\\System32');
    });

    act(() => {
      result.current.navigateUp();
    });

    expect(result.current.currentPath).toBe('\\Windows');
  });

  it('navigateUp at root stays at root', async () => {
    const { result } = renderHook(() => useSMBClient(mockSession));

    await flushTimers();

    act(() => {
      result.current.navigateUp();
    });

    expect(result.current.currentPath).toBe('\\');
  });

  it('handleFileSelect toggles file in selection set', async () => {
    const { result } = renderHook(() => useSMBClient(mockSession));

    await flushTimers();

    act(() => {
      result.current.handleFileSelect('config.ini');
    });
    expect(result.current.selectedFiles.has('config.ini')).toBe(true);

    act(() => {
      result.current.handleFileSelect('config.ini');
    });
    expect(result.current.selectedFiles.has('config.ini')).toBe(false);
  });

  it('handleFileSelect supports multiple selections', async () => {
    const { result } = renderHook(() => useSMBClient(mockSession));

    await flushTimers();

    act(() => {
      result.current.handleFileSelect('config.ini');
    });
    act(() => {
      result.current.handleFileSelect('system.log');
    });

    expect(result.current.selectedFiles.size).toBe(2);
    expect(result.current.selectedFiles.has('config.ini')).toBe(true);
    expect(result.current.selectedFiles.has('system.log')).toBe(true);
  });

  it('handleDoubleClick on directory navigates into it', async () => {
    const { result } = renderHook(() => useSMBClient(mockSession));

    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    const dirFile: SMBFile = { name: 'Windows', type: 'directory', size: 0, modified: new Date() };
    act(() => {
      result.current.handleDoubleClick(dirFile);
    });

    expect(result.current.currentPath).toBe('\\Windows');
  });

  it('handleDoubleClick on file does not navigate', async () => {
    const { result } = renderHook(() => useSMBClient(mockSession));

    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    const file: SMBFile = { name: 'config.ini', type: 'file', size: 2048, modified: new Date() };
    act(() => {
      result.current.handleDoubleClick(file);
    });

    expect(result.current.currentPath).toBe('\\');
  });

  it('selectAll selects all files', async () => {
    const { result } = renderHook(() => useSMBClient(mockSession));

    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.files.length).toBe(5);

    act(() => {
      result.current.selectAll();
    });

    expect(result.current.selectedFiles.size).toBe(5);
  });

  it('deselectAll clears selection', async () => {
    const { result } = renderHook(() => useSMBClient(mockSession));

    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.files.length).toBe(5);

    act(() => {
      result.current.selectAll();
    });
    expect(result.current.selectedFiles.size).toBe(5);

    act(() => {
      result.current.deselectAll();
    });
    expect(result.current.selectedFiles.size).toBe(0);
  });

  it('handleShareChange resets path to root', async () => {
    const { result } = renderHook(() => useSMBClient(mockSession));

    await flushTimers();

    act(() => {
      result.current.navigateToPath('\\Windows\\System32');
    });

    act(() => {
      result.current.handleShareChange('D$');
    });

    expect(result.current.currentShare).toBe('D$');
    expect(result.current.currentPath).toBe('\\');
  });

  it('formatFileSize formats 0 bytes', () => {
    const { result } = renderHook(() => useSMBClient(mockSession));
    expect(result.current.formatFileSize(0)).toBe('0 B');
  });

  it('formatFileSize formats bytes', () => {
    const { result } = renderHook(() => useSMBClient(mockSession));
    expect(result.current.formatFileSize(512)).toBe('512 B');
  });

  it('formatFileSize formats kilobytes', () => {
    const { result } = renderHook(() => useSMBClient(mockSession));
    expect(result.current.formatFileSize(2048)).toBe('2 KB');
  });

  it('formatFileSize formats megabytes', () => {
    const { result } = renderHook(() => useSMBClient(mockSession));
    expect(result.current.formatFileSize(1048576)).toBe('1 MB');
  });

  it('formatFileSize formats gigabytes', () => {
    const { result } = renderHook(() => useSMBClient(mockSession));
    expect(result.current.formatFileSize(1073741824)).toBe('1 GB');
  });
});

// afterAll needs to be imported
import { afterAll } from 'vitest';
