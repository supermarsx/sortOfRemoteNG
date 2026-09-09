import { describe, expect, it } from "vitest";
import {
  connectionReducer,
  reconcileSessionSnapshot,
  type SessionSnapshotReconciliationDiagnostics,
} from "../../src/contexts/ConnectionProvider";
import type { ConnectionState } from "../../src/contexts/ConnectionContextTypes";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import {
  prepareConnectionForClone,
  prepareConnectionForExport,
  normalizeImportedAdvancedProtocolConnection,
} from "../../src/components/ImportExport/advancedProtocolPortability";

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

describe("folder default tab-group inheritance", () => {
  const connection = (
    id: string,
    overrides: Partial<Connection> = {},
  ): Connection => ({
    id,
    name: id,
    protocol: "ssh",
    hostname: "fixture.example.test",
    port: 22,
    isGroup: false,
    createdAt: "2026-09-09T00:00:00Z",
    updatedAt: "2026-09-09T00:00:00Z",
    ...overrides,
  });
  const groups = [
    "root-group",
    "near-group",
    "own-group",
    "explicit-group",
  ].map((id) => ({ id, name: id, color: "#4488cc" }));
  const tree = [
    connection("root", { isGroup: true, defaultTabGroupId: "root-group" }),
    connection("near", {
      isGroup: true,
      parentId: "root",
      defaultTabGroupId: "near-group",
    }),
    connection("connection-1", {
      parentId: "near",
      defaultTabGroupId: "own-group",
    }),
  ];
  const add = (connections = tree, explicit?: string) =>
    connectionReducer(
      { ...state, connections, tabGroups: groups },
      {
        type: "ADD_SESSION",
        payload: { ...session, id: "new-session", tabGroupId: explicit },
      },
    );

  it("prioritizes explicit session, connection, nearest folder, then outer folder defaults", () => {
    expect(add(tree, "explicit-group").sessions.at(-1)?.tabGroupId).toBe(
      "explicit-group",
    );
    expect(add().sessions.at(-1)?.tabGroupId).toBe("own-group");
    const childInherits = tree.map((item) =>
      item.id === "connection-1"
        ? { ...item, defaultTabGroupId: undefined }
        : item,
    );
    expect(add(childInherits).sessions.at(-1)?.tabGroupId).toBe("near-group");
    const outerInherits = childInherits.map((item) =>
      item.id === "near" ? { ...item, defaultTabGroupId: undefined } : item,
    );
    expect(add(outerInherits).sessions.at(-1)?.tabGroupId).toBe("root-group");
  });

  it("skips deleted group IDs and safely stops cycles, missing parents and non-folder parents", () => {
    const deleted = tree.map((item) =>
      item.id !== "root"
        ? { ...item, defaultTabGroupId: "deleted-group" }
        : item,
    );
    expect(
      add(deleted, "deleted-session-group").sessions.at(-1)?.tabGroupId,
    ).toBe("root-group");
    for (const connections of [
      [connection("connection-1", { parentId: "missing" })],
      [
        connection("connection-1", { parentId: "non-folder" }),
        connection("non-folder", { defaultTabGroupId: "root-group" }),
      ],
      [
        connection("connection-1", { parentId: "a" }),
        connection("a", { isGroup: true, parentId: "b" }),
        connection("b", { isGroup: true, parentId: "a" }),
      ],
      [],
    ])
      expect(
        add(connections, "deleted-session-group").sessions.at(-1)?.tabGroupId,
      ).toBeUndefined();
  });

  it("applies current folder defaults to future children without rewriting child records or open sessions", () => {
    const child = connection("future", { parentId: "root" });
    const before = {
      ...state,
      connections: [tree[0], child],
      tabGroups: groups,
      sessions: [{ ...session, tabGroupId: "own-group" }],
    };
    const edited = connectionReducer(before, {
      type: "UPDATE_CONNECTION",
      payload: { ...tree[0], defaultTabGroupId: "near-group" },
    });
    expect(edited.sessions).toBe(before.sessions);
    const after = connectionReducer(edited, {
      type: "ADD_SESSION",
      payload: { ...session, id: "future-session", connectionId: "future" },
    });
    expect(after.sessions.at(-1)?.tabGroupId).toBe("near-group");
    expect(after.connections).toBe(edited.connections);
    expect(after.connections.find((item) => item.id === "future")).toBe(child);
    expect(after.sessions[0]).toBe(before.sessions[0]);
  });

  it("retains the non-secret folder default through JSON export/import and clone preparation", () => {
    const folder = { ...tree[0], password: "must-not-export" };
    const portable = prepareConnectionForExport(folder, false);
    expect(portable.defaultTabGroupId).toBe("root-group");
    expect(JSON.stringify(portable)).not.toContain("must-not-export");
    const imported = normalizeImportedAdvancedProtocolConnection(
      JSON.parse(JSON.stringify(portable)),
    );
    expect(imported.defaultTabGroupId).toBe("root-group");
    expect(prepareConnectionForClone(imported, false).defaultTabGroupId).toBe(
      "root-group",
    );
    const withoutGroups = connectionReducer(
      {
        ...state,
        connections: [
          imported,
          connection("connection-1", { parentId: imported.id }),
        ],
        tabGroups: [],
      },
      { type: "ADD_SESSION", payload: session },
    );
    expect(withoutGroups.sessions.at(-1)?.tabGroupId).toBeUndefined();
  });
});

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
