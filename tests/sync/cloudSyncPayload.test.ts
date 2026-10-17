import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";
import type { ExportableDatabaseInfo } from "../../src/utils/connection/databaseManager";
import * as inventorySize from "../../src/utils/services/cloudSyncInventorySize";
import {
  applyCloudSyncPayload,
  captureCloudSyncPayload,
  discoverCloudSyncItems,
  validateCloudSyncPayload,
  canRepairCloudSyncDatabase,
} from "../../src/utils/services/cloudSyncPayload";
import { FullDatabaseArchiveError } from "../../src/utils/connection/fullDatabaseArchive";

const state = vi.hoisted(() => ({
  raw: new Map<string, string>(),
  owner: "db1",
  accessEpoch: 0,
  update: vi.fn(),
  restore: vi.fn(),
  read: vi.fn(),
  settingsReadFails: false,
  settingsWriteFails: false,
  databases: [] as Partial<ExportableDatabaseInfo>[],
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: state.owner }),
      captureDatabaseRepairGuard: () => {
        const epoch = state.accessEpoch;
        return () => {
          if (epoch !== state.accessEpoch)
            throw new Error("Database access epoch changed");
        };
      },
      getExportableDatabases: async () => state.databases,
      readFullDatabaseArchive: state.read,
      restoreCloudSyncArchive: state.restore,
    }),
  },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => async (command: string, args?: { key: string }) => {
    if (command === "read_app_settings" && state.settingsReadFails)
      throw new Error("private native error");
    return command === "read_app_settings"
      ? JSON.parse(state.raw.get("settings") ?? "null")
      : (state.raw.get(args!.key) ?? null);
  },
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      getSettings: () =>
        JSON.parse(
          state.raw.get("memory-settings") ?? state.raw.get("settings") ?? "{}",
        ),
      saveCloudSyncSettings: async (patch: unknown, expected: unknown) => {
        if (state.settingsWriteFails) throw new Error("settings write failed");
        expect(expected).toEqual({ theme: "dark" });
        state.raw.set(
          "settings",
          JSON.stringify({
            ...JSON.parse(state.raw.get("settings")!),
            ...(patch as object),
          }),
        );
      },
    }),
  },
}));
vi.mock("../../src/utils/recording/managedScriptPersistence", () => ({
  nativeManagedScriptsStore: {
    key: "recording.managed-scripts",
    load: async () => {
      const raw = state.raw.get("recording.managed-scripts");
      if (raw === undefined) return { value: null, sanitized: false };
      const value = JSON.parse(raw);
      const { reconcileRecordLedger } =
        await import("../../src/utils/storage/recordLedger");
      value.recordMetadata = await reconcileRecordLedger(
        value,
        value.recordMetadata,
        { mode: "migrate" },
      );
      state.raw.set("recording.managed-scripts", JSON.stringify(value));
      return { value, sanitized: true };
    },
    update: (fn: (value: unknown) => unknown) => state.update(fn),
  },
}));
const id = "app:recording.managed-scripts";
const key = "recording.managed-scripts";
const scripts = {
  customScripts: [],
  modifiedDefaults: [],
  deletedDefaultIds: [] as string[],
};
const config = {
  ...defaultCloudSyncConfig,
  selectedItems: [id],
  encryptBeforeSync: true,
};

