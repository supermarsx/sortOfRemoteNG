import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import {
  applyCloudSyncPayload,
  captureCloudSyncPayload,
  upgradeCloudSyncPayload,
} from "../../src/utils/services/cloudSyncPayload";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";
import {
  buildFullDatabaseArchive,
  encryptFullDatabaseArchive,
  fullDatabaseArchiveData,
} from "../../src/utils/connection/fullDatabaseArchive";
import { reconcileRecordLedger } from "../../src/utils/storage/recordLedger";
import { runCloudSync } from "../../src/utils/services/cloudSyncEngine";
import {
  decodeCloudSnapshot,
  encodeCloudSnapshot,
} from "../../src/utils/services/cloudSyncCodec";
import {
  encryptWithPassword,
  decryptWithPassword,
} from "../../src/utils/crypto/webCryptoAes";
import type { ConnectionDatabase } from "../../src/types/connection/connection";
import type { StorageData } from "../../src/utils/storage/storage";
import type { DatabaseProtectionTarget } from "../../src/types/encryption/databaseProtection";
import {
  collection,
  connection,
  fullData,
  trust,
  VAULT_ID,
} from "../fixtures/fullDatabaseArchive";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => bridge.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../../src/utils/security/passwordPolicy", () => ({
  validateNewPassword: vi.fn(async () => {}),
}));
const PASSWORD = "Synthetic-archive-password!";
const target: DatabaseProtectionTarget = {
  dataCipher: "aes-256-gcm",
  keepSlotIds: [],
  newSlots: [
    {
      type: "password",
      label: "New unlock",
      password: "New-database-password!",
    },
  ],
};
let rows: ConnectionDatabase[];
let payloads: Map<string, unknown>;
let privateData: Map<string, StorageData>;
let trustFailure: boolean;
let sessionExpiresAt: number;

beforeEach(async () => {
  DatabaseManager.resetInstance();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(SettingsManager.prototype, "logAction").mockImplementation(
    async () => undefined,
  );
  rows = [structuredClone(collection)];
  privateData = new Map([[collection.id, await fullData()]]);
  payloads = new Map([
    [
      collection.id,
      JSON.stringify({
        format: "sorng-db",
        version: 1,
        ciphertext: "opaque-source",
      }),
    ],
  ]);
  trustFailure = false;
  sessionExpiresAt = Date.now() + 900000;
  bridge.invoke.mockImplementation(
    async (command: string, args: Record<string, any> = {}) => {
      if (command === "databases_list")
        return { value: structuredClone(rows), source: "current" };
      if (command === "databases_save_index") {
        rows = structuredClone(args.list);
        return;
      }
      if (command === "load_database_data")
        return {
          value: structuredClone(payloads.get(args.databaseId)),
          source: "current",
        };
      if (command === "save_database_data") {
        payloads.set(args.databaseId, structuredClone(args.data));
        return;
      }
      if (
        command === "database_protection_unlock" ||
        command === "database_protection_load"
      )
        return {
          sessionId:
            args.databaseId === collection.id
              ? "native-handle"
              : "destination-handle",
          sessionExpiresAt,
          securityRevision: rows.find((row) => row.id === args.databaseId)!
            .securityRevision,
          data: structuredClone(privateData.get(args.databaseId)),
        };
      if (command === "database_protection_capabilities")
        return {
          schemaVersion: 1,
          ciphers: [{ id: "aes-256-gcm", available: true }],
          protectors: [
            {
              id: "password",
              available: true,
              deviceBound: false,
              requiresUserPresence: false,
            },
          ],
        };
      if (command === "database_browser_sessions_describe")
        return structuredClone(
          privateData.get(args.databaseId)?.browserSessions ?? {
            version: 1,
            records: [],
          },
        );
      if (command === "database_protection_save") {
        expect(args.expectedData).toEqual(privateData.get(args.databaseId));
        privateData.set(args.databaseId, structuredClone(args.data));
        return {
          committed: true,
          cleanupPending: false,
          warnings: [],
          securityRevision: rows.find((row) => row.id === args.databaseId)!
            .securityRevision,
        };
      }
      if (command === "database_protection_change") {
        const row = rows.find((row) => row.id === args.databaseId)!;
        row.isEncrypted = true;
        row.protectionFormat = "sorng-db";
        row.securityRevision = "destination-revision";
        privateData.set(row.id, structuredClone(args.legacyVerifiedData));
        payloads.set(
          row.id,
          JSON.stringify({
            format: "sorng-db",
            version: 1,
            ciphertext: "opaque-destination",
          }),
        );
        return {
          committed: true,
          cleanupPending: false,
          warnings: [],
          securityRevision: row.securityRevision,
          sessionId: "destination-handle",
          sessionExpiresAt,
        };
      }
      if (command === "trust_export_database") {
        if (trustFailure) throw new Error("PRIVATE_BACKEND_ERROR");
        return structuredClone(trust);
      }
      if (command === "trust_import_database") {
        if (trustFailure) throw new Error("PRIVATE_BACKEND_ERROR");
        return { imported: args.document.records.length, skipped: 0 };
      }
      return undefined;
    },
  );
});
afterEach(() => DatabaseManager.resetInstance());

async function exported() {
  const manager = DatabaseManager.getInstance();
  await manager.unlockManagedDatabase(
    collection.id,
    "password-slot",
    "source-unlock",
  );
  return manager.exportFullDatabaseArchive(collection.id, PASSWORD, {
    encryptionOptions: { iterations: 10000 },
  });
}

async function openPlainDatabase() {
  rows[0] = { ...collection, isEncrypted: false, protectionFormat: undefined };
  payloads.set(collection.id, { connections: [], settings: {}, timestamp: 1 });
  const manager = DatabaseManager.getInstance();
  await manager.selectDatabase(collection.id);
  return manager;
}

