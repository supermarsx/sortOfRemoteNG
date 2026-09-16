import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { serializePersistedConnectionSession } from "../../src/utils/session/sessionPersistence";
import { resolveLocalSynologyAuthenticator } from "../../src/utils/synology/synologyAuthenticator";
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
const connection: Connection = {
  id: "nas",
  name: "Synthetic NAS",
  protocol: "synology",
  hostname: "nas.example.test",
  port: 5001,
  username: "nas-user",
  password: "synthetic-private-secret",
  isGroup: false,
  createdAt: "2026-09-01",
  updatedAt: "2026-09-01",
  synologySettings: { version: 1, useHttps: true },
};
describe("Synology database portability", () => {
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
    id = (await manager.createDatabase("Synthetic NAS collection")).id;
    await manager.saveDatabaseData(id, {
      connections: [connection],
      settings: {},
      timestamp: 1,
    });
  });
  afterEach(() => {
    DatabaseManager.resetInstance();
    vi.restoreAllMocks();
  });
  it("roundtrips full/redacted exports and clones nonsecret native settings", async () => {
    const full = await manager.exportDatabase(id, true);
    const safe = await manager.exportDatabase(id, false);
    expect(full).toContain("synthetic-private-secret");
    expect(safe).not.toContain("synthetic-private-secret");
    expect(JSON.parse(safe).connections[0]).toMatchObject({
      protocol: "synology",
      synologySettings: { version: 1, useHttps: true },
    });
    const imported = await manager.importDatabase(safe, {
      collectionName: "Redacted NAS import",
    });
    expect(
      (await manager.loadDatabaseData(imported.id))?.connections[0],
    ).toMatchObject({
      protocol: "synology",
      synologySettings: { version: 1, useHttps: true },
    });
    const clone = await manager.duplicateDatabase(id, {
      name: "NAS clone",
      includeTrust: false,
    });
    expect(
      (await manager.loadDatabaseData(clone.id))?.connections[0],
    ).toMatchObject(connection);
  });
  it("carries the trusted-device preference through export, import and clone without any device token", async () => {
    const trusted: Connection = {
      ...connection,
      id: "nas-trusted",
      name: "Trusted NAS",
      synologySettings: { version: 1, useHttps: true, trustDevice: true },
    };
    await manager.saveDatabaseData(id, {
      connections: [connection, trusted],
      settings: {},
      timestamp: 2,
    });
    const find = (rows: Connection[] | undefined) =>
      rows?.find((row) => row.id === trusted.id);
    for (const includePasswords of [true, false]) {
      const exported = await manager.exportDatabase(id, includePasswords);
      expect(exported).not.toMatch(/deviceId|trustedDevice|deviceTrust/);
      const rows = JSON.parse(exported).connections as Connection[];
      expect(find(rows)?.synologySettings).toEqual(trusted.synologySettings);
      // Older records without the preference stay exactly as they were.
      expect(
        rows.find((row) => row.id === connection.id)?.synologySettings,
      ).toEqual({ version: 1, useHttps: true });
      const imported = await manager.importDatabase(exported, {
        collectionName: `Trusted NAS import ${includePasswords}`,
      });
      expect(
        find((await manager.loadDatabaseData(imported.id))?.connections)
          ?.synologySettings,
      ).toEqual(trusted.synologySettings);
    }
    const clone = await manager.duplicateDatabase(id, {
      name: "Trusted NAS clone",
      includeTrust: false,
    });
    expect(
      find((await manager.loadDatabaseData(clone.id))?.connections)
        ?.synologySettings,
    ).toEqual(trusted.synologySettings);
  });
  it("keeps the NAS API authenticator reference while a redacted export removes its secret", async () => {
    const seed = "JBSWY3DPEHPK3PXPSYNTHETICSEED234";
    const automatic: Connection = {
      ...connection,
      id: "nas-automatic",
      name: "Automatic NAS",
      protocol: "https",
      httpApplication: { version: 1, id: "synology-dsm", loginMode: "manual" },
      synologySettings: {
        version: 1,
        useHttps: true,
        accessMode: "native",
        otpAuthenticatorId: "dsm-authenticator",
      },
      totpConfigs: [
        {
          id: "dsm-authenticator",
          secret: seed,
          issuer: "Synology DSM",
          account: "nas-user",
          digits: 6,
          period: 30,
          algorithm: "sha1",
        },
      ],
    };
    await manager.saveDatabaseData(id, {
      connections: [connection, automatic],
      settings: {},
      timestamp: 3,
    });
    const find = (rows: Connection[] | undefined) =>
      rows?.find((row) => row.id === automatic.id);

    const safe = await manager.exportDatabase(id, false);
    expect(safe).not.toContain(seed);
    const exported = find(JSON.parse(safe).connections)!;
    expect(exported.synologySettings).toEqual(automatic.synologySettings);
    expect(exported.totpConfigs).toEqual([
      {
        id: "dsm-authenticator",
        issuer: "Synology DSM",
        account: "nas-user",
        digits: 6,
        period: 30,
        algorithm: "sha1",
      },
    ]);
    expect(resolveLocalSynologyAuthenticator(exported)).toEqual({
      kind: "unavailable",
      reason: "no-secret",
    });
    const redacted = find(
      (
        await manager.loadDatabaseData(
          (
            await manager.importDatabase(safe, {
              collectionName: "Redacted automatic NAS import",
            })
          ).id,
        )
      )?.connections,
    )!;
    expect(redacted.synologySettings).toEqual(automatic.synologySettings);
    expect(JSON.stringify(redacted)).not.toContain(seed);
    expect(resolveLocalSynologyAuthenticator(redacted)).toEqual({
      kind: "unavailable",
      reason: "no-secret",
    });

    // A full export and a clone carry the secret with the connection's other credentials.
    const full = await manager.importDatabase(
      await manager.exportDatabase(id, true),
      { collectionName: "Full automatic NAS import" },
    );
    const clone = await manager.duplicateDatabase(id, {
      name: "Automatic NAS clone",
      includeTrust: false,
    });
    for (const copy of [full.id, clone.id]) {
      const row = find((await manager.loadDatabaseData(copy))?.connections)!;
      expect(row.synologySettings).toEqual(automatic.synologySettings);
      expect(resolveLocalSynologyAuthenticator(row)).toEqual({
        kind: "ready",
        config: automatic.totpConfigs![0],
      });
    }
  });
  it("persists only safe session identity, never credentials or OTP", () => {
    const session: ConnectionSession = {
      id: "tab",
      connectionId: connection.id,
      ownerDatabaseId: id,
      protocol: "synology",
      hostname: connection.hostname,
      name: connection.name,
      status: "connected",
      startTime: new Date(),
    };
    const json = JSON.stringify(serializePersistedConnectionSession(session));
    expect(json).not.toContain("synthetic-private-secret");
    expect(json).not.toContain("otpCode");
    expect(json).not.toContain("password");
  });
});
