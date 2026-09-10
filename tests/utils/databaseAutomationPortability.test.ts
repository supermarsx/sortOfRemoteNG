import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { emptyDatabaseAutomationLibrary } from "../../src/utils/recording/automationLibraryValidation";
import type { StorageData } from "../../src/utils/storage/storage";
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
const library = () => ({
  ...emptyDatabaseAutomationLibrary(),
  revision: 7,
  terminalMacros: [
    {
      id: "fixture",
      name: "Safe fixture",
      steps: [{ command: "printf fixture", delayMs: 0, sendNewline: true }],
      createdAt: "2026-09-10",
      updatedAt: "2026-09-10",
    },
  ],
  provenance: {
    "terminal-macro:fixture": {
      sourceUrl: "https://example.test/catalog.json",
      sourceSha256: "b".repeat(64),
    },
  },
});
let manager: DatabaseManager;
beforeEach(async () => {
  await IndexedDbService.init();
  await (await openDB("mremote-keyval", 1)).clear("keyval");
  DatabaseManager.resetInstance();
  manager = DatabaseManager.getInstance();
  vi.spyOn(SettingsManager.prototype, "logAction").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  DatabaseManager.resetInstance();
});
describe("database automation portability and content CAS", () => {
  it.each([false, true])(
    "rejects stale window overwrite for encrypted=%s and retains scope payload",
    async (encrypted) => {
      const password = encrypted ? "synthetic-fixture-password" : undefined;
      const db = await manager.createDatabase(
        "CAS fixture",
        undefined,
        encrypted,
        password,
      );
      await manager.selectDatabase(db.id, password);
      const first = manager.captureCurrentDatabaseDataTarget()!;
      const original = (await first.load())!;
      const second = manager.captureCurrentDatabaseDataTarget()!;
      await second.load();
      await second.save({ ...original, automationLibrary: library() });
      await expect(first.save({ ...original, timestamp: 222 })).rejects.toThrow(
        "contents changed",
      );
      expect(
        (await manager.loadDatabaseData(db.id, password))?.automationLibrary,
      ).toEqual(library());
      // A later unrelated read cannot bless the older captured writer.
      await expect(first.save({ ...original, timestamp: 333 })).rejects.toThrow(
        "contents changed",
      );
    },
  );
  it("refuses a missing baseline rather than reading fresh data and overwriting blindly", async () => {
    const db = await manager.createDatabase("Existing");
    DatabaseManager.resetInstance();
    const other = DatabaseManager.getInstance();
    await expect(
      other.saveDatabaseData(db.id, {
        connections: [],
        settings: {},
        timestamp: 1,
      }),
    ).rejects.toThrow("baseline");
  });
  it("full database export/import and duplicate preserve all scoped data and provenance", async () => {
    const db = await manager.createDatabase("Portable");
    const data: StorageData = {
      connections: [],
      settings: { retained: true },
      timestamp: 1,
      automationLibrary: library(),
    };
    await manager.saveDatabaseData(db.id, data);
    const exported = await manager.readExportableDatabaseSnapshot(
      db.id,
      false,
      {
        includeTrust: false,
      },
    );
    expect(exported.automationLibrary).toEqual(library());
    const imported = await manager.importDatabase(JSON.stringify(exported), {
      includeTrust: false,
    });
    expect(
      (await manager.loadDatabaseData(imported.id))?.automationLibrary,
    ).toEqual(library());
    const duplicate = await manager.duplicateDatabase(db.id, {
      includeTrust: false,
    });
    expect(
      (await manager.loadDatabaseData(duplicate.id))?.automationLibrary,
    ).toEqual(library());
  });
  it("credential-free export refuses secret-like macro literals without dropping or corrupting entries", async () => {
    const db = await manager.createDatabase("Private");
    const privateLibrary = library();
    privateLibrary.terminalMacros[0].steps[0].command =
      "example --password synthetic-secret-literal";
    await manager.saveDatabaseData(db.id, {
      connections: [],
      settings: {},
      timestamp: 1,
      automationLibrary: privateLibrary,
    });
    await expect(
      manager.readExportableDatabaseSnapshot(db.id, false, {
        includeTrust: false,
      }),
    ).rejects.toThrow("possible literal credentials");
    expect(
      (
        await manager.readExportableDatabaseSnapshot(db.id, true, {
          includeTrust: false,
        })
      ).automationLibrary,
    ).toEqual(privateLibrary);
    expect((await manager.loadDatabaseData(db.id))?.automationLibrary).toEqual(
      privateLibrary,
    );
  });
  it("invalid imported scope field refuses before creating a database", async () => {
    await expect(
      manager.importDatabase(
        JSON.stringify({
          collection: { name: "Invalid" },
          connections: [],
          automationLibrary: { version: 99 },
        }),
        { includeTrust: false },
      ),
    ).rejects.toThrow("Invalid");
    expect(await manager.getAllDatabases()).toEqual([]);
  });
});
