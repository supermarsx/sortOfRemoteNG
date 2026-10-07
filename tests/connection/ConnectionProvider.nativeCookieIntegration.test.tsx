import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<
    string,
    (event: { payload: { databaseId: string } }) => void
  >(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => native.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (
      name: string,
      callback: (event: { payload: { databaseId: string } }) => void,
    ) => {
      native.listeners.set(name, callback);
      return () => {
        if (native.listeners.get(name) === callback)
          native.listeners.delete(name);
      };
    },
  ),
}));
import { ConnectionProvider } from "../../src/contexts/ConnectionProvider";
import { useConnections } from "../../src/contexts/useConnections";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { stableJsonStringify } from "../../src/utils/core/stableJsonStringify";
import { reconcileRecordLedger } from "../../src/utils/storage/recordLedger";
import { materializeDatabaseArchiveDefaults } from "../../src/utils/connection/fullDatabaseArchive";
import { acquireCloudSyncDatabaseBarrier } from "../../src/utils/services/cloudSyncDatabaseBarrier";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";
import { useCloudSyncScheduler } from "../../src/hooks/sync/useCloudSyncScheduler";
import type { StorageData } from "../../src/utils/storage/storage";
import type { ConnectionDatabase } from "../../src/types/connection/connection";
import { collection, fullData, trust } from "../fixtures/fullDatabaseArchive";

