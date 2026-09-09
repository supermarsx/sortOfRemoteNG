import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  DatabaseManager,
  onCurrentDatabaseChange,
  onDatabaseAccessChange,
} from "../../src/utils/connection/databaseManager";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import type { ConnectionDatabase } from "../../src/types/connection/connection";
import type { DatabaseProtectionUnlockResult } from "../../src/types/encryption/databaseProtection";
const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  locked: undefined as
    undefined | ((event: { payload: { databaseId: string } }) => void),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => bridge.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, listener: typeof bridge.locked) => {
    bridge.locked = listener;
    return () => {
      bridge.locked = undefined;
    };
  }),
}));
let rows: ConnectionDatabase[];
let payloads: Map<string, unknown>;
let lease: DatabaseProtectionUnlockResult;
const data = { connections: [], settings: {}, timestamp: 1 };
beforeEach(() => {
  DatabaseManager.resetInstance();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.spyOn(SettingsManager.prototype, "logAction").mockImplementation(
    async () => undefined,
  );
  rows = [
    {
      id: "managed-fixture",
      name: "Managed",
      isEncrypted: true,
      protectionFormat: "sorng-db",
      securityRevision: "rev-1",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      lastAccessed: "2026-01-01",
    },
  ];
  payloads = new Map([
    [
      rows[0].id,
      JSON.stringify({
        format: "sorng-db",
        version: 1,
        ciphertext: "opaque-fixture",
      }),
    ],
  ]);
  lease = {
    sessionId: "fixture-native-handle",
    sessionExpiresAt: Date.now() + 900000,
    securityRevision: "rev-1",
    data,
  };
  bridge.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "databases_list")
        return { value: structuredClone(rows), source: "current" };
      if (command === "databases_save_index") {
        rows = structuredClone(args.list as ConnectionDatabase[]);
        return;
      }
      if (command === "save_database_data") {
        payloads.set(String(args.databaseId), args.data);
        return;
      }
      if (command === "load_database_data")
        return {
          value: payloads.get(String(args.databaseId)),
          source: "current",
        };
      if (
        command === "database_protection_unlock" ||
        command === "database_protection_load"
      )
        return structuredClone(lease);
      if (command === "database_protection_save")
        return {
          committed: true,
          cleanupPending: false,
          warnings: [],
          securityRevision: lease.securityRevision,
        };
      if (command === "database_protection_lock") {
        bridge.locked?.({ payload: { databaseId: String(args.databaseId) } });
        return { locked: true, notificationPending: false, warnings: [] };
      }
      if (command === "database_protection_status")
        return {
          kind: "managed",
          securityRevision: lease.securityRevision,
          unlocked: false,
          slots: [
            {
              id: "password-slot",
              type: "password",
              label: "Password",
              deviceBound: false,
            },
          ],
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
        row.isEncrypted = Boolean(args.target);
        row.protectionFormat = args.target ? "sorng-db" : undefined;
        row.securityRevision = "rev-2";
        payloads.set(
          row.id,
          JSON.stringify({
            format: "sorng-db",
            version: 1,
            ciphertext: "new-destination",
          }),
        );
        return {
          committed: true,
          cleanupPending: false,
          warnings: [],
          securityRevision: "rev-2",
          sessionId: "new-handle",
          sessionExpiresAt: Date.now() + 900000,
        };
      }
      return undefined;
    },
  );
});
afterEach(() => {
  DatabaseManager.resetInstance();
  vi.useRealTimers();
});

