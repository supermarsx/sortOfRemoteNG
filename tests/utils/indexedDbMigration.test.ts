/**
 * Tests for the one-shot IndexedDB → file migrator (P2).
 *
 * The migrator reads from real `fake-indexeddb` (vitest setup
 * already installs it as the global IDB) and writes via the
 * P1 Tauri commands. Those commands are mocked here through
 * `@tauri-apps/api/core` — the in-memory shim simulates the safe
 * writer + reader so the read-back verification is exercised.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDB } from "idb";
import { migrateIndexedDbToFiles } from "../../src/utils/connection/indexedDbMigration";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";

const DB_NAME = "mremote-keyval";
const STORE_NAME = "keyval";

// In-memory simulation of the Rust-side files: each `databaseId`
// maps to whatever the frontend last wrote. `databases_list` is a
// single index entry.
let fileStore: Map<string, unknown>;
let indexFile: unknown[] | null;
// Vitest's `vi.fn` types poorly under no-arg construction; cast at
// the assignment sites instead of tangling generics here.
let invokeImpl: any = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeImpl(cmd, args),
  isTauri: () => true,
}));

beforeEach(async () => {
  fileStore = new Map();
  indexFile = null;
  await IndexedDbService.init();
  const db = await openDB(DB_NAME, 1);
  await db.clear(STORE_NAME);
  invokeImpl = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "databases_list":
        if (indexFile === null) return null;
        return { value: indexFile, source: "current" };
      case "databases_save_index":
        indexFile = (args?.list as unknown[]) ?? [];
        return undefined;
      case "load_database_data": {
        const id = args?.databaseId as string;
        if (!fileStore.has(id)) return null;
        return { value: fileStore.get(id), source: "current" };
      }
      case "save_database_data": {
        const id = args?.databaseId as string;
        fileStore.set(id, args?.data);
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
  });
});

describe("migrateIndexedDbToFiles", () => {
  it("returns a clean report on an empty IndexedDB", async () => {
    const report = await migrateIndexedDbToFiles();
    expect(report.migrated).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.alreadyMigrated).toBe(false);
    expect(report.failures).toHaveLength(0);
  });

  it("skips entirely when the file-backed index already has entries", async () => {
    // Pre-plant a file-backed index, simulating "migration already
    // ran" or "fresh install on the file-based store".
    indexFile = [{ id: "x" }];
    // Plant IndexedDB rows that should NOT be touched.
    await IndexedDbService.setItem("mremote-databases", [{ id: "would-be-migrated" }]);
    await IndexedDbService.setItem("mremote-database-would-be-migrated", { foo: "bar" });

    const report = await migrateIndexedDbToFiles();
    expect(report.alreadyMigrated).toBe(true);
    expect(report.migrated).toBe(0);
    expect(report.failed).toBe(0);
    // Migrator did not call save_* commands.
    expect(invokeImpl).toHaveBeenCalledWith("databases_list", undefined);
    expect(invokeImpl).not.toHaveBeenCalledWith("save_database_data", expect.anything());
    expect(invokeImpl).not.toHaveBeenCalledWith("databases_save_index", expect.anything());
  });

  it("migrates a single database with its payload", async () => {
    const meta = { id: "db-1", name: "Personal", isEncrypted: false };
    const payload = {
      connections: [{ id: "c1", name: "Workstation" }],
      settings: {},
      timestamp: 42,
    };
    await IndexedDbService.setItem("mremote-databases", [meta]);
    await IndexedDbService.setItem("mremote-database-db-1", payload);

    const report = await migrateIndexedDbToFiles();
    expect(report.migrated).toBe(1);
    expect(report.failed).toBe(0);
    expect(fileStore.get("db-1")).toEqual(payload);
    expect(indexFile).toEqual([meta]);
  });

  it("migrates from the legacy 'mremote-collection-<id>' alias", async () => {
    // Some installs still have the older per-DB key. The migrator
    // should fall through to it when the current key is absent.
    const meta = { id: "db-legacy", name: "Old", isEncrypted: false };
    const payload = { connections: [], settings: {}, timestamp: 1 };
    await IndexedDbService.setItem("mremote-databases", [meta]);
    await IndexedDbService.setItem("mremote-collection-db-legacy", payload);

    const report = await migrateIndexedDbToFiles();
    expect(report.migrated).toBe(1);
    expect(fileStore.get("db-legacy")).toEqual(payload);
  });

  it("falls back to the legacy 'mremote-collections' list key", async () => {
    // Some installs only have the older list key.
    const meta = { id: "db-x", name: "X", isEncrypted: false };
    const payload = { connections: [], settings: {}, timestamp: 1 };
    await IndexedDbService.setItem("mremote-collections", [meta]);
    await IndexedDbService.setItem("mremote-database-db-x", payload);

    const report = await migrateIndexedDbToFiles();
    expect(report.migrated).toBe(1);
    expect(indexFile).toEqual([meta]);
  });

  it("counts a row as already-on-disk when the file already exists", async () => {
    // Resume scenario: migration ran for one db before the process
    // died; the second boot should pick up where the first left off.
    const meta = { id: "db-resume", name: "R" };
    await IndexedDbService.setItem("mremote-databases", [meta]);
    await IndexedDbService.setItem("mremote-database-db-resume", { x: 1 });
    fileStore.set("db-resume", { x: 1 });

    const report = await migrateIndexedDbToFiles();
    expect(report.migrated).toBe(0);
    expect(report.alreadyOnDisk).toBe(1);
    expect(report.failed).toBe(0);
  });

  it("flags read-back mismatch as a failure", async () => {
    // Hook the save command to drop a field — the read-back will
    // disagree with the original payload and the migrator must
    // refuse to count the row as migrated.
    const meta = { id: "db-corrupt", name: "C" };
    const payload = { a: 1, b: 2, c: 3 };
    await IndexedDbService.setItem("mremote-databases", [meta]);
    await IndexedDbService.setItem("mremote-database-db-corrupt", payload);

    invokeImpl.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "databases_list")
        return indexFile === null ? null : { value: indexFile, source: "current" };
      if (cmd === "databases_save_index") {
        indexFile = args.list;
        return undefined;
      }
      if (cmd === "load_database_data") {
        const id = args.databaseId;
        if (!fileStore.has(id)) return null;
        return { value: fileStore.get(id), source: "current" };
      }
      if (cmd === "save_database_data") {
        const data = JSON.parse(JSON.stringify(args.data));
        delete data.c; // <-- simulated write corruption
        fileStore.set(args.databaseId, data);
        return undefined;
      }
      throw new Error(cmd);
    });

    const report = await migrateIndexedDbToFiles();
    expect(report.migrated).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.failures[0].id).toBe("db-corrupt");
    expect(report.failures[0].reason).toMatch(/read-back/i);
  });

  it("continues past a per-database failure to migrate later entries", async () => {
    // Two databases. The first fails (no payload row); the second
    // succeeds. Report counts both.
    await IndexedDbService.setItem("mremote-databases", [
      { id: "missing-payload" },
      { id: "ok" },
    ]);
    await IndexedDbService.setItem("mremote-database-ok", { v: 1 });

    const report = await migrateIndexedDbToFiles();
    expect(report.migrated).toBe(1);
    // The "missing-payload" row is intentionally NOT counted as a
    // failure — the migrator treats "no per-db row" as "metadata
    // entry without a saved payload" (legitimate empty database).
    // Only IPC + read-back errors land in `failed`.
    expect(report.failed).toBe(0);
    expect(fileStore.has("missing-payload")).toBe(false);
    expect(fileStore.get("ok")).toEqual({ v: 1 });
  });

  it("leaves IndexedDB rows in place on success (rollback safety)", async () => {
    const meta = { id: "rb-1", name: "Rollback" };
    const payload = { x: "y" };
    await IndexedDbService.setItem("mremote-databases", [meta]);
    await IndexedDbService.setItem("mremote-database-rb-1", payload);

    await migrateIndexedDbToFiles();

    // The migrator must NOT delete the IDB rows. P5 retires the
    // surface; this is the one-release rollback window.
    expect(await IndexedDbService.getItem("mremote-databases")).toEqual([meta]);
    expect(await IndexedDbService.getItem("mremote-database-rb-1")).toEqual(payload);
  });

  it("returns a no-op report when the Tauri runtime is unavailable", async () => {
    // Simulate a browser build: getInvoke returns null. The migrator
    // can't reach the file commands, so it bails cleanly without
    // touching IDB.
    (globalThis as any).__TAURI__ = undefined;
    invokeImpl = vi.fn(); // unused
    // We need to also defeat the @tauri-apps/api/core mock returning
    // a function — override the module's `isTauri` for this test by
    // forcing the path that detects no runtime. The cleanest hook
    // is to make `invoke` itself throw — `getInvoke` will catch it
    // and we'll behave as if no runtime is present. Use the
    // existing mock to throw a sentinel.
    invokeImpl = vi.fn(async () => {
      throw new Error("no runtime");
    });
    await IndexedDbService.setItem("mremote-databases", [{ id: "x" }]);

    const report = await migrateIndexedDbToFiles();
    // The probe (`databases_list`) throws — that's counted as a
    // single failure with no further work attempted. The IDB row
    // stays untouched.
    expect(report.failed).toBe(1);
    expect(report.migrated).toBe(0);
  });
});
