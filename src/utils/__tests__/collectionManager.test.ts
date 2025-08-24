import { describe, it, expect, beforeEach } from "vitest";
import CryptoJS from "crypto-js";
import { CollectionManager } from "../collectionManager";
import { IndexedDbService } from "../indexedDbService";
import {
  CollectionNotFoundError,
  CorruptedDataError,
  InvalidPasswordError,
} from "../errors";
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
    expect(stored[0].id).toBe(col.id);
    expect(stored[0].name).toBe("Test");
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
    expect(stored[0].name).toBe("Updated");
    expect(stored[0].description).toBe("changed");
  });

  it("updates currentCollection when editing selected collection", async () => {
    const col = await manager.createCollection("A");
    await manager.selectCollection(col.id);
    const updated = { ...col, name: "B" };
    await manager.updateCollection(updated);
    expect(manager.getCurrentCollection()?.name).toBe("B");
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
    const encrypted = CryptoJS.AES.encrypt("not-json", password).toString();
    await IndexedDbService.setItem("mremote-collection-corrupt", encrypted);
    await expect(
      manager.loadCollectionData("corrupt", password),
    ).rejects.toBeInstanceOf(CorruptedDataError);
  });
});
