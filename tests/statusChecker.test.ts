import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import net from 'net';
import { StatusChecker } from '../src/utils/statusChecker';

let checker: any;

beforeEach(() => {
  StatusChecker.resetInstance();
  checker = StatusChecker.getInstance() as any;
});

describe('StatusChecker socket probing', () => {
  it('uses TCP probe when available', async () => {
    const server = net.createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    await expect(checker.checkSocket('127.0.0.1', port, 1000)).resolves.toBeUndefined();
    server.close();
  });

  it('falls back to WebSocket when TCP not available', async () => {
    global.WebSocket = WebSocket as any;
    const original = checker.canUseTcpSockets;
    checker.canUseTcpSockets = () => false;

    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>(resolve => wss.on('listening', resolve));
    const port = (wss.address() as any).port;

    await expect(checker.checkSocket('127.0.0.1', port, 1000)).resolves.toBeUndefined();

    await new Promise<void>(resolve => wss.close(() => resolve()));
    checker.canUseTcpSockets = original;
  });
});
