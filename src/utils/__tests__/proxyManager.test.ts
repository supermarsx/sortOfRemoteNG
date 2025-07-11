import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProxyManager } from '../proxyManager';
import { ProxyConfig } from '../../types/settings';
import { SettingsManager } from '../settingsManager';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
}

describe('ProxyManager.createProxiedConnection', () => {
  let manager: ProxyManager;

  beforeEach(() => {
    (global as any).WebSocket = MockWebSocket;
    MockWebSocket.instances = [];
    (ProxyManager as any).instance = undefined;
    (SettingsManager as any).instance = {
      getSettings: () => ({ globalProxy: { enabled: false } }),
      logAction: vi.fn()
    };
    manager = ProxyManager.getInstance();
  });

  it('creates direct WebSocket when proxy disabled', async () => {
    const conn = await manager.createProxiedConnection('host', 80);
    const ws = MockWebSocket.instances[0];
    expect(conn).toBe(ws);
    expect(ws.url).toBe('ws://host:80');
  });

  it('resolves on successful http handshake', async () => {
    const proxy: ProxyConfig = { type: 'http', host: 'p', port: 8080, enabled: true };
    const promise = manager.createProxiedConnection('host', 22, proxy);
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ status: 'connected' }) });
    const conn = await promise;
    expect(conn).toBe(ws);
    expect(ws.url).toBe('ws://p:8080/proxy');
  });

  it('rejects on failed http handshake', async () => {
    const proxy: ProxyConfig = { type: 'http', host: 'p', port: 8080, enabled: true };
    const promise = manager.createProxiedConnection('host', 22, proxy);
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ status: 'error', error: 'denied' }) });
    await expect(promise).rejects.toThrow('Proxy connection failed: denied');
  });

  it('resolves on successful socks handshake', async () => {
    const proxy: ProxyConfig = { type: 'socks5', host: 'p', port: 1080, enabled: true };
    const promise = manager.createProxiedConnection('host', 22, proxy);
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ status: 'connected' }) });
    const conn = await promise;
    expect(conn).toBe(ws);
    expect(ws.url).toBe('ws://p:1080/socks');
  });

  it('rejects on websocket error for socks', async () => {
    const proxy: ProxyConfig = { type: 'socks5', host: 'p', port: 1080, enabled: true };
    const promise = manager.createProxiedConnection('host', 22, proxy);
    const ws = MockWebSocket.instances[0];
    ws.onerror?.();
    await expect(promise).rejects.toThrow('SOCKS proxy connection failed');
  });
});
