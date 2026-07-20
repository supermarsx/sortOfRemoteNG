import { describe, expect, it } from "vitest";
import { connectionReducer } from "../../src/contexts/ConnectionProvider";
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
