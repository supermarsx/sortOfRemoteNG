import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";
import { captureCloudSyncPayload } from "../../src/utils/services/cloudSyncPayload";

const fixture = vi.hoisted(() => ({
  owner: "db1",
  format: "sorng-db",
  access: "ready",
  epoch: 1,
  inventory: vi.fn(),
  read: vi.fn(),
  guard: vi.fn(),
  release: vi.fn(),
  unlock: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({
        id: fixture.owner,
        protectionFormat: fixture.format,
      }),
      getDatabaseAccessState: () => ({ status: fixture.access }),
      captureDatabaseOperationGuard: fixture.guard,
      getExportableDatabases: fixture.inventory,
      readFullDatabaseArchive: fixture.read,
      unlockManagedDatabase: fixture.unlock,
      restoreCloudSyncArchive: fixture.restore,
    }),
  },
}));
vi.mock("../../src/utils/services/cloudSyncDatabaseBarrier", () => ({
  acquireCloudSyncDatabaseBarrier: async () => fixture.release,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => async () => null,
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ getSettings: () => ({}) }) },
}));
vi.mock("../../src/utils/connection/fullDatabaseArchive", () => ({
  normalizeFullDatabaseArchive: async (value: unknown) => value,
  fullDatabaseArchiveErrorDetail: () => "",
}));

const row = (available: boolean) => ({
  id: "db1",
  name: "Synthetic database",
  protectionFormat: "sorng-db",
  isEncrypted: true,
  isExportable: available,
});
const config = {
  ...defaultCloudSyncConfig,
  selectedItems: ["database:db1"],
  encryptBeforeSync: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  fixture.owner = "db1";
  fixture.format = "sorng-db";
  fixture.access = "ready";
  fixture.epoch = 1;
  fixture.inventory.mockResolvedValue([row(true)]);
  fixture.release.mockResolvedValue(undefined);
  fixture.guard.mockImplementation(() => {
    const owner = fixture.owner,
      epoch = fixture.epoch;
    return {
      assertCurrent: () => {
        if (
          fixture.owner !== owner ||
          fixture.epoch !== epoch ||
          fixture.access !== "ready"
        )
          throw new Error("Owning database access changed");
      },
    };
  });
  fixture.read.mockResolvedValue({
    format: "sorng-full-database",
    version: 1,
    collection: { id: "db1" },
    connections: [],
    settings: { newestEdit: "synthetic" },
  });
});

