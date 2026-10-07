import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DatabaseManager,
  onCurrentDatabaseChange,
} from "../../src/utils/connection/databaseManager";
import {
  buildFullDatabaseArchive,
  FullDatabaseRestoreIncompleteError,
  type FullDatabaseArchive,
} from "../../src/utils/connection/fullDatabaseArchive";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { stableJsonStringify } from "../../src/utils/core/stableJsonStringify";
import { validateCloudSyncPayload } from "../../src/utils/services/cloudSyncPayload";
import type { ConnectionDatabase } from "../../src/types/connection/connection";
import type { StorageData } from "../../src/utils/storage/storage";
import type {
  DatabaseProtectionCapabilities,
  DatabaseProtectionTarget,
} from "../../src/types/encryption/databaseProtection";
import {
  collection,
  fullData,
  trust,
  VAULT_ID,
} from "../fixtures/fullDatabaseArchive";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), available: true }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (bridge.available ? bridge.invoke : null),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

let rows: ConnectionDatabase[];
let payloads: Map<string, unknown>;
let privateData: Map<string, StorageData>;
let issuedSessionExpiries: Map<string, number>;
let archive: FullDatabaseArchive;
let capabilities: DatabaseProtectionCapabilities;
let target: DatabaseProtectionTarget;
let expireSession: boolean;
let raceIndex: boolean;
let raceBody: boolean;
let failCommand: string | undefined;
let trustResult: { imported: number; skipped: number };

const clone = <T>(value: T): T => structuredClone(value);
const equal = (a: unknown, b: unknown) =>
  stableJsonStringify(a) === stableJsonStringify(b);
const mutationCommands = new Set([
  "databases_save_index",
  "save_database_data",
  "database_protection_change",
  "trust_import_database",
  "database_delete",
  "delete_database",
]);
const mutations = () =>
  bridge.invoke.mock.calls.filter(([command]) => mutationCommands.has(command));
const options = () => ({ name: "Pulled database", protectionTarget: target });
const pull = (
  extra: Partial<
    Parameters<DatabaseManager["importCloudSyncDatabase"]>[1]
  > = {},
) =>
  DatabaseManager.getInstance().importCloudSyncDatabase(archive, {
    ...options(),
    ...extra,
  });

