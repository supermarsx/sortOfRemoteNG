/**
 * Coverage for the IPC-backed branches of `DatabaseManager` introduced
 * in P3 — `getAllDatabases`, `saveDatabases`, `saveDatabaseData`,
 * `loadDatabaseData`, and `deleteDatabase` all now prefer the P1
 * Tauri commands over IndexedDB.
 *
 * The existing `collectionManager.test.ts` runs without a Tauri runtime
 * stubbed in, so `getInvoke()` returns `null` there and only the IDB
 * fallback gets exercised. Here we stub the legacy
 * `globalThis.__TAURI__.core.invoke` global — `getInvoke` picks that up
 * first — and back it with an in-memory simulation of the file store.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openDB } from "idb";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { SettingsManager } from "../../src/utils/settings/settingsManager";

const DB_NAME = "mremote-keyval";
const STORE_NAME = "keyval";

// In-memory shim mirroring the Rust file commands.
type Source = "current" | "backup" | "v0-migration";
interface InvokeArgs extends Record<string, unknown> {
  databaseId?: string;
  list?: unknown;
  data?: unknown;
}

let fileStore: Map<string, { value: unknown; source: Source }>;
let indexFile: { value: unknown[]; source: Source } | null;
let invokeSpy: ReturnType<typeof vi.fn>;
let logActionSpy: ReturnType<typeof vi.spyOn> | null;

function installInvoke(impl: (cmd: string, args?: InvokeArgs) => unknown) {
  invokeSpy = vi.fn(impl);
  (globalThis as any).__TAURI__ = { core: { invoke: invokeSpy } };
}

function defaultInvoke(cmd: string, args?: InvokeArgs): unknown {
  switch (cmd) {
    case "databases_list":
      return indexFile;
    case "databases_save_index":
      indexFile = { value: (args?.list as unknown[]) ?? [], source: "current" };
      return undefined;
    case "load_database_data": {
      const id = args?.databaseId as string;
      return fileStore.get(id) ?? null;
    }
    case "save_database_data": {
      const id = args?.databaseId as string;
      fileStore.set(id, { value: args?.data, source: "current" });
      return undefined;
    }
    case "delete_database_data": {
      const id = args?.databaseId as string;
      fileStore.delete(id);
      return undefined;
    }
    default:
      throw new Error(`unexpected command ${cmd}`);
  }
}

beforeEach(async () => {
  fileStore = new Map();
  indexFile = null;
  await IndexedDbService.init();
  const db = await openDB(DB_NAME, 1);
  await db.clear(STORE_NAME);
  DatabaseManager.resetInstance();
  installInvoke(defaultInvoke);
  // `logRecovery` calls SettingsManager.getInstance().logAction —
  // capture it so we can assert recovery surfacing without
  // depending on the persistence path.
  logActionSpy = vi
    .spyOn(SettingsManager.prototype, "logAction")
    .mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  delete (globalThis as any).__TAURI__;
  logActionSpy?.mockRestore();
  logActionSpy = null;
});

describe("DatabaseManager (IPC path)", () => {
  it("getAllDatabases reads through databases_list", async () => {
    const iso = "2026-01-01T00:00:00.000Z";
    const row = {
      id: "abc",
      name: "Personal",
      isEncrypted: false,
      createdAt: iso,
      updatedAt: iso,
      lastAccessed: iso,
    };
    indexFile = { value: [row], source: "current" };
    const manager = new DatabaseManager();
    const result = await manager.getAllDatabases();
    expect(result).toEqual([row]);
    expect(invokeSpy).toHaveBeenCalledWith("databases_list");
  });

  it("createDatabase writes via databases_save_index", async () => {
    const manager = new DatabaseManager();
    const created = await manager.createDatabase("Made by IPC");

    // The list must have been persisted through the index command.
    const saveCalls = invokeSpy.mock.calls.filter(
      (c) => c[0] === "databases_save_index",
    );
    expect(saveCalls.length).toBeGreaterThan(0);
    const last = saveCalls[saveCalls.length - 1][1] as { list: unknown[] };
    expect(last.list).toHaveLength(1);
    expect((last.list[0] as any).id).toBe(created.id);
    // And IDB must NOT have been touched in IPC mode.
    expect(await IndexedDbService.getItem("mremote-databases")).toBeNull();
  });

  it("saveDatabaseData round-trips through save_database_data → load_database_data", async () => {
    const manager = new DatabaseManager();
    const col = await manager.createDatabase("RoundTrip");
    const data = {
      connections: [{ id: "c", name: "n" } as any],
      settings: {},
      timestamp: 7,
    } as const;
    await manager.saveDatabaseData(col.id, data as any);
    const loaded = await manager.loadDatabaseData(col.id);
    expect(loaded).toEqual(data);
    expect(
      invokeSpy.mock.calls.some(
        (c) =>
          c[0] === "save_database_data" &&
          (c[1] as any).databaseId === col.id,
      ),
    ).toBe(true);
  });

  it("saveDatabaseData encrypts up front when a password is set", async () => {
    const manager = new DatabaseManager();
    const col = await manager.createDatabase("Secret", "desc", true, "pw");
    const data = {
      connections: [{ id: "c", name: "n" } as any],
      settings: {},
      timestamp: 1,
    } as const;
    await manager.saveDatabaseData(col.id, data as any, "pw");

    const stored = fileStore.get(col.id)!.value;
    // The file payload must NOT be the raw object — it's the
    // WebCrypto envelope string the load path then decrypts.
    expect(typeof stored).toBe("string");
    expect(stored).not.toContain("timestamp");

    // And the load path must produce the original cleartext back.
    const loaded = await manager.loadDatabaseData(col.id, "pw");
    expect(loaded).toEqual(data);
  });

  it("loadDatabaseData logs a recovery action when source !== 'current'", async () => {
    const manager = new DatabaseManager();
    const col = await manager.createDatabase("Recovered");
    const data = { connections: [], settings: {}, timestamp: 0 } as const;
    // Plant the file under a non-"current" source — as if the
    // `.bak` ladder fired on the backend.
    fileStore.set(col.id, { value: data, source: "backup" });

    const loaded = await manager.loadDatabaseData(col.id);
    expect(loaded).toEqual(data);
    expect(logActionSpy).toHaveBeenCalled();
    const args = (logActionSpy as any).mock.calls.find(
      (c: any[]) => c[1] === "Database recovered from backup",
    );
    expect(args).toBeTruthy();
    expect(args[3]).toContain(col.id);
  });

  it("deleteDatabase dispatches delete_database_data and rewrites the index", async () => {
    const manager = new DatabaseManager();
    const col = await manager.createDatabase("ToDelete");
    await manager.saveDatabaseData(col.id, {
      connections: [],
      settings: {},
      timestamp: 0,
    } as any);
    expect(fileStore.has(col.id)).toBe(true);

    await manager.deleteDatabase(col.id);

    expect(fileStore.has(col.id)).toBe(false);
    expect(
      invokeSpy.mock.calls.some(
        (c) =>
          c[0] === "delete_database_data" &&
          (c[1] as any).databaseId === col.id,
      ),
    ).toBe(true);
    // And the surviving index must not reference the deleted row.
    expect(indexFile?.value).toEqual([]);
  });

  it("propagates IPC failures from save_database_data instead of silently falling back", async () => {
    const manager = new DatabaseManager();
    const col = await manager.createDatabase("LoudFailure");
    installInvoke((cmd, args) => {
      if (cmd === "save_database_data") {
        throw new Error("disk full");
      }
      return defaultInvoke(cmd, args);
    });

    await expect(
      manager.saveDatabaseData(col.id, {
        connections: [],
        settings: {},
        timestamp: 0,
      } as any),
    ).rejects.toThrow(/disk full/);
    // And the IDB fallback must NOT have absorbed the failure.
    expect(
      await IndexedDbService.getItem(`mremote-database-${col.id}`),
    ).toBeNull();
  });
});
