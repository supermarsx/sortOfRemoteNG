import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import type { ConnectionDatabase } from "../../src/types/connection/connection";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => bridge.invoke,
}));
const databases: ConnectionDatabase[] = ["a", "b", "unopened"].map((id) => ({
  id,
  name: id,
  isEncrypted: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  lastAccessed: "2026-01-01",
}));
const data = { connections: [], settings: {}, timestamp: 1 };
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  DatabaseManager.resetInstance();
  vi.spyOn(SettingsManager.prototype, "logAction").mockImplementation(
    async () => undefined,
  );
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === "databases_list")
      return { value: databases, source: "current" };
    if (command === "load_database_data")
      return { value: structuredClone(data), source: "current" };
    return undefined;
  });
});

describe("memory-only import/export access", () => {
  it("keeps a switched-away open source, excludes the explicitly closed and never-opened databases", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.selectDatabase("a");
    await manager.selectDatabase("b");
    await manager.closeCurrentDatabase();
    expect(manager.getCurrentDatabase()).toBeNull();
    expect(
      (await manager.getMemoryResidentDatabases()).map(({ id }) => id),
    ).toEqual(["a"]);
    await expect(
      manager.readMemoryResidentDatabaseSnapshot("a", false, {
        includeTrust: false,
      }),
    ).resolves.toMatchObject({ collection: { id: "a" } });
    await expect(
      manager.readMemoryResidentDatabaseSnapshot("b"),
    ).rejects.toThrow("memory");
    const load = vi.spyOn(manager, "loadDatabaseData");
    await expect(
      manager.appendConnectionsToMemoryResidentDatabase("unopened", []),
    ).rejects.toThrow("memory");
    expect(load).not.toHaveBeenCalled();
    manager.invalidatePendingDatabaseOperations();
    expect(await manager.getMemoryResidentDatabases()).toEqual([]);
  });

  it("does not treat a generic read as a previously opened database", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.loadDatabaseData("a");
    expect(await manager.getMemoryResidentDatabases()).toEqual([]);
  });

  it("rejects a stale import before saving when its target is locked during the metadata read", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.selectDatabase("a");
    await manager.selectDatabase("b");
    await manager.closeCurrentDatabase();
    const getDatabase = manager.getDatabase.bind(manager);
    vi.spyOn(manager, "getDatabase").mockImplementationOnce(async (id) => {
      await manager.lockDatabase(id);
      return getDatabase(id);
    });
    const save = vi.spyOn(manager, "saveDatabaseData");
    await expect(
      manager.appendConnectionsToMemoryResidentDatabase("a", []),
    ).rejects.toThrow("expired");
    expect(save).not.toHaveBeenCalled();
  });
});
