import { describe, it, expect, vi } from 'vitest';
import { NetworkScanner } from '../networkScanner';

// Access private methods via casting to any
const scanner = new NetworkScanner() as any;

describe('NetworkScanner helper methods', () => {
  it('generateIPRange("192.168.0.0/30") returns two host IPs', () => {
    const ips = scanner.generateIPRange('192.168.0.0/30');
    expect(ips).toEqual(['192.168.0.1', '192.168.0.2']);
  });

  it('masks non-network-base addresses before generating hosts', () => {
    const ips = scanner.generateIPRange('192.168.0.5/30');
    expect(ips).toEqual(['192.168.0.5', '192.168.0.6']);
  });

  it('handles edge prefix /24', () => {
    const ips = scanner.generateIPRange('10.0.0.42/24');
    expect(ips.length).toBe(254);
    expect(ips[0]).toBe('10.0.0.1');
    expect(ips[253]).toBe('10.0.0.254');
  });

  it('compareIPs sorts numerically', () => {
    const result = scanner.compareIPs('192.168.0.2', '192.168.0.10');
    expect(result).toBeLessThan(0);
  });

  it('extractVersion parses banners', () => {
    const version = scanner.extractVersion('OpenSSH_8.6p1');
    expect(version).toBe('8.6');
  });

  it('throws on malformed CIDR strings', () => {
    expect(() => scanner.generateIPRange('192.168.0.0')).toThrow();
    expect(() => scanner.generateIPRange('192.168.0.0/abc')).toThrow();
  });

  it('throws when IP does not have four octets', () => {
    expect(() => scanner.generateIPRange('192.168.0/24')).toThrow();
  });

  it('throws when prefix is outside supported range', () => {
    expect(() => scanner.generateIPRange('192.168.0.0/23')).toThrow();
    expect(() => scanner.generateIPRange('192.168.0.0/31')).toThrow();
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
});

describe('NetworkScanner scanPort', () => {
  it('uses HEAD fetch for HTTP ports', async () => {
    const originalFetch = global.fetch;
    const mock = vi.fn().mockResolvedValue({
      headers: new Headers({ server: 'test' }),
    });
    // @ts-ignore
    global.fetch = mock;

    const result = await scanner.scanPort('10.0.0.1', 80, 1000);

    expect(mock).toHaveBeenCalledWith(
      'http://10.0.0.1:80',
      expect.objectContaining({ method: 'HEAD' })
    );
    expect(result.isOpen).toBe(true);

    // @ts-ignore
    global.fetch = originalFetch;
  });

  it('queries backend for non-HTTP ports when configured', async () => {
    const originalFetch = global.fetch;
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ open: true, banner: 'SSH-2.0' }),
    });
    // @ts-ignore
    global.fetch = mock;

    const result = await scanner.scanPort('10.0.0.1', 22, 1000, 'http://backend');

    expect(mock).toHaveBeenCalledWith(
      'http://backend?ip=10.0.0.1&port=22',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result.isOpen).toBe(true);
    expect(result.banner).toBe('SSH-2.0');

    // @ts-ignore
    global.fetch = originalFetch;
  });
});
