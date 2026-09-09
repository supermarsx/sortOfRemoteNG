import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";
import { useUnifiedSessionManager } from "../../src/hooks/session/useUnifiedSessionManager";
import { useVisibleSessionRefresh } from "../../src/hooks/session/useVisibleSessionRefresh";
import { useSessionObservationActivity } from "../../src/hooks/session/useSessionObservationActivity";

const fixture = vi.hoisted(() => ({
  sessions: [] as ConnectionSession[],
  invoke: vi.fn(),
  minimized: vi.fn(),
  focus: undefined as undefined | (() => void),
  resize: undefined as undefined | (() => void),
  onFocus: vi.fn(),
  onResize: vi.fn(),
  disposeFocus: vi.fn(),
  disposeResize: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMinimized: fixture.minimized,
    onFocusChanged: fixture.onFocus,
    onResized: fixture.onResize,
  }),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { sessions: fixture.sessions },
    dispatch: vi.fn(),
  }),
}));
const CONNECTIONS: never[] = [];
const BACKENDS: string[] = [];
const rdp = {
  id: "rdp",
  host: "fixture",
  port: 3389,
  username: "fixture",
  connected: true,
  desktop_width: 800,
  desktop_height: 600,
};
const proxy = {
  session_id: "proxy",
  target_url: "https://fixture.invalid/",
  username: "",
  proxy_url: "http://127.0.0.1/",
  created_at: "2026-09-01",
  request_count: 3,
  error_count: 0,
  last_error: null,
};
const ssh = {
  id: "ssh",
  config: { host: "fixture", port: 22, username: "fixture" },
  connected_at: "2026-09-01",
  last_activity: "2026-09-01",
  is_alive: true,
};
const calls = (name: string) =>
  fixture.invoke.mock.calls.filter(([command]) => command === name).length;
