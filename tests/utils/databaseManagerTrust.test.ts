/**
 * t62 / e6 — the frontend trust store follows the active database.
 *
 * `DatabaseManager` is exercised for real over a stubbed Tauri bridge (the
 * same in-memory file-store shim `databaseManagerIpc.test.ts` uses) so the
 * assertions cover the actual transition ordering, not a hand-rolled
 * re-implementation of it. The trust store is imported alongside it because
 * the two halves of the feature only mean anything together: a switch has to
 * both re-point the native runtime *and* drop the cache of the database the
 * user just left.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

// `trustStore.ts` talks to the native side through the ESM import; the
// database manager goes through `globalThis.__TAURI__`. Both are routed to
// the same spy so one transcript covers the whole flow.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: bridge.invoke,
}));

import { openDB } from "idb";
import {
  DatabaseManager,
  onCurrentDatabaseChange,
  type CurrentDatabaseChange,
} from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import {
  ensureTrustStoreReady,
  getAllTrustRecords,
  getTrustStoreScope,
  NoActiveDatabaseError,
  resetTrustStoreCacheForTests,
  type TrustExportDocument,
} from "../../src/utils/auth/trustStore";

const DB_NAME = "mremote-keyval";
const STORE_NAME = "keyval";

type Source = "current" | "backup" | "v0-migration";

interface TrustFile {
  records: Array<Record<string, any>>;
  policy: string;
}

/** In-memory stand-in for the Rust side: databases plus their trust files. */
const native = {
  index: [] as any[],
  data: new Map<string, unknown>(),
  trust: new Map<string, TrustFile>(),
  activeDatabaseId: null as string | null,
  activations: [] as Array<{
    databaseId: string | null;
    connectionIds: string[];
  }>,
  failTrust: false,
};

function trustFileFor(databaseId: string): TrustFile {
  let file = native.trust.get(databaseId);
  if (!file) {
    file = { records: [], policy: "tofu" };
    native.trust.set(databaseId, file);
  }
  return file;
}

function activeTrustFile(): TrustFile | null {
  return native.activeDatabaseId ? trustFileFor(native.activeDatabaseId) : null;
}

function nativeInvoke(command: string, args: any = {}): unknown {
  switch (command) {
    // ── database file store ──
    case "databases_list":
      return { value: native.index, source: "current" as Source };
    case "databases_save_index":
      native.index = (args.list as any[]) ?? [];
      return undefined;
    case "load_database_data": {
      const value = native.data.get(args.databaseId as string);
      return value === undefined
        ? null
        : { value, source: "current" as Source };
    }
    case "save_database_data":
      native.data.set(args.databaseId as string, args.data);
      return undefined;
    case "delete_database_data":
      native.data.delete(args.databaseId as string);
      native.trust.delete(args.databaseId as string);
      return undefined;

    // ── trust runtime (t62-e1b command surface) ──
    case "trust_set_active_database": {
      if (native.failTrust) throw new Error("trust runtime unavailable");
      native.activations.push({
        databaseId: args.databaseId ?? null,
        connectionIds: args.connectionIds ?? [],
      });
      native.activeDatabaseId = args.databaseId ?? null;
      return {
        databaseId: native.activeDatabaseId,
        encrypted: false,
        recordCount: activeTrustFile()?.records.length ?? 0,
        seededRecords: 0,
      };
    }
    case "trust_get_active_database":
      return {
        databaseId: native.activeDatabaseId,
        encrypted: false,
        recordCount: activeTrustFile()?.records.length ?? 0,
        seededRecords: 0,
      };
    case "trust_export_database": {
      const file = trustFileFor(args.databaseId as string);
      return {
        version: 1,
        records: structuredClone(file.records),
        policy: file.policy,
        policyConfig: {},
      };
    }
    case "trust_import_database": {
      const file = trustFileFor(args.databaseId as string);
      const document = args.document as TrustExportDocument;
      const incoming = structuredClone(document.records ?? []) as Array<
        Record<string, any>
      >;
      if (args.mode === "replace") {
        file.records = incoming;
        return { imported: incoming.length, skipped: 0 };
      }
      let imported = 0;
      let skipped = 0;
      for (const record of incoming) {
        const existing = file.records.findIndex(
          (candidate) =>
            candidate.host === record.host &&
            candidate.record_type === record.record_type,
        );
        if (existing >= 0) {
          skipped += 1;
          continue;
        }
        file.records.push(record);
        imported += 1;
      }
      return { imported, skipped };
    }
    case "trust_get_all_records": {
      const file = activeTrustFile();
      if (!file) throw new Error("no active database");
      return structuredClone(file.records);
    }
    case "trust_store_identity":
    case "trust_store_identity_with_reason": {
      const file = activeTrustFile();
      if (!file) throw new Error("no active database");
      file.records.push({
        host: args.host,
        record_type: args.recordType,
        identity: args.identity,
        user_approved: args.userApproved,
        nickname: args.nickname ?? null,
        history: [],
      });
      return undefined;
    }
    default:
      throw new Error(`unexpected command ${command}`);
  }
}

