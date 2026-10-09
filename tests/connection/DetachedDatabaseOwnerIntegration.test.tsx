import React, { useRef } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionDatabase,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type {
  DatabaseProtectionSessionGrant,
  DatabaseProtectionUnlockResult,
} from "../../src/types/encryption/databaseProtection";
import type { StorageData } from "../../src/utils/storage/storage";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<
    string,
    Set<(event: { payload: { databaseId: string } }) => void>
  >(),
}));

// Only the native disk/IPC boundary is mocked. Adoption, access events,
// provider hydration/persistence, and owner-proof capture use production code.
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => native.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (
      name: string,
      listener: (event: { payload: { databaseId: string } }) => void,
    ) => {
      const listeners = native.listeners.get(name) ?? new Set();
      listeners.add(listener);
      native.listeners.set(name, listeners);
      return () => listeners.delete(listener);
    },
  ),
}));

import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { useOriginBrowserOwner } from "../../src/hooks/protocol/useOriginBrowserOwner";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { materializeDatabaseArchiveDefaults } from "../../src/utils/connection/fullDatabaseArchive";
import { reconcileRecordLedger } from "../../src/utils/storage/recordLedger";
import { stableJsonStringify } from "../../src/utils/core/stableJsonStringify";
import { createDetachedDatabaseHandoff } from "../../src/utils/session/detachedDatabaseHandoff";

const OWNER = "detached-owner";
const OTHER_OWNER = "other-owner";
const SOURCE_TOKEN = "source-window-token";
const TARGET_TOKEN = "detached-target-token";
const NOW = "2026-10-09T00:00:00.000Z";
const connection = (id: string, name = id): Connection => ({
  id,
  name,
  protocol: "https",
  hostname: "detached.fixture.invalid",
  port: 443,
  isGroup: false,
  createdAt: NOW,
  updatedAt: NOW,
});
const session = (ownerDatabaseId = OWNER): ConnectionSession => ({
  id: "detached-browser-tab",
  connectionId: "shared-connection-id",
  ownerDatabaseId,
  name: "Detached website",
  protocol: "https",
  hostname: "detached.fixture.invalid",
  status: "connected",
  startTime: new Date(0),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let manager: DatabaseManager;
let rows: ConnectionDatabase[];
let stored: Map<string, StorageData>;
let liveTokens: Map<string, Set<string>>;
let releaseGate: ReturnType<typeof deferred<{ released: boolean }>> | undefined;
let loadGate:
  ReturnType<typeof deferred<DatabaseProtectionUnlockResult>> | undefined;

const grant = (id = OWNER): DatabaseProtectionSessionGrant => ({
  sessionId: TARGET_TOKEN,
  sessionExpiresAt: null,
  securityRevision: `${id}-revision`,
});
const loaded = (id = OWNER): DatabaseProtectionUnlockResult => ({
  ...grant(id),
  data: structuredClone(stored.get(id)!),
});
const commands = () => native.invoke.mock.calls.map(([command]) => command);
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectionProvider>{children}</ConnectionProvider>
);

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  DatabaseManager.resetInstance();
  SettingsManager.resetInstance();
  native.invoke.mockReset();
  native.listeners.clear();
  releaseGate = undefined;
  loadGate = undefined;
  rows = [OWNER, OTHER_OWNER].map((id) => ({
    id,
    name: id,
    isEncrypted: true,
    protectionFormat: "sorng-db",
    securityRevision: grant(id).securityRevision,
    createdAt: NOW,
    updatedAt: NOW,
    lastAccessed: NOW,
  }));
  stored = new Map();
  liveTokens = new Map();
  for (const id of [OWNER, OTHER_OWNER]) {
    const data = materializeDatabaseArchiveDefaults({
      connections: [
        connection("shared-connection-id", `${id} website`),
        connection("not-detached", `${id} unrelated connection`),
      ],
      settings: {},
      timestamp: 1,
    });
    data.recordMetadata = await reconcileRecordLedger(data);
    stored.set(id, data);
    liveTokens.set(id, new Set([SOURCE_TOKEN, TARGET_TOKEN]));
  }
  native.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown> = {}) => {
      const id = String(args.databaseId);
      if (command === "databases_list")
        return { value: structuredClone(rows), source: "current" };
      if (command === "databases_save_index") {
        rows = structuredClone(args.list as ConnectionDatabase[]);
        return;
      }
      if (command === "database_protection_load_plain") {
        const row = rows.find((row) => row.id === id);
        if (
          !row ||
          row.isEncrypted ||
          row.protectionFormat ||
          row.securityRevision !== args.expectedSecurityRevision
        )
          throw new Error("Native fixture denied a protected plain load.");
        return {
          securityRevision: row.securityRevision,
          data: structuredClone(stored.get(id)),
        };
      }
      if (command === "load_database_data")
        return {
          value: JSON.stringify({
            format: "sorng-db",
            version: 1,
            ciphertext: `synthetic-${id}`,
          }),
          source: "current",
        };
      if (
        command === "database_protection_load" ||
        command === "database_browser_sessions_describe" ||
        command === "database_protection_save"
      ) {
        if (
          !stored.has(id) ||
          !liveTokens.get(id)?.has(String(args.sessionId)) ||
          args.expectedSecurityRevision !== grant(id).securityRevision
        )
          throw new Error("Native fixture denied the wrong owner/grant.");
        if (command === "database_protection_load") {
          if (loadGate) {
            const pending = loadGate;
            loadGate = undefined;
            return pending.promise;
          }
          return loaded(id);
        }
        if (command === "database_browser_sessions_describe")
          return { version: 1, records: [] };
        if (
          stableJsonStringify(args.expectedData) !==
          stableJsonStringify(stored.get(id))
        )
          throw new Error("Native fixture rejected a stale database write.");
        stored.set(id, structuredClone(args.data as StorageData));
        return {
          committed: true,
          cleanupPending: false,
          warnings: [],
          securityRevision: grant(id).securityRevision,
        };
      }
      if (command === "database_protection_release_session") {
        const result = releaseGate
          ? await releaseGate.promise
          : { released: true };
        liveTokens.get(id)?.delete(String(args.sessionId));
        return result;
      }
      // Record global activation so the assertions detect it directly, even
      // when the manager observes and swallows native activation failures.
      if (command === "trust_set_active_database") return;
      throw new Error(`Unexpected native operation: ${command}`);
    },
  );
  manager = DatabaseManager.getInstance();
});

