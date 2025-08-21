import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("child_process", async () => {
  const actual =
    await vi.importActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

import request from "supertest";
import type { Application } from "express";
import * as child_process from "child_process";
import { RestApiServer } from "../restApiServer";

const execFileMock = vi.spyOn(child_process, "execFile");

describe("ARP lookup endpoint", () => {
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
    vi.resetAllMocks();
  });

  it("returns 400 for invalid IP", async () => {
    const res = await request(app).get("/api/arp-lookup?ip=bad");
    expect(res.status).toBe(400);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("returns MAC address for valid IP", async () => {
    execFileMock.mockImplementation((_cmd, _args, cb) => {
      cb(null, "192.168.0.1 ether 00:11:22:33:44:55 C eth0", "");
      return {} as any;
    });
    const res = await request(app).get("/api/arp-lookup?ip=192.168.0.1");
    expect(res.status).toBe(200);
    expect(res.body.mac).toBe("00:11:22:33:44:55");
  });

  it("handles execution errors", async () => {
    execFileMock.mockImplementation((_cmd, _args, cb) => {
      cb(new Error("fail"), "", "");
      return {} as any;
    });
    const res = await request(app).get("/api/arp-lookup?ip=192.168.0.1");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Lookup failed");
  });
});
