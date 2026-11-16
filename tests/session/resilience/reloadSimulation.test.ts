/**
 * Mocked-invoke reload simulation.
 *
 * A fake backend (a Map of live sessions behind a mocked `invoke`) outlives a
 * simulated document reload: module state is discarded with `vi.resetModules`,
 * exactly like a webview reload, while the backend keeps its sessions. The
 * boot path must rediscover them, adopt the live ones, flag the dead ones for
 * reconnect, and never disconnect or dial anything by itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../../src/types/connection/connection";
import type { SnapshotStorage } from "../../../src/services/session/workspaceSnapshot";

interface FakeSshSession {
  id: string;
  alive: boolean;
  host: string;
  password: string;
}

const backend = {
  ssh: new Map<string, FakeSshSession>(),
  rdp: new Map<string, { id: string; connected: boolean; host: string }>(),
};
const calls: string[] = [];
let backendDown = false;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    calls.push(command);
    if (backendDown) throw new Error("backend not ready");
    if (command === "list_sessions") {
      return [...backend.ssh.values()].map((s) => ({
        id: s.id,
        is_alive: s.alive,
        // The real command returns the whole config, credentials included.
        config: {
          host: s.host,
          port: 22,
          username: "root",
          password: s.password,
        },
      }));
    }
    if (command === "list_rdp_sessions") {
      return [...backend.rdp.values()].map((s) => ({
        id: s.id,
        connected: s.connected,
        host: s.host,
        port: 3389,
      }));
    }
    throw new Error(`unexpected command ${command}`);
  },
}));

const memoryStorage = (): SnapshotStorage => {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

const tab = (
  id: string,
  protocol: string,
  backendSessionId?: string,
): ConnectionSession =>
  ({
    id,
    connectionId: `conn-${id}`,
    name: id,
    status: "connected",
    startTime: new Date(0),
    protocol,
    hostname: "host.example.test",
    backendSessionId,
  }) as ConnectionSession;

beforeEach(() => {
  backend.ssh.clear();
  backend.rdp.clear();
  calls.length = 0;
  backendDown = false;
});

describe("reload simulation", () => {
  it("adopts live SSH/RDP sessions, redials dead ones, keeps order/active, never disconnects", async () => {
    backend.ssh.set("ssh-live", {
      id: "ssh-live",
      alive: true,
      host: "a",
      password: "TOP-SECRET-PW",
    });
    backend.rdp.set("rdp-live", { id: "rdp-live", connected: true, host: "w" });

    const storage = memoryStorage();

    // --- before the reload: the old document persists its workspace
    {
      const { buildWorkspaceSnapshot, saveWorkspaceSnapshot } =
        await import("../../../src/services/session/workspaceSnapshot");
      const snapshot = buildWorkspaceSnapshot({
        sessions: [
          tab("t-ssh", "ssh", "ssh-live"),
          tab("t-dead", "ssh", "ssh-gone"),
          tab("t-rdp", "rdp", "rdp-live"),
        ],
        activeSessionId: "t-rdp",
        now: Date.now(),
      });
      saveWorkspaceSnapshot(snapshot, storage);
    }

    // --- the reload: every module instance is discarded, backend survives
    vi.resetModules();
    calls.length = 0;

    const { loadWorkspaceSnapshot, isSnapshotFresh } =
      await import("../../../src/services/session/workspaceSnapshot");
    const { listLiveSessions } =
      await import("../../../src/services/session/liveSessionRegistry");
    const { planBootRestore, snapshotToRows } =
      await import("../../../src/services/session/bootRestorePlan");

    const snapshot = loadWorkspaceSnapshot(storage);
    expect(snapshot).not.toBeNull();
    expect(isSnapshotFresh(snapshot!, Date.now())).toBe(true);

    // Sequential, not concurrent, per the dynamic Tauri import gotcha.
    const liveSessions = await listLiveSessions();
    expect(JSON.stringify(liveSessions)).not.toContain("TOP-SECRET-PW");

    const plan = planBootRestore({
      rows: snapshotToRows(snapshot!),
      live: liveSessions,
      activeTabId: snapshot!.activeTabId,
      reconnectOnReload: true,
      adoptLiveSessions: true,
      isQuarantined: () => false,
    });

    expect(plan.rows.map((r) => r.id)).toEqual(["t-ssh", "t-dead", "t-rdp"]);
    expect(plan.adoptedTabIds).toEqual(["t-ssh", "t-rdp"]);
    expect(plan.rows.find((r) => r.id === "t-ssh")?.backendSessionId).toBe(
      "ssh-live",
    );
    expect(plan.rows.find((r) => r.id === "t-rdp")?.backendSessionId).toBe(
      "rdp-live",
    );
    // The dead tab loses its stale id so the normal reconnect path dials fresh.
    expect(
      plan.rows.find((r) => r.id === "t-dead")?.backendSessionId,
    ).toBeUndefined();
    expect(plan.activeTabId).toBe("t-rdp");

    // Boot only lists; it never connects or disconnects anything itself.
    expect(calls.every((c) => c.startsWith("list_"))).toBe(true);
  });

  it("durable-window recovery restores only adoptable live sessions", async () => {
    backend.ssh.set("ssh-live", {
      id: "ssh-live",
      alive: true,
      host: "a",
      password: "x",
    });
    const { planBootRestore, snapshotToRows } =
      await import("../../../src/services/session/bootRestorePlan");
    const { buildWorkspaceSnapshot } =
      await import("../../../src/services/session/workspaceSnapshot");
    const { listLiveSessions } =
      await import("../../../src/services/session/liveSessionRegistry");
    const snapshot = buildWorkspaceSnapshot({
      sessions: [tab("a", "ssh", "ssh-live"), tab("b", "ssh", "ssh-gone")],
      now: Date.now(),
    });
    const plan = planBootRestore({
      rows: snapshotToRows(snapshot),
      live: await listLiveSessions(),
      reconnectOnReload: true,
      adoptLiveSessions: true,
      isQuarantined: () => false,
      adoptOnly: true,
    });
    expect(plan.rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("a failing or unavailable backend means nothing is live (safe redial)", async () => {
    backendDown = true;
    const { listLiveSessions } =
      await import("../../../src/services/session/liveSessionRegistry");
    await expect(listLiveSessions()).resolves.toEqual([]);
  });

  it("quarantined rows are never adopted or stripped", async () => {
    backend.ssh.set("ssh-live", {
      id: "ssh-live",
      alive: true,
      host: "a",
      password: "x",
    });
    const { planBootRestore } =
      await import("../../../src/services/session/bootRestorePlan");
    const { listLiveSessions } =
      await import("../../../src/services/session/liveSessionRegistry");
    const row = {
      id: "q",
      connectionId: "c",
      name: "q",
      protocol: "ssh",
      hostname: "h",
      status: "disconnected" as const,
      backendSessionId: "ssh-live",
    };
    const plan = planBootRestore({
      rows: [row],
      live: await listLiveSessions(),
      reconnectOnReload: true,
      adoptLiveSessions: true,
      isQuarantined: () => true,
    });
    expect(plan.adoptedTabIds).toEqual([]);
    expect(plan.rows).toEqual([row]);
  });
});
