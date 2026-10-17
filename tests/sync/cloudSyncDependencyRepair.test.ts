import { beforeEach, describe, expect, it, vi } from "vitest";
import { collection, fullData } from "../fixtures/fullDatabaseArchive";
import type { StorageData } from "../../src/utils/storage/storage";
import type { AutomationEntry } from "../../src/types/recording/automationLibrary";
import { repairCloudSyncArchiveDependencies } from "../../src/utils/services/cloudSyncDependencyRepair";

const h = vi.hoisted(() => ({
  data: new Map<string, StorageData>(),
  epochs: new Map<string, number>(),
  ready: new Set<string>(),
  legacy: new Set<string>(),
  unlocked: new Set<string>(),
  events: [] as string[],
  appRead: vi.fn(),
  load: vi.fn(),
  commit: vi.fn(),
  release: vi.fn(),
  barrier: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getDatabaseAccessState: (id: string) =>
        h.legacy.has(id)
          ? null
          : { status: h.ready.has(id) ? "ready" : "locked" },
      isDatabaseUnlocked: (id: string) => h.unlocked.has(id),
      captureDatabaseOperationGuard: (ids: string[]) => {
        h.events.push(`guard:${ids.join()}`);
        const epochs = ids.map((id) => h.epochs.get(id));
        const assertCurrent = () => {
          if (ids.some((id, i) => h.epochs.get(id) !== epochs[i]))
            throw new Error("PRIVATE_ACCESS_ERROR");
        };
        return {
          assertCurrent,
          verifyCurrent: async () => {
            assertCurrent();
          },
        };
      },
      loadDatabaseData: h.load,
      commitArchiveDependencyRepair: h.commit,
    }),
  },
}));
vi.mock("../../src/utils/services/cloudSyncDatabaseBarrier", () => ({
  acquireCloudSyncDatabaseBarrier: h.barrier,
}));
vi.mock("../../src/utils/recording/automationLibrary", () => ({
  createAutomationLibraryApi: () => ({
    read: h.appRead,
    invalidateReviews: vi.fn(),
  }),
}));

let original: StorageData;
let entry: AutomationEntry;
beforeEach(async () => {
  vi.clearAllMocks();
  h.data.clear();
  h.epochs.clear();
  h.ready.clear();
  h.legacy.clear();
  h.unlocked.clear();
  h.events.length = 0;
  // Persisted JSON has no shared active/recycled object references.
  original = JSON.parse(JSON.stringify(await fullData())) as StorageData;
  entry = {
    family: "terminal-script",
    payload: structuredClone(
      original.automationLibrary!.terminalScripts.customScripts[0],
    ),
  };
  original.connections[1].sshQuickActions!.items[0].scope = { kind: "app" };
  h.data.set(collection.id, original);
  h.ready.add(collection.id);
  h.epochs.set(collection.id, 1);
  h.load.mockImplementation(async (id: string) => {
    h.events.push(`load:${id}`);
    return h.data.get(id);
  });
  h.appRead.mockImplementation(async () => ({
    entries: [structuredClone(entry)],
  }));
  h.commit.mockImplementation(
    async (_id: string, _expected: StorageData, data: StorageData) => {
      h.events.push("commit");
      h.data.set(collection.id, data);
    },
  );
  h.release.mockImplementation(async () => {
    h.events.push("refresh");
  });
  h.barrier.mockImplementation(async () => {
    h.events.push("flush");
    return h.release;
  });
});

