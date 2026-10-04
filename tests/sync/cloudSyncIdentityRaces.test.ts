import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultCloudSyncConfig,
  type CloudSyncConfig,
  type CloudSyncTarget,
} from "../../src/types/settings/cloudSyncSettings";
import type { CloudSyncPayload } from "../../src/utils/services/cloudSyncPayload";

const mocks = vi.hoisted(() => ({
  getInvoke: vi.fn(),
  invoke: vi.fn(),
  capture: vi.fn(),
  apply: vi.fn(),
  hash: vi.fn(),
  buildBaseline: vi.fn(),
  getCheckpoint: vi.fn(),
  setCheckpoint: vi.fn(),
  store: new Map<string, unknown>(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({ getInvoke: mocks.getInvoke }));
vi.mock("../../src/utils/storage/indexedDbService", () => ({
  IndexedDbService: {
    getItemStrict: mocks.getCheckpoint,
    setItemStrict: mocks.setCheckpoint,
  },
}));
vi.mock("../../src/utils/services/cloudSyncPayload", () => ({
  captureCloudSyncPayload: mocks.capture,
  applyCloudSyncPayload: mocks.apply,
  validateCloudSyncPayload: (value: unknown) => value,
  upgradeCloudSyncPayload: async (value: unknown) => value,
  discoverCloudSyncItems: async () => [
    { id: "app:settings", label: "Appearance preferences" },
  ],
}));
vi.mock("../../src/utils/services/cloudSyncCodec", async (actual) => ({
  ...(await actual<object>()),
  syncHash: mocks.hash,
}));
vi.mock("../../src/utils/services/cloudSyncSmartMerge", () => ({
  buildSmartSyncBaseline: mocks.buildBaseline,
  smartMergeSyncSection: async () => ({ conflictCount: 1 }),
}));

// Keep the real queue, engine, service, identity registry, codec and SHA-256.
// Only storage/IPC and the awaited boundaries are controlled; no remote I/O.
import * as engine from "../../src/utils/services/cloudSyncEngine";
import {
  syncCloudTarget,
  reviewCloudSyncTarget,
} from "../../src/utils/services/cloudSyncService";
import {
  cloudSyncTargetIdentity,
  invalidateCloudSyncTarget,
  getCloudSyncActivity,
} from "../../src/utils/services/cloudSyncActivity";
const codec = await vi.importActual<
  typeof import("../../src/utils/services/cloudSyncCodec")
>("../../src/utils/services/cloudSyncCodec");

const target: CloudSyncTarget = {
  id: "identity-race-fixture",
  label: "Fixture",
  provider: "webdav",
  enabled: true,
  webdav: {
    serverUrl: "https://fixture.invalid",
    folderPath: "/before",
    username: "fixture-user",
    authMethod: "basic",
  },
};
const config = (): CloudSyncConfig => ({
  ...defaultCloudSyncConfig,
  enabled: true,
  syncTargets: [target],
  selectedItems: ["app:settings"],
  encryptBeforeSync: false,
  compressionEnabled: false,
});
const payload = (theme: string): CloudSyncPayload => ({
  version: 1,
  sections: { "app:settings": { theme } },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function pause(finish: () => unknown | Promise<unknown>) {
  const entered = deferred<void>();
  const release = deferred<void>();
  return {
    entered: entered.promise,
    release: () => release.resolve(),
    run: async () => {
      entered.resolve();
      await release.promise;
      return finish();
    },
  };
}
function settle(pending: Promise<unknown>) {
  return pending.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

let local: CloudSyncPayload;
let remote: { data: string | null; revision: string | null };
let captureCount: number;
let captured: WeakMap<object, number>;
function takeCapture() {
  const result = structuredClone(local);
  captured.set(result, ++captureCount);
  return result;
}
function commands() {
  return mocks.invoke.mock.calls.map(([command]) => command);
}
function expectNoMutations() {
  expect(commands()).not.toContain("cloud_sync_write");
  expect(mocks.apply).not.toHaveBeenCalled();
}
function expectNoSynchronizedCheckpoint() {
  for (const [, value] of mocks.setCheckpoint.mock.calls)
    expect(value.baseline).toEqual({});
}
async function remoteCopy(theme = "remote") {
  remote = {
    revision: "remote-v1",
    data: await codec.encodeCloudSnapshot(
      {
        format: "sortofremoteng-cloud-sync",
        version: 1,
        modifiedAt: Date.now(),
        payload: payload(theme),
      },
      config(),
    ),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  invalidateCloudSyncTarget(target.id);
  mocks.store.clear();
  local = payload("local");
  remote = { data: null, revision: null };
  captureCount = 0;
  captured = new WeakMap();
  mocks.getInvoke.mockResolvedValue(mocks.invoke);
  mocks.hash.mockImplementation(codec.syncHash);
  mocks.capture.mockImplementation(async () => takeCapture());
  mocks.getCheckpoint.mockImplementation(async (key: string) =>
    structuredClone(mocks.store.get(key) ?? null),
  );
  mocks.setCheckpoint.mockImplementation(
    async (key: string, value: unknown) => {
      mocks.store.set(key, structuredClone(value));
    },
  );
  mocks.buildBaseline.mockResolvedValue({
    version: 1,
    salt: "fixture",
    root: { hash: "fixture", kind: "atomic" },
  });
  mocks.invoke.mockImplementation(
    async (command: string, args: { data?: string }) => {
      if (command === "cloud_sync_read") return { ...remote };
      if (command === "cloud_sync_write") {
        remote = { data: args.data!, revision: "written-v1" };
        return { revision: remote.revision };
      }
      throw new Error("Unexpected fixture command");
    },
  );
  mocks.apply.mockImplementation(async (next: CloudSyncPayload) => {
    local = { version: 1, sections: { ...local.sections, ...next.sections } };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cloud sync immutable request identity", () => {
  it.each(["sync", "review"] as const)(
    "captures the default %s identity before initial getInvoke yields",
    async (operation) => {
      const gate = pause(() => mocks.invoke);
      mocks.getInvoke.mockImplementationOnce(gate.run);
      const pending = settle(
        operation === "sync"
          ? engine.runCloudSync(target, config())
          : engine.reviewCloudSync(target, config()),
      );
      await gate.entered;
      invalidateCloudSyncTarget(target.id);
      gate.release();
      expect(await pending).toMatchObject({
        ok: false,
        error: { kind: "conflict" },
      });
      expect(commands()).toEqual([]);
      expect(mocks.capture).not.toHaveBeenCalled();
      expectNoMutations();
    },
  );

  it.each(["sync", "review"] as const)(
    "rejects an explicitly revoked %s identity instead of adopting the current one",
    async (operation) => {
      const original = cloudSyncTargetIdentity(target.id);
      invalidateCloudSyncTarget(target.id);
      const pending =
        operation === "sync"
          ? engine.runCloudSync(target, config(), undefined, original)
          : engine.reviewCloudSync(target, config(), original);
      expect(await settle(pending)).toMatchObject({
        ok: false,
        error: { kind: "conflict" },
      });
      expect(mocks.getInvoke).not.toHaveBeenCalled();
      expectNoMutations();
    },
  );

  it.each(["sync", "review"] as const)(
    "passes the original service %s identity through the real engine",
    async (operation) => {
      const original = cloudSyncTargetIdentity(target.id);
      const spy = vi.spyOn(
        engine,
        operation === "sync" ? "runCloudSync" : "reviewCloudSync",
      );
      const settings = config();
      const gate = pause(() => mocks.invoke);
      mocks.getInvoke.mockImplementationOnce(gate.run);
      const pending = settle(
        operation === "sync"
          ? syncCloudTarget(target, settings)
          : reviewCloudSyncTarget(target, settings),
      );
      await gate.entered;
      expect(spy).toHaveBeenCalledWith(
        ...(operation === "sync"
          ? [target, settings, undefined, original]
          : [target, settings, original]),
      );
      invalidateCloudSyncTarget(target.id);
      gate.release();
      expect(await pending).toMatchObject(
        operation === "sync"
          ? {
              ok: true,
              value: { status: "conflict", requestIdentity: original },
            }
          : { ok: false, error: { kind: "conflict" } },
      );
      expectNoMutations();
      expect(commands()).toEqual([]);
      expect(getCloudSyncActivity()).toHaveLength(0);
    },
  );

  it("rejects revocation during the remote read without retrying or applying", async () => {
    const gate = pause(() => ({ ...remote }));
    mocks.invoke.mockImplementationOnce(gate.run);
    const pending = settle(engine.runCloudSync(target, config()));
    await gate.entered;
    invalidateCloudSyncTarget(target.id);
    gate.release();
    expect(await pending).toMatchObject({
      ok: false,
      error: { kind: "conflict" },
    });
    expect(commands()).toEqual(["cloud_sync_read"]);
    expectNoMutations();
    expectNoSynchronizedCheckpoint();
  });

  it.each([
    ["upload", "capture"],
    ["upload", "hash"],
    ["restore", "capture"],
    ["restore", "hash"],
  ] as const)(
    "rejects revocation during the final %s %s before dispatch",
    async (operation, boundary) => {
      const settings = config();
      if (operation === "restore") {
        await remoteCopy();
        settings.conflictResolution = "keepRemote";
      }
      // Captures: original, post-read validation, post-plan validation, then
      // the last validation immediately preceding upload/local apply.
      const gate = pause(() =>
        boundary === "capture" ? takeCapture() : codec.syncHash(local),
      );
      if (boundary === "capture") {
        mocks.capture.mockImplementation(() =>
          captureCount === 3 ? gate.run() : Promise.resolve(takeCapture()),
        );
      } else {
        mocks.hash.mockImplementation((value: object) =>
          captured.get(value) === 4 ? gate.run() : codec.syncHash(value),
        );
      }
      const pending = settle(engine.runCloudSync(target, settings));
      await gate.entered;
      expectNoMutations();
      invalidateCloudSyncTarget(target.id);
      gate.release();
      expect(await pending).toMatchObject({
        ok: false,
        error: { kind: "conflict" },
      });
      expectNoMutations();
      expect(local).toEqual(payload("local"));
      expectNoSynchronizedCheckpoint();
    },
  );

  it.each([
    [5, "capture"],
    [5, "hash"],
    [6, "capture"],
    [6, "hash"],
  ] as const)(
    "reports partial and keeps the old baseline after verification capture %i / %s revocation",
    async (ordinal, boundary) => {
      // Upload has committed before capture 5 (first verification) and capture 6
      // (verification after building baseline metadata). Never bless either race.
      const gate = pause(() =>
        boundary === "capture" ? takeCapture() : codec.syncHash(local),
      );
      if (boundary === "capture") {
        mocks.capture.mockImplementation(() =>
          captureCount === ordinal - 1
            ? gate.run()
            : Promise.resolve(takeCapture()),
        );
      } else {
        mocks.hash.mockImplementation((value: object) =>
          captured.get(value) === ordinal ? gate.run() : codec.syncHash(value),
        );
      }
      const pending = settle(engine.runCloudSync(target, config()));
      await gate.entered;
      expect(commands()).toEqual(["cloud_sync_read", "cloud_sync_write"]);
      invalidateCloudSyncTarget(target.id);
      gate.release();
      expect(await pending).toMatchObject({
        ok: false,
        error: { kind: "partial" },
      });
      expect(commands()).toEqual(["cloud_sync_read", "cloud_sync_write"]);
      expect(mocks.apply).not.toHaveBeenCalled();
      expectNoSynchronizedCheckpoint();
    },
  );

  it("does not publish a baseline built after revocation following a committed upload", async () => {
    const gate = pause(() => ({
      version: 1,
      salt: "fixture",
      root: { hash: "fixture", kind: "atomic" },
    }));
    mocks.buildBaseline.mockImplementationOnce(gate.run);
    const pending = settle(engine.runCloudSync(target, config()));
    await gate.entered;
    expect(commands()).toEqual(["cloud_sync_read", "cloud_sync_write"]);
    invalidateCloudSyncTarget(target.id);
    gate.release();
    expect(await pending).toMatchObject({
      ok: false,
      error: { kind: "partial" },
    });
    expectNoSynchronizedCheckpoint();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("rechecks identity after hashing the final checkpoint, without claiming upload rollback", async () => {
    let baselineBuilt = false;
    let finalPayloadHashes = 0;
    mocks.buildBaseline.mockImplementation(async () => {
      baselineBuilt = true;
      return {
        version: 1,
        salt: "fixture",
        root: { hash: "fixture", kind: "atomic" },
      };
    });
    const gate = pause(() => codec.syncHash(local));
    mocks.hash.mockImplementation((value: object) => {
      if (
        baselineBuilt &&
        "sections" in value &&
        !captured.has(value) &&
        ++finalPayloadHashes === 2
      )
        return gate.run();
      return codec.syncHash(value);
    });
    const pending = settle(engine.runCloudSync(target, config()));
    await gate.entered;
    invalidateCloudSyncTarget(target.id);
    gate.release();
    expect(await pending).toMatchObject({
      ok: false,
      error: { kind: "partial" },
    });
    expect(commands()).toEqual(["cloud_sync_read", "cloud_sync_write"]);
    expectNoSynchronizedCheckpoint();
  });

  it.each([false, true])(
    "retains the original identity across the local-edit retry (explicit=%s)",
    async (explicit) => {
      const original = cloudSyncTargetIdentity(target.id);
      const newer = payload("newer-local");
      const newerHash = await codec.syncHash(newer);
      mocks.capture.mockImplementation(async () => {
        if (captureCount === 1) local = newer;
        return takeCapture();
      });
      let revoked = false;
      mocks.hash.mockImplementation((value: object) => {
        if (captured.get(value) !== 2) return codec.syncHash(value);
        // Resolve the changed hash first, allowing the identity check to pass
        // and LocalSyncEdit to propagate. Revoke in the microtask gap before
        // runCloudSync's retry: a retry must not capture a replacement identity.
        return {
          then(resolve: (hash: string) => void) {
            resolve(newerHash);
            queueMicrotask(() =>
              queueMicrotask(() => {
                revoked = true;
                invalidateCloudSyncTarget(target.id);
              }),
            );
          },
        };
      });
      const result = await settle(
        explicit
          ? engine.runCloudSync(target, config(), undefined, original)
          : engine.runCloudSync(target, config()),
      );
      expect(revoked).toBe(true);
      expect(cloudSyncTargetIdentity(target.id)).not.toBe(original);
      expect(result).toMatchObject({ ok: false, error: { kind: "conflict" } });
      expect(commands()).toEqual(["cloud_sync_read"]);
      expectNoMutations();
      expectNoSynchronizedCheckpoint();
    },
  );

  it("still retries a genuine local edit once when the original identity remains current", async () => {
    const original = cloudSyncTargetIdentity(target.id);
    mocks.capture.mockImplementation(async () => {
      if (captureCount === 1) local = payload("newer-local");
      return takeCapture();
    });
    await expect(
      engine.runCloudSync(target, config(), undefined, original),
    ).resolves.toMatch(/uploaded/);
    expect(commands()).toEqual([
      "cloud_sync_read",
      "cloud_sync_read",
      "cloud_sync_write",
    ]);
    expect(cloudSyncTargetIdentity(target.id)).toBe(original);
    expect(mocks.apply).not.toHaveBeenCalled();
    const uploaded = await codec.decodeCloudSnapshot(remote.data!, config());
    expect(uploaded.payload).toEqual(payload("newer-local"));
  });
});