let stored: StorageData;
let rows: ConnectionDatabase[];
let manager: DatabaseManager;
let refreshed: number;
const descriptor = {
  version: 1 as const,
  records: [{ connectionId: "host", revision: "a".repeat(64) }],
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectionProvider>{children}</ConnectionProvider>
);
function body(value: StorageData) {
  const { browserSessions: _nativeOwned, ...rest } = value;
  return stableJsonStringify(rest);
}
beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  DatabaseManager.resetInstance();
  vi.clearAllMocks();
  native.listeners.clear();
  vi.spyOn(SettingsManager.prototype, "logAction").mockResolvedValue(undefined);
  stored = materializeDatabaseArchiveDefaults(await fullData());
  stored.recordMetadata = await reconcileRecordLedger(stored);
  rows = [structuredClone(collection)];
  native.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown> = {}) => {
      if (command === "databases_list")
        return { value: structuredClone(rows), source: "current" };
      if (command === "databases_save_index") {
        rows = structuredClone(args.list as ConnectionDatabase[]);
        return;
      }
      if (command === "load_database_data")
        return {
          value: JSON.stringify({
            format: "sorng-db",
            version: 1,
            ciphertext: "opaque",
          }),
          source: "current",
        };
      if (
        ["database_protection_unlock", "database_protection_load"].includes(
          command,
        )
      )
        return {
          sessionId: "native-token",
          sessionExpiresAt: null,
          securityRevision: collection.securityRevision,
          data: structuredClone(stored),
        };
      if (command === "database_browser_sessions_describe")
        return structuredClone(
          stored.browserSessions ?? { version: 1, records: [] },
        );
      if (command === "database_browser_sessions_export")
        return { version: 1, ciphertext: "sealed-synthetic-capsule" };
      if (command === "trust_export_database") return structuredClone(trust);
      if (command === "database_protection_save") {
        if (body(args.expectedData as StorageData) !== body(stored))
          throw new Error("Public CAS conflict");
        const projection = stored.browserSessions;
        stored = structuredClone(args.data as StorageData);
        if (projection) stored.browserSessions = projection;
        else delete stored.browserSessions;
        return {
          committed: true,
          cleanupPending: false,
          warnings: [],
          securityRevision: collection.securityRevision,
        };
      }
      if (command === "database_protection_release_session")
        return { released: true };
      return undefined;
    },
  );
  manager = DatabaseManager.getInstance();
  await manager.unlockManagedDatabase(collection.id, "slot", "password");
  await manager.selectDatabase(collection.id);
  refreshed = 0;
  const capture = manager.captureCurrentDatabaseDataTarget.bind(manager);
  vi.spyOn(manager, "captureCurrentDatabaseDataTarget").mockImplementation(
    () => {
      const target = capture();
      if (!target?.refreshBrowserSessionProjection) return target;
      const refresh = target.refreshBrowserSessionProjection;
      return {
        ...target,
        refreshBrowserSessionProjection: async () => {
          const result = await refresh();
          refreshed += 1;
          return result;
        },
      };
    },
  );
});
afterEach(() => {
  DatabaseManager.resetInstance();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function mount() {
  const run = vi.fn(async () => {});
  const view = renderHook(
    () => {
      const connections = useConnections();
      useCloudSyncScheduler(
        {
          ...defaultCloudSyncConfig,
          enabled: true,
          frequency: "realtime",
          selectedItems: [`database:${collection.id}`],
          adaptiveSyncEnabled: false,
        },
        true,
        run,
      );
      return connections;
    },
    { wrapper },
  );
  await act(async () => {
    await view.result.current.loadData(collection.id);
  });
  await waitFor(() => expect(refreshed).toBeGreaterThan(0));
  refreshed = 0;
  return { ...view, run };
}
const emit = () =>
  act(() =>
    native.listeners.get("database-protection:browser-sessions-changed")!({
      payload: { databaseId: collection.id },
    }),
  );

it("connects native hints through authenticated describe, real target refresh, unsaved edits and the scheduler", async () => {
  const view = await mount();
  stored.browserSessions = descriptor;
  act(() =>
    view.result.current.dispatch({
      type: "UPDATE_CONNECTION",
      payload: {
        ...view.result.current.state.connections.find(
          (row) => row.id === "host",
        )!,
        name: "Unsaved user name",
      },
    }),
  );
  emit();
  emit();
  await waitFor(() => expect(refreshed).toBeGreaterThan(0));
  expect(
    view.result.current.state.connections.find((row) => row.id === "host")
      ?.name,
  ).toBe("Unsaved user name");
  await act(async () => {
    await view.result.current.flushPendingSave();
  });
  expect(stored.browserSessions).toEqual(descriptor);
  expect(stored.connections.find((row) => row.id === "host")?.name).toBe(
    "Unsaved user name",
  );
  expect(manager.getDatabaseAccessState(collection.id)?.status).toBe("ready");
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(view.run).toHaveBeenCalledOnce();
  view.unmount();
});

it("ignores duplicate/activity-only hints when the authoritative descriptor is unchanged", async () => {
  const view = await mount();
  emit();
  emit();
  await act(() => vi.advanceTimersByTimeAsync(4000));
  expect(refreshed).toBe(0);
  expect(view.run).not.toHaveBeenCalled();
  expect(view.result.current.persistence.dirty).toBe(false);
  view.unmount();
});

it("keeps cookie-only capture history stable and permits the next ordinary edit", async () => {
  const view = await mount();
  const beforeHistory = structuredClone(stored.recordMetadata);
  stored.browserSessions = descriptor;
  let release!: () => Promise<void>;
  await act(async () => {
    release = await acquireCloudSyncDatabaseBarrier([collection.id]);
  });
  await manager.readFullDatabaseArchive(collection.id, {
    materializeDefaults: true,
    browserSessionsPassword: "separate-sync-password",
  });
  expect(stored.recordMetadata).toEqual(beforeHistory);
  await act(async () => {
    await release();
  });
  act(() =>
    view.result.current.dispatch({
      type: "UPDATE_CONNECTION",
      payload: {
        ...view.result.current.state.connections.find(
          (row) => row.id === "host",
        )!,
        name: "After capture",
      },
    }),
  );
  await act(async () => {
    await view.result.current.flushPendingSave();
  });
  expect(stored.connections.find((row) => row.id === "host")?.name).toBe(
    "After capture",
  );
  expect(stored.browserSessions).toEqual(descriptor);
  expect(manager.getDatabaseAccessState(collection.id)?.status).toBe("ready");
  view.unmount();
});
