import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import type { StorageData } from "../../src/utils/storage/storage";
import type { DatabaseProtectionTarget } from "../../src/types/encryption/databaseProtection";
import { rebindDatabaseQuickActions } from "../../src/utils/connection/rebindDatabaseQuickActions";
import { encryptWithPassword } from "../../src/utils/crypto/webCryptoAes";
import { fixture } from "../documents/fixtures";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  payload: null as StorageData | null,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => native.invoke,
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ logAction: vi.fn() }) },
}));
const database = {
  id: "db-a",
  name: "Portable fixture",
  isEncrypted: false,
  createdAt: "2026-09-13",
  updatedAt: "2026-09-13",
  lastAccessed: "2026-09-13",
};
const policy = {
  version: 1 as const,
  documentTypes: { disabled: ["note" as const, "ticket" as const] },
};
beforeEach(() => {
  DatabaseManager.resetInstance();
  native.payload = {
    connections: [],
    settings: { retained: true },
    timestamp: 1,
    databaseSettings: structuredClone(policy),
    documents: fixture(),
  };
  native.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "databases_list")
      return { source: "current", value: [database] };
    if (command === "load_database_data")
      return { source: "current", value: structuredClone(native.payload) };
    if (command === "save_database_data") {
      expect(args.databaseId).toBe("db-a");
      expect(args.expectedData).toEqual(native.payload);
      native.payload = structuredClone(args.data);
      return;
    }
    throw new Error(`Unexpected fixture IPC: ${command}`);
  });
});
afterEach(() => {
  DatabaseManager.resetInstance();
  vi.restoreAllMocks();
});

describe("database-owned settings portability", () => {
  it("round-trips the native database JSON payload and preserves preferences through an ordinary save/reopen", async () => {
    const manager = DatabaseManager.getInstance();
    const loaded = await manager.loadDatabaseData("db-a");
    expect(loaded!.databaseSettings).toEqual(policy);
    await manager.saveDatabaseData("db-a", { ...loaded!, timestamp: 2 });
    DatabaseManager.resetInstance();
    expect(
      (await DatabaseManager.getInstance().loadDatabaseData("db-a"))!
        .databaseSettings,
    ).toEqual(policy);
    expect(native.payload!.settings).toEqual({ retained: true });
    expect(native.payload!.documents).toEqual(fixture());
  });
  it.each([false, true])(
    "exports nonsecret policy while omitting private document payloads (credentials=%s)",
    async (includePasswords) => {
      const snapshot =
        await DatabaseManager.getInstance().readExportableDatabaseSnapshot(
          "db-a",
          includePasswords,
          { includeTrust: false },
        );
      expect(snapshot.databaseSettings).toEqual(policy);
      expect(snapshot).not.toHaveProperty("documents");
      expect(snapshot).not.toHaveProperty("credentialVault");
      expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_FIXTURE");
      expect(snapshot.settings).toEqual({ retained: true });
    },
  );
  it("preserves database preferences in whole-database copies independently of document link rebinding", () => {
    const copied = rebindDatabaseQuickActions(
      structuredClone(native.payload!),
      "db-a",
      "db-copy",
    );
    expect(copied.databaseSettings).toEqual(policy);
    expect(copied.documents).not.toEqual(native.payload!.documents);
    expect(native.payload!.documents).toEqual(fixture());
  });
  it.each([false, true])(
    "imports the portable field into the destination data (encrypted archive=%s)",
    async (encrypted) => {
      const manager = DatabaseManager.getInstance();
      const create = vi
        .spyOn(manager, "createManagedDatabase")
        .mockResolvedValue({ ...database, id: "copy" });
      const content = JSON.stringify({
        collection: { id: "db-a", name: "Copy" },
        connections: [],
        databaseSettings: policy,
      });
      const password = "synthetic-import-password";
      const archive = encrypted
        ? await encryptWithPassword(content, password, { iterations: 10000 })
        : content;
      await manager.importDatabase(archive, {
        ...(encrypted ? { importPassword: password } : {}),
        protectionTarget: {} as DatabaseProtectionTarget,
        includeTrust: false,
      });
      expect(create).toHaveBeenCalledOnce();
      expect(create.mock.calls[0][2]?.data?.databaseSettings).toEqual(policy);
      expect(create.mock.calls[0][2]?.data?.settings).toEqual({});
      expect(
        native.invoke.mock.calls.some(
          ([command]) => command === "save_database_data",
        ),
      ).toBe(false);
    },
  );
  it("rejects malformed portable preferences before creating an imported database", async () => {
    const manager = DatabaseManager.getInstance();
    const create = vi.spyOn(manager, "createManagedDatabase");
    await expect(
      manager.importDatabase(
        JSON.stringify({
          collection: { name: "Invalid" },
          databaseSettings: { version: 99 },
        }),
        {
          protectionTarget: {} as DatabaseProtectionTarget,
          includeTrust: false,
        },
      ),
    ).rejects.toThrow(/settings are invalid/);
    expect(create).not.toHaveBeenCalled();
  });
});
