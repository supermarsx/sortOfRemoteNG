import { describe, it, expect, vi, afterEach } from 'vitest';
import { NetworkScanner } from '../../src/utils/network/networkScanner';
import type { NetworkDiscoveryConfig } from '../../src/types/settings/settings';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const scanner = new NetworkScanner() as any;
const originalFetch = global.fetch;
const originalWebSocket = (global as any).WebSocket;

afterEach(() => {
  (global as any).fetch = originalFetch;
  (global as any).WebSocket = originalWebSocket;
  invokeMock.mockReset();
  vi.restoreAllMocks();
});

describe('IPv6 range generation', () => {
  it('generates addresses for IPv6 CIDR', async () => {
    const ips: string[] = [];
    for await (const ip of scanner.generateIPRange('2001:db8::/126')) {
      ips.push(ip);
    }
    expect(ips).toEqual([
      '2001:db8::',
      '2001:db8::1',
      '2001:db8::2',
      '2001:db8::3',
    ]);
  });
});

describe('probe strategy selection', () => {
  const baseConfig: NetworkDiscoveryConfig = {
    enabled: true,
    ipRange: '::/0',
    portRanges: [],
    protocols: [],
    timeout: 200,
    maxConcurrent: 1,
    maxPortConcurrent: 1,
    customPorts: {},
    probeStrategies: { default: ['websocket'], http: ['websocket', 'http'] },
    cacheTTL: 0,
    hostnameTtl: 0,
    macTtl: 0,
  };

  it('falls back to HTTP when WebSocket creation fails', async () => {
    const wsCtor = vi.fn(() => {
      throw new Error('no ws');
    });
    (global as any).WebSocket = wsCtor as any;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { headers: { server: 'test' } }),
    );
    (global as any).fetch = fetchMock;

    const result = await scanner.scanPort('127.0.0.1', 80, baseConfig);
    expect(fetchMock).toHaveBeenCalled();
    expect(result.isOpen).toBe(true);
    expect(result.banner).toBe('test');
  });

  it('does not use HTTP when strategy excludes it', async () => {
    const wsCtor = vi.fn(() => {
      throw new Error('no ws');
    });
    (global as any).WebSocket = wsCtor as any;
    const fetchMock = vi.fn();
    (global as any).fetch = fetchMock;
    const config = { ...baseConfig, probeStrategies: { default: ['websocket'] } };
    const result = await scanner.scanPort('127.0.0.1', 80, config);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isOpen).toBe(false);
  });

  it('confirms VNC on a configured raw-TCP port only after an RFB banner', async () => {
    invokeMock.mockResolvedValue({
      status: 'rfb',
      elapsedMs: 12,
      version: '003.008',
      banner: 'RFB 003.008',
    });
    const testScanner = new NetworkScanner() as any;
    testScanner.resolveHostname = vi.fn().mockResolvedValue(undefined);
    testScanner.getMacAddress = vi.fn().mockResolvedValue(undefined);
    const config: NetworkDiscoveryConfig = {
      ...baseConfig,
      ipRange: '127.0.0.1/30',
      protocols: ['vnc'],
      customPorts: { vnc: [5999] },
      probeStrategies: { default: ['websocket'], vnc: ['rfb'] },
    };

    const host = await testScanner.scanHost('127.0.0.1', config);

    expect(invokeMock).toHaveBeenCalledWith('probe_vnc_rfb', {
      host: '127.0.0.1',
      port: 5999,
      timeoutMs: 200,
    });
    expect(host.openPorts).toEqual([5999]);
    expect(host.services).toEqual([
      expect.objectContaining({
        port: 5999,
        protocol: 'vnc',
        service: 'vnc',
        version: '003.008',
        banner: 'RFB 003.008',
      }),
    ]);
  });

  it.each([
    ['legacy WebSocket-only', ['websocket']],
    ['mixed RFB and WebSocket', ['rfb', 'websocket']],
  ] as const)(
    'forces native RFB for %s VNC strategies without WebSocket fallback',
    async (_label, vncStrategies) => {
      invokeMock.mockResolvedValue({ status: 'not_rfb', elapsedMs: 8 });
      const wsCtor = vi.fn();
      (global as any).WebSocket = wsCtor as any;
      const config: NetworkDiscoveryConfig = {
        ...baseConfig,
        protocols: ['vnc'],
        customPorts: { vnc: [5900] },
        probeStrategies: {
          default: ['websocket'],
          vnc: [...vncStrategies],
        },
      };

      const result = await scanner.scanPort(
        '127.0.0.1',
        5900,
        config,
        undefined,
        'vnc',
      );

      expect(invokeMock).toHaveBeenCalledWith('probe_vnc_rfb', {
        host: '127.0.0.1',
        port: 5900,
        timeoutMs: 200,
      });
      expect(result.isOpen).toBe(false);
      expect(wsCtor).not.toHaveBeenCalled();
    },
  );

  it('rejects an RFB status carrying a malformed banner', async () => {
    invokeMock.mockResolvedValue({
      status: 'rfb',
      elapsedMs: 8,
      banner: 'RFB 3.8',
    });
    const config: NetworkDiscoveryConfig = {
      ...baseConfig,
      protocols: ['vnc'],
      customPorts: { vnc: [5900] },
      probeStrategies: { default: ['websocket'], vnc: ['rfb'] },
    };

    const result = await scanner.scanPort(
      '127.0.0.1',
      5900,
      config,
      undefined,
      'vnc',
    );

    expect(result).toEqual({ isOpen: false, banner: undefined, elapsed: 8 });
  });

  it.each(['not_rfb', 'refused', 'timeout', 'unreachable'])(
    'does not label a native %s result as VNC',
    async (status) => {
      invokeMock.mockResolvedValue({ status, elapsedMs: 25 });
      const config: NetworkDiscoveryConfig = {
        ...baseConfig,
        protocols: ['vnc'],
        customPorts: { vnc: [5900] },
        probeStrategies: { default: ['websocket'], vnc: ['rfb'] },
      };

      const result = await scanner.scanPort(
        '127.0.0.1',
        5900,
        config,
        undefined,
        'vnc',
      );

      expect(result.isOpen).toBe(false);
      expect(result.banner).toBeUndefined();
    },
  );

  it('fences a late native RFB result after UI cancellation', async () => {
    let resolveInvoke: ((value: unknown) => void) | undefined;
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      }),
    );
    const controller = new AbortController();
    const config: NetworkDiscoveryConfig = {
      ...baseConfig,
      protocols: ['vnc'],
      customPorts: { vnc: [5900] },
      probeStrategies: { default: ['websocket'], vnc: ['rfb'] },
    };
    const pending = scanner.scanPort(
      '127.0.0.1',
      5900,
      config,
      controller.signal,
      'vnc',
    );

    controller.abort();
    const result = await pending;
    resolveInvoke?.({
      status: 'rfb',
      elapsedMs: 30,
      version: '003.008',
      banner: 'RFB 003.008',
    });
    await Promise.resolve();

    expect(result).toEqual({ isOpen: false, elapsed: 0 });
  });

  it('fails closed outside Tauri instead of falling back to WebSocket', async () => {
    invokeMock.mockRejectedValue(new Error('Tauri IPC unavailable'));
    const wsCtor = vi.fn();
    (global as any).WebSocket = wsCtor as any;
    const config: NetworkDiscoveryConfig = {
      ...baseConfig,
      protocols: ['vnc'],
      customPorts: { vnc: [5900] },
      probeStrategies: {
        default: ['websocket'],
        vnc: ['rfb', 'websocket'],
      },
    };

    const result = await scanner.scanPort(
      '127.0.0.1',
      5900,
      config,
      undefined,
      'vnc',
    );

    expect(result.isOpen).toBe(false);
    expect(wsCtor).not.toHaveBeenCalled();
  });

  it.each(['ssh', 'rdp', 'mysql', 'ftp', 'telnet'])(
    'keeps %s as host-only instead of mislabeling a WebSocket handshake',
    async (protocol) => {
      const wsCtor = vi.fn();
      (global as any).WebSocket = wsCtor as any;
      const config: NetworkDiscoveryConfig = {
        ...baseConfig,
        protocols: [protocol],
        customPorts: { [protocol]: [2222] },
        probeStrategies: { default: ['websocket'], [protocol]: ['websocket'] },
      };

      const result = await scanner.scanPort(
        '127.0.0.1',
        2222,
        config,
        undefined,
        protocol,
      );

      expect(result).toEqual({ isOpen: false, elapsed: 0 });
      expect(wsCtor).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    },
  );

  it('enforces maxPortConcurrent across all concurrently scanned hosts', async () => {
    const testScanner = new NetworkScanner() as any;
    let active = 0;
    let maxActive = 0;
    testScanner.scanPort = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return { isOpen: false, elapsed: 5 };
    });
    const config: NetworkDiscoveryConfig = {
      ...baseConfig,
      ipRange: '192.0.2.0/30',
      portRanges: ['5900', '5901'],
      protocols: ['vnc'],
      maxConcurrent: 2,
      maxPortConcurrent: 1,
      customPorts: { vnc: [5900, 5901] },
      probeStrategies: { default: ['websocket'], vnc: ['rfb'] },
    };

    await testScanner.scanNetwork(config);

    expect(testScanner.scanPort).toHaveBeenCalledTimes(4);
    expect(maxActive).toBe(1);
  });

  it('drains queued probes on abort without publishing a late VNC service', async () => {
    const testScanner = new NetworkScanner() as any;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    testScanner.scanPort = vi.fn(
      async (
        _ip: string,
        _port: number,
        _config: NetworkDiscoveryConfig,
        signal?: AbortSignal,
      ) => {
        markStarted?.();
        return new Promise((resolve) => {
          signal?.addEventListener(
            'abort',
            () =>
              resolve({
                isOpen: true,
                elapsed: 50,
                banner: 'RFB 003.008',
              }),
            { once: true },
          );
        });
      },
    );
    const config: NetworkDiscoveryConfig = {
      ...baseConfig,
      ipRange: '192.0.2.0/30',
      portRanges: ['5900', '5901'],
      protocols: ['vnc'],
      maxConcurrent: 2,
      maxPortConcurrent: 1,
      customPorts: { vnc: [5900, 5901] },
      probeStrategies: { default: ['websocket'], vnc: ['rfb'] },
    };
    const controller = new AbortController();
    const pending = testScanner.scanNetwork(config, undefined, controller.signal);
    await started;

    controller.abort();
    const hosts = await pending;

    expect(hosts).toEqual([]);
    expect(testScanner.scanPort).toHaveBeenCalledTimes(1);
    const immutableSnapshot = JSON.stringify(hosts);
    await Promise.resolve();
    expect(JSON.stringify(hosts)).toBe(immutableSnapshot);
  });

  it('aborts during hostname enrichment without returning or caching a host', async () => {
    invokeMock.mockResolvedValue({
      status: 'rfb',
      elapsedMs: 5,
      banner: 'RFB 003.008',
    });
    let markFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          markFetchStarted?.();
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    (global as any).fetch = fetchMock;
    const testScanner = new NetworkScanner() as any;
    const config: NetworkDiscoveryConfig = {
      ...baseConfig,
      protocols: ['vnc'],
      customPorts: { vnc: [5900] },
      probeStrategies: { default: ['websocket'], vnc: ['rfb'] },
    };
    const controller = new AbortController();
    const pending = testScanner.scanHost(
      '192.0.2.1',
      config,
      controller.signal,
    );
    await fetchStarted;

    controller.abort();
    const host = await pending;

    expect(host).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