describe("native managed database sessions", () => {
  it("rejects a protection confirmation captured before a security revision change", async () => {
    const manager = DatabaseManager.getInstance();
    await expect(
      manager.changeManagedDatabaseProtection(rows[0].id, null, {
        expectedSecurityRevision: "old-review",
        confirmRemoveProtection: true,
      }),
    ).rejects.toThrow("changed since review");
    expect(
      bridge.invoke.mock.calls.some(
        ([cmd]) => cmd === "database_protection_change",
      ),
    ).toBe(false);
  });
  it.each(["database_protection_load", "database_protection_save"])(
    "masks revoked access after %s rejection even without a lock event",
    async (command) => {
      const manager = DatabaseManager.getInstance();
      await manager.unlockManagedDatabase(
        rows[0].id,
        "password-slot",
        "secret",
      );
      await manager.selectDatabase(rows[0].id);
      const original = bridge.invoke.getMockImplementation()!;
      bridge.invoke.mockImplementation((cmd, args) =>
        cmd === command
          ? Promise.reject(new Error("native lease revoked"))
          : original(cmd, args),
      );
      const operation =
        command === "database_protection_load"
          ? manager.loadDatabaseData(rows[0].id)
          : manager.saveDatabaseData(rows[0].id, data);
      await expect(operation).rejects.toThrow("native lease revoked");
      expect(manager.getDatabaseAccessState(rows[0].id)).toMatchObject({
        status: "suspended",
        reason: "security-changed",
      });
      expect(manager.getCurrentDatabase()?.id).toBe(rows[0].id);
    },
  );
  it("masks a committed native lock even when other-window notification is pending", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(rows[0].id, "password-slot", "secret");
    await manager.selectDatabase(rows[0].id);
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation((cmd, args) =>
      cmd === "database_protection_lock"
        ? Promise.resolve({
            locked: true,
            notificationPending: true,
            warnings: ["notification unavailable"],
          })
        : original(cmd, args),
    );
    await manager.closeCurrentDatabase("lock");
    expect(manager.isDatabaseUnlocked(rows[0].id)).toBe(false);
    expect(manager.getCurrentDatabase()).toBeNull();
    expect(SettingsManager.getInstance().logAction).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("notification"),
      undefined,
      "notification unavailable",
    );
  });
  it("requires explicit unlock and never tries legacy decryption or plaintext save", async () => {
    const manager = DatabaseManager.getInstance();
    await expect(manager.selectDatabase(rows[0].id)).rejects.toThrow(
      "locked or expired",
    );
    await expect(
      manager.saveDatabaseData(rows[0].id, data, "not-a-managed-password"),
    ).rejects.toThrow("locked or expired");
    expect(
      bridge.invoke.mock.calls.some(
        ([cmd]) =>
          cmd === "save_database_data" ||
          cmd === "crypto_legacy_decrypt_cryptojs",
      ),
    ).toBe(false);
  });
  it("uses a native lease for fresh load/save; does not cache or replay the password", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(
      rows[0].id,
      "password-slot",
      "fixture-secret",
    );
    await manager.selectDatabase(rows[0].id);
    const target = manager.captureCurrentDatabaseDataTarget()!;
    await target.save({ ...data, timestamp: 2 });
    await target.load();
    const calls = bridge.invoke.mock.calls.filter(
      ([cmd]) =>
        cmd === "database_protection_load" ||
        cmd === "database_protection_save",
    );
    expect(calls.length).toBeGreaterThan(2);
    for (const [, args] of calls) {
      expect(args).toMatchObject({
        sessionId: "fixture-native-handle",
        expectedSecurityRevision: "rev-1",
      });
      expect(args).not.toHaveProperty("password");
    }
    expect(manager.getDatabaseAccessState(rows[0].id)).not.toHaveProperty(
      "sessionId",
    );
  });
  it("expires access without closing the active database or discarding persistence ownership", async () => {
    vi.useFakeTimers();
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(rows[0].id, "password-slot", "secret");
    await manager.selectDatabase(rows[0].id);
    const target = manager.captureCurrentDatabaseDataTarget()!;
    const changes = vi.fn();
    const off = onCurrentDatabaseChange(changes);
    await vi.advanceTimersByTimeAsync(900001);
    expect(manager.getCurrentDatabase()?.id).toBe(rows[0].id);
    expect(manager.getDatabaseAccessState(rows[0].id)).toMatchObject({
      status: "suspended",
      reason: "expired",
    });
    expect(changes).not.toHaveBeenCalled();
    expect(() => target.save(data)).toThrow("access expired");
    off();
  });
  it("masks native cross-window lock synchronously and recaptures on explicit reauthentication", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(rows[0].id, "password-slot", "secret");
    await manager.selectDatabase(rows[0].id);
    const old = manager.captureCurrentDatabaseDataTarget()!;
    const changes = vi.fn();
    const access = vi.fn();
    const off = onCurrentDatabaseChange(changes);
    const offAccess = onDatabaseAccessChange(access);
    bridge.locked?.({ payload: { databaseId: rows[0].id } });
    expect(access).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "suspended", reason: "locked" }),
    );
    expect(manager.getCurrentDatabase()?.id).toBe(rows[0].id);
    await manager.unlockManagedDatabase(rows[0].id, "password-slot", "secret");
    expect(changes).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reason: "security-change",
        databaseId: rows[0].id,
      }),
    );
    expect(() => old.load()).toThrow("access expired");
    await manager.captureCurrentDatabaseDataTarget()!.save(data);
    off();
    offAccess();
  });
  it("rejects a late unlock after global invalidation", async () => {
    let resolve!: (value: DatabaseProtectionUnlockResult) => void;
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation((cmd, args) =>
      cmd === "database_protection_unlock"
        ? new Promise((done) => {
            resolve = done;
          })
        : original(cmd, args),
    );
    const manager = DatabaseManager.getInstance();
    const pending = manager.unlockManagedDatabase(
      rows[0].id,
      "password-slot",
      "secret",
    );
    const rejection = expect(pending).rejects.toThrow("access expired");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    manager.invalidatePendingDatabaseOperations();
    resolve(lease);
    await rejection;
    expect(manager.isDatabaseUnlocked(rows[0].id)).toBe(false);
  });
  it("does not close or claim locked when the native lock fails", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(rows[0].id, "password-slot", "secret");
    await manager.selectDatabase(rows[0].id);
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation((cmd, args) =>
      cmd === "database_protection_lock"
        ? Promise.reject(new Error("native lock unavailable"))
        : original(cmd, args),
    );
    await expect(manager.closeCurrentDatabase("lock")).rejects.toThrow(
      "native lock unavailable",
    );
    expect(manager.getCurrentDatabase()?.id).toBe(rows[0].id);
    expect(manager.isDatabaseUnlocked(rows[0].id)).toBe(true);
  });
  it("treats committed save cleanup warnings as saved", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(rows[0].id, "password-slot", "secret");
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation((cmd, args) =>
      cmd === "database_protection_save"
        ? Promise.resolve({
            committed: true,
            cleanupPending: true,
            warnings: ["cleanup pending"],
            securityRevision: "rev-1",
          })
        : original(cmd, args),
    );
    await expect(
      manager.saveDatabaseData(rows[0].id, data),
    ).resolves.toBeUndefined();
    expect(SettingsManager.getInstance().logAction).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("saved"),
      undefined,
      "cleanup pending",
    );
    vi.mocked(SettingsManager.getInstance().logAction).mockImplementation(
      () => {
        throw new Error("logger unavailable");
      },
    );
    await expect(
      manager.saveDatabaseData(rows[0].id, data),
    ).resolves.toBeUndefined();
  });
  it("refuses generic clone without explicit fresh destination protectors", async () => {
    await expect(
      DatabaseManager.getInstance().duplicateDatabase(rows[0].id),
    ).rejects.toThrow("new destination unlock methods");
    expect(
      bridge.invoke.mock.calls.some(([cmd]) => cmd === "save_database_data"),
    ).toBe(false);
  });
  it("creates only empty plaintext before direct protected destination initialization", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(rows[0].id, "password-slot", "secret");
    const sourceId = rows[0].id;
    await manager.duplicateDatabase(sourceId, {
      includeTrust: false,
      protectionTarget: {
        dataCipher: "chacha20-poly1305",
        keepSlotIds: [],
        newSlots: [
          {
            type: "password",
            label: "New destination",
            password: "new-secret",
          },
        ],
      },
    });
    const plainWrites = bridge.invoke.mock.calls.filter(
      ([cmd]) => cmd === "save_database_data",
    );
    expect(plainWrites).toHaveLength(1);
    expect(plainWrites[0][1].data).toEqual({
      connections: [],
      settings: {},
      timestamp: expect.any(Number),
    });
    const change = bridge.invoke.mock.calls.find(
      ([cmd]) => cmd === "database_protection_change",
    )![1];
    expect(change.databaseId).not.toBe(sourceId);
    expect(change.initializeEmptyDestination).toBe(true);
    expect(change.legacyVerifiedData).toEqual(data);
    expect(change.target.keepSlotIds).toEqual([]);
    expect(manager.getCurrentDatabase()).toBeNull();
  });
});
