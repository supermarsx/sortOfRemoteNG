import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNativeBrowserDownloads } from "../../src/hooks/protocol/useNativeBrowserDownloads";
import { useCoalescedEvent } from "../../src/hooks/perf/useCoalescedEvent";
import {
  createRingStore,
  BROWSER_LOG_CAPACITY,
} from "../../src/utils/browser/browserEventLog";
import { classify } from "../../src/utils/perf/laneRegistry";

const transport = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  handlers: new Map<string, (e: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: transport.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: transport.listen }));

afterEach(cleanup);
beforeEach(() => {
  transport.handlers.clear();
  transport.invoke.mockReset().mockResolvedValue([]);
  transport.listen.mockReset().mockImplementation(async (name, cb) => {
    transport.handlers.set(name, cb);
    return () => transport.handlers.delete(name);
  });
});

const BURST = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("A5/A6 burst budget (100 events)", () => {
  it("classifies the newly coalesced feeds as background", () => {
    for (const n of [
      "origin-browser-download",
      "browser-log-entries",
      "proxy-log-entries",
    ])
      expect(classify(n)).toBe("background");
    // real-time browser state stays real-time
    expect(classify("origin-browser-state")).toBe("realtime");
    expect(classify("origin-browser-login-activity")).toBe("realtime");
  });

  it("ring store: baseline notifies per push, coalesced notifies once per burst", async () => {
    const legacy = createRingStore<number>(BROWSER_LOG_CAPACITY);
    const fast = createRingStore<number>(
      BROWSER_LOG_CAPACITY,
      "browser-log-entries",
    );
    const a = vi.fn();
    const b = vi.fn();
    legacy.subscribe(a);
    fast.subscribe(b);
    for (let i = 0; i < BURST; i++) {
      legacy.push(i);
      fast.push(i);
    }
    // snapshots are synchronous and complete
    expect(fast.getSnapshot()).toHaveLength(BURST);
    expect(fast.getSnapshot()).toBe(fast.getSnapshot());
    await sleep(60);
    expect(a).toHaveBeenCalledTimes(BURST); // BASELINE
    expect(b.mock.calls.length).toBeLessThanOrEqual(7); // AFTER
    expect(b.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < BROWSER_LOG_CAPACITY + 10; i++) fast.push(i);
    expect(fast.getSnapshot()).toHaveLength(BROWSER_LOG_CAPACITY);
    fast.clear();
    expect(fast.getSnapshot()).toHaveLength(0);
  });

  it("download progress: renders per 100-event burst <= 7", async () => {
    const identity = {
      ownerDatabaseId: "db",
      connectionId: "c",
      sessionId: "s",
      attemptId: "a",
    };
    let renders = 0;
    renderHook(() => {
      renders++;
      return useNativeBrowserDownloads(identity, true, () => {});
    });
    await waitFor(() =>
      expect(transport.handlers.has("origin-browser-download")).toBe(true),
    );
    await waitFor(() => expect(transport.invoke).toHaveBeenCalled());
    await sleep(30);
    const before = renders;
    const fire = transport.handlers.get("origin-browser-download")!;
    await act(async () => {
      for (let i = 1; i <= BURST; i++)
        fire({
          payload: {
            identity,
            downloadId: 1,
            sequence: i,
            fileName: "f.bin",
            status: "in-progress",
            receivedBytes: i,
            totalBytes: 1000,
            bytesPerSecond: 1,
            canPause: true,
            canResume: false,
            canCancel: true,
            canReveal: false,
          },
        });
      await sleep(60);
    });
    const used = renders - before;
    expect(used).toBeGreaterThanOrEqual(1);
    expect(used).toBeLessThanOrEqual(7); // baseline was 100
  });

  it("vpn status: 100 events trigger one refresh", async () => {
    const refresh = vi.fn();
    renderHook(() =>
      useCoalescedEvent<unknown>("vpn::status-changed", refresh, {
        kind: "count",
        ms: 250,
      }),
    );
    await waitFor(() =>
      expect(transport.handlers.has("vpn::status-changed")).toBe(true),
    );
    const fire = transport.handlers.get("vpn::status-changed")!;
    for (let i = 0; i < BURST; i++) fire({ payload: i });
    await sleep(400);
    expect(refresh).toHaveBeenCalledTimes(1); // baseline 100
  });
});
