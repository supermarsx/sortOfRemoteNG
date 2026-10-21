import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import type { OriginBrowserState } from "../../src/hooks/protocol/useOriginBrowser";
import {
  useOriginConnectionHealth,
  type OriginConnectionHealthOptions,
} from "../../src/hooks/protocol/useOriginConnectionHealth";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  catalog: vi.fn(),
  getInvoke: vi.fn(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({ getInvoke: mocks.getInvoke }));
vi.mock("../../src/utils/network/resolveRuntimeNetworkPath", () => ({
  captureNetworkPathCatalog: mocks.catalog,
}));
const options = (): OriginConnectionHealthOptions => ({
  connection: {
    id: "web",
    protocol: "https",
    security: {
      sshTunnel: {
        enabled: true,
        host: "PRIVATE_HOST",
        username: "PRIVATE_USER",
        password: "PRIVATE_PASSWORD",
      },
    },
  } as unknown as Connection,
  state: {
    phase: "attached",
    error: null,
    unavailableReason: null,
    snapshot: {
      identity: {
        ownerDatabaseId: "db",
        connectionId: "web",
        sessionId: "tab",
        attemptId: "attempt",
      },
      sequence: 1,
      phase: "attached",
      displayUrl: "https://site.example",
      loading: false,
      documentLoaded: true,
      title: "",
      canGoBack: false,
      canGoForward: false,
    },
  } as OriginBrowserState,
  enabled: true,
  assertOwner: vi.fn(),
});
const report = (attemptId = "attempt") => ({
  available: true,
  sessions: [
    {
      identity: { connectionId: "web", sessionId: "tab", attemptId },
      phase: "attached",
      proxy: {
        state: "listening",
        acceptedConnections: 1,
        authenticationChallenges: 0,
        authenticatedRequests: 1,
        destinationDenials: 0,
        upstreamFailures: 0,
        requestRejections: 0,
        capacityRefusals: 0,
      },
    },
  ],
});
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  mocks.invoke.mockReset().mockResolvedValue(report());
  mocks.getInvoke.mockReset().mockResolvedValue(mocks.invoke);
  mocks.catalog.mockReset().mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("passive scoped route health", () => {
  it("polls only passive native diagnostics and never probes or opens a route", async () => {
    const p = options();
    const { result } = renderHook(() => useOriginConnectionHealth(p));
    await flush();
    expect(result.current.status).toBe("healthy");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "origin_browser_session_diagnostics",
    );
    expect(p.assertOwner).toHaveBeenCalled();
    expect(JSON.stringify(result.current)).not.toContain("PRIVATE_");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(
      mocks.invoke.mock.calls.every(
        ([command]) => command === "origin_browser_session_diagnostics",
      ),
    ).toBe(true);
  });
  it.each(["inactive", "direct", "owner-revoked"])(
    "does not query native with %s access",
    async (kind) => {
      const p = options();
      if (kind === "inactive") p.enabled = false;
      if (kind === "direct")
        p.connection = { id: "web", protocol: "https" } as Connection;
      if (kind === "owner-revoked")
        p.assertOwner = () => {
          throw new Error("PRIVATE_OWNER");
        };
      const { result } = renderHook(() => useOriginConnectionHealth(p));
      await flush();
      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(mocks.catalog).not.toHaveBeenCalled();
      expect(result.current.status).toBe("unknown");
    },
  );
  it("does not retain another attempt's relay or a late reply after scope replacement", async () => {
    const first = deferred<unknown>();
    mocks.invoke
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(report("replacement"));
    const p = options();
    const { result, rerender } = renderHook(
      (value) => useOriginConnectionHealth(value),
      { initialProps: p },
    );
    await flush();
    const next = {
      ...p,
      state: {
        ...p.state,
        snapshot: {
          ...p.state.snapshot!,
          identity: { ...p.state.snapshot!.identity, attemptId: "replacement" },
        },
      },
    };
    rerender(next);
    await flush();
    expect(result.current.status).toBe("healthy");
    await act(async () => {
      first.resolve({
        ...report(),
        sessions: [
          {
            ...report().sessions[0],
            proxy: { ...report().sessions[0].proxy, state: "stopped" },
          },
        ],
      });
    });
    expect(result.current.status).toBe("healthy");
  });
  it("clears old green health when IPC becomes busy, malformed, or unavailable", async () => {
    const { result } = renderHook(() => useOriginConnectionHealth(options()));
    await flush();
    expect(result.current.status).toBe("healthy");
    mocks.invoke.mockResolvedValueOnce({
      available: true,
      sessions: [{ ...report().sessions[0], proxy: null, phase: null }],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.status).toBe("unknown");
    mocks.invoke.mockRejectedValueOnce(new Error("PRIVATE_NATIVE_ERROR"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.status).toBe("unknown");
    expect(JSON.stringify(result.current)).not.toContain("PRIVATE_");
  });
  it("expires stale green on a hung poll without overlapping requests", async () => {
    const p = options();
    const pending = deferred<unknown>();
    const { result } = renderHook(() => useOriginConnectionHealth(p));
    await flush();
    expect(result.current.status).toBe("healthy");
    mocks.invoke.mockReturnValueOnce(pending.promise);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(result.current.status).toBe("unknown");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    await act(async () => {
      pending.resolve(report());
    });
    expect(result.current.status).toBe("unknown");
  });
  it("fences metadata catalog completion after the owner is lost", async () => {
    let allowed = true;
    const pending = deferred<unknown>();
    mocks.catalog.mockReturnValueOnce(pending.promise);
    const p = options();
    p.assertOwner = () => {
      if (!allowed) throw new Error("PRIVATE_OWNER");
    };
    const { result, rerender } = renderHook(
      (value) => useOriginConnectionHealth(value),
      { initialProps: p },
    );
    await flush();
    allowed = false;
    rerender({ ...p, enabled: false });
    await act(async () => {
      pending.resolve({});
    });
    expect(result.current.status).toBe("unknown");
    expect(
      result.current.hops.some((hop) => hop.key.startsWith("resolved")),
    ).toBe(false);
  });
  it("stops polling on unmount", async () => {
    const p = options();
    const { unmount } = renderHook(() => useOriginConnectionHealth(p));
    await flush();
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