function makeCollection(id: string, name: string) {
  const iso = "2026-01-01T00:00:00.000Z";
  return {
    id,
    name,
    isEncrypted: false,
    createdAt: iso,
    updatedAt: iso,
    lastAccessed: iso,
  };
}

/** Seed a database directly into the native shim, bypassing the manager. */
function seedDatabase(id: string, name: string, connectionIds: string[]) {
  native.index.push(makeCollection(id, name));
  native.data.set(id, {
    connections: connectionIds.map((connectionId) => ({
      id: connectionId,
      name: connectionId,
      protocol: "ssh",
      hostname: "example.test",
      port: 22,
    })),
    settings: {},
    timestamp: Date.now(),
    tabGroups: [],
    colorTags: {},
  });
}

function trustRecord(host: string, fingerprint: string) {
  return {
    host,
    record_type: "ssh",
    identity: {
      kind: "ssh",
      fingerprint,
      first_seen: "2026-01-01T00:00:00.000Z",
      last_seen: "2026-01-01T00:00:00.000Z",
    },
    user_approved: true,
    nickname: null,
    history: [],
  };
}

function lastActivation() {
  return native.activations[native.activations.length - 1];
}

let manager: DatabaseManager;
let logActionSpy: ReturnType<typeof vi.spyOn> | null = null;
let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(async () => {
  native.index = [];
  native.data = new Map();
  native.trust = new Map();
  native.activeDatabaseId = null;
  native.activations = [];
  native.failTrust = false;

  await IndexedDbService.init();
  const db = await openDB(DB_NAME, 1);
  await db.clear(STORE_NAME);

  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string, args?: any) =>
    nativeInvoke(command, args),
  );
  (globalThis as any).__TAURI__ = { core: { invoke: bridge.invoke } };

  logActionSpy = vi
    .spyOn(SettingsManager.prototype, "logAction")
    .mockImplementation(() => Promise.resolve());
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  DatabaseManager.resetInstance();
  manager = new DatabaseManager();
  resetTrustStoreCacheForTests();
});

afterEach(() => {
  delete (globalThis as any).__TAURI__;
  logActionSpy?.mockRestore();
  logActionSpy = null;
  warnSpy?.mockRestore();
  warnSpy = null;
});

