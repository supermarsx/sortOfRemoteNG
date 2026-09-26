import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import {
  buildFullDatabaseArchive,
  encryptFullDatabaseArchive,
} from "../../src/utils/connection/fullDatabaseArchive";
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