beforeEach(async () => {
  DatabaseManager.resetInstance();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  bridge.available = true;
  vi.spyOn(SettingsManager.prototype, "logAction").mockImplementation(
    async () => undefined,
  );
  archive = await buildFullDatabaseArchive(collection, await fullData(), trust);
  rows = [];
  payloads = new Map();
  privateData = new Map();
  issuedSessionExpiries = new Map();
  expireSession = false;
  raceIndex = false;
  raceBody = false;
  failCommand = undefined;
  trustResult = { imported: trust.records.length, skipped: 0 };
  capabilities = {
    schemaVersion: 1,
    ciphers: [{ id: "aes-256-gcm", available: true }],
    protectors: [
      {
        id: "password",
        available: true,
        deviceBound: false,
        requiresUserPresence: false,
      },
      {
        id: "os-vault",
        available: true,
        deviceBound: true,
        requiresUserPresence: false,
      },
    ],
  };
  target = {
    dataCipher: "aes-256-gcm",
    keepSlotIds: [],
    newSlots: [
      {
        type: "password",
        label: "Local password",
        password: "Local-password-123!",
      },
    ],
  };
  bridge.invoke.mockImplementation(
    async (command: string, args: Record<string, any> = {}) => {
      if (command === failCommand) throw new Error("PRIVATE_NATIVE_FAILURE");
      if (command === "database_protection_capabilities")
        return clone(capabilities);
      if (command === "database_browser_sessions_describe")
        return clone(
          privateData.get(args.databaseId)?.browserSessions ?? {
            version: 1,
            records: [],
          },
        );
      if (command === "encryption_validate_new_password") {
        if (args.password.length < 12)
          throw new Error("Use at least 12 characters.");
        return;
      }
      if (command === "databases_list")
        return { value: clone(rows), source: "current" };
      if (command === "databases_save_index") {
        if (raceIndex) rows.push({ ...collection, name: "Concurrent winner" });
        if (!equal(args.expectedList, rows))
          throw new Error("Database index changed; reload before retrying.");
        expect(
          new Set(args.list.map((row: ConnectionDatabase) => row.id)).size,
        ).toBe(args.list.length);
        rows = clone(args.list);
        return;
      }
      if (command === "load_database_data")
        return payloads.has(args.databaseId)
          ? { value: clone(payloads.get(args.databaseId)), source: "current" }
          : null;
      if (command === "save_database_data") {
        if (raceBody)
          payloads.set(args.databaseId, {
            connections: [],
            settings: { winner: true },
            timestamp: 5,
          });
        if (!equal(args.expectedData, payloads.get(args.databaseId) ?? null))
          throw new Error("Database contents changed; reload before saving.");
        payloads.set(args.databaseId, clone(args.data));
        return;
      }
      if (command === "database_protection_change") {
        const stored = payloads.get(args.databaseId) as StorageData;
        const row = rows.find((entry) => entry.id === args.databaseId)!;
        expect(args.expectedData).toEqual(stored);
        expect(args.expectedSecurityRevision).toBe(row.securityRevision ?? "");
        expect(args.initializeEmptyDestination).toBe(true);
        // Match native's exact-empty check, not a permissive mock that accepts
        // a record ledger or plaintext private data in the placeholder.
        expect(stored).toEqual({
          connections: [],
          settings: {},
          timestamp: expect.any(Number),
        });
        expect(row.isEncrypted).toBe(false);
        row.isEncrypted = true;
        row.protectionFormat = "sorng-db";
        row.securityRevision = "local-security-revision";
        privateData.set(row.id, clone(args.legacyVerifiedData));
        payloads.set(
          row.id,
          JSON.stringify({
            format: "sorng-db",
            version: 1,
            ciphertext: "opaque-native-ciphertext",
          }),
        );
        const sessionExpiresAt = Date.now() + (expireSession ? -1000 : 900000);
        issuedSessionExpiries.set(row.id, sessionExpiresAt);
        return {
          committed: true,
          cleanupPending: false,
          warnings: [],
          securityRevision: row.securityRevision,
          sessionId: "local-native-session",
          sessionExpiresAt,
        };
      }
      if (command === "database_protection_load")
        return {
          sessionId: "local-native-session",
          sessionExpiresAt: issuedSessionExpiries.get(args.databaseId),
          securityRevision: rows.find((row) => row.id === args.databaseId)
            ?.securityRevision,
          data: clone(privateData.get(args.databaseId)),
        };
      if (command === "trust_import_database") return clone(trustResult);
      if (command === "trust_export_database") return clone(trust);
      if (command === "database_protection_release_session")
        return { released: true };
      return undefined;
    },
  );
});
afterEach(() => DatabaseManager.resetInstance());