describe("bounded cloud inventory recovery", () => {
  it.each([[[]], [[row(false)]]])(
    "re-discovers a transient missing/locked row under the current live lease %#",
    async (stale) => {
      fixture.inventory.mockResolvedValueOnce(stale);
      const result = await captureCloudSyncPayload(config);
      expect(fixture.inventory).toHaveBeenCalledTimes(2);
      expect(fixture.guard).toHaveBeenCalledWith(["db1"]);
      expect(fixture.read).toHaveBeenCalledExactlyOnceWith("db1", {
        materializeDefaults: true,
      });
      expect(result.sections["database:db1"]).toMatchObject({
        settings: { newestEdit: "synthetic" },
      });
      expect(fixture.unlock).not.toHaveBeenCalled();
      expect(fixture.restore).not.toHaveBeenCalled();
      expect(fixture.release).toHaveBeenCalledOnce();
    },
  );

  it("stops after one metadata retry without unlocking, changing selection, or reading unavailable contents", async () => {
    fixture.inventory.mockResolvedValue([row(false)]);
    await expect(captureCloudSyncPayload(config)).rejects.toThrow(
      "unavailable",
    );
    expect(fixture.inventory).toHaveBeenCalledTimes(2);
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.unlock).not.toHaveBeenCalled();
    expect(fixture.restore).not.toHaveBeenCalled();
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it.each(["locked", "expired", "other-owner", "legacy"])(
    "never auto-recovers %s access",
    async (state) => {
      if (state === "other-owner") fixture.owner = "db2";
      else if (state === "legacy") fixture.format = "legacy";
      else fixture.access = state;
      fixture.inventory.mockResolvedValue([row(false)]);
      await expect(captureCloudSyncPayload(config)).rejects.toThrow(
        "unavailable",
      );
      expect(fixture.inventory).toHaveBeenCalledOnce();
      expect(fixture.guard).not.toHaveBeenCalled();
      expect(fixture.read).not.toHaveBeenCalled();
      expect(fixture.unlock).not.toHaveBeenCalled();
    },
  );

  it.each(["selection", "access-epoch", "lock"])(
    "rejects %s changes during rediscovery",
    async (change) => {
      fixture.inventory
        .mockResolvedValueOnce([row(false)])
        .mockImplementationOnce(async () => {
          if (change === "selection") fixture.owner = "db2";
          else if (change === "access-epoch") fixture.epoch++;
          else fixture.access = "suspended";
          return [row(true)];
        });
      await expect(captureCloudSyncPayload(config)).rejects.toThrow(/changed/);
      expect(fixture.read).not.toHaveBeenCalled();
      expect(fixture.release).toHaveBeenCalledOnce();
    },
  );

  it("does not retry archive read errors or unknown write outcomes after availability succeeds", async () => {
    fixture.inventory.mockResolvedValueOnce([row(false)]);
    fixture.read.mockRejectedValue(new Error("synthetic archive read failure"));
    await expect(captureCloudSyncPayload(config)).rejects.toThrow(
      "synthetic archive read failure",
    );
    expect(fixture.inventory).toHaveBeenCalledTimes(2);
    expect(fixture.read).toHaveBeenCalledOnce();
    expect(fixture.restore).not.toHaveBeenCalled();
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("never substitutes another database or drops an unavailable selected artifact after recovery", async () => {
    fixture.inventory.mockResolvedValueOnce([row(false)]);
    await expect(
      captureCloudSyncPayload({
        ...config,
        selectedItems: ["database:db1", "database:db2"],
      }),
    ).rejects.toThrow(/unavailable/);
    expect(fixture.inventory).toHaveBeenCalledTimes(2);
    expect(fixture.read).not.toHaveBeenCalledWith("db2");
    expect(fixture.restore).not.toHaveBeenCalled();
    expect(fixture.unlock).not.toHaveBeenCalled();
  });

  it("captures the newest contents only after rediscovery without loading a stale writer baseline", async () => {
    fixture.inventory
      .mockResolvedValueOnce([row(false)])
      .mockImplementationOnce(async () => {
        fixture.read.mockResolvedValue({
          format: "sorng-full-database",
          version: 1,
          collection: { id: "db1" },
          connections: [{ id: "newer", name: "Synthetic new edit" }],
        });
        return [row(true)];
      });
    expect(
      (await captureCloudSyncPayload(config)).sections["database:db1"],
    ).toMatchObject({
      connections: [{ id: "newer", name: "Synthetic new edit" }],
    });
    expect(fixture.read).toHaveBeenCalledOnce();
    expect(fixture.restore).not.toHaveBeenCalled();
  });

  it("pins ownership before the first inventory read, not just before the retry", async () => {
    fixture.inventory.mockImplementationOnce(async () => {
      fixture.epoch++;
      return [row(false)];
    });
    await expect(captureCloudSyncPayload(config)).rejects.toThrow(
      "access changed",
    );
    expect(fixture.inventory).toHaveBeenCalledOnce();
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("propagates metadata refresh failures after the one permitted read", async () => {
    fixture.inventory
      .mockResolvedValueOnce([row(false)])
      .mockRejectedValueOnce(new Error("synthetic index read error"));
    await expect(captureCloudSyncPayload(config)).rejects.toThrow(
      "synthetic index read error",
    );
    expect(fixture.inventory).toHaveBeenCalledTimes(2);
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("leaves available and excluded selections on the single-discovery path", async () => {
    await captureCloudSyncPayload(config);
    expect(fixture.inventory).toHaveBeenCalledOnce();
    fixture.inventory.mockClear().mockResolvedValue([row(false)]);
    fixture.read.mockClear();
    expect(
      await captureCloudSyncPayload({
        ...config,
        excludePatterns: ["database:db1"],
      }),
    ).toEqual({ version: 1, sections: {} });
    expect(fixture.inventory).toHaveBeenCalledOnce();
    expect(fixture.read).not.toHaveBeenCalled();
  });
});
