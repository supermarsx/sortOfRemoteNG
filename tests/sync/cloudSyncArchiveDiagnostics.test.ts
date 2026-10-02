import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultCloudSyncConfig,
  type CloudSyncTarget,
} from "../../src/types/settings/cloudSyncSettings";
import type { GlobalSettings } from "../../src/types/settings/settings";
import {
  buildFullDatabaseArchive,
  FullDatabaseArchiveError,
} from "../../src/utils/connection/fullDatabaseArchive";
import {
  applyCloudSyncPayload,
  captureCloudSyncPayload,
} from "../../src/utils/services/cloudSyncPayload";
import { encodeCloudSnapshot } from "../../src/utils/services/cloudSyncCodec";
import {
  cloudSyncStatusUpdate,
  syncCloudTarget,
} from "../../src/utils/services/cloudSyncService";
import { useCloudSyncSettings } from "../../src/hooks/settings/useCloudSyncSettings";
import {
  collection,
  connection,
  fullData,
  trust,
} from "../fixtures/fullDatabaseArchive";

const state = vi.hoisted(() => ({
  read: vi.fn(),
  restore: vi.fn(),
  invoke: vi.fn(),
  settings: { theme: "dark" },
  checkpoints: new Map<string, unknown>(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "source-db" }),
      getExportableDatabases: async () => [
        {
          id: "source-db",
          name: "PRIVATE_DATABASE_NAME",
          isExportable: true,
          protectionFormat: "sorng-db",
        },
      ],
      readFullDatabaseArchive: state.read,
      restoreCloudSyncArchive: state.restore,
    }),
  },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => state.invoke,
}));
vi.mock("../../src/utils/storage/indexedDbService", () => ({
  IndexedDbService: {
    getItemStrict: async (key: string) =>
      structuredClone(state.checkpoints.get(key) ?? null),
    setItemStrict: async (key: string, value: unknown) => {
      state.checkpoints.set(key, structuredClone(value));
    },
  },
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      getSettings: () => state.settings,
      saveCloudSyncSettings: async (settings: typeof state.settings) => {
        state.settings = settings;
      },
    }),
  },
}));

const target: CloudSyncTarget = {
  id: "archive-test",
  label: "Archive",
  provider: "nextcloud",
  enabled: true,
};
const config = () => ({
  ...defaultCloudSyncConfig,
  enabled: true,
  selectedItems: ["database:source-db"],
  syncTargets: [target],
  encryptBeforeSync: true,
  syncEncryptionPassword: "PRIVATE_SYNC_PASSWORD",
  compressionEnabled: false,
});

