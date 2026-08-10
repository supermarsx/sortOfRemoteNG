import { describe, expect, it } from "vitest";
import {
  connectionReducer,
  reconcileSessionSnapshot,
  type SessionSnapshotReconciliationDiagnostics,
} from "../../src/contexts/ConnectionProvider";
import type { ConnectionState } from "../../src/contexts/ConnectionContextTypes";
import type { ConnectionSession } from "../../src/types/connection/connection";

const session: ConnectionSession = {
  id: "session-1",
  connectionId: "connection-1",
  name: "Original",
  status: "connected",
  startTime: new Date("2026-07-19T09:00:00.000Z"),
  lastActivity: new Date("2026-07-19T09:30:00.000Z"),
  protocol: "ssh",
  hostname: "host.example",
  backendSessionId: "backend-current",
  shellId: "shell-current",
  vpnLeaseOwnerId: "owner-current",
};

const state: ConnectionState = {
  connections: [],
  sessions: [session],
  selectedConnection: null,
  selectedConnectionIds: new Set(),
  filter: {
    searchTerm: "",
    protocols: [],
    tags: [],
    colorTags: [],
    showRecent: false,
    showFavorites: false,
    sortBy: "custom",
    sortDirection: "asc",
  },
  isLoading: false,
  sidebarCollapsed: false,
  tabGroups: [],
};

describe("connectionReducer UPDATE_SESSION", () => {
  it("merges a patch without erasing newer lifecycle fields", () => {
    const next = connectionReducer(state, {
      type: "UPDATE_SESSION",
      payload: {
        id: "session-1",
        name: "Renamed",
        layout: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 1,
          isDetached: true,
        },
      },
    });

    expect(next.sessions[0]).toEqual(
      expect.objectContaining({
        name: "Renamed",
        backendSessionId: "backend-current",
        shellId: "shell-current",
        vpnLeaseOwnerId: "owner-current",
        lastActivity: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
  });

  it("increments lifecycle revision and clears a shell tied to a replaced backend", () => {
    const next = connectionReducer(state, {
      type: "UPDATE_SESSION",
      payload: {
        id: "session-1",
        backendSessionId: "backend-replacement",
      },
    });

    expect(next.sessions[0]).toEqual(
      expect.objectContaining({
        backendSessionId: "backend-replacement",
        lifecycleRevision: 1,
      }),
    );
    expect(next.sessions[0]).not.toHaveProperty("shellId");
  });

  it("keeps newer detached ownership when an older full main sync arrives", () => {
    const detached = {
      ...session,
      backendSessionId: "backend-detached-new",
      shellId: "shell-detached-new",
      vpnLeaseOwnerId: "owner-detached-new",
      vpnLeaseOwnerIds: ["owner-detached-new"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-detached-new",
          backendSessionId: "backend-detached-new",
          protocol: "ssh" as const,
          status: "active" as const,
        },
      ],
      lifecycleRevision: 2,
    };
    const staleMain = {
      ...session,
      name: "Renamed by main",
      lifecycleRevision: 1,
    };

    const next = connectionReducer(
      { ...state, sessions: [detached] },
      { type: "SET_SESSIONS", payload: [staleMain] },
    );

    expect(next.sessions[0]).toEqual(
      expect.objectContaining({
        name: "Renamed by main",
        backendSessionId: "backend-detached-new",
        shellId: "shell-detached-new",
        vpnLeaseOwnerId: "owner-detached-new",
        lifecycleRevision: 2,
      }),
    );
    expect(next.sessions[0].vpnLeaseBindings).toEqual(
      detached.vpnLeaseBindings,
    );
  });

  it("honors authoritative clears from a newer full lifecycle revision", () => {
    const current = {
      ...session,
      vpnLeaseOwnerIds: ["owner-current"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-current",
          backendSessionId: "backend-current",
          protocol: "ssh" as const,
          status: "backend-closed" as const,
        },
      ],
      lifecycleRevision: 3,
    };
    const authoritativeClear = {
      ...current,
      lifecycleRevision: 4,
      backendSessionId: undefined,
      shellId: undefined,
      vpnLeaseOwnerId: undefined,
      vpnLeaseOwnerIds: undefined,
      vpnLeaseBindings: undefined,
      vpnLeaseReleaseTombstones: [
        {
          ownerId: "owner-current",
          backendSessionId: "backend-current",
          protocol: "ssh" as const,
        },
      ],
    };

    const next = connectionReducer(
      { ...state, sessions: [current] },
      { type: "UPDATE_SESSION", payload: authoritativeClear },
    );

    expect(next.sessions[0].lifecycleRevision).toBe(4);
    expect(next.sessions[0]).not.toHaveProperty("backendSessionId");
    expect(next.sessions[0]).not.toHaveProperty("shellId");
    expect(next.sessions[0]).not.toHaveProperty("vpnLeaseOwnerId");
    expect(next.sessions[0]).not.toHaveProperty("vpnLeaseOwnerIds");
    expect(next.sessions[0]).not.toHaveProperty("vpnLeaseBindings");
    expect(next.sessions[0].vpnLeaseReleaseTombstones).toEqual(
      authoritativeClear.vpnLeaseReleaseTombstones,
    );
  });

  it("does not let a higher-revision old A cleanup erase detached B", () => {
    const detachedB: ConnectionSession = {
      ...session,
      backendSessionId: "backend-b",
      shellId: "shell-b",
      vpnLeaseOwnerId: "owner-b",
      vpnLeaseOwnerIds: ["owner-b"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-b",
          backendSessionId: "backend-b",
          protocol: "ssh",
          status: "active",
        },
      ],
      lifecycleRevision: 2,
      lifecycleActorGeneration: 2,
      lifecycleWriterId: "detached-session-1",
      layout: {
        x: 11,
        y: 22,
        width: 900,
        height: 700,
        zIndex: 4,
        isDetached: true,
        windowId: "detached-session-1",
      },
    };
    const oldMainA: ConnectionSession = {
      ...session,
      name: "Latest presentation name",
      status: "error",
      errorMessage: "A cleanup failed",
      vpnLeaseOwnerIds: ["owner-current"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-current",
          backendSessionId: "backend-current",
          protocol: "ssh",
          status: "cleanup-pending",
        },
      ],
      lifecycleRevision: 50,
      lifecycleActorGeneration: 1,
      lifecycleWriterId: "main",
      layout: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 1,
        isDetached: false,
      },
    };

    const next = connectionReducer(
      { ...state, sessions: [detachedB] },
      { type: "SET_SESSIONS", payload: [oldMainA] },
    );

    expect(next.sessions[0]).toEqual(
      expect.objectContaining({
        name: "Latest presentation name",
        backendSessionId: "backend-b",
        shellId: "shell-b",
        status: "connected",
        lifecycleActorGeneration: 2,
        lifecycleWriterId: "detached-session-1",
        layout: detachedB.layout,
      }),
    );
    expect(next.sessions[0].vpnLeaseBindings).toEqual([
      detachedB.vpnLeaseBindings![0],
      oldMainA.vpnLeaseBindings![0],
    ]);
  });

  it("keeps local detached authority on an equal-generation actor conflict", () => {
    const detachedB: ConnectionSession = {
      ...session,
      backendSessionId: "backend-b",
      shellId: "shell-b",
      lifecycleRevision: 4,
      lifecycleActorGeneration: 2,
      lifecycleWriterId: "detached-session-1",
    };
    const conflictingMainA: ConnectionSession = {
      ...session,
      lifecycleRevision: 40,
      lifecycleActorGeneration: 2,
      lifecycleWriterId: "main",
    };

    const next = connectionReducer(
      { ...state, sessions: [detachedB] },
      { type: "SET_SESSIONS", payload: [conflictingMainA] },
    );

    expect(next.sessions[0]).toEqual(
      expect.objectContaining({
        backendSessionId: "backend-b",
        shellId: "shell-b",
        lifecycleRevision: 4,
        lifecycleActorGeneration: 2,
        lifecycleWriterId: "detached-session-1",
      }),
    );
  });
});

