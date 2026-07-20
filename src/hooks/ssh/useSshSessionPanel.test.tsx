import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSession } from "../../types/connection/connection";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  sessions: [] as ConnectionSession[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: [], sessions: mocks.sessions },
    dispatch: mocks.dispatch,
  }),
}));

import { useSshSessionPanel } from "./useSshSessionPanel";

const nativeSession = (id: string) => ({
  id,
  config: { host: `${id}.example.test`, port: 22, username: "alice" },
  connected_at: "2026-01-01T00:00:00Z",
  last_activity: "2026-01-01T00:01:00Z",
  is_alive: true,
});

const frontendSession = (
  id: string,
  backendSessionId: string,
  vpnLeaseOwnerId?: string,
): ConnectionSession => ({
  id,
  connectionId: `connection-${id}`,
  name: id,
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "ssh",
  hostname: `${id}.example.test`,
  backendSessionId,
  vpnLeaseOwnerId,
  vpnLeaseOwnerIds: vpnLeaseOwnerId ? [vpnLeaseOwnerId] : undefined,
  vpnLeaseBindings: vpnLeaseOwnerId
    ? [
        {
          ownerId: vpnLeaseOwnerId,
          backendSessionId,
          protocol: "ssh",
          status: "active",
        },
      ]
    : undefined,
});

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.sessions = [];
});

