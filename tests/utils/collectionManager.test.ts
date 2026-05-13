import { describe, it, expect, beforeEach } from "vitest";
import { encryptWithPassword } from "../../src/utils/crypto/webCryptoAes";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import {
  DatabaseNotFoundError,
  CorruptedDataError,
  InvalidPasswordError,
} from "../../src/utils/core/errors";
import { openDB } from "idb";

const DB_NAME = "mremote-keyval";
const STORE_NAME = "keyval";

const sampleData = { connections: [], settings: {}, timestamp: 1 };

describe("DatabaseManager", () => {
  let manager: DatabaseManager;

  beforeEach(async () => {
    await IndexedDbService.init();
    const db = await openDB(DB_NAME, 1);
    await db.clear(STORE_NAME);
    manager = new DatabaseManager();
  });

  it("creates and persists a collection", async () => {
    const col = await manager.createDatabase("Test");
    const stored = await IndexedDbService.getItem<any[]>("mremote-databases");
    expect(stored).toHaveLength(1);
    expect(stored![0].id).toBe(col.id);
    expect(stored![0].name).toBe("Test");
  });

  it("loads collection data", async () => {
    await IndexedDbService.setItem("mremote-collection-abc", sampleData);
    const loaded = await manager.loadDatabaseData("abc");
    expect(loaded).toEqual(sampleData);
  });

  it("generates export filenames", () => {
    const a = manager.generateExportFilename();
    const b = manager.generateExportFilename();
    expect(a).toMatch(/sortofremoteng-exports-.*\.json/);
    expect(b).toMatch(/sortofremoteng-exports-.*\.json/);
    expect(a).not.toBe(b);
  });

  it("updates and persists changes to a collection", async () => {
    const col = await manager.createDatabase("Initial", "desc");
    const updated = { ...col, name: "Updated", description: "changed" };
    await manager.updateDatabase(updated);

    const stored = await IndexedDbService.getItem<any[]>("mremote-databases");
    expect(stored![0].name).toBe("Updated");
    expect(stored![0].description).toBe("changed");
  });

  it("updates currentDatabase when editing selected collection", async () => {
    const col = await manager.createDatabase("A");
    await manager.selectDatabase(col.id);
    const updated = { ...col, name: "B" };
    await manager.updateDatabase(updated);
    expect(manager.getCurrentDatabase()?.name).toBe("B");
  });

  it("duplicates an unencrypted collection after its source", async () => {
    const source = await manager.createDatabase("Source");
    await manager.createDatabase("Sibling");

    const sourceData = {
      connections: [{ id: "conn-1", name: "Alpha" } as any],
      settings: { sidebarCollapsed: true },
      timestamp: 42,
    };
    await manager.saveDatabaseData(source.id, sourceData as any);

    const duplicate = await manager.duplicateDatabase(source.id);
    const storedCollections = await manager.getAllDatabases();

    expect(duplicate.name).toBe("Source (Copy)");
    expect(storedCollections.map((collection) => collection.name)).toEqual([
      "Source",
      "Source (Copy)",
      "Sibling",
    ]);
    expect(await manager.loadDatabaseData(duplicate.id)).toEqual(sourceData);
  });

  it("duplicates the active encrypted collection using the cached password", async () => {
    const source = await manager.createDatabase(
      "Secure",
      "desc",
      true,
      "secret",
    );
    const sourceData = {
      connections: [{ id: "conn-2", name: "Bravo" } as any],
      settings: { keepOpen: true },
      timestamp: 84,
    };

    await manager.saveDatabaseData(source.id, sourceData as any, "secret");
    await manager.selectDatabase(source.id, "secret");

    const duplicate = await manager.duplicateDatabase(source.id);

    expect(duplicate.name).toBe("Secure (Copy)");
    expect(duplicate.isEncrypted).toBe(true);
    expect(await manager.loadDatabaseData(duplicate.id, "secret")).toEqual(
      sourceData,
    );
  });

  it("duplicates another encrypted collection when the source password is provided", async () => {
    const source = await manager.createDatabase(
      "Vault",
      "desc",
      true,
      "secret",
    );
    await manager.createDatabase("Sibling");

    const sourceData = {
      connections: [{ id: "conn-3", name: "Charlie" } as any],
      settings: { filtersPinned: true },
      timestamp: 128,
    };

    await manager.saveDatabaseData(source.id, sourceData as any, "secret");

    const duplicate = await manager.duplicateDatabase(source.id, {
      password: "secret",
    });

    expect((await manager.getAllDatabases()).map((collection) => collection.name)).toEqual([
      "Vault",
      "Vault (Copy)",
      "Sibling",
    ]);
    expect(await manager.loadDatabaseData(duplicate.id, "secret")).toEqual(
      sourceData,
    );
  });

  it("throws DatabaseNotFoundError when selecting missing collection", async () => {
    await expect(manager.selectDatabase("missing")).rejects.toBeInstanceOf(
      DatabaseNotFoundError,
    );
  });

  it("throws InvalidPasswordError when password is incorrect", async () => {
    const col = await manager.createDatabase(
      "Secure",
      "desc",
      true,
      "secret",
    );
    await expect(
      manager.loadDatabaseData(col.id, "wrong"),
    ).rejects.toBeInstanceOf(InvalidPasswordError);
  });

  it("reports encrypted databases as exportable only after unlock", async () => {
    const open = await manager.createDatabase("Open");
    const secure = await manager.createDatabase("Secure", "desc", true, "secret");

    await expect(
      manager.loadDatabaseData(secure.id),
    ).rejects.toBeInstanceOf(InvalidPasswordError);

    let exportable = await manager.getExportableDatabases();
    expect(exportable.find((database) => database.id === open.id)).toMatchObject({
      isExportable: true,
      isUnlocked: true,
    });
    expect(exportable.find((database) => database.id === secure.id)).toMatchObject({
      isExportable: true,
      isUnlocked: true,
    });

    DatabaseManager.resetInstance();
    const freshManager = DatabaseManager.getInstance();
    exportable = await freshManager.getExportableDatabases();
    expect(exportable.find((database) => database.id === open.id)).toMatchObject({
      isExportable: true,
      isUnlocked: true,
    });
    expect(exportable.find((database) => database.id === secure.id)).toMatchObject({
      isExportable: false,
      isUnlocked: false,
    });

    await freshManager.selectDatabase(secure.id, "secret");
    expect(freshManager.isDatabaseUnlocked(secure.id)).toBe(true);
    expect(freshManager.getUnlockedDatabaseIds()).toContain(secure.id);

    const snapshot = await freshManager.readExportableDatabaseSnapshot(secure.id);
    expect(snapshot.collection.id).toBe(secure.id);
  });

  it("does not reuse the current password for a different encrypted database", async () => {
    const first = await manager.createDatabase("First", "desc", true, "first-secret");
    const second = await manager.createDatabase("Second", "desc", true, "second-secret");

    DatabaseManager.resetInstance();
    const freshManager = DatabaseManager.getInstance();
    await freshManager.selectDatabase(first.id, "first-secret");

    await expect(
      freshManager.readExportableDatabaseSnapshot(second.id),
    ).rejects.toBeInstanceOf(InvalidPasswordError);

    await expect(
      freshManager.readExportableDatabaseSnapshot(second.id, false, {
        collectionPassword: "second-secret",
      }),
    ).resolves.toMatchObject({ collection: { id: second.id } });
  });

  it("throws CorruptedDataError when decrypted data is invalid", async () => {
    const password = "secret";
    // Encrypt invalid JSON via the same WebCrypto helper the manager uses.
    const encrypted = await encryptWithPassword("{bad-json", password);
    await IndexedDbService.setItem("mremote-collection-corrupt", encrypted);
    await expect(
      manager.loadDatabaseData("corrupt", password),
    ).rejects.toBeInstanceOf(CorruptedDataError);
  });
});
