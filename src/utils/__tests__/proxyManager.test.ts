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
    ProxyManager.resetInstance();
    vi.stubGlobal('location', { protocol: 'http:' } as any);
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

  it('creates secure WebSocket on https page', async () => {
    (global as any).location.protocol = 'https:';
    const conn = await manager.createProxiedConnection('host', 80);
    const ws = MockWebSocket.instances[0];
    expect(conn).toBe(ws);
    expect(ws.url).toBe('wss://host:80');
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

  it('uses wss for https proxy', async () => {
    const proxy: ProxyConfig = { type: 'https', host: 'p', port: 8080, enabled: true };
    const promise = manager.createProxiedConnection('host', 22, proxy);
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ status: 'connected' }) });
    const conn = await promise;
    expect(conn).toBe(ws);
    expect(ws.url).toBe('wss://p:8080/proxy');
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

  it('uses wss for socks proxy on https page', async () => {
    (global as any).location.protocol = 'https:';
    const proxy: ProxyConfig = { type: 'socks5', host: 'p', port: 1080, enabled: true };
    const promise = manager.createProxiedConnection('host', 22, proxy);
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ status: 'connected' }) });
    const conn = await promise;
    expect(conn).toBe(ws);
    expect(ws.url).toBe('wss://p:1080/socks');
  });

  it('rejects on websocket error for socks', async () => {
    const proxy: ProxyConfig = { type: 'socks5', host: 'p', port: 1080, enabled: true };
    const promise = manager.createProxiedConnection('host', 22, proxy);
    const ws = MockWebSocket.instances[0];
    ws.onerror?.();
    await expect(promise).rejects.toThrow('SOCKS proxy connection failed');
  });
});

describe('ProxyManager.testProxy', () => {
  let manager: ProxyManager;

  beforeEach(() => {
    ProxyManager.resetInstance();
    (SettingsManager as any).instance = {
      getSettings: () => ({ globalProxy: { enabled: false } }),
      logAction: vi.fn()
    };
    manager = ProxyManager.getInstance();
  });

  it('returns true when proxied connection succeeds', async () => {
    const proxy: ProxyConfig = { type: 'http', host: 'p', port: 8080, enabled: true };
    const close = vi.fn();
    const spy = vi.spyOn(manager, 'createProxiedConnection').mockResolvedValue({ close } as any);
    const result = await manager.testProxy(proxy, 'localhost', 81);
    expect(spy).toHaveBeenCalledWith('localhost', 81, proxy);
    expect(close).toHaveBeenCalled();
    expect(result).toBe(true);
    spy.mockRestore();
  });

  it('returns false when proxied connection fails', async () => {
    const proxy: ProxyConfig = { type: 'socks5', host: 'p', port: 1080, enabled: true };
    const spy = vi.spyOn(manager, 'createProxiedConnection').mockRejectedValue(new Error('fail'));
    const result = await manager.testProxy(proxy, 'localhost', 82);
    expect(spy).toHaveBeenCalledWith('localhost', 82, proxy);
    expect(result).toBe(false);
    spy.mockRestore();
  });
});
