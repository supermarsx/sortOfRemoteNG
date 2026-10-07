import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  DatabaseManager,
  onCurrentDatabaseChange,
  onDatabaseAccessChange,
} from "../../src/utils/connection/databaseManager";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import type { ConnectionDatabase } from "../../src/types/connection/connection";
import type { DatabaseProtectionUnlockResult } from "../../src/types/encryption/databaseProtection";
import { stableJsonStringify } from "../../src/utils/core/stableJsonStringify";
import { startDatabaseStartupSession } from "../../src/utils/connection/databaseStartup";
import type { GlobalSettings } from "../../src/types/settings/settings";
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
    sessionExpiresAt: null,
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
      if (command === "database_protection_release_session")
        return { released: true };
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
          sessionExpiresAt: null,
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
  it("captures only the current native browser owner proof without acquiring new authority", async () => {
    const manager = DatabaseManager.getInstance();
    const id = rows[0].id;
    expect(() => manager.captureOriginBrowserOwnerProof(id)).toThrow();
    await manager.unlockManagedDatabase(id, "password-slot", "secret");
    expect(() => manager.captureOriginBrowserOwnerProof(id)).toThrow();
    await manager.selectDatabase(id);
    bridge.invoke.mockClear();
    const proof = manager.captureOriginBrowserOwnerProof(id);
    expect(proof).toEqual({
      ownerDatabaseId: id,
      expectedSecurityRevision: "rev-1",
      sourceSessionId: "fixture-native-handle",
      assertCurrent: expect.any(Function),
    });
    expect(Object.isFrozen(proof)).toBe(true);
    proof.assertCurrent();
    expect(bridge.invoke).not.toHaveBeenCalled();
    expect(() =>
      manager.captureOriginBrowserOwnerProof("different-owner"),
    ).toThrow();
    expect(JSON.stringify(proof)).not.toContain("secret");
  });

  it.each(["lock", "global-lock", "replacement", "revision", "dispose"])(
    "revokes browser owner proof on %s",
    async (change) => {
      const manager = DatabaseManager.getInstance();
      const id = rows[0].id;
      await manager.unlockManagedDatabase(id, "password-slot", "secret");
      await manager.selectDatabase(id);
      const proof = manager.captureOriginBrowserOwnerProof(id);
      if (change === "lock") await manager.lockDatabase(id);
      if (change === "global-lock")
        manager.invalidatePendingDatabaseOperations();
      if (change === "dispose") DatabaseManager.resetInstance();
      if (change === "replacement" || change === "revision") {
        lease = {
          ...lease,
          sessionId: "replacement-handle",
          securityRevision: change === "revision" ? "rev-2" : "rev-1",
        };
        await manager.unlockManagedDatabase(id, "password-slot", "secret");
        expect(manager.captureOriginBrowserOwnerProof(id).sourceSessionId).toBe(
          "replacement-handle",
        );
      }
      expect(() => proof.assertCurrent()).toThrow();
    },
  );

  it("does not revive a browser proof after switching away and back", async () => {
    const manager = DatabaseManager.getInstance();
    const id = rows[0].id;
    await manager.unlockManagedDatabase(id, "password-slot", "secret");
    await manager.selectDatabase(id);
    const proof = manager.captureOriginBrowserOwnerProof(id);
    rows.push({
      ...rows[0],
      id: "plain",
      isEncrypted: false,
      protectionFormat: undefined,
    });
    payloads.set("plain", structuredClone(data));
    await manager.selectDatabase("plain");
    expect(() => manager.captureOriginBrowserOwnerProof("plain")).toThrow();
    expect(() => manager.captureOriginBrowserOwnerProof(id)).toThrow();
    expect(() => proof.assertCurrent()).toThrow();
    await manager.selectDatabase(id);
    expect(() => proof.assertCurrent()).toThrow();
    manager.captureOriginBrowserOwnerProof(id).assertCurrent();
  });

  it("rejects expired native browser grants even before a timer callback", async () => {
    vi.useFakeTimers();
    lease.sessionExpiresAt = Date.now() + 60_000;
    const manager = DatabaseManager.getInstance();
    const id = rows[0].id;
    await manager.unlockManagedDatabase(id, "password-slot", "secret");
    await manager.selectDatabase(id);
    const proof = manager.captureOriginBrowserOwnerProof(id);
    vi.setSystemTime(Date.now() + 60_001);
    expect(() => proof.assertCurrent()).toThrow();
    expect(() => manager.captureOriginBrowserOwnerProof(id)).toThrow();
  });

  it.each(["active", "side"])(
    "keeps an open %s database and its captured session usable after eight idle hours",
    async (target) => {
      vi.useFakeTimers();
      const manager = DatabaseManager.getInstance();
      const id = rows[0].id;
      await manager.unlockManagedDatabase(id, "password-slot", "secret");
      await manager.selectDatabase(id);
      const captured = manager.captureCurrentDatabaseDataTarget()!;
      const epoch = manager.getDatabaseAccessState(id)?.accessEpoch;
      if (target === "side") {
        rows.push({
          ...rows[0],
          id: "other",
          isEncrypted: false,
          protectionFormat: undefined,
        });
        payloads.set("other", structuredClone(data));
        await manager.selectDatabase("other");
      }
      const access = vi.fn();
      const changes = vi.fn();
      const offAccess = onDatabaseAccessChange(access);
      const offChange = onCurrentDatabaseChange(changes);
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);
      expect(manager.isDatabaseUnlocked(id)).toBe(true);
      expect(manager.getUnlockedDatabaseIds()).toContain(id);
      expect(manager.getDatabaseAccessState(id)).toMatchObject({
        status: "ready",
        sessionExpiresAt: null,
      });
      expect(manager.getDatabaseAccessState(id)?.accessEpoch).toBe(epoch);
      expect(access).not.toHaveBeenCalled();
      expect(changes).not.toHaveBeenCalled();
      if (target === "active") {
        await captured.load();
        await captured.save(data);
      } else {
        await manager.loadDatabaseData(id);
        await manager.saveDatabaseData(id, data);
      }
      expect(
        bridge.invoke.mock.calls.filter(
          ([cmd]) => cmd === "database_protection_unlock",
        ),
      ).toHaveLength(1);
      offAccess();
      offChange();
    },
  );
  it.each([undefined, 0, NaN, Infinity, "unlimited", "900000"])(
    "rejects malformed session expiry %s rather than treating it as open-lifetime access",
    async (expiresAt) => {
      lease.sessionExpiresAt = expiresAt as number;
      const manager = DatabaseManager.getInstance();
      await expect(
        manager.unlockManagedDatabase(rows[0].id, "password-slot", "secret"),
      ).rejects.toThrow("Invalid native database session response");
      expect(manager.isDatabaseUnlocked(rows[0].id)).toBe(false);
      expect(bridge.invoke).toHaveBeenCalledWith(
        "database_protection_release_session",
        {
          databaseId: rows[0].id,
          sessionId: lease.sessionId,
        },
      );
    },
  );
  it.each(["active", "side"])(
    "persists explicit managed %s Close rather than treating it as expiry",
    async (target) => {
      const manager = DatabaseManager.getInstance();
      const id = rows[0].id;
      const other = {
        ...rows[0],
        id: "other",
        isEncrypted: false,
        protectionFormat: undefined,
      };
      rows.push(other);
      payloads.set(other.id, structuredClone(data));
      await manager.unlockManagedDatabase(id, "password-slot", "secret");
      await manager.selectDatabase(id);
      if (target === "side") await manager.selectDatabase(other.id);
      const activeId = manager.getCurrentDatabase()!.id;
      const saved = {
        autoOpenLastCollection: true,
        databaseOpenSet: {
          version: 1,
          databaseIds: [id, other.id],
          activeDatabaseId: activeId,
        },
      } as GlobalSettings;
      const settings = {
        getSettings: () => saved,
        saveSettings: vi.fn(async (patch: Partial<GlobalSettings>) => {
          Object.assign(saved, JSON.parse(JSON.stringify(patch)));
        }),
      };
      const task = startDatabaseStartupSession({
        manager,
        settings: settings as unknown as SettingsManager,
        loadData: vi.fn(async () => true),
        showChooser: vi.fn(),
        isCurrent: () => true,
        ownerWindow: true,
      });
      await task.restore;
      const changes = vi.fn();
      const unsubscribe = manager.onCurrentDatabaseChange(changes);
      if (target === "side") await manager.closeDatabase(id);
      else expect(await manager.closeCurrentDatabase()).toBe(id);
      await vi.waitFor(() =>
        expect(saved.databaseOpenSet?.databaseIds).toEqual([other.id]),
      );
      expect(manager.isDatabaseUnlocked(id)).toBe(false);
      expect(manager.getCurrentDatabase()?.id ?? null).toBe(
        target === "side" ? other.id : null,
      );
      expect(saved.databaseOpenSet?.activeDatabaseId).toBe(
        target === "side" ? other.id : null,
      );
      expect(changes).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "close" }),
      );
      expect(bridge.invoke).toHaveBeenCalledWith(
        "database_protection_lock",
        expect.objectContaining({ databaseId: id }),
      );
      unsubscribe();
      task.dispose();
    },
  );
  it("verifies a committed vault after native JSON key ordering without accepting external edits", async () => {
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command === "database_protection_save") {
        expect(args.expectedData).toEqual(lease.data);
        // serde_json::Value round trips JSON objects in key order, not the
        // insertion order of the frontend's draft or freshly built ledger.
        lease.data = JSON.parse(stableJsonStringify(args.data));
      }
      return original(command, args);
    });
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(rows[0].id, "password-slot", "secret");
    await manager.selectDatabase(rows[0].id);
    const target = manager.captureCurrentDatabaseDataTarget()!;
    const loaded = (await target.load())!;
    const migrations = bridge.invoke.mock.calls.filter(
      ([cmd]) => cmd === "database_protection_save",
    ).length;
    await manager.selectDatabase(rows[0].id);
    expect(
      bridge.invoke.mock.calls.filter(
        ([cmd]) => cmd === "database_protection_save",
      ),
    ).toHaveLength(migrations);
    await target.save({
      ...loaded,
      credentialVault: {
        version: 1,
        revision: 1,
        entries: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "Synthetic account",
            createdAt: "2026-10-02T00:00:00.000Z",
            updatedAt: "2026-10-02T00:00:00.000Z",
            facets: { username: "fixture", password: "SYNTHETIC_PASSWORD" },
          },
        ],
      },
    });
    await expect(target.verifyCurrent!()).resolves.toBeUndefined();
    lease.data = { ...lease.data, timestamp: lease.data.timestamp + 1 };
    await expect(target.verifyCurrent!()).rejects.toThrow(
      "changed in another window",
    );
    // A failed verification must not silently adopt the other writer's data.
    await expect(target.verifyCurrent!()).rejects.toThrow(
      "changed in another window",
    );
  });
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
  it.each([
    ["before", false],
    ["after", false],
    ["before", true],
    ["after", true],
  ] as const)(
    "rechecks a read taken %s an autosave without adopting an external edit (%s)",
    async (readWhen, externalEdit) => {
      const original = bridge.invoke.getMockImplementation()!;
      bridge.invoke.mockImplementation(async (command, args) => {
        if (command === "database_protection_save") {
          expect(args.expectedData).toEqual(lease.data);
          lease.data = JSON.parse(stableJsonStringify(args.data));
        }
        return original(command, args);
      });
      const manager = DatabaseManager.getInstance();
      await manager.unlockManagedDatabase(
        rows[0].id,
        "password-slot",
        "secret",
      );
      await manager.selectDatabase(rows[0].id);
      const target = manager.captureCurrentDatabaseDataTarget()!;
      const loaded = (await target.load())!;
      const roundTrip = bridge.invoke.getMockImplementation()!;
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const requested = new Promise<void>((resolve) => {
        started = resolve;
      });
      let reads = 0;
      bridge.invoke.mockImplementation(async (command, args) => {
        if (command === "database_protection_load" && ++reads === 1) {
          const before = structuredClone(lease);
          started();
          await gate;
          if (readWhen === "before") return before;
        }
        return roundTrip(command, args);
      });
      const verification = target.verifyCurrent!();
      await requested;
      await target.save({ ...loaded, settings: { autosaved: true } });
      if (externalEdit)
        lease.data = { ...lease.data, settings: { external: true } };
      release();
      if (externalEdit)
        await expect(verification).rejects.toThrow("changed in another window");
      else await expect(verification).resolves.toBeUndefined();
      expect(reads).toBe(2);
      lease.data = { ...lease.data, settings: { external: true } };
      await expect(target.verifyCurrent!()).rejects.toThrow(
        "changed in another window",
      );
    },
  );
  it("bounds verification retries when its own saves keep advancing the baseline", async () => {
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command === "database_protection_save") {
        expect(args.expectedData).toEqual(lease.data);
        lease.data = JSON.parse(stableJsonStringify(args.data));
      }
      return original(command, args);
    });
    const manager = DatabaseManager.getInstance();
    await manager.unlockManagedDatabase(rows[0].id, "password-slot", "secret");
    await manager.selectDatabase(rows[0].id);
    const target = manager.captureCurrentDatabaseDataTarget()!;
    await target.load();
    const roundTrip = bridge.invoke.getMockImplementation()!;
    let reads = 0;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command === "database_protection_load") {
        reads++;
        await target.save({
          ...lease.data,
          timestamp: lease.data.timestamp + 1,
        });
      }
      return roundTrip(command, args);
    });
    await expect(target.verifyCurrent!()).rejects.toThrow(
      "Retry after pending saves finish",
    );
    expect(reads).toBe(3);
    bridge.invoke.mockImplementation(roundTrip);
    await expect(target.verifyCurrent!()).resolves.toBeUndefined();
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
  it("honours a legacy native deadline without closing the database or discarding persistence ownership", async () => {
    vi.useFakeTimers();
    lease.sessionExpiresAt = Date.now() + 900000;
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
  it("cancels an old expiry timer when native reauthentication grants open-lifetime access", async () => {
    vi.useFakeTimers();
    const manager = DatabaseManager.getInstance();
    const id = rows[0].id;
    lease.sessionExpiresAt = Date.now() + 900000;
    await manager.unlockManagedDatabase(id, "password-slot", "secret");
    lease = { ...lease, sessionId: "replacement", sessionExpiresAt: null };
    await manager.unlockManagedDatabase(id, "password-slot", "secret");
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);
    expect(manager.isDatabaseUnlocked(id)).toBe(true);
    expect(manager.getDatabaseAccessState(id)?.status).toBe("ready");
    await manager.lockDatabase(id);
    expect(manager.isDatabaseUnlocked(id)).toBe(false);
    await expect(manager.loadDatabaseData(id)).rejects.toThrow(
      "locked or expired",
    );
  });
  it("does not expire a bounded native grant early at the browser timer limit", async () => {
    vi.useFakeTimers();
    const manager = DatabaseManager.getInstance();
    lease.sessionExpiresAt = Date.now() + 2147483647 + 60000;
    await manager.unlockManagedDatabase(rows[0].id, "password-slot", "secret");
    await vi.advanceTimersByTimeAsync(2147483647);
    expect(manager.isDatabaseUnlocked(rows[0].id)).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(manager.isDatabaseUnlocked(rows[0].id)).toBe(false);
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
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_protection_release_session",
      { databaseId: rows[0].id, sessionId: lease.sessionId },
    );
  });
  it("releases only an abandoned prompt's returned token without ready, close or database-wide lock", async () => {
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
    let current = true;
    const ready = vi.fn();
    const stop = onDatabaseAccessChange(ready);
    const pending = manager.unlockManagedDatabase(
      rows[0].id,
      "password-slot",
      "secret",
      { isCurrent: () => current },
    );
    const rejected = expect(pending).rejects.toThrow("no longer active");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    current = false;
    resolve(lease);
    await rejected;
    expect(manager.isDatabaseUnlocked(rows[0].id)).toBe(false);
    expect(ready).not.toHaveBeenCalled();
    expect(bridge.invoke).toHaveBeenCalledWith(
      "database_protection_release_session",
      { databaseId: rows[0].id, sessionId: lease.sessionId },
    );
    expect(
      bridge.invoke.mock.calls.some(
        ([cmd]) => cmd === "database_protection_lock",
      ),
    ).toBe(false);
    stop();
  });
  it("refuses an already abandoned prompt before native authentication", async () => {
    await expect(
      DatabaseManager.getInstance().unlockManagedDatabase(
        rows[0].id,
        "password-slot",
        "secret",
        { isCurrent: () => false },
      ),
    ).rejects.toThrow("no longer active");
    expect(
      bridge.invoke.mock.calls.some(
        ([cmd]) => cmd === "database_protection_unlock",
      ),
    ).toBe(false);
  });
  it("does not install a late grant when token cleanup fails, and reports the uncertainty", async () => {
    const original = bridge.invoke.getMockImplementation()!;
    let current = true;
    bridge.invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "database_protection_unlock") {
        current = false;
        return lease;
      }
      if (cmd === "database_protection_release_session")
        throw new Error("transport failed");
      return original(cmd, args);
    });
    const manager = DatabaseManager.getInstance();
    await expect(
      manager.unlockManagedDatabase(rows[0].id, "password-slot", "secret", {
        isCurrent: () => current,
      }),
    ).rejects.toThrow("cleanup could not be confirmed");
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
  it("identifies the saved database without publishing its contents and emits only after commit", async () => {
    const manager = DatabaseManager.getInstance();
    const databaseId = rows[0].id;
    await manager.unlockManagedDatabase(databaseId, "password-slot", "secret");
    const saved = vi.fn();
    window.addEventListener("sorng-database-data-saved", saved);
    try {
      await manager.saveDatabaseData(databaseId, data);
      expect(saved).toHaveBeenCalledTimes(1);
      expect((saved.mock.calls[0][0] as CustomEvent).detail).toEqual({
        databaseId,
      });
      saved.mockClear();
      const original = bridge.invoke.getMockImplementation()!;
      bridge.invoke.mockImplementation((cmd, args) =>
        cmd === "database_protection_save"
          ? Promise.reject(new Error("save failed"))
          : original(cmd, args),
      );
      await expect(manager.saveDatabaseData(databaseId, data)).rejects.toThrow(
        "save failed",
      );
      expect(saved).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("sorng-database-data-saved", saved);
    }
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
    const copiedData: typeof lease.data = {
      ...data,
      credentialVault: {
        version: 1,
        revision: 1,
        entries: [
          {
            id: "preserved-vault-id",
            name: "Credential",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            facets: { password: "fixture-secret" },
          },
        ],
      },
      connections: [
        {
          id: "vault-connection",
          name: "Host",
          protocol: "ssh",
          hostname: "fixture.test",
          port: 22,
          isGroup: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          credentialSource: {
            kind: "vault",
            credentialId: "preserved-vault-id",
          },
        },
      ],
    };
    lease.data = copiedData;
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
      recordMetadata: expect.objectContaining({ version: 1 }),
    });
    const change = bridge.invoke.mock.calls.find(
      ([cmd]) => cmd === "database_protection_change",
    )![1];
    expect(change.databaseId).not.toBe(sourceId);
    expect(change.initializeEmptyDestination).toBe(true);
    expect(change.legacyVerifiedData).toMatchObject(copiedData);
    expect(change.legacyVerifiedData.recordMetadata.version).toBe(1);
    expect(change.target.keepSlotIds).toEqual([]);
    expect(manager.getCurrentDatabase()).toBeNull();
  });
  it("vault portability refuses append before any database access or write", async () => {
    const manager = DatabaseManager.getInstance();
    bridge.invoke.mockClear();
    await expect(
      manager.appendConnectionsToDatabase(rows[0].id, [
        {
          credentialSource: {
            kind: "vault",
            credentialId: "same-id-other-owner",
          },
          password: "ignored-local-secret",
        },
      ] as never),
    ).rejects.toThrow("duplicate the entire protected database");
    expect(bridge.invoke).not.toHaveBeenCalled();
  });
  it.each([
    { credentialVault: { version: 1, entries: [] } },
    {
      connections: [
        {
          credentialSource: {
            kind: "vault",
            credentialId: "same-id-other-owner",
          },
        },
      ],
    },
    {
      recycleBin: {
        entries: [{ connection: { credentialSource: { kind: "vault" } } }],
      },
    },
  ])(
    "vault portability refuses native import before creating a database: %j",
    async (payload) => {
      const manager = DatabaseManager.getInstance();
      bridge.invoke.mockClear();
      await expect(
        manager.importDatabase(
          JSON.stringify({ collection: { name: "Imported" }, ...payload }),
        ),
      ).rejects.toThrow("duplicate the entire protected database");
      expect(bridge.invoke).not.toHaveBeenCalled();
    },
  );
});
