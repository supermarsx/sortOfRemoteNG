import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportableDatabaseInfo } from "../../src/utils/connection/databaseManager";
import {
  captureCloudSyncPayload,
  discoverCloudSyncItems,
} from "../../src/utils/services/cloudSyncPayload";
import { buildBackupPayload } from "../../src/utils/services/backupPayload";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";
import type { BackupConfig } from "../../src/types/settings/backupSettings";
import { collection } from "../fixtures/fullDatabaseArchive";

/* t-cefiso F7: the per-connection page cache is device-local. Cloud sync and
   backup carry at most the four page-cache *settings*; never usage, byte
   counts, directories or cache content, and they never call the cache
   commands. Read-only use of the real payload builders. */

const mocks = vi.hoisted(() => ({
  databases: [] as ExportableDatabaseInfo[],
  getInvoke: vi.fn(),
  invoke: vi.fn(),
  settings: {} as Record<string, unknown>,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getExportableDatabases: async () => mocks.databases,
      readFullDatabaseArchive: vi.fn(),
      getCurrentDatabase: () => null,
    }),
  },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: mocks.getInvoke,
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({ getSettings: () => mocks.settings }),
  },
}));

const httpCache = {
  enabled: true,
  perConnectionMb: 256,
  totalMb: 2048,
  clearOnDatabaseLock: true,
};
const CACHE_LEAK =
  /http-cache|net[\\/]Cache|CACHEDIR|limitBytes|cachePendingRestart|origin_browser_(?:http_cache|clear)/i;

function cacheSettingsIn(value: unknown): unknown[] {
  const found: unknown[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "httpCache") found.push(child);
      walk(child);
    }
  };
  walk(value);
  return found;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.databases = [];
  mocks.settings = { theme: "dark", webBrowser: { version: 1, httpCache } };
  mocks.getInvoke.mockResolvedValue(mocks.invoke);
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_database_file_sizes") return [];
    if (command === "read_app_settings") return mocks.settings;
    if (command === "read_app_data" || command === "read_macro_library")
      return null;
    throw new Error(`Unexpected command: ${command}`);
  });
});

describe("page cache is never synced or backed up", () => {
  it("lists no page-cache inventory item and never queries the cache", async () => {
    mocks.databases = [
      {
        ...collection,
        isCurrent: false,
        isUnlocked: false,
        isExportable: false,
      },
    ];
    const items = await discoverCloudSyncItems();
    expect(
      items.filter((item) => /cache/i.test(`${item.id} ${item.label}`)),
    ).toEqual([]);
    expect(JSON.stringify(items)).not.toMatch(CACHE_LEAK);
    expect(
      mocks.invoke.mock.calls.filter(([command]) =>
        String(command).startsWith("origin_browser_"),
      ),
    ).toEqual([]);
  });

  it("captures at most the page-cache settings values in the settings section", async () => {
    const payload = await captureCloudSyncPayload({
      ...defaultCloudSyncConfig,
      selectedItems: ["app:settings"],
    });
    expect(Object.keys(payload.sections)).toEqual(["app:settings"]);
    for (const value of cacheSettingsIn(payload))
      expect(value).toEqual(httpCache);
    expect(JSON.stringify(payload)).not.toMatch(CACHE_LEAK);
    expect(
      mocks.invoke.mock.calls.filter(([command]) =>
        String(command).startsWith("origin_browser_"),
      ),
    ).toEqual([]);
  });

  it("backs up at most the page-cache settings values, without usage or paths", () => {
    const payload = buildBackupPayload(
      {
        connections: [
          {
            id: "web",
            name: "Web",
            protocol: "https",
            hostname: "example.test",
            browserSession: { version: 1, httpCache: { enabled: false } },
          },
        ],
        settings: mocks.settings,
        timestamp: 1,
      },
      { includeSettings: true, includePasswords: false } as BackupConfig,
    );
    expect(cacheSettingsIn(payload.settings)).toEqual([httpCache]);
    expect(cacheSettingsIn(payload.connections)).toEqual([{ enabled: false }]);
    expect(JSON.stringify(payload)).not.toMatch(CACHE_LEAK);
  });

  it("keeps the sync and backup sources free of page-cache commands and paths", () => {
    for (const file of [
      "src/utils/services/cloudSyncPayload.ts",
      "src/utils/services/backupPayload.ts",
      "src/hooks/settings/useBackupSettings.ts",
      "src/components/SettingsDialog/sections/cloudSync/SyncItemsGrid.tsx",
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(CACHE_LEAK);
      expect(source, file).not.toContain("originBrowserData");
    }
  });
});
