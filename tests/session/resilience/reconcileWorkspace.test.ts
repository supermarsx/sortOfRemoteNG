import { describe, expect, it } from "vitest";
import {
  reconcileWorkspace,
  SESSION_ENDED_WHILE_AWAY,
  type LiveSessionDescriptor,
} from "../../../src/services/session/reconcileWorkspace";

const live = (
  protocol: string,
  backendSessionId: string,
  patch: Partial<LiveSessionDescriptor> = {},
): LiveSessionDescriptor => ({
  protocol,
  backendSessionId,
  alive: true,
  ...patch,
});

const opts = { reconnectOnReload: true } as const;

describe("reconcileWorkspace", () => {
  it("adopts a tab whose backend session is still alive", () => {
    const result = reconcileWorkspace({
      tabs: [{ tabId: "t1", protocol: "ssh", backendSessionId: "b1" }],
      live: [live("ssh", "b1")],
      options: opts,
    });
    expect(result.tabs).toEqual([
      { tabId: "t1", action: "adopt", backendSessionId: "b1" },
    ]);
    expect(result.orphans).toEqual([]);
  });

  it("redials a tab whose backend session is gone, with a reason", () => {
    const result = reconcileWorkspace({
      tabs: [{ tabId: "t1", protocol: "ssh", backendSessionId: "gone" }],
      live: [live("ssh", "other")],
      options: opts,
    });
    expect(result.tabs[0]).toMatchObject({
      tabId: "t1",
      action: "reconnect",
      reason: SESSION_ENDED_WHILE_AWAY,
    });
  });

  it("marks dead (no redial) when reconnectOnReload is off", () => {
    const result = reconcileWorkspace({
      tabs: [{ tabId: "t1", protocol: "ssh", backendSessionId: "gone" }],
      live: [],
      options: { reconnectOnReload: false },
    });
    expect(result.tabs[0].action).toBe("mark-dead");
  });

  it("treats a listed-but-not-alive session as dead", () => {
    const result = reconcileWorkspace({
      tabs: [{ tabId: "t1", protocol: "rdp", backendSessionId: "b1" }],
      live: [live("rdp", "b1", { alive: false })],
      options: opts,
    });
    expect(result.tabs[0].action).toBe("reconnect");
    expect(result.orphans).toEqual([]);
  });

  it("never adopts across protocols that share an id", () => {
    const result = reconcileWorkspace({
      tabs: [{ tabId: "t1", protocol: "rdp", backendSessionId: "same" }],
      live: [live("ssh", "same")],
      options: opts,
    });
    expect(result.tabs[0].action).toBe("reconnect");
    expect(result.orphans).toHaveLength(1);
  });

  it("tabs with no recorded backend id simply reconnect", () => {
    const result = reconcileWorkspace({
      tabs: [{ tabId: "t1", protocol: "ssh" }],
      live: [live("ssh", "b1")],
      options: opts,
    });
    expect(result.tabs).toEqual([{ tabId: "t1", action: "reconnect" }]);
    expect(result.orphans.map((o) => o.backendSessionId)).toEqual(["b1"]);
  });

  it("reports unclaimed live sessions as orphans, skipping dead ones", () => {
    const result = reconcileWorkspace({
      tabs: [{ tabId: "t1", protocol: "ssh", backendSessionId: "b1" }],
      live: [
        live("ssh", "b1"),
        live("ssh", "b2"),
        live("ssh", "b3", { alive: false }),
      ],
      options: opts,
    });
    expect(result.orphans.map((o) => o.backendSessionId)).toEqual(["b2"]);
  });

  it("lets only one tab own a duplicated backend id", () => {
    const result = reconcileWorkspace({
      tabs: [
        { tabId: "t1", protocol: "ssh", backendSessionId: "b1" },
        { tabId: "t2", protocol: "ssh", backendSessionId: "b1" },
      ],
      live: [live("ssh", "b1")],
      options: opts,
    });
    expect(result.tabs.map((t) => [t.tabId, t.action])).toEqual([
      ["t1", "adopt"],
      ["t2", "reconnect"],
    ]);
  });

  it("drops duplicate tab ids", () => {
    const result = reconcileWorkspace({
      tabs: [
        { tabId: "t1", protocol: "ssh" },
        { tabId: "t1", protocol: "ssh" },
      ],
      live: [],
      options: opts,
    });
    expect(result.tabs).toHaveLength(1);
    expect(result.droppedDuplicateTabIds).toEqual(["t1"]);
  });

  it("keeps persisted order and falls back to the first tab for a stale active id", () => {
    const result = reconcileWorkspace({
      tabs: [
        { tabId: "c", protocol: "ssh", order: 2 },
        { tabId: "a", protocol: "ssh", order: 0 },
        { tabId: "b", protocol: "ssh", order: 1 },
      ],
      live: [],
      activeTabId: "missing",
      options: opts,
    });
    expect(result.tabs.map((t) => t.tabId)).toEqual(["a", "b", "c"]);
    expect(result.activeTabId).toBe("a");
  });

  it("preserves the persisted active tab when it exists", () => {
    const result = reconcileWorkspace({
      tabs: [
        { tabId: "a", protocol: "ssh" },
        { tabId: "b", protocol: "ssh" },
      ],
      live: [],
      activeTabId: "b",
      options: opts,
    });
    expect(result.activeTabId).toBe("b");
  });

  it("adoption can be disabled, falling back to plain redial", () => {
    const result = reconcileWorkspace({
      tabs: [{ tabId: "t1", protocol: "ssh", backendSessionId: "b1" }],
      live: [live("ssh", "b1")],
      options: { reconnectOnReload: true, adoptLiveSessions: false },
    });
    expect(result.tabs[0]).toEqual({ tabId: "t1", action: "reconnect" });
  });

  it("is deterministic and does not mutate its inputs", () => {
    const input = {
      tabs: [{ tabId: "t1", protocol: "ssh", backendSessionId: "b1" }],
      live: [live("ssh", "b1")],
      options: opts,
    };
    const snapshot = JSON.stringify(input);
    const a = reconcileWorkspace(input);
    const b = reconcileWorkspace(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