/** Let the fire-and-forget trust activation settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe("DatabaseManager → active trust database", () => {
  it("points the Trust Center at the opened database and its connection ids", async () => {
    seedDatabase("db-a", "Alpha", ["conn-1", "conn-2"]);

    await manager.selectDatabase("db-a");
    await settle();

    expect(native.activations).toEqual([
      { databaseId: "db-a", connectionIds: ["conn-1", "conn-2"] },
    ]);
  });

  it("re-points on a switch and clears the outgoing database's trust cache", async () => {
    seedDatabase("db-a", "Alpha", ["conn-1"]);
    seedDatabase("db-b", "Bravo", ["conn-9"]);
    trustFileFor("db-a").records.push(trustRecord("alpha.test:22", "SHA256:a"));
    trustFileFor("db-b").records.push(trustRecord("bravo.test:22", "SHA256:b"));

    await manager.selectDatabase("db-a");
    await settle();
    await ensureTrustStoreReady();
    expect(getAllTrustRecords().map((record) => record.host)).toEqual([
      "alpha.test:22",
    ]);
    expect(getTrustStoreScope().databaseId).toBe("db-a");

    await manager.selectDatabase("db-b");
    await settle();

    expect(lastActivation()).toEqual({
      databaseId: "db-b",
      connectionIds: ["conn-9"],
    });
    // Alpha's record must not survive the switch even before Bravo hydrates.
    expect(
      getAllTrustRecords().some((record) => record.host === "alpha.test:22"),
    ).toBe(false);

    await ensureTrustStoreReady();
    expect(getAllTrustRecords().map((record) => record.host)).toEqual([
      "bravo.test:22",
    ]);
    expect(getTrustStoreScope().databaseId).toBe("db-b");
  });

  it("clears the active database on close and fails trust decisions closed", async () => {
    seedDatabase("db-a", "Alpha", ["conn-1"]);
    trustFileFor("db-a").records.push(trustRecord("alpha.test:22", "SHA256:a"));

    await manager.selectDatabase("db-a");
    await settle();
    await ensureTrustStoreReady();
    expect(getAllTrustRecords()).toHaveLength(1);

    manager.closeCurrentDatabase();
    await settle();

    expect(lastActivation()).toEqual({
      databaseId: null,
      connectionIds: [],
    });
    expect(getTrustStoreScope()).toMatchObject({
      databaseId: null,
      resolved: true,
    });
    expect(getAllTrustRecords()).toEqual([]);
    await expect(ensureTrustStoreReady()).rejects.toBeInstanceOf(
      NoActiveDatabaseError,
    );
  });

  it("locking the open database reports reason 'lock' and deactivates trust", async () => {
    seedDatabase("db-a", "Alpha", []);
    const seen: CurrentDatabaseChange[] = [];
    const unsubscribe = onCurrentDatabaseChange((change) => {
      seen.push(change);
    });

    await manager.selectDatabase("db-a");
    manager.lockDatabase("db-a");
    await settle();
    unsubscribe();

    expect(seen.map((change) => change.reason)).toEqual(["open", "lock"]);
    expect(seen[1]).toMatchObject({
      database: null,
      databaseId: null,
      previousDatabaseId: "db-a",
    });
    expect(lastActivation()).toEqual({
      databaseId: null,
      connectionIds: [],
    });
  });

  it("deleting the open database deactivates trust; deleting another does not", async () => {
    seedDatabase("db-a", "Alpha", []);
    seedDatabase("db-b", "Bravo", []);

    await manager.selectDatabase("db-a");
    await settle();
    const afterOpen = native.activations.length;

    await manager.deleteDatabase("db-b");
    await settle();
    expect(native.activations).toHaveLength(afterOpen);

    await manager.deleteDatabase("db-a");
    await settle();
    expect(lastActivation()).toEqual({
      databaseId: null,
      connectionIds: [],
    });
  });

  it("creating a database announces the event without moving the trust scope", async () => {
    seedDatabase("db-a", "Alpha", []);
    await manager.selectDatabase("db-a");
    await settle();
    const afterOpen = native.activations.length;

    const seen: CurrentDatabaseChange[] = [];
    const unsubscribe = onCurrentDatabaseChange((change) => seen.push(change));
    const created = await manager.createDatabase("Charlie");
    await settle();
    unsubscribe();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      reason: "create",
      databaseId: created.id,
      database: expect.objectContaining({ id: "db-a" }),
    });
    expect(native.activations).toHaveLength(afterOpen);
  });

  it("keeps the database usable when the trust runtime fails", async () => {
    seedDatabase("db-a", "Alpha", []);
    native.failTrust = true;

    await expect(manager.selectDatabase("db-a")).resolves.toBeUndefined();
    await settle();

    expect(manager.getCurrentDatabase()?.id).toBe("db-a");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("isolates a throwing listener from the transition", async () => {
    seedDatabase("db-a", "Alpha", []);
    const good = vi.fn();
    const offBad = onCurrentDatabaseChange(() => {
      throw new Error("listener exploded");
    });
    const offGood = onCurrentDatabaseChange(good);

    await expect(manager.selectDatabase("db-a")).resolves.toBeUndefined();
    offBad();
    offGood();

    expect(good).toHaveBeenCalledTimes(1);
    expect(manager.getCurrentDatabase()?.id).toBe("db-a");
  });

  it("stops delivering to an unsubscribed listener", async () => {
    seedDatabase("db-a", "Alpha", []);
    const listener = vi.fn();
    onCurrentDatabaseChange(listener)();

    await manager.selectDatabase("db-a");

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("export snapshot trust participation", () => {
  it("carries the database's trust records by default", async () => {
    seedDatabase("db-a", "Alpha", ["conn-1"]);
    trustFileFor("db-a").records.push(trustRecord("alpha.test:22", "SHA256:a"));

    const snapshot = await manager.readExportableDatabaseSnapshot("db-a");

    expect(snapshot.trustRecords).toMatchObject({ version: 1 });
    expect(snapshot.trustRecords?.records).toHaveLength(1);
    expect(snapshot.trustRecords?.records[0].host).toBe("alpha.test:22");
  });

  it("omits them when the caller opts out", async () => {
    seedDatabase("db-a", "Alpha", []);
    trustFileFor("db-a").records.push(trustRecord("alpha.test:22", "SHA256:a"));

    const snapshot = await manager.readExportableDatabaseSnapshot(
      "db-a",
      false,
      { includeTrust: false },
    );

    expect(snapshot).not.toHaveProperty("trustRecords");
    expect(
      bridge.invoke.mock.calls.some((c) => c[0] === "trust_export_database"),
    ).toBe(false);
  });

  it("omits them rather than failing when the native export errors", async () => {
    seedDatabase("db-a", "Alpha", []);
    bridge.invoke.mockImplementation(async (command: string, args?: any) => {
      if (command === "trust_export_database") throw new Error("nope");
      return nativeInvoke(command, args);
    });

    const snapshot = await manager.readExportableDatabaseSnapshot("db-a");

    expect(snapshot.trustRecords).toBeUndefined();
    expect(snapshot.connections).toEqual([]);
  });
});

describe("import / append / clone apply trust records", () => {
  it("importDatabase merges the export's trust records into the new database", async () => {
    const document: TrustExportDocument = {
      version: 1,
      records: [trustRecord("imported.test:22", "SHA256:i") as any],
      policy: "tofu",
    };
    const content = JSON.stringify({
      collection: { name: "Imported" },
      connections: [],
      settings: {},
      trustRecords: document,
    });

    const created = await manager.importDatabase(content);

    expect(native.trust.get(created.id)?.records.map((r) => r.host)).toEqual([
      "imported.test:22",
    ]);
    const call = bridge.invoke.mock.calls.find(
      (c) => c[0] === "trust_import_database",
    );
    expect(call?.[1]).toMatchObject({ databaseId: created.id, mode: "merge" });
  });

  it("importDatabase skips trust when the caller opts out", async () => {
    const content = JSON.stringify({
      collection: { name: "Imported" },
      connections: [],
      trustRecords: {
        version: 1,
        records: [trustRecord("imported.test:22", "SHA256:i")],
      },
    });

    const created = await manager.importDatabase(content, {
      includeTrust: false,
    });

    expect(native.trust.get(created.id)).toBeUndefined();
  });

  it("importDatabase accepts a pre-t62 export with no trustRecords", async () => {
    const content = JSON.stringify({
      collection: { name: "Legacy" },
      connections: [{ id: "c1", name: "one" }],
    });

    const created = await manager.importDatabase(content);

    expect(created.name).toBe("Legacy");
    expect(
      bridge.invoke.mock.calls.some((c) => c[0] === "trust_import_database"),
    ).toBe(false);
  });

  it("appendConnectionsToDatabase merges supplied trust records", async () => {
    seedDatabase("db-a", "Alpha", ["conn-1"]);
    trustFileFor("db-a").records.push(trustRecord("alpha.test:22", "SHA256:a"));

    await manager.appendConnectionsToDatabase(
      "db-a",
      [{ id: "conn-2", name: "two", protocol: "ssh" } as any],
      {
        trustRecords: {
          version: 1,
          records: [
            trustRecord("alpha.test:22", "SHA256:other") as any,
            trustRecord("added.test:22", "SHA256:n") as any,
          ],
        },
      },
    );

    // Merge keeps the existing record for the same host and adds the new one.
    expect(native.trust.get("db-a")?.records.map((r) => r.host)).toEqual([
      "alpha.test:22",
      "added.test:22",
    ]);
    expect(native.trust.get("db-a")?.records[0].identity.fingerprint).toBe(
      "SHA256:a",
    );
  });

  it("duplicateDatabase copies the source's trust store into the clone", async () => {
    seedDatabase("db-a", "Alpha", ["conn-1"]);
    trustFileFor("db-a").records.push(trustRecord("alpha.test:22", "SHA256:a"));

    const clone = await manager.duplicateDatabase("db-a");

    expect(native.trust.get(clone.id)?.records.map((r) => r.host)).toEqual([
      "alpha.test:22",
    ]);
    const call = bridge.invoke.mock.calls.find(
      (c) => c[0] === "trust_import_database",
    );
    expect(call?.[1]).toMatchObject({ databaseId: clone.id, mode: "replace" });
  });

  it("duplicateDatabase leaves the clone's trust store empty when opted out", async () => {
    seedDatabase("db-a", "Alpha", []);
    trustFileFor("db-a").records.push(trustRecord("alpha.test:22", "SHA256:a"));

    const clone = await manager.duplicateDatabase("db-a", {
      includeTrust: false,
    });

    expect(native.trust.get(clone.id)).toBeUndefined();
  });
});
