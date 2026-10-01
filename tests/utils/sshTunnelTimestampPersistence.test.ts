import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  raw: null as string | null,
  invoke: vi.fn(),
  locked: false,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => bridge.invoke,
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ getSettings: () => ({}) }) },
}));
const CREATED = "2024-01-02T03:04:05.000Z";
const NOW = "2026-10-01T12:00:00.000Z";
const loadService = async () =>
  (await import("../../src/utils/ssh/sshTunnelService")).sshTunnelService;
const row = () => ({
  id: "tunnel-fixture",
  name: "Fixture",
  sshConnectionId: "connection-fixture",
  localPort: 12345,
  type: "dynamic",
  autoConnect: false,
  createdAt: CREATED,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  bridge.raw = null;
  bridge.locked = false;
  localStorage.removeItem("ssh-tunnels");
  bridge.invoke.mockReset().mockImplementation(async (command, args) => {
    expect(args.key).toBe("ssh.tunnels");
    if (command === "read_app_data") return bridge.raw;
    if (command === "compare_and_swap_app_data") {
      if (bridge.locked) throw new Error("Store locked");
      if (bridge.raw !== args.expected) return false;
      bridge.raw = args.replacement;
      return true;
    }
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SSH tunnel row timestamp persistence without an array envelope", () => {
  it("backfills missing updatedAt from creation once and leaves the wire format an array", async () => {
    bridge.raw = JSON.stringify([row()]);
    const service = await loadService();
    await service.ready();
    expect(JSON.parse(bridge.raw!)).toEqual([{ ...row(), updatedAt: CREATED }]);
    expect(service.getTunnel("tunnel-fixture")?.updatedAt.toISOString()).toBe(
      CREATED,
    );
    const durable = bridge.raw;
    const writes = bridge.invoke.mock.calls.filter(
      ([command]) => command === "compare_and_swap_app_data",
    ).length;
    vi.resetModules();
    await (await loadService()).ready();
    expect(bridge.raw).toBe(durable);
    expect(
      bridge.invoke.mock.calls.filter(
        ([command]) => command === "compare_and_swap_app_data",
      ),
    ).toHaveLength(writes);
  });

  it("initializes creation and update together, preserves creation on edits and avoids no-op timestamp churn", async () => {
    const service = await loadService();
    await service.ready();
    const created = await service.createTunnel({
      name: "Fixture",
      sshConnectionId: "connection-fixture",
      type: "dynamic",
      localPort: 12345,
    });
    expect(created.createdAt.toISOString()).toBe(NOW);
    expect(created.updatedAt.toISOString()).toBe(NOW);
    vi.setSystemTime("2026-10-02T12:00:00.000Z");
    const updated = await service.updateTunnel(created.id, { name: "Renamed" });
    expect(updated?.createdAt.toISOString()).toBe(NOW);
    expect(updated?.updatedAt.toISOString()).toBe("2026-10-02T12:00:00.000Z");
    const durable = bridge.raw;
    vi.setSystemTime("2026-10-03T12:00:00.000Z");
    await service.updateTunnel(created.id, { name: "Renamed" });
    expect(bridge.raw).toBe(durable);
    expect(JSON.parse(bridge.raw!)[0]).toMatchObject({
      createdAt: NOW,
      updatedAt: "2026-10-02T12:00:00.000Z",
    });
  });

  it("retains the old durable and in-memory timestamps if an edit cannot be persisted", async () => {
    bridge.raw = JSON.stringify([{ ...row(), updatedAt: CREATED }]);
    const service = await loadService();
    await service.ready();
    const durable = bridge.raw;
    bridge.locked = true;
    await expect(
      service.updateTunnel("tunnel-fixture", { name: "Rejected" }),
    ).rejects.toThrow(/locked/);
    expect(bridge.raw).toBe(durable);
    expect(service.getTunnel("tunnel-fixture")?.updatedAt.toISOString()).toBe(
      CREATED,
    );
    expect(service.getTunnel("tunnel-fixture")?.name).toBe("Fixture");
  });
});
