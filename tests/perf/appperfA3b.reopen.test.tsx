import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useIdracManager } from "../../src/hooks/idrac/useIdracManager";
import { useProxmoxManager } from "../../src/hooks/proxmox/useProxmoxManager";
import { useServerStats } from "../../src/hooks/ssh/useServerStats";
import { useApplicationLogs } from "../../src/hooks/monitoring/useApplicationLogs";
import { useStableRows } from "../../src/hooks/perf/useStableRows";
import { useSharedNow } from "../../src/hooks/perf/useSharedTick";
import { queryStore } from "../../src/utils/perf/queryStore";
import {
  isMutatingCommand,
  swrLoad,
  invalidateDevice,
} from "../../src/utils/perf/swrLoad";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: { sessions: [] } }),
}));

const mockInvoke = vi.mocked(invoke);

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}
const calls = (prefix: string) =>
  mockInvoke.mock.calls.filter(([c]) => String(c).startsWith(prefix)).length;

describe("A3b swrLoad core", () => {
  beforeEach(() => queryStore.clearAll());

  it("applies cached synchronously, revalidates only when stale, keeps identity", async () => {
    const dev = { ns: "t", device: "h:1:u" };
    const fetcher = vi.fn(async () => ({ rows: [{ id: 1 }] }));
    const applied: unknown[] = [];
    await swrLoad(dev, "x", ["t_list_x"], fetcher, (v) => applied.push(v));
    expect(fetcher).toHaveBeenCalledTimes(1);
    // reopen inside ttl: cached applied, no fetch
    const again: unknown[] = [];
    await swrLoad(dev, "x", ["t_list_x"], fetcher, (v) => again.push(v));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(again).toHaveLength(1);
    expect(again[0]).toBe(applied[0]);
  });

  it("revalidated equal data is applied once with the same reference", async () => {
    const dev = { ns: "t", device: "h:1:u" };
    let n = 0;
    const fetcher = vi.fn(async () => ({ rows: [{ id: 1 }], n: ++n * 0 }));
    const first: unknown[] = [];
    await swrLoad(dev, "x", ["t_list_x"], fetcher, (v) => first.push(v), {
      ttlMs: 0,
    });
    const second: unknown[] = [];
    await swrLoad(dev, "x", ["t_list_x"], fetcher, (v) => second.push(v), {
      ttlMs: 0,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(second).toHaveLength(1); // cached applied; fresh was ===, not re-applied
    expect(second[0]).toBe(first[0]);
  });

  it("writes invalidate the device and never cache secret commands", async () => {
    const dev = { ns: "t", device: "h:1:u" };
    const fetcher = vi.fn(async () => [1]);
    await swrLoad(dev, "x", ["t_list_x"], fetcher, () => {});
    invalidateDevice(dev);
    await swrLoad(dev, "x", ["t_list_x"], fetcher, () => {});
    expect(fetcher).toHaveBeenCalledTimes(2);
    const secret = vi.fn(async () => ["s"]);
    await swrLoad(dev, "s", ["t_get_password"], secret, () => {});
    await swrLoad(dev, "s", ["t_get_password"], secret, () => {});
    expect(secret).toHaveBeenCalledTimes(2);
    expect(isMutatingCommand("idrac_power_action")).toBe(true);
    expect(isMutatingCommand("idrac_connect")).toBe(false);
    expect(isMutatingCommand("proxmox_list_nodes")).toBe(false);
  });
});

describe("A3b iDRAC reopen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryStore.clearAll();
    setHidden(false);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "idrac_get_dashboard") return { health: "OK" } as never;
      if (cmd === "idrac_get_config") return { host: "h" } as never;
      return undefined as never;
    });
  });

  it("second open: dashboard painted from cache, 0 reads inside ttl", async () => {
    const init = { host: "10.0.0.5", username: "root", password: "pw" };
    const first = renderHook(() => useIdracManager(true, init));
    await act(async () => {
      await first.result.current.connect();
    });
    await waitFor(() => expect(first.result.current.dashboard).toBeTruthy());
    const firstReads = calls("idrac_get_dashboard");
    expect(firstReads).toBe(1);
    first.unmount();

    mockInvoke.mockClear();
    const second = renderHook(() => useIdracManager(true, init));
    await act(async () => {
      await second.result.current.connect();
    });
    await waitFor(() => expect(second.result.current.dashboard).toBeTruthy());
    // before: 1 read per reopen; after: 0 (inside the 10 s fresh window)
    expect(calls("idrac_get_dashboard")).toBe(0);
    expect(second.result.current.dashboard).toEqual({ health: "OK" });
    second.unmount();
  });

  it("a write (power action) invalidates the device cache", async () => {
    const init = { host: "10.0.0.6", username: "root", password: "pw" };
    const a = renderHook(() => useIdracManager(true, init));
    await act(async () => {
      await a.result.current.connect();
    });
    await waitFor(() => expect(a.result.current.dashboard).toBeTruthy());
    await act(async () => {
      await a.result.current.executePowerAction("On" as never);
    });
    a.unmount();
    mockInvoke.mockClear();
    const b = renderHook(() => useIdracManager(true, init));
    await act(async () => {
      await b.result.current.connect();
    });
    await waitFor(() => expect(b.result.current.dashboard).toBeTruthy());
    expect(calls("idrac_get_dashboard")).toBe(1);
    b.unmount();
  });
});