async function dependencyError() {
  const data = await fullData();
  data.connections[1].parentId = "missing-folder";
  const error = await buildFullDatabaseArchive(collection, data, trust).catch(
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(FullDatabaseArchiveError);
  return error as FullDatabaseArchiveError;
}

beforeEach(() => {
  state.read.mockReset();
  state.restore.mockReset();
  state.invoke.mockReset();
  state.checkpoints.clear();
  state.settings = { theme: "dark" };
  state.invoke.mockImplementation(async (command: string) => {
    if (command === "read_app_settings") return state.settings;
    if (command === "cloud_sync_read") return { data: null, revision: null };
    if (command === "cloud_sync_write") return { revision: "new-revision" };
    return null;
  });
});

describe("archive diagnostics through cloud sync", () => {
  it.each(["ssh-owner", "ssh-source", "external-script", "external-document"])(
    "retains actionable per-record %s diagnostics at the real sync caller without writes",
    async (reason) => {
      const data = await fullData();
      let path: string;
      let remedy: string;
      if (reason === "ssh-owner" || reason === "ssh-source") {
        data.connections[2].security = {
          tunnelChain: [
            {
              id: "route",
              type: "ssh-tunnel",
              enabled: true,
              sshTunnel: {
                connectionId: reason === "ssh-source" ? "missing-ssh" : "host",
                ...(reason === "ssh-source"
                  ? { ownerDatabaseId: collection.id }
                  : {}),
                forwardType: "local",
              },
            },
          ],
        };
        path = `connections[2].security.tunnelChain[0].sshTunnel.${reason === "ssh-owner" ? "ownerDatabaseId" : "connectionId"}`;
        remedy = "inline tunnel or jump-host settings";
      } else if (reason === "external-script") {
        data.connections[2].sshQuickActions = {
          version: 1,
          items: [{ kind: "macro", id: "app-macro", scope: { kind: "app" } }],
        };
        path = "connections[2].sshQuickActions.items[0]";
        remedy = "reselect the database-owned item";
      } else {
        const block = data.documents!.documents[0].blocks[2];
        if (block.type !== "reference") throw new Error("fixture");
        block.reference = {
          scope: "app",
          databaseId: collection.id,
          kind: "document",
          id: "document",
        };
        path = "documents.documents[0].blocks[2].reference";
        remedy = "Copy the required target into this database and reselect it";
      }
      const original = structuredClone(data);
      state.read.mockImplementation(() =>
        buildFullDatabaseArchive(collection, data, trust),
      );
      const result = await syncCloudTarget(target, config());
      expect(result.status).toBe("failed");
      expect(result.message).toContain(path);
      expect(result.message).toContain(
        `record "${reason === "external-document" ? "document" : "local"}"`,
      );
      expect(result.message).toContain(remedy);
      expect(result.message).not.toMatch(/PRIVATE_|fixture\.test|JBSWY/);
      expect(
        cloudSyncStatusUpdate(config(), [result]).targetStatus?.[target.id]
          .lastSyncError,
      ).toBe(result.message);
      expect(
        state.invoke.mock.calls.some(([command]) =>
          command.startsWith("cloud_sync_"),
        ),
      ).toBe(false);
      expect(state.restore).not.toHaveBeenCalled();
      expect(data).toEqual(original);
    },
  );

  it("keeps capture diagnostics in the target result and persisted status without transport or restore", async () => {
    const error = await dependencyError();
    state.read.mockRejectedValue(error);
    const result = await syncCloudTarget(target, config());
    expect(result).toMatchObject({ status: "failed", message: error.message });
    expect(
      cloudSyncStatusUpdate(config(), [result]).targetStatus?.[target.id]
        .lastSyncError,
    ).toBe(error.message);
    expect(
      state.invoke.mock.calls.some(([command]) =>
        command.startsWith("cloud_sync_"),
      ),
    ).toBe(false);
    expect(state.restore).not.toHaveBeenCalled();
  });

  it("preserves remote dependency details before any upload or restore", async () => {
    const local = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      trust,
    );
    state.read.mockResolvedValue(local);
    const remote = structuredClone(local);
    remote.connections[2].security!.sshTunnel!.connectionId =
      "remote-missing-host";
    const data = await encodeCloudSnapshot(
      {
        format: "sortofremoteng-cloud-sync",
        version: 1,
        modifiedAt: Date.now(),
        payload: { version: 1, sections: { "database:source-db": remote } },
      },
      config(),
    );
    state.invoke.mockImplementation(async (command: string) =>
      command === "cloud_sync_read" ? { data, revision: "remote" } : null,
    );
    const result = await syncCloudTarget(target, config());
    expect(result.status).toBe("failed");
    expect(result.message).toContain(
      "connections[2].security.sshTunnel.connectionId",
    );
    expect(result.message).toContain("remote-missing-host");
    expect(
      state.invoke.mock.calls
        .filter(([command]) => command.startsWith("cloud_sync_"))
        .map(([command]) => command),
    ).toEqual(["cloud_sync_read"]);
    expect(state.restore).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "retains only trusted diagnostics after a completed upload (archive error=%s)",
    async (archiveError) => {
      const local = await buildFullDatabaseArchive(
        collection,
        await fullData(),
        trust,
      );
      state.read.mockResolvedValue(local);
      const remote = structuredClone(local);
      delete remote.recordMetadata;
      remote.connections[2].port = 2222;
      const settings = {
        ...config(),
        selectedItems: ["app:settings", "database:source-db"],
        conflictResolution: "keepRemote" as const,
      };
      const data = await encodeCloudSnapshot(
        {
          format: "sortofremoteng-cloud-sync",
          version: 1,
          modifiedAt: Date.now(),
          payload: { version: 1, sections: { "database:source-db": remote } },
        },
        settings,
      );
      state.invoke.mockImplementation(async (command: string) => {
        if (command === "cloud_sync_read") return { data, revision: "remote" };
        if (command === "read_app_settings") return state.settings;
        return null;
      });
      const error = archiveError
        ? await dependencyError()
        : new Error("PRIVATE_BACKEND_PAYLOAD");
      state.restore.mockRejectedValue(error);
      const result = await syncCloudTarget(target, settings);
      expect(result.status).toBe("partial");
      expect(result.message).toContain(
        "Sync is incomplete after data was saved",
      );
      if (archiveError) expect(result.message).toContain(error.message);
      expect(result.message).not.toMatch(/PRIVATE_/);
      expect(
        state.invoke.mock.calls.filter(
          ([command]) => command === "cloud_sync_write",
        ),
      ).toHaveLength(1);
      expect(state.restore).toHaveBeenCalledTimes(1);
      expect([...state.checkpoints.values()][0]).toMatchObject({
        baseline: {},
      });
    },
  );

  it("keeps the dependency cause when an earlier artifact was already applied", async () => {
    state.read.mockResolvedValue(
      await buildFullDatabaseArchive(collection, await fullData(), trust),
    );
    const settings = {
      ...config(),
      selectedItems: ["app:settings", "database:source-db"],
    };
    const original = await captureCloudSyncPayload(settings);
    const next = structuredClone(original);
    next.sections["app:settings"] = { theme: "light" };
    const error = await dependencyError();
    state.restore.mockRejectedValue(error);
    await expect(
      applyCloudSyncPayload(next, settings, original),
    ).rejects.toMatchObject({
      kind: "partial",
      cause: error,
      message: expect.stringContaining(error.message),
    });
    expect(state.settings.theme).toBe("light");
    expect(state.restore).toHaveBeenCalledTimes(1);
  });

  it("preserves bounded multiline details through settings sanitization without truncation", async () => {
    const data = await fullData();
    for (let index = 0; index < 25; index++)
      data.connections.push({
        ...connection(`dangling-${index}`),
        parentId: "absent",
      });
    const error = (await buildFullDatabaseArchive(
      collection,
      data,
      trust,
    ).catch((error: unknown) => error)) as FullDatabaseArchiveError;
    expect(error.message.length).toBeGreaterThan(2048);
    state.read.mockRejectedValue(error);
    const update = vi.fn();
    const hook = renderHook(() =>
      useCloudSyncSettings({ cloudSync: config() } as GlobalSettings, update),
    );
    await act(async () => {
      await hook.result.current.handleSyncTarget(target.id);
    });
    const saved = update.mock.lastCall![0].cloudSync;
    expect(saved.targetStatus[target.id].lastSyncError).toBe(error.message);
    expect(saved.providerStatus.nextcloud.lastSyncError).toBe(error.message);
    expect(saved.lastSyncError).toBe(error.message);
    expect(saved.lastSyncError).toContain("\n12.");
    expect(saved.lastSyncError).toContain("13 more issues");
    hook.unmount();
  });
});
