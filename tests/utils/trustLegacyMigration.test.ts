import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { encryptWithPassword } from "../../src/utils/crypto/webCryptoAes";
import type { ConnectionDatabase } from "../../src/types/connection/connection";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => bridge.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => undefined,
}));
let database: ConnectionDatabase;
let stored: unknown;
const payload = { connections: [], settings: {}, timestamp: 1 };
beforeEach(() => {
  DatabaseManager.resetInstance();
  vi.clearAllMocks();
  database = {
    id: "migration-source",
    name: "Source",
    isEncrypted: false,
    securityRevision: "revision-one",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    lastAccessed: "2026-01-01",
  };
  stored = payload;
  bridge.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "databases_list")
        return { value: [database], source: "current" };
      if (command === "load_database_data")
        return { value: stored, source: "current" };
      if (command === "database_protection_unlock")
        return {
          data: payload,
          sessionId: "private-native-token",
          sessionExpiresAt: Date.now() + 900000,
          securityRevision: database.securityRevision,
        };
      if (command === "trust_migrate_legacy_database")
        return {
          databaseId: args.databaseId,
          status: "migrated",
          migratedRecords: 2,
          preservedRecords: 4,
          warnings: [],
        };
      if (command === "trust_reassign_reviewed_scope") return { updated: 1 };
      throw new Error(`Unexpected fixture command ${command}`);
    },
  );
});
afterEach(() => DatabaseManager.resetInstance());
describe("non-activating legacy trust migration", () => {
  it.each(["plain", "legacy", "managed"])(
    "reassigns trust scope using existing %s authority only",
    async (kind) => {
      const manager = DatabaseManager.getInstance();
      const targets = [
        {
          host: "server:443",
          recordType: "https",
          fingerprint: "reviewed",
          expectedDecision: {
            userApproved: true,
            revoked: false,
            trustExpires: null,
            hostPolicy: null,
            hostPolicyConfig: null,
          },
        },
      ];
      if (kind === "legacy") {
        database.isEncrypted = true;
        stored = await encryptWithPassword(
          JSON.stringify(payload),
          "fixture-password",
          { iterations: 10000 },
        );
        await expect(
          manager.reassignTrustScope(database.id, targets, null),
        ).rejects.toThrow("Unlock this database explicitly");
        await manager.unlockDatabase(database.id, "fixture-password");
      }
      if (kind === "managed") {
        database.isEncrypted = true;
        database.protectionFormat = "sorng-db";
        await expect(
          manager.reassignTrustScope(database.id, targets, null),
        ).rejects.toThrow("locked or expired");
        await manager.unlockManagedDatabase(database.id, "vault-slot");
      }
      bridge.invoke.mockClear();
      const expectedTargets = structuredClone(targets);
      const move = manager.reassignTrustScope(database.id, targets, null);
      targets[0].expectedDecision.revoked = true;
      await expect(move).resolves.toEqual({ updated: 1 });
      expect(bridge.invoke).toHaveBeenCalledWith(
        "trust_reassign_reviewed_scope",
        {
          databaseId: database.id,
          targets: expectedTargets,
          targetConnectionId: null,
          expectedSecurityRevision: "revision-one",
          ...(kind === "legacy"
            ? { expectedData: stored, connectionIds: [] }
            : kind === "managed"
              ? { sourceSessionId: "private-native-token" }
              : {}),
        },
      );
      expect(
        bridge.invoke.mock.calls.some(([name]) =>
          ["database_protection_unlock", "trust_set_active_database"].includes(
            name,
          ),
        ),
      ).toBe(false);
      expect(manager.getCurrentDatabase()).toBeNull();
    },
  );
  it("lets native derive plain source IDs without opening or loading the database in the renderer", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.migrateLegacyTrustDatabase(database.id);
    expect(bridge.invoke).toHaveBeenCalledWith(
      "trust_migrate_legacy_database",
      { databaseId: database.id, expectedSecurityRevision: "revision-one" },
    );
    expect(
      bridge.invoke.mock.calls.some(
        ([command]) =>
          command === "load_database_data" ||
          command === "trust_set_active_database",
      ),
    ).toBe(false);
    expect(manager.getCurrentDatabase()).toBeNull();
  });
  it("requires explicit legacy unlock then pins the exact representation that was decrypted", async () => {
    database.isEncrypted = true;
    stored = await encryptWithPassword(
      JSON.stringify(payload),
      "fixture-password",
      { iterations: 10000 },
    );
    const manager = DatabaseManager.getInstance();
    await expect(
      manager.migrateLegacyTrustDatabase(database.id),
    ).rejects.toThrow("Unlock this database explicitly");
    await manager.unlockDatabase(database.id, "fixture-password");
    await manager.migrateLegacyTrustDatabase(database.id);
    expect(bridge.invoke).toHaveBeenCalledWith(
      "trust_migrate_legacy_database",
      {
        databaseId: database.id,
        expectedSecurityRevision: "revision-one",
        expectedData: stored,
        connectionIds: [],
      },
    );
    const args = bridge.invoke.mock.calls.find(
      ([command]) => command === "trust_migrate_legacy_database",
    )![1];
    expect(args).not.toHaveProperty("password");
    expect(args).not.toHaveProperty("sourceSessionId");
    expect(manager.getCurrentDatabase()).toBeNull();
  });
  it("keeps the managed lease private and delegates membership derivation to native", async () => {
    database.isEncrypted = true;
    database.protectionFormat = "sorng-db";
    const manager = DatabaseManager.getInstance();
    await expect(
      manager.migrateLegacyTrustDatabase(database.id),
    ).rejects.toThrow("locked or expired");
    await manager.unlockManagedDatabase(database.id, "vault-slot");
    await manager.migrateLegacyTrustDatabase(database.id);
    expect(bridge.invoke).toHaveBeenCalledWith(
      "trust_migrate_legacy_database",
      {
        databaseId: database.id,
        expectedSecurityRevision: "revision-one",
        sourceSessionId: "private-native-token",
      },
    );
    expect(manager.getCurrentDatabase()).toBeNull();
    expect(
      bridge.invoke.mock.calls.some(
        ([command]) => command === "trust_set_active_database",
      ),
    ).toBe(false);
  });
  it("rejects a mismatched completion instead of claiming verified migration", async () => {
    const original = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation((command, args) =>
      command === "trust_migrate_legacy_database"
        ? Promise.resolve({
            databaseId: "another-db",
            status: "migrated",
            migratedRecords: 1,
            preservedRecords: 0,
            warnings: [],
          })
        : original(command, args),
    );
    await expect(
      DatabaseManager.getInstance().migrateLegacyTrustDatabase(database.id),
    ).rejects.toThrow("invalid result");
  });
});
