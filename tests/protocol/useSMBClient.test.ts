import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSMBClient } from '../../src/hooks/protocol/useSMBClient';
import type { ConnectionSession } from '../../src/types/connection/connection';
import type { SMBFile } from '../../src/hooks/protocol/useSMBClient';

const makeSession = (overrides: Partial<ConnectionSession> = {}): ConnectionSession => ({
  id: 'sess-1',
  connectionId: 'conn-1',
  name: 'Test SMB',
  status: 'connected',
  startTime: new Date(),
  protocol: 'smb',
  hostname: '192.168.1.50',
  ...overrides,
});

describe('useSMBClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  const renderAndWaitForShares = async () => {
    const hook = renderHook(() => useSMBClient(makeSession()));
    // loadShares: 1000ms timeout
    await act(async () => { vi.advanceTimersByTime(1000); });
    // loadDirectory triggered by share change: 500ms timeout
    await act(async () => { vi.advanceTimersByTime(500); });
    return hook;
  };

  // ── Initial state & share loading ──────────────────────────────────────

  it('starts with root path and empty files', () => {
    const { result } = renderHook(() => useSMBClient(makeSession()));
    expect(result.current.currentPath).toBe('\\');
    expect(result.current.selectedFiles.size).toBe(0);
  });

  it('loads shares on mount', async () => {
    const { result } = await renderAndWaitForShares();
    expect(result.current.shares.length).toBeGreaterThan(0);
    expect(result.current.shares).toContain('C$');
    expect(result.current.currentShare).toBe('C$');
  });

  it('loads directory files after shares are loaded', async () => {
    const { result } = await renderAndWaitForShares();
    expect(result.current.files.length).toBeGreaterThan(0);
    expect(result.current.files.some(f => f.name === 'Windows')).toBe(true);
  });

  // ── Navigation ─────────────────────────────────────────────────────────

  it('navigateToPath updates currentPath and clears selection', async () => {
    const { result } = await renderAndWaitForShares();

    act(() => { result.current.handleFileSelect('config.ini'); });
    expect(result.current.selectedFiles.has('config.ini')).toBe(true);

    act(() => { result.current.navigateToPath('\\Users'); });
    expect(result.current.currentPath).toBe('\\Users');
    expect(result.current.selectedFiles.size).toBe(0);
  });

  it('navigateUp moves to parent directory', async () => {
    const { result } = await renderAndWaitForShares();

    act(() => { result.current.navigateToPath('\\Users\\Admin'); });
    expect(result.current.currentPath).toBe('\\Users\\Admin');

    act(() => { result.current.navigateUp(); });
    expect(result.current.currentPath).toBe('\\Users');

    act(() => { result.current.navigateUp(); });
    expect(result.current.currentPath).toBe('\\');
  });

  it('navigateUp does nothing at root', async () => {
    const { result } = await renderAndWaitForShares();
    expect(result.current.currentPath).toBe('\\');

    act(() => { result.current.navigateUp(); });
    expect(result.current.currentPath).toBe('\\');
  });

  it('handleDoubleClick navigates into directories', async () => {
    const { result } = await renderAndWaitForShares();

    const dir: SMBFile = { name: 'Windows', type: 'directory', size: 0, modified: new Date() };
    act(() => { result.current.handleDoubleClick(dir); });
    expect(result.current.currentPath).toBe('\\Windows');

    const sub: SMBFile = { name: 'System32', type: 'directory', size: 0, modified: new Date() };
    act(() => { result.current.handleDoubleClick(sub); });
    expect(result.current.currentPath).toBe('\\Windows\\System32');
  });

  it('handleDoubleClick does not navigate for files', async () => {
    const { result } = await renderAndWaitForShares();

    const file: SMBFile = { name: 'readme.txt', type: 'file', size: 100, modified: new Date() };
    act(() => { result.current.handleDoubleClick(file); });
    expect(result.current.currentPath).toBe('\\');
  });

  // ── File selection ─────────────────────────────────────────────────────

  it('handleFileSelect toggles individual file selection', async () => {
    const { result } = await renderAndWaitForShares();

    act(() => { result.current.handleFileSelect('config.ini'); });
    expect(result.current.selectedFiles.has('config.ini')).toBe(true);

    act(() => { result.current.handleFileSelect('config.ini'); });
    expect(result.current.selectedFiles.has('config.ini')).toBe(false);
  });

  it('selectAll selects all files, deselectAll clears', async () => {
    const { result } = await renderAndWaitForShares();

    act(() => { result.current.selectAll(); });
    expect(result.current.selectedFiles.size).toBe(result.current.files.length);

    act(() => { result.current.deselectAll(); });
    expect(result.current.selectedFiles.size).toBe(0);
  });

  // ── Share change ───────────────────────────────────────────────────────

  it('handleShareChange updates share and resets path', async () => {
    const { result } = await renderAndWaitForShares();

    act(() => { result.current.navigateToPath('\\Users'); });
    expect(result.current.currentPath).toBe('\\Users');

    act(() => { result.current.handleShareChange('D$'); });
    expect(result.current.currentShare).toBe('D$');
    expect(result.current.currentPath).toBe('\\');
  });

  // ── formatFileSize ─────────────────────────────────────────────────────

  it('formats file sizes correctly', async () => {
    const { result } = await renderAndWaitForShares();

    expect(result.current.formatFileSize(0)).toBe('0 B');
    expect(result.current.formatFileSize(512)).toBe('512 B');
    expect(result.current.formatFileSize(1024)).toBe('1 KB');
    expect(result.current.formatFileSize(1048576)).toBe('1 MB');
    expect(result.current.formatFileSize(1073741824)).toBe('1 GB');
    expect(result.current.formatFileSize(2048)).toBe('2 KB');
  });

  // ── Refresh ────────────────────────────────────────────────────────────

  it('refreshDirectory reloads the current directory', async () => {
    const { result } = await renderAndWaitForShares();

    await act(async () => {
      result.current.refreshDirectory();
      vi.advanceTimersByTime(500);
    });

    expect(result.current.files.length).toBeGreaterThan(0);
  });
});