describe("A3b Proxmox reopen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryStore.clearAll();
    setHidden(false);
  });

  it("refreshDashboard on reopen paints nodes from cache with 0 list reads", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "proxmox_list_nodes") return [{ node: "pve1" }] as never;
      if (cmd === "proxmox_list_qemu_vms") return [{ vmid: 100 }] as never;
      return [] as never;
    });
    const opts = { initial: { host: "pve.example", port: 8006 } } as never;
    const a = renderHook(() => useProxmoxManager(true, opts));
    await act(async () => {
      await a.result.current.refreshDashboard();
    });
    expect(calls("proxmox_list_nodes")).toBe(1);
    a.unmount();
    mockInvoke.mockClear();
    const b = renderHook(() => useProxmoxManager(true, opts));
    await act(async () => {
      await b.result.current.refreshDashboard();
    });
    expect(calls("proxmox_list_nodes")).toBe(0);
    expect(b.result.current.nodes).toEqual([{ node: "pve1" }]);
    b.unmount();
  });
});

describe("A3b hidden polls and stable rows", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    queryStore.clearAll();
    setHidden(false);
    mockInvoke.mockResolvedValue(undefined as never);
  });
  afterEach(() => {
    setHidden(false);
    vi.useRealTimers();
  });

  it("useServerStats auto-refresh timer is paused while hidden", async () => {
    const { result, unmount } = renderHook(() => useServerStats(true));
    act(() => result.current.setAutoRefreshInterval(5));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
  });

  it("useApplicationLogs 1.5 s poll: 0 invokes and 0 timers while hidden", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "application_logs_list")
        return { files: [], truncated: false } as never;
      return undefined as never;
    });
    const { unmount } = renderHook(() =>
      useApplicationLogs("app" as never, true),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    setHidden(true);
    mockInvoke.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(calls("application_logs")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it("useSharedNow: one shared timer for N consumers, none when disabled/hidden", async () => {
    const hooks = [1, 2, 3].map(() => renderHook(() => useSharedNow(true)));
    const off = renderHook(() => useSharedNow(false));
    expect(vi.getTimerCount()).toBe(1);
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    hooks.forEach((h) => h.unmount());
    off.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("useStableRows keeps identity for unchanged rows across polls", () => {
    type Row = { uid: string; n: number };
    let data: Row[] = [
      { uid: "a", n: 1 },
      { uid: "b", n: 1 },
    ];
    const { result, rerender } = renderHook(() =>
      useStableRows(
        data.map((r) => ({ ...r })),
        (r) => r.uid,
      ),
    );
    const first = result.current;
    rerender(); // poll rebuilt every row, nothing changed
    expect(result.current).toBe(first);
    data = [
      { uid: "a", n: 1 },
      { uid: "b", n: 2 },
    ];
    rerender();
    expect(result.current).not.toBe(first);
    expect(result.current[0]).toBe(first[0]);
    expect(result.current[1]).not.toBe(first[1]);
  });
});
