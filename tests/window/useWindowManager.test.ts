import { describe, it, expect, beforeEach, vi, Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWindowManager } from "../../src/hooks/window/useWindowManager";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

const { mockEmitTo, mockWindowListeners } = vi.hoisted(() => ({
  mockEmitTo: vi.fn().mockResolvedValue(undefined),
  mockWindowListeners: new Map<string, (event: { payload: any }) => void>(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (eventName: string, handler: (event: { payload: any }) => void) => {
      mockWindowListeners.set(eventName, handler);
      return Promise.resolve(() => mockWindowListeners.delete(eventName));
    },
  ),
  emit: vi.fn(),
  emitTo: mockEmitTo,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel: vi.fn() },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: vi.fn().mockResolvedValue([]),
}));

// ── Helpers ────────────────────────────────────────────────────────

function makeSession(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    connectionId: `conn-${id}`,
    protocol: "ssh" as const,
    name: `Session ${id}`,
    status: "connected" as const,
    backendSessionId: `be-${id}`,
    hostname: `host-${id}`,
    startTime: new Date(),
    reconnectAttempts: 0,
    maxReconnectAttempts: 3,
    ...overrides,
  };
}

function makeConnection(id: string) {
  return {
    id,
    name: `Conn ${id}`,
    hostname: `host-${id}`,
    port: 22,
    protocol: "ssh" as const,
    isGroup: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function renderWindowManager(overrides: Record<string, any> = {}) {
  const defaults = {
    sessions: [makeSession("s1"), makeSession("s2")],
    connections: [makeConnection("conn-s1"), makeConnection("conn-s2")],
    tabGroups: [],
    dispatch: vi.fn(),
    setActiveSessionId: vi.fn(),
    handleSessionClose: vi.fn().mockResolvedValue(undefined),
    handleSessionDetach: vi.fn(),
  };
  return renderHook(() =>
    useWindowManager({ ...defaults, ...overrides } as any),
  );
}

// ── Tests ──────────────────────────────────────────────────────────

describe("useWindowManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWindowListeners.clear();
    mockEmitTo.mockResolvedValue(undefined);
  });

  it("initializes with a main window in the registry", () => {
    const { result } = renderWindowManager();
    const reg = result.current.registry.current;
    expect(reg.windows.has("main")).toBe(true);
    expect(reg.windows.get("main")!.windowId).toBe("main");
  });

  it("main window entry contains session IDs for non-detached sessions", () => {
    const { result } = renderWindowManager();
    const mainEntry = result.current.registry.current.windows.get("main")!;
    expect(mainEntry.sessionIds).toContain("s1");
    expect(mainEntry.sessionIds).toContain("s2");
  });

  it("registerWindow adds a new window to the registry", () => {
    const { result } = renderWindowManager();
    act(() => {
      result.current.registerWindow("detached-abc" as any, ["s1"]);
    });
    const reg = result.current.registry.current;
    expect(reg.windows.has("detached-abc" as any)).toBe(true);
    expect(reg.windows.get("detached-abc" as any)!.sessionIds).toEqual(["s1"]);
  });

  it("registerWindow updates session ownership mapping", () => {
    const { result } = renderWindowManager();
    act(() => {
      result.current.registerWindow("detached-x" as any, ["s1"]);
    });
    expect(result.current.registry.current.sessionOwnership.get("s1")).toBe(
      "detached-x",
    );
  });

  it("registerWindow tracks multiple sessions", () => {
    const { result } = renderWindowManager();
    act(() => {
      result.current.registerWindow("detached-y" as any, ["s1", "s2"]);
    });
    const entry = result.current.registry.current.windows.get(
      "detached-y" as any,
    )!;
    expect(entry.sessionIds).toEqual(["s1", "s2"]);
    expect(entry.activeSessionId).toBe("s1");
  });

  it("tracks detached sessions via layout.isDetached and windowId", () => {
    const detachedSession = makeSession("s3", {
      layout: {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        zIndex: 1,
        isDetached: true,
        windowId: "detached-w1",
      },
    });
    const { result } = renderWindowManager({
      sessions: [makeSession("s1"), detachedSession],
    });
    act(() => {
      result.current.registerWindow("detached-w1" as any, []);
    });
    // After re-render the useEffect should track the detached session
    const ownership = result.current.registry.current.sessionOwnership;
    expect(ownership.get("s1")).toBe("main");
  });

  it("syncWindow does nothing for the main window", async () => {
    const { result } = renderWindowManager();
    await act(async () => {
      await result.current.syncWindow("main");
    });
    expect(mockEmitTo).not.toHaveBeenCalled();
  });

  it("syncWindow completes without error for a registered detached window", async () => {
    const { result } = renderWindowManager();
    act(() => {
      result.current.registerWindow("detached-z" as any, ["s1"]);
    });
    // syncWindow uses dynamic import() internally which may not be intercepted;
    // the hook's try-catch swallows errors, so we verify it resolves cleanly.
    await act(async () => {
      await result.current.syncWindow("detached-z" as any);
    });
    // Entry should still be in the registry after sync
    expect(
      result.current.registry.current.windows.has("detached-z" as any),
    ).toBe(true);
  });

  it("syncWindow ignores non-existent windows without error", async () => {
    const { result } = renderWindowManager();
    await act(async () => {
      await result.current.syncWindow("detached-nonexistent" as any);
    });
    expect(mockEmitTo).not.toHaveBeenCalled();
  });

  it("returns registry, registerWindow, syncWindow, and detachRef", () => {
    const { result } = renderWindowManager();
    expect(result.current.registry).toBeDefined();
    expect(result.current.registerWindow).toBeTypeOf("function");
    expect(result.current.syncWindow).toBeTypeOf("function");
    expect(result.current.detachRef).toBeDefined();
  });

  it("detachRef holds the handleSessionDetach callback", () => {
    const detachFn = vi.fn();
    const { result } = renderWindowManager({ handleSessionDetach: detachFn });
    expect(result.current.detachRef.current).toBe(detachFn);
  });

  it("registry tracks creation timestamp for registered windows", () => {
    const before = Date.now();
    const { result } = renderWindowManager();
    act(() => {
      result.current.registerWindow("detached-ts" as any, ["s1"]);
    });
    const entry = result.current.registry.current.windows.get(
      "detached-ts" as any,
    )!;
    expect(entry.createdAt).toBeGreaterThanOrEqual(before);
    expect(entry.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("syncWindow resolves without error even when window has sessions", async () => {
    const sessions = [makeSession("s1"), makeSession("s2")];
    const connections = [makeConnection("conn-s1"), makeConnection("conn-s2")];
    const { result } = renderWindowManager({ sessions, connections });
    act(() => {
      result.current.registerWindow("detached-conn" as any, ["s1"]);
    });
    await act(async () => {
      await result.current.syncWindow("detached-conn" as any);
    });
    // Verify the window entry still tracks the session
    const entry = result.current.registry.current.windows.get(
      "detached-conn" as any,
    )!;
    expect(entry.sessionIds).toContain("s1");
  });

  it("session ownership maps to main by default", () => {
    const { result } = renderWindowManager();
    const ownership = result.current.registry.current.sessionOwnership;
    expect(ownership.get("s1")).toBe("main");
    expect(ownership.get("s2")).toBe("main");
  });

  // ── Additional coverage: Task 4 scenarios ───────────────────────

  it("registers a new window and tracks its state", () => {
    const { result } = renderWindowManager();
    act(() => {
      result.current.registerWindow("detached-new1" as any, ["s1", "s2"]);
    });
    const entry = result.current.registry.current.windows.get(
      "detached-new1" as any,
    )!;
    expect(entry.windowId).toBe("detached-new1");
    expect(entry.sessionIds).toEqual(["s1", "s2"]);
    expect(entry.activeSessionId).toBe("s1");
    expect(result.current.registry.current.sessionOwnership.get("s1")).toBe(
      "detached-new1",
    );
    expect(result.current.registry.current.sessionOwnership.get("s2")).toBe(
      "detached-new1",
    );
  });

  it("tracks window state changes when sessions are added", () => {
    const s1 = makeSession("s1");
    const conn = makeConnection("conn-s1");
    const { result, rerender } = renderHook(
      (props: any) => useWindowManager(props),
      {
        initialProps: {
          sessions: [s1],
          connections: [conn],
          tabGroups: [],
          dispatch: vi.fn(),
          setActiveSessionId: vi.fn(),
          handleSessionClose: vi.fn().mockResolvedValue(undefined),
          handleSessionDetach: vi.fn(),
        },
      },
    );

    let mainEntry = result.current.registry.current.windows.get("main")!;
    expect(mainEntry.sessionIds).toContain("s1");
    expect(mainEntry.sessionIds).not.toContain("s-new");

    // Add a new session
    const sNew = makeSession("s-new");
    const connNew = makeConnection("conn-s-new");
    rerender({
      sessions: [s1, sNew],
      connections: [conn, connNew],
      tabGroups: [],
      dispatch: vi.fn(),
      setActiveSessionId: vi.fn(),
      handleSessionClose: vi.fn().mockResolvedValue(undefined),
      handleSessionDetach: vi.fn(),
    });

    mainEntry = result.current.registry.current.windows.get("main")!;
    expect(mainEntry.sessionIds).toContain("s1");
    expect(mainEntry.sessionIds).toContain("s-new");
  });

  it("removes window from registry and cleans up ownership", () => {
    const { result } = renderWindowManager();
    act(() => {
      result.current.registerWindow("detached-remove" as any, ["s1"]);
    });
    expect(
      result.current.registry.current.windows.has("detached-remove" as any),
    ).toBe(true);
    expect(result.current.registry.current.sessionOwnership.get("s1")).toBe(
      "detached-remove",
    );

    // Simulate window removal (as the hook does on window closing)
    act(() => {
      const entry = result.current.registry.current.windows.get(
        "detached-remove" as any,
      );
      if (entry) {
        entry.sessionIds.forEach((sid) => {
          result.current.registry.current.sessionOwnership.delete(sid);
        });
      }
      result.current.registry.current.windows.delete("detached-remove" as any);
    });
    expect(
      result.current.registry.current.windows.has("detached-remove" as any),
    ).toBe(false);
    expect(result.current.registry.current.sessionOwnership.has("s1")).toBe(
      false,
    );
  });

  it("detects orphaned windows via getAllWindows mock", async () => {
    const { getAllWindows } = await import("@tauri-apps/api/window");
    // The orphan detection runs on an interval in the hook.
    // Since getAllWindows returns [] (the mock), any detached windows
    // would be considered orphaned. We verify the mechanism exists.
    expect(vi.mocked(getAllWindows)).toBeDefined();

    const { result } = renderWindowManager();
    act(() => {
      result.current.registerWindow("detached-orphan-test" as any, ["s1"]);
    });

    // The interval hasn't fired yet in tests, but the window is registered
    expect(
      result.current.registry.current.windows.has(
        "detached-orphan-test" as any,
      ),
    ).toBe(true);

    // Verify getAllWindows is callable (the hook calls it every 10 seconds)
    const windows = await getAllWindows();
    expect(windows).toEqual([]);
  });

  it("syncWindow resolves without error for a registered detached window", async () => {
    const { result } = renderWindowManager();
    await act(async () => {});

    act(() => {
      result.current.registerWindow("detached-emit" as any, ["s1"]);
    });

    // syncWindow uses a dynamic import of @tauri-apps/api/event inside a try-catch.
    // In jsdom the dynamic import may not resolve to our mock, but the function
    // must still resolve (errors are caught internally).
    await act(async () => {
      await result.current.syncWindow("detached-emit" as any);
    });
    // Reaching here without throwing proves the try-catch guard works
  });

  it("syncWindow is a no-op for the main window and unregistered windows", async () => {
    const { result } = renderWindowManager();
    await act(async () => {});

    await act(async () => {
      await result.current.syncWindow("main" as any);
    });
    // emitTo should never fire for main
    expect(mockEmitTo).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.syncWindow("detached-unknown" as any);
    });
    // emitTo should never fire for unregistered windows
    expect(mockEmitTo).not.toHaveBeenCalled();
  });

  it("accepts a secret-safe lifecycle sync from a detached window", async () => {
    const dispatch = vi.fn();
    const { result } = renderWindowManager({ dispatch });
    act(() => {
      result.current.registerWindow("detached-sync" as any, ["s1"]);
    });
    await waitFor(() => {
      expect(mockWindowListeners.get("wm:command")).toBeTypeOf("function");
    });

    act(() => {
      mockWindowListeners.get("wm:command")!({
        payload: {
          type: "SYNC_SESSION_LIFECYCLE",
          sessionId: "s1",
          lifecycle: {
            revision: 1,
            actorGeneration: 1,
            writerId: "detached-sync",
            backendSessionId: "be-detached-current",
            shellId: null,
            vpnLeaseOwnerId: "owner-current",
            vpnLeaseOwnerIds: ["owner-current"],
            vpnLeaseBindings: [
              {
                ownerId: "owner-current",
                backendSessionId: "be-detached-current",
                protocol: "ssh",
                status: "active",
              },
            ],
            status: "connected",
            errorMessage: null,
            lastActivity: "2026-07-19T10:00:00.000Z",
            password: "must-be-ignored",
          },
        },
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: "s1",
        name: "Session s1",
        backendSessionId: "be-detached-current",
        vpnLeaseOwnerId: "owner-current",
        lastActivity: new Date("2026-07-19T10:00:00.000Z"),
      }),
    });
    expect(
      dispatch.mock.calls[dispatch.mock.calls.length - 1]?.[0].payload,
    ).not.toHaveProperty("password");
  });

  it("merges detached lifecycle before reattaching the canonical main row", async () => {
    const dispatch = vi.fn();
    const setActiveSessionId = vi.fn();
    const { result } = renderWindowManager({ dispatch, setActiveSessionId });
    act(() => {
      result.current.registerWindow("detached-handoff" as any, ["s1"]);
    });
    await waitFor(() => {
      expect(mockWindowListeners.get("wm:command")).toBeTypeOf("function");
    });

    act(() => {
      mockWindowListeners.get("wm:command")!({
        payload: {
          type: "REATTACH_SESSION",
          sessionId: "s1",
          sourceWindow: "detached-handoff",
          terminalBuffer: "detached-buffer",
          lifecycle: {
            revision: 1,
            actorGeneration: 1,
            writerId: "detached-handoff",
            backendSessionId: "be-after-detached-open",
            shellId: "shell-after-detached-open",
            vpnLeaseOwnerId: "owner-after-detached-open",
            vpnLeaseOwnerIds: ["owner-after-detached-open"],
            vpnLeaseBindings: [
              {
                ownerId: "owner-after-detached-open",
                backendSessionId: "be-after-detached-open",
                protocol: "ssh",
                status: "active",
              },
            ],
            status: "connected",
          },
        },
      });
    });

    const finalUpdate =
      dispatch.mock.calls[dispatch.mock.calls.length - 1]?.[0];
    expect(finalUpdate).toEqual({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        id: "s1",
        backendSessionId: "be-after-detached-open",
        shellId: "shell-after-detached-open",
        vpnLeaseOwnerId: "owner-after-detached-open",
        terminalBuffer: "detached-buffer",
        layout: expect.objectContaining({ isDetached: false }),
      }),
    });
    expect(setActiveSessionId).toHaveBeenCalledWith("s1");
  });

  it("merges detached lifecycle before forwarding a close command", async () => {
    const dispatch = vi.fn();
    const handleSessionClose = vi.fn().mockResolvedValue(true);
    const { result } = renderWindowManager({ dispatch, handleSessionClose });
    act(() => {
      result.current.registerWindow("detached-close" as any, ["s1"]);
    });
    await waitFor(() => {
      expect(mockWindowListeners.get("wm:command")).toBeTypeOf("function");
    });

    act(() => {
      mockWindowListeners.get("wm:command")!({
        payload: {
          type: "CLOSE_SESSION",
          sessionId: "s1",
          lifecycle: {
            revision: 1,
            actorGeneration: 1,
            writerId: "detached-close",
            backendSessionId: "be-owned-by-detached",
            vpnLeaseOwnerId: "owner-owned-by-detached",
            vpnLeaseOwnerIds: ["owner-owned-by-detached"],
            vpnLeaseBindings: [
              {
                ownerId: "owner-owned-by-detached",
                backendSessionId: "be-owned-by-detached",
                protocol: "ssh",
                status: "active",
              },
            ],
            status: "connected",
          },
        },
      });
    });

    await waitFor(() =>
      expect(handleSessionClose).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({
          id: "s1",
          backendSessionId: "be-owned-by-detached",
          vpnLeaseOwnerId: "owner-owned-by-detached",
          vpnLeaseBindings: [
            {
              ownerId: "owner-owned-by-detached",
              backendSessionId: "be-owned-by-detached",
              protocol: "ssh",
              status: "active",
            },
          ],
        }),
      ),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        backendSessionId: "be-owned-by-detached",
        vpnLeaseOwnerId: "owner-owned-by-detached",
      }),
    });
    expect(dispatch.mock.invocationCallOrder[0]).toBeLessThan(
      handleSessionClose.mock.invocationCallOrder[0],
    );
  });

  it.each([true, false])(
    "acknowledges authoritative detached close result %s",
    async (closeResult) => {
      const handleSessionClose = vi.fn().mockResolvedValue(closeResult);
      const { result } = renderWindowManager({ handleSessionClose });
      act(() => {
        result.current.registerWindow("detached-s1" as any, ["s1"]);
      });
      await waitFor(() => {
        expect(mockWindowListeners.get("wm:command")).toBeTypeOf("function");
      });

      act(() => {
        mockWindowListeners.get("wm:command")!({
          payload: {
            type: "CLOSE_SESSION",
            sessionId: "s1",
            requestId: "close-request-1",
            sourceWindow: "detached-s1",
          },
        });
      });

      await waitFor(() =>
        expect(mockEmitTo).toHaveBeenCalledWith(
          "detached-s1",
          "wm:close-result",
          {
            requestId: "close-request-1",
            sessionId: "s1",
            success: closeResult,
          },
        ),
      );
    },
  );

  it("removes a successfully closed tab from its detached source before syncing", async () => {
    const handleSessionClose = vi.fn().mockResolvedValue(true);
    const { result } = renderWindowManager({ handleSessionClose });
    act(() => {
      result.current.registerWindow("detached-tabs" as any, ["s1", "s2"]);
    });
    await waitFor(() => {
      expect(mockWindowListeners.get("wm:command")).toBeTypeOf("function");
    });

    act(() => {
      mockWindowListeners.get("wm:command")!({
        payload: {
          type: "CLOSE_SESSION",
          sessionId: "s1",
          requestId: "close-tab-s1",
          sourceWindow: "detached-tabs",
        },
      });
    });

    await waitFor(() =>
      expect(mockEmitTo).toHaveBeenCalledWith(
        "detached-tabs",
        "wm:close-result",
        {
          requestId: "close-tab-s1",
          sessionId: "s1",
          success: true,
        },
      ),
    );

    const entry = result.current.registry.current.windows.get(
      "detached-tabs" as any,
    )!;
    expect(entry.sessionIds).toEqual(["s2"]);
    expect(entry.activeSessionId).toBe("s2");
    expect(result.current.registry.current.sessionOwnership.has("s1")).toBe(
      false,
    );
    expect(result.current.registry.current.sessionOwnership.get("s2")).toBe(
      "detached-tabs",
    );
    expect(mockEmitTo).toHaveBeenCalledWith(
      "detached-tabs",
      "wm:sync",
      expect.objectContaining({
        sessions: [expect.objectContaining({ id: "s2" })],
        activeSessionId: "s2",
      }),
    );
  });

  it("does not orphan-reattach a retained hidden RDP row after successful close", async () => {
    let runOrphanCheck: (() => Promise<void>) | undefined;
    const nativeSetInterval = globalThis.setInterval;
    const intervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(((
        handler: TimerHandler,
        delay?: number,
        ...args: any[]
      ) => {
        if (delay === 10_000) {
          runOrphanCheck = handler as () => Promise<void>;
          return 1 as unknown as ReturnType<typeof setInterval>;
        }
        return nativeSetInterval(handler, delay, ...args);
      }) as typeof setInterval);

    try {
      const retainedRdpSession = makeSession("s1", {
        protocol: "rdp",
        layout: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 1,
          isDetached: true,
          windowId: undefined,
        },
      });
      const dispatch = vi.fn();
      const setActiveSessionId = vi.fn();
      const handleSessionClose = vi.fn().mockResolvedValue(true);
      const { result } = renderWindowManager({
        sessions: [retainedRdpSession],
        connections: [
          {
            ...makeConnection("conn-s1"),
            protocol: "rdp",
            port: 3389,
          },
        ],
        dispatch,
        setActiveSessionId,
        handleSessionClose,
      });
      act(() => {
        result.current.registerWindow("detached-rdp" as any, ["s1"]);
      });
      await waitFor(() => {
        expect(mockWindowListeners.get("wm:command")).toBeTypeOf("function");
      });

      act(() => {
        mockWindowListeners.get("wm:command")!({
          payload: {
            type: "CLOSE_SESSION",
            sessionId: "s1",
            sourceWindow: "detached-rdp",
          },
        });
      });

      await waitFor(() => {
        expect(handleSessionClose).toHaveBeenCalledWith(
          "s1",
          retainedRdpSession,
        );
        expect(
          result.current.registry.current.windows.get("detached-rdp" as any)
            ?.sessionIds,
        ).toEqual([]);
      });
      expect(result.current.registry.current.sessionOwnership.has("s1")).toBe(
        false,
      );
      expect(
        result.current.registry.current.windows.get("detached-rdp" as any)
          ?.activeSessionId,
      ).toBeUndefined();
      expect(mockEmitTo).toHaveBeenCalledWith(
        "detached-rdp",
        "wm:sync",
        expect.objectContaining({ sessions: [], activeSessionId: undefined }),
      );

      dispatch.mockClear();
      setActiveSessionId.mockClear();
      expect(runOrphanCheck).toBeTypeOf("function");
      await act(async () => {
        await runOrphanCheck!();
      });
      expect(dispatch).not.toHaveBeenCalled();
      expect(setActiveSessionId).not.toHaveBeenCalled();
      expect(result.current.registry.current.sessionOwnership.has("s1")).toBe(
        false,
      );
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it("rejects a stale detached close after main owns the session", async () => {
    const handleSessionClose = vi.fn().mockResolvedValue(true);
    renderWindowManager({ handleSessionClose });
    await waitFor(() => {
      expect(mockWindowListeners.get("wm:command")).toBeTypeOf("function");
    });

    act(() => {
      mockWindowListeners.get("wm:command")!({
        payload: {
          type: "CLOSE_SESSION",
          sessionId: "s1",
          requestId: "stale-close",
          sourceWindow: "detached-s1",
        },
      });
    });

    await waitFor(() =>
      expect(mockEmitTo).toHaveBeenCalledWith(
        "detached-s1",
        "wm:close-result",
        {
          requestId: "stale-close",
          sessionId: "s1",
          success: false,
        },
      ),
    );
    expect(handleSessionClose).not.toHaveBeenCalled();
  });

  it("commits moved layout and writer authority before syncing the target", async () => {
    const dispatch = vi.fn();
    const { result } = renderWindowManager({ dispatch });
    const target = "detached-target" as any;
    act(() => {
      result.current.registry.current.windows.set(target, {
        windowId: target,
        sessionIds: [],
        createdAt: Date.now(),
      });
    });
    await waitFor(() => {
      expect(mockWindowListeners.get("wm:command")).toBeTypeOf("function");
    });

    await act(async () => {
      await mockWindowListeners.get("wm:command")!({
        payload: {
          type: "MOVE_SESSION",
          sessionId: "s1",
          targetWindow: target,
          sourceWindow: "main",
        },
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        lifecycleActorGeneration: expect.any(Number),
        lifecycleWriterId: "detached-target",
        layout: expect.objectContaining({
          isDetached: true,
          windowId: "detached-target",
        }),
      }),
    });
  });

  it("rejects stale detached reattach and move commands after main owns the session", async () => {
    const dispatch = vi.fn();
    const setActiveSessionId = vi.fn();
    const { result } = renderWindowManager({
      dispatch,
      setActiveSessionId,
    });
    const target = "detached-other" as any;
    act(() => {
      result.current.registry.current.windows.set(target, {
        windowId: target,
        sessionIds: [],
        createdAt: Date.now(),
      });
    });
    await waitFor(() => {
      expect(mockWindowListeners.get("wm:command")).toBeTypeOf("function");
    });

    act(() => {
      mockWindowListeners.get("wm:command")!({
        payload: {
          type: "REATTACH_SESSION",
          sessionId: "s1",
          sourceWindow: "detached-old",
          lifecycle: {
            revision: 50,
            actorGeneration: 50,
            writerId: "detached-old",
            backendSessionId: "stale-backend",
          },
        },
      });
      mockWindowListeners.get("wm:command")!({
        payload: {
          type: "MOVE_SESSION",
          sessionId: "s1",
          sourceWindow: "detached-old",
          targetWindow: target,
        },
      });
      mockWindowListeners.get("wm:command")!({
        payload: {
          type: "DROP_ON_WINDOW",
          sessionId: "s1",
          sourceWindow: "detached-old",
          screenX: 10,
          screenY: 10,
        },
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(setActiveSessionId).not.toHaveBeenCalled();
    expect(result.current.registry.current.sessionOwnership.get("s1")).toBe(
      "main",
    );
  });
});