describe("useSshSessionPanel VPN cleanup", () => {
  it("uses persisted remount bindings to retry stale A without touching live B", async () => {
    const stale = nativeSession("ssh-stale-a");
    const live = nativeSession("ssh-live-b");
    mocks.sessions = [
      {
        ...frontendSession("frontend-remount", live.id, "owner-b"),
        vpnLeaseOwnerIds: ["owner-a", "owner-b"],
        vpnLeaseBindings: [
          {
            ownerId: "owner-a",
            backendSessionId: stale.id,
            protocol: "ssh",
            status: "cleanup-pending",
          },
          {
            ownerId: "owner-b",
            backendSessionId: live.id,
            protocol: "ssh",
            status: "active",
          },
        ],
      },
    ];
    mocks.invoke.mockImplementation(
      (command: string, args?: { ownerId?: string }) => {
        if (command === "list_sessions") return Promise.resolve([stale, live]);
        if (command === "disconnect_ssh") return Promise.resolve(undefined);
        if (command === "release_vpn_leases") {
          return Promise.resolve({
            owner_id: args?.ownerId,
            released: [],
            errors: [],
          });
        }
        return Promise.resolve(undefined);
      },
    );

    const { result } = renderHook(() => useSshSessionPanel(true));
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));
    await act(async () => {
      expect(await result.current.handleDisconnect(stale.id)).toBe(true);
    });

    expect(mocks.invoke).toHaveBeenCalledWith("disconnect_ssh", {
      sessionId: stale.id,
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("disconnect_ssh", {
      sessionId: live.id,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("release_vpn_leases", {
      ownerId: "owner-a",
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("release_vpn_leases", {
      ownerId: "owner-b",
    });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "UPDATE_SESSION",
      payload: expect.objectContaining({
        backendSessionId: live.id,
        status: "connected",
        vpnLeaseOwnerId: "owner-b",
        vpnLeaseOwnerIds: ["owner-b"],
        vpnLeaseBindings: [
          expect.objectContaining({
            ownerId: "owner-b",
            backendSessionId: live.id,
            status: "active",
          }),
        ],
      }),
    });
  });

  it("closes SSH first, retains failed owners for retry, and clears every owner on success", async () => {
    const row = nativeSession("ssh-native-1");
    mocks.sessions = [
      {
        ...frontendSession("frontend-a", row.id, "owner-a"),
        vpnLeaseOwnerIds: ["owner-previous", "owner-a"],
        vpnLeaseBindings: [
          {
            ownerId: "owner-previous",
            backendSessionId: row.id,
            protocol: "ssh",
            status: "active",
          },
          {
            ownerId: "owner-a",
            backendSessionId: row.id,
            protocol: "ssh",
            status: "active",
          },
        ],
      },
      frontendSession("frontend-b", row.id, "owner-b"),
    ];
    let ownerAAttempts = 0;
    mocks.invoke.mockImplementation(
      (command: string, args?: { ownerId?: string }) => {
        if (command === "list_sessions") return Promise.resolve([row]);
        if (command === "disconnect_ssh") return Promise.resolve(undefined);
        if (command === "release_vpn_leases") {
          if (args?.ownerId === "owner-a") ownerAAttempts += 1;
          return Promise.resolve({
            owner_id: args?.ownerId,
            released: [],
            errors:
              args?.ownerId === "owner-a" && ownerAAttempts === 1
                ? ["provider busy"]
                : [],
          });
        }
        return Promise.resolve(undefined);
      },
    );

    const { result } = renderHook(() => useSshSessionPanel(true));
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    let firstResult = true;
    await act(async () => {
      firstResult = await result.current.handleDisconnect(row.id);
    });
    expect(firstResult).toBe(false);
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.error).toMatch(/VPN cleanup needs attention/i);
    expect(
      mocks.invoke.mock.calls
        .map(([command]) => command)
        .indexOf("disconnect_ssh"),
    ).toBeLessThan(
      mocks.invoke.mock.calls
        .map(([command]) => command)
        .indexOf("release_vpn_leases"),
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "disconnect_ssh",
      ),
    ).toHaveLength(1);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          id: "frontend-a",
          status: "error",
          vpnLeaseOwnerId: "owner-a",
          vpnLeaseOwnerIds: ["owner-a"],
        }),
      }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          id: "frontend-b",
          vpnLeaseOwnerId: undefined,
        }),
      }),
    );

    let retryResult = false;
    await act(async () => {
      retryResult = await result.current.handleDisconnect(row.id);
    });
    expect(retryResult).toBe(true);
    expect(result.current.sessions).toHaveLength(0);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "disconnect_ssh",
      ),
    ).toHaveLength(1);
    expect(ownerAAttempts).toBe(2);
    expect(mocks.invoke).toHaveBeenCalledWith("release_vpn_leases", {
      ownerId: "owner-previous",
    });
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          id: "frontend-a",
          vpnLeaseOwnerId: undefined,
          vpnLeaseOwnerIds: undefined,
          status: "disconnected",
        }),
      }),
    );
  });

  it("bulk cleanup removes native-only sessions and keeps failed leased rows retryable", async () => {
    const nativeOnly = nativeSession("ssh-native-only");
    const leased = nativeSession("ssh-leased");
    mocks.sessions = [
      frontendSession("frontend-leased", leased.id, "owner-busy"),
    ];
    let releaseAttempts = 0;
    mocks.invoke.mockImplementation(
      (command: string, args?: { ownerId?: string }) => {
        if (command === "list_sessions")
          return Promise.resolve([nativeOnly, leased]);
        if (command === "disconnect_ssh") return Promise.resolve(undefined);
        if (command === "release_vpn_leases") {
          releaseAttempts += 1;
          return Promise.resolve({
            owner_id: args?.ownerId,
            released: [],
            errors: releaseAttempts === 1 ? ["still stopping"] : [],
          });
        }
        return Promise.resolve(undefined);
      },
    );

    const { result } = renderHook(() => useSshSessionPanel(true));
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));

    let disconnected: string[] = [];
    await act(async () => {
      disconnected = await result.current.handleDisconnectAll();
    });
    expect(disconnected).toEqual([nativeOnly.id]);
    expect(result.current.sessions.map((session) => session.id)).toEqual([
      leased.id,
    ]);

    await act(async () => {
      disconnected = await result.current.handleDisconnectAll();
    });
    expect(disconnected).toEqual([leased.id]);
    expect(result.current.sessions).toHaveLength(0);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command, args]) =>
          command === "disconnect_ssh" &&
          (args as { sessionId?: string })?.sessionId === leased.id,
      ),
    ).toHaveLength(1);
  });
});
