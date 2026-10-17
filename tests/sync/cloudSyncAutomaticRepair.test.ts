import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";
import type { CloudSyncCaptureOptions } from "../../src/utils/services/cloudSyncPayload";
import { FullDatabaseArchiveError } from "../../src/utils/connection/fullDatabaseArchive";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  repair: vi.fn(),
  eligible: vi.fn(),
  discover: vi.fn(),
  invoke: vi.fn(),
  captureGuard: vi.fn(),
  store: new Map<string, unknown>(),
  failures: [] as string[],
  events: [] as string[],
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
vi.mock("../../src/utils/services/cloudSyncDependencyRepair", () => ({
  repairCloudSyncArchiveDependencies: mocks.repair,
}));
vi.mock("../../src/utils/services/cloudSyncPayload", () => ({
  captureCloudSyncPayload: mocks.capture,
  applyCloudSyncPayload: vi.fn(),
  upgradeCloudSyncPayload: async (value: unknown) => value,
  validateCloudSyncPayload: (value: unknown) => value,
  discoverCloudSyncItems: mocks.discover,
  canRepairCloudSyncDatabase: mocks.eligible,
}));
vi.mock("../../src/utils/storage/indexedDbService", () => ({
  IndexedDbService: {
    getItemStrict: async (key: string) =>
      structuredClone(mocks.store.get(key) ?? null),
    setItemStrict: async (key: string, value: unknown) => {
      mocks.store.set(key, structuredClone(value));
    },
  },
}));
import {
  runCloudSync,
  reviewCloudSync,
} from "../../src/utils/services/cloudSyncEngine";

const target = {
  id: "repair-target",
  label: "Work",
  enabled: true,
  provider: "nextcloud" as const,
};
const config = () => ({
  ...defaultCloudSyncConfig,
  selectedItems: ["database:db"],
  encryptBeforeSync: true,
  syncEncryptionPassword: "synthetic-sync-password",
  compressionEnabled: false,
});
const dependency = (databaseId = "db") =>
  new FullDatabaseArchiveError("dependencies", {
    databaseId,
    totalIssues: 1,
    issues: [
      {
        recordId: "connection",
        path: "connections[3].sshQuickActions.items[1]",
        reason: "external-script",
        targetId: "app-script",
      },
    ],
  });
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.clearAllMocks();
  mocks.store.clear();
  mocks.failures = ["db"];
  mocks.events = [];
  mocks.captureGuard.mockReset();
  mocks.eligible.mockReset().mockReturnValue(true);
  mocks.discover
    .mockReset()
    .mockResolvedValue([
      { id: "database:db", label: "Database", available: true },
    ]);
  mocks.capture
    .mockReset()
    .mockImplementation(
      async (_config, options: CloudSyncCaptureOptions = {}) => {
        mocks.events.push("capture");
        if (mocks.failures.length) {
          const error = dependency(mocks.failures[0]);
          options.onArchiveDependency?.(error, mocks.captureGuard);
          throw error;
        }
        return {
          version: 1,
          sections: { "database:db": { record: "repaired" } },
        };
      },
    );
  mocks.repair
    .mockReset()
    .mockImplementation(async (_database, assertCurrent) => {
      mocks.events.push("repair");
      assertCurrent();
      mocks.failures.shift();
      return 1;
    });
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    mocks.events.push(command);
    return command === "cloud_sync_read"
      ? { data: null, revision: null }
      : { revision: "v2" };
  });
});