let hidden = false;
const tick = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const changeVisibility = async (next: boolean) => {
  hidden = next;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  fixture.sessions = [];
  fixture.minimized.mockResolvedValue(false);
  fixture.onFocus.mockImplementation(async (callback: () => void) => {
    fixture.focus = callback;
    return fixture.disposeFocus;
  });
  fixture.onResize.mockImplementation(async (callback: () => void) => {
    fixture.resize = callback;
    return fixture.disposeResize;
  });
  fixture.invoke.mockImplementation(async (command: string) => {
    if (command === "list_rdp_sessions") return [{ ...rdp }];
    if (command === "get_rdp_stats")
      return {
        session_id: "rdp",
        uptime_secs: 15,
        bytes_received: 2,
        bytes_sent: 1,
      };
    if (command === "list_sessions") return [structuredClone(ssh)];
    if (command === "get_proxy_session_details") return [{ ...proxy }];
    if (command === "get_proxy_request_log")
      return [
        {
          session_id: "proxy",
          method: "GET",
          url: "https://fixture.invalid",
          status: 200,
          error: null,
          timestamp: "2026-09-01",
        },
      ];
    return [];
  });
});
afterEach(() => {
  cleanup();
  delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("automatic Session Manager observation", () => {
  it("reports current proxy health without treating historical errors as active failures", async () => {
    const original = fixture.invoke.getMockImplementation()!;
    fixture.invoke.mockImplementation((command: string) =>
      command === "get_proxy_session_details"
        ? Promise.resolve([{ ...proxy, error_count: 4, last_error: null }])
        : original(command),
    );
    const view = renderHook(() =>
      useUnifiedSessionManager({
        isVisible: true,
        connections: CONNECTIONS,
        activeBackendSessionIds: BACKENDS,
        thumbnailsEnabled: false,
      }),
    );
    await tick();
    expect(view.result.current.proxyRows[0]).toMatchObject({
      status: "connected",
      proxySession: { error_count: 4, last_error: null },
    });
  });

  it("keeps equal snapshots stable, has no 3s polling, and fetches logs only in their view", async () => {
    const view = renderHook(
      ({
        activeView,
      }: {
        activeView: "sessions" | "proxy-logs" | "proxy-stats" | "ssh-sessions";
      }) =>
        useUnifiedSessionManager({
          isVisible: true,
          connections: CONNECTIONS,
          activeBackendSessionIds: BACKENDS,
          thumbnailsEnabled: false,
          activeView,
        }),
      { initialProps: { activeView: "sessions" } },
    );
    await tick();
    expect(calls("get_proxy_request_log")).toBe(0);
    const snapshots = {
      rdp: view.result.current.rdp.sessions,
      ssh: view.result.current.ssh.sessions,
      proxy: view.result.current.proxy.sessions,
    };
    await tick(3000);
    expect(calls("list_rdp_sessions")).toBe(1);
    await tick(12_000);
    expect(calls("list_rdp_sessions")).toBe(2);
    expect(view.result.current.rdp.sessions).toBe(snapshots.rdp);
    expect(view.result.current.ssh.sessions).toBe(snapshots.ssh);
    expect(view.result.current.proxy.sessions).toBe(snapshots.proxy);
    expect(view.result.current.isLoading).toBe(false);
    view.rerender({ activeView: "proxy-logs" });
    await tick(150);
    expect(calls("get_proxy_request_log")).toBe(1);
    await tick(15_000);
    expect(calls("list_rdp_sessions")).toBe(2);
    expect(calls("list_sessions")).toBe(2);
    expect(calls("get_rdp_stats")).toBe(2);
    view.rerender({ activeView: "proxy-stats" });
    await tick(150);
    const logCount = calls("get_proxy_request_log");
    await tick(15_000);
    expect(calls("get_proxy_request_log")).toBe(logCount);
    view.rerender({ activeView: "ssh-sessions" });
    const count = fixture.invoke.mock.calls.length;
    await tick(60_000);
    expect(fixture.invoke.mock.calls).toHaveLength(count);
  });
  it("pauses every source while hidden and coalesces lifecycle changes without reacting to metrics", async () => {
    const view = renderHook(() =>
      useUnifiedSessionManager({
        isVisible: true,
        connections: CONNECTIONS,
        activeBackendSessionIds: BACKENDS,
        thumbnailsEnabled: false,
      }),
    );
    await tick();
    await changeVisibility(true);
    const count = fixture.invoke.mock.calls.length;
    await tick(60_000);
    expect(fixture.invoke.mock.calls).toHaveLength(count);
    await changeVisibility(false);
    await tick();
    expect(calls("list_sessions")).toBe(2);
    fixture.sessions = [
      {
        id: "new",
        connectionId: "saved",
        name: "New",
        hostname: "fixture",
        protocol: "ssh",
        status: "connecting",
        startTime: new Date(),
      },
    ];
    view.rerender();
    fixture.sessions = [{ ...fixture.sessions[0], status: "connected" }];
    view.rerender();
    await tick(150);
    expect(calls("list_sessions")).toBe(3);
    fixture.sessions = [
      {
        ...fixture.sessions[0],
        metrics: { connectionTime: 1, dataTransferred: 50 },
      },
    ];
    view.rerender();
    await tick(150);
    expect(calls("list_sessions")).toBe(3);
    view.unmount();
    const finalCount = fixture.invoke.mock.calls.length;
    await tick(60_000);
    expect(fixture.invoke.mock.calls).toHaveLength(finalCount);
  });
  it("does not overlap pending work or apply an old hidden activation's result", async () => {
    const resolvers: Array<() => void> = [];
    const applied: number[] = [];
    const load = vi.fn(async (lease: { isCurrent(): boolean }) => {
      const index = resolvers.length;
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      if (lease.isCurrent()) applied.push(index);
    });
    const view = renderHook(
      ({ enabled }) => useVisibleSessionRefresh({ enabled, load }),
      { initialProps: { enabled: true } },
    );
    await tick(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    view.rerender({ enabled: false });
    view.rerender({ enabled: true });
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => resolvers[0]());
    expect(load).toHaveBeenCalledTimes(2);
    expect(applied).toEqual([]);
    await act(async () => resolvers[1]());
    expect(applied).toEqual([1]);
    await tick(15_000);
    expect(load).toHaveBeenCalledTimes(3);
    view.unmount();
    await act(async () => resolvers[2]());
    expect(applied).toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("queues one new request when lifecycle invalidations arrive during a slow read", async () => {
    let release!: () => void;
    const applied: string[] = [];
    const load = vi.fn(async (lease: { isCurrent(): boolean }) => {
      if (load.mock.calls.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (lease.isCurrent()) applied.push("fresh");
    });
    const view = renderHook(
      ({ key }) =>
        useVisibleSessionRefresh({ enabled: true, load, invalidationKey: key }),
      { initialProps: { key: "one" } },
    );
    let refreshed = false;
    act(() => {
      void view.result.current.refresh().then(() => {
        refreshed = true;
      });
    });
    view.rerender({ key: "two" });
    view.rerender({ key: "three" });
    await tick(150);
    expect(load).toHaveBeenCalledTimes(1);
    expect(refreshed).toBe(false);
    await act(async () => release());
    expect(load).toHaveBeenCalledTimes(2);
    expect(applied).toEqual(["fresh"]);
    expect(refreshed).toBe(true);
  });
  it("retries after a failed refresh without overlapping or remaining busy", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("fixture failure"))
      .mockResolvedValue(undefined);
    const view = renderHook(() =>
      useVisibleSessionRefresh({ enabled: true, load }),
    );
    await tick();
    await tick(15_000);
    expect(load).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles an explicitly invalidated manual refresh even with polling disabled", async () => {
    let release!: () => void;
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const view = renderHook(() =>
      useVisibleSessionRefresh({ enabled: true, load, intervalMs: 0 }),
    );
    let completed = false;
    act(() => {
      void view.result.current.refresh().then(() => {
        completed = true;
      });
    });
    expect(completed).toBe(false);
    await act(async () => view.result.current.invalidate());
    expect(completed).toBe(true);
    await act(async () => release());
    await tick(60_000);
    expect(load).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("native minimized-window observation", () => {
  const enableNativeFixture = () =>
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  it("coalesces resize bursts, serializes native reads and resumes on focus restoration", async () => {
    enableNativeFixture();
    const view = renderHook(() => useSessionObservationActivity(true));
    await tick();
    expect(fixture.minimized).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 100; i++) fixture.resize?.();
    await tick(149);
    expect(fixture.minimized).toHaveBeenCalledTimes(1);
    let release!: (value: boolean) => void;
    fixture.minimized.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    await tick(1);
    expect(fixture.minimized).toHaveBeenCalledTimes(2);
    fixture.minimized.mockResolvedValue(true);
    for (let i = 0; i < 100; i++) fixture.resize?.();
    await tick(150);
    expect(fixture.minimized).toHaveBeenCalledTimes(2);
    await act(async () => release(false));
    expect(fixture.minimized).toHaveBeenCalledTimes(3);
    expect(view.result.current).toBe(false);
    fixture.minimized.mockResolvedValue(false);
    await act(async () => fixture.focus?.());
    expect(view.result.current).toBe(true);
    view.unmount();
    expect(fixture.disposeFocus).toHaveBeenCalledOnce();
    expect(fixture.disposeResize).toHaveBeenCalledOnce();
  });
  it("disposes listeners that finish registering after unmount and cancels pending resize work", async () => {
    enableNativeFixture();
    let registerResize!: (dispose: () => void) => void;
    fixture.onResize.mockImplementation((callback: () => void) => {
      fixture.resize = callback;
      return new Promise<() => void>((resolve) => {
        registerResize = resolve;
      });
    });
    const view = renderHook(() => useSessionObservationActivity(true));
    await tick();
    fixture.resize?.();
    view.unmount();
    await act(async () => registerResize(fixture.disposeResize));
    await tick(1000);
    expect(fixture.minimized).toHaveBeenCalledTimes(1);
    expect(fixture.disposeFocus).toHaveBeenCalledOnce();
    expect(fixture.disposeResize).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
