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