describe("sync dependency copy preflight", () => {
  it("flushes, copies only the referenced entry, revalidates it, CASes once, and refreshes", async () => {
    const check = vi.fn();
    expect(await repairCloudSyncArchiveDependencies(collection.id, check)).toBe(
      1,
    );
    expect(h.barrier).toHaveBeenCalledWith(
      [collection.id],
      false,
      expect.objectContaining({ kind: "dependency-repair" }),
    );
    expect(h.events[0]).toBe(`guard:${collection.id}`);
    expect(h.events.indexOf("flush")).toBeLessThan(
      h.events.indexOf(`load:${collection.id}`),
    );
    expect(h.appRead).toHaveBeenCalledTimes(2);
    expect(h.appRead).toHaveBeenCalledWith({ kind: "app" }, "terminal-script");
    expect(h.commit).toHaveBeenCalledTimes(1);
    const [id, expected, saved] = h.commit.mock.calls[0];
    expect(id).toBe(collection.id);
    expect(expected).toBe(original);
    expect(saved.connections[1].sshQuickActions.items[0].scope).toEqual({
      kind: "database",
      databaseId: collection.id,
    });
    expect(saved.credentialVault).toEqual(original.credentialVault);
    expect(saved.recycleBin).toEqual(original.recycleBin);
    expect(h.events.slice(-2)).toEqual(["commit", "refresh"]);
  });

  it("does not load or unlock a locked destination", async () => {
    h.ready.delete(collection.id);
    await expect(
      repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).rejects.toThrow("Automatic dependency repair");
    expect(h.barrier).not.toHaveBeenCalled();
    expect(h.load).not.toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("leaves a locked foreign source reference unchanged without reading it", async () => {
    original.connections[1].sshQuickActions!.items[0].scope = {
      kind: "database",
      databaseId: "foreign",
    };
    expect(
      await repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).toBe(0);
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.appRead).not.toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("accepts already unlocked legacy sources without installing new authority", async () => {
    h.legacy.add(collection.id);
    h.unlocked.add(collection.id);
    original.connections[1].sshQuickActions!.items[0].scope = {
      kind: "database",
      databaseId: "foreign",
    };
    h.legacy.add("foreign");
    h.unlocked.add("foreign");
    h.epochs.set("foreign", 1);
    h.data.set("foreign", await fullData());
    expect(
      await repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).toBe(1);
    expect(h.load.mock.calls.filter(([id]) => id === "foreign")).toHaveLength(
      2,
    );
  });

  it("never interprets absent legacy state as permission to read an unopened source", async () => {
    original.connections[1].sshQuickActions!.items[0].scope = {
      kind: "database",
      databaseId: "foreign",
    };
    h.legacy.add("foreign");
    expect(
      await repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).toBe(0);
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.commit).not.toHaveBeenCalled();
    h.legacy.add(collection.id);
    h.load.mockClear();
    h.barrier.mockClear();
    await expect(
      repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).rejects.toThrow("Automatic dependency repair");
    expect(h.load).not.toHaveBeenCalled();
    expect(h.barrier).not.toHaveBeenCalled();
  });

  it("pins an unlocked foreign source before its read, reads it again, and never writes it", async () => {
    original.connections[1].sshQuickActions!.items[0].scope = {
      kind: "database",
      databaseId: "foreign",
    };
    h.ready.add("foreign");
    h.epochs.set("foreign", 1);
    h.data.set("foreign", await fullData());
    expect(
      await repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).toBe(1);
    expect(h.events.indexOf("guard:foreign")).toBeLessThan(
      h.events.indexOf("load:foreign"),
    );
    expect(h.load.mock.calls.filter(([id]) => id === "foreign")).toHaveLength(
      2,
    );
    expect(h.commit.mock.calls.every(([id]) => id === collection.id)).toBe(
      true,
    );
  });

  it("refuses changed source content before CAS without exposing its body", async () => {
    h.appRead.mockImplementationOnce(async () => ({
      entries: [structuredClone(entry)],
    }));
    h.appRead.mockImplementationOnce(async () => ({
      entries: [
        {
          ...entry,
          payload: { ...entry.payload, script: "PRIVATE_SCRIPT_BODY" },
        },
      ],
    }));
    await expect(
      repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).rejects.toThrow("Automatic dependency repair");
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalled();
  });

  it("rejects a same-ID destination access ABA during a source read", async () => {
    h.appRead.mockImplementation(async () => {
      h.epochs.set(collection.id, 3);
      return { entries: [entry] };
    });
    await expect(
      repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).rejects.toThrow("Automatic dependency repair");
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalled();
  });

  it("rejects foreign-source access ABA despite a ready final state", async () => {
    original.connections[1].sshQuickActions!.items[0].scope = {
      kind: "database",
      databaseId: "foreign",
    };
    h.ready.add("foreign");
    h.epochs.set("foreign", 1);
    h.data.set("foreign", await fullData());
    h.load.mockImplementation(async (id: string) => {
      if (id === "foreign") h.epochs.set(id, 3);
      return h.data.get(id);
    });
    await expect(
      repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).rejects.toThrow("Automatic dependency repair");
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("checks queued target identity after the barrier and releases on cancellation", async () => {
    let current = true;
    h.barrier.mockImplementation(async () => {
      current = false;
      return h.release;
    });
    await expect(
      repairCloudSyncArchiveDependencies(collection.id, () => {
        if (!current) throw new Error("PRIVATE_TARGET");
      }),
    ).rejects.toThrow("Automatic dependency repair");
    expect(h.load).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalled();
  });

  it("preserves CAS failure and refreshes without leaking native diagnostics", async () => {
    h.commit.mockRejectedValue(new Error("PRIVATE_DATABASE_SECRET"));
    await expect(
      repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).rejects.toThrow("Automatic dependency repair");
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("reports saved local copies if refresh fails after commit", async () => {
    h.release.mockRejectedValue(new Error("PRIVATE_REFRESH_ERROR"));
    await expect(
      repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).rejects.toMatchObject({ kind: "partial", repairedCount: 1 });
    expect(h.commit).toHaveBeenCalledTimes(1);
  });

  it("does not claim a confirmed copy count when a partial commit receipt is uncertain", async () => {
    h.commit.mockRejectedValue(
      Object.assign(new Error("PRIVATE_NATIVE_ERROR"), { kind: "partial" }),
    );
    h.release.mockRejectedValue(new Error("PRIVATE_REFRESH_ERROR"));
    await expect(
      repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).rejects.toMatchObject({ kind: "partial", repairedCount: 0 });
    expect(h.commit).toHaveBeenCalledTimes(1);
  });

  it("reports committed copies if authority changes while commit completes", async () => {
    h.commit.mockImplementation(async () => {
      h.epochs.set(collection.id, 2);
    });
    await expect(
      repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).rejects.toMatchObject({ kind: "partial", repairedCount: 1 });
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("refuses a source that disappears on final verification", async () => {
    h.appRead
      .mockResolvedValueOnce({ entries: [entry] })
      .mockResolvedValueOnce({ entries: [] });
    await expect(
      repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).rejects.toThrow("Automatic dependency repair");
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalled();
  });

  it("does not remove broken references, repair structure, or read recycled scripts", async () => {
    original.connections[1].sshQuickActions!.items[0].scope = {
      kind: "database",
      databaseId: collection.id,
    };
    original.connections[1].parentId = "missing-folder";
    original.recycleBin!.entries[0].connection.sshQuickActions = {
      version: 1,
      items: [
        { id: "recycled-script", kind: "script", scope: { kind: "app" } },
      ],
    };
    expect(
      await repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).toBe(0);
    expect(h.appRead).not.toHaveBeenCalled();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("processes issues past the twelve-item diagnostic window but commits only once", async () => {
    original.connections[1].sshQuickActions!.items = Array.from(
      { length: 15 },
      (_, index) => ({
        id: `script-${index}`,
        kind: "script",
        scope: { kind: "app" },
      }),
    );
    h.appRead.mockImplementation(async () => ({
      entries: Array.from({ length: 15 }, (_, index) => ({
        ...entry,
        payload: { ...entry.payload, id: `script-${index}` },
      })),
    }));
    expect(
      await repairCloudSyncArchiveDependencies(collection.id, () => {}),
    ).toBe(15);
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(
      h.commit.mock.calls[0][2].connections[1].sshQuickActions.items.every(
        (item: { scope: { kind: string } }) => item.scope.kind === "database",
      ),
    ).toBe(true);
  });
});
