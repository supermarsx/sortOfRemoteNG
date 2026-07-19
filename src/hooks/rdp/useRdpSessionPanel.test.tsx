import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";

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

vi.mock("./useSessionThumbnails", () => ({
  useSessionThumbnails: () => ({}),
}));

vi.mock("../../utils/rdp/rdpSessionHistory", () => ({
  loadSessionHistory: () => [],
  saveSessionHistory: vi.fn(),
  clearSessionHistory: vi.fn(),
  resolveRdpHistoryConnection: vi.fn(),
}));

import { useRDPSessionPanel, type RDPSessionInfo } from "./useRdpSessionPanel";

const connection = (id: string): Connection => ({
  id,
  name: id,
  protocol: "rdp",
  hostname: `${id}.example.test`,
  port: 3389,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const nativeSession = (id: string, connectionId?: string): RDPSessionInfo => ({
  id,
  connection_id: connectionId,
  host: `${id}.example.test`,
  port: 3389,
  username: "alice",
  connected: true,
  desktop_width: 1920,
  desktop_height: 1080,
  viewer_attached: true,
});

const frontendSession = (
  id: string,
  backendSessionId: string,
  connectionId: string,
  vpnLeaseOwnerId?: string,
): ConnectionSession => ({
  id,
  connectionId,
  name: id,
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "rdp",
  hostname: `${id}.example.test`,
  backendSessionId,
  vpnLeaseOwnerId,
});

const stats = (sessionId: string) => ({
  session_id: sessionId,
  uptime_secs: 60,
  bytes_received: 10,
  bytes_sent: 5,
  pdus_received: 1,
  pdus_sent: 1,
  frame_count: 1,
  fps: 1,
  input_events: 0,
  errors_recovered: 0,
  reactivations: 0,
  phase: "connected",
});

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.dispatch.mockReset();
  mocks.sessions = [];
});

describe("useRDPSessionPanel VPN cleanup", () => {
  it("disconnects RDP before releasing all owners and retains partial failures for retry", async () => {
    const conn = connection("rdp-connection");
    const row = nativeSession("rdp-native-1", conn.id);
    mocks.sessions = [
      {
        ...frontendSession("frontend-a", row.id, conn.id, "owner-a"),
        vpnLeaseOwnerIds: ["owner-previous", "owner-a"],
        layout: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 1,
          isDetached: true,
        },
      },
      frontendSession("frontend-b", row.id, conn.id, "owner-b"),
    ];
    let ownerAAttempts = 0;
    mocks.invoke.mockImplementation(
      (command: string, args?: { ownerId?: string; sessionId?: string }) => {
        if (command === "list_rdp_sessions") return Promise.resolve([row]);
        if (command === "get_rdp_stats")
          return Promise.resolve(stats(args?.sessionId ?? row.id));
        if (command === "disconnect_rdp") return Promise.resolve(undefined);
        if (command === "release_vpn_leases") {
          if (args?.ownerId === "owner-a") ownerAAttempts += 1;
          return Promise.resolve({
            owner_id: args?.ownerId,
            released: [],
            errors:
              args?.ownerId === "owner-a" && ownerAAttempts === 1
                ? ["adapter busy"]
                : [],
          });
        }
        return Promise.resolve(undefined);
      },
    );

    const { result } = renderHook(() =>
      useRDPSessionPanel({ isVisible: true, connections: [conn] }),
    );
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    let firstResult = true;
    await act(async () => {
      firstResult = await result.current.handleDisconnect(row.id);
    });
    expect(firstResult).toBe(false);
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.error).toMatch(/VPN cleanup needs attention/i);
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(commands.indexOf("disconnect_rdp")).toBeLessThan(
      commands.indexOf("release_vpn_leases"),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          id: "frontend-a",
          status: "error",
          backendSessionId: row.id,
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
        ([command]) => command === "disconnect_rdp",
      ),
    ).toHaveLength(1);
    expect(ownerAAttempts).toBe(2);
    expect(mocks.invoke).toHaveBeenCalledWith("release_vpn_leases", {
      ownerId: "owner-previous",
    });
  });

  it("bulk cleanup supports native-only rows while retaining leased failures", async () => {
    const conn = connection("rdp-connection");
    const nativeOnly = nativeSession("rdp-native-only");
    const leased = nativeSession("rdp-leased", conn.id);
    mocks.sessions = [
      frontendSession("frontend-leased", leased.id, conn.id, "owner-busy"),
    ];
    let releaseAttempts = 0;
    mocks.invoke.mockImplementation(
      (command: string, args?: { ownerId?: string; sessionId?: string }) => {
        if (command === "list_rdp_sessions")
          return Promise.resolve([nativeOnly, leased]);
        if (command === "get_rdp_stats")
          return Promise.resolve(stats(args?.sessionId ?? "unknown"));
        if (command === "disconnect_rdp") return Promise.resolve(undefined);
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

    const { result } = renderHook(() =>
      useRDPSessionPanel({ isVisible: true, connections: [conn] }),
    );
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));

    await act(async () => {
      await result.current.handleDisconnectAll();
    });
    expect(result.current.sessions.map((session) => session.id)).toEqual([
      leased.id,
    ]);

    await act(async () => {
      await result.current.handleDisconnectAll();
    });
    expect(result.current.sessions).toHaveLength(0);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command, args]) =>
          command === "disconnect_rdp" &&
          (args as { sessionId?: string })?.sessionId === leased.id,
      ),
    ).toHaveLength(1);
  });
});
