import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../src/types/connection/connection";
import { useSessionConnectionHealth } from "../../src/hooks/session/useSessionConnectionHealth";
const h = vi.hoisted(() => ({
  active: true,
  valid: true,
  invoke: vi.fn(),
  capture: vi.fn(),
  current: new Set<(event: any) => void>(),
  access: new Set<(event: any) => void>(),
}));
vi.mock("../../src/contexts/SessionRenderActivityContext", () => ({
  useSessionRenderActivity: () => ({ isActive: h.active }),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => h.invoke,
}));
vi.mock("../../src/utils/session/sessionDatabaseOwnership", () => ({
  captureSessionDatabaseAccess: (...args: unknown[]) => h.capture(...args),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      onCurrentDatabaseChange: (listener: (event: any) => void) => {
        h.current.add(listener);
        return () => h.current.delete(listener);
      },
      onDatabaseAccessChange: (listener: (event: any) => void) => {
        h.access.add(listener);
        return () => h.access.delete(listener);
      },
    }),
  },
}));
const session = {
  id: "tab",
  connectionId: "saved",
  ownerDatabaseId: "db",
  backendSessionId: "actor-a",
  status: "connected",
  protocol: "ssh",
} as ConnectionSession;
const props = () => ({
  protocol: "ssh" as const,
  status: "connected",
  backendSessionId: "actor-a",
  session,
});
const aliveCalls = () =>
  h.invoke.mock.calls.filter(([command]) => command === "is_session_alive");
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  h.active = true;
  h.valid = true;
  h.current.clear();
  h.access.clear();
  h.invoke
    .mockReset()
    .mockImplementation(async (command: string, args: { sessionId: string }) =>
      command === "is_session_alive"
        ? true
        : {
            sessionId: args.sessionId,
            observedAtUnixMs: Date.now(),
            hops: [
              {
                index: 0,
                kind: command === "get_rdp_route_health" ? "rdp" : "ssh",
                state: "connected",
                evidence: "runtime-active",
                stage: "transport",
                updatedAtUnixMs: Date.now(),
              },
            ],
          },
    );
  h.capture.mockReset().mockImplementation(() => {
    if (!h.valid) throw new Error("locked");
    return () => {
      if (!h.valid) throw new Error("revoked");
    };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("scoped passive SSH health observations", () => {
  it("uses only the credential-free actor command and ignores status-only session refreshes", async () => {
    const view = renderHook(useSessionConnectionHealth, {
      initialProps: props(),
    });
    await flush();
    expect(view.result.current.status).toBe("healthy");
    expect(h.invoke).toHaveBeenCalledWith("is_session_alive", {
      sessionId: "actor-a",
    });
    view.rerender({
      ...props(),
      session: { ...session, lastActivity: new Date() },
    });
    await flush();
    expect(aliveCalls()).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(aliveCalls()).toHaveLength(2);
  });
  it("expires a pending check without overlapping it or accepting its late green result", async () => {
    let finish!: (value: boolean) => void;
    h.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = renderHook(useSessionConnectionHealth, {
      initialProps: props(),
    });
    await flush();
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(view.result.current.status).toBe("unknown");
    expect(aliveCalls()).toHaveLength(1);
    await act(async () => finish(true));
    expect(view.result.current.status).toBe("unknown");
  });
  it("fences a replaced actor and inactive tab against late results", async () => {
    let finish!: (value: boolean) => void;
    h.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = renderHook(useSessionConnectionHealth, {
      initialProps: props(),
    });
    await flush();
    view.rerender({
      ...props(),
      backendSessionId: "actor-b",
      session: { ...session, backendSessionId: "actor-b" },
    });
    await flush();
    expect(view.result.current.status).toBe("unknown");
    expect(aliveCalls()).toHaveLength(1);
    await act(async () => finish(false));
    await flush();
    expect(view.result.current.status).toBe("healthy");
    expect(aliveCalls()).toHaveLength(2);
    h.active = false;
    view.rerender({ ...props(), backendSessionId: "actor-b" });
    expect(view.result.current.status).toBe("unknown");
    const count = h.invoke.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(h.invoke).toHaveBeenCalledTimes(count);
  });
  it("revokes old green evidence on owner loss and requires a fresh check after reopening", async () => {
    const view = renderHook(useSessionConnectionHealth, {
      initialProps: props(),
    });
    await flush();
    expect(view.result.current.status).toBe("healthy");
    h.valid = false;
    act(() => h.access.forEach((callback) => callback({ databaseId: "db" })));
    expect(view.result.current.status).toBe("unknown");
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(aliveCalls()).toHaveLength(1);
    h.valid = true;
    h.invoke.mockResolvedValueOnce(false);
    act(() => h.access.forEach((callback) => callback({ databaseId: "db" })));
    await flush();
    expect(view.result.current.status).toBe("disconnected");
  });
  it("uses the RDP route command without SSH checks and unsubscribes on unmount", async () => {
    const view = renderHook(useSessionConnectionHealth, {
      initialProps: { ...props(), protocol: "rdp" as "ssh" | "rdp" },
    });
    await flush();
    expect(aliveCalls()).toHaveLength(0);
    expect(h.invoke).toHaveBeenCalledWith("get_rdp_route_health", {
      sessionId: "actor-a",
    });
    view.unmount();
    expect(h.current.size).toBe(0);
    expect(h.access.size).toBe(0);
  });
  it("expires RDP telemetry and does not refresh its age from an unchanged snapshot", async () => {
    const initial = {
      ...props(),
      protocol: "rdp" as "ssh" | "rdp",
      stats: null as
        import("../../src/types/rdp/rdpEvents").RDPStatsEvent | null,
    };
    const view = renderHook(useSessionConnectionHealth, {
      initialProps: initial,
    });
    await flush();
    const stats = {
      session_id: "actor-a",
      phase: "active",
      bytes_received: 25,
    } as import("../../src/types/rdp/rdpEvents").RDPStatsEvent;
    view.rerender({ ...initial, stats });
    expect(view.result.current.status).toBe("healthy");
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(view.result.current.status).toBe("unknown");
    view.rerender({ ...initial, stats });
    expect(view.result.current.status).toBe("unknown");
    view.rerender({ ...initial, stats: { ...stats, bytes_received: 26 } });
    expect(view.result.current.status).toBe("healthy");
    view.rerender({ ...initial, stats: { ...stats, phase: "initializing" } });
    expect(view.result.current.status).toBe("connecting");
    expect(aliveCalls()).toHaveLength(0);
  });
  it("invalidates a green observation when the session actor generation changes", async () => {
    const view = renderHook(useSessionConnectionHealth, {
      initialProps: props(),
    });
    await flush();
    expect(view.result.current.status).toBe("healthy");
    h.invoke.mockImplementationOnce(() => new Promise(() => {}));
    view.rerender({
      ...props(),
      session: { ...session, lifecycleActorGeneration: 2 },
    });
    expect(view.result.current.status).toBe("unknown");
    await flush();
    expect(view.result.current.status).toBe("unknown");
  });
  it("does not refresh an old matching lifecycle with foreign stats or restore it after backgrounding", async () => {
    const initial: Parameters<typeof useSessionConnectionHealth>[0] = {
      ...props(),
      protocol: "rdp",
      stats: null,
      lifecycle: null,
    };
    const view = renderHook(useSessionConnectionHealth, {
      initialProps: initial,
    });
    const lifecycle = { sessionId: "actor-a", state: "active" } as NonNullable<
      typeof initial.lifecycle
    >;
    view.rerender({ ...initial, lifecycle });
    expect(view.result.current.status).toBe("healthy");
    view.rerender({
      ...initial,
      lifecycle,
      stats: { session_id: "foreign", phase: "active" } as NonNullable<
        typeof initial.stats
      >,
    });
    expect(view.result.current.status).toBe("unknown");
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(view.result.current.status).toBe("unknown");
    view.rerender({ ...initial, lifecycle: { ...lifecycle } });
    expect(view.result.current.status).toBe("healthy");
    h.active = false;
    view.rerender({ ...initial, lifecycle });
    h.active = true;
    view.rerender({ ...initial, lifecycle });
    expect(view.result.current.status).toBe("unknown");
  });
  it("rejects new RDP samples when the captured lease was revoked without a render", () => {
    const initial: Parameters<typeof useSessionConnectionHealth>[0] = {
      ...props(),
      protocol: "rdp",
      lifecycle: null,
    };
    const view = renderHook(useSessionConnectionHealth, {
      initialProps: initial,
    });
    const lifecycle = { sessionId: "actor-a", state: "active" } as NonNullable<
      typeof initial.lifecycle
    >;
    view.rerender({ ...initial, lifecycle });
    expect(view.result.current.status).toBe("healthy");
    h.valid = false;
    view.rerender({ ...initial, lifecycle: { ...lifecycle } });
    expect(view.result.current.status).toBe("unknown");
    h.valid = true;
    view.rerender({ ...initial, lifecycle: { ...lifecycle } });
    expect(view.result.current.status).toBe("unknown");
  });
  it.each(["owner", "actor", "timeout"])(
    "fences a late route receipt after %s changes",
    async (change) => {
      let finish!: (value: unknown) => void;
      h.invoke.mockImplementation(async (command: string) =>
        command === "is_session_alive"
          ? true
          : new Promise((resolve) => {
              finish = resolve;
            }),
      );
      const view = renderHook(useSessionConnectionHealth, {
        initialProps: props(),
      });
      await flush();
      expect(h.invoke).toHaveBeenCalledWith("get_ssh_route_health", {
        sessionId: "actor-a",
      });
      if (change === "owner") h.valid = false;
      if (change === "actor")
        view.rerender({
          ...props(),
          backendSessionId: "actor-b",
          session: { ...session, backendSessionId: "actor-b" },
        });
      if (change === "timeout")
        await act(async () => vi.advanceTimersByTimeAsync(5000));
      await act(async () =>
        finish({
          sessionId: "actor-a",
          observedAtUnixMs: null,
          hops: [
            {
              index: 0,
              kind: "proxy",
              state: "failed",
              evidence: "negotiation-failed",
              stage: "tcp",
              updatedAtUnixMs: null,
            },
          ],
        }),
      );
      expect(
        view.result.current.hops.some((hop) => hop.key === "runtime-0"),
      ).toBe(false);
    },
  );
  it("reads only active VPN bindings for the current actor and projects logical ownership without provider health", async () => {
    const native = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (command: string, args: any) =>
      command === "get_vpn_owner_lease_observations"
        ? [
            {
              ownerId: "owned",
              truncated: false,
              leases: [
                {
                  vpnType: "wireguard",
                  connectionId: "PRIVATE_ID",
                  leaseOwned: true,
                  providerState: "unknown",
                  observedAtUnixMs: null,
                  cleanupPending: true,
                },
              ],
            },
          ]
        : native(command, args),
    );
    const view = renderHook(useSessionConnectionHealth, {
      initialProps: {
        ...props(),
        session: {
          ...session,
          vpnLeaseBindings: [
            {
              ownerId: "owned",
              backendSessionId: "actor-a",
              protocol: "ssh",
              status: "active",
            },
            {
              ownerId: "foreign",
              backendSessionId: "actor-b",
              protocol: "ssh",
              status: "active",
            },
            {
              ownerId: "closed",
              backendSessionId: "actor-a",
              protocol: "ssh",
              status: "backend-closed",
            },
            {
              ownerId: "rdp",
              backendSessionId: "actor-a",
              protocol: "rdp",
              status: "active",
            },
          ],
        },
      },
    });
    await flush();
    expect(h.invoke).toHaveBeenCalledWith("get_vpn_owner_lease_observations", {
      ownerIds: ["owned"],
    });
    const hop = view.result.current.prerequisites?.find((hop) =>
      hop.kind.startsWith("Owned VPN prerequisite"),
    );
    expect(hop).toMatchObject({ status: "unknown" });
    expect(hop?.detail).toContain("cleanup is pending");
    expect(JSON.stringify(view.result.current)).not.toContain("PRIVATE_ID");
  });
  it("drops a late VPN lease response after owner revocation without a render", async () => {
    const native = h.invoke.getMockImplementation()!;
    let finish!: (value: unknown) => void;
    h.invoke.mockImplementation(async (command: string, args: any) =>
      command === "get_vpn_owner_lease_observations"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : native(command, args),
    );
    const view = renderHook(useSessionConnectionHealth, {
      initialProps: {
        ...props(),
        session: {
          ...session,
          vpnLeaseBindings: [
            {
              ownerId: "owned",
              backendSessionId: "actor-a",
              protocol: "ssh",
              status: "active",
            },
          ],
        },
      },
    });
    await flush();
    expect(h.invoke).toHaveBeenCalledWith("get_vpn_owner_lease_observations", {
      ownerIds: ["owned"],
    });
    h.valid = false;
    await act(async () =>
      finish([
        {
          ownerId: "owned",
          truncated: false,
          leases: [
            {
              vpnType: "wireguard",
              connectionId: "PRIVATE",
              leaseOwned: true,
              providerState: "unknown",
              observedAtUnixMs: null,
              cleanupPending: false,
            },
          ],
        },
      ]),
    );
    expect(view.result.current.status).toBe("unknown");
    expect(
      (view.result.current.prerequisites ?? []).some((hop) =>
        hop.kind.startsWith("Owned VPN prerequisite"),
      ),
    ).toBe(false);
  });
  it("times out only VPN evidence first and independently expires actor evidence during a hung serialized provider read", async () => {
    const native = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (command: string, args: any) =>
      command === "get_vpn_owner_lease_observations"
        ? new Promise(() => {})
        : native(command, args),
    );
    const view = renderHook(useSessionConnectionHealth, {
      initialProps: {
        ...props(),
        session: {
          ...session,
          vpnLeaseBindings: [
            {
              ownerId: "owned",
              backendSessionId: "actor-a",
              protocol: "ssh",
              status: "active",
            },
          ],
        },
      },
    });
    await flush();
    expect(view.result.current.status).toBe("healthy");
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(view.result.current.status).toBe("healthy");
    expect(
      (view.result.current.prerequisites ?? []).some((hop) =>
        hop.kind.startsWith("Owned VPN prerequisite"),
      ),
    ).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(9000));
    expect(view.result.current.status).toBe("unknown");
    expect(aliveCalls()).toHaveLength(1);
  });
  it("expires accepted provider status independently while a later poll is blocked", async () => {
    const native = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (command: string, args: any) =>
      command === "get_vpn_owner_lease_observations"
        ? [
            {
              ownerId: "owned",
              truncated: false,
              leases: [
                {
                  vpnType: "wireguard",
                  connectionId: "private",
                  leaseOwned: true,
                  cleanupPending: false,
                  providerState: "connected",
                  observedAtUnixMs: Date.now(),
                },
              ],
            },
          ]
        : native(command, args),
    );
    const view = renderHook(useSessionConnectionHealth, {
      initialProps: {
        ...props(),
        session: {
          ...session,
          vpnLeaseBindings: [
            {
              ownerId: "owned",
              backendSessionId: "actor-a",
              protocol: "ssh",
              status: "active",
            },
          ],
        },
      },
    });
    await flush();
    expect(view.result.current.prerequisites?.[0].status).toBe("healthy");
    h.invoke.mockImplementation(() => new Promise(() => {}));
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(view.result.current.prerequisites).toBeUndefined();
  });
});
