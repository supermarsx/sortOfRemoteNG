import { webcrypto } from "node:crypto";
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
vi.mock("../../src/utils/services/cloudSyncPayload", () => ({
  captureCloudSyncPayload: mocks.capture,
  applyCloudSyncPayload: mocks.apply,
  validateCloudSyncPayload: (value: unknown) => value,
  upgradeCloudSyncPayload: async (value: unknown) => value,
  discoverCloudSyncItems: async () => [],
}));
import {
  runCloudSync,
  reviewCloudSync,
} from "../../src/utils/services/cloudSyncEngine";
import {
  encodeCloudSnapshot,
  syncHash,
} from "../../src/utils/services/cloudSyncCodec";
import { buildSmartSyncBaseline } from "../../src/utils/services/cloudSyncSmartMerge";
import * as smartMerge from "../../src/utils/services/cloudSyncSmartMerge";

const A = "app:settings",
  B = "app:recording.terminal-macros";
const target: CloudSyncTarget = {
  id: "selection-checkpoint",
  label: "Fixture",
  provider: "nextcloud",
  enabled: true,
};
const config: CloudSyncConfig = {
  ...defaultCloudSyncConfig,
  selectedItems: [A],
  encryptBeforeSync: false,
  compressionEnabled: false,
  conflictResolution: "smartMerge",
};
let local: CloudSyncPayload;
let remote: string | null;
let revision: number;
async function publish(payload: CloudSyncPayload) {
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
  local = {
    version: 1,
    sections: {
      [A]: { theme: "dark", language: "en" },
      [B]: { version: 1, macros: [], legacyDigest: null },
    },
  };
  remote = null;
  revision = 0;
  mocks.capture
    .mockReset()
    .mockImplementation(async (settings: CloudSyncConfig) => ({
      version: 1,
      sections: Object.fromEntries(
        settings.selectedItems!.map((id) => [
          id,
          structuredClone(local.sections[id]),
        ]),
      ),
    }));
  mocks.apply
    .mockReset()
    .mockImplementation(async (payload: CloudSyncPayload) => {
      Object.assign(local.sections, structuredClone(payload.sections));
    });
  mocks.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "cloud_sync_read")
      return { data: remote, revision: remote ? String(revision) : null };
    expect(command).toBe("cloud_sync_write");
    expect(args.expectedRevision).toBe(remote ? String(revision) : null);
    remote = args.data;
    return { revision: String(++revision) };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("clears a selected stale smart index if its new baseline has no index, retaining unselected indexes", async () => {
  await runCloudSync(target, { ...config, selectedItems: [A, B] });
  const before = structuredClone([...mocks.store.values()][0]) as {
    baseline: Record<string, string>;
    smartBaseline: Record<string, unknown>;
  };
  local.sections[A] = { theme: "light", language: "en" };
  // Optional index production must never leave the previous content's index.
  vi.spyOn(smartMerge, "buildSmartSyncBaseline").mockResolvedValueOnce(
    undefined as never,
  );
  await runCloudSync(target, config);
  const after = [...mocks.store.values()][0] as typeof before;
  expect(after.baseline[A]).not.toBe(before.baseline[A]);
  expect(after.smartBaseline).not.toHaveProperty(A);
  expect(after.smartBaseline[B]).toEqual(before.smartBaseline[B]);
  expect(after.baseline[B]).toBe(before.baseline[B]);
});

it("retains per-item baselines when selection expands, shrinks and re-adds an item", async () => {
  await runCloudSync(target, config);
  const expanded = { ...config, selectedItems: [A, B] };
  local.sections[A] = { theme: "light", language: "en" };
  await publish({
    version: 1,
    sections: { [A]: { theme: "dark", language: "fr" } },
  });
  const review = await reviewCloudSync(target, expanded);
  expect(review.items.find((row) => row.id === A)).toMatchObject({
    smartMergeAvailable: true,
    details: { hasBaseline: true },
  });
  await runCloudSync(target, expanded);
  expect(local.sections[A]).toEqual({ theme: "light", language: "fr" });
  await runCloudSync(target, { ...config, selectedItems: [B] });
  local.sections[A] = { theme: "dark", language: "fr" };
  await publish({
    version: 1,
    sections: { ...local.sections, [A]: { theme: "light", language: "pt" } },
  });
  await runCloudSync(target, expanded);
  expect(local.sections[A]).toEqual({ theme: "dark", language: "pt" });
  expect(mocks.store.size).toBe(1);
  const checkpoint = structuredClone([...mocks.store.values()]);
  const before = revision;
  await runCloudSync(target, expanded);
  expect(revision).toBe(before);
  expect([...mocks.store.values()]).toEqual(checkpoint);
});

