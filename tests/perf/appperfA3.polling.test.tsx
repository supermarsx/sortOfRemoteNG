import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useDashboard } from "../../src/hooks/monitoring/useDashboard";
import { useLenovo } from "../../src/hooks/hardware/useLenovo";
import { useSupermicro } from "../../src/hooks/hardware/useSupermicro";
import { useIlo } from "../../src/hooks/hardware/useIlo";
import { queryStore } from "../../src/utils/perf/queryStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockInvoke = vi.mocked(invoke);

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function calls(prefix: string) {
  return mockInvoke.mock.calls.filter(([c]) => String(c).startsWith(prefix))
    .length;
}

describe("A3 polling adoption: pause when hidden, catch-up on return", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    queryStore.clearAll();
    setHidden(false);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd.endsWith("check_session")) return true as never;
      if (cmd === "dash_get_all_health") return [] as never;
      return undefined as never;
    });
  });
  afterEach(() => {
    setHidden(false);
    vi.useRealTimers();
  });

  it("useDashboard auto-refresh: no timers or invokes while hidden", async () => {
    const { unmount } = renderHook(() => useDashboard());
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    mockInvoke.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(calls("dash_")).toBe(0);
    // one catch-up (not 4 missed ticks) on return
    setHidden(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(calls("dash_get_state")).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["lenovo", useLenovo, "lenovo_check_session"],
    ["supermicro", useSupermicro, "smc_check_session"],
  ] as const)("%s auto-refresh: paused while hidden", async (_n, hook, cmd) => {
    const { result, unmount } = renderHook(() => hook());
    act(() => result.current.startAutoRefresh(1000));
    setHidden(true);
    mockInvoke.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(calls(cmd)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(calls(cmd)).toBe(1);
    act(() => result.current.stopAutoRefresh());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ilo auto-refresh: stop clears the timer", async () => {
    const { result, unmount } = renderHook(() => useIlo());
    act(() => result.current.startAutoRefresh(1000));
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    expect(vi.getTimerCount()).toBe(1);
    act(() => result.current.stopAutoRefresh());
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });
});

describe("A3 baseline: dashboard open dedupes identical reads", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    queryStore.clearAll();
    setHidden(false);
    mockInvoke.mockResolvedValue([] as never);
  });
  afterEach(() => vi.useRealTimers());

  it("three consumers fetching dash_get_all_health within TTL send one invoke", async () => {
    const a = renderHook(() => useDashboard());
    const b = renderHook(() => useDashboard());
    const c = renderHook(() => useDashboard());
    await act(async () => {
      await Promise.all([
        a.result.current.fetchAllHealth(),
        b.result.current.fetchAllHealth(),
        c.result.current.fetchAllHealth(),
      ]);
    });
    expect(calls("dash_get_all_health")).toBe(1);
  });
});