describe("automatic dependency repair selection", () => {
  const selectedDatabase = { ...config, selectedItems: ["database:db1"] };
  const inventory = [
    {
      id: "database:db1",
      label: "Private database",
      kind: "database",
      available: true,
    },
  ];
  it("requires a selected available database and encrypted sync", () => {
    expect(canRepairCloudSyncDatabase(selectedDatabase, "db1", inventory)).toBe(
      true,
    );
    expect(
      canRepairCloudSyncDatabase(selectedDatabase, "other", inventory),
    ).toBe(false);
    expect(
      canRepairCloudSyncDatabase(selectedDatabase, "db1", [
        { ...inventory[0], available: false },
      ]),
    ).toBe(false);
    expect(() =>
      canRepairCloudSyncDatabase(
        { ...selectedDatabase, encryptBeforeSync: false },
        "db1",
        inventory,
      ),
    ).toThrow("encrypted cloud sync");
  });
  it.each(["database:db1", "database/db1.json", "Private *"])(
    "honors the existing exclusion %s",
    (pattern) => {
      expect(
        canRepairCloudSyncDatabase(
          { ...selectedDatabase, excludePatterns: [pattern] },
          "db1",
          inventory,
        ),
      ).toBe(false);
    },
  );
  it("passes a matching initial local dependency failure with a retained owner fence", async () => {
    const error = new FullDatabaseArchiveError("dependencies", {
      databaseId: "db1",
      totalIssues: 1,
      issues: [],
    });
    state.read.mockRejectedValueOnce(error);
    const callback = vi.fn();
    await expect(
      captureCloudSyncPayload(selectedDatabase, {
        onArchiveDependency: callback,
      }),
    ).rejects.toBe(error);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0]).toBe(error);
    const guard = callback.mock.calls[0][1];
    expect(() => guard()).not.toThrow();
    state.owner = "other";
    expect(() => guard()).toThrow("Database selection changed");
  });
  it("does not grant repair authority for a mismatched archive owner", async () => {
    const error = new FullDatabaseArchiveError("dependencies", {
      databaseId: "other",
      totalIssues: 1,
      issues: [],
    });
    state.read.mockRejectedValueOnce(error);
    const callback = vi.fn();
    await expect(
      captureCloudSyncPayload(selectedDatabase, {
        onArchiveDependency: callback,
      }),
    ).rejects.toBe(error);
    expect(callback).not.toHaveBeenCalled();
  });
  it("retains the original access epoch after a same-database lock/unlock with auto-unlock disabled", async () => {
    const error = new FullDatabaseArchiveError("dependencies", {
      databaseId: "db1",
      totalIssues: 1,
      issues: [],
    });
    state.read.mockRejectedValueOnce(error);
    const callback = vi.fn();
    await expect(
      captureCloudSyncPayload(
        { ...selectedDatabase, autoUnlockOsVaultDatabases: false },
        { allowAutoUnlock: false, onArchiveDependency: callback },
      ),
    ).rejects.toBe(error);
    const guard = callback.mock.calls[0][1];
    state.accessEpoch++;
    expect(() => guard()).toThrow("Database access epoch changed");
  });
  it("does not authorize repair if access changed during the initial failing database read", async () => {
    state.read.mockImplementationOnce(async () => {
      state.accessEpoch++;
      throw new FullDatabaseArchiveError("dependencies", {
        databaseId: "db1",
        totalIssues: 1,
        issues: [],
      });
    });
    const callback = vi.fn();
    await expect(
      captureCloudSyncPayload(selectedDatabase, {
        onArchiveDependency: callback,
      }),
    ).rejects.toThrow("Database access epoch changed");
    expect(callback).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  state.owner = "db1";
  state.accessEpoch = 0;
  state.settingsReadFails = false;
  state.settingsWriteFails = false;
  state.databases = [
    {
      id: "db1",
      name: "Actual database",
      isExportable: true,
      protectionFormat: "sorng-db",
    },
  ];
  state.raw.clear();
  state.raw.set(key, JSON.stringify(scripts));
  state.update.mockImplementation(async (fn) => {
    const value = fn(JSON.parse(state.raw.get(key)!));
    state.raw.set(key, JSON.stringify(value));
  });
});
describe("actual cloud sync artifacts", () => {
  it("names unavailable databases from the fresh inventory, including after a rename", async () => {
    state.databases[0].isExportable = false;
    for (const name of ["Work database", "Renamed database"]) {
      state.databases[0].name = name;
      await expect(
        captureCloudSyncPayload({ ...config, selectedItems: ["database:db1"] }),
      ).rejects.toThrow(
        `Database “${name}” is unavailable for cloud sync. Unlock this database here before syncing. If it was already unlocked, its session may have expired.`,
      );
    }
    expect(state.read).not.toHaveBeenCalled();
    expect(state.restore).not.toHaveBeenCalled();
  });

  it("uses a friendly missing-database error without leaking its internal selection ID", async () => {
    state.databases = [];
    await expect(
      captureCloudSyncPayload({ ...config, selectedItems: ["database:db1"] }),
    ).rejects.toThrow(
      /^A selected database is unavailable for cloud sync\. Review What to sync and select an existing, unlocked artifact\.$/,
    );
    expect(state.read).not.toHaveBeenCalled();
    expect(state.restore).not.toHaveBeenCalled();
  });

  it("accepts payload budgets above 64 MiB through exactly 100 MiB, but rejects one byte more", () => {
    const payload = {
      version: 1,
      sections: { "app:settings": { theme: "dark" } },
    };
    const measurement = vi.spyOn(inventorySize, "utf8Bytes");
    try {
      for (const bytes of [64 * 1024 * 1024 + 1, 100 * 1024 * 1024]) {
        measurement.mockReturnValue(bytes);
        expect(validateCloudSyncPayload(payload)).toEqual(payload);
        expect(JSON.parse(measurement.mock.calls[0][0])).toEqual(payload);
      }
      measurement.mockReturnValue(100 * 1024 * 1024 + 1);
      expect(() => validateCloudSyncPayload(payload)).toThrow(
        "Invalid cloud sync payload",
      );
    } finally {
      measurement.mockRestore();
    }
  });

  it.each([false, true])(
    "explains the unsupported database format and the review path (password: %s)",
    async (isEncrypted) => {
      state.databases = [
        {
          id: "db1",
          name: "Existing database",
          isExportable: true,
          isEncrypted,
        },
      ];
      const item = (await discoverCloudSyncItems())[0];
      expect(item.available).toBe(false);
      expect(item.unavailableReason).toContain(
        isEncrypted
          ? "older password-protected format"
          : "does not use native database protection",
      );
      expect(item.unavailableReason).toContain(
        "Settings → Current Database → Native cipher and unlock-method options",
      );
      expect(item.unavailableReason).toContain("review the protection change");
      expect(item.unavailableReason).not.toContain("managed protected");
      await expect(
        captureCloudSyncPayload({ ...config, selectedItems: ["database:db1"] }),
      ).rejects.toThrow(/unavailable/);
      expect(state.read).not.toHaveBeenCalled();
      expect(state.restore).not.toHaveBeenCalled();
    },
  );

  it("asks to unlock a supported database without suggesting conversion", async () => {
    state.databases[0].isExportable = false;
    const item = (await discoverCloudSyncItems())[0];
    expect(item.available).toBe(false);
    expect(item.unavailableReason).toMatch(
      /Unlock this database here before syncing/,
    );
    expect(item.unavailableReason).not.toContain("protection change");
  });

  it("does not show a format warning for an unlocked native-protected database", async () => {
    expect((await discoverCloudSyncItems())[0]).toMatchObject({
      available: true,
      unavailableReason: undefined,
    });
  });
  it("keeps other inventory available when settings read fails", async () => {
    state.settingsReadFails = true;
    const items = await discoverCloudSyncItems();
    expect(items.find((item) => item.id === id)?.available).toBe(true);
    expect(items.find((item) => item.id === "app:settings")).toMatchObject({
      available: false,
      unavailableReason: expect.stringMatching(/locked or unavailable/),
    });
    expect(JSON.stringify(items)).not.toContain("private native error");
    expect((await captureCloudSyncPayload(config)).sections[id]).toMatchObject(
      scripts,
    );
  });
  it("signals partial when a library committed before settings fails", async () => {
    state.raw.set("settings", JSON.stringify({ theme: "dark" }));
    const both = { ...config, selectedItems: ["app:settings", id] };
    const original = await captureCloudSyncPayload(both);
    state.settingsWriteFails = true;
    await expect(
      applyCloudSyncPayload(
        {
          version: 1,
          sections: { "app:settings": { theme: "light" }, [id]: scripts },
        },
        both,
        original,
      ),
    ).rejects.toMatchObject({
      kind: "partial",
      name: "CloudSyncPartialApplyError",
    });
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(JSON.parse(state.raw.get("settings")!).theme).toBe("dark");
  });
  it("rejects unsaved portable settings without fetching or applying credentials", async () => {
    state.raw.set("settings", JSON.stringify({ theme: "dark" }));
    state.raw.set("memory-settings", JSON.stringify({ theme: "light" }));
    await expect(
      captureCloudSyncPayload({ ...config, selectedItems: ["app:settings"] }),
    ).rejects.toThrow(/unsaved/);
  });
  it("discovers existing stores only", async () => {
    const items = await discoverCloudSyncItems();
    expect(items.map((item) => item.id)).toEqual(["database:db1", id]);
  });
  it("captures and applies portable settings without copying cloud credentials", async () => {
    state.raw.set(
      "settings",
      JSON.stringify({
        theme: "dark",
        cloudSync: { password: "synthetic" },
        sshPath: "local",
      }),
    );
    const prefs = {
      ...config,
      selectedItems: ["app:settings"],
      encryptBeforeSync: false,
    };
    const original = await captureCloudSyncPayload(prefs);
    expect(original.sections).toEqual({ "app:settings": { theme: "dark" } });
    await applyCloudSyncPayload(
      { version: 1, sections: { "app:settings": { theme: "light" } } },
      prefs,
      original,
    );
    expect(JSON.parse(state.raw.get("settings")!)).toEqual({
      theme: "light",
      cloudSync: { password: "synthetic" },
      sshPath: "local",
    });
  });
  it("honors virtual filename and label exclusion patterns on capture and apply", async () => {
    const original = await captureCloudSyncPayload(config);
    expect(
      (
        await captureCloudSyncPayload({
          ...config,
          excludePatterns: ["app/*.managed-scripts.json"],
        })
      ).sections,
    ).toEqual({});
    await expect(
      applyCloudSyncPayload(
        original,
        { ...config, excludePatterns: ["Saved terminal*"] },
        original,
      ),
    ).rejects.toThrow(/excluded/);
  });
  it("captures selected actual data and applies a changed subset", async () => {
    const original = await captureCloudSyncPayload(config);
    expect(original.sections).toMatchObject({ [id]: scripts });
    const next = { ...scripts, deletedDefaultIds: ["removed-default"] };
    await applyCloudSyncPayload(
      { version: 1, sections: { [id]: next } },
      config,
      original,
    );
    expect(JSON.parse(state.raw.get(key)!)).toMatchObject(next);
    expect(JSON.parse(state.raw.get(key)!).recordMetadata.version).toBe(1);
    await applyCloudSyncPayload({ version: 1, sections: {} }, config, original);
    expect(state.update).toHaveBeenCalledTimes(1);
  });
  it("rejects unencrypted secrets, unknown paths and unrelated remote items", async () => {
    await expect(
      captureCloudSyncPayload({ ...config, encryptBeforeSync: false }),
    ).rejects.toThrow(/encrypted/);
    expect(() =>
      validateCloudSyncPayload({
        version: 1,
        sections: { "../../secret": {} },
      }),
    ).toThrow();
    await expect(
      applyCloudSyncPayload(
        { version: 1, sections: { [id]: scripts } },
        { ...config, selectedItems: [] },
      ),
    ).rejects.toThrow(/unselected/);
  });
  it("rejects local edits before apply and at the write boundary", async () => {
    const original = await captureCloudSyncPayload(config);
    state.raw.set(
      key,
      JSON.stringify({ ...scripts, deletedDefaultIds: ["local"] }),
    );
    await expect(
      applyCloudSyncPayload(original, config, original),
    ).rejects.toThrow(/changed/);
    state.raw.set(key, JSON.stringify(scripts));
    state.update.mockImplementationOnce(async (fn) =>
      fn({ ...scripts, deletedDefaultIds: ["racing"] }),
    );
    await expect(
      applyCloudSyncPayload(original, config, original),
    ).rejects.toThrow(/changed/);
  });
  it("rejects accessor/prototype input without executing it", () => {
    const getter = vi.fn();
    expect(() =>
      validateCloudSyncPayload({
        version: 1,
        get sections() {
          getter();
          return {};
        },
      }),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      validateCloudSyncPayload(
        JSON.parse('{"version":1,"sections":{"__proto__":{}}}'),
      ),
    ).toThrow();
  });
});
