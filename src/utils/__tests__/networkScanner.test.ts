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
});

describe('NetworkScanner.scanPort', () => {
  it('resolves and closes the socket on error', async () => {
    const OriginalWebSocket = (global as any).WebSocket;
    let closed = false;

    class MockWebSocket {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((event: { wasClean: boolean }) => void) | null = null;
      constructor(url: string) {
        setTimeout(() => {
          this.onerror?.();
        }, 0);
      }
      close() {
        closed = true;
      }
    }

    (global as any).WebSocket = MockWebSocket as any;

    const result = await scanner.scanPort('127.0.0.1', 1234, 1000);

    (global as any).WebSocket = OriginalWebSocket;

    expect(result.isOpen).toBe(false);
    expect(closed).toBe(true);
  });
});
