import { webcrypto } from "node:crypto";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  defaultCloudSyncConfig,
  type CloudSyncConfig,
  type CloudSyncTarget,
} from "../../src/types/settings/cloudSyncSettings";
import type { CloudSyncPayload } from "../../src/utils/services/cloudSyncPayload";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  capture: vi.fn(),
  apply: vi.fn(),
  local: { version: 1, sections: {} } as CloudSyncPayload,
  checkpoints: new Map<string, unknown>(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      getSettings: () =>
        mocks.local.sections["app:settings"] ?? { theme: "dark" },
    }),
  },
}));
vi.mock("../../src/utils/storage/indexedDbService", () => ({
  IndexedDbService: {
    getItemStrict: async (key: string) =>
      structuredClone(mocks.checkpoints.get(key) ?? null),
    setItemStrict: async (key: string, value: unknown) => {
      mocks.checkpoints.set(key, structuredClone(value));
    },
  },
}));
// Exercise the real scheduler, activity registry, serialized service, engine
// and snapshot codec. Persistence/transport doubles retain bytes and replay
// the producers' actual DOM event shapes; archive validation is out of scope.
vi.mock("../../src/utils/services/cloudSyncPayload", () => ({
  captureCloudSyncPayload: mocks.capture,
  applyCloudSyncPayload: mocks.apply,
  validateCloudSyncPayload: (value: unknown) => value,
  upgradeCloudSyncPayload: async (value: unknown) => value,
  discoverCloudSyncItems: async () => [],
}));
import {
  DATABASE_SYNC_CHANGED_EVENT,
  useCloudSyncScheduler,
} from "../../src/hooks/sync/useCloudSyncScheduler";
import {
  syncCloudTargets,
  type CloudSyncOperationResult,
} from "../../src/utils/services/cloudSyncService";
import {
  encodeCloudSnapshot,
  decodeCloudSnapshot,
} from "../../src/utils/services/cloudSyncCodec";

