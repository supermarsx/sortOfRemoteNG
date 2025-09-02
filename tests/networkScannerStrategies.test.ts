import { describe, it, expect, vi, afterEach } from 'vitest';
import { NetworkScanner } from '../src/utils/networkScanner';
import type { NetworkDiscoveryConfig } from '../src/types/settings';

const scanner = new NetworkScanner() as any;
const originalFetch = global.fetch;
const originalWebSocket = (global as any).WebSocket;

afterEach(() => {
  (global as any).fetch = originalFetch;
  (global as any).WebSocket = originalWebSocket;
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
});
