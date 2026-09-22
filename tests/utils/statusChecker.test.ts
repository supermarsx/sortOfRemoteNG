import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import net from "net";
import { StatusChecker } from "../../src/utils/connection/statusChecker";

let checker: any;

beforeEach(() => {
  StatusChecker.resetInstance();
  checker = StatusChecker.getInstance() as any;
});

describe("StatusChecker socket probing", () => {
  it.each(["gcp", "integration:gdrive"])(
    "never probes unused endpoints for %s",
    async (protocol) => {
      const socket = vi.spyOn(checker, "checkSocket");
      const http = vi.spyOn(checker, "checkHttp");
      const connection = {
        id: "google",
        protocol,
        hostname: "legacy.example",
        port: 8443,
        statusCheck: { enabled: true },
      };
      const staleTimer = setInterval(() => {}, 30000);
      checker.checkIntervals.set(connection.id, staleTimer);
      checker.startChecking(connection);
      await checker.checkConnection(connection);
      expect(checker.checkIntervals.has(connection.id)).toBe(false);
      expect(socket).not.toHaveBeenCalled();
      expect(http).not.toHaveBeenCalled();
      expect(checker.statusMap.has(connection.id)).toBe(false);
    },
  );
  it("uses TCP probe when available", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as net.AddressInfo).port;

    await expect(
      checker.checkSocket("127.0.0.1", port, 1000),
    ).resolves.toBeUndefined();
    server.close();
  });

  it("falls back to WebSocket when TCP not available", async () => {
    global.WebSocket = WebSocket as any;
    const original = checker.canUseTcpSockets;
    checker.canUseTcpSockets = () => false;

    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss.on("listening", resolve));
    const port = (wss.address() as any).port;

    await expect(
      checker.checkSocket("127.0.0.1", port, 1000),
    ).resolves.toBeUndefined();

    await new Promise<void>((resolve) => wss.close(() => resolve()));
    checker.canUseTcpSockets = original;
  });
});
