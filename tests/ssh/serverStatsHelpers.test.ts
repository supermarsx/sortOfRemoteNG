import { describe, it, expect } from "vitest";
import {
  MISSING,
  formatBytes,
  formatPercent,
  formatRate,
  formatUptime,
  formatLoad,
  formatAge,
  usageTone,
  clampPercent,
} from "../../src/utils/ssh/serverStatsFormat";
import { buildSparkline } from "../../src/utils/ssh/sparkline";
import {
  RingBuffer,
  ServerStatsHistoryStore,
  extractMetrics,
} from "../../src/utils/ssh/serverStatsHistory";
import {
  buildRows,
  deriveStatus,
  filterRows,
  groupRows,
  sortRows,
} from "../../src/utils/ssh/serverStatsTable";
import type { ServerStatsSnapshot } from "../../src/types/monitoring/serverStats";

function snap(
  over: Partial<{
    cpu: number;
    mem: number;
    read: number;
    write: number;
    parts: number[];
  }> = {},
): ServerStatsSnapshot {
  return {
    collectedAt: "2026-01-01T00:00:00Z",
    sessionId: "s",
    connectionName: "n",
    cpu: {
      usagePercent: over.cpu ?? 10,
      coreCount: 4,
      loadAvg1: 1.5,
      loadAvg5: 1,
      loadAvg15: 1,
      model: "m",
    },
    memory: {
      totalBytes: 100,
      usedBytes: 50,
      freeBytes: 50,
      availableBytes: 50,
      usagePercent: over.mem ?? 50,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      swapUsagePercent: 0,
    },
    disk: {
      partitions: (over.parts ?? [40, 80]).map((p, i) => ({
        filesystem: "f",
        mountPoint: `/${i}`,
        fsType: "ext4",
        totalBytes: 1,
        usedBytes: 1,
        availableBytes: 0,
        usagePercent: p,
      })),
      io:
        over.read === undefined
          ? null
          : { readBytes: over.read, writeBytes: over.write ?? 0 },
    },
    system: {
      uptime: "1d",
      uptimeSeconds: 86400,
      kernelVersion: "k",
      osName: "Ubuntu",
      osVersion: "22",
      hostname: "host",
      architecture: "x86_64",
      serverTime: "",
      loggedInUsers: 1,
    },
    firewall: { backend: "none", active: false, rules: [], rawOutput: "" },
    ports: {
      listeningPorts: [],
      establishedConnections: 7,
      timeWaitConnections: 0,
    },
    collectionDurationMs: 5,
    warnings: [],
  };
}

describe("formatting", () => {
  it("renders missing values as an em dash", () => {
    for (const f of [
      formatBytes,
      formatPercent,
      formatRate,
      formatUptime,
      formatLoad,
      formatAge,
    ]) {
      expect(f(null)).toBe(MISSING);
      expect(f(undefined)).toBe(MISSING);
      expect(f(Number.NaN)).toBe(MISSING);
    }
  });
  it("formats bytes, rates, uptime", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(formatBytes(-1)).toBe(MISSING);
    expect(formatRate(2048)).toBe("2.0 KB/s");
    expect(formatUptime(93784)).toBe("1d 2h");
    expect(formatUptime(3700)).toBe("1h 1m");
    expect(formatUptime(59)).toBe("59s");
    expect(formatPercent(12.345)).toBe("12.3%");
    expect(formatLoad(0.5)).toBe("0.50");
    expect(formatAge(2000)).toBe("just now");
    expect(formatAge(90_000)).toBe("1m ago");
  });
  it("derives tones and clamps", () => {
    expect(usageTone(10)).toBe("ok");
    expect(usageTone(70)).toBe("warn");
    expect(usageTone(95)).toBe("crit");
    expect(usageTone(null)).toBe("none");
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});

describe("buildSparkline", () => {
  const o = { width: 100, height: 20, padding: 2 };
  it("handles empty data", () => {
    const g = buildSparkline([], o);
    expect(g).toMatchObject({ count: 0, line: "", area: "", last: null });
    expect(buildSparkline([null, Number.NaN, undefined], o).count).toBe(0);
  });
  it("single sample yields only an end dot", () => {
    const g = buildSparkline([5], o);
    expect(g.count).toBe(1);
    expect(g.line).toBe("");
    expect(g.last).not.toBeNull();
  });
  it("flat data is a centred horizontal line", () => {
    const g = buildSparkline([3, 3, 3], o);
    const ys = [...g.line.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => m[2]);
    expect(new Set(ys).size).toBe(1);
    expect(Number(ys[0])).toBeCloseTo(10, 1);
  });
  it("breaks segments on NaN/null instead of interpolating", () => {
    const g = buildSparkline([1, 2, Number.NaN, 3, 4], o);
    expect(g.line.match(/M/g)).toHaveLength(2);
    expect(g.line).not.toMatch(/NaN/);
  });
  it("uses a fixed domain when given and clamps outliers", () => {
    const g = buildSparkline([0, 100, 250], { ...o, min: 0, max: 100 });
    expect(g.line).not.toMatch(/NaN/);
    const ys = [...g.line.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) =>
      Number(m[2]),
    );
    expect(ys[0]).toBeCloseTo(18, 1);
    expect(ys[1]).toBeCloseTo(2, 1);
    expect(ys[2]).toBeCloseTo(2, 1);
  });
});