afterEach(() => {
  cleanup();
  DatabaseManager.resetInstance();
  SettingsManager.resetInstance();
  vi.useRealTimers();
});

function mount(ownerDatabaseId = OWNER) {
  const close = vi.fn(async () => {});
  const fallback = session(ownerDatabaseId);
  const view = renderHook(
    () => {
      const context = useConnections();
      const current = context.state.sessions.find(
        (row) => row.id === fallback.id,
      );
      const closeRef = useRef(close);
      const proof = useOriginBrowserOwner(
        current ?? fallback,
        context.databaseAvailability,
        closeRef,
      );
      return { context, proof };
    },
    { wrapper },
  );
  return { ...view, close };
}

async function adoptAndLoad(view: ReturnType<typeof mount>) {
  await act(async () => {
    await manager.adoptDelegatedDatabase(OWNER, grant(), {
      isCurrent: () => true,
    });
  });
  expect(view.result.current.context.databaseAvailability).toMatchObject({
    status: "loading",
    databaseId: OWNER,
  });
  expect(view.result.current.proof).toBeNull();
  await act(async () => {
    expect(await view.result.current.context.loadData(OWNER)).toBe(true);
  });
  expect(view.result.current.context.databaseAvailability).toMatchObject({
    status: "ready",
    databaseId: OWNER,
  });
}

