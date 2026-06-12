import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri invoke surface so we can capture the setup_port_forward config.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  transformCallback: vi.fn(),
  Channel: vi.fn(),
}));

import { sshTunnelService } from "../../src/utils/ssh/sshTunnelService";
import type { Connection } from "../../src/types/connection/connection";

const sshConnection = {
  id: "conn-1",
  name: "SSH Prod",
  hostname: "prod.example.com",
  port: 22,
  protocol: "ssh",
  username: "user",
} as unknown as Connection;

function setupInvoke() {
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "connect_ssh") return Promise.resolve("session-123");
    if (cmd === "setup_port_forward") return Promise.resolve("forward-456");
    return Promise.resolve(undefined);
  });
}

function lastForwardConfig() {
  const call = invokeMock.mock.calls.find((c) => c[0] === "setup_port_forward");
  expect(call, "setup_port_forward should have been invoked").toBeTruthy();
  return (call![1] as { config: Record<string, unknown> }).config;
}

describe("sshTunnelService non-loopback bind mapping", () => {
  beforeEach(() => {
    // Clear any persisted tunnels from prior tests.
    localStorage.clear();
    setupInvoke();
  });

  it("maps allowNonLoopbackBind=false to allow_non_loopback_bind=false and loopback host", async () => {
    const tunnel = await sshTunnelService.createTunnel({
      name: "loopback",
      sshConnectionId: "conn-1",
      localPort: 15001,
      remoteHost: "db.internal",
      remotePort: 3306,
      type: "local",
      allowNonLoopbackBind: false,
    });

    await sshTunnelService.connectTunnel(tunnel.id, sshConnection);

    const config = lastForwardConfig();
    expect(config.allow_non_loopback_bind).toBe(false);
    expect(config.local_host).toBe("127.0.0.1");

    await sshTunnelService.deleteTunnel(tunnel.id);
  });

  it("maps allowNonLoopbackBind=true to allow_non_loopback_bind=true and 0.0.0.0 bind", async () => {
    const tunnel = await sshTunnelService.createTunnel({
      name: "public",
      sshConnectionId: "conn-1",
      localPort: 15002,
      remoteHost: "db.internal",
      remotePort: 3306,
      type: "local",
      allowNonLoopbackBind: true,
    });

    await sshTunnelService.connectTunnel(tunnel.id, sshConnection);

    const config = lastForwardConfig();
    expect(config.allow_non_loopback_bind).toBe(true);
    expect(config.local_host).toBe("0.0.0.0");

    await sshTunnelService.deleteTunnel(tunnel.id);
  });

  it("defaults to loopback-only when the opt-in is omitted", async () => {
    const tunnel = await sshTunnelService.createTunnel({
      name: "default",
      sshConnectionId: "conn-1",
      localPort: 15003,
      remoteHost: "db.internal",
      remotePort: 3306,
      type: "local",
    });

    await sshTunnelService.connectTunnel(tunnel.id, sshConnection);

    const config = lastForwardConfig();
    expect(config.allow_non_loopback_bind).toBe(false);
    expect(config.local_host).toBe("127.0.0.1");

    await sshTunnelService.deleteTunnel(tunnel.id);
  });
});
