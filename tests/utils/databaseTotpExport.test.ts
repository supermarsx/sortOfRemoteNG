import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import type { StorageData } from "../../src/utils/storage/storage";
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
const config = {
  secret: "SYNTHETIC-TOTP-SEED",
  backupCodes: ["synthetic-recovery-code"],
  account: "Demo account",
  issuer: "Demo issuer",
  digits: 6,
  period: 30,
  algorithm: "sha1" as const,
  createdAt: "2026-09-09T00:00:00Z",
};
const data: StorageData = {
  connections: [
    {
      id: "synthetic-web",
      name: "Synthetic website",
      isGroup: false,
      protocol: "https",
      hostname: "demo.example.test",
      port: 443,
      createdAt: "2026-09-09T00:00:00Z",
      updatedAt: "2026-09-09T00:00:00Z",
      totpSecret: "legacy-synthetic-seed",
      totpConfigs: [config],
    },
  ],
  settings: {},
  timestamp: 1,
};

describe("full database TOTP secret export boundary", () => {
  let manager: DatabaseManager, id: string;
  beforeEach(async () => {
    await IndexedDbService.init();
    const db = await openDB("mremote-keyval", 1);
    await db.clear("keyval");
    db.close();
    DatabaseManager.resetInstance();
    vi.spyOn(SettingsManager.prototype, "logAction").mockImplementation(
      () => {},
    );
    manager = DatabaseManager.getInstance();
    id = (await manager.createDatabase("Synthetic 2FA fixture")).id;
    await manager.saveDatabaseData(id, data);
  });
  afterEach(() => {
    DatabaseManager.resetInstance();
    vi.restoreAllMocks();
  });
  it("omits enrolled seeds and backup codes while retaining metadata and importability", async () => {
    const json = await manager.exportDatabase(id, false);
    for (const secret of [
      config.secret,
      config.backupCodes[0],
      "legacy-synthetic-seed",
    ])
      expect(json).not.toContain(secret);
    const exported = JSON.parse(json) as StorageData;
    expect(exported.connections[0].totpConfigs).toEqual([
      {
        account: config.account,
        issuer: config.issuer,
        digits: 6,
        period: 30,
        algorithm: "sha1",
        createdAt: config.createdAt,
      },
    ]);
    const imported = await manager.importDatabase(json, {
      collectionName: "Safe 2FA copy",
      includeTrust: false,
    });
    expect(
      (await manager.loadDatabaseData(imported.id))?.connections[0].totpConfigs,
    ).toEqual(exported.connections[0].totpConfigs);
    expect(
      (await manager.loadDatabaseData(id))?.connections[0].totpConfigs,
    ).toEqual([config]);
    expect(data.connections[0].totpConfigs).toEqual([config]);
  });
  it("retains complete enrolled configs only when credential inclusion is explicit", async () => {
    const json = await manager.exportDatabase(id, true);
    expect(JSON.parse(json).connections[0].totpConfigs).toEqual([config]);
    const imported = await manager.importDatabase(json, {
      collectionName: "Full 2FA copy",
      includeTrust: false,
    });
    expect(
      (await manager.loadDatabaseData(imported.id))?.connections[0].totpConfigs,
    ).toEqual([config]);
  });
});
