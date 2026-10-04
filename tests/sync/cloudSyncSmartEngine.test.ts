import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  defaultCloudSyncConfig,
  type CloudSyncConfig,
  type CloudSyncTarget,
} from "../../src/types/settings/cloudSyncSettings";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  capture: vi.fn(),
  apply: vi.fn(),
  store: new Map<string, unknown>(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
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
vi.mock(
  "../../src/utils/services/cloudSyncPayload",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../src/utils/services/cloudSyncPayload")
    >()),
    captureCloudSyncPayload: mocks.capture,
    applyCloudSyncPayload: mocks.apply,
    discoverCloudSyncItems: async () => [
      { id: "database:source-db", label: "Full source" },
    ],
  }),
);

import {
  runCloudSync,
  reviewCloudSync,
} from "../../src/utils/services/cloudSyncEngine";
import {
  decodeCloudSnapshot,
  encodeCloudSnapshot,
} from "../../src/utils/services/cloudSyncCodec";
import {
  upgradeCloudSyncPayload,
  type CloudSyncPayload,
} from "../../src/utils/services/cloudSyncPayload";
import {
  buildFullDatabaseArchive,
  fullDatabaseArchiveData,
} from "../../src/utils/connection/fullDatabaseArchive";
import { reconcileRecordLedger } from "../../src/utils/storage/recordLedger";
import { collection, fullData, trust } from "../fixtures/fullDatabaseArchive";

const config: CloudSyncConfig = {
  ...defaultCloudSyncConfig,
  enabled: true,
  selectedItems: ["database:source-db"],
  encryptBeforeSync: true,
  syncEncryptionPassword: "fixture-sync-password",
  compressionEnabled: false,
  conflictResolution: "smartMerge",
};
const target: CloudSyncTarget = {
  id: "smart-fixture",
  label: "Fixture",
  provider: "nextcloud",
  enabled: true,
};
const wrap = (section: unknown): CloudSyncPayload => ({
  version: 1,
  sections: { "database:source-db": section },
});
let local: CloudSyncPayload;
let remote: string | null;
let revision: number;
async function publishRemote(payload: CloudSyncPayload) {
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

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  mocks.store.clear();
  mocks.capture
    .mockReset()
    .mockImplementation(async () => structuredClone(local));
  mocks.apply
    .mockReset()
    .mockImplementation(async (payload, _config, expected) => {
      expect(local).toEqual(expected);
      local = await upgradeCloudSyncPayload(payload);
    });
  remote = null;
  revision = 0;
  mocks.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "cloud_sync_read")
      return { data: remote, revision: remote ? String(revision) : null };
    expect(command).toBe("cloud_sync_write");
    expect(args.expectedRevision).toBe(remote ? String(revision) : null);
    remote = args.data;
    return { revision: String(++revision) };
  });
});
afterEach(() => vi.unstubAllGlobals());

it.each(["automatic", "reviewed"] as const)(
  "%s smart sync round-trips independently edited real archives and audit histories without repeat writes",
  async (mode) => {
    const base = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      trust,
    );
    local = await upgradeCloudSyncPayload(wrap(base));
    await runCloudSync(target, config);
    const normalized = local.sections["database:source-db"] as typeof base;
    const ours = structuredClone(normalized),
      theirs = structuredClone(normalized);
    ours.connections[2].name = "Local change";
    theirs.connections[1].name = "Cloud change";
    for (const section of [ours, theirs])
      section.recordMetadata = await reconcileRecordLedger(
        fullDatabaseArchiveData(section),
        section.recordMetadata,
        { mode: "write", now: "2026-10-02T10:00:00.000Z" },
      );
    local = wrap(ours);
    await publishRemote(wrap(theirs));
    mocks.invoke.mockClear();
    if (mode === "reviewed") {
      const review = await reviewCloudSync(target, config);
      expect(review.items).toMatchObject([
        { label: "Full source", state: "conflict", smartMergeAvailable: true },
      ]);
      expect(JSON.stringify(review)).not.toMatch(
        /PRIVATE_|Local change|Cloud change/,
      );
      expect(mocks.apply).not.toHaveBeenCalled();
      expect(
        mocks.invoke.mock.calls.every(
          ([command]) => command === "cloud_sync_read",
        ),
      ).toBe(true);
      await runCloudSync(target, config, {
        review,
        choices: { "database:source-db": "smartMerge" },
      });
    } else await runCloudSync(target, config);
    const merged = local.sections["database:source-db"] as typeof base;
    expect(merged.connections[1].name).toBe("Cloud change");
    expect(merged.connections[2].name).toBe("Local change");
    for (const source of [ours, theirs])
      expect(merged.recordMetadata!.journal).toEqual(
        expect.arrayContaining(source.recordMetadata!.journal),
      );
    expect((await decodeCloudSnapshot(remote!, config)).payload).toEqual(local);
    expect(await upgradeCloudSyncPayload(local)).toEqual(local);
    expect(mocks.apply).toHaveBeenCalledTimes(1);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "cloud_sync_write",
      ),
    ).toHaveLength(1);
    expect(JSON.stringify([...mocks.store.values()])).not.toMatch(
      /PRIVATE_|Local change|Cloud change/,
    );
    const checkpoint = structuredClone([...mocks.store.values()]);
    mocks.invoke.mockClear();
    mocks.apply.mockClear();
    await expect(runCloudSync(target, config)).resolves.toContain(
      "already up to date",
    );
    expect([...mocks.store.values()]).toEqual(checkpoint);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "cloud_sync_read",
    ]);
  },
);
