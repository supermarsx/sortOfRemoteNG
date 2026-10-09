import React from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useInternalProxyManager,
  type ManagerTab,
} from "../../src/hooks/network/useInternalProxyManager";
import {
  BrowserSessionLogsTab,
  ProxyLogsTab,
  ProxyStatsTab,
} from "../../src/components/network/InternalProxyManager";
import {
  parseNativeBrowserDiagnostics,
  type NativeBrowserDiagnostics,
} from "../../src/types/network/nativeBrowserDiagnostics";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const command = "origin_browser_session_diagnostics";
const snapshot = (): NativeBrowserDiagnostics => ({
  available: true,
  sessions: [
    {
      identity: {
        connectionId: "connection-1",
        sessionId: "native-session",
        attemptId: "attempt-1",
      },
      phase: "attached",
      proxy: {
        state: "listening",
        acceptedConnections: 17,
        authenticationChallenges: 2,
        authenticatedRequests: 12,
        destinationDenials: 1,
        upstreamFailures: 3,
        requestRejections: 4,
        capacityRefusals: 5,
      },
    },
  ],
});
type Manager = ReturnType<typeof useInternalProxyManager>;
const manager = (data = snapshot()) =>
  ({
    nativeDiagnostics: data,
    nativeDiagnosticsError: "",
    nativeDiagnosticsLoading: false,
    sessions: [],
    requestLog: [],
    totalRequests: 0,
    totalErrors: 0,
    errorRate: "0.0",
    handleClearLog: vi.fn(),
  }) as unknown as Manager;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("native diagnostics scalar projection", () => {
  it("does not retain database IDs, source tokens, URLs, credentials, or native errors", () => {
    const data = snapshot();
    const raw = {
      ...data,
      rawError: "secret-error",
      sessions: [
        {
          ...data.sessions[0],
          currentUrl: "https://secret.invalid/?password=secret",
          title: "secret-title",
          sourceSessionId: "secret-token",
          identity: {
            ...data.sessions[0].identity,
            ownerDatabaseId: "secret-database",
          },
          proxy: { ...data.sessions[0].proxy, password: "secret-password" },
        },
      ],
    };
    const result = parseNativeBrowserDiagnostics(raw);
    expect(result).toEqual(data);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it.each([-1, 0x100000000, NaN, Infinity, 0.1, "1"])(
    "rejects invalid counters %s",
    (count) => {
      const data = snapshot();
      expect(() =>
        parseNativeBrowserDiagnostics({
          ...data,
          sessions: [
            {
              ...data.sessions[0],
              proxy: { ...data.sessions[0].proxy, acceptedConnections: count },
            },
          ],
        }),
      ).toThrow("Native browser diagnostics are unavailable.");
    },
  );
  it("bounds rows and rejects duplicate attempts or invalid identities/phases", () => {
    const data = snapshot();
    for (const sessions of [
      Array.from({ length: 65 }, () => data.sessions[0]),
      [data.sessions[0], data.sessions[0]],
      [{ ...data.sessions[0], phase: "secret-error" }],
      [
        {
          ...data.sessions[0],
          identity: {
            ...data.sessions[0].identity,
            sessionId: "https://secret.invalid",
          },
        },
      ],
    ])
      expect(() =>
        parseNativeBrowserDiagnostics({ available: true, sessions }),
      ).toThrow();
  });
  it("allows unavailable/busy snapshots and only known failed-phase reasons", () => {
    expect(
      parseNativeBrowserDiagnostics({ available: false, sessions: ["secret"] }),
    ).toEqual({ available: false, sessions: [] });
    const data = snapshot();
    const row = data.sessions[0];
    expect(
      parseNativeBrowserDiagnostics({
        ...data,
        sessions: [{ ...row, phase: null, proxy: null }],
      }).sessions[0],
    ).toMatchObject({ phase: null, proxy: null });
    for (const phase of ["failed", "attached"]) {
      const parsed = (reason: string) =>
        parseNativeBrowserDiagnostics({
          ...data,
          sessions: [{ ...row, phase, failureReason: reason }],
        }).sessions[0].failureReason;
      expect(parsed("raw secret error")).toBeUndefined();
      expect(parsed("redirect-denied")).toBe(
        phase === "failed" ? "redirect-denied" : undefined,
      );
    }
  });
});

describe("native proxy and browser panels", () => {
  it("labels native counters separately from the legacy HTTP request log", () => {
    const mgr = manager();
    mgr.requestLog = [
      {
        session_id: "legacy",
        method: "GET",
        url: "https://legacy.invalid/",
        status: 200,
        error: null,
        timestamp: "2026-10-09T00:00:00Z",
      },
    ];
    render(<ProxyLogsTab mgr={mgr} />);
    const native = within(
      screen.getByRole("region", { name: "Native CEF proxy diagnostics" }),
    );
    expect(native.getByText("17")).toBeInTheDocument();
    expect(
      native.getByText(/not HTTP page requests or status codes/),
    ).toBeInTheDocument();
    expect(native.queryByText("200")).not.toBeInTheDocument();
    expect(native.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Legacy HTTP proxy request log" }),
    ).toBeInTheDocument();
    expect(screen.getByText("https://legacy.invalid/")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear Log" }),
    ).toBeInTheDocument();
  });
  it("does not merge native proxy traffic into legacy total requests/errors", () => {
    render(<ProxyStatsTab mgr={manager()} />);
    expect(
      screen.getByRole("heading", { name: "Legacy HTTP proxy statistics" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Total Requests").parentElement).toHaveTextContent(
      "0Total Requests",
    );
    expect(
      screen.getByText("Authenticated proxy requests").parentElement,
    ).toHaveTextContent("12");
  });
  it("shows live browser identity and busy state without inventing a zero or journal history", () => {
    const data = snapshot();
    data.sessions[0].proxy = null;
    data.sessions[0].phase = null;
    render(<BrowserSessionLogsTab mgr={manager(data)} />);
    expect(screen.getByText("native-session")).toBeInTheDocument();
    expect(screen.getAllByText("Snapshot unavailable")).toHaveLength(2);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(
      screen.getByText(/historical failures are in Browser sessions/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("distinguishes no live owners from unsupported native observations", () => {
    const { rerender } = render(
      <BrowserSessionLogsTab
        mgr={manager({ available: true, sessions: [] })}
      />,
    );
    expect(
      screen.getByText("No observable native browser sessions in this window."),
    ).toBeInTheDocument();
    rerender(
      <BrowserSessionLogsTab
        mgr={manager({ available: false, sessions: [] })}
      />,
    );
    expect(
      screen.getByText(
        "Native browser diagnostics are unavailable in this build.",
      ),
    ).toBeInTheDocument();
  });
});

describe("visibility and owner-fenced native observation hook", () => {
  let hidden = false;
  const tick = async (ms = 0) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const nativeCalls = () =>
    invoke.mock.calls.filter(([name]) => name === command);
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
    hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    invoke.mockImplementation(async (name: string) =>
      name === command ? snapshot() : [],
    );
  });
  it.each<ManagerTab>(["logs", "stats", "browser-logs"])(
    "reads safe no-payload diagnostics for %s",
    async (view) => {
      const { result } = renderHook(() =>
        useInternalProxyManager(true, { view }),
      );
      await tick();
      expect(result.current.nativeDiagnostics).toEqual(snapshot());
      expect(nativeCalls()).toEqual([[command]]);
      expect(
        invoke.mock.calls.some(([name]) => name === "origin_browser_diagnose"),
      ).toBe(false);
      expect(result.current.sessions).toEqual([]); // no legacy stop/delete controls for CEF
      expect(result.current.totalRequests).toBe(0);
    },
  );
  it("does not read native diagnostics on the legacy sessions view or when closed/hidden", async () => {
    const { rerender } = renderHook(
      ({ open, view }) => useInternalProxyManager(open, { view }),
      { initialProps: { open: true, view: "sessions" as ManagerTab } },
    );
    await tick();
    rerender({ open: false, view: "logs" });
    await tick(30_000);
    expect(nativeCalls()).toHaveLength(0);
    hidden = true;
    rerender({ open: true, view: "stats" });
    await tick(30_000);
    expect(nativeCalls()).toHaveLength(0);
    hidden = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await tick();
    expect(nativeCalls()).toHaveLength(1);
  });
  it("keeps native observations when the independent legacy reader fails", async () => {
    invoke.mockImplementation(async (name: string) => {
      if (name === command) return snapshot();
      throw new Error("legacy unavailable");
    });
    const { result } = renderHook(() =>
      useInternalProxyManager(true, { view: "stats" }),
    );
    await tick();
    expect(result.current.nativeDiagnostics).toEqual(snapshot());
    expect(result.current.error).toBe("legacy unavailable");
    expect(result.current.nativeDiagnosticsError).toBe("");
  });
  it("clears failed native data, preserves legacy log, and never echoes raw native rejection text", async () => {
    const log = [
      {
        session_id: "legacy",
        method: "GET",
        url: "https://legacy.invalid",
        status: 200,
        error: null,
        timestamp: "2026-10-09",
      },
    ];
    let fail = false;
    invoke.mockImplementation(async (name: string) => {
      if (name === command) {
        if (fail) throw new Error("secret token or path");
        return snapshot();
      }
      return name === "get_proxy_request_log" ? log : [];
    });
    const { result } = renderHook(() =>
      useInternalProxyManager(true, { view: "logs" }),
    );
    await tick();
    expect(result.current.nativeDiagnostics).toBeDefined();
    fail = true;
    await act(async () => {
      await result.current.handleRefresh();
    });
    expect(result.current.nativeDiagnostics).toBeUndefined();
    expect(result.current.nativeDiagnosticsError).toContain("Refresh to retry");
    expect(result.current.nativeDiagnosticsError).not.toContain("secret");
    expect(result.current.error).toBe("");
    expect(result.current.requestLog).toEqual(log);
  });
  it("masks the previous scope immediately and ignores a raced native reply after owner invalidation", async () => {
    const { result, rerender } = renderHook(
      ({ owner }) =>
        useInternalProxyManager(true, {
          view: "stats",
          invalidationKey: owner,
        }),
      { initialProps: { owner: "a" } },
    );
    await tick();
    expect(result.current.nativeDiagnostics).toBeDefined();
    let resolve!: (value: NativeBrowserDiagnostics) => void;
    invoke.mockImplementation((name: string) =>
      name === command
        ? new Promise<NativeBrowserDiagnostics>((done) => {
            resolve = done;
          })
        : Promise.resolve([]),
    );
    rerender({ owner: "b" });
    expect(result.current.nativeDiagnostics).toBeUndefined();
    await tick(150);
    const staleResolve = resolve;
    rerender({ owner: "c" });
    await act(async () => {
      staleResolve(snapshot());
    });
    expect(result.current.nativeDiagnostics).toBeUndefined();
    await tick(150);
    await act(async () => {
      resolve({ available: true, sessions: [] });
    });
    expect(result.current.nativeDiagnostics?.sessions).toEqual([]);
  });
  it("masks data on close and does not adopt a pending reply after close", async () => {
    let resolve!: (value: NativeBrowserDiagnostics) => void;
    invoke.mockImplementation((name: string) =>
      name === command
        ? new Promise<NativeBrowserDiagnostics>((done) => {
            resolve = done;
          })
        : Promise.resolve([]),
    );
    const { result, rerender } = renderHook(
      ({ open }) => useInternalProxyManager(open, { view: "browser-logs" }),
      { initialProps: { open: true } },
    );
    await tick();
    rerender({ open: false });
    await act(async () => {
      resolve(snapshot());
    });
    expect(result.current.nativeDiagnostics).toBeUndefined();
    expect(result.current.nativeDiagnosticsError).toBe("");
  });
  it("preserves equal snapshot references during status refresh", async () => {
    const { result } = renderHook(() =>
      useInternalProxyManager(true, { view: "stats" }),
    );
    await tick();
    const before = result.current.nativeDiagnostics;
    await tick(15_000);
    expect(nativeCalls()).toHaveLength(2);
    expect(result.current.nativeDiagnostics).toBe(before);
  });
});
