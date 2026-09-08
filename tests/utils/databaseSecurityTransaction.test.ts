import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import type { ConnectionDatabase } from "../../src/types/connection/connection";

const bridge = vi.hoisted(() => ({
  invoke: null as null | ReturnType<typeof vi.fn>,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => bridge.invoke,
}));
const row: ConnectionDatabase = {
  id: "security-fixture",
  name: "Fixture",
  isEncrypted: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  lastAccessed: "2026-01-01",
};
const data = { connections: [], settings: { theme: "dark" }, timestamp: 1 };
const indexKey = "mremote-databases";
const dataKey = `mremote-database-${row.id}`;

beforeEach(async () => {
  vi.restoreAllMocks();
  bridge.invoke = null;
  DatabaseManager.resetInstance();
  vi.spyOn(SettingsManager.prototype, "logAction").mockImplementation(
    async () => undefined,
  );
  const db = await openDB("mremote-keyval", 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("keyval"))
        database.createObjectStore("keyval");
    },
  });
  await db.clear("keyval");
  await IndexedDbService.setItemStrict(indexKey, [row]);
  await IndexedDbService.setItemStrict(dataKey, data);
});

describe("database security commit contract", () => {
  it("refreshes the current password and revision together after explicit remote-change unlock", async () => {
    const first = new DatabaseManager();
    const second = new DatabaseManager();
    await first.changeDatabasePassword(row.id, undefined, "old-password");
    await first.selectDatabase(row.id, "old-password");
    const stale = first.captureCurrentDatabaseDataTarget()!;
    await second.changeDatabasePassword(row.id, "old-password", "new-password");
    await first.unlockDatabase(row.id, "new-password");
    await first.saveCurrentDatabaseData({ ...data, timestamp: 41 });
    await first
      .captureCurrentDatabaseDataTarget()!
      .save({ ...data, timestamp: 42 });
    await expect(stale.save(data)).rejects.toThrow("security changed");
    expect(first.isDatabaseUnlocked(row.id)).toBe(true);
    expect(
      (await second.loadDatabaseData(row.id, "new-password"))?.timestamp,
    ).toBe(42);
    await expect(
      second.loadDatabaseData(row.id, "old-password"),
    ).rejects.toThrow();
  });

  it("clears obsolete current credentials when a removed password is reloaded as plaintext", async () => {
    const first = new DatabaseManager();
    const second = new DatabaseManager();
    await first.changeDatabasePassword(row.id, undefined, "old-password");
    await first.selectDatabase(row.id, "old-password");
    await second.removePasswordFromDatabase(row.id, "old-password");
    // First stale read retires the bound credential; retry verifies plaintext.
    await expect(first.loadDatabaseData(row.id)).rejects.toThrow(
      "security changed",
    );
    expect(await first.loadDatabaseData(row.id)).toEqual(data);
    expect(first.getCurrentDatabase()?.isEncrypted).toBe(false);
    await first.saveCurrentDatabaseData({ ...data, timestamp: 43 });
    expect(await IndexedDbService.getItemStrict(dataKey)).toMatchObject({
      timestamp: 43,
    });
    const other = await first.createDatabase("Other fixture");
    await first.selectDatabase(other.id);
    expect(first.getUnlockedDatabaseIds()).not.toContain(row.id);
  });

  it("does not rewind a committed index when a legacy-index migration was queued first", async () => {
    await IndexedDbService.removeItemStrict(indexKey);
    await IndexedDbService.setItemStrict("mremote-collections", [row]);
    const first = new DatabaseManager();
    const second = new DatabaseManager();
    const transact =
      IndexedDbService.transactItemsStrict.bind(IndexedDbService);
    let resume!: () => void;
    let captured!: () => void;
    const entered = new Promise<void>((resolve) => {
      captured = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let held = false;
    vi.spyOn(IndexedDbService, "transactItemsStrict").mockImplementation(
      async (keys, transform) => {
        if (!held && keys.includes("mremote-collections")) {
          held = true;
          captured();
          await gate;
        }
        return transact(keys, transform);
      },
    );
    const staleList = first.getAllDatabases();
    await entered;
    await second.changeDatabasePassword(row.id, undefined, "new-password");
    const committed = await IndexedDbService.getItemStrict(indexKey);
    resume();
    expect(await staleList).toMatchObject([{ isEncrypted: true }]);
    expect(await IndexedDbService.getItemStrict(indexKey)).toEqual(committed);
    expect(
      await IndexedDbService.getItemStrict("mremote-collections"),
    ).toBeNull();
    expect(await second.loadDatabaseData(row.id, "new-password")).toEqual(data);
  });

  it("rejects a queued legacy payload migration after another manager changes its password", async () => {
    const first = new DatabaseManager();
    const second = new DatabaseManager();
    await second.changeDatabasePassword(row.id, undefined, "old-password");
    const original = await IndexedDbService.getItemStrict(dataKey);
    const legacyKey = `mremote-collection-${row.id}`;
    await IndexedDbService.setItemStrict(legacyKey, original);
    await IndexedDbService.removeItemStrict(dataKey);
    const transact =
      IndexedDbService.transactItemsStrict.bind(IndexedDbService);
    let resume!: () => void;
    let captured!: () => void;
    const entered = new Promise<void>((resolve) => {
      captured = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let held = false;
    vi.spyOn(IndexedDbService, "transactItemsStrict").mockImplementation(
      async (keys, transform) => {
        if (!held && keys.includes(legacyKey)) {
          held = true;
          captured();
          await gate;
        }
        return transact(keys, transform);
      },
    );
    const staleLoad = first.loadDatabaseData(row.id, "old-password");
    const rejected = expect(staleLoad).rejects.toThrow("security changed");
    await entered;
    await second.changeDatabasePassword(row.id, "old-password", "new-password");
    const committed = await IndexedDbService.getItemStrict(dataKey);
    // A separate unconsumed legacy generation must also survive the conflict.
    await IndexedDbService.setItemStrict(legacyKey, original);
    resume();
    await rejected;
    expect(await IndexedDbService.getItemStrict(dataKey)).toEqual(committed);
    expect(await IndexedDbService.getItemStrict(legacyKey)).toEqual(original);
    expect(first.getUnlockedDatabaseIds()).toEqual([]);
    expect(await second.loadDatabaseData(row.id, "new-password")).toEqual(data);
  });

  it.each(["change", "remove"] as const)(
    "rejects another manager's old captured and current credentials after password %s",
    async (operation) => {
      const first = new DatabaseManager();
      const second = new DatabaseManager();
      await first.changeDatabasePassword(row.id, undefined, "old-password");
      await first.selectDatabase(row.id, "old-password");
      const stale = first.captureCurrentDatabaseDataTarget()!;
      if (operation === "change")
        await second.changeDatabasePassword(
          row.id,
          "old-password",
          "new-password",
        );
      else await second.removePasswordFromDatabase(row.id, "old-password");
      // A metadata refresh must not bless the credential's old security revision.
      if (operation === "change")
        await first.updateDatabase({
          ...first.getCurrentDatabase()!,
          name: "Renamed",
        });
      await expect(stale.save({ ...data, timestamp: 99 })).rejects.toThrow(
        /security changed|access expired/,
      );
      await expect(
        first.saveCurrentDatabaseData({ ...data, timestamp: 98 }),
      ).rejects.toThrow(/security changed|access expired/);
      expect(first.getUnlockedDatabaseIds()).toEqual([]);
      expect(
        await second.loadDatabaseData(
          row.id,
          operation === "change" ? "new-password" : undefined,
        ),
      ).toEqual(data);
    },
  );

  it("enables, changes and removes passwords atomically while refreshing only new targets", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.selectDatabase(row.id);
    const beforeEnable = manager.captureCurrentDatabaseDataTarget()!;
    const events: string[] = [];
    const dispose = manager.onCurrentDatabaseChange((event) =>
      events.push(event.reason),
    );
    expect(
      await manager.changeDatabasePassword(
        row.id,
        undefined,
        "first-fixture-password",
      ),
    ).toMatchObject({ committed: true, cleanupPending: false });
    expect(() => beforeEnable.save(data)).toThrow("access expired");
    const encryptedTarget = manager.captureCurrentDatabaseDataTarget()!;
    await encryptedTarget.save({ ...data, timestamp: 2 });
    expect((await encryptedTarget.load())?.timestamp).toBe(2);
    await manager.changeDatabasePassword(
      row.id,
      "first-fixture-password",
      "second-fixture-password",
    );
    expect(() => encryptedTarget.load()).toThrow("access expired");
    await expect(
      manager.loadDatabaseData(row.id, "first-fixture-password"),
    ).rejects.toThrow();
    const secondTarget = manager.captureCurrentDatabaseDataTarget()!;
    await manager.removePasswordFromDatabase(row.id, "second-fixture-password");
    expect(() => secondTarget.save(data)).toThrow("access expired");
    await manager
      .captureCurrentDatabaseDataTarget()!
      .save({ ...data, timestamp: 3 });
    expect(await IndexedDbService.getItemStrict(dataKey)).toMatchObject({
      timestamp: 3,
    });
    expect(manager.getCurrentDatabase()?.isEncrypted).toBe(false);
    expect(
      events.filter((reason) => reason === "security-change"),
    ).toHaveLength(3);
    dispose();
  });

  it("aborts both IndexedDB writes if the second write cannot serialize", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(
      IndexedDbService.transactItemsStrict([indexKey, dataKey], () => ({
        set: { [indexKey]: [{ ...row, isEncrypted: true }], [dataKey]: cyclic },
        result: undefined,
      })),
    ).rejects.toThrow();
    expect(await IndexedDbService.getItemStrict(indexKey)).toEqual([row]);
    expect(await IndexedDbService.getItemStrict(dataKey)).toEqual(data);
  });

  it("rejects an empty creation password and ordinary metadata encryption toggle before writes", async () => {
    const manager = DatabaseManager.getInstance();
    const write = vi.spyOn(IndexedDbService, "setItemStrict");
    await expect(manager.createDatabase("New", "", true, "")).rejects.toThrow();
    await expect(
      manager.updateDatabase({ ...row, isEncrypted: true }),
    ).rejects.toThrow("dedicated security transaction");
    expect(write).not.toHaveBeenCalled();
    expect(await IndexedDbService.getItemStrict(indexKey)).toEqual([row]);
  });

  it("does not turn index read errors into an empty writable database list", async () => {
    bridge.invoke = vi.fn(async () => {
      throw new Error("fixture index unreadable");
    });
    await expect(
      DatabaseManager.getInstance().getAllDatabases(),
    ).rejects.toThrow("index unreadable");
  });

  it("does not cache a native transaction before commit and honors committed cleanup warnings", async () => {
    let current = { ...row };
    let payload: unknown = data;
    let finish!: () => void;
    bridge.invoke = vi.fn(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "databases_list")
          return { value: [current], source: "current" };
        if (command === "load_database_data")
          return { value: payload, source: "current" };
        if (command === "databases_save_index") return undefined;
        if (command === "change_database_security") {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          current = {
            ...current,
            isEncrypted: true,
            securityRevision: String(args?.securityRevision),
          };
          payload = args?.data;
          return {
            committed: true,
            cleanupPending: true,
            warnings: ["fixture cleanup denied"],
          };
        }
        return undefined;
      },
    );
    const manager = DatabaseManager.getInstance();
    await manager.selectDatabase(row.id);
    const changing = manager.changeDatabasePassword(
      row.id,
      undefined,
      "new-fixture-password",
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(manager.getCurrentDatabase()?.isEncrypted).toBe(false);
    finish();
    expect(await changing).toMatchObject({
      committed: true,
      cleanupPending: true,
    });
    expect(manager.getCurrentDatabase()?.isEncrypted).toBe(true);
    expect(manager.isDatabaseUnlocked(row.id)).toBe(true);
    expect(await manager.captureCurrentDatabaseDataTarget()!.load()).toEqual(
      data,
    );
  });

  it("never reattaches new credentials when global lock wins during native commit", async () => {
    let finish!: () => void;
    bridge.invoke = vi.fn(async (command: string) => {
      if (command === "databases_list")
        return { value: [row], source: "current" };
      if (command === "load_database_data")
        return { value: data, source: "current" };
      if (command === "change_database_security") {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { committed: true, cleanupPending: false, warnings: [] };
      }
      return undefined;
    });
    const manager = DatabaseManager.getInstance();
    await manager.selectDatabase(row.id);
    const changing = manager.changeDatabasePassword(
      row.id,
      undefined,
      "new-fixture-password",
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    manager.invalidatePendingDatabaseOperations();
    manager.closeCurrentDatabase();
    finish();
    const outcome = await changing;
    expect(outcome.committed).toBe(true);
    expect(outcome.warnings.join(" ")).toContain("locked");
    expect(manager.getUnlockedDatabaseIds()).toEqual([]);
  });
});
