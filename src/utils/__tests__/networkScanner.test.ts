import { describe, it, expect, vi } from 'vitest';
import { NetworkScanner } from '../networkScanner';
import type { NetworkDiscoveryConfig } from '../../types/settings';

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

  it('scanPort resolves false on invalid hostname without rejection', async () => {
    const result = await scanner.scanPort('invalid host', 80, 50);
    expect(result.isOpen).toBe(false);
  });
});