describe("RingBuffer", () => {
  it("keeps the newest N items in order", () => {
    const r = new RingBuffer<number>(3);
    expect(r.toArray()).toEqual([]);
    [1, 2, 3, 4, 5].forEach((n) => r.push(n));
    expect(r.toArray()).toEqual([3, 4, 5]);
    expect(r.length).toBe(3);
    expect(r.last()).toBe(5);
    r.clear();
    expect(r.length).toBe(0);
    expect(r.last()).toBeUndefined();
  });
  it("rejects invalid capacity", () => {
    expect(() => new RingBuffer(0)).toThrow();
  });
});

describe("extractMetrics", () => {
  it("takes the worst partition and omits swap without swap space", () => {
    const { values } = extractMetrics(snap());
    expect(values.disk).toBe(80);
    expect(values.swap).toBeNull();
    expect(values.conns).toBe(7);
    expect(values.diskRead).toBeNull();
  });
  it("derives disk io rates and ignores counter resets", () => {
    const first = extractMetrics(snap({ read: 1000, write: 500 }), null, 0);
    const second = extractMetrics(
      snap({ read: 3000, write: 500 }),
      { io: first.io, at: 0 },
      2000,
    );
    expect(second.values.diskRead).toBe(1000);
    expect(second.values.diskWrite).toBe(0);
    const reset = extractMetrics(
      snap({ read: 10, write: 0 }),
      { io: second.io, at: 2000 },
      4000,
    );
    expect(reset.values.diskRead).toBeNull();
  });
});

describe("ServerStatsHistoryStore", () => {
  it("bounds history, coalesces notifications, replaces entries immutably", async () => {
    const store = new ServerStatsHistoryStore(3, 5);
    let calls = 0;
    store.subscribe(() => calls++);
    for (let i = 0; i < 5; i++) store.record("a", snap({ cpu: i }), i * 1000);
    expect(calls).toBe(0);
    const before = store.get("a");
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(1);
    const e = store.getSnapshot().get("a")!;
    expect(e.series.cpu).toEqual([2, 3, 4]);
    expect(e.latest.cpu).toBe(4);
    store.record("a", snap({ cpu: 9 }), 6000);
    expect(store.get("a")).not.toBe(before);
    expect(e.series.cpu).toEqual([2, 3, 4]);
    store.recordError("b", "boom");
    store.flush();
    expect(store.getSnapshot().get("b")!.error).toBe("boom");
    store.remove("b");
    store.flush();
    expect(store.getSnapshot().has("b")).toBe(false);
  });
});

describe("aggregate table", () => {
  const store = new ServerStatsHistoryStore(10, 1);
  store.record("s1", snap({ cpu: 90, mem: 10 }), 1000);
  store.record("s2", snap({ cpu: 20, mem: 80 }), 1000);
  store.flush();
  const sessions = [
    {
      id: "s1",
      connectionId: "c1",
      name: "Alpha",
      hostname: "10.0.0.1",
      status: "connected",
    },
    {
      id: "s2",
      connectionId: "c2",
      name: "beta",
      hostname: "10.0.0.2",
      status: "connected",
    },
    {
      id: "s3",
      connectionId: "c3",
      name: "Gamma",
      hostname: "10.0.0.3",
      status: "connected",
    },
    { id: "s4", name: "Delta", hostname: "10.0.0.4", status: "disconnected" },
  ];
  const conns = [
    { id: "f1", name: "Prod", isGroup: true },
    { id: "c1", parentId: "f1", tags: ["web", "eu"] },
    { id: "c2", parentId: "f1", tags: ["db"] },
    { id: "c3" },
  ];
  const rows = buildRows(sessions, conns, store.getSnapshot(), 2000);

  it("derives status", () => {
    expect(rows.map((r) => r.status)).toEqual([
      "online",
      "online",
      "pending",
      "disconnected",
    ]);
    expect(deriveStatus("connected", store.get("s1"), 1000 + 200_000)).toBe(
      "stale",
    );
    expect(
      deriveStatus("connected", { sampledAt: null, error: "x" } as never, 0),
    ).toBe("error");
    expect(
      deriveStatus("connected", { sampledAt: 1000, error: "x" } as never, 2000),
    ).toBe("error");
  });
  it("sorts numerically with missing values always last", () => {
    expect(sortRows(rows, "cpu", "desc").map((r) => r.name)).toEqual([
      "Alpha",
      "beta",
      "Gamma",
      "Delta",
    ]);
    expect(sortRows(rows, "cpu", "asc").map((r) => r.name)).toEqual([
      "beta",
      "Alpha",
      "Gamma",
      "Delta",
    ]);
    expect(sortRows(rows, "name", "asc").map((r) => r.name)).toEqual([
      "Alpha",
      "beta",
      "Delta",
      "Gamma",
    ]);
    expect(sortRows(rows, "mem", "desc")[0].name).toBe("beta");
  });
  it("filters by name, host, folder, tag and status", () => {
    expect(filterRows(rows, "ALP").map((r) => r.name)).toEqual(["Alpha"]);
    expect(filterRows(rows, "10.0.0.2").map((r) => r.name)).toEqual(["beta"]);
    expect(filterRows(rows, "prod")).toHaveLength(2);
    expect(filterRows(rows, "eu").map((r) => r.name)).toEqual(["Alpha"]);
    expect(filterRows(rows, "disconnected")).toHaveLength(1);
    expect(filterRows(rows, "  ")).toHaveLength(4);
  });
  it("groups by folder and tag", () => {
    const f = groupRows(rows, "folder");
    expect(f.map((g) => g.label)).toEqual(["Prod", null]);
    expect(f[1].rows).toHaveLength(2);
    const t = groupRows(rows, "tag");
    expect(t.map((g) => g.label)).toEqual(["db", "eu", "web", null]);
    expect(groupRows(rows, "none")).toHaveLength(1);
  });
});
