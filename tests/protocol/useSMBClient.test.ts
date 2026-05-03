import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Connection, ConnectionSession } from '../../src/types/connection/connection';

// ── Tauri `invoke` mock ────────────────────────────────────────────────────
//
// The real hook calls `invoke("smb_*", …)`. We stub that entirely so the
// test exercises pure state/navigation logic without hitting a backend.

type InvokeArgs = Record<string, unknown> | undefined;
type InvokeFn = (cmd: string, args?: InvokeArgs) => Promise<unknown>;

const { connectionsState } = vi.hoisted(() => ({
  connectionsState: { connections: [] as any[] },
}));

let invokeMock: InvokeFn;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: InvokeArgs) => invokeMock(cmd, args),
}));

vi.mock('../../src/contexts/useConnections', () => ({
  useConnections: () => ({ state: connectionsState }),
}));

import {
  useSMBClient,
  type SmbDirEntry,
  type SmbShareInfo,
  type SmbSessionInfo,
} from '../../src/hooks/protocol/useSMBClient';

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

const makeConnection = (overrides: Partial<Connection> = {}): Connection => ({
  id: 'conn-1',
  name: 'Test SMB',
  protocol: 'smb',
  hostname: '192.168.1.50',
  port: 445,
  isGroup: false,
  createdAt: '2026-04-29T00:00:00.000Z',
  updatedAt: '2026-04-29T00:00:00.000Z',
  ...overrides,
});

const mockShares: SmbShareInfo[] = [
  { name: 'C$', shareType: 'disk', comment: 'Default share', isAdmin: true },
  { name: 'D$', shareType: 'disk', comment: null, isAdmin: true },
  { name: 'Users', shareType: 'disk', comment: null, isAdmin: false },
  { name: 'IPC$', shareType: 'ipc', comment: 'Remote IPC', isAdmin: true },
];

const mockFiles: SmbDirEntry[] = [
  {
    name: 'Windows',
    path: '/Windows',
    entryType: 'directory',
    size: 0,
    modified: Date.now(),
    isHidden: false,
    isReadonly: false,
    isSystem: true,
  },
  {
    name: 'Users',
    path: '/Users',
    entryType: 'directory',
    size: 0,
    modified: Date.now(),
    isHidden: false,
    isReadonly: false,
    isSystem: false,
  },
  {
    name: 'config.ini',
    path: '/config.ini',
    entryType: 'file',
    size: 2048,
    modified: Date.now(),
    isHidden: false,
    isReadonly: false,
    isSystem: false,
  },
];

const mockSessionInfo: SmbSessionInfo = {
  id: 'smb-sess-aaa',
  host: '192.168.1.50',
  port: 445,
  domain: null,
  username: null,
  share: null,
  connected: true,
  label: null,
  connectedAt: new Date().toISOString(),
  lastActivity: new Date().toISOString(),
  backend: 'unix-smbclient',
};

const defaultInvoke: InvokeFn = async (cmd: string, _args?: InvokeArgs) => {
  switch (cmd) {
    case 'smb_connect':
      return mockSessionInfo;
    case 'smb_list_shares':
      return mockShares;
    case 'smb_list_directory':
      return mockFiles;
    case 'smb_disconnect':
    case 'smb_delete_file':
    case 'smb_rmdir':
    case 'smb_mkdir':
    case 'smb_rename':
      return null;
    default:
      throw new Error(`unmocked invoke: ${cmd}`);
  }
};

async function flushHookEffects(cycles = 4) {
  await act(async () => {
    for (let index = 0; index < cycles; index += 1) {
      await Promise.resolve();
    }
  });
}

async function actAndFlush(action: () => void, cycles = 4) {
  await act(async () => {
    action();
    for (let index = 0; index < cycles; index += 1) {
      await Promise.resolve();
    }
  });
}

async function renderSMBClient(
  sessionOverrides: Partial<ConnectionSession> = {},
) {
  const rendered = renderHook(() => useSMBClient(makeSession(sessionOverrides)));
  await flushHookEffects();
  return rendered;
}

