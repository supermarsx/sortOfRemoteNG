import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportableDatabaseInfo } from "../../src/utils/connection/databaseManager";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";
import SyncItemsGrid from "../../src/components/SettingsDialog/sections/cloudSync/SyncItemsGrid";
import type { Mgr } from "../../src/components/SettingsDialog/sections/cloudSync/types";
import {
  captureCloudSyncPayload,
  discoverCloudSyncItems,
  validateCloudSyncPayload,
} from "../../src/utils/services/cloudSyncPayload";
import { reconcileRecordLedger } from "../../src/utils/storage/recordLedger";
import { collection } from "../fixtures/fullDatabaseArchive";

const mocks = vi.hoisted(() => ({
  databases: [] as ExportableDatabaseInfo[],
  owner: "source-db" as string | null,
  invoke: vi.fn(),
  sizes: vi.fn(),
  archive: vi.fn(),
  capture: vi.fn(),
  guard: vi.fn(),
  raw: new Map<string, string>(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  onCurrentDatabaseChange: () => () => {},
  DatabaseManager: {
    getInstance: () => ({
      getExportableDatabases: async () => mocks.databases,
      getCurrentDatabase: () => (mocks.owner ? { id: mocks.owner } : null),
      readFullDatabaseArchive: mocks.archive,
      captureCurrentDatabaseDataTarget: mocks.capture,
      captureDatabaseOperationGuard: mocks.guard,
    }),
  },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({ getSettings: () => ({ theme: "dark" }) }),
  },
}));

const scripts = "recording.managed-scripts";
const macros = "recording.terminal-macros";
const journal = "recording.terminal-library-migration.v1";
const receipt = {
  version: 1 as const,
  id: "migration-1",
  databaseId: collection.id,
  scriptsDigest: "a".repeat(64),
  macrosDigest: "b".repeat(64),
};
const macro = {
  id: "old",
  name: "Old macro",
  steps: [],
  createdAt: collection.createdAt,
  updatedAt: collection.updatedAt,
};
const clearedScripts = {
  customScripts: [],
  modifiedDefaults: [],
  deletedDefaultIds: ["deleted-default"],
  databaseMigration: receipt,
};
const clearedMacros = {
  version: 1,
  macros: [],
  legacyDigest: null,
  databaseMigration: receipt,
};
const set = (key: string, value: unknown) =>
  mocks.raw.set(key, JSON.stringify(value));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.raw.clear();
  mocks.owner = collection.id;
  mocks.databases = [
    { ...collection, isCurrent: true, isUnlocked: true, isExportable: true },
  ];
  mocks.archive.mockResolvedValue({
    format: "sorng-full-database",
    version: 1,
    collection: { id: collection.id },
    automationLibrary: { terminalLibraryMigration: receipt },
  });
  mocks.sizes.mockImplementation(({ databaseIds }: { databaseIds: string[] }) =>
    databaseIds.map((databaseId) => ({
      databaseId,
      bytes: 4096,
      status: "measured",
    })),
  );
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === "get_database_file_sizes") return mocks.sizes(args);
    if (command === "read_app_settings") return { theme: "dark" };
    if (command === "read_app_data" || command === "read_macro_library")
      return mocks.raw.get(args.key) ?? null;
    throw new Error("Inventory must not write stores");
  });
  set(scripts, clearedScripts);
  set(macros, clearedMacros);
  set(journal, { phase: "complete", receipt });
});
afterEach(cleanup);

