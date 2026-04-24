import { describe, it, expect, beforeEach } from "vitest";
import { encryptWithPassword } from "../../src/utils/crypto/webCryptoAes";
import { CollectionManager } from "../../src/utils/connection/collectionManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import {
  CollectionNotFoundError,
  CorruptedDataError,
  InvalidPasswordError,
} from "../../src/utils/core/errors";
import { openDB } from "idb";

const DB_NAME = "mremote-keyval";
const STORE_NAME = "keyval";

const sampleData = { connections: [], settings: {}, timestamp: 1 };

describe("CollectionManager", () => {
  let manager: CollectionManager;

  beforeEach(async () => {
    await IndexedDbService.init();
    const db = await openDB(DB_NAME, 1);
    await db.clear(STORE_NAME);
    manager = new CollectionManager();
  });

  it("creates and persists a collection", async () => {
    const col = await manager.createCollection("Test");
    const stored = await IndexedDbService.getItem<any[]>("mremote-collections");
    expect(stored).toHaveLength(1);
    expect(stored![0].id).toBe(col.id);
    expect(stored![0].name).toBe("Test");
  });

  it("loads collection data", async () => {
    await IndexedDbService.setItem("mremote-collection-abc", sampleData);
    const loaded = await manager.loadCollectionData("abc");
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
    const col = await manager.createCollection("Initial", "desc");
    const updated = { ...col, name: "Updated", description: "changed" };
    await manager.updateCollection(updated);

    const stored = await IndexedDbService.getItem<any[]>("mremote-collections");
    expect(stored![0].name).toBe("Updated");
    expect(stored![0].description).toBe("changed");
  });

  it("updates currentCollection when editing selected collection", async () => {
    const col = await manager.createCollection("A");
    await manager.selectCollection(col.id);
    const updated = { ...col, name: "B" };
    await manager.updateCollection(updated);
    expect(manager.getCurrentCollection()?.name).toBe("B");
  });

  it("duplicates an unencrypted collection after its source", async () => {
    const source = await manager.createCollection("Source");
    await manager.createCollection("Sibling");

    const sourceData = {
      connections: [{ id: "conn-1", name: "Alpha" } as any],
      settings: { sidebarCollapsed: true },
      timestamp: 42,
    };
    await manager.saveCollectionData(source.id, sourceData as any);

    const duplicate = await manager.duplicateCollection(source.id);
    const storedCollections = await manager.getAllCollections();

    expect(duplicate.name).toBe("Source (Copy)");
    expect(storedCollections.map((collection) => collection.name)).toEqual([
      "Source",
      "Source (Copy)",
      "Sibling",
    ]);
    expect(await manager.loadCollectionData(duplicate.id)).toEqual(sourceData);
  });

  it("duplicates the active encrypted collection using the cached password", async () => {
    const source = await manager.createCollection(
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

    await manager.saveCollectionData(source.id, sourceData as any, "secret");
    await manager.selectCollection(source.id, "secret");

    const duplicate = await manager.duplicateCollection(source.id);

    expect(duplicate.name).toBe("Secure (Copy)");
    expect(duplicate.isEncrypted).toBe(true);
    expect(await manager.loadCollectionData(duplicate.id, "secret")).toEqual(
      sourceData,
    );
  });

  it("duplicates another encrypted collection when the source password is provided", async () => {
    const source = await manager.createCollection(
      "Vault",
      "desc",
      true,
      "secret",
    );
    await manager.createCollection("Sibling");

    const sourceData = {
      connections: [{ id: "conn-3", name: "Charlie" } as any],
      settings: { filtersPinned: true },
      timestamp: 128,
    };

    await manager.saveCollectionData(source.id, sourceData as any, "secret");

    const duplicate = await manager.duplicateCollection(source.id, {
      password: "secret",
    });

    expect((await manager.getAllCollections()).map((collection) => collection.name)).toEqual([
      "Vault",
      "Vault (Copy)",
      "Sibling",
    ]);
    expect(await manager.loadCollectionData(duplicate.id, "secret")).toEqual(
      sourceData,
    );
  });

  it("throws CollectionNotFoundError when selecting missing collection", async () => {
    await expect(manager.selectCollection("missing")).rejects.toBeInstanceOf(
      CollectionNotFoundError,
    );
  });

  it("throws InvalidPasswordError when password is incorrect", async () => {
    const col = await manager.createCollection(
      "Secure",
      "desc",
      true,
      "secret",
    );
    await expect(
      manager.loadCollectionData(col.id, "wrong"),
    ).rejects.toBeInstanceOf(InvalidPasswordError);
  });

  it("throws CorruptedDataError when decrypted data is invalid", async () => {
    const password = "secret";
    // Encrypt invalid JSON via the same WebCrypto helper the manager uses.
    const encrypted = await encryptWithPassword("{bad-json", password);
    await IndexedDbService.setItem("mremote-collection-corrupt", encrypted);
    await expect(
      manager.loadCollectionData("corrupt", password),
    ).rejects.toBeInstanceOf(CorruptedDataError);
  });
});
