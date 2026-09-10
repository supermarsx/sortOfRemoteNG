import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import type { StorageData } from "../../src/utils/storage/storage";
import type { Connection } from "../../src/types/connection/connection";
import { normalizeRecycleBin } from "../../src/utils/connection/recycleBin";
import { containsExportSecrets } from "../../src/components/ImportExport/exportSecurity";
import {
  decryptWithPassword,
  isWebCryptoPayload,
} from "../../src/utils/crypto/webCryptoAes";

// Real database manager and WebCrypto over the test runner's fake IndexedDB only.
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));

const fixture = (): StorageData => {
  // Crafted legacy extension data must be scrubbed even though the current
  // editor does not offer this field. Keep its shape explicit in the fixture.
  const connection: Connection & { customFields: Record<string, unknown> } = {
    id: "archived-device",
    name: "Password=synthetic-name-secret",
    protocol: "ssh" as const,
    hostname: "archived.example",
    port: 22,
    isGroup: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    password: "synthetic-password",
    privateKey: "synthetic-private-key",
    httpHeaders: {
      Authorization: "Bearer synthetic-bearer-token",
      "X-Safe": "safe",
    },
    customFields: {
      nested: { clientSecret: "synthetic-client-secret", label: "safe-label" },
    },
  };
  const liveConnection: Connection & { customFields: Record<string, unknown> } =
    {
      ...connection,
      id: "live-device",
      name: "Live device",
      password: undefined,
      privateKey: undefined,
      httpHeaders: {},
      customFields: {},
    };
  return {
    connections: [liveConnection],
    settings: {},
    timestamp: 1,
    recycleBin: {
      version: 1,
      revision: "fixture-revision",
      policy: { mode: "days", days: 31 },
      entries: [
        {
          id: "batch/archived-device",
          batchId: "batch",
          deletedAt: Date.parse("2026-09-08T00:00:00Z"),
          connection,
        },
      ],
    },
  };
};

describe("full database Recycle Bin portability", () => {
  let manager: DatabaseManager;
  let id: string;
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
    id = (await manager.createDatabase("Synthetic source")).id;
    await manager.saveDatabaseData(id, fixture());
  });
  afterEach(() => {
    DatabaseManager.resetInstance();
    vi.restoreAllMocks();
  });

  it("redacts nested archived secrets and secret-like names while remaining importable", async () => {
    const json = await manager.exportDatabase(id, false);
    const exported = JSON.parse(json) as StorageData;
    const bin = normalizeRecycleBin(exported.recycleBin);
    expect(bin.policy).toEqual({ mode: "days", days: 31 });
    expect(bin.entries).toHaveLength(1);
    expect(bin.entries[0].connection.name).toBe("[Redacted connection]");
    expect(containsExportSecrets(bin)).toBe(false);
    for (const secret of [
      "synthetic-password",
      "synthetic-private-key",
      "synthetic-bearer-token",
      "synthetic-client-secret",
      "synthetic-name-secret",
    ])
      expect(json).not.toContain(secret);
    const imported = await manager.importDatabase(json, {
      collectionName: "Redacted copy",
      includeTrust: false,
    });
    expect((await manager.loadDatabaseData(imported.id))?.recycleBin).toEqual(
      bin,
    );
    expect((await manager.loadDatabaseData(id))?.recycleBin).toEqual(
      fixture().recycleBin,
    );
  });
  it("preserves reference-only MFA metadata and removes malformed secret-bearing MFA extensions", async () => {
    const data = fixture();
    const metadata = {
      version: 1 as const,
      enabled: true,
      origin: "https://nas.example",
      totpConfigId: "auth",
      challengeId: "wordpress-two-factor-totp",
    };
    data.connections[0].httpAutoMfa = metadata;
    data.connections[0].totpConfigs = [
      {
        id: "auth",
        secret: "MFA-SYNTHETIC-SEED",
        backupCodes: ["MFA-SYNTHETIC-BACKUP"],
        issuer: "Fixture",
        account: "Demo",
        algorithm: "sha1",
        digits: 6,
        period: 30,
      },
    ];
    await manager.saveDatabaseData(id, data);
    const safe = await manager.exportDatabase(id, false);
    expect(safe).not.toMatch(/MFA-SYNTHETIC/);
    expect(JSON.parse(safe).connections[0].httpAutoMfa).toEqual(metadata);
    const copy = await manager.importDatabase(safe, {
      collectionName: "MFA metadata",
      includeTrust: false,
    });
    expect(
      (await manager.loadDatabaseData(copy.id))?.connections[0].httpAutoMfa,
    ).toEqual(metadata);
    Object.assign(data.connections[0].httpAutoMfa!, {
      secret: "MFA-HIDDEN-SECRET",
    });
    await manager.saveDatabaseData(id, data);
    expect(await manager.exportDatabase(id, false)).not.toContain(
      "MFA-HIDDEN-SECRET",
    );
  });

  it("retains complete archived records and indefinite policy when credentials are explicitly included", async () => {
    const data = fixture();
    data.recycleBin!.policy = { mode: "forever" };
    await manager.saveDatabaseData(id, data);
    const json = await manager.exportDatabase(id, true);
    const imported = await manager.importDatabase(json, {
      collectionName: "Full copy",
      includeTrust: false,
    });
    expect((await manager.loadDatabaseData(imported.id))?.recycleBin).toEqual(
      data.recycleBin,
    );
  });

  it("keeps archived payload inside an actual password-encrypted portable envelope", async () => {
    const password = "Synthetic-portable-passphrase-42";
    const encrypted = await manager.exportDatabase(id, true, password);
    expect(isWebCryptoPayload(encrypted)).toBe(true);
    expect(encrypted).not.toContain("synthetic-password");
    expect(
      JSON.parse(await decryptWithPassword(encrypted, password)).recycleBin,
    ).toEqual(fixture().recycleBin);
    const imported = await manager.importDatabase(encrypted, {
      importPassword: password,
      collectionName: "Encrypted portable copy",
      includeTrust: false,
    });
    expect((await manager.loadDatabaseData(imported.id))?.recycleBin).toEqual(
      fixture().recycleBin,
    );
  });

  it("does not promote archived records into the ordinary connection list or invent bins in older exports", async () => {
    const exported = JSON.parse(
      await manager.exportDatabase(id, true),
    ) as StorageData;
    expect(exported.connections.map((entry) => entry.id)).toEqual([
      "live-device",
    ]);
    expect(JSON.stringify(exported.connections)).not.toContain(
      "archived-device",
    );
    expect(JSON.stringify(exported.connections)).not.toContain("recycleBin");
    const { recycleBin: omitted, ...legacy } = fixture();
    expect(omitted).toBeDefined();
    await manager.saveDatabaseData(id, legacy);
    expect(
      JSON.parse(await manager.exportDatabase(id, true)),
    ).not.toHaveProperty("recycleBin");
  });

  it("duplicates the full bin into a separate database without changing its source", async () => {
    const clone = await manager.duplicateDatabase(id, {
      name: "Synthetic clone",
      includeTrust: false,
    });
    expect(clone.id).not.toBe(id);
    expect((await manager.loadDatabaseData(clone.id))?.recycleBin).toEqual(
      fixture().recycleBin,
    );
    expect((await manager.loadDatabaseData(id))?.recycleBin).toEqual(
      fixture().recycleBin,
    );
    expect(manager.getCurrentDatabase()).toBeNull();
  });
});