describe('useSMBClient', () => {
  beforeEach(() => {
    invokeMock = vi.fn(defaultInvoke);
    connectionsState.connections = [makeConnection()];
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // ── Initial state & share loading ──────────────────────────────────────

  it('starts with root path and empty files/selection', async () => {
    const { result } = await renderSMBClient();
    expect(result.current.currentPath).toBe('/');
    expect(result.current.selectedFiles.size).toBe(0);
  });

  it('loads shares on mount via invoke("smb_connect") then invoke("smb_list_shares")', async () => {
    const { result } = await renderSMBClient();
    await waitFor(() => {
      expect(result.current.shares.length).toBeGreaterThan(0);
    });
    expect(result.current.shares.map(s => s.name)).toContain('C$');
    // first non-IPC non-admin is 'Users'.
    expect(result.current.currentShare).toBe('Users');
  });

  it('loads directory files after shares are loaded', async () => {
    const { result } = await renderSMBClient();
    await waitFor(() => {
      expect(result.current.files.length).toBeGreaterThan(0);
    });
    expect(result.current.files.some(f => f.name === 'Windows')).toBe(true);
  });

  it('passes the saved SMB connection config to smb_connect and prefers the configured share', async () => {
    connectionsState.connections = [
      makeConnection({
        port: 1445,
        username: 'alice',
        password: 'secret',
        domain: 'WORK',
        workgroup: 'WG',
        shareName: 'D$',
      }),
    ];

    const { result } = await renderSMBClient();

    await waitFor(() => {
      expect(result.current.shares.length).toBeGreaterThan(0);
    });

    expect(invokeMock).toHaveBeenCalledWith('smb_connect', {
      config: expect.objectContaining({
        host: '192.168.1.50',
        port: 1445,
        username: 'alice',
        password: 'secret',
        domain: 'WORK',
        workgroup: 'WG',
        share: 'D$',
        label: 'Test SMB',
      }),
    });
    expect(result.current.currentShare).toBe('D$');
  });

  // ── Navigation ─────────────────────────────────────────────────────────

  it('navigateToPath updates currentPath and clears selection', async () => {
    const { result } = await renderSMBClient();
    await waitFor(() => expect(result.current.shares.length).toBeGreaterThan(0));

    act(() => { result.current.handleFileSelect('config.ini'); });
    expect(result.current.selectedFiles.has('config.ini')).toBe(true);

    await actAndFlush(() => { result.current.navigateToPath('/Users'); });
    expect(result.current.currentPath).toBe('/Users');
    expect(result.current.selectedFiles.size).toBe(0);
  });

  it('navigateUp moves to parent directory', async () => {
    const { result } = await renderSMBClient();
    await waitFor(() => expect(result.current.shares.length).toBeGreaterThan(0));

    await actAndFlush(() => { result.current.navigateToPath('/Users/Admin'); });
    expect(result.current.currentPath).toBe('/Users/Admin');

    await actAndFlush(() => { result.current.navigateUp(); });
    expect(result.current.currentPath).toBe('/Users');

    await actAndFlush(() => { result.current.navigateUp(); });
    expect(result.current.currentPath).toBe('/');
  });

  it('navigateUp does nothing at root', async () => {
    const { result } = await renderSMBClient();
    await waitFor(() => expect(result.current.shares.length).toBeGreaterThan(0));
    expect(result.current.currentPath).toBe('/');
    await actAndFlush(() => { result.current.navigateUp(); });
    expect(result.current.currentPath).toBe('/');
  });

  it('handleDoubleClick navigates into directories', async () => {
    const { result } = await renderSMBClient();
    await waitFor(() => expect(result.current.files.length).toBeGreaterThan(0));

    const dir = result.current.files.find(f => f.name === 'Windows')!;
    await actAndFlush(() => { result.current.handleDoubleClick(dir); });
    expect(result.current.currentPath).toBe('/Windows');
  });

  it('handleDoubleClick does not navigate for files', async () => {
    const { result } = await renderSMBClient();
    await waitFor(() => expect(result.current.files.length).toBeGreaterThan(0));

    const file = result.current.files.find(f => f.entryType === 'file')!;
    const before = result.current.currentPath;
    act(() => { result.current.handleDoubleClick(file); });
    expect(result.current.currentPath).toBe(before);
  });

  // ── File selection ─────────────────────────────────────────────────────

  it('handleFileSelect toggles individual file selection', async () => {
    const { result } = await renderSMBClient();
    await waitFor(() => expect(result.current.files.length).toBeGreaterThan(0));

    act(() => { result.current.handleFileSelect('config.ini'); });
    expect(result.current.selectedFiles.has('config.ini')).toBe(true);

    act(() => { result.current.handleFileSelect('config.ini'); });
    expect(result.current.selectedFiles.has('config.ini')).toBe(false);
  });

  it('selectAll selects all files, deselectAll clears', async () => {
    const { result } = await renderSMBClient();
    await waitFor(() => expect(result.current.files.length).toBeGreaterThan(0));

    act(() => { result.current.selectAll(); });
    expect(result.current.selectedFiles.size).toBe(result.current.files.length);

    act(() => { result.current.deselectAll(); });
    expect(result.current.selectedFiles.size).toBe(0);
  });

  // ── Share change ───────────────────────────────────────────────────────

  it('handleShareChange updates share and resets path', async () => {
    const { result } = await renderSMBClient();
    await waitFor(() => expect(result.current.shares.length).toBeGreaterThan(0));

    act(() => { result.current.navigateToPath('/Users'); });
    expect(result.current.currentPath).toBe('/Users');

    await actAndFlush(() => { result.current.handleShareChange('D$'); });
    expect(result.current.currentShare).toBe('D$');
    expect(result.current.currentPath).toBe('/');
  });

  // ── formatFileSize ─────────────────────────────────────────────────────

  it('formats file sizes correctly', async () => {
    const { result } = await renderSMBClient();
    expect(result.current.formatFileSize(0)).toBe('0 B');
    expect(result.current.formatFileSize(512)).toBe('512 B');
    expect(result.current.formatFileSize(1024)).toBe('1 KB');
    expect(result.current.formatFileSize(1048576)).toBe('1 MB');
    expect(result.current.formatFileSize(1073741824)).toBe('1 GB');
    expect(result.current.formatFileSize(2048)).toBe('2 KB');
  });

  // ── Error handling ─────────────────────────────────────────────────────

  it('surfaces a connect error via the error state', async () => {
    invokeMock = vi.fn(async (cmd: string) => {
      if (cmd === 'smb_connect') throw new Error('NT_STATUS_LOGON_FAILURE');
      throw new Error(`unmocked: ${cmd}`);
    });
    const { result } = await renderSMBClient();
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toContain('SMB connect failed');
  });
});
