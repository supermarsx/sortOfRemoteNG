import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import {
  encryptWithPassword,
  decryptWithPassword,
} from "../../src/utils/crypto/webCryptoAes";
import { reconcileRecordLedger } from "../../src/utils/storage/recordLedger";
import type { StorageData } from "../../src/utils/storage/storage";
import type { ConnectionDatabase } from "../../src/types/connection/connection";
import { connection } from "../fixtures/fullDatabaseArchive";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => bridge.invoke,
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ logAction: vi.fn() }) },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

let row: ConnectionDatabase;
let data: StorageData;
let stored: unknown;
let sessionExpiresAt: number;
const password = "Synthetic-metadata-fixture-123!";

beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  DatabaseManager.resetInstance();
  sessionExpiresAt = Date.now() + 900000;
  row = {
    id: "metadata-db",
    name: "Before",
    description: "Old description",
    isEncrypted: false,
    securityRevision: "current-revision",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastAccessed: "2026-01-02T00:00:00.000Z",
  };
  data = {
    connections: [connection("live"), connection("deleted")],
    settings: {},
    timestamp: 1,
  };
  const prior = await reconcileRecordLedger(data);
  data.connections.pop();
  data.recordMetadata = await reconcileRecordLedger(data, prior, {
    mode: "write",
  });
  stored = structuredClone(data);
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === "databases_list")
      return { value: [structuredClone(row)], source: "current" };
    if (command === "databases_save_index") {
      expect(args.expectedList).toEqual([row]);
      row = structuredClone(args.list[0]);
      return;
    }
    if (command === "load_database_data")
      return { value: structuredClone(stored), source: "current" };
    if (command === "save_database_data") {
      expect(args.expectedData).toEqual(stored);
      stored = structuredClone(args.data);
      return;
    }
    if (
      command === "database_protection_unlock" ||
      command === "database_protection_load"
    ) {
      return {
        sessionId: "synthetic-session",
        sessionExpiresAt,
        securityRevision: row.securityRevision,
        data: structuredClone(data),
      };
    }
    if (command === "database_protection_save") {
      expect(args.expectedData).toEqual(data);
      data = structuredClone(args.data);
      return {
        committed: true,
        cleanupPending: false,
        warnings: [],
        securityRevision: row.securityRevision,
      };
    }
    if (command === "trust_set_active_database") return;
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(() => {
  DatabaseManager.resetInstance();
  vi.unstubAllGlobals();
});

describe("metadata-only database edits", () => {
  it.each(["legacy", "managed"] as const)(
    "renames a locked %s database without reading or changing its encrypted payload",
    async (kind) => {
      row.isEncrypted = true;
      if (kind === "managed") row.protectionFormat = "sorng-db";
      Object.assign(row, {
        recordMetadata: structuredClone(data.recordMetadata),
        futureIndexField: { retained: true },
      });
      stored =
        kind === "legacy"
          ? await encryptWithPassword(JSON.stringify(data), password)
          : JSON.stringify({
              format: "sorng-db",
              ciphertext: "synthetic-opaque-body",
              slots: [
                { id: "vault", type: "os-vault", wrappedKey: "synthetic-key" },
              ],
            });
      const before = structuredClone(row);
      const ciphertext = stored;
      const staleEditor = {
        ...row,
        securityRevision: "stale",
        protectionFormat: undefined,
        createdAt: "1999-01-01",
      };
      await DatabaseManager.getInstance().updateDatabase({
        ...staleEditor,
        name: "Renamed",
        description: "New description",
      });
      expect(row).toEqual({
        ...before,
        name: "Renamed",
        description: "New description",
        updatedAt: expect.any(String),
      });
      expect(stored).toBe(ciphertext);
      expect(bridge.invoke.mock.calls.map(([command]) => command)).toEqual([
        "databases_list",
        "databases_save_index",
      ]);
    },
  );

  it("accepts just the editable fields and retains fresh security/access metadata", async () => {
    row.isEncrypted = true;
    row.protectionFormat = "sorng-db";
    const before = { ...row };
    await DatabaseManager.getInstance().updateDatabase({
      id: row.id,
      name: "Renamed",
      description: "",
    });
    expect(row).toEqual({
      ...before,
      name: "Renamed",
      description: "",
      updatedAt: expect.any(String),
    });
  });

  it("preserves the description when the edit only supplies a name", async () => {
    const description = row.description;
    await DatabaseManager.getInstance().updateDatabase({
      id: row.id,
      name: "Renamed",
    });
    expect(row.description).toBe(description);
  });

  it("refuses invalid runtime dates before writing and retains record history", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.selectDatabase(row.id);
    const before = structuredClone(stored);
    const draft = structuredClone(data);
    draft.connections[0].createdAt = new Date(NaN) as unknown as string;
    bridge.invoke.mockClear();
    await expect(manager.saveCurrentDatabaseData(draft)).rejects.toThrow(
      "invalid runtime date",
    );
    expect(stored).toEqual(before);
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it.each(["plain", "legacy", "managed"] as const)(
    "serializes runtime Dates before ledger reconciliation for %s data saves",
    async (kind) => {
      const manager = DatabaseManager.getInstance();
      if (kind !== "plain") row.isEncrypted = true;
      if (kind === "legacy")
        stored = await encryptWithPassword(JSON.stringify(data), password);
      if (kind === "managed") {
        row.protectionFormat = "sorng-db";
        await manager.unlockManagedDatabase(row.id, "vault");
      }
      await manager.selectDatabase(
        row.id,
        kind === "legacy" ? password : undefined,
      );
      const draft = structuredClone(data);
      const history = structuredClone(data.recordMetadata!);
      const runtime = draft.connections[0] as unknown as {
        createdAt: Date;
        updatedAt: Date;
      };
      runtime.createdAt = new Date(draft.connections[0].createdAt);
      runtime.updatedAt = new Date(draft.connections[0].updatedAt);
      await manager.saveCurrentDatabaseData(draft);
      const saved =
        kind === "legacy"
          ? (JSON.parse(
              await decryptWithPassword(stored as string, password),
            ) as StorageData)
          : kind === "managed"
            ? data
            : (stored as StorageData);
      expect(saved.connections[0].createdAt).toBe(
        runtime.createdAt.toISOString(),
      );
      expect(saved.connections[0].updatedAt).toBe(
        runtime.updatedAt.toISOString(),
      );
      expect(saved.recordMetadata).toEqual(history);
      expect(runtime.createdAt).toBeInstanceOf(Date);
      expect(row.isEncrypted).toBe(kind !== "plain");
      if (kind === "managed") {
        expect(
          bridge.invoke.mock.calls.some(
            ([command]) => command === "save_database_data",
          ),
        ).toBe(false);
        expect(row.protectionFormat).toBe("sorng-db");
      }
    },
  );
});