describe("app-wide inventory with stored migration receipts", () => {
  it("keeps completed migration sources available, sized and unchanged with deletion IDs and tombstones", async () => {
    const original = { version: 1, legacyDigest: null, macros: [macro] };
    const before = await reconcileRecordLedger(original, undefined, {
      mode: "migrate",
    });
    const recordMetadata = await reconcileRecordLedger(clearedMacros, before, {
      mode: "write",
    });
    set(macros, { ...clearedMacros, recordMetadata });
    const sources = new Map(mocks.raw);
    const items = await discoverCloudSyncItems();
    for (const [key, label] of [
      [scripts, "Saved terminal scripts"],
      [macros, "Terminal macros"],
    ]) {
      const item = items.find((item) => item.id === `app:${key}`);
      expect(item).toMatchObject({
        label: `${label} (App-wide)`,
        available: true,
        bytes: Buffer.byteLength(sources.get(key)!, "utf8"),
        sizeKind: "stored-json",
      });
      expect(item).not.toHaveProperty("retiredLegacy");
      expect(item).not.toHaveProperty("emptyLegacy");
    }
    expect(
      Object.values(recordMetadata.records).some((stamp) => stamp.deletedAt),
    ).toBe(true);
    expect(mocks.raw).toEqual(sources);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.sizes).toHaveBeenCalledExactlyOnceWith({
      databaseIds: [collection.id],
    });
    expect(
      items.find((item) => item.id === `database:${collection.id}`),
    ).toMatchObject({
      bytes: 4096,
      sizeKind: "stored-encrypted",
      sizeStatus: "measured",
    });
    expect(
      mocks.invoke.mock.calls.every(
        ([cmd]) => cmd === "get_database_file_sizes" || cmd.startsWith("read_"),
      ),
    ).toBe(true);
    expect(
      mocks.invoke.mock.calls.some(([, args]) => args?.key === journal),
    ).toBe(false);
    expect(
      validateCloudSyncPayload({
        version: 1,
        sections: {
          [`app:${macros}`]: JSON.parse(sources.get(macros)!),
          [`app:${scripts}`]: clearedScripts,
        },
      }).sections[`app:${macros}`],
    ).toMatchObject({ databaseMigration: receipt, recordMetadata });
  });

  it.each([false, true])(
    "does not hide or deselect completed migration sources in the real grid (selected=%s)",
    async (selected) => {
      const updateCloudSync = vi.fn();
      const selectedItems = selected ? [`app:${scripts}`, `app:${macros}`] : [];
      render(
        createElement(SyncItemsGrid, {
          mgr: {
            cloudSync: { ...defaultCloudSyncConfig, selectedItems },
            isBusy: false,
            updateCloudSync,
          } as unknown as Mgr,
        }),
      );
      const scriptsRow = await screen.findByRole("checkbox", {
        name: /Saved terminal scripts \(App-wide\)/,
      });
      await waitFor(() => expect(scriptsRow).toBeEnabled());
      for (const name of [
        /Saved terminal scripts \(App-wide\)/,
        /Terminal macros \(App-wide\)/,
      ]) {
        const row = screen.getByRole("checkbox", { name });
        expect(row).toBeEnabled();
        if (selected) expect(row).toBeChecked();
        else expect(row).not.toBeChecked();
      }
      expect(
        screen.getByRole("checkbox", { name: new RegExp(collection.name) }),
      ).not.toBeChecked();
      expect(updateCloudSync).not.toHaveBeenCalled();
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    },
  );

  it.each([null, "other-db"])(
    "keeps app-wide libraries available independently of the current database: %s",
    async (owner) => {
      mocks.owner = owner;
      const items = await discoverCloudSyncItems({ includeSizes: false });
      expect(items.filter((item) => item.kind === "library")).toHaveLength(2);
      expect(
        items
          .filter((item) => item.kind === "library")
          .every((item) => item.available),
      ).toBe(true);
      expect(mocks.capture).not.toHaveBeenCalled();
      expect(mocks.guard).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(mocks.sizes).not.toHaveBeenCalled();
    },
  );

  it("keeps app-wide sources available when database metadata sizing fails", async () => {
    mocks.sizes.mockRejectedValue(
      new Error("synthetic private metadata error"),
    );
    const items = await discoverCloudSyncItems();
    expect(items.filter((item) => item.kind === "library")).toHaveLength(2);
    expect(
      items
        .filter((item) => item.kind === "library")
        .every((item) => item.available),
    ).toBe(true);
    expect(items[0]).toMatchObject({
      available: true,
      sizeStatus: "unavailable",
      sizeUnavailableReason: expect.stringContaining(
        "Could not read the stored database size",
      ),
    });
    expect(items[0].bytes).toBeUndefined();
    expect(items[0].sizeKind).toBeUndefined();
    expect(JSON.stringify(items)).not.toContain(
      "synthetic private metadata error",
    );
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("never reads migration evidence or an unrelated archive for settings capture", async () => {
    await captureCloudSyncPayload({
      ...defaultCloudSyncConfig,
      selectedItems: ["app:settings"],
    });
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.sizes).not.toHaveBeenCalled();
    expect(
      mocks.invoke.mock.calls.some(([, args]) => args?.key === journal),
    ).toBe(false);
  });

  it.each([
    [scripts, clearedScripts],
    [macros, clearedMacros],
  ])(
    "still rejects malformed stored receipts in %s without hiding inventory",
    async (key, source) => {
      const value = {
        ...source,
        databaseMigration: { ...receipt, scriptsDigest: "bad" },
      };
      set(key, value);
      expect(
        (await discoverCloudSyncItems()).find(
          (item) => item.id === `app:${key}`,
        ),
      ).toMatchObject({ available: true });
      expect(() =>
        validateCloudSyncPayload({
          version: 1,
          sections: { [`app:${key}`]: value },
        }),
      ).toThrow(/migration receipt/);
    },
  );
});
