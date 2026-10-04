import { describe, expect, it, vi } from "vitest";
import {
  readDatabaseOpenSet,
  startDatabaseStartupSession,
} from "../../src/utils/connection/databaseStartup";
import type {
  DatabaseManager,
  CurrentDatabaseChange,
  CurrentDatabaseChangeListener,
} from "../../src/utils/connection/databaseManager";
import type { SettingsManager } from "../../src/utils/settings/settingsManager";
import type { GlobalSettings } from "../../src/types/settings/settings";
import type { ConnectionDatabase } from "../../src/types/connection/connection";

const database = (
  id: string,
  protectionFormat?: "sorng-db",
): ConnectionDatabase => ({
  id,
  name: id,
  isEncrypted: !!protectionFormat,
  protectionFormat,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  lastAccessed: "2026-01-01",
});
function fixture(
  ids = ["side", "active"],
  activeId: string | null = ids[ids.length - 1] ?? null,
) {
  const saved: Partial<GlobalSettings> = {
    autoOpenLastCollection: true,
    lastOpenedCollectionId: "old-native-pointer",
    databaseOpenSet: {
      version: 1,
      databaseIds: ids,
      activeDatabaseId: activeId,
    },
  };
  let active: ConnectionDatabase | null = null;
  let revision = 0;
  let live = true;
  let listener: CurrentDatabaseChangeListener | undefined;
  const rows = ids.map((id) => database(id));
  const unlocked = new Set<string>();
  const calls: string[] = [];
  const manager = {
    getCurrentDatabase: () => active,
    getAllDatabases: vi.fn(async () => rows),
    onCurrentDatabaseChange: vi.fn((next: CurrentDatabaseChangeListener) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    }),
    captureStartupRestoreGuard: () => {
      const start = revision;
      return () => start === revision;
    },
    isDatabaseUnlocked: (id: string) => unlocked.has(id),
    getDatabaseProtectionStatus: vi.fn(async () => ({
      kind: "managed",
      slots: [{ id: "device", type: "os-vault" }],
    })),
    getDatabaseProtectionCapabilities: vi.fn(async () => ({
      protectors: [{ id: "os-vault", available: true }],
    })),
    unlockManagedDatabase: vi.fn(
      async (
        id: string,
        _slot: string,
        _password: undefined,
        options: { isCurrent: () => boolean },
      ) => {
        if (!options.isCurrent()) throw new Error("Cancelled");
        unlocked.add(id);
      },
    ),
    restoreDatabase: vi.fn(
      async (
        id: string,
        options: { activate: boolean; isCurrent: () => boolean },
      ) => {
        if (!options.isCurrent()) throw new Error("Cancelled");
        calls.push(`${id}:${options.activate ? "active" : "background"}`);
        if (options.activate) {
          active = rows.find((row) => row.id === id)!;
          revision++;
          emit("open", active, id);
        }
      },
    ),
  };
  const settings = {
    getSettings: () => saved as GlobalSettings,
    saveSettings: vi.fn(async (patch: Partial<GlobalSettings>) => {
      // Native settings shallow merge JSON: undefined does NOT delete old keys.
      Object.assign(saved, JSON.parse(JSON.stringify(patch)));
    }),
  };
  function emit(
    reason: CurrentDatabaseChange["reason"],
    value = active,
    id: string | null = value?.id ?? null,
    previous: string | null = active?.id ?? null,
  ) {
    listener?.({
      reason,
      database: value,
      databaseId: id,
      previousDatabaseId: previous,
      connectionIds: [],
      trustActivation: Promise.resolve(),
    });
  }
  const loadData = vi.fn(async (_id: string) => true);
  const showChooser = vi.fn();
  const start = (ownerWindow = true, safeMode = false, restoreOnStart = true) =>
    startDatabaseStartupSession({
      manager: manager as unknown as DatabaseManager,
      settings: settings as unknown as SettingsManager,
      loadData,
      showChooser,
      ownerWindow,
      safeMode,
      restoreOnStart,
      isCurrent: () => live,
    });
  return {
    saved,
    manager,
    settings,
    rows,
    unlocked,
    calls,
    loadData,
    showChooser,
    start,
    emit,
    cancel: () => {
      revision++;
    },
    unmount: () => {
      live = false;
    },
    select: (id: string) => {
      const previous = active?.id ?? null;
      active = database(id);
      revision++;
      emit("switch", active, id, previous);
    },
    close: () => {
      const previous = active?.id ?? null;
      active = null;
      revision++;
      emit("close", null, null, previous);
    },
  };
}

