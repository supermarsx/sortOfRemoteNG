import request from "supertest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Application } from "express";
import dgram from "dgram";
import { RestApiServer } from "../restApiServer";

/**
 * Integration tests for the Wake-on-LAN REST endpoint
 */
describe("Wake-on-LAN REST endpoint", () => {
  let server: RestApiServer;
  let app: Application;

  beforeEach(() => {
    server = new RestApiServer({
      port: 0,
      authentication: false,
      corsEnabled: false,
      rateLimiting: false,
      jwtSecret: "secret",
    });
    app = (server as unknown as { app: Application }).app;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("broadcasts received packet", async () => {
    const socketMock = {
      bind: (cb: () => void) => cb(),
      setBroadcast: vi.fn(),
      send: vi.fn(
        (
          buf: Buffer,
          _o: number,
          _l: number,
          _p: number,
          _a: string,
          cb: (err?: Error) => void,
        ) => cb(),
      ),
      close: vi.fn(),
    } as unknown as dgram.Socket;
    const sendSpy = vi.spyOn(socketMock, "send");
    vi.spyOn(dgram, "createSocket").mockReturnValue(socketMock);

    const res = await request(app)
      .post("/api/wol")
      .send({
        packet: [1, 2, 3],
        broadcastAddress: "255.255.255.255",
        port: 7,
      });

    expect(res.status).toBe(200);
    expect(sendSpy).toHaveBeenCalled();
    const args = sendSpy.mock.calls[0];
    expect(args[0]).toBeInstanceOf(Buffer);
    expect(args[3]).toBe(7);
    expect(args[4]).toBe("255.255.255.255");
  });
});
