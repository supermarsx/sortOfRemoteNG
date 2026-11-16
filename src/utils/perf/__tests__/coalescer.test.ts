import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listeners = new Map<string, Array<(e: { payload: unknown }) => void>>();
const unlistenSpy = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    const list = listeners.get(name) ?? [];
    list.push(cb);
    listeners.set(name, list);
    return () => {
      unlistenSpy(name);
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter((x) => x !== cb),
      );
    };
  }),
}));

import {
  createCountingCoalescer,
  createFrameCoalescer,
  createIntervalCoalescer,
  createLastWriteWins,
} from "../coalescer";
import { classify, REALTIME_EVENTS } from "../laneRegistry";
import { perfReport, resetPerf, setPerfEnabled } from "../metrics";
import { realtimeChannel } from "../realtimeChannel";
import { activeEventListeners, subscribeEvent } from "../eventBus";
import { queryStore } from "../queryStore";

const bg = { name: "perf:test-background", lane: "background" as const };

beforeEach(() => {
  vi.useFakeTimers();
  setPerfEnabled(true);
  resetPerf();
});
afterEach(() => {
  vi.useRealTimers();
  setPerfEnabled(undefined);
  listeners.clear();
});

describe("coalescers", () => {
  it("frame coalescer: 100 events in 100 ms -> few flushes, order kept", () => {
    const flushes: number[][] = [];
    const c = createFrameCoalescer<number>({
      ...bg,
      onFlush: (b) => flushes.push(b),
    });
    for (let i = 0; i < 100; i++) {
      c.push(i);
      vi.advanceTimersByTime(1);
    }
    vi.advanceTimersByTime(20);
    expect(flushes.length).toBeLessThanOrEqual(7);
    expect(flushes.flat()).toEqual([...Array(100).keys()]);
    expect(perfReport().counters["coalesce.in:perf:test-background"]).toBe(100);
  });

  it("interval coalescer flushes once per interval and maxWaitMs caps latency", () => {
    const onFlush = vi.fn();
    const c = createIntervalCoalescer<number>({
      ...bg,
      ms: 1000,
      maxWaitMs: 100,
      onFlush,
    });
    c.push(1, 2);
    vi.advanceTimersByTime(99);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toEqual([1, 2]);
  });

  it("last-write-wins keeps the latest per key", () => {
    const onFlush = vi.fn();
    const c = createLastWriteWins<{ k: string; v: number }>({
      ...bg,
      keyOf: (x) => x.k,
      onFlush,
    });
    c.push({ k: "a", v: 1 }, { k: "b", v: 1 }, { k: "a", v: 2 });
    vi.advanceTimersByTime(20);
    expect(onFlush).toHaveBeenCalledWith([
      { k: "a", v: 2 },
      { k: "b", v: 1 },
    ]);
  });

  it("counting coalescer reports burst size", () => {
    const onFlush = vi.fn();
    const c = createCountingCoalescer<string>({ ...bg, onFlush });
    c.push("x", "y", "z");
    vi.advanceTimersByTime(20);
    expect(onFlush).toHaveBeenCalledWith(3, "z");
  });

  it("buffers while paused and flushes on resume; dispose flushes pending", () => {
    let paused = true;
    const onFlush = vi.fn();
    const c = createFrameCoalescer<number>({
      ...bg,
      paused: () => paused,
      onFlush,
    });
    c.push(1);
    vi.advanceTimersByTime(1000);
    expect(onFlush).not.toHaveBeenCalled();
    paused = false;
    c.resume();
    vi.advanceTimersByTime(20);
    expect(onFlush).toHaveBeenCalledTimes(1);
    c.push(2);
    c.dispose();
    expect(onFlush).toHaveBeenCalledTimes(2);
  });
});

describe("lane guard", () => {
  it("every real-time event name throws when handed to a coalescer", () => {
    for (const name of REALTIME_EVENTS) {
      expect(classify(name)).toBe("realtime");
      expect(() =>
        createFrameCoalescer({ name, lane: "background", onFlush: () => {} }),
      ).toThrow(/real-time/);
      expect(() => subscribeEvent(name, () => {})).toThrow();
    }
  });

  it("unclassified names default to real-time and throw", () => {
    expect(classify("totally-new-event")).toBe("realtime");
    expect(() =>
      createFrameCoalescer({
        name: "totally-new-event",
        lane: "background",
        onFlush: () => {},
      }),
    ).toThrow();
  });

  it("rejects a non-background lane", () => {
    expect(() =>
      createFrameCoalescer({
        name: "vpn::status-changed",
        lane: "realtime" as unknown as "background",
        onFlush: () => {},
      }),
    ).toThrow(/background/);
  });

  it("invalidateOnEvent refuses real-time events", () => {
    expect(() => queryStore.invalidateOnEvent("serial:output", "x")).toThrow();
  });
});

describe("realtimeChannel", () => {
  it("delivers synchronously with no timers and never counts as coalesced", () => {
    const got: string[] = [];
    const deliver = realtimeChannel<string>("ssh-output", (p) => got.push(p));
    deliver("a");
    deliver("b");
    // fake timers frozen: nothing advanced
    expect(got).toEqual(["a", "b"]);
    expect(vi.getTimerCount()).toBe(0);
    const counters = perfReport().counters;
    expect(counters["rt:ssh-output"]).toBe(2);
    expect(Object.keys(counters).some((k) => k.startsWith("coalesce."))).toBe(
      false,
    );
  });
});

describe("shared event bus", () => {
  it("uses one Tauri listener per event name and releases it with the last subscriber", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeEvent("vpn::status-changed", a);
    const offB = subscribeEvent("vpn::status-changed", b);
    await vi.advanceTimersByTimeAsync(0);
    expect(listeners.get("vpn::status-changed")).toHaveLength(1);
    expect(activeEventListeners()).toBe(1);
    listeners.get("vpn::status-changed")![0]({ payload: 5 });
    expect(a).toHaveBeenCalledWith(5);
    expect(b).toHaveBeenCalledWith(5);
    offA();
    expect(unlistenSpy).not.toHaveBeenCalled();
    offB();
    expect(unlistenSpy).toHaveBeenCalledWith("vpn::status-changed");
  });

  it("invalidateOnEvent invalidates tagged entries on a background event", async () => {
    await queryStore.get("vpn:list", async () => [1], {
      tags: ["vpn"],
      ttlMs: 60_000,
    });
    const off = queryStore.invalidateOnEvent("vpn::status-changed", {
      tag: "vpn",
    });
    await vi.advanceTimersByTimeAsync(0);
    listeners.get("vpn::status-changed")![0]({ payload: null });
    expect(queryStore.getSnapshot("vpn:list").status).toBe("stale");
    off();
    queryStore.clearAll();
  });
});
