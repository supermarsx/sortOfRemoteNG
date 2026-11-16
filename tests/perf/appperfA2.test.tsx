import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { invoke } from "@tauri-apps/api/core";
import { useRDPSessionManager } from "../../src/hooks/rdp/useRdpSessionManager";
import { useSessionThumbnails } from "../../src/hooks/rdp/useSessionThumbnails";
import { queryStore } from "../../src/utils/perf/queryStore";
import { setLockState, registerCache } from "../../src/utils/perf/safety";
import { schedulePreload } from "../../src/utils/perf/preloadScheduler";
import { panelIntent } from "../../src/utils/perf/preloadPlan";
import PerfOverlay from "../../src/components/debug/PerfOverlay";
import { setPerfEnabled } from "../../src/utils/perf/metrics";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
// The factory runs when the chunk is first imported, i.e. when the preload ran.
const settingsLoaded = vi.fn();
vi.mock("../../src/components/SettingsDialog", () => {
  settingsLoaded();
  return { SettingsDialog: () => null };
});

const mockInvoke = vi.mocked(invoke);

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}
const calls = (name: string) =>
  mockInvoke.mock.calls.filter(([c]) => c === name).length;

const rdp = (id: string) => ({
  id,
  host: `h-${id}`,
  port: 3389,
  username: "u",
  connected: true,
  desktop_width: 1920,
  desktop_height: 1080,
});
const stats = (id: string) => ({
  session_id: id,
  uptime_secs: 5,
  bytes_received: 1,
  bytes_sent: 1,
  pdus_received: 1,
  pdus_sent: 1,
  frame_count: 1,
  fps: 30,
  input_events: 0,
  errors_recovered: 0,
  reactivations: 0,
  phase: "active",
});

beforeEach(() => {
  vi.useFakeTimers();
  mockInvoke.mockReset();
  setHidden(false);
});
afterEach(() => {
  cleanup();
  setHidden(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setPerfEnabled(undefined);
  setLockState("unknown");
  queryStore.clearAll();
});

describe("A2 RDP session list polling", () => {
  const sessions = ["a", "b", "c", "d", "e"].map(rdp);
  const wire = () =>
    mockInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "list_rdp_sessions") return sessions.map((s) => ({ ...s }));
      if (cmd === "get_rdp_stats")
        return stats((args as { sessionId: string }).sessionId);
      return undefined;
    });

  it("hidden window: 0 invokes and 0 timers (was one poll per 3 s), one catch-up on return", async () => {
    wire();
    renderHook(() => useRDPSessionManager(true));
    await act(() => vi.advanceTimersByTimeAsync(10));
    const base = mockInvoke.mock.calls.length;
    expect(base).toBe(1 + sessions.length);
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(mockInvoke.mock.calls.length).toBe(base);
    setHidden(false);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(calls("list_rdp_sessions")).toBe(2); // exactly one catch-up
  });

  it("stats reads run in parallel (all issued before any resolves)", async () => {
    let inFlight = 0;
    let peak = 0;
    mockInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "list_rdp_sessions") return sessions.map((s) => ({ ...s }));
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return stats((args as { sessionId: string }).sessionId);
    });
    renderHook(() => useRDPSessionManager(true));
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(peak).toBe(sessions.length); // was 1 (sequential)
  });

  it("poll with unchanged rows keeps row/stats identity (0 data re-renders)", async () => {
    wire();
    const { result } = renderHook(() => useRDPSessionManager(true));
    await act(() => vi.advanceTimersByTimeAsync(10));
    const rows = result.current.sessions;
    const statsMap = result.current.statsMap;
    await act(() => vi.advanceTimersByTimeAsync(6100));
    expect(calls("list_rdp_sessions")).toBeGreaterThanOrEqual(3);
    expect(result.current.sessions).toBe(rows);
    expect(result.current.statsMap).toBe(statsMap);
  });
});