describe("remote-only cloud database import", () => {
  it.each([true, false])(
    "passes the cloud password/capsule to one atomic import after empty enrollment (commit=%s)",
    async (commit) => {
      archive.browserSessions = {
        version: 1,
        records: [{ connectionId: "host", revision: "a".repeat(64) }],
      };
      archive.browserSessionsTransfer = {
        version: 1,
        ciphertext: "SYNTHETIC_REMOTE_CAPSULE",
      };
      const before = bridge.invoke.getMockImplementation()!;
      bridge.invoke.mockImplementation(async (command, args) => {
        if (command === "database_browser_sessions_import") {
          expect(args.password).toBe("remote-sync-password");
          expect(args.transfer).toEqual(archive.browserSessionsTransfer);
          expect(args.expected).toEqual({ version: 1, records: [] });
          expect(args.expectedData).toEqual(privateData.get(collection.id));
          expect(args.expectedData.connections).toEqual([]);
          expect(args.selected).toEqual(archive.browserSessions);
          if (!commit) throw new Error("SYNTHETIC_AUTHENTICATION_FAILURE");
          privateData.set(collection.id, clone(args.data));
          return {
            committed: true,
            cleanupPending: false,
            warnings: [],
            securityRevision: "local-security-revision",
          };
        }
        return before(command, args);
      });
      const pending = pull({ browserSessionsPassword: "remote-sync-password" });
      if (commit) {
        expect((await pending).id).toBe(collection.id);
        expect(privateData.get(collection.id)!.browserSessions).toEqual(
          archive.browserSessions,
        );
      } else {
        await expect(pending).rejects.toBeInstanceOf(
          FullDatabaseRestoreIncompleteError,
        );
        expect(privateData.get(collection.id)!.connections).toEqual([]);
        expect(
          bridge.invoke.mock.calls.some(
            ([cmd]) => cmd === "trust_import_database",
          ),
        ).toBe(false);
      }
      const commands = bridge.invoke.mock.calls.map(([cmd]) => cmd);
      expect(
        commands.filter((cmd) => cmd === "database_browser_sessions_import"),
      ).toHaveLength(1);
      expect(commands).not.toContain("database_protection_save");
      expect(commands.indexOf("database_protection_change")).toBeLessThan(
        commands.indexOf("database_browser_sessions_import"),
      );
    },
  );

  it("retains sync identity, complete contents, references and remote record history", async () => {
    const original = clone(archive);
    const created = await pull({ name: "  Local display name  " });
    expect(created).toMatchObject({
      id: collection.id,
      name: "Local display name",
      isEncrypted: true,
      protectionFormat: "sorng-db",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(collection.id);
    const data = privateData.get(collection.id)!;
    expect(data.recordMetadata).toEqual(archive.recordMetadata);
    expect(data.connections).toEqual(archive.connections);
    expect(data.connections[1].sshQuickActions?.items[0].scope).toEqual({
      kind: "database",
      databaseId: collection.id,
    });
    expect(data.documents?.documents[0].blocks[2]).toMatchObject({
      reference: { databaseId: collection.id, id: "host" },
    });
    expect(data.documents?.attachments).toEqual(archive.documents.attachments);
    expect(data.automationLibrary).toEqual(archive.automationLibrary);
    expect(data.credentialVault?.entries[0]).toMatchObject({
      id: VAULT_ID,
      facets: { password: "PRIVATE_VAULT_PASSWORD" },
    });
    expect(data.credentialVault?.entries[0].facets).not.toHaveProperty(
      "deviceTrust",
    );
    expect(data).not.toHaveProperty("collection");
    expect(data).not.toHaveProperty("format");
    expect(archive).toEqual(original);
    expect(bridge.invoke).toHaveBeenCalledWith("trust_import_database", {
      databaseId: collection.id,
      document: trust,
      mode: "replace",
    });
  });

  it("writes only an empty placeholder outside the native protection transaction", async () => {
    await pull();
    const plainWrites = bridge.invoke.mock.calls.filter(
      ([command]) => command === "save_database_data",
    );
    expect(plainWrites).toHaveLength(1);
    expect(plainWrites[0][1]).toEqual({
      databaseId: collection.id,
      expectedData: null,
      expectedSecurityRevision: "",
      data: { connections: [], settings: {}, timestamp: expect.any(Number) },
    });
    expect(JSON.stringify(plainWrites)).not.toMatch(
      /PRIVATE_|credentialVault|documents|recordMetadata/,
    );
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_protection_change",
      expect.objectContaining({
        databaseId: collection.id,
        target,
        initializeEmptyDestination: true,
        legacyVerifiedData: expect.objectContaining({
          connections: archive.connections,
        }),
      }),
    );
    expect(payloads.get(collection.id)).toContain("opaque-native-ciphertext");
    expect(JSON.stringify(payloads.get(collection.id))).not.toMatch(
      /PRIVATE_|Local-password/,
    );
  });

  it("recaptures an identical cloud snapshot after native storage is read again", async () => {
    await pull();
    // Loading later must reuse the issued lease, not issue a refreshed expiry.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
    const manager = DatabaseManager.getInstance();
    const recaptured = await manager.readFullDatabaseArchive(collection.id);
    const canonicalPayload = (value: FullDatabaseArchive) =>
      validateCloudSyncPayload({
        version: 1,
        sections: { [`database:${collection.id}`]: value },
      });
    expect(canonicalPayload(recaptured)).toEqual(canonicalPayload(archive));
    expect(recaptured.recordMetadata).toEqual(archive.recordMetadata);
    expect(manager.getCurrentDatabase()).toBeNull();
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_protection_load",
      expect.objectContaining({ databaseId: collection.id }),
    );
  });

  it("does not switch or close the current database or its active trust scope", async () => {
    const manager = DatabaseManager.getInstance();
    rows.push({
      ...collection,
      id: "local-db",
      isEncrypted: false,
      protectionFormat: undefined,
      securityRevision: undefined,
    });
    payloads.set("local-db", { connections: [], settings: {}, timestamp: 1 });
    await manager.selectDatabase("local-db");
    const active = manager.getCurrentDatabase();
    await Promise.resolve();
    bridge.invoke.mockClear();
    const listener = vi.fn();
    const unsubscribe = onCurrentDatabaseChange(listener);
    try {
      await pull();
      expect(manager.getCurrentDatabase()).toBe(active);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "create",
          database: active,
          databaseId: collection.id,
        }),
      );
      expect(
        bridge.invoke.mock.calls.map(([command]) => command),
      ).not.toContain("trust_set_active_database");
      expect(
        bridge.invoke.mock.calls.map(([command]) => command),
      ).not.toContain("database_protection_lock");
      expect(rows).toHaveLength(2);
    } finally {
      unsubscribe();
    }
  });

  it("refuses existing identities before publishing any row or touching their body", async () => {
    rows.push(clone(collection));
    payloads.set(collection.id, "existing protected data");
    await expect(pull()).rejects.toThrow(/already exists/);
    expect(mutations()).toEqual([]);
    expect(bridge.invoke.mock.calls.map(([command]) => command)).not.toContain(
      "load_database_data",
    );
    expect(rows).toEqual([collection]);
  });

  it.each(["current", "backup"])(
    "refuses unindexed %s database files before publishing a row",
    async (source) => {
      const invoke = bridge.invoke.getMockImplementation()!;
      bridge.invoke.mockImplementation(async (command, args) =>
        command === "load_database_data"
          ? { value: "opaque-orphan", source }
          : invoke(command, args),
      );
      await expect(pull()).rejects.toThrow(/files already exist/);
      expect(rows).toEqual([]);
      expect(mutations()).toEqual([]);
    },
  );

  it("uses native index CAS to reject a same-ID race without a duplicate or body write", async () => {
    raceIndex = true;
    await expect(pull()).rejects.toThrow(/index changed/);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Concurrent winner");
    expect(mutations().map(([command]) => command)).toEqual([
      "databases_save_index",
    ]);
    expect(payloads.size).toBe(0);
  });

  it("preserves a raced body and identifies the partially created database", async () => {
    raceBody = true;
    await expect(pull()).rejects.toMatchObject({
      name: "FullDatabaseRestoreIncompleteError",
      databaseId: collection.id,
      kind: "partial",
      message: expect.stringMatching(/initialization did not finish/),
    });
    expect(payloads.get(collection.id)).toEqual({
      connections: [],
      settings: { winner: true },
      timestamp: 5,
    });
    expect(mutations().map(([command]) => command)).toEqual([
      "databases_save_index",
      "save_database_data",
    ]);
  });

  it("checks caller cancellation after the last read, immediately before index CAS", async () => {
    let current = true;
    const invoke = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) => {
      const result = await invoke(command, args);
      if (command === "load_database_data") current = false;
      return result;
    });
    const assertCurrent = vi.fn(() => {
      if (!current) throw new Error("Target changed");
    });
    await expect(pull({ assertCurrent })).rejects.toThrow("Target changed");
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(mutations()).toEqual([]);
  });

  it("cancels an already stale pull before native preflight", async () => {
    await expect(
      pull({
        assertCurrent: () => {
          throw new Error("Cancelled");
        },
      }),
    ).rejects.toThrow("Cancelled");
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("freezes local enrollment choices before asynchronous validation", async () => {
    const settings = options();
    const invoke = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command === "database_protection_capabilities") {
        settings.name = "Unexpected rename";
        settings.protectionTarget.newSlots = [
          { type: "os-vault", label: "Unexpected switch" },
        ];
      }
      return invoke(command, args);
    });
    const created = await DatabaseManager.getInstance().importCloudSyncDatabase(
      archive,
      settings,
    );
    expect(created.name).toBe("Pulled database");
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_protection_change",
      expect.objectContaining({
        target: expect.objectContaining({
          newSlots: [
            {
              type: "password",
              label: "Local password",
              password: "Local-password-123!",
            },
          ],
        }),
      }),
    );
  });

  it.each(["", "   ", "x".repeat(257), "bad\nname"])(
    "rejects invalid names before mutation: %j",
    async (name) => {
      await expect(pull({ name })).rejects.toThrow(/database name/);
      expect(mutations()).toEqual([]);
    },
  );

  it("rejects a path-bearing ID and invalid archive dependencies before mutation", async () => {
    archive.collection.id = "../other";
    await expect(pull()).rejects.toThrow();
    expect(mutations()).toEqual([]);
    archive = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      trust,
    );
    archive.credentialVault.entries = [];
    await expect(pull()).rejects.toMatchObject({ code: "dependencies" });
    expect(mutations()).toEqual([]);
  });

  it.each([
    { keepSlotIds: ["remote-slot"] },
    { newSlots: [] },
    { newSlots: [{ type: "biometric", label: "Unavailable" }] },
    {
      newSlots: [
        { type: "password", label: "", password: "Local-password-123!" },
      ],
    },
    { newSlots: [{ type: "password", label: "Local", password: "" }] },
    {
      newSlots: [
        {
          type: "password",
          label: "Local",
          password: "Local-password-123!",
          argon2: { memoryKib: 1, timeCost: 1, parallelism: 1 },
        },
      ],
    },
    { dataCipher: "unknown" },
  ])(
    "rejects invalid local enrollment before creation: %j",
    async (invalid) => {
      Object.assign(target, invalid);
      await expect(pull()).rejects.toMatchObject({ code: "protection" });
      expect(mutations()).toEqual([]);
    },
  );

  it("validates local password policy before creating any destination", async () => {
    target.newSlots = [{ type: "password", label: "Local", password: "short" }];
    await expect(pull()).rejects.toThrow(/12 characters/);
    expect(mutations()).toEqual([]);
  });

  it.each(["cipher", "protector"])(
    "checks unavailable %s capabilities before creation",
    async (choice) => {
      if (choice === "cipher") capabilities.ciphers[0].available = false;
      else capabilities.protectors[0].available = false;
      await expect(pull()).rejects.toThrow(/unavailable/);
      expect(mutations()).toEqual([]);
    },
  );

  it("requires native protection and has no browser fallback", async () => {
    bridge.available = false;
    await expect(pull()).rejects.toMatchObject({ code: "protection" });
    expect(mutations()).toEqual([]);
  });

  it("requires explicit device-only confirmation for fresh local OS-vault enrollment", async () => {
    target.newSlots = [{ type: "os-vault", label: "This device" }];
    await expect(pull()).rejects.toThrow(/Confirm device-bound-only/);
    expect(mutations()).toEqual([]);
    await pull({ confirmDeviceBoundOnly: true });
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_protection_change",
      expect.objectContaining({ target, confirmDeviceBoundOnly: true }),
    );
    expect(bridge.invoke.mock.calls.map(([command]) => command)).not.toContain(
      "encryption_validate_new_password",
    );
  });

  it.each([
    "save_database_data",
    "database_protection_change",
    "trust_import_database",
  ])(
    "reports a safe partial ID after %s failure, without rollback",
    async (command) => {
      failCommand = command;
      let caught: unknown;
      try {
        await pull();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(FullDatabaseRestoreIncompleteError);
      expect(caught).toMatchObject({
        databaseId: collection.id,
        kind: "partial",
        message: expect.stringMatching(/not a complete restore/),
      });
      expect((caught as Error).message).not.toContain("PRIVATE_NATIVE_FAILURE");
      expect(rows).toHaveLength(1);
      expect(mutations().some(([call]) => /delete/.test(call))).toBe(false);
      if (command === "trust_import_database")
        expect(payloads.get(collection.id)).toContain(
          "opaque-native-ciphertext",
        );
      await expect(pull()).rejects.toThrow(/already exists/);
    },
  );

  it.each([
    { imported: 0, skipped: 1 },
    { imported: 0, skipped: 0 },
  ])("does not claim complete trust restoration for %j", async (outcome) => {
    trustResult = outcome;
    await expect(pull()).rejects.toMatchObject({
      databaseId: collection.id,
      kind: "partial",
      message: expect.stringMatching(/trust restoration did not complete/),
    });
    expect(privateData.has(collection.id)).toBe(true);
  });

  it("reports native protection finalization failure as partial even if ciphertext committed", async () => {
    expireSession = true;
    await expect(pull()).rejects.toMatchObject({
      databaseId: collection.id,
      kind: "partial",
      message: expect.stringMatching(/empty or already protected/),
    });
    expect(payloads.get(collection.id)).toContain("opaque-native-ciphertext");
    expect(
      mutations().some(([command]) => command === "trust_import_database"),
    ).toBe(false);
  });
});
