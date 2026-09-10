import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ validate: vi.fn() }));
vi.mock("../../src/utils/security/passwordPolicy", async (original) => ({
  ...(await original<
    typeof import("../../src/utils/security/passwordPolicy")
  >()),
  validateNewPassword: mock.validate,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { encryptExport } from "../../src/utils/crypto/exportEncryption";
import { decryptWithPassword } from "../../src/utils/crypto/webCryptoAes";
beforeEach(async () => {
  mock.validate.mockReset().mockResolvedValue(undefined);
  DatabaseManager.resetInstance();
  vi.spyOn(SettingsManager.prototype, "logAction").mockResolvedValue(undefined);
  const db = await openDB("mremote-keyval", 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("keyval"))
        database.createObjectStore("keyval");
    },
  });
  await db.clear("keyval");
});
describe("policy only at new-password boundaries", () => {
  it("refuses create before writing a database or index", async () => {
    mock.validate.mockRejectedValueOnce(Error("Policy refused"));
    const manager = DatabaseManager.getInstance();
    await expect(
      manager.createDatabase("Private", "", true, "short"),
    ).rejects.toThrow("Policy refused");
    expect(await manager.getAllDatabases()).toEqual([]);
    expect(mock.validate).toHaveBeenCalledExactlyOnceWith("short", "database");
  });
  it("validates create/change/export but never old-password unlock, data save or decrypt", async () => {
    const manager = DatabaseManager.getInstance();
    const db = await manager.createDatabase(
      "Fixture",
      "",
      true,
      "old-password",
    );
    expect(mock.validate).toHaveBeenCalledExactlyOnceWith(
      "old-password",
      "database",
    );
    mock.validate.mockClear();
    await manager.selectDatabase(db.id, "old-password");
    await manager.saveCurrentDatabaseData({
      connections: [],
      settings: {},
      timestamp: 2,
    });
    expect(mock.validate).not.toHaveBeenCalled();
    await manager.changeDatabasePassword(db.id, "old-password", "new-password");
    expect(mock.validate).toHaveBeenCalledExactlyOnceWith(
      "new-password",
      "database",
    );
    mock.validate.mockClear();
    const exported = await manager.exportDatabase(
      db.id,
      false,
      "export-password",
      "new-password",
    );
    expect(mock.validate).toHaveBeenCalledExactlyOnceWith(
      "export-password",
      "export",
    );
    mock.validate.mockClear();
    await decryptWithPassword(exported, "export-password");
    expect(mock.validate).not.toHaveBeenCalled();
  });
  it("refuses changed password before modifying a previously readable database", async () => {
    const manager = DatabaseManager.getInstance();
    const db = await manager.createDatabase("Fixture");
    mock.validate.mockRejectedValueOnce(Error("Policy refused"));
    await expect(
      manager.changeDatabasePassword(db.id, undefined, "weak"),
    ).rejects.toThrow("Policy refused");
    expect((await manager.getDatabase(db.id))?.isEncrypted).toBe(false);
    expect((await manager.loadDatabaseData(db.id))?.connections).toEqual([]);
  });
  it("generic protected export validates before derivation", async () => {
    mock.validate.mockRejectedValueOnce(Error("Unlock settings"));
    await expect(
      encryptExport("json", {
        password: "secret",
        payload: new TextEncoder().encode("{}"),
      }),
    ).rejects.toThrow("Unlock settings");
    expect(mock.validate).toHaveBeenCalledExactlyOnceWith("secret", "export");
  });
});