describe("A2 adaptive thumbnail polling", () => {
  beforeEach(() => {
    mockInvoke.mockImplementation(async () => new ArrayBuffer(160 * 90 * 4));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { putImageData: vi.fn() };
        }
        convertToBlob() {
          return Promise.resolve(new Blob());
        }
      },
    );
    vi.stubGlobal("ImageData", class {});
    let n = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:t-${++n}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  const list = [rdp("a"), rdp("b"), rdp("c")];

  it("captures only tiles that are visible", async () => {
    renderHook(() => useSessionThumbnails(list, 5000, true, new Set(["b"])));
    await act(() => vi.advanceTimersByTimeAsync(20));
    const ids = mockInvoke.mock.calls.map(
      (c) => (c[1] as { sessionId: string }).sessionId,
    );
    expect(ids).toEqual(["b"]); // was a,b,c
  });

  it("unfocused window refreshes at 1/4 rate and catches up on focus", async () => {
    renderHook(() => useSessionThumbnails([rdp("a")], 5000, true));
    await act(() => vi.advanceTimersByTimeAsync(20));
    const minute = async () => {
      mockInvoke.mockClear();
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      return mockInvoke.mock.calls.length;
    };
    const focusedCount = await minute();
    window.dispatchEvent(new Event("blur"));
    const blurredCount = await minute();
    expect(focusedCount).toBeGreaterThanOrEqual(11);
    expect(blurredCount).toBeLessThanOrEqual(Math.ceil(focusedCount / 4));
    await act(() => vi.advanceTimersByTimeAsync(6000));
    mockInvoke.mockClear();
    window.dispatchEvent(new Event("focus"));
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(mockInvoke.mock.calls.length).toBe(1); // one catch-up
  });

  it("window hidden: no thumbnail timers fire", async () => {
    renderHook(() => useSessionThumbnails([rdp("a")], 5000, true));
    await act(() => vi.advanceTimersByTimeAsync(20));
    setHidden(true);
    mockInvoke.mockClear();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("A8 intent preload + lock", () => {
  it("hover prefetches the panel chunk after the debounce; leaving first cancels", async () => {
    settingsLoaded.mockClear();
    const handlers = panelIntent("settings");
    handlers.onPointerEnter();
    handlers.onPointerLeave();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(settingsLoaded).not.toHaveBeenCalled();
    handlers.onPointerEnter();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(settingsLoaded).toHaveBeenCalledTimes(1);
    expect(panelIntent("settings")).toBe(handlers); // stable object
  });

  it("lock clears every registered cache synchronously; unlock-gated preloads run only after unlock", async () => {
    const clear = vi.fn();
    registerCache("a2-test", { clear });
    queryStore.set("t:k", { id: 1 });
    setLockState("unlocked");
    setLockState("locked");
    expect(queryStore.peek("t:k")).toBeUndefined();
    expect(clear).toHaveBeenCalledTimes(1);

    const run = vi.fn();
    schedulePreload({ id: "a2:docs", requires: "unlocked", run });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(run).not.toHaveBeenCalled(); // locked
    setLockState("unknown");
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(run).not.toHaveBeenCalled(); // unknown is not unlocked
    setLockState("unlocked");
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("A8 PerfOverlay reachability", () => {
  it("renders nothing without the flag, counters with it; installs __sorngPerf", () => {
    setPerfEnabled(false);
    const off = render(<PerfOverlay />);
    expect(off.queryByTestId("perf-overlay")).toBeNull();
    off.unmount();
    setPerfEnabled(true);
    const on = render(<PerfOverlay />);
    expect(on.getByTestId("perf-overlay")).toBeTruthy();
    expect(
      typeof (window as unknown as { __sorngPerf?: { report: unknown } })
        .__sorngPerf?.report,
    ).toBe("function");
  });

  it("App mounts it only behind a NODE_ENV guard (not in production bundles)", () => {
    const src = readFileSync("src/App.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(src).toMatch(
      /process\.env\.NODE_ENV !== "production"\s*\?\s*dynamic\(\(\) => import\("\.\/components\/debug\/PerfOverlay"\)/,
    );
    expect(src).toContain("{PerfOverlay && <PerfOverlay />}");
  });
});