describe("full database manager archive boundary", () => {
  it.each(["update", "delete", "reject"])(
    "applies explicit cloud %s with public/session CAS in one native transaction (mocked IPC)",
    async (operation) => {
      const source = privateData.get(collection.id)!;
      source.browserSessions = {
        version: 1,
        records: [
          { connectionId: "host", revision: "a".repeat(64) },
          { connectionId: "local", revision: "a".repeat(64) },
        ],
      };
      const password = "distinct-cloud-password";
      const previous = bridge.invoke.getMockImplementation()!;
      let exportedCapsules = 0;
      bridge.invoke.mockImplementation(async (command, args) => {
        if (command === "database_browser_sessions_export")
          return {
            version: 1,
            ciphertext: `SYNTHETIC_RANDOM_EXPORT_${++exportedCapsules}`,
          };
        if (command === "database_browser_sessions_import") {
          expect(args.password).toBe(password);
          expect(args.expectedData).toEqual(privateData.get(collection.id));
          expect(args.expected).toEqual(source.browserSessions);
          expect(args.transfer.ciphertext).toBe("SYNTHETIC_INCOMING_CAPSULE");
          expect(args.deletedConnectionIds).toEqual(
            operation === "delete" ? ["host", "local"] : ["local"],
          );
          expect(args.data.settings.theme).toBe("remote-edited");
          expect(args.data).not.toHaveProperty("browserSessionsTransfer");
          expect(args.data).not.toHaveProperty(
            "browserSessionsDeletedConnectionIds",
          );
          if (operation === "reject")
            throw new Error("SYNTHETIC_REJECTED_CAPSULE_OR_CAS");
          privateData.set(collection.id, structuredClone(args.data));
          return {
            committed: true,
            cleanupPending: false,
            warnings: [],
            securityRevision: "source-revision",
          };
        }
        return previous(command, args);
      });
      const manager = DatabaseManager.getInstance();
      await manager.unlockManagedDatabase(
        collection.id,
        "password-slot",
        "source-unlock",
      );
      const config = {
        ...defaultCloudSyncConfig,
        selectedItems: [`database:${collection.id}`],
        encryptBeforeSync: true,
        syncEncryptionPassword: password,
      };
      const baseline = await captureCloudSyncPayload(config, {
        sessionTransferPurpose: "atomic-restore",
      });
      const incoming = structuredClone(
        baseline.sections[`database:${collection.id}`],
      ) as Awaited<ReturnType<typeof buildFullDatabaseArchive>>;
      incoming.browserSessions =
        operation === "delete"
          ? { version: 1, records: [] }
          : {
              version: 1,
              records: [{ connectionId: "host", revision: "b".repeat(64) }],
            };
      incoming.browserSessionsDeletedConnectionIds =
        operation === "delete" ? ["host", "local"] : ["local"];
      incoming.browserSessionsTransfer = {
        version: 1,
        ciphertext: "SYNTHETIC_INCOMING_CAPSULE",
      };
      incoming.settings.theme = "remote-edited";
      incoming.recordMetadata = await reconcileRecordLedger(
        fullDatabaseArchiveData(incoming),
        incoming.recordMetadata,
        { mode: "write" },
      );
      const before = structuredClone(privateData.get(collection.id));
      bridge.invoke.mockClear();
      const pending = applyCloudSyncPayload(
        { version: 1, sections: { [`database:${collection.id}`]: incoming } },
        config,
        baseline,
      );
      if (operation === "reject") {
        await expect(pending).rejects.toMatchObject({ kind: "partial" });
        expect(privateData.get(collection.id)).toEqual(before);
        expect(
          bridge.invoke.mock.calls.some(
            ([cmd]) => cmd === "trust_import_database",
          ),
        ).toBe(false);
      } else {
        await pending;
        expect(privateData.get(collection.id)!.settings.theme).toBe(
          "remote-edited",
        );
        expect(privateData.get(collection.id)!.browserSessions).toEqual(
          incoming.browserSessions,
        );
      }
      expect(
        bridge.invoke.mock.calls.filter(
          ([cmd]) => cmd === "database_browser_sessions_import",
        ),
      ).toHaveLength(1);
      expect(
        bridge.invoke.mock.calls.some(
          ([cmd]) => cmd === "database_protection_save",
        ),
      ).toBe(false);
      expect(exportedCapsules).toBeGreaterThan(1); // Fresh local wrappers do not weaken public-body CAS.
    },
  );

  it("does not rewrite renderer metadata during cookie-only capture or invalidate an editor baseline (mocked native CAS)", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(
      collection.id,
      "password-slot",
      "source-unlock",
    );
    // Do the existing one-time default/legacy-history migration before opening
    // the editor. This test concerns subsequent native-only session changes.
    await manager.readFullDatabaseArchive(collection.id, {
      materializeDefaults: true,
    });
    const editor = (await manager.loadDatabaseData(collection.id))!;
    const baseline = structuredClone(privateData.get(collection.id)!);
    const previous = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command === "database_browser_sessions_export")
        return { version: 1, ciphertext: "SYNTHETIC_TRANSFER" };
      if (command === "database_protection_save") {
        const ordinary = (value: StorageData) => {
          const { browserSessions: _nativeOwned, ...body } = value;
          return body;
        };
        // Models native merge_renderer: native sessions are kept out of ordinary
        // body CAS, and renderer edits cannot replace their private contents.
        expect(ordinary(args.expectedData)).toEqual(
          ordinary(privateData.get(args.databaseId)!),
        );
        expect(args.data.browserSessions).toEqual(
          args.expectedData.browserSessions,
        );
        privateData.set(args.databaseId, {
          ...structuredClone(args.data),
          browserSessions: privateData.get(args.databaseId)!.browserSessions,
        });
        return {
          committed: true,
          cleanupPending: false,
          warnings: [],
          securityRevision: "source-revision",
        };
      }
      return previous(command, args);
    });
    bridge.invoke.mockClear();
    const saved = vi.fn();
    window.addEventListener("sorng-database-data-saved", saved);
    try {
      for (const revision of ["a", "a", "b"]) {
        privateData.get(collection.id)!.browserSessions = {
          version: 1,
          records: [
            {
              connectionId: "host",
              revision: revision.repeat(64),
            },
          ],
        };
        await expect(
          captureCloudSyncPayload({
            ...defaultCloudSyncConfig,
            selectedItems: [`database:${collection.id}`],
            encryptBeforeSync: true,
            syncEncryptionPassword: "cloud-session-password",
          }),
        ).rejects.toThrow(/native authenticated transfer/);
        expect(privateData.get(collection.id)!.recordMetadata).toEqual(
          baseline.recordMetadata,
        );
        expect(privateData.get(collection.id)!.timestamp).toEqual(
          baseline.timestamp,
        );
      }
      expect(saved).not.toHaveBeenCalled();
      expect(
        bridge.invoke.mock.calls.some(
          ([command]) => command === "database_protection_save",
        ),
      ).toBe(false);
      editor.settings.theme = "light";
      await manager.saveDatabaseData(collection.id, editor);
      expect(privateData.get(collection.id)!.settings.theme).toBe("light");
      expect(
        privateData.get(collection.id)!.browserSessions?.records[0].revision,
      ).toBe("b".repeat(64));
      expect(saved).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("sorng-database-data-saved", saved);
    }
  });

  it.each([true, false])(
    "uses one combined native body/session import after protecting an empty destination (commit=%s; mocked IPC)",
    async (commit) => {
      const data = privateData.get(collection.id)!;
      data.browserSessions = {
        version: 1,
        records: [
          {
            connectionId: data.connections.find((row) => !row.isGroup)!.id,
            revision: "a".repeat(64),
          },
        ],
      };
      const capsule = { version: 1, ciphertext: "SYNTHETIC_NATIVE_TRANSFER" };
      const previous = bridge.invoke.getMockImplementation()!;
      bridge.invoke.mockImplementation(async (command, args) => {
        if (command === "database_browser_sessions_export") return capsule;
        if (command === "database_browser_sessions_import") {
          expect(args.expectedData).toEqual(privateData.get(args.databaseId));
          expect(args.expectedData.connections).toEqual([]);
          expect(args.expected).toEqual({ version: 1, records: [] });
          expect(args.selected).toEqual(data.browserSessions);
          expect(args.data.browserSessions).toEqual(data.browserSessions);
          expect(args.password).toBe(PASSWORD);
          expect(args.transfer).toEqual(capsule);
          expect(args.deletedConnectionIds).toEqual([]);
          if (!commit) throw new Error("SYNTHETIC_PRIVATE_ERROR");
          privateData.set(args.databaseId, structuredClone(args.data));
          return {
            committed: true,
            cleanupPending: false,
            warnings: [],
            securityRevision: "destination-revision",
          };
        }
        return previous(command, args);
      });
      const encrypted = await exported();
      bridge.invoke.mockClear();
      const pending = DatabaseManager.getInstance().importDatabase(encrypted, {
        importPassword: PASSWORD,
        protectionTarget: target,
        collectionName: "Session copy",
      });
      if (commit) {
        const created = await pending;
        expect(privateData.get(created.id)?.browserSessions).toEqual(
          data.browserSessions,
        );
        expect(bridge.invoke).toHaveBeenCalledWith(
          "trust_import_database",
          expect.objectContaining({ databaseId: created.id }),
        );
      } else {
        await expect(pending).rejects.toMatchObject({ kind: "partial" });
        expect(
          bridge.invoke.mock.calls.some(
            ([command]) => command === "trust_import_database",
          ),
        ).toBe(false);
        const destination = rows.find((row) => row.id !== collection.id)!;
        expect(destination.protectionFormat).toBe("sorng-db");
        expect(privateData.get(destination.id)?.connections).toEqual([]);
        expect(
          privateData.get(destination.id)?.browserSessions,
        ).toBeUndefined();
      }
      const commands = bridge.invoke.mock.calls.map(([command]) => command);
      expect(
        commands.filter(
          (command) => command === "database_browser_sessions_import",
        ),
      ).toHaveLength(1);
      expect(commands).not.toContain("database_protection_save");
      expect(commands.indexOf("database_protection_change")).toBeLessThan(
        commands.indexOf("database_browser_sessions_import"),
      );
      const enrollment = bridge.invoke.mock.calls.find(
        ([command]) => command === "database_protection_change",
      )![1];
      expect(enrollment.legacyVerifiedData.connections).toEqual([]);
      expect(enrollment.legacyVerifiedData.browserSessions).toBeUndefined();
      for (const [, args] of bridge.invoke.mock.calls.filter(
        ([command]) => command === "save_database_data",
      )) {
        expect(args.data.connections).toEqual([]);
        expect(args.data.browserSessions).toBeUndefined();
      }
    },
  );

  it("exports retained sessions through native using the archive password, not the source unlock secret", async () => {
    const data = privateData.get(collection.id)!;
    data.browserSessions = {
      version: 1,
      records: [
        {
          connectionId: data.connections.find((r) => !r.isGroup)!.id,
          revision: "a".repeat(64),
        },
      ],
    };
    const previous = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) =>
      command === "database_browser_sessions_export"
        ? { version: 1, ciphertext: "native-sealed-transfer" }
        : previous(command, args),
    );
    const encrypted = await exported();
    const archive = JSON.parse(await decryptWithPassword(encrypted, PASSWORD));
    expect(archive.browserSessions).toEqual(data.browserSessions);
    expect(archive.browserSessionsTransfer).toEqual({
      version: 1,
      ciphertext: "native-sealed-transfer",
    });
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_browser_sessions_export",
      {
        databaseId: collection.id,
        sessionId: "native-handle",
        expectedSecurityRevision: "source-revision",
        selected: data.browserSessions,
        password: PASSWORD,
      },
    );
  });

  it("passes the cloud password to native export and fails before unsafe wrapper comparison/upload", async () => {
    const data = privateData.get(collection.id)!;
    data.browserSessions = {
      version: 1,
      records: [
        {
          connectionId: data.connections.find((r) => !r.isGroup)!.id,
          revision: "a".repeat(64),
        },
      ],
    };
    const previous = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) =>
      command === "database_browser_sessions_export"
        ? { version: 1, ciphertext: "randomized-native-transfer" }
        : previous(command, args),
    );
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(
      collection.id,
      "password-slot",
      "source-unlock",
    );
    await expect(
      captureCloudSyncPayload({
        ...defaultCloudSyncConfig,
        selectedItems: [`database:${collection.id}`],
        encryptBeforeSync: true,
        syncEncryptionPassword: "separate-cloud-password",
      }),
    ).rejects.toThrow(/native authenticated transfer/);
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_browser_sessions_export",
      expect.objectContaining({
        password: "separate-cloud-password",
        selected: data.browserSessions,
      }),
    );
    expect(
      bridge.invoke.mock.calls.some(
        ([command]) => command === "cloud_sync_write",
      ),
    ).toBe(false);
  });

  it("does not create a database with descriptors but missing native session secrets", async () => {
    const data = privateData.get(collection.id)!;
    data.browserSessions = {
      version: 1,
      records: [
        {
          connectionId: data.connections.find((r) => !r.isGroup)!.id,
          revision: "a".repeat(64),
        },
      ],
    };
    const manager = DatabaseManager.getInstance();
    await expect(
      manager.createManagedDatabase("unsafe copy", target, { data }),
    ).rejects.toThrow(/native authenticated transfer/);
    expect(
      bridge.invoke.mock.calls.some(([command]) =>
        [
          "databases_save_index",
          "save_database_data",
          "database_protection_change",
        ].includes(command),
      ),
    ).toBe(false);
  });

  it("CAS-materializes absent sections once, preserving existing history and device fields across capture and saves", async () => {
    const source: StorageData = {
      connections: [connection("a"), connection("b")],
      settings: { theme: "dark" },
      timestamp: Date.parse("2026-10-01T00:00:00Z"),
      credentialVault: (await fullData()).credentialVault,
    };
    source.recordMetadata = await reconcileRecordLedger(source);
    privateData.set(collection.id, source);
    const original = structuredClone(source);
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(
      collection.id,
      "password-slot",
      "source-unlock",
    );
    // A normal export still has no persistence side effects.
    await manager.readFullDatabaseArchive(collection.id);
    expect(privateData.get(collection.id)).toEqual(original);
    const config = {
      ...defaultCloudSyncConfig,
      selectedItems: [`database:${collection.id}`],
      encryptBeforeSync: true,
    };
    const captured = await captureCloudSyncPayload(config);
    const migrated = privateData.get(collection.id)!;
    expect(migrated.credentialVault).toEqual(original.credentialVault);
    expect(migrated.connections).toEqual(original.connections);
    expect(migrated.settings).toEqual(original.settings);
    expect(migrated.timestamp).toBe(original.timestamp);
    expect(migrated.recordMetadata!.journal).toEqual(
      expect.arrayContaining(original.recordMetadata!.journal),
    );
    for (const section of [
      "documents",
      "automationLibrary",
      "databaseSettings",
      "tabGroups",
      "recycleBin",
      "colorTags",
    ])
      expect(migrated.recordMetadata!.records[`$/${section}`]).toBeDefined();
    const saves = () =>
      bridge.invoke.mock.calls.filter(
        ([cmd]) => cmd === "database_protection_save",
      );
    expect(saves()).toHaveLength(1);
    expect(saves()[0][1].expectedData).toEqual(original);
    expect(await captureCloudSyncPayload(config)).toEqual(captured);
    expect(saves()).toHaveLength(1);
    const draft = (await manager.loadDatabaseData(collection.id))!;
    draft.timestamp += 86400000;
    await manager.saveDatabaseData(collection.id, draft);
    expect(await captureCloudSyncPayload(config)).toEqual(captured);
    expect(saves()).toHaveLength(2);
  });

  it("refuses a stale materialization CAS without overwriting the concurrent body or creating export history", async () => {
    privateData.set(collection.id, {
      connections: [connection("a")],
      settings: {},
      timestamp: 1,
    });
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(
      collection.id,
      "password-slot",
      "source-unlock",
    );
    const previous = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command === "database_protection_save") {
        privateData.get(collection.id)!.connections[0].name = "Concurrent edit";
        throw new Error("Concurrent edit; refused CAS");
      }
      return previous(command, args);
    });
    await expect(
      captureCloudSyncPayload({
        ...defaultCloudSyncConfig,
        selectedItems: [`database:${collection.id}`],
        encryptBeforeSync: true,
      }),
    ).rejects.toThrow(/Concurrent/);
    expect(privateData.get(collection.id)).toEqual({
      connections: [{ ...connection("a"), name: "Concurrent edit" }],
      settings: {},
      timestamp: 1,
    });
  });

  it("syncs repeated disjoint database saves from a sparse uploader and restored peer without recurring history conflicts", async () => {
    privateData.set(collection.id, {
      connections: [connection("a"), connection("b")],
      settings: {},
      timestamp: Date.parse("2026-10-01T00:00:00Z"),
    });
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(
      collection.id,
      "password-slot",
      "source-unlock",
    );
    const config = {
      ...defaultCloudSyncConfig,
      selectedItems: [`database:${collection.id}`],
      encryptBeforeSync: true,
      syncEncryptionPassword: PASSWORD,
      compressionEnabled: false,
      conflictResolution: "smartMerge" as const,
    };
    const target = {
      id: "materialization-regression",
      label: "Fixture",
      provider: "nextcloud" as const,
      enabled: true,
    };
    let remote: string | null = null;
    let revision = 0;
    const previous = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command === "cloud_sync_read")
        return { data: remote, revision: remote ? String(revision) : null };
      if (command === "cloud_sync_write") {
        expect(args.expectedRevision).toBe(remote ? String(revision) : null);
        remote = args.data;
        return { revision: String(++revision) };
      }
      return previous(command, args);
    });
    await runCloudSync(target, config);
    for (let round = 1; round <= 2; round++) {
      const peer = (await decodeCloudSnapshot(remote!, config)).payload;
      const archive = peer.sections[`database:${collection.id}`] as Awaited<
        ReturnType<typeof manager.readFullDatabaseArchive>
      >;
      const local = (await manager.loadDatabaseData(collection.id))!;
      local.connections[0].name = `Local ${round}`;
      local.timestamp += round * 86400000;
      await manager.saveDatabaseData(collection.id, local);
      archive.connections[1].name = `Remote ${round}`;
      archive.recordMetadata = await reconcileRecordLedger(
        fullDatabaseArchiveData(archive),
        archive.recordMetadata,
        { mode: "write", now: `2026-10-0${round + 1}T00:00:00.000Z` },
      );
      const localHistory = structuredClone(
        privateData.get(collection.id)!.recordMetadata!.journal,
      );
      const remoteHistory = structuredClone(archive.recordMetadata.journal);
      remote = await encodeCloudSnapshot(
        {
          format: "sortofremoteng-cloud-sync",
          version: 1,
          modifiedAt: Date.now(),
          payload: peer,
        },
        config,
      );
      revision++;
      await runCloudSync(target, config);
      const saved = privateData.get(collection.id)!;
      expect(saved.connections.map((row) => row.name)).toEqual([
        `Local ${round}`,
        `Remote ${round}`,
      ]);
      expect(saved.recordMetadata!.journal).toEqual(
        expect.arrayContaining([...localHistory, ...remoteHistory]),
      );
      const before = revision;
      const history = structuredClone(saved.recordMetadata);
      await expect(runCloudSync(target, config)).resolves.toContain(
        "already up to date",
      );
      expect(revision).toBe(before);
      expect(privateData.get(collection.id)!.recordMetadata).toEqual(history);
    }
  });

  it("captures a database-local SSH source for sync and rebinds it on protected archive restore", async () => {
    const source = privateData.get(collection.id)!;
    source.connections[2].security = {
      tunnelChain: [
        {
          id: "inline-ssh",
          type: "ssh-tunnel",
          enabled: true,
          sshTunnel: {
            connectionId: "host",
            ownerDatabaseId: collection.id,
            forwardType: "local",
          },
        },
      ],
    };
    const original = structuredClone(source);
    const encrypted = await exported();
    const manager = DatabaseManager.getInstance();
    const captured = await captureCloudSyncPayload({
      ...defaultCloudSyncConfig,
      selectedItems: [`database:${collection.id}`],
      encryptBeforeSync: true,
    });
    expect(await upgradeCloudSyncPayload(captured)).toEqual(captured);
    const restored = await manager.importDatabase(encrypted, {
      importPassword: PASSWORD,
      collectionName: "Restored inline SSH database",
      protectionTarget: target,
    });
    expect(restored.id).not.toBe(collection.id);
    expect(
      privateData.get(restored.id)!.connections[2].security!.tunnelChain![0]
        .sshTunnel,
    ).toEqual({
      connectionId: "host",
      ownerDatabaseId: restored.id,
      forwardType: "local",
    });
    expect(privateData.get(collection.id)).toMatchObject(original);
  });

  it("round trips the intended cloud body and trust without export-time or local-label drift", async () => {
    rows[0].name = "Actual local display name";
    rows[0].description = "Local description that is not the database ID";
    await exported();
    const manager = DatabaseManager.getInstance();
    const key = `database:${collection.id}`;
    const config = {
      ...defaultCloudSyncConfig,
      selectedItems: [key],
      encryptBeforeSync: true,
    };
    const original = await captureCloudSyncPayload(config);
    const incoming = structuredClone(original);
    const archive = incoming.sections[key] as Awaited<
      ReturnType<typeof manager.readFullDatabaseArchive>
    >;
    archive.connections[0].name = "Remote update";
    archive.recordMetadata = await reconcileRecordLedger(
      fullDatabaseArchiveData(archive),
      archive.recordMetadata,
      { mode: "write" },
    );
    let savedTrust = structuredClone(trust);
    const previous = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command === "database_protection_save") {
        expect(args.expectedData).toEqual(privateData.get(collection.id));
        privateData.set(collection.id, structuredClone(args.data));
        return {
          committed: true,
          securityRevision: collection.securityRevision,
          warnings: [],
          cleanupPending: false,
        };
      }
      if (command === "trust_import_database") {
        expect(args.expectedDocument).toEqual(savedTrust);
        savedTrust = structuredClone(args.document);
        return { imported: savedTrust.records.length, skipped: 0 };
      }
      if (command === "trust_export_database")
        return structuredClone(savedTrust);
      return previous(command, args);
    });
    await applyCloudSyncPayload(incoming, config, original);
    const recaptured = await captureCloudSyncPayload(config);
    expect(recaptured).toEqual(await upgradeCloudSyncPayload(incoming));
    expect(await manager.getDatabase(collection.id)).toMatchObject({
      name: "Actual local display name",
      description: "Local description that is not the database ID",
    });
  });
  it("restores a cloud archive to its exact unlocked owner with the captured body baseline", async () => {
    await exported();
    const manager = DatabaseManager.getInstance();
    const original = await manager.readFullDatabaseArchive(collection.id);
    const incoming = structuredClone(original);
    incoming.connections[0].name = "Cloud update";
    incoming.recordMetadata = await reconcileRecordLedger(
      fullDatabaseArchiveData(incoming),
      incoming.recordMetadata,
      { mode: "write" },
    );
    incoming.collection.exportDate = "1970-01-01T00:00:00.000Z";
    incoming.timestamp = 0;
    const save = vi.spyOn(manager, "saveDatabaseData").mockResolvedValue();
    await manager.restoreCloudSyncArchive(collection.id, incoming, original);
    expect(save).toHaveBeenCalledWith(
      collection.id,
      expect.objectContaining({ connections: incoming.connections }),
      undefined,
      undefined,
      {
        expectedData: privateData.get(collection.id),
        recordMetadataMode: "adopt",
      },
    );
    expect(bridge.invoke).toHaveBeenCalledWith(
      "trust_import_database",
      expect.objectContaining({ databaseId: collection.id, mode: "replace" }),
    );
  });

  it("rejects cloud edits with stale record metadata before writing body or trust", async () => {
    await exported();
    const manager = DatabaseManager.getInstance();
    const original = await manager.readFullDatabaseArchive(collection.id);
    const incoming = structuredClone(original);
    incoming.connections[0].name = "Untracked remote edit";
    const save = vi.spyOn(manager, "saveDatabaseData");
    bridge.invoke.mockClear();
    await expect(
      manager.restoreCloudSyncArchive(collection.id, incoming, original),
    ).rejects.toThrow(/record metadata does not match/);
    expect(save).not.toHaveBeenCalled();
    expect(
      bridge.invoke.mock.calls.some(
        ([command]) => command === "trust_import_database",
      ),
    ).toBe(false);
  });

  it("rejects a stale cloud snapshot without writing", async () => {
    await exported();
    const manager = DatabaseManager.getInstance();
    const original = await manager.readFullDatabaseArchive(collection.id);
    privateData.get(collection.id)!.connections[0].name = "New local edit";
    const save = vi.spyOn(manager, "saveDatabaseData");
    await expect(
      manager.restoreCloudSyncArchive(collection.id, original, original),
    ).rejects.toThrow(/changed/);
    expect(save).not.toHaveBeenCalled();
  });

  it("uses native managed CAS for cloud writes and rejects a raced body", async () => {
    await exported();
    const manager = DatabaseManager.getInstance();
    const original = await manager.readFullDatabaseArchive(collection.id);
    const previous = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command === "database_protection_save") {
        expect(args.expectedData).toEqual(privateData.get(collection.id));
        expect(args.databaseId).toBe(collection.id);
        return {
          committed: false,
          securityRevision: collection.securityRevision,
          warnings: [],
          cleanupPending: false,
        };
      }
      return previous(command, args);
    });
    await expect(
      manager.restoreCloudSyncArchive(collection.id, original, original),
    ).rejects.toThrow(/not committed/);
    expect(
      bridge.invoke.mock.calls.filter(
        ([command]) => command === "trust_import_database",
      ),
    ).toHaveLength(0);
  });

  it("reports partial when the native body committed but save finalization rejects its revision", async () => {
    await exported();
    const manager = DatabaseManager.getInstance();
    const original = await manager.readFullDatabaseArchive(collection.id);
    const previous = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockClear().mockImplementation(async (command, args) => {
      if (command === "database_protection_save") {
        privateData.set(collection.id, structuredClone(args.data));
        return {
          committed: true,
          securityRevision: "unexpected-revision",
          warnings: [],
          cleanupPending: false,
        };
      }
      return previous(command, args);
    });
    await expect(
      manager.restoreCloudSyncArchive(collection.id, original, original),
    ).rejects.toMatchObject({ kind: "partial" });
    expect(
      bridge.invoke.mock.calls.filter(
        ([command]) => command === "database_protection_save",
      ),
    ).toHaveLength(1);
    expect(
      bridge.invoke.mock.calls.some(
        ([command]) => command === "trust_import_database",
      ),
    ).toBe(false);
  });

  it("rejects wrong database ownership and timestamp-only differences do not cause conflicts", async () => {
    await exported();
    const manager = DatabaseManager.getInstance();
    const original = await manager.readFullDatabaseArchive(collection.id);
    const expected = structuredClone(original);
    expected.timestamp = 0;
    expected.collection.exportDate = "1970-01-01T00:00:00.000Z";
    const save = vi.spyOn(manager, "saveDatabaseData").mockResolvedValue();
    await manager.restoreCloudSyncArchive(collection.id, original, expected);
    expect(save).toHaveBeenCalledTimes(1);
    const wrong = structuredClone(original);
    wrong.collection.id = "another-database";
    await expect(
      manager.restoreCloudSyncArchive(collection.id, wrong, expected),
    ).rejects.toThrow();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("reports partial cloud restore when trust fails without rolling back the body", async () => {
    await exported();
    const manager = DatabaseManager.getInstance();
    const original = await manager.readFullDatabaseArchive(collection.id);
    const save = vi
      .spyOn(manager, "saveDatabaseData")
      .mockImplementation(async () => {
        trustFailure = true;
      });
    await expect(
      manager.restoreCloudSyncArchive(collection.id, original, original),
    ).rejects.toMatchObject({
      kind: "partial",
      message: expect.stringMatching(/body was saved.*trust/),
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("exports and restores a full protected database with source ownership rebinding and strict trust replacement", async () => {
    const manager = DatabaseManager.getInstance();
    privateData.get(collection.id)!.connections[2].password = "***ENCRYPTED***";
    privateData.get(collection.id)!.connections[2].basicAuthPassword =
      "***ENCRYPTED***";
    privateData.get(collection.id)!.connections[2].rdpSettings = {
      gateway: {
        password: "portable-gateway-password",
        accessToken: "PRIVATE_GATEWAY_TOKEN",
      },
    };
    const encrypted = await exported();
    const archive = JSON.parse(await decryptWithPassword(encrypted, PASSWORD));
    expect(archive.format).toBe("sorng-full-database");
    const restored = await manager.importDatabase(encrypted, {
      importPassword: PASSWORD,
      protectionTarget: target,
    });
    expect(restored).toMatchObject({
      isEncrypted: true,
      protectionFormat: "sorng-db",
    });
    expect(restored.id).not.toBe(collection.id);
    const data = await manager.loadDatabaseData(restored.id);
    expect(data?.connections).toHaveLength(3);
    expect(data?.connections[2].password).toBe("***ENCRYPTED***");
    expect(data?.connections[2].basicAuthPassword).toBe("***ENCRYPTED***");
    expect(data?.connections[2].rdpSettings?.gateway).toEqual({
      password: "portable-gateway-password",
    });
    expect(data?.credentialVault?.entries[0]).toMatchObject({
      id: VAULT_ID,
      facets: { password: "PRIVATE_VAULT_PASSWORD" },
    });
    expect(
      data?.credentialVault?.entries[0].facets.deviceTrust,
    ).toBeUndefined();
    expect(data?.connections[1].sshQuickActions?.items[0].scope).toEqual({
      kind: "database",
      databaseId: restored.id,
    });
    expect(
      data?.recycleBin?.entries[0].connection.sshQuickActions?.items[0].scope,
    ).toEqual({ kind: "database", databaseId: restored.id });
    expect(data?.documents?.documents[0].blocks[2]).toMatchObject({
      reference: { databaseId: restored.id, id: "host" },
    });
    expect(data?.documents?.attachments).toEqual(archive.documents.attachments);
    expect(data?.automationLibrary).toEqual(archive.automationLibrary);
    expect(bridge.invoke).toHaveBeenCalledWith("trust_import_database", {
      databaseId: restored.id,
      document: trust,
      mode: "replace",
    });
    for (const [, args] of bridge.invoke.mock.calls.filter(
      ([cmd]) => cmd === "save_database_data",
    )) {
      expect(args.data).toMatchObject({ connections: [], settings: {} });
      expect(JSON.stringify(args)).not.toMatch(
        /PRIVATE_|credentialVault|documents/,
      );
    }
    expect(data).not.toHaveProperty("format");
    expect(data).not.toHaveProperty("collection");
  });

  it("requires encryption and managed protection before creating any destination", async () => {
    const archive = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      trust,
    );
    const encrypted = await encryptFullDatabaseArchive(archive, PASSWORD, {
      iterations: 10000,
    });
    const manager = DatabaseManager.getInstance();
    const create = vi.spyOn(manager, "createDatabase");
    await expect(
      manager.importDatabase(JSON.stringify(archive), {
        protectionTarget: target,
        importPassword: PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "protection" });
    await expect(
      manager.importDatabase(encrypted, {
        importPassword: PASSWORD,
        encryptPassword: "legacy-password",
      }),
    ).rejects.toMatchObject({ code: "protection" });
    await expect(
      manager.importDatabase(encrypted, {
        importPassword: PASSWORD,
        protectionTarget: target,
        includeTrust: false,
      }),
    ).rejects.toMatchObject({ code: "protection" });
    await expect(
      manager.exportFullDatabaseArchive(collection.id, ""),
    ).rejects.toMatchObject({ code: "password" });
    expect(create).not.toHaveBeenCalled();
  });

  it("validates all private sections before destination creation, including wrong password and tampered attachments", async () => {
    const archive = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      trust,
    );
    const encrypted = await encryptFullDatabaseArchive(archive, PASSWORD, {
      iterations: 10000,
    });
    archive.documents.attachments[0].sha256 = "0".repeat(64);
    const corrupted = await encryptWithPassword(
      JSON.stringify(archive),
      PASSWORD,
      { iterations: 10000 },
    );
    const manager = DatabaseManager.getInstance();
    const create = vi.spyOn(manager, "createDatabase");
    await expect(
      manager.importDatabase(corrupted, {
        importPassword: PASSWORD,
        protectionTarget: target,
      }),
    ).rejects.toMatchObject({ code: "format" });
    await expect(
      manager.importDatabase(encrypted, {
        importPassword: "wrong",
        protectionTarget: target,
      }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps the old generic vault guards and plaintext document rejection", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(
      collection.id,
      "password-slot",
      "source-unlock",
    );
    await expect(
      manager.readExportableDatabaseSnapshot(collection.id, true),
    ).rejects.toThrow("cannot carry");
    await expect(
      manager.appendConnectionsToDatabase(collection.id, [
        {
          ...connection("orphan"),
          credentialSource: { kind: "vault", credentialId: VAULT_ID },
        },
      ]),
    ).rejects.toThrow("cannot carry");
    await expect(
      manager.importDatabase(
        JSON.stringify({ collection: { name: "Plain" }, credentialVault: {} }),
      ),
    ).rejects.toThrow("cannot carry");
    await expect(
      manager.importDatabase(
        JSON.stringify({
          collection: { name: "Plain" },
          documents: (await fullData()).documents,
        }),
      ),
    ).rejects.toThrow("encrypted source");
    expect(rows).toHaveLength(1);
  });

  it("never reports full success when trust is unavailable, and does not log secret backend errors", async () => {
    const encrypted = await exported();
    const manager = DatabaseManager.getInstance();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    trustFailure = true;
    await expect(
      manager.readFullDatabaseArchive(collection.id),
    ).rejects.toMatchObject({ code: "trust" });
    await expect(
      manager.importDatabase(encrypted, {
        importPassword: PASSWORD,
        protectionTarget: target,
      }),
    ).rejects.toMatchObject({
      name: "FullDatabaseRestoreIncompleteError",
      databaseId: expect.any(String),
      message: expect.stringContaining("not a complete restore"),
    });
    expect(rows).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "does not load or repopulate an evicted plaintext source during metadata read (full=%s)",
    async (fullDatabase) => {
      rows[0] = {
        ...collection,
        isEncrypted: false,
        protectionFormat: undefined,
      };
      payloads.set(collection.id, {
        connections: [],
        settings: {},
        timestamp: 1,
      });
      const manager = DatabaseManager.getInstance();
      await manager.selectDatabase(collection.id);
      let complete!: (value: ConnectionDatabase) => void;
      vi.spyOn(manager, "getDatabase").mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      const load = vi.spyOn(manager, "loadDatabaseData");
      const operation = manager.readMemoryResidentDatabaseSnapshot(
        collection.id,
        true,
        { fullDatabase },
      );
      const rejected = expect(operation).rejects.toThrow("access expired");
      await manager.lockDatabase(collection.id);
      complete(rows[0]);
      await rejected;
      expect(load).not.toHaveBeenCalled();
      expect(() =>
        manager.captureDatabaseOperationGuard([collection.id]),
      ).toThrow("no longer available");
    },
  );

  it("rejects a stale source guard after eviction and reopen without reading payloads", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(
      collection.id,
      "password-slot",
      "source-unlock",
    );
    await manager.selectDatabase(collection.id);
    const guard = manager.captureDatabaseOperationGuard([collection.id]);
    const load = vi.spyOn(manager, "loadDatabaseData");
    await guard.verifyCurrent();
    guard.assertCurrent();
    expect(load).not.toHaveBeenCalled();
    manager.invalidatePendingDatabaseOperations();
    await manager.unlockManagedDatabase(
      collection.id,
      "password-slot",
      "source-unlock",
    );
    await manager.selectDatabase(collection.id);
    expect(() => guard.assertCurrent()).toThrow();
    await expect(guard.verifyCurrent()).rejects.toThrow();
    expect(() =>
      manager.captureDatabaseOperationGuard([collection.id]).assertCurrent(),
    ).not.toThrow();
  });

  it.each([false, true])(
    "allows a nonresident exportable source with a current database (encrypted=%s)",
    async (encrypted) => {
      const manager = await openPlainDatabase();
      const other = {
        ...collection,
        id: "other",
        isEncrypted: encrypted,
        protectionFormat: encrypted ? collection.protectionFormat : undefined,
      };
      rows.push(other);
      const data = { connections: [], settings: {}, timestamp: 1 };
      payloads.set(other.id, data);
      privateData.set(other.id, data);
      if (encrypted)
        await manager.unlockManagedDatabase(
          other.id,
          "password-slot",
          "other-unlock",
        );
      expect(
        (await manager.getMemoryResidentDatabases()).map((row) => row.id),
      ).not.toContain(other.id);
      const guard = manager.captureDatabaseOperationGuard([other.id]);
      const load = vi.spyOn(manager, "loadDatabaseData");
      await guard.verifyCurrent();
      guard.assertCurrent();
      expect(load).not.toHaveBeenCalled();
      const snapshot = await manager.readExportableDatabaseSnapshot(
        other.id,
        true,
      );
      expect(snapshot.connections).toEqual([]);
      await guard.verifyCurrent();
      guard.assertCurrent();
      rows.find((row) => row.id === other.id)!.securityRevision =
        "changed-revision";
      await expect(guard.verifyCurrent()).rejects.toThrow("security changed");
    },
  );

  it("requires residency without a current database, including explicitly unlocked sources", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(
      collection.id,
      "password-slot",
      "source-unlock",
    );
    expect(() =>
      manager.captureDatabaseOperationGuard([collection.id]),
    ).toThrow("no longer available");
    rows.push({
      ...collection,
      id: "unopened-plain",
      isEncrypted: false,
      protectionFormat: undefined,
    });
    expect(() =>
      manager.captureDatabaseOperationGuard(["unopened-plain"]),
    ).toThrow("no longer available");
  });

  it("rejects locked or missing sources during metadata verification without loading data", async () => {
    const manager = await openPlainDatabase();
    rows.push({ ...collection, id: "locked-other" });
    const load = vi.spyOn(manager, "loadDatabaseData");
    for (const id of ["locked-other", "missing"])
      await expect(
        manager.captureDatabaseOperationGuard([id]).verifyCurrent(),
      ).rejects.toThrow("unavailable or locked");
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects a source lock while its first metadata verification is pending", async () => {
    const manager = await openPlainDatabase();
    const other = { ...rows[0], id: "other" };
    rows.push(other);
    const guard = manager.captureDatabaseOperationGuard([other.id]);
    let complete!: (value: ConnectionDatabase) => void;
    vi.spyOn(manager, "getDatabase").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const load = vi.spyOn(manager, "loadDatabaseData");
    const verified = expect(guard.verifyCurrent()).rejects.toThrow(
      "access expired",
    );
    await manager.lockDatabase(other.id);
    complete(other);
    await verified;
    expect(load).not.toHaveBeenCalled();
  });

  it.each(["switch-back", "close-reopen", "dispose"])(
    "rejects a workspace %s after guard capture",
    async (action) => {
      const manager = await openPlainDatabase();
      const guard = manager.captureDatabaseOperationGuard([collection.id]);
      await guard.verifyCurrent();
      if (action === "switch-back") {
        rows.push({ ...rows[0], id: "other" });
        payloads.set("other", { connections: [], settings: {}, timestamp: 1 });
        await manager.selectDatabase("other");
        await manager.selectDatabase(collection.id);
      } else if (action === "close-reopen") {
        await manager.closeCurrentDatabase();
        await manager.selectDatabase(collection.id);
      } else {
        DatabaseManager.resetInstance();
      }
      expect(() => guard.assertCurrent()).toThrow("operation expired");
      await expect(guard.verifyCurrent()).rejects.toThrow("operation expired");
    },
  );
});
