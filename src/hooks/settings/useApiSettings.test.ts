import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { GlobalSettings } from '../../types/settings/settings';
import type { ApiServerStatusResult } from './useApiSettings';

// Hoisted so the module-mock factory (which is hoisted above imports) can see it.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

// The hook resolves `invoke` via a dynamic `import('@tauri-apps/api/core')`,
// so mocking the module intercepts every backend call.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

// No i18n provider in the vitest environment — return the inline default.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, dflt?: string) => dflt ?? _key }),
}));

import { useApiSettings } from './useApiSettings';

const STOPPED: ApiServerStatusResult = {
  running: false,
  bindAddr: '',
  port: 0,
  authRequired: false,
};

/** Route the mocked `invoke` by command name; overridable per test. */
function defaultInvoke(cmd: string): Promise<unknown> {
  switch (cmd) {
    case 'get_api_capabilities':
      return Promise.resolve([]);
    case 'set_api_disabled_capabilities':
      return Promise.resolve(undefined);
    case 'api_server_status':
      return Promise.resolve(STOPPED);
    default:
      return Promise.resolve(undefined);
  }
}

function makeSettings(restApi: Record<string, unknown> = {}): GlobalSettings {
  return { restApi } as unknown as GlobalSettings;
}

/** Render the hook with a spy `updateSettings`, waiting past the mount-time
 *  status refresh so assertions start from a settled state. */
async function renderApiSettings(settings: GlobalSettings) {
  const updateSettings = vi.fn();
  const rendered = renderHook(() => useApiSettings(settings, updateSettings));
  // Let the on-mount `api_server_status` refresh resolve.
  await waitFor(() =>
    expect(invokeMock).toHaveBeenCalledWith('api_server_status', undefined),
  );
  return { ...rendered, updateSettings };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(defaultInvoke);
});

describe('useApiSettings — real server control wiring', () => {
  it('reflects on-mount api_server_status (running) instead of a local default', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'api_server_status'
        ? Promise.resolve({
            running: true,
            bindAddr: '127.0.0.1:9876',
            port: 9876,
            authRequired: true,
          } satisfies ApiServerStatusResult)
        : defaultInvoke(cmd),
    );

    const { result } = await renderApiSettings(makeSettings());

    await waitFor(() => expect(result.current.serverStatus).toBe('running'));
    expect(result.current.actualPort).toBe(9876);
    expect(result.current.bindAddr).toBe('127.0.0.1:9876');
    expect(result.current.authRequired).toBe(true);
  });

  it('handleStartServer applies the INVOKE result, not a timer-derived port', async () => {
    // bindAddr can only come from the backend — the old setTimeout fake never
    // produced one, so asserting it proves the real invoke path is used.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'api_server_start') {
        return Promise.resolve({
          running: true,
          bindAddr: '127.0.0.1:12345',
          port: 12345,
          authRequired: true,
        } satisfies ApiServerStatusResult);
      }
      return defaultInvoke(cmd);
    });

    const { result } = await renderApiSettings(makeSettings({ port: 9876 }));

    await act(async () => {
      await result.current.handleStartServer();
    });

    expect(invokeMock).toHaveBeenCalledWith('api_server_start', undefined);
    expect(result.current.serverStatus).toBe('running');
    expect(result.current.actualPort).toBe(12345);
    expect(result.current.bindAddr).toBe('127.0.0.1:12345');
    expect(result.current.authRequired).toBe(true);
  });

  it('handleStopServer invokes api_server_stop and returns to stopped', async () => {
    const { result } = await renderApiSettings(makeSettings());

    await act(async () => {
      await result.current.handleStopServer();
    });

    expect(invokeMock).toHaveBeenCalledWith('api_server_stop', undefined);
    await waitFor(() => expect(result.current.serverStatus).toBe('stopped'));
    expect(result.current.actualPort).toBeNull();
  });

  it('handleRestartServer applies the restart status snapshot', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'api_server_restart') {
        return Promise.resolve({
          running: true,
          bindAddr: '0.0.0.0:9876',
          port: 9876,
          authRequired: true,
        } satisfies ApiServerStatusResult);
      }
      return defaultInvoke(cmd);
    });

    const { result } = await renderApiSettings(makeSettings());

    await act(async () => {
      await result.current.handleRestartServer();
    });

    expect(invokeMock).toHaveBeenCalledWith('api_server_restart', undefined);
    expect(result.current.serverStatus).toBe('running');
    expect(result.current.bindAddr).toBe('0.0.0.0:9876');
  });

  it('start failure reconciles to stopped rather than stranding "starting"', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'api_server_start'
        ? Promise.reject(new Error('bind failed'))
        : defaultInvoke(cmd),
    );

    const { result } = await renderApiSettings(makeSettings());

    await act(async () => {
      await result.current.handleStartServer();
    });

    await waitFor(() => expect(result.current.serverStatus).toBe('stopped'));
    expect(result.current.actualPort).toBeNull();
  });

  it('generateApiKey persists the key returned by api_regenerate_key', async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === 'api_regenerate_key'
        ? Promise.resolve('deadbeefcafef00d')
        : defaultInvoke(cmd),
    );

    const { result, updateSettings } = await renderApiSettings(makeSettings());

    await act(async () => {
      await result.current.generateApiKey();
    });

    expect(invokeMock).toHaveBeenCalledWith('api_regenerate_key', undefined);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        restApi: expect.objectContaining({ apiKey: 'deadbeefcafef00d' }),
      }),
    );
  });

  it('surfaces auth-forced when remote connections are allowed', async () => {
    const { result } = await renderApiSettings(
      makeSettings({ allowRemoteConnections: true }),
    );
    expect(result.current.authForcedByRemote).toBe(true);
  });

  it('does not force auth when remote connections are off', async () => {
    const { result } = await renderApiSettings(
      makeSettings({ allowRemoteConnections: false }),
    );
    expect(result.current.authForcedByRemote).toBe(false);
  });
});
