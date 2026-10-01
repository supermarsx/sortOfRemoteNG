import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import {
  encryptWithPassword,
  decryptWithPassword,
} from "../../src/utils/crypto/webCryptoAes";
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
let stored: unknown;
const password = "Synthetic-local-unlock-123!";
const legacy = (): StorageData => ({
  connections: [
    connection("server"),
    { ...connection("folder"), isGroup: true },
  ],
  settings: { theme: "dark" },
  colorTags: { urgent: { name: "Urgent", color: "red" } },
  timestamp: Date.parse("2026-01-01T00:00:00Z"),
});
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  DatabaseManager.resetInstance();
  row = {
    id: "db",
    name: "Fixture",
    isEncrypted: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastAccessed: "2026-01-01T00:00:00Z",
  };
  stored = legacy();
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command, args) => {
    if (command === "databases_list")
      return { value: [structuredClone(row)], source: "current" };
    if (command === "databases_save_index") {
      row = structuredClone(args.list[0]);
      return;
    }
    if (command === "load_database_data")
      return { value: structuredClone(stored), source: "current" };
    if (command === "save_database_data") {
      if (JSON.stringify(args.expectedData) !== JSON.stringify(stored))
        throw new Error("Concurrent edit; refused CAS");
      stored = structuredClone(args.data);
      return;
    }
    if (command === "trust_set_active_database") return;
    throw new Error(`Unexpected command ${command}`);
  });
});
const writes = () =>
  bridge.invoke.mock.calls.filter(
    ([command]) => command === "save_database_data",
  );

describe("database record timestamp migration", () => {
  it("migrates on open exactly once without changing domain content", async () => {
    const manager = DatabaseManager.getInstance();
    const before = structuredClone(stored);
    await manager.selectDatabase("db");
    const migrated = stored as StorageData;
    expect(migrated).toMatchObject(before as StorageData);
    expect(migrated.recordMetadata?.version).toBe(1);
    expect(
      Object.keys(migrated.recordMetadata!.records).some((key) =>
        key.includes("server"),
      ),
    ).toBe(true);
    expect(
      Object.keys(migrated.recordMetadata!.records).some((key) =>
        key.includes("urgent"),
      ),
    ).toBe(true);
    expect(writes()).toHaveLength(1);
    await manager.selectDatabase("db");
    expect(writes()).toHaveLength(1);
  });

  it("keeps password-protected legacy data encrypted and never migrates while locked", async () => {
    row.isEncrypted = true;
    stored = await encryptWithPassword(JSON.stringify(legacy()), password);
    const ciphertext = stored;
    const manager = DatabaseManager.getInstance();
    await expect(manager.selectDatabase("db")).rejects.toThrow(/Password/);
    expect(stored).toBe(ciphertext);
    expect(writes()).toHaveLength(0);
    await manager.selectDatabase("db", password);
    expect(typeof stored).toBe("string");
    expect(stored).not.toContain("recordMetadata");
    const plaintext = JSON.parse(
      await decryptWithPassword(stored as string, password),
    );
    expect(plaintext.recordMetadata.version).toBe(1);
    expect(writes()[0][1].expectedData).toBe(ciphertext);
    expect(JSON.stringify(writes())).not.toContain(password);
  });

  it("tracks actual writes and deletion even when UI rebuilds the payload without metadata", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.selectDatabase("db");
    const before = (stored as StorageData).recordMetadata!;
    const key = Object.keys(before.records).find((key) =>
      key.includes("server"),
    )!;
    const changed = legacy();
    changed.connections[0].name = "Renamed";
    await manager.saveCurrentDatabaseData(changed);
    const edited = (stored as StorageData).recordMetadata!;
    expect(edited.records[key].createdAt).toBe(before.records[key].createdAt);
    expect(edited.records[key].revision).not.toBe(before.records[key].revision);
    expect(edited.journal.length).toBeGreaterThan(before.journal.length);
    changed.connections = changed.connections.filter((c) => c.id !== "server");
    await manager.saveCurrentDatabaseData(changed);
    expect(
      (stored as StorageData).recordMetadata!.records[key].deletedAt,
    ).toBeTruthy();
  });

  it("does not bless a stale writer or replace malformed future history", async () => {
    const manager = DatabaseManager.getInstance();
    await manager.selectDatabase("db");
    const draft = await manager.loadCurrentDatabaseData();
    (stored as StorageData).connections[0].name = "Other window";
    draft!.connections[0].name = "Stale write";
    await expect(manager.saveCurrentDatabaseData(draft!)).rejects.toThrow(
      /Concurrent/,
    );
    expect((stored as StorageData).connections[0].name).toBe("Other window");
    (stored as StorageData).recordMetadata = { version: 999 } as never;
    const before = JSON.stringify(stored);
    await expect(manager.loadCurrentDatabaseData()).rejects.toThrow();
    expect(JSON.stringify(stored)).toBe(before);
  });
});
