import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import type { Connection } from "../../src/types/connection/connection";
import type { StorageData } from "../../src/utils/storage/storage";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { emptyRecycleBin } from "../../src/utils/connection/recycleBin";
import { rebindDatabaseQuickActions } from "../../src/utils/connection/rebindDatabaseQuickActions";
import {
  normalizeImportedAdvancedProtocolConnection,
  prepareConnectionForClone,
  prepareConnectionForExport,
  redactConnectionSecretsForExport,
  stripConnectionCredentials,
} from "../../src/components/ImportExport/advancedProtocolPortability";

vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
const trusted = {
  version: 1 as const,
  origins: ["https://destination.example"],
  autoContinue: true,
};
const row = (): Connection => ({
  id: "source",
  name: "Fixture",
  hostname: "source.example",
  protocol: "https",
  port: 443,
  isGroup: false,
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
  password: "synthetic-fixture-password",
  httpTrustedRedirectDestinations: structuredClone(trusted),
});
const data = (): StorageData => ({
  connections: [row()],
  settings: {},
  timestamp: 1,
  recycleBin: {
    ...emptyRecycleBin(),
    policy: { mode: "forever" },
    entries: [
      {
        id: "archived",
        batchId: "batch",
        deletedAt: 1,
        connection: { ...row(), id: "archived-row" },
      },
    ],
  },
});
const assertReset = (
  value: Pick<StorageData, "connections" | "recycleBin">,
) => {
  for (const connection of [
    ...value.connections,
    ...(value.recycleBin?.entries.map((entry) => entry.connection) ?? []),
  ])
    expect(connection).not.toHaveProperty("httpTrustedRedirectDestinations");
};
let manager: DatabaseManager;
beforeEach(async () => {
  await IndexedDbService.init();
  const db = await openDB("mremote-keyval", 1);
  await db.clear("keyval");
  db.close();
  DatabaseManager.resetInstance();
  manager = DatabaseManager.getInstance();
  vi.spyOn(SettingsManager.prototype, "logAction").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  DatabaseManager.resetInstance();
});

describe("redirect destination consent portability", () => {
  it.each([false, true])(
    "strips ordinary export/clone even with credentials=%s",
    (includeCredentials) => {
      for (const prepare of [
        prepareConnectionForExport,
        prepareConnectionForClone,
      ]) {
        const original = row();
        const result = prepare(original, includeCredentials);
        expect(result).not.toHaveProperty("httpTrustedRedirectDestinations");
        expect(original.httpTrustedRedirectDestinations).toEqual(trusted);
        if (includeCredentials) expect(result.password).toBe(original.password);
      }
      for (const prepare of [
        redactConnectionSecretsForExport,
        stripConnectionCredentials,
      ])
        expect(prepare(row())).not.toHaveProperty(
          "httpTrustedRedirectDestinations",
        );
    },
  );
  it("strips malformed imported consent before strict validation and missing-protocol early return", () => {
    for (const protocol of ["https", undefined]) {
      const source = {
        ...row(),
        protocol,
        httpTrustedRedirectDestinations: {
          version: 99,
          origins: "malformed",
          autoContinue: "true",
        },
      } as unknown as Connection;
      expect(
        normalizeImportedAdvancedProtocolConnection(source),
      ).not.toHaveProperty("httpTrustedRedirectDestinations");
      expect(source).toHaveProperty("httpTrustedRedirectDestinations");
    }
  });
  it.each([undefined, "source-db", "destination-db"])(
    "new database copy strips live and archived consent for source ID %s",
    (sourceId) => {
      const original = data();
      assertReset(
        rebindDatabaseQuickActions(original, sourceId, "destination-db"),
      );
      expect(original.connections[0].httpTrustedRedirectDestinations).toEqual(
        trusted,
      );
      expect(
        original.recycleBin!.entries[0].connection
          .httpTrustedRedirectDestinations,
      ).toEqual(trusted);
    },
  );
  it("preserves same database save/load but strips both export modes and whole-database clones", async () => {
    const source = await manager.createDatabase("Original");
    await manager.saveDatabaseData(source.id, data());
    for (const includePasswords of [false, true]) {
      const snapshot = await manager.readExportableDatabaseSnapshot(
        source.id,
        includePasswords,
        { includeTrust: false },
      );
      assertReset(snapshot);
      if (includePasswords)
        expect(snapshot.connections[0].password).toBe(row().password);
    }
    const copy = await manager.duplicateDatabase(source.id, {
      includeTrust: false,
    });
    assertReset((await manager.loadDatabaseData(copy.id))!);
    const original = (await manager.loadDatabaseData(source.id))!;
    expect(original.connections[0].httpTrustedRedirectDestinations).toEqual(
      trusted,
    );
    expect(
      original.recycleBin!.entries[0].connection
        .httpTrustedRedirectDestinations,
    ).toEqual(trusted);
  });
  it("raw database import strips live/archive grants even without a source database ID", async () => {
    const incoming = data();
    incoming.connections[0].httpTrustedRedirectDestinations = {
      version: 99,
    } as never;
    incoming.recycleBin!.entries[0].connection.httpTrustedRedirectDestinations =
      { origins: "invalid" } as never;
    const created = await manager.importDatabase(
      JSON.stringify({ ...incoming, collection: { name: "import.example" } }),
      {
        collectionName: "Imported",
        includeTrust: false,
      },
    );
    assertReset((await manager.loadDatabaseData(created.id))!);
  });
  it("append resets incoming consent without changing existing local consent", async () => {
    const target = await manager.createDatabase("Target");
    await manager.saveDatabaseData(target.id, data());
    const incoming = { ...row(), id: "new-row" };
    await manager.appendConnectionsToDatabase(target.id, [incoming], {
      includeTrust: false,
    });
    const stored = (await manager.loadDatabaseData(target.id))!;
    expect(stored.connections[0].httpTrustedRedirectDestinations).toEqual(
      trusted,
    );
    expect(stored.connections[1]).not.toHaveProperty(
      "httpTrustedRedirectDestinations",
    );
    expect(
      stored.recycleBin!.entries[0].connection.httpTrustedRedirectDestinations,
    ).toEqual(trusted);
    expect(incoming.httpTrustedRedirectDestinations).toEqual(trusted);
  });
});