const target: CloudSyncTarget = {
  id: "echo-test",
  label: "Echo test",
  provider: "webdav",
  enabled: true,
};
let remote: string | null;
let revision: number;
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
function emitSaved(id: string) {
  if (id === "app:settings") {
    window.dispatchEvent(
      new CustomEvent("settings-updated", { detail: mocks.local.sections[id] }),
    );
  } else if (id.startsWith("database:")) {
    window.dispatchEvent(
      new CustomEvent(DATABASE_SYNC_CHANGED_EVENT, {
        detail: { databaseId: id.slice(9) },
      }),
    );
  } else {
    window.dispatchEvent(
      new CustomEvent("sorng-app-data-store-changed", {
        detail: { key: id.slice(4) },
      }),
    );
  }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const configFor = (selectedItems: string[]): CloudSyncConfig => ({
  ...defaultCloudSyncConfig,
  enabled: true,
  frequency: "realtime",
  syncOnStartup: true,
  selectedItems,
  encryptBeforeSync: false,
  compressionEnabled: false,
});
async function publish(payload: CloudSyncPayload, config: CloudSyncConfig) {
  remote = await encodeCloudSnapshot(
    {
      format: "sortofremoteng-cloud-sync",
      version: 1,
      modifiedAt: Date.now(),
      payload,
    },
    config,
  );
  revision++;
}
function mountScheduler(config: CloudSyncConfig) {
  const results: CloudSyncOperationResult[][] = [];
  const tasks: Promise<void>[] = [];
  const run = vi.fn(() => {
    const task = syncCloudTargets([target], config).then((outcomes) => {
      results.push(outcomes);
      // The application persists sync status after every successful/failed run.
      window.dispatchEvent(
        new CustomEvent("settings-updated", {
          detail: {
            ...(mocks.local.sections["app:settings"] ?? { theme: "dark" }),
            cloudSync: {
              lastSyncTime: Date.now(),
              lastSyncStatus: outcomes[0].status,
            },
          },
        }),
      );
    });
    tasks.push(task);
    return task;
  });
  renderHook(() => useCloudSyncScheduler(config, true, run));
  return {
    run,
    results,
    settle: () =>
      act(async () => {
        await tasks[tasks.length - 1];
      }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("crypto", webcrypto);
  mocks.checkpoints.clear();
  remote = null;
  revision = 0;
  mocks.capture
    .mockReset()
    .mockImplementation(async () => structuredClone(mocks.local));
  mocks.apply
    .mockReset()
    .mockImplementation(
      async (
        payload: CloudSyncPayload,
        _config: CloudSyncConfig,
        expected: CloudSyncPayload,
      ) => {
        expect(mocks.local).toEqual(expected);
        for (const [id, section] of Object.entries(payload.sections)) {
          mocks.local.sections[id] = structuredClone(section);
          emitSaved(id);
        }
      },
    );
  mocks.invoke
    .mockReset()
    .mockImplementation(
      async (
        command: string,
        args: { data: string; expectedRevision: string | null },
      ) => {
        if (command === "cloud_sync_read")
          return {
            data: remote,
            revision: remote === null ? null : String(revision),
          };
        expect(command).toBe("cloud_sync_write");
        expect(args.expectedRevision).toBe(
          remote === null ? null : String(revision),
        );
        remote = args.data;
        return { revision: String(++revision) };
      },
    );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["app:settings", "app:recording.terminal-macros", "database:selected"])(
  "settles a remote apply echo for %s after exactly one no-op follow-up",
  async (id) => {
    const config = configFor([id]);
    mocks.local = { version: 1, sections: { [id]: { theme: "dark" } } };
    expect((await syncCloudTargets([target], config))[0].status).toBe(
      "success",
    );
    const incoming: CloudSyncPayload = {
      version: 1,
      sections: { [id]: { theme: "light" } },
    };
    await publish(incoming, config);
    mocks.invoke.mockClear();
    const { run, results, settle } = mountScheduler(config);
    await advance(1000);
    await settle();
    expect(mocks.local).toEqual(incoming);
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    await advance(2999);
    expect(run).toHaveBeenCalledOnce();
    await advance(1);
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(results.map((entry) => entry[0].status)).toEqual([
      "success",
      "success",
    ]);
    expect(results[1][0].message).toMatch(/already|unchanged|up.to.date/i);
    await advance(3_600_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "cloud_sync_write",
      ),
    ).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("keeps a local edit made during remote apply and uploads it in the single deferred follow-up", async () => {
  const macroId = "app:recording.terminal-macros";
  const config = configFor(["app:settings", macroId]);
  mocks.local = {
    version: 1,
    sections: {
      "app:settings": { theme: "dark" },
      [macroId]: { name: "original" },
    },
  };
  expect((await syncCloudTargets([target], config))[0].status).toBe("success");
  const incoming = structuredClone(mocks.local);
  incoming.sections["app:settings"] = { theme: "light" };
  await publish(incoming, config);
  mocks.invoke.mockClear();
  const applied = deferred();
  const release = deferred();
  mocks.apply.mockImplementationOnce(async (payload: CloudSyncPayload) => {
    mocks.local.sections["app:settings"] = structuredClone(
      payload.sections["app:settings"],
    );
    emitSaved("app:settings");
    applied.resolve();
    await release.promise;
  });
  const { run, results, settle } = mountScheduler(config);
  await advance(1000);
  await act(async () => {
    await applied.promise;
  });
  act(() => {
    mocks.local.sections[macroId] = { name: "edited during remote apply" };
    emitSaved(macroId);
  });
  await advance(30_000);
  expect(run).toHaveBeenCalledOnce();
  release.resolve();
  await settle();
  expect(results[0][0].status).toBe("partial");
  await advance(3000);
  await settle();
  expect(run).toHaveBeenCalledTimes(2);
  expect(results[1][0].status).toBe("success");
  expect((await decodeCloudSnapshot(remote!, config)).payload).toEqual(
    mocks.local,
  );
  expect(mocks.local.sections[macroId]).toEqual({
    name: "edited during remote apply",
  });
  await advance(3_600_000);
  expect(run).toHaveBeenCalledTimes(2);
  expect(mocks.apply).toHaveBeenCalledOnce();
});