describe("automatic local archive dependency repair", () => {
  it("repairs the failed local capture before remote I/O and recaptures without another automatic unlock", async () => {
    expect(await runCloudSync(target, config())).toMatch(
      /Automatically copied and rebound 1.*uploaded and verified/,
    );
    expect(mocks.repair).toHaveBeenCalledOnce();
    expect(mocks.events.indexOf("repair")).toBeLessThan(
      mocks.events.indexOf("cloud_sync_read"),
    );
    expect(mocks.capture.mock.calls[0][1].allowAutoUnlock).toBe(true);
    expect(mocks.capture.mock.calls[1][1].allowAutoUnlock).toBe(false);
    expect(mocks.captureGuard).toHaveBeenCalled();
  });
  it("never repairs a conflict-review capture", async () => {
    await expect(reviewCloudSync(target, config())).rejects.toBeInstanceOf(
      FullDatabaseArchiveError,
    );
    expect(mocks.capture.mock.calls[0][1].onArchiveDependency).toBeUndefined();
    expect(mocks.repair).not.toHaveBeenCalled();
  });
  it("does not infer repair authority from an untagged archive error", async () => {
    mocks.capture.mockRejectedValue(dependency());
    await expect(runCloudSync(target, config())).rejects.toBeInstanceOf(
      FullDatabaseArchiveError,
    );
    expect(mocks.repair).not.toHaveBeenCalled();
  });
  it("does not repair the same archive error during a post-read comparison", async () => {
    mocks.failures = [];
    mocks.capture
      .mockResolvedValueOnce({
        version: 1,
        sections: { "database:db": { record: "before" } },
      })
      .mockRejectedValue(dependency());
    await expect(runCloudSync(target, config())).rejects.toBeInstanceOf(
      FullDatabaseArchiveError,
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      "cloud_sync_read",
      expect.anything(),
    );
    expect(mocks.repair).not.toHaveBeenCalled();
  });
  it("does not repair an excluded, unselected or unavailable database", async () => {
    mocks.eligible.mockReturnValue(false);
    await expect(runCloudSync(target, config())).rejects.toBeInstanceOf(
      FullDatabaseArchiveError,
    );
    expect(mocks.repair).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("keeps the failed capture's owner fence across inventory reads", async () => {
    mocks.discover.mockImplementation(async () => {
      mocks.captureGuard.mockImplementation(() => {
        throw new Error("Capture owner changed");
      });
      return [];
    });
    await expect(runCloudSync(target, config())).rejects.toThrow(
      "Capture owner changed",
    );
    expect(mocks.repair).not.toHaveBeenCalled();
  });
  it("stops if selection/exclusion settings change during eligibility", async () => {
    const settings = config();
    mocks.discover.mockImplementation(async () => {
      settings.selectedItems = [];
      return [];
    });
    await expect(runCloudSync(target, settings)).rejects.toThrow(
      "Sync settings changed",
    );
    expect(mocks.repair).not.toHaveBeenCalled();
  });
  it("does not retry if no non-destructive repair can be made", async () => {
    mocks.repair.mockResolvedValue(0);
    await expect(runCloudSync(target, config())).rejects.toBeInstanceOf(
      FullDatabaseArchiveError,
    );
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.repair).toHaveBeenCalledOnce();
  });
  it("never repeats a database repair while preserving saved-repair information", async () => {
    mocks.repair.mockResolvedValue(1);
    await expect(runCloudSync(target, config())).rejects.toThrow(
      /1 script or macro reference.*Local repairs were saved/,
    );
    expect(mocks.repair).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("handles separate selected databases once each with a cumulative summary", async () => {
    mocks.failures = ["db", "other"];
    mocks.repair.mockImplementation(async (_database, assertCurrent) => {
      assertCurrent();
      return mocks.failures.shift() === "db" ? 2 : 3;
    });
    const settings = {
      ...config(),
      selectedItems: ["database:db", "database:other"],
    };
    expect(await runCloudSync(target, settings)).toContain(
      "5 script or macro references",
    );
    expect(mocks.repair.mock.calls.map(([database]) => database)).toEqual([
      "db",
      "other",
    ]);
  });
  it("reports successful local repairs if the later cloud operation fails", async () => {
    mocks.invoke.mockRejectedValue(new Error("Cloud unavailable"));
    await expect(runCloudSync(target, config())).rejects.toThrow(
      /Local repairs were saved.*Cloud unavailable/,
    );
    expect(mocks.repair).toHaveBeenCalledOnce();
  });
  it("reports committed repair counts if refresh fails without retrying", async () => {
    mocks.repair.mockRejectedValue(
      Object.assign(new Error("Database refresh failed"), {
        kind: "partial",
        repairedCount: 2,
      }),
    );
    await expect(runCloudSync(target, config())).rejects.toThrow(
      /2 script or macro references.*Database refresh failed/,
    );
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("does not retry a repair CAS failure or start a remote operation", async () => {
    mocks.repair.mockRejectedValue(new Error("Repair conflict"));
    await expect(runCloudSync(target, config())).rejects.toThrow(
      "Repair conflict",
    );
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("preserves actionable archive diagnostics if automatic repair fails", async () => {
    mocks.repair.mockRejectedValue(
      new Error("The source changed; review it again."),
    );
    const failure = await runCloudSync(target, config()).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("source changed");
    expect((failure as Error).message).toContain(
      "connections[3].sshQuickActions.items[1]",
    );
    expect((failure as Error).message).toContain(
      'Database "db": 1 unresolved archive dependency',
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
