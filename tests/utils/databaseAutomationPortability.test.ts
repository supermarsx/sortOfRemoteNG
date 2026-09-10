import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { emptyDatabaseAutomationLibrary } from "../../src/utils/recording/automationLibraryValidation";
import type { StorageData } from "../../src/utils/storage/storage";
import type { Connection } from "../../src/types/connection/connection";
import { emptyRecycleBin } from "../../src/utils/connection/recycleBin";
import { encryptWithPassword } from "../../src/utils/crypto/webCryptoAes";
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
    "verification detects another window's edit without advancing either writer baseline (encrypted=%s)",
    async (encrypted) => {
      const password = encrypted ? "synthetic-fixture-password" : undefined;
      const db = await manager.createDatabase(
        "Verify",
        undefined,
        encrypted,
        password,
      );
      await manager.selectDatabase(db.id, password);
      const first = manager.captureCurrentDatabaseDataTarget()!;
      const original = (await first.load())!;
      await first.verifyCurrent!();
      const changed = { ...original, automationLibrary: library() };
      // Synthetic second-window commit, without refreshing this manager's cache.
      await IndexedDbService.setItemStrict(
        `mremote-database-${db.id}`,
        password
          ? await encryptWithPassword(JSON.stringify(changed), password)
          : changed,
      );
      await expect(first.verifyCurrent!()).rejects.toThrow("another window");
      await expect(first.save(original)).rejects.toThrow("contents changed");
      await expect(
        manager.saveDatabaseData(db.id, original, password),
      ).rejects.toThrow("contents changed");
      expect(
        (await manager.loadDatabaseData(db.id, password))?.automationLibrary,
      ).toEqual(library());
    },
  );
  it("whole database imports and clones rebind only their own favorites including archived connections", async () => {
    const db = await manager.createDatabase("References");
    const refs = [
      { kind: "macro" as const, id: "fixture" },
      {
        kind: "macro" as const,
        id: "fixture",
        scope: { kind: "database" as const, databaseId: db.id },
      },
      {
        kind: "macro" as const,
        id: "fixture",
        scope: { kind: "database" as const, databaseId: "foreign-db" },
      },
    ];
    const connection: Connection = {
      id: "host",
      name: "Host",
      protocol: "ssh",
      hostname: "fixture.invalid",
      port: 22,
      isGroup: false,
      createdAt: "2026-09-10",
      updatedAt: "2026-09-10",
      sshQuickActions: { version: 1, items: refs },
      httpAutomation: {
        version: 1,
        items: refs,
        interactionMacrosEnabled: false,
        scriptInjectionEnabled: false,
        forceDark: false,
      },
    };
    const data: StorageData = {
      connections: [connection],
      settings: {},
      timestamp: 1,
      automationLibrary: library(),
      recycleBin: {
        ...emptyRecycleBin(),
        policy: { mode: "forever" },
        entries: [
          {
            id: "archived",
            batchId: "batch",
            deletedAt: 1,
            connection: { ...connection, id: "archived-host" },
          },
        ],
      },
    };
    await manager.saveDatabaseData(db.id, data);
    const exported = await manager.readExportableDatabaseSnapshot(db.id, true, {
      includeTrust: false,
    });
    const imported = await manager.importDatabase(JSON.stringify(exported), {
      includeTrust: false,
    });
    const cloned = await manager.duplicateDatabase(db.id, {
      includeTrust: false,
    });
    for (const destination of [imported, cloned]) {
      const stored = (await manager.loadDatabaseData(destination.id))!;
      for (const row of [
        ...stored.connections,
        ...stored.recycleBin!.entries.map((entry) => entry.connection),
      ]) {
        for (const config of [row.sshQuickActions!, row.httpAutomation!]) {
          expect(config.items[0]).toEqual(refs[0]);
          expect(config.items[1].scope).toEqual({
            kind: "database",
            databaseId: destination.id,
          });
          expect(config.items[2]).toEqual(refs[2]);
        }
      }
      expect(stored.automationLibrary).toEqual(library());
    }
    expect(
      (await manager.loadDatabaseData(db.id))!.connections[0].sshQuickActions!
        .items,
    ).toEqual(refs);
    expect(exported.connections[0].sshQuickActions!.items).toEqual(refs);
  });
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
