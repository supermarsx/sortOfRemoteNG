import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";

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
  discoverCloudSyncItems: async () => [
    { id: "app:settings", label: "Appearance preferences" },
  ],
}));
import {
  reviewCloudSync,
  runCloudSync,
} from "../../src/utils/services/cloudSyncEngine";
import { encodeCloudSnapshot } from "../../src/utils/services/cloudSyncCodec";

const config = {
  ...defaultCloudSyncConfig,
  enabled: true,
  selectedItems: ["app:settings"],
  encryptBeforeSync: false,
  compressionEnabled: false,
};
const target = {
  id: "matching-review",
  label: "Work",
  enabled: true,
  provider: "nextcloud" as const,
};
const payload = (theme = "dark") => ({
  version: 1 as const,
  sections: { "app:settings": { theme } },
});
const snapshot = async (theme = "dark") =>
  encodeCloudSnapshot(
    {
      format: "sortofremoteng-cloud-sync",
      version: 1,
      modifiedAt: 1000,
      payload: payload(theme),
    },
    config,
  );

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  mocks.store.clear();
  mocks.invoke.mockReset();
  mocks.capture.mockReset().mockResolvedValue(payload());
  mocks.apply.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("matching-copy review completion", () => {
  it("verifies the real engine receipt without uploading or applying data, then records a hash-only checkpoint", async () => {
    mocks.invoke.mockResolvedValue({
      data: await snapshot(),
      revision: "same-v1",
    });
    const review = await reviewCloudSync(target, config);
    expect(review.items).toHaveLength(1);
    expect(review.items[0].state).toBe("same");
    expect(mocks.store.size).toBe(0);
    await expect(
      runCloudSync(target, config, { review, choices: {} }),
    ).resolves.toMatch(/already up to date/);
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "cloud_sync_read",
      "cloud_sync_read",
    ]);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.store.size).toBe(1);
    expect(JSON.stringify([...mocks.store.values()])).not.toMatch(/theme|dark/);
  });

  it.each(["local", "remote", "both"])(
    "does not apply %s edits arriving after an all-identical review",
    async (side) => {
      const settings = { ...config, conflictResolution: "keepRemote" as const };
      mocks.invoke.mockResolvedValue({
        data: await snapshot(),
        revision: "same-v1",
      });
      const review = await reviewCloudSync(target, settings);
      if (side !== "remote") mocks.capture.mockResolvedValue(payload("newer"));
      if (side !== "local")
        mocks.invoke.mockResolvedValue({
          data: await snapshot("newer"),
          revision: "new-v2",
        });
      await expect(
        runCloudSync(target, settings, { review, choices: {} }),
      ).rejects.toThrow(/Refresh the conflict review/);
      expect(
        mocks.invoke.mock.calls.every(
          ([command]) => command === "cloud_sync_read",
        ),
      ).toBe(true);
      expect(mocks.apply).not.toHaveBeenCalled();
    },
  );
});
