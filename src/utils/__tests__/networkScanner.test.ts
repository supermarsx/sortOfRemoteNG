import { describe, it, expect } from 'vitest';
import { NetworkScanner } from '../networkScanner';

// Access private methods via casting to any
const scanner = new NetworkScanner() as any;

describe('NetworkScanner helper methods', () => {
  it('generateIPRange("192.168.0.0/30") returns two host IPs', () => {
    const ips = scanner.generateIPRange('192.168.0.0/30');
    expect(ips).toEqual(['192.168.0.1', '192.168.0.2']);
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
