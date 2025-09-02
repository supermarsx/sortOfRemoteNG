import { describe, it, expect, vi, afterEach } from 'vitest';

import { NetworkScanner } from '../networkScanner';
import type { NetworkDiscoveryConfig } from '../../types/settings';

// Access private methods via casting to any
const scanner = new NetworkScanner() as any;

const originalFetch = global.fetch;
const originalWebSocket = (global as any).WebSocket;

afterEach(() => {
  (global as any).fetch = originalFetch;
  (global as any).WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

describe('NetworkScanner helper methods', () => {
  it('generateIPRange("192.168.0.0/30") returns two host IPs', async () => {
    const ips: string[] = [];
    for await (const ip of scanner.generateIPRange('192.168.0.0/30')) {
      ips.push(ip);
    }
    expect(ips).toEqual(['192.168.0.1', '192.168.0.2']);
  });

  it('masks non-network-base addresses before generating hosts', async () => {
    const ips: string[] = [];
    for await (const ip of scanner.generateIPRange('192.168.0.5/30')) {
      ips.push(ip);
    }
    expect(ips).toEqual(['192.168.0.5', '192.168.0.6']);
  });

  it('handles edge prefix /24', async () => {
    const ips: string[] = [];
    for await (const ip of scanner.generateIPRange('10.0.0.42/24')) {
      ips.push(ip);
    }
    expect(ips.length).toBe(254);
    expect(ips[0]).toBe('10.0.0.1');
    expect(ips[253]).toBe('10.0.0.254');
  });

  it('supports IPv6 ranges', async () => {
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

  it('compareIPs sorts numerically', () => {
    const result = scanner.compareIPs('192.168.0.2', '192.168.0.10');
    expect(result).toBeLessThan(0);
  });

  it('extractVersion parses banners', () => {
    const version = scanner.extractVersion('OpenSSH_8.6p1');
    expect(version).toBe('8.6');
  });

  it('throws on malformed CIDR strings', async () => {
    await expect(scanner.generateIPRange('192.168.0.0').next()).rejects.toThrow();
    await expect(scanner.generateIPRange('192.168.0.0/abc').next()).rejects.toThrow();
  });

  it('throws when IP does not have four octets', async () => {
    await expect(scanner.generateIPRange('192.168.0/24').next()).rejects.toThrow();
  });

  it('throws when prefix is outside supported range', async () => {
    await expect(scanner.generateIPRange('192.168.0.0/23').next()).rejects.toThrow();
    await expect(scanner.generateIPRange('192.168.0.0/31').next()).rejects.toThrow();
    await expect(scanner.generateIPRange('2001:db8::/111').next()).rejects.toThrow();
  });

  it('identifyService returns mapped values', () => {
    const result = scanner.identifyService(22);
    expect(result.service).toBe('ssh');
    expect(result.protocol).toBe('ssh');
  });

  it('identifyService handles unknown ports', () => {
    const result = scanner.identifyService(9999);
    expect(result.service).toBe('unknown');
    expect(result.protocol).toBe('unknown');
  });

  it('scanHost respects port concurrency limit', async () => {
    vi.useFakeTimers();
    const testScanner = new NetworkScanner() as any;

    const config: NetworkDiscoveryConfig = {
      enabled: true,
      ipRange: '192.168.0.0/24',
      portRanges: ['1', '2', '3', '4', '5'],
      protocols: [],
      timeout: 1000,
      maxConcurrent: 10,
      maxPortConcurrent: 2,
      customPorts: {},
      probeStrategies: { default: ['websocket'] },
      cacheTTL: 60000,
      hostnameTtl: 60000,
      macTtl: 60000,
    };

    let active = 0;
    let maxActive = 0;
    testScanner.scanPort = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      return new Promise(resolve => {
        setTimeout(() => {
          active--;
          resolve({ isOpen: false, elapsed: 0 });
        }, 1000);
      });
    });

    const promise = testScanner.scanHost('192.168.0.1', config);
    await vi.runAllTimersAsync();
    await promise;
    expect(maxActive).toBe(config.maxPortConcurrent);
    vi.useRealTimers();
  });

  it('scanNetwork processes IPv4 ranges', async () => {
    const testScanner = new NetworkScanner() as any;
    testScanner.scanHost = vi.fn(async () => null);

    const config: NetworkDiscoveryConfig = {
      enabled: true,
      ipRange: '192.168.0.0/30',
      portRanges: [],
      protocols: [],
      timeout: 1000,
      maxConcurrent: 2,
      maxPortConcurrent: 1,
      customPorts: {},
      probeStrategies: { default: ['websocket'] },
      cacheTTL: 60000,
      hostnameTtl: 60000,
      macTtl: 60000,
    };

    const progress: number[] = [];
    await testScanner.scanNetwork(config, (p: number) => progress.push(p));
    expect(testScanner.scanHost).toHaveBeenCalledTimes(2);
    expect(progress.at(-1)).toBe(100);
  });

  it('scanNetwork processes IPv6 ranges', async () => {
    const testScanner = new NetworkScanner() as any;
    testScanner.scanHost = vi.fn(async () => null);

    const config: NetworkDiscoveryConfig = {
      enabled: true,
      ipRange: '2001:db8::/126',
      portRanges: [],
      protocols: [],
      timeout: 1000,
      maxConcurrent: 2,
      maxPortConcurrent: 1,
      customPorts: {},
      probeStrategies: { default: ['websocket'] },
      cacheTTL: 60000,
      hostnameTtl: 60000,
      macTtl: 60000,
    };

    const progress: number[] = [];
    await testScanner.scanNetwork(config, (p: number) => progress.push(p));
    expect(testScanner.scanHost).toHaveBeenCalledTimes(4);
    expect(progress.at(-1)).toBe(100);
  });

  it('scanPort resolves false on invalid hostname without rejection', async () => {
    const config: NetworkDiscoveryConfig = {
      enabled: true,
      ipRange: '',
      portRanges: [],
      protocols: [],
      timeout: 50,
      maxConcurrent: 1,
      maxPortConcurrent: 1,
      customPorts: {},
      probeStrategies: { default: ['websocket'] },
      cacheTTL: 0,
      hostnameTtl: 0,
      macTtl: 0,
    };
    const result = await scanner.scanPort('invalid host', 80, config);
    expect(result.isOpen).toBe(false);
  });

  it('scanPort wraps IPv6 addresses in WebSocket URLs', async () => {
    let capturedUrl = '';
    class MockWebSocket {
      onopen?: () => void;
      onerror?: (ev: any) => void;
      onclose?: (ev: any) => void;
      constructor(url: string) {
        capturedUrl = url;
        setTimeout(() => this.onerror?.(new Event('error')), 0);
      }
      close() {}
    }
    (global as any).WebSocket = MockWebSocket as any;
    const config: NetworkDiscoveryConfig = {
      enabled: true,
      ipRange: '',
      portRanges: [],
      protocols: [],
      timeout: 50,
      maxConcurrent: 1,
      maxPortConcurrent: 1,
      customPorts: {},
      probeStrategies: { default: ['websocket'] },
      cacheTTL: 0,
      hostnameTtl: 0,
      macTtl: 0,
    };
    const result = await scanner.scanPort('2001:db8::1', 80, config);
    expect(capturedUrl).toBe('ws://[2001:db8::1]:80');
    expect(result.isOpen).toBe(false);
  });

  it('resolveHostname caches successful lookups', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hostname: 'test.local' }),
    });
    (global as any).fetch = fetchMock;

    const ttl = 1000;
    const first = await scanner.resolveHostname('1.1.1.1', ttl);
    const second = await scanner.resolveHostname('1.1.1.1', ttl);

    expect(first).toBe('test.local');
    expect(second).toBe('test.local');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolveHostname caches errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    (global as any).fetch = fetchMock;

    const ttl = 1000;
    const first = await scanner.resolveHostname('2.2.2.2', ttl);
    const second = await scanner.resolveHostname('2.2.2.2', ttl);

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getMacAddress caches successful lookups', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ mac: 'aa:bb:cc:dd:ee:ff' }),
    });
    (global as any).fetch = fetchMock;

    const ttl = 1000;
    const first = await scanner.getMacAddress('3.3.3.3', ttl);
    const second = await scanner.getMacAddress('3.3.3.3', ttl);

    expect(first).toBe('aa:bb:cc:dd:ee:ff');
    expect(second).toBe('aa:bb:cc:dd:ee:ff');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getMacAddress caches errors', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    (global as any).fetch = fetchMock;

    const ttl = 1000;
    const first = await scanner.getMacAddress('4.4.4.4', ttl);
    const second = await scanner.getMacAddress('4.4.4.4', ttl);

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolveHostname respects TTL', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hostname: 'first.local' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hostname: 'second.local' }),
      });
    (global as any).fetch = fetchMock;

    const ttl = 1000;
    const first = await scanner.resolveHostname('5.5.5.5', ttl);
    expect(first).toBe('first.local');
    vi.advanceTimersByTime(ttl + 1);
    const second = await scanner.resolveHostname('5.5.5.5', ttl);
    expect(second).toBe('second.local');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('clearCaches removes cached entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hostname: 'clear.local' }),
    });
    (global as any).fetch = fetchMock;

    const ttl = 1000;
    await scanner.resolveHostname('6.6.6.6', ttl);
    scanner.clearCaches();
    await scanner.resolveHostname('6.6.6.6', ttl);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