describe("connectionReducer SET_SESSIONS scalability", () => {
  const makeSessions = (count: number): ConnectionSession[] =>
    Array.from({ length: count }, (_, index) => ({
      ...session,
      id: `session-${index}`,
      connectionId: `connection-${index}`,
      name: `Current ${index}`,
      backendSessionId: `backend-${index}`,
      shellId: `shell-${index}`,
      lifecycleRevision: 2,
    }));

  it("preserves incoming ordering and the previous first-match behavior", () => {
    const first = { ...session, name: "First current" };
    const duplicate = { ...session, name: "Duplicate current" };
    const incoming = [
      { ...session, id: "new", name: "New" },
      { ...session, name: "Incoming" },
    ];

    const reconciled = reconcileSessionSnapshot([first, duplicate], incoming);

    expect(reconciled.map((candidate) => candidate.id)).toEqual([
      "new",
      "session-1",
    ]);
    expect(reconciled[1].name).toBe("Incoming");
    expect(reconciled[1].backendSessionId).toBe(first.backendSessionId);
  });

  it("uses exactly one index visit and one lookup per row at 100/500/1000", () => {
    const operationCounts: number[] = [];

    for (const count of [100, 500, 1_000]) {
      const current = makeSessions(count);
      const incoming = [...current].reverse().map((candidate) => ({
        ...candidate,
        name: `Incoming ${candidate.id}`,
      }));
      let diagnostics: SessionSnapshotReconciliationDiagnostics | undefined;

      const reconciled = reconcileSessionSnapshot(
        current,
        incoming,
        (snapshot) => {
          diagnostics = snapshot;
        },
      );

      expect(reconciled.map((candidate) => candidate.id)).toEqual(
        incoming.map((candidate) => candidate.id),
      );
      expect(diagnostics).toEqual({
        indexedSessions: count,
        lookupSessions: count,
        matchedSessions: count,
      });
      operationCounts.push(
        diagnostics!.indexedSessions + diagnostics!.lookupSessions,
      );
    }

    expect(operationCounts).toEqual([200, 1_000, 2_000]);
    expect(operationCounts[1] / operationCounts[0]).toBe(5);
    expect(operationCounts[2] / operationCounts[0]).toBe(10);
  });
});
