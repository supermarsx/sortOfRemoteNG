import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SESSION_VPN_LEASE_BINDINGS,
  type ConnectionSession,
} from "../../types/connection/connection";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

import {
  cleanupSessionVpnBackend,
  findAssociatedVpnSessions,
  sessionVpnLeaseBindings,
  withSessionVpnLeaseBinding,
} from "./sessionVpnLeaseCleanup";

const baseSession = (): ConnectionSession => ({
  id: "frontend-ssh",
  connectionId: "ssh-connection",
  name: "SSH",
  status: "error",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "ssh",
  hostname: "ssh.example.test",
});

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(
    (_command: string, args?: { ownerId?: string }) =>
      Promise.resolve({
        owner_id: args?.ownerId,
        released: [],
        errors: [],
      }),
  );
});

describe("session VPN lease cleanup", () => {
  it("clears shell A when closing current backend A promotes live backend B", async () => {
    const session: ConnectionSession = {
      ...baseSession(),
      status: "connected",
      backendSessionId: "native-a",
      shellId: "shell-a",
      vpnLeaseOwnerId: "owner-a",
      vpnLeaseOwnerIds: ["owner-a", "owner-b"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-a",
          backendSessionId: "native-a",
          protocol: "ssh",
          status: "cleanup-pending",
        },
        {
          ownerId: "owner-b",
          backendSessionId: "native-b",
          protocol: "ssh",
          status: "active",
        },
      ],
    };

    const result = await cleanupSessionVpnBackend({
      sessions: [session],
      protocol: "ssh",
      backendSessionId: "native-a",
      closeBackend: vi.fn(async () => undefined),
    });

    expect(result.backendClosed).toBe(true);
    expect(result.sessions[0].backendSessionId).toBe("native-b");
    expect(result.sessions[0].shellId).toBeUndefined();
    expect(result.sessions[0].vpnLeaseOwnerId).toBe("owner-b");
  });

  it("retries stale backend A without closing or releasing live replacement B", async () => {
    const session: ConnectionSession = {
      ...baseSession(),
      status: "connected",
      backendSessionId: "native-b",
      vpnLeaseOwnerId: "owner-b",
      vpnLeaseOwnerIds: ["owner-a", "owner-b"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-a",
          backendSessionId: "native-a",
          protocol: "ssh",
          status: "cleanup-pending",
        },
        {
          ownerId: "owner-b",
          backendSessionId: "native-b",
          protocol: "ssh",
          status: "active",
        },
      ],
    };
    const closeA = vi.fn(async () => undefined);
    let ownerAAttempts = 0;
    mocks.invoke.mockImplementation(
      (_command: string, args?: { ownerId?: string }) => {
        if (args?.ownerId === "owner-a") ownerAAttempts += 1;
        return Promise.resolve({
          owner_id: args?.ownerId,
          released: [],
          errors:
            args?.ownerId === "owner-a" && ownerAAttempts === 1
              ? ["adapter busy"]
              : [],
        });
      },
    );

    const first = await cleanupSessionVpnBackend({
      sessions: [session],
      protocol: "ssh",
      backendSessionId: "native-a",
      closeBackend: closeA,
    });
    expect(first.failures).toHaveLength(1);
    expect(first.sessions[0]).toEqual(
      expect.objectContaining({
        backendSessionId: "native-b",
        vpnLeaseOwnerId: "owner-b",
      }),
    );
    expect(first.sessions[0].vpnLeaseBindings).toEqual([
      expect.objectContaining({
        ownerId: "owner-a",
        backendSessionId: "native-a",
        status: "backend-closed",
      }),
      expect.objectContaining({
        ownerId: "owner-b",
        backendSessionId: "native-b",
        status: "active",
      }),
    ]);
    expect(mocks.invoke).not.toHaveBeenCalledWith("release_vpn_leases", {
      ownerId: "owner-b",
    });

    const retry = await cleanupSessionVpnBackend({
      sessions: first.sessions,
      protocol: "ssh",
      backendSessionId: "native-a",
      closeBackend: closeA,
    });
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(ownerAAttempts).toBe(2);
    expect(retry.sessions[0]).toEqual(
      expect.objectContaining({
        backendSessionId: "native-b",
        status: "connected",
        vpnLeaseOwnerId: "owner-b",
        vpnLeaseOwnerIds: ["owner-b"],
      }),
    );
    expect(retry.sessions[0].vpnLeaseBindings).toEqual([
      expect.objectContaining({
        ownerId: "owner-b",
        backendSessionId: "native-b",
        status: "active",
      }),
    ]);
  });

  it("migrates a safe legacy one-backend one-owner row before closing it", async () => {
    const session: ConnectionSession = {
      ...baseSession(),
      backendSessionId: "native-legacy",
      vpnLeaseOwnerId: "owner-legacy",
    };
    const snapshots: ConnectionSession[][] = [];

    const result = await cleanupSessionVpnBackend({
      sessions: [session],
      protocol: "ssh",
      backendSessionId: "native-legacy",
      closeBackend: vi.fn(async () => undefined),
      onSessionsUpdated: (updated) => {
        snapshots.push(updated.map((row) => ({ ...row })));
      },
    });

    expect(snapshots[0][0].vpnLeaseBindings).toEqual([
      expect.objectContaining({
        ownerId: "owner-legacy",
        backendSessionId: "native-legacy",
        status: "active",
      }),
    ]);
    expect(
      snapshots.some(
        ([row]) => row.vpnLeaseBindings?.[0]?.status === "backend-closed",
      ),
    ).toBe(true);
    expect(result.sessions[0].vpnLeaseOwnerId).toBeUndefined();
    expect(result.sessions[0].vpnLeaseBindings).toBeUndefined();
  });

  it("fails closed for legacy multi-owner rows after closing the backend", async () => {
    const closeBackend = vi.fn(async () => undefined);
    const result = await cleanupSessionVpnBackend({
      sessions: [
        {
          ...baseSession(),
          backendSessionId: "native-legacy",
          vpnLeaseOwnerId: "owner-current",
          vpnLeaseOwnerIds: ["owner-old", "owner-current"],
        },
      ],
      protocol: "ssh",
      backendSessionId: "native-legacy",
      closeBackend,
    });

    expect(closeBackend).toHaveBeenCalledTimes(1);
    expect(result.blockedReason).toMatch(/multiple uncorrelated/i);
    expect(result.sessions[0].vpnLeaseOwnerIds).toEqual([
      "owner-old",
      "owner-current",
    ]);
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "release_vpn_leases",
      expect.anything(),
    );
  });

  it("deduplicates concurrent release retries with durable close proof", async () => {
    const session = withSessionVpnLeaseBinding(baseSession(), {
      ownerId: "owner-a",
      backendSessionId: "native-a",
      protocol: "ssh",
      status: "backend-closed",
    });
    const closeBackend = vi.fn(async () => undefined);
    const [first, second] = await Promise.all([
      cleanupSessionVpnBackend({
        sessions: [session],
        protocol: "ssh",
        backendSessionId: "native-a",
        closeBackend,
      }),
      cleanupSessionVpnBackend({
        sessions: [session],
        protocol: "ssh",
        backendSessionId: "native-a",
        closeBackend,
      }),
    ]);
    expect(first.releasedOwnerIds).toEqual(["owner-a"]);
    expect(second.releasedOwnerIds).toEqual(["owner-a"]);
    expect(closeBackend).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("enforces the persisted binding bound without silent truncation", () => {
    let session = baseSession();
    for (let index = 0; index < 32; index += 1) {
      session = withSessionVpnLeaseBinding(session, {
        ownerId: `owner-${index}`,
        backendSessionId: `native-${index}`,
        protocol: "ssh",
        status: "active",
      });
    }
    expect(sessionVpnLeaseBindings(session)).toHaveLength(32);
    expect(() =>
      withSessionVpnLeaseBinding(session, {
        ownerId: "owner-overflow",
        backendSessionId: "native-overflow",
        protocol: "ssh",
        status: "active",
      }),
    ).toThrow(/32-binding safety limit/i);
  });

  it("quarantines exact release proof and blocks removal when the tombstone ledger is full", async () => {
    const session: ConnectionSession = {
      ...withSessionVpnLeaseBinding(baseSession(), {
        ownerId: "owner-target",
        backendSessionId: "native-target",
        protocol: "ssh",
        status: "backend-closed",
      }),
      vpnLeaseReleaseTombstones: Array.from(
        { length: MAX_SESSION_VPN_LEASE_BINDINGS },
        (_, index) => ({
          ownerId: `released-owner-${index}`,
          backendSessionId: `released-native-${index}`,
          protocol: "ssh" as const,
        }),
      ),
    };

    const result = await cleanupSessionVpnBackend({
      sessions: [session],
      protocol: "ssh",
      backendSessionId: "native-target",
      closeBackend: vi.fn(async () => undefined),
    });

    expect(result.backendClosed).toBe(true);
    expect(result.blockedReason).toMatch(/cleanup proof ledger is full/i);
    expect(result.sessions[0]).toEqual(
      expect.objectContaining({
        status: "error",
        vpnLeaseCleanupQuarantine: {
          proofs: [
            {
              kind: "release-tombstone",
              ownerId: "owner-target",
              backendSessionId: "native-target",
              protocol: "ssh",
            },
          ],
          proofIncomplete: false,
        },
      }),
    );
    expect(result.sessions[0].vpnLeaseBindings).toBeUndefined();
    expect(result.sessions[0].vpnLeaseOwnerId).toBeUndefined();
  });

  it("finds the replacement B row through quarantined exact actor A proof", () => {
    const row: ConnectionSession = {
      ...baseSession(),
      backendSessionId: "native-b",
      vpnLeaseCleanupQuarantine: {
        proofs: [
          {
            kind: "binding",
            ownerId: "owner-a",
            backendSessionId: "native-a",
            protocol: "ssh",
            status: "cleanup-pending",
          },
        ],
        proofIncomplete: false,
      },
    };

    expect(findAssociatedVpnSessions([row], "ssh", "native-a")).toEqual([row]);
  });
});