async function seedLegacy(
  settings: CloudSyncConfig,
  sections: Record<string, unknown>,
) {
  const key = `sorng-cloud-checkpoint-${await syncHash({ id: target.id, provider: target.provider, destination: {}, items: [...settings.selectedItems!].sort() })}`;
  const checkpoint = {
    version: 1,
    baseline: Object.fromEntries(
      await Promise.all(
        Object.entries(sections).map(async ([id, value]) => [
          id,
          await syncHash(value),
        ]),
      ),
    ),
    smartBaseline: Object.fromEntries(
      await Promise.all(
        Object.entries(sections).map(async ([id, value]) => [
          id,
          await buildSmartSyncBaseline(value),
        ]),
      ),
    ),
    observedHash: await syncHash({ version: 1, sections }),
    localChangedAt: 1,
  };
  mocks.store.set(key, structuredClone(checkpoint));
  return { key, checkpoint };
}

it("reads the exact old selection checkpoint without writing during review, then migrates it on sync", async () => {
  const legacy = await seedLegacy(config, { [A]: local.sections[A] });
  local.sections[A] = { theme: "light", language: "en" };
  await publish({
    version: 1,
    sections: { [A]: { theme: "dark", language: "fr" } },
  });
  const review = await reviewCloudSync(target, config);
  expect(review.items[0]).toMatchObject({
    smartMergeAvailable: true,
    details: { hasBaseline: true },
  });
  expect(mocks.store.size).toBe(1);
  expect(mocks.store.get(legacy.key)).toEqual(legacy.checkpoint);
  await runCloudSync(target, config, {
    review,
    choices: { [A]: "smartMerge" },
  });
  expect(local.sections[A]).toEqual({ theme: "light", language: "fr" });
  expect(mocks.store.size).toBe(2);
  expect(mocks.store.get(legacy.key)).toEqual(legacy.checkpoint);
  expect(
    [...mocks.store.keys()].some((key) =>
      key.startsWith("sorng-cloud-checkpoint-v2-"),
    ),
  ).toBe(true);
});

it("imports only missing legacy items and never replaces the newer destination baseline", async () => {
  await runCloudSync(target, config);
  const expanded = { ...config, selectedItems: [A, B] };
  await seedLegacy(expanded, {
    [A]: { theme: "obsolete", language: "old" },
    [B]: local.sections[B],
  });
  local.sections[A] = { theme: "light", language: "en" };
  await publish({
    version: 1,
    sections: {
      [A]: { theme: "dark", language: "fr" },
      [B]: local.sections[B],
    },
  });
  const review = await reviewCloudSync(target, expanded);
  expect(review.items.find((row) => row.id === A)?.smartMergeAvailable).toBe(
    true,
  );
  expect(review.items.find((row) => row.id === B)?.details?.hasBaseline).toBe(
    true,
  );
  await runCloudSync(target, expanded);
  expect(local.sections[A]).toEqual({ theme: "light", language: "fr" });
});

it("does not reuse checkpoints for another destination, even with identical target ID and data", async () => {
  await runCloudSync(target, config);
  local.sections[A] = { theme: "light", language: "en" };
  await publish({
    version: 1,
    sections: { [A]: { theme: "dark", language: "fr" } },
  });
  const moved = {
    ...target,
    nextcloud: {
      serverUrl: "https://different.invalid",
      username: "fixture",
      password: "fixture",
      useAppPassword: true,
      folderPath: "/fixture",
    },
  };
  const review = await reviewCloudSync(moved, config);
  expect(review.items[0]).toMatchObject({
    smartMergeAvailable: false,
    conflicts: [{ code: "missing-baseline", kind: "other", count: 1 }],
  });
  await expect(runCloudSync(moved, config)).rejects.toThrow(/baseline/);
  expect(mocks.apply).not.toHaveBeenCalled();
});

it("invalidates a reviewed receipt when selection changes even if captured content is identical", async () => {
  await runCloudSync(target, config);
  const review = await reviewCloudSync(target, config);
  mocks.capture.mockResolvedValue({
    version: 1,
    sections: { [A]: local.sections[A] },
  });
  const before = revision;
  await expect(
    runCloudSync(
      target,
      { ...config, selectedItems: [A, B] },
      { review, choices: {} },
    ),
  ).rejects.toThrow(/Refresh the conflict review/);
  expect(revision).toBe(before);
});
