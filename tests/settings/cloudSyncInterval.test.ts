import { afterEach, describe, expect, it } from "vitest";
import {
  CloudSyncFrequencies,
  defaultCloudSyncConfig,
  migrateCloudSyncConfig,
} from "../../src/types/settings/cloudSyncSettings";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";

afterEach(() => {
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
});

describe("custom cloud sync interval normalization", () => {
  it.each([
    [undefined, 15],
    [null, 15],
    ["30", 15],
    [NaN, 15],
    [Infinity, 15],
    [-Infinity, 15],
    [0, 1],
    [-5, 1],
    [1, 1],
    [1.7, 2],
    [90, 90],
    [10_080, 10_080],
    [100_000, 10_080],
  ])("normalizes stored %s to %s whole minutes", (input, expected) => {
    const config = {
      ...defaultCloudSyncConfig,
      frequency: "custom" as const,
      customIntervalMinutes: input as number,
      syncTargets: [
        {
          id: "existing",
          label: "Existing",
          provider: "webdav" as const,
          enabled: true,
        },
      ],
    };
    const migrated = migrateCloudSyncConfig(config);
    expect(migrated.frequency).toBe("custom");
    expect(migrated.customIntervalMinutes).toBe(expected);
    expect(migrated.syncTargets).toBe(config.syncTargets);
    expect(config.customIntervalMinutes).toBe(input);
    expect(migrateCloudSyncConfig(migrated)).toEqual(migrated);
  });

  it.each(CloudSyncFrequencies)(
    "preserves the saved %s frequency",
    (frequency) => {
      expect(
        migrateCloudSyncConfig({ ...defaultCloudSyncConfig, frequency })
          .frequency,
      ).toBe(frequency);
    },
  );

  it("round-trips a custom interval through existing settings persistence", async () => {
    SettingsManager.resetInstance();
    _resetInMemorySettingsStore();
    const manager = SettingsManager.getInstance();
    const settings = await manager.loadSettings();
    await manager.saveSettings({
      cloudSync: {
        ...settings.cloudSync,
        frequency: "custom",
        customIntervalMinutes: 180,
        failureNotificationIntervalMinutes: 45,
      },
    });
    SettingsManager.resetInstance();
    const reloaded = await SettingsManager.getInstance().loadSettings();
    expect(reloaded.cloudSync).toMatchObject({
      frequency: "custom",
      customIntervalMinutes: 180,
      failureNotificationIntervalMinutes: 45,
    });
  });
});