describe("database startup intent", () => {
  it("migrates the legacy active ID but treats explicit empty/invalid new records as authoritative", () => {
    expect(readDatabaseOpenSet({ lastOpenedCollectionId: "old" })).toEqual({
      version: 1,
      databaseIds: ["old"],
      activeDatabaseId: "old",
    });
    for (const value of [
      null,
      {},
      { version: 1, databaseIds: [], activeDatabaseId: null },
      { version: 1, databaseIds: ["../unsafe"], activeDatabaseId: "../unsafe" },
    ]) {
      expect(
        readDatabaseOpenSet({
          lastOpenedCollectionId: "old",
          databaseOpenSet: value as GlobalSettings["databaseOpenSet"],
        }).databaseIds,
      ).toEqual([]);
    }
  });

  it("restores all available side databases without activating them, then loads only the saved active owner", async () => {
    const f = fixture(["active", "side", "other"], "active");
    const task = f.start();
    await task.restore;
    expect(f.calls).toEqual([
      "side:background",
      "other:background",
      "active:active",
    ]);
    expect(f.loadData).toHaveBeenCalledExactlyOnceWith("active");
    expect(f.saved.databaseOpenSet?.databaseIds).toEqual([
      "active",
      "side",
      "other",
    ]);
    expect(f.showChooser).not.toHaveBeenCalled();
    task.dispose();
  });

  it("restores one unambiguous available OS-vault slot with no password", async () => {
    const f = fixture(["vault"]);
    f.rows[0] = database("vault", "sorng-db");
    const task = f.start();
    await task.restore;
    expect(f.manager.unlockManagedDatabase).toHaveBeenCalledExactlyOnceWith(
      "vault",
      "device",
      undefined,
      { isCurrent: expect.any(Function) },
    );
    expect(f.calls).toEqual(["vault:active"]);
    expect(JSON.stringify(f.settings.saveSettings.mock.calls)).not.toMatch(
      /session|password|token|device/,
    );
    task.dispose();
  });

  it.each(["password", "ambiguous", "unavailable", "cancelled", "legacy"])(
    "keeps %s protection locked without alternate unlock or lost intent",
    async (kind) => {
      const f = fixture(["locked"]);
      f.rows[0] = database("locked", "sorng-db");
      if (kind === "password")
        f.manager.getDatabaseProtectionStatus.mockResolvedValue({
          kind: "managed",
          slots: [{ id: "password", type: "password" }],
        });
      if (kind === "ambiguous")
        f.manager.getDatabaseProtectionStatus.mockResolvedValue({
          kind: "managed",
          slots: [
            { id: "one", type: "os-vault" },
            { id: "two", type: "os-vault" },
          ],
        });
      if (kind === "unavailable")
        f.manager.getDatabaseProtectionCapabilities.mockResolvedValue({
          protectors: [{ id: "os-vault", available: false }],
        });
      if (kind === "cancelled")
        f.manager.unlockManagedDatabase.mockRejectedValue(
          new Error("Cancelled"),
        );
      if (kind === "legacy")
        f.rows[0] = { ...database("locked"), isEncrypted: true };
      const task = f.start();
      await task.restore;
      expect(f.calls).toEqual([]);
      expect(f.loadData).not.toHaveBeenCalled();
      expect(f.showChooser).toHaveBeenCalledOnce();
      expect(f.saved.databaseOpenSet).toEqual({
        version: 1,
        databaseIds: ["locked"],
        activeDatabaseId: "locked",
      });
      expect(f.manager.unlockManagedDatabase).toHaveBeenCalledTimes(
        kind === "cancelled" ? 1 : 0,
      );
      task.dispose();
    },
  );

  it.each(["select", "close", "global-lock", "unmount"])(
    "cancels a pending restore on %s without stealing chooser focus",
    async (action) => {
      const f = fixture(["locked", "slow"], "slow");
      f.rows[0] = database("locked", "sorng-db");
      f.rows[1] = database("slow", "sorng-db");
      let finish!: () => void;
      f.manager.getDatabaseProtectionStatus
        .mockResolvedValueOnce({
          kind: "managed",
          slots: [{ id: "password", type: "password" }],
        })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = () =>
                resolve({
                  kind: "managed",
                  slots: [{ id: "device", type: "os-vault" }],
                });
            }),
        );
      const task = f.start();
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      expect(f.settings.saveSettings).not.toHaveBeenCalled();
      if (action === "select") f.select("manual");
      if (action === "close") f.close();
      if (action === "global-lock") f.cancel();
      if (action === "unmount") {
        f.unmount();
        task.dispose();
      }
      finish();
      await task.restore;
      expect(f.manager.unlockManagedDatabase).not.toHaveBeenCalled();
      expect(f.calls).toEqual([]);
      expect(f.showChooser).not.toHaveBeenCalled();
      if (action === "select")
        expect(f.saved.databaseOpenSet?.activeDatabaseId).toBe("manual");
      if (action === "global-lock" || action === "unmount")
        expect(f.settings.saveSettings).not.toHaveBeenCalled();
      task.dispose();
    },
  );

  it("does not treat a superseded provider load as successful restoration", async () => {
    const f = fixture(["active"]);
    f.loadData.mockResolvedValue(false);
    const task = f.start();
    await task.restore;
    expect(f.settings.saveSettings).not.toHaveBeenCalled();
    expect(f.showChooser).not.toHaveBeenCalled();
    task.dispose();
  });

  it.each(["select", "close", "global-lock", "unmount"])(
    "does not steal chooser focus after %s during the final settings save",
    async (action) => {
      const f = fixture(["locked"]);
      f.rows[0] = { ...database("locked"), isEncrypted: true };
      let finish!: () => void;
      const original = f.settings.saveSettings.getMockImplementation()!;
      f.settings.saveSettings.mockImplementationOnce(async (patch) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        await original(patch);
      });
      const task = f.start();
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      if (action === "select") f.select("manual");
      if (action === "close") f.close();
      if (action === "global-lock") f.cancel();
      if (action === "unmount") {
        f.unmount();
        task.dispose();
      }
      finish();
      await task.restore;
      expect(f.showChooser).not.toHaveBeenCalled();
      if (action === "select")
        await vi.waitFor(() =>
          expect(f.saved.databaseOpenSet?.activeDatabaseId).toBe("manual"),
        );
      task.dispose();
    },
  );

  it("reconciles an already-current database selected before subscription without reloading it", async () => {
    const f = fixture(["saved-A"]);
    f.select("current-B");
    const task = f.start();
    await task.restore;
    expect(f.manager.getCurrentDatabase()?.id).toBe("current-B");
    expect(f.manager.getAllDatabases).not.toHaveBeenCalled();
    expect(f.manager.restoreDatabase).not.toHaveBeenCalled();
    expect(f.loadData).not.toHaveBeenCalled();
    expect(f.saved.databaseOpenSet).toEqual({
      version: 1,
      databaseIds: ["saved-A", "current-B"],
      activeDatabaseId: "current-B",
    });
    task.dispose();
  });

  it("does not restore an explicitly closed side database on the next startup", async () => {
    const f = fixture(["side-vault", "active"]);
    f.rows[0] = database("side-vault", "sorng-db");
    const task = f.start();
    await task.restore;
    f.emit("close", f.manager.getCurrentDatabase(), "side-vault", "active");
    await vi.waitFor(() =>
      expect(f.saved.databaseOpenSet?.databaseIds).toEqual(["active"]),
    );
    expect(f.saved.databaseOpenSet?.activeDatabaseId).toBe("active");
    task.dispose();
    const restarted = fixture(["side-vault", "active"]);
    Object.assign(restarted.saved, JSON.parse(JSON.stringify(f.saved)));
    const next = restarted.start();
    await next.restore;
    expect(restarted.calls).toEqual(["active:active"]);
    expect(restarted.manager.unlockManagedDatabase).not.toHaveBeenCalled();
    next.dispose();
  });

  it("reattaches tracking after effect cleanup without rerunning restoration", async () => {
    const f = fixture(["active"]);
    const first = f.start();
    await first.restore;
    first.dispose();
    f.close(); // no listener, simulates access/selection ending while effects are detached
    f.calls.length = 0;
    const restarted = f.start(true, false, false);
    await restarted.restore;
    expect(f.calls).toEqual([]);
    f.select("manual");
    await vi.waitFor(() =>
      expect(f.saved.databaseOpenSet?.activeDatabaseId).toBe("manual"),
    );
    expect(f.manager.onCurrentDatabaseChange).toHaveBeenCalledTimes(2);
    restarted.dispose();
  });

  it("preserves intent across access locks but persists explicit close with native JSON-safe []/null", async () => {
    const f = fixture(["active"]);
    const task = f.start();
    await task.restore;
    f.settings.saveSettings.mockClear();
    f.emit("lock", null, null, "active");
    await Promise.resolve();
    expect(f.settings.saveSettings).not.toHaveBeenCalled();
    expect(f.saved.databaseOpenSet?.databaseIds).toEqual(["active"]);
    f.close();
    await vi.waitFor(() =>
      expect(f.saved.databaseOpenSet?.databaseIds).toEqual([]),
    );
    expect(f.saved.lastOpenedCollectionId).toBe("active"); // native retained old undefined patch
    expect(readDatabaseOpenSet(JSON.parse(JSON.stringify(f.saved)))).toEqual({
      version: 1,
      databaseIds: [],
      activeDatabaseId: null,
    });
    expect(Object.keys(f.settings.saveSettings.mock.calls[0][0])).toEqual([
      "databaseOpenSet",
      "lastOpenedCollectionId",
    ]);
    task.dispose();
  });

  it("prunes deleted references only after a successful inventory read", async () => {
    const f = fixture(["side", "deleted"]);
    f.rows.pop();
    const task = f.start();
    await task.restore;
    expect(f.calls).toEqual(["side:background"]);
    expect(f.saved.databaseOpenSet).toEqual({
      version: 1,
      databaseIds: ["side"],
      activeDatabaseId: null,
    });
    expect(f.showChooser).toHaveBeenCalledOnce();
    task.dispose();
    const failed = fixture();
    failed.manager.getAllDatabases.mockRejectedValue(new Error("Read failed"));
    const second = failed.start();
    await second.restore;
    expect(failed.settings.saveSettings).not.toHaveBeenCalled();
    second.dispose();
  });

  it.each(["secondary", "disabled", "safe-mode"])(
    "does not auto-restore in %s",
    async (mode) => {
      const f = fixture();
      if (mode === "disabled") f.saved.autoOpenLastCollection = false;
      const task = f.start(mode !== "secondary", mode === "safe-mode");
      await task.restore;
      expect(f.manager.getAllDatabases).not.toHaveBeenCalled();
      expect(f.settings.saveSettings).not.toHaveBeenCalled();
      if (mode === "secondary") {
        f.select("other-window");
        f.close();
        expect(f.manager.onCurrentDatabaseChange).not.toHaveBeenCalled();
        expect(f.settings.saveSettings).not.toHaveBeenCalled();
      }
      task.dispose();
    },
  );
});
