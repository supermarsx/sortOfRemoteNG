import { describe, expect, it, vi } from "vitest";
import {
  CLOUD_SYNC_FAILURE_TOAST_TIME_KEY,
  createCloudSyncFailureToastLimiter,
} from "../../src/utils/services/cloudSyncNotifications";
import {
  defaultCloudSyncConfig,
  migrateCloudSyncConfig,
} from "../../src/types/settings/cloudSyncSettings";

function fixture() {
  let time = 1_000_000;
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  return {
    storage,
    values,
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("sync failure toast cooldown", () => {
  it("defaults success notifications off without disabling failure or conflict alerts", () => {
    expect(defaultCloudSyncConfig.notifyOnSyncSuccess).toBe(false);
    expect(defaultCloudSyncConfig.notifyOnSync).toBe(true);
    expect(defaultCloudSyncConfig.notifyOnConflict).toBe(true);
  });

  it.each([undefined, false, true])(
    "migrates success notification preference %s idempotently",
    (value) => {
      const input = { ...defaultCloudSyncConfig, notifyOnSyncSuccess: value };
      const migrated = migrateCloudSyncConfig(input);
      expect(migrated.notifyOnSyncSuccess).toBe(value === true);
      expect(migrated.notifyOnSync).toBe(input.notifyOnSync);
      expect(migrated.notifyOnConflict).toBe(input.notifyOnConflict);
      expect(migrateCloudSyncConfig(migrated)).toEqual(migrated);
    },
  );

  it("shows the first failure then only one per 30 minutes, not 30 minutes after the last failure", () => {
    const f = fixture();
    const claim = createCloudSyncFailureToastLimiter(() => f.storage, f.now);
    expect(claim()).toBe(true);
    expect(claim()).toBe(false);
    f.advance(29 * 60_000);
    expect(claim()).toBe(false);
    f.advance(60_000);
    expect(claim()).toBe(true);
    expect(claim()).toBe(false);
    expect([...f.values.keys()]).toEqual([CLOUD_SYNC_FAILURE_TOAST_TIME_KEY]);
    expect(f.values.get(CLOUD_SYNC_FAILURE_TOAST_TIME_KEY)).toBe(
      String(f.now()),
    );
  });

  it("retains the deadline across reloads and independent callers", () => {
    const f = fixture();
    expect(createCloudSyncFailureToastLimiter(() => f.storage, f.now)()).toBe(
      true,
    );
    const afterReload = createCloudSyncFailureToastLimiter(
      () => f.storage,
      f.now,
    );
    expect(afterReload()).toBe(false);
    f.advance(30 * 60_000);
    expect(afterReload()).toBe(true);
  });

  it("applies edited intervals immediately and supports every-failure mode", () => {
    const f = fixture();
    const claim = createCloudSyncFailureToastLimiter(() => f.storage, f.now);
    expect(claim(60)).toBe(true);
    f.advance(5 * 60_000);
    expect(claim(60)).toBe(false);
    expect(claim(5)).toBe(true);
    expect(claim(0)).toBe(true);
    expect(claim(0)).toBe(true);
  });

  it("keeps limiting in memory if storage throws", () => {
    const f = fixture();
    const claim = createCloudSyncFailureToastLimiter(() => {
      throw new Error("unavailable");
    }, f.now);
    expect(claim()).toBe(true);
    expect(claim()).toBe(false);
    f.advance(30 * 60_000);
    expect(claim()).toBe(true);
  });

  it("does not silence notifications after a backwards clock change or malformed timestamp", () => {
    const f = fixture();
    f.values.set(CLOUD_SYNC_FAILURE_TOAST_TIME_KEY, "garbage");
    const claim = createCloudSyncFailureToastLimiter(() => f.storage, f.now);
    expect(claim()).toBe(true);
    f.advance(-1000);
    expect(claim()).toBe(true);
    expect(claim()).toBe(false);
  });

  it.each([
    [undefined, 30],
    [NaN, 30],
    [-1, 0],
    [0, 0],
    [1.6, 2],
    [60, 60],
    [Infinity, 30],
    [100_000, 10080],
  ])(
    "migrates interval %s to %s without changing other settings",
    (value, expected) => {
      const input = {
        ...defaultCloudSyncConfig,
        failureNotificationIntervalMinutes: value,
      };
      const migrated = migrateCloudSyncConfig(input);
      expect(migrated.failureNotificationIntervalMinutes).toBe(expected);
      expect(migrated.notifyOnConflict).toBe(input.notifyOnConflict);
      expect(migrateCloudSyncConfig(migrated)).toEqual(migrated);
    },
  );

  it("does not read storage until invoked", () => {
    const storage = vi.fn(() => undefined);
    createCloudSyncFailureToastLimiter(storage);
    expect(storage).not.toHaveBeenCalled();
  });
});