describe("detached database owner integration", () => {
  it("hydrates all plain database rows locally without an unlock, migration or snapshot write", async () => {
    rows[0] = { ...rows[0], isEncrypted: false, protectionFormat: undefined };
    const before = structuredClone(stored.get(OWNER));
    const view = mount();
    await act(async () => {
      await manager.adoptPlainDetachedDatabase(
        OWNER,
        grant().securityRevision,
        { isCurrent: () => true },
      );
      expect(await view.result.current.context.loadData(OWNER)).toBe(true);
    });
    expect(view.result.current.context.databaseAvailability).toMatchObject({
      status: "ready",
      databaseId: OWNER,
    });
    expect(
      view.result.current.context.state.connections.map((row) => row.id),
    ).toEqual(["shared-connection-id", "not-detached"]);
    await act(async () => {
      await view.result.current.context.flushPendingSave();
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(stored.get(OWNER)).toEqual(before);
    for (const command of [
      "database_protection_unlock",
      "database_protection_save",
      "save_database_data",
      "databases_save_index",
      "trust_set_active_database",
    ])
      expect(commands()).not.toContain(command);
    await act(async () => {
      await manager.releaseDetachedDatabaseAccess(OWNER);
    });
    expect(view.result.current.context.state.connections).toEqual([]);
  });

  it("loads post-save edits with the same grant while retaining unrelated database rows", async () => {
    const view = mount();
    const adopt = vi.spyOn(manager, "adoptDelegatedDatabase");
    const release = vi.spyOn(manager, "releaseDetachedDatabaseAccess");
    const onError = vi.fn();
    const handoff = createDetachedDatabaseHandoff({
      adopt: (id, authority, options) =>
        manager.adoptDelegatedDatabase(id, authority, options),
      load: (id) => view.result.current.context.loadData(id),
      release: (id) => manager.releaseDetachedDatabaseAccess(id),
      onError,
    });
    const authority = { ...grant(), databaseId: OWNER };
    await act(async () => {
      await handoff.update(authority);
    });
    const next = structuredClone(stored.get(OWNER)!);
    next.connections[0].name = "Saved in main after detach";
    stored.set(OWNER, next);
    await act(async () => {
      await handoff.update(authority, null, { databaseId: OWNER, revision: 1 });
    });
    expect(
      view.result.current.context.state.connections.map((row) => row.name),
    ).toEqual(["Saved in main after detach", `${OWNER} unrelated connection`]);
    expect(adopt).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(commands()).not.toContain("database_protection_save");
    await act(async () => {
      await handoff.dispose();
    });
  });

  it("adopts the target grant, loads the full database, and keeps session snapshots out of persistence", async () => {
    const view = mount();
    const before = structuredClone(stored.get(OWNER));
    act(() =>
      view.result.current.context.dispatch({
        type: "SET_SESSIONS",
        payload: [session()],
      }),
    );
    expect(view.result.current.proof).toBeNull();
    expect(view.result.current.context.databaseAvailability?.status).toBe(
      "none",
    );
    expect(view.result.current.context.state.connections).toEqual([]);

    await adoptAndLoad(view);
    expect(native.invoke).toHaveBeenCalledWith("database_protection_load", {
      databaseId: OWNER,
      sessionId: TARGET_TOKEN,
      expectedSecurityRevision: grant().securityRevision,
    });
    const proof = view.result.current.proof!;
    expect(proof).toEqual({
      ownerDatabaseId: OWNER,
      sourceSessionId: TARGET_TOKEN,
      expectedSecurityRevision: grant().securityRevision,
      assertCurrent: expect.any(Function),
    });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(() => proof.assertCurrent()).not.toThrow();
    expect(
      view.result.current.context.state.connections.map((row) => row.id),
    ).toEqual(["shared-connection-id", "not-detached"]);

    for (const revision of [1, 2]) {
      act(() =>
        view.result.current.context.dispatch({
          type: "SET_SESSIONS",
          payload: [
            {
              ...session(),
              name: `Snapshot ${revision}`,
              lifecycleRevision: revision,
            },
          ],
        }),
      );
      expect(view.result.current.context.persistence).toMatchObject({
        dirty: false,
        error: null,
      });
      expect(view.result.current.proof?.sourceSessionId).toBe(TARGET_TOKEN);
    }
    await act(async () => {
      await view.result.current.context.flushPendingSave();
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(view.result.current.context.state.sessions).toHaveLength(1);
    expect(view.result.current.context.state.connections).toHaveLength(2);
    expect(stored.get(OWNER)).toEqual(before);
    view.unmount();
    expect(commands()).not.toContain("database_protection_save");
    expect(commands()).not.toContain("database_protection_unlock");
    expect(commands()).not.toContain("databases_save_index");
    expect(commands()).not.toContain("trust_set_active_database");
  });

  it("masks rows and revokes browser proof before target release IPC finishes, without locking the source", async () => {
    const view = mount();
    await adoptAndLoad(view);
    const proof = view.result.current.proof!;
    const available = view.result.current.context.databaseAvailability!;
    releaseGate = deferred();
    view.close.mockClear();
    let release!: Promise<void>;
    let finished = false;
    act(() => {
      release = manager.releaseDetachedDatabaseAccess(OWNER).then(() => {
        finished = true;
      });
      expect(manager.getCurrentDatabase()).toBeNull();
      expect(() => proof.assertCurrent()).toThrow();
    });
    expect(finished).toBe(false);
    expect(view.result.current.proof).toBeNull();
    expect(view.result.current.context.state.connections).toEqual([]);
    expect(view.result.current.context.databaseAvailability?.status).toBe(
      "none",
    );
    expect(view.close).toHaveBeenCalled();
    expect(() =>
      view.result.current.context.getCurrentConnections!({
        databaseId: OWNER,
        generation: available.generation,
      }),
    ).toThrow();
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "database_protection_release_session",
        { databaseId: OWNER, sessionId: TARGET_TOKEN },
      ),
    );
    expect(commands()).not.toContain("trust_set_active_database");
    act(() =>
      view.result.current.context.dispatch({
        type: "SET_SESSIONS",
        payload: [session()],
      }),
    );
    expect(view.result.current.proof).toBeNull();
    expect(view.result.current.context.state.connections).toEqual([]);
    await act(async () => {
      releaseGate!.resolve({ released: true });
      await release;
    });
    expect(finished).toBe(true);
    expect(liveTokens.get(OWNER)).toEqual(new Set([SOURCE_TOKEN]));
    expect(commands()).not.toContain("database_protection_lock");
    expect(commands()).not.toContain("database_protection_save");
    expect(commands()).not.toContain("trust_set_active_database");
  });

  it("denies a colliding session and connection from another database despite a ready current owner", async () => {
    const view = mount(OTHER_OWNER);
    act(() =>
      view.result.current.context.dispatch({
        type: "SET_SESSIONS",
        payload: [session(OTHER_OWNER)],
      }),
    );
    await adoptAndLoad(view);
    expect(view.result.current.context.state.connections[0].id).toBe(
      session(OTHER_OWNER).connectionId,
    );
    expect(view.result.current.context.state.sessions[0].ownerDatabaseId).toBe(
      OTHER_OWNER,
    );
    expect(view.result.current.proof).toBeNull();
    expect(() => manager.captureOriginBrowserOwnerProof(OTHER_OWNER)).toThrow();
    await act(async () => {
      expect(await view.result.current.context.loadData(OTHER_OWNER)).toBe(
        false,
      );
      await expect(
        manager.adoptDelegatedDatabase(OTHER_OWNER, grant(OTHER_OWNER), {
          isCurrent: () => true,
        }),
      ).rejects.toThrow(/previous detached database/);
    });
    expect(manager.getCurrentDatabase()?.id).toBe(OWNER);
    expect(view.result.current.context.databaseAvailability).toMatchObject({
      status: "ready",
      databaseId: OWNER,
    });
    expect(view.result.current.proof).toBeNull();
    expect(
      native.invoke.mock.calls.filter(
        ([command, args]) =>
          command === "database_protection_load" &&
          args.databaseId === OTHER_OWNER,
      ),
    ).toEqual([]);
    expect(commands()).not.toContain("database_protection_unlock");
    expect(commands()).not.toContain("database_protection_save");
  });

  it("does not revive released access when a provider reload returns its old native payload", async () => {
    const view = mount();
    await adoptAndLoad(view);
    const oldPayload = loaded();
    const pending = deferred<DatabaseProtectionUnlockResult>();
    loadGate = pending;
    let reload!: Promise<boolean>;
    act(() => {
      reload = view.result.current.context.loadData(OWNER);
    });
    await waitFor(() => expect(loadGate).toBeUndefined());
    await act(async () => {
      await manager.releaseDetachedDatabaseAccess(OWNER);
    });
    expect(view.result.current.context.state.connections).toEqual([]);
    expect(view.result.current.proof).toBeNull();
    await act(async () => {
      pending.resolve(oldPayload);
      expect(await reload).toBe(false);
    });
    expect(view.result.current.context.databaseAvailability?.status).toBe(
      "none",
    );
    expect(view.result.current.context.state.connections).toEqual([]);
    expect(view.result.current.proof).toBeNull();
    expect(commands()).not.toContain("database_protection_lock");
    expect(commands()).not.toContain("database_protection_save");
  });
});
