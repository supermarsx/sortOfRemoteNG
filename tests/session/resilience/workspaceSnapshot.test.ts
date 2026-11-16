import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../../src/types/connection/connection";
import {
  buildWorkspaceSnapshot,
  clearWorkspaceSnapshot,
  isSnapshotFresh,
  loadWorkspaceSnapshot,
  parseWorkspaceSnapshot,
  saveWorkspaceSnapshot,
  SNAPSHOT_MAX_AGE_MS,
  WORKSPACE_SNAPSHOT_STORAGE_KEY,
  WorkspaceSnapshotWriter,
  type SnapshotStorage,
} from "../../../src/services/session/workspaceSnapshot";
import { snapshotToRows } from "../../../src/services/session/bootRestorePlan";

const memoryStorage = (): SnapshotStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

const session = (
  patch: Partial<ConnectionSession> & Record<string, unknown> = {},
): ConnectionSession =>
  ({
    id: "tab-1",
    connectionId: "conn-1",
    name: "Prod box",
    status: "connected",
    startTime: new Date(0),
    protocol: "ssh",
    hostname: "prod.example.test",
    backendSessionId: "backend-1",
    ...patch,
  }) as ConnectionSession;

describe("buildWorkspaceSnapshot", () => {
  it("records ids, order, active tab and backend id for connected adoptable protocols", () => {
    const snap = buildWorkspaceSnapshot({
      sessions: [
        session(),
        session({
          id: "tab-2",
          protocol: "rdp",
          backendSessionId: "rdp-1",
        }),
        session({ id: "tab-3", protocol: "web", backendSessionId: "w-1" }),
        session({ id: "tab-4", status: "disconnected" }),
      ],
      activeSessionId: "tab-2",
      now: 1000,
    });
    expect(snap.tabs.map((t) => [t.tabId, t.order])).toEqual([
      ["tab-1", 0],
      ["tab-2", 1],
      ["tab-3", 2],
      ["tab-4", 3],
    ]);
    expect(snap.tabs[0].backendSessionId).toBe("backend-1");
    expect(snap.tabs[1].backendSessionId).toBe("rdp-1");
    // Web tabs have no adoptable backend session; disconnected tabs have no live transport.
    expect(snap.tabs[2].backendSessionId).toBeUndefined();
    expect(snap.tabs[3].backendSessionId).toBeUndefined();
    expect(snap.activeTabId).toBe("tab-2");
  });

  it("never serializes secrets, even if the session object carries them", () => {
    const secret = "hunter2-SECRET-passphrase";
    const polluted = session({
      password: secret,
      privateKey: `-----BEGIN KEY----- ${secret}`,
      token: secret,
      terminalOutput: `login: ${secret}`,
      draft: secret,
    });
    const snap = buildWorkspaceSnapshot({ sessions: [polluted], now: 1 });
    expect(JSON.stringify(snap)).not.toContain(secret);
    expect(Object.keys(snap.tabs[0]).sort()).toEqual(
      [
        "backendSessionId",
        "connectionId",
        "hostname",
        "name",
        "order",
        "protocol",
        "tabId",
      ].sort(),
    );
  });

  it("drops stale active ids and oversize fields", () => {
    const snap = buildWorkspaceSnapshot({
      sessions: [session({ name: "x".repeat(10_000) })],
      activeSessionId: "ghost",
      now: 1,
    });
    expect(snap.activeTabId).toBeUndefined();
    expect(snap.tabs[0].name).toBe("conn-1");
  });

  it("applies the restorable filter", () => {
    const snap = buildWorkspaceSnapshot({
      sessions: [session(), session({ id: "tool", protocol: "tool:x" })],
      now: 1,
      isRestorable: (s) => !s.protocol.startsWith("tool:"),
    });
    expect(snap.tabs.map((t) => t.tabId)).toEqual(["tab-1"]);
  });
});

describe("parseWorkspaceSnapshot / storage", () => {
  it("round-trips through storage and converts to restore rows", () => {
    const storage = memoryStorage();
    const snap = buildWorkspaceSnapshot({
      sessions: [session(), session({ id: "tab-2" })],
      activeSessionId: "tab-2",
      layout: { mode: "grid4" },
      now: 5,
    });
    expect(saveWorkspaceSnapshot(snap, storage)).toBe(true);
    const loaded = loadWorkspaceSnapshot(storage);
    expect(loaded).toEqual(snap);
    const rows = snapshotToRows(loaded!);
    expect(rows.map((r) => r.id)).toEqual(["tab-1", "tab-2"]);
    expect(rows.every((r) => r.status === "disconnected")).toBe(true);
    expect(rows[0].backendSessionId).toBe("backend-1");
  });

  it("rejects wrong versions, malformed rows and oversize payloads", () => {
    expect(parseWorkspaceSnapshot(null)).toBeNull();
    expect(
      parseWorkspaceSnapshot({ version: 99, savedAt: 1, tabs: [] }),
    ).toBeNull();
    expect(
      parseWorkspaceSnapshot({ version: 1, savedAt: 1, tabs: [{ tabId: "" }] }),
    ).toBeNull();
    const storage = memoryStorage();
    storage.setItem(WORKSPACE_SNAPSHOT_STORAGE_KEY, "{not json");
    expect(loadWorkspaceSnapshot(storage)).toBeNull();
    storage.setItem(WORKSPACE_SNAPSHOT_STORAGE_KEY, "x".repeat(600_000));
    expect(loadWorkspaceSnapshot(storage)).toBeNull();
  });

  it("only treats recent snapshots as usable", () => {
    const snap = buildWorkspaceSnapshot({ sessions: [session()], now: 1000 });
    expect(isSnapshotFresh(snap, 1000 + SNAPSHOT_MAX_AGE_MS)).toBe(true);
    expect(isSnapshotFresh(snap, 1001 + SNAPSHOT_MAX_AGE_MS)).toBe(false);
    expect(isSnapshotFresh(snap, 999)).toBe(false);
  });
});

describe("WorkspaceSnapshotWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces bursts into a single write of the latest snapshot", () => {
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, "setItem");
    const writer = new WorkspaceSnapshotWriter(storage, 750);
    for (let i = 1; i <= 5; i++) {
      writer.schedule(
        buildWorkspaceSnapshot({
          sessions: [session({ id: `tab-${i}` })],
          now: i,
        }),
      );
    }
    vi.advanceTimersByTime(749);
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(loadWorkspaceSnapshot(storage)?.tabs[0].tabId).toBe("tab-5");
  });

  it("flush writes synchronously and clears storage for an empty workspace", () => {
    const storage = memoryStorage();
    const writer = new WorkspaceSnapshotWriter(storage, 750);
    writer.schedule(buildWorkspaceSnapshot({ sessions: [session()], now: 1 }));
    writer.flush();
    expect(loadWorkspaceSnapshot(storage)?.tabs).toHaveLength(1);
    writer.schedule(buildWorkspaceSnapshot({ sessions: [], now: 2 }));
    writer.flush();
    expect(storage.data.has(WORKSPACE_SNAPSHOT_STORAGE_KEY)).toBe(false);
    clearWorkspaceSnapshot(storage);
  });
});
