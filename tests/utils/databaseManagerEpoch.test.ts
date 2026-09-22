import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { encryptWithPassword } from "../../src/utils/crypto/webCryptoAes";
import type { ConnectionDatabase } from "../../src/types/connection/connection";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => bridge.invoke,
}));
const collection: ConnectionDatabase = {
  id: "epoch-fixture",
  name: "Fixture",
  isEncrypted: true,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  lastAccessed: "2026-01-01",
};
const data = { connections: [], settings: {}, timestamp: 1 };
let encrypted: string;
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  DatabaseManager.resetInstance();
  vi.spyOn(SettingsManager.prototype, "logAction").mockImplementation(
    async () => undefined,
  );
  encrypted = await encryptWithPassword(
    JSON.stringify(data),
    "fixture-password",
    { iterations: 10000 },
  );
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === "databases_list")
      return { value: [collection], source: "current" };
    if (command === "load_database_data")
      return { value: encrypted, source: "current" };
    return undefined;
  });
});

describe("database credential epochs", () => {
  it("does not let an old empty-index result clear a newly reopened selection", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.selectDatabase(collection.id, "fixture-password");
    let finish!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    bridge.invoke.mockImplementationOnce(async () => {
      started();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { value: [], source: "current" };
    });
    const staleReload = manager.getAllDatabases();
    await pending;
    manager.closeCurrentDatabase();
    await manager.selectDatabase(collection.id, "fixture-password");
    finish();
    await staleReload;
    expect(manager.getCurrentDatabase()?.id).toBe(collection.id);
  });

  it("retains the active selection when the index cannot be read", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.selectDatabase(collection.id, "fixture-password");
    bridge.invoke.mockRejectedValueOnce(new Error("temporary read failure"));
    await expect(manager.getAllDatabases()).rejects.toThrow(
      "temporary read failure",
    );
    expect(manager.getCurrentDatabase()?.id).toBe(collection.id);
  });

  it("cancels pending and queued opens when Close is pressed with no active database", async () => {
    const manager = DatabaseManager.getInstance();
    let finish!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const update = manager.updateDatabase.bind(manager);
    vi.spyOn(manager, "updateDatabase").mockImplementationOnce(
      async (database) => {
        started();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return update(database);
      },
    );
    const opening = manager.selectDatabase(collection.id, "fixture-password");
    const queued = manager.selectDatabase(collection.id, "fixture-password");
    const results = Promise.allSettled([opening, queued]);
    await pending;
    expect(manager.getCurrentDatabase()).toBeNull();
    manager.closeCurrentDatabase();
    finish();
    expect((await results).map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(manager.getCurrentDatabase()).toBeNull();
    await manager.selectDatabase(collection.id, "fixture-password");
    expect(manager.getCurrentDatabase()?.id).toBe(collection.id);
  });

  it("does not publish a selection if its metadata update fails", async () => {
    const manager = DatabaseManager.getInstance();
    vi.spyOn(manager, "updateDatabase").mockRejectedValueOnce(
      new Error("index conflict"),
    );
    await expect(
      manager.selectDatabase(collection.id, "fixture-password"),
    ).rejects.toThrow("index conflict");
    expect(manager.getCurrentDatabase()).toBeNull();
  });

  it.each([null, { value: [], source: "current" }])(
    "clears a removed active database after a native index reload (%j)",
    async (index) => {
      const manager = DatabaseManager.getInstance();
      await manager.selectDatabase(collection.id, "fixture-password");
      const target = manager.captureCurrentDatabaseDataTarget()!;
      const listener = vi.fn();
      const stop = manager.onCurrentDatabaseChange(listener);
      bridge.invoke.mockImplementation(async (command: string) =>
        command === "databases_list" ? index : undefined,
      );
      expect(await manager.getAllDatabases()).toEqual([]);
      expect(manager.getCurrentDatabase()).toBeNull();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "delete", database: null }),
      );
      expect(() => target.assertAccessible?.()).toThrow();
      stop();
    },
  );

  it("reads current data for authorization without advancing a writer's CAS baseline", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.selectDatabase(collection.id, "fixture-password");
    const captured = manager.captureCurrentDatabaseDataTarget()!;
    expect(await captured.readCurrent!()).toMatchObject(data);
    encrypted = await encryptWithPassword(
      JSON.stringify({ ...data, timestamp: 2 }),
      "fixture-password",
      { iterations: 10000 },
    );
    expect(await captured.readCurrent!()).toMatchObject({ timestamp: 2 });
    await expect(captured.verifyCurrent!()).rejects.toThrow("changed");
    manager.invalidatePendingDatabaseOperations();
    await expect(captured.readCurrent!()).rejects.toThrow("access expired");
    expect(
      bridge.invoke.mock.calls.some(
        ([command]) => command === "save_database_data",
      ),
    ).toBe(false);
  });
  it("does not repopulate an unlock cache after global invalidation during a pending read", async () => {
    const manager = DatabaseManager.getInstance();
    let complete!: () => void;
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "databases_list")
        return { value: [collection], source: "current" };
      if (command === "load_database_data") {
        await new Promise<void>((resolve) => {
          complete = resolve;
        });
        return { value: encrypted, source: "current" };
      }
      return undefined;
    });
    const unlocking = manager.unlockDatabase(collection.id, "fixture-password");
    const rejected = expect(unlocking).rejects.toThrow("access expired");
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    manager.invalidatePendingDatabaseOperations();
    complete();
    await rejected;
    expect(manager.getUnlockedDatabaseIds()).toEqual([]);
    expect(manager.getCurrentDatabase()).toBeNull();
  });

  it("invalidates a captured old-password target on close and on global lock", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.selectDatabase(collection.id, "fixture-password");
    const captured = manager.captureCurrentDatabaseDataTarget();
    expect(captured).not.toBeNull();
    manager.invalidatePendingDatabaseOperations();
    expect(() => captured!.load()).toThrow("access expired");
    expect(() => captured!.save(data)).toThrow("access expired");
    expect(
      bridge.invoke.mock.calls.filter(
        ([command]) => command === "save_database_data",
      ),
    ).toHaveLength(0);
  });

  it("fails closed instead of overwriting an encrypted database without its password", async () => {
    const manager = DatabaseManager.getInstance();
    await expect(manager.saveDatabaseData(collection.id, data)).rejects.toThrow(
      "plaintext overwrite was blocked",
    );
    expect(
      bridge.invoke.mock.calls.filter(
        ([command]) => command === "save_database_data",
      ),
    ).toHaveLength(0);
  });

  it("rejects ciphertext mislabeled as plaintext by its metadata", async () => {
    bridge.invoke.mockImplementation(async (command: string) =>
      command === "databases_list"
        ? { value: [{ ...collection, isEncrypted: false }], source: "current" }
        : { value: encrypted, source: "current" },
    );
    await expect(
      DatabaseManager.getInstance().loadDatabaseData(collection.id),
    ).rejects.toThrow("metadata and payload disagree");
  });
});
