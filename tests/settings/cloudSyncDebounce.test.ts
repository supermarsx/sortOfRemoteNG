import { afterEach, describe, expect, it } from "vitest";
import {
  CloudSyncFrequencies,
  defaultCloudSyncConfig,
  migrateCloudSyncConfig,
  resolveCloudSyncDebounce,
} from "../../src/types/settings/cloudSyncSettings";
import {
  SettingsManager,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";

afterEach(() => {
  SettingsManager.resetInstance();
  _resetInMemorySettingsStore();
});

describe("adaptive smart sync settings", () => {
  it.each(CloudSyncFrequencies)(
    "defaults adaptive on without changing saved %s frequency or enabling cloud sync",
    (frequency) => {
      const migrated = migrateCloudSyncConfig({
        ...defaultCloudSyncConfig,
        frequency,
        adaptiveSyncEnabled: undefined,
        realtimeDebounceSeconds: undefined,
        onSaveDebounceSeconds: undefined,
        adaptiveSyncQuietSeconds: undefined,
      });
      expect(migrated).toMatchObject({
        enabled: false,
        frequency,
        adaptiveSyncEnabled: true,
        realtimeDebounceSeconds: 3,
        onSaveDebounceSeconds: 0.5,
        adaptiveSyncQuietSeconds: 90,
      });
      expect(resolveCloudSyncDebounce(migrated).adaptive).toBe(
        frequency === "realtime",
      );
    },
  );

  it("retains an explicit opt-out and mode-dependent on-save defaults after migration", () => {
    const migrated = migrateCloudSyncConfig({
      ...defaultCloudSyncConfig,
      frequency: "realtime",
      adaptiveSyncEnabled: false,
    });
    expect(resolveCloudSyncDebounce(migrated)).toEqual({
      adaptive: false,
      quietMs: 3000,
      busyQuietMs: 90_000,
      maxWaitMs: 600_000,
      minIntervalMs: 3000,
    });
    expect(
      resolveCloudSyncDebounce({ ...migrated, frequency: "onSave" }),
    ).toEqual({
      adaptive: false,
      quietMs: 500,
      busyQuietMs: 90_000,
      maxWaitMs: 15_000,
      minIntervalMs: 500,
    });
  });

  it.each([
    [undefined, 3, 0.5, 90, undefined, undefined],
    [NaN, 3, 0.5, 90, undefined, undefined],
    [Infinity, 3, 0.5, 90, undefined, undefined],
    ["5", 3, 0.5, 90, undefined, undefined],
    [null, 3, 0.5, 90, undefined, undefined],
    [-1, 0.1, 0.1, 60, 1, 0],
    [0, 0.1, 0.1, 60, 1, 0],
    [1.23456, 1.235, 1.235, 60, 1.235, 1.235],
    [100, 100, 100, 100, 100, 100],
    [Number.MAX_SAFE_INTEGER, 120, 120, 120, 3600, 120],
  ])(
    "normalizes persisted numeric input %s consistently in migration and at runtime",
    (input, realtime, onSave, busy, maxWait, minInterval) => {
      const original = {
        ...defaultCloudSyncConfig,
        frequency: "realtime" as const,
        realtimeDebounceSeconds: input as number,
        onSaveDebounceSeconds: input as number,
        adaptiveSyncQuietSeconds: input as number,
        debounceMaxWaitSeconds: input as number,
        debounceMinIntervalSeconds: input as number,
        notifyOnSyncSuccess: true,
        syncTargets: [
          {
            id: "kept",
            label: "Kept",
            provider: "webdav" as const,
            enabled: true,
          },
        ],
      };
      const migrated = migrateCloudSyncConfig(original);
      expect(migrated).toMatchObject({
        realtimeDebounceSeconds: realtime,
        onSaveDebounceSeconds: onSave,
        adaptiveSyncQuietSeconds: busy,
        debounceMaxWaitSeconds: maxWait,
        debounceMinIntervalSeconds: minInterval,
        notifyOnSyncSuccess: true,
      });
      expect(original.realtimeDebounceSeconds).toBe(input);
      expect(migrated.syncTargets).toBe(original.syncTargets);
      expect(resolveCloudSyncDebounce(original)).toEqual(
        resolveCloudSyncDebounce(migrated),
      );
      expect(migrateCloudSyncConfig(migrated)).toBe(migrated);
    },
  );

  it("round-trips all debounce controls through settings persistence", async () => {
    SettingsManager.resetInstance();
    _resetInMemorySettingsStore();
    const manager = SettingsManager.getInstance();
    const initial = await manager.loadSettings();
    const changed = {
      adaptiveSyncEnabled: false,
      realtimeDebounceSeconds: 5,
      onSaveDebounceSeconds: 1.5,
      adaptiveSyncQuietSeconds: 120,
      debounceMaxWaitSeconds: 480,
      debounceMinIntervalSeconds: 8,
    };
    await manager.saveSettings({
      cloudSync: { ...initial.cloudSync, ...changed },
    });
    SettingsManager.resetInstance();
    const reloaded = await SettingsManager.getInstance().loadSettings();
    expect(reloaded.cloudSync).toMatchObject(changed);
  });
});
