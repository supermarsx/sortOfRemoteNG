import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import * as passwordCrypto from "../../src/utils/crypto/webCryptoAes";
import type { ConnectionDatabase } from "../../src/types/connection/connection";

vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));

const row: ConnectionDatabase = {
  id: "credential-revision-fixture",
  name: "Credential revision fixture",
  isEncrypted: true,
  securityRevision: "original-revision",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  lastAccessed: "2026-01-01",
};
const data = { connections: [], settings: { theme: "dark" }, timestamp: 1 };
const indexKey = "mremote-databases";
const dataKey = `mremote-database-${row.id}`;
const oldPassword = "old-fixture-password";
const newPassword = "new-fixture-password";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

/** Hold only the first manager's already-verified result, not the shared store. */
function holdLoadedSnapshot(manager: DatabaseManager) {
  const entered = deferred();
  const release = deferred();
  const load = manager.loadDatabaseData.bind(manager);
  vi.spyOn(manager, "loadDatabaseData").mockImplementationOnce(
    async (...args) => {
      const snapshot = await load(...args);
      entered.resolve();
      await release.promise;
      return snapshot;
    },
  );
  return { entered: entered.promise, release: release.resolve };
}

async function assertRotatedSourceIsIntact(manager: DatabaseManager) {
  const stored = await IndexedDbService.getItemStrict<string>(dataKey);
  expect(stored).toBeTypeOf("string");
  expect(
    JSON.parse(await passwordCrypto.decryptWithPassword(stored!, newPassword)),
  ).toEqual(data);
  await expect(
    passwordCrypto.decryptWithPassword(stored!, oldPassword),
  ).rejects.toThrow();
  expect(await manager.loadDatabaseData(row.id, newPassword)).toEqual(data);
}

beforeEach(async () => {
  vi.restoreAllMocks();
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
  db.close();
  await IndexedDbService.setItemStrict(indexKey, [row]);
  await IndexedDbService.setItemStrict(
    dataKey,
    await passwordCrypto.encryptWithPassword(
      JSON.stringify(data),
      oldPassword,
      {
        iterations: 10000,
      },
    ),
  );
});

describe("cross-window database credential revision races", () => {
  it.each(["loadDatabaseData", "unlockDatabase", "selectDatabase"] as const)(
    "does not authorize a late %s after another manager replaces the password",
    async (method) => {
      const first = new DatabaseManager();
      const second = new DatabaseManager();
      const entered = deferred();
      const release = deferred();
      const decrypt = passwordCrypto.decryptWithPassword;
      vi.spyOn(passwordCrypto, "decryptWithPassword").mockImplementationOnce(
        async (...args) => {
          const plaintext = await decrypt(...args);
          entered.resolve();
          await release.promise;
          return plaintext;
        },
      );

      const pending = first[method](row.id, oldPassword);
      const rejected = expect(pending).rejects.toThrow(/security changed/);
      await entered.promise;
      await second.changeDatabasePassword(row.id, oldPassword, newPassword);
      release.resolve();
      await rejected;

      expect(first.getUnlockedDatabaseIds()).toEqual([]);
      expect(first.getCurrentDatabase()).toBeNull();
      await assertRotatedSourceIsIntact(second);
    },
  );

  it("rejects an append built from an old snapshot instead of adopting the new revision", async () => {
    const first = new DatabaseManager();
    const second = new DatabaseManager();
    await first.unlockDatabase(row.id, oldPassword);
    const held = holdLoadedSnapshot(first);
    const pending = first.appendConnectionsToDatabase(row.id, []);
    const rejected = expect(pending).rejects.toThrow(/security changed/);
    await held.entered;
    await second.changeDatabasePassword(row.id, oldPassword, newPassword);
    held.release();
    await rejected;

    expect(first.getUnlockedDatabaseIds()).toEqual([]);
    await assertRotatedSourceIsIntact(second);
  });

  it("does not create a clone when the source revision changes after its read", async () => {
    const first = new DatabaseManager();
    const second = new DatabaseManager();
    const held = holdLoadedSnapshot(first);
    const pending = first.duplicateDatabase(row.id, {
      password: oldPassword,
      includeTrust: false,
    });
    const rejected = expect(pending).rejects.toThrow(/security changed/);
    await held.entered;
    await second.changeDatabasePassword(row.id, oldPassword, newPassword);
    held.release();
    await rejected;

    expect((await second.getAllDatabases()).map((item) => item.id)).toEqual([
      row.id,
    ]);
    expect(first.getUnlockedDatabaseIds()).toEqual([]);
    await assertRotatedSourceIsIntact(second);
  });

  it("identifies retained partial output when the source changes during clone encryption", async () => {
    const first = new DatabaseManager();
    const second = new DatabaseManager();
    const entered = deferred();
    const release = deferred();
    const encrypt = passwordCrypto.encryptWithPassword;
    vi.spyOn(passwordCrypto, "encryptWithPassword").mockImplementationOnce(
      async (...args) => {
        const payload = await encrypt(...args);
        entered.resolve();
        await release.promise;
        return payload;
      },
    );
    const pending = first.duplicateDatabase(row.id, {
      password: oldPassword,
      includeTrust: false,
    });
    const outcome = pending.catch((error: unknown) => error);
    await entered.promise;
    await second.changeDatabasePassword(row.id, oldPassword, newPassword);
    release.resolve();
    const failure = await outcome;

    const collections = await second.getAllDatabases();
    expect(collections).toHaveLength(2);
    const retained = collections.find((item) => item.id !== row.id)!;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("Partial database");
    expect((failure as Error).message).toContain(retained.name);
    expect((failure as Error).message).toContain(retained.id);
    expect((failure as Error).message).toContain("Review it before retrying");
    expect(await second.loadDatabaseData(retained.id, oldPassword)).toEqual(
      data,
    );
    await assertRotatedSourceIsIntact(second);
  });

  it.each(["snapshot", "export"] as const)(
    "does not return a stale %s after a cross-window password change",
    async (operation) => {
      const first = new DatabaseManager();
      const second = new DatabaseManager();
      const held = holdLoadedSnapshot(first);
      const pending =
        operation === "snapshot"
          ? first.readExportableDatabaseSnapshot(row.id, true, {
              collectionPassword: oldPassword,
              includeTrust: false,
            })
          : first.exportDatabase(row.id, true, undefined, oldPassword);
      const rejected = expect(pending).rejects.toThrow(/security changed/);
      await held.entered;
      await second.changeDatabasePassword(row.id, oldPassword, newPassword);
      held.release();
      await rejected;

      expect(first.getUnlockedDatabaseIds()).toEqual([]);
      await assertRotatedSourceIsIntact(second);
    },
  );
});
