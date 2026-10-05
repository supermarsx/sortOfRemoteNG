import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  defaultCloudSyncConfig,
  type CloudSyncConfig,
} from "../../src/types/settings/cloudSyncSettings";

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({ getSettings: () => ({ theme: "dark" }) }),
  },
}));
vi.mock("../../src/utils/storage/appDataJsonStore", () => ({
  APP_DATA_STORE_CHANGED_EVENT: "sorng-app-data-store-changed",
}));
import {
  DATABASE_SYNC_CHANGED_EVENT,
  useCloudSyncScheduler,
} from "../../src/hooks/sync/useCloudSyncScheduler";
import { beginCloudSyncActivity } from "../../src/utils/services/cloudSyncActivity";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const config: CloudSyncConfig = {
  ...defaultCloudSyncConfig,
  enabled: true,
  frequency: "realtime",
  selectedItems: ["app:recording.terminal-macros"],
};
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const stored = (key = "recording.terminal-macros") =>
  act(() => {
    window.dispatchEvent(
      new CustomEvent("sorng-app-data-store-changed", { detail: { key } }),
    );
  });
const preferences = (detail: Record<string, unknown>) =>
  act(() => {
    window.dispatchEvent(new CustomEvent("settings-updated", { detail }));
  });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("uses the short trailing delay for isolated edits and small rapid bursts by default", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  renderHook(() => useCloudSyncScheduler(config, true, run));
  for (let i = 0; i < 3; i++) {
    stored();
    await advance(200);
  }
  await advance(2799);
  expect(run).not.toHaveBeenCalled();
  await advance(1);
  expect(run).toHaveBeenCalledOnce();
  await advance(600_000);
  expect(run).toHaveBeenCalledOnce();
});

it("waits for 90 seconds of inactivity after three minutes of sustained relevant writes", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  renderHook(() => useCloudSyncScheduler(config, true, run));
  for (let i = 0; i < 180; i++) {
    stored();
    await advance(1000);
    expect(run).not.toHaveBeenCalled();
  }
  await advance(88_999);
  expect(run).not.toHaveBeenCalled();
  await advance(1);
  expect(run).toHaveBeenCalledOnce();
  await advance(600_000);
  expect(run).toHaveBeenCalledOnce();
});

it("bounds uninterrupted adaptive activity at ten minutes instead of fifteen seconds", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  renderHook(() => useCloudSyncScheduler(config, true, run));
  for (let i = 0; i < 600; i++) {
    stored();
    expect(run).not.toHaveBeenCalled();
    await advance(1000);
  }
  expect(run).toHaveBeenCalledOnce();
});

it("expires stale rolling activity so a later isolated edit is responsive again", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  renderHook(() => useCloudSyncScheduler(config, true, run));
  for (let i = 0; i < 5; i++) {
    stored();
    await advance(1000);
  }
  await advance(179_000); // Exactly three minutes after the last write.
  expect(run).toHaveBeenCalledOnce();
  stored();
  await advance(2999);
  expect(run).toHaveBeenCalledOnce();
  await advance(1);
  expect(run).toHaveBeenCalledTimes(2);
});

it("counts writes across completed runs within the rolling window", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  renderHook(() => useCloudSyncScheduler(config, true, run));
  for (let i = 0; i < 4; i++) {
    stored();
    await advance(30_000);
    expect(run).toHaveBeenCalledTimes(i + 1);
  }
  stored(); // Fifth relevant write within three minutes enters busy mode.
  await advance(89_999);
  expect(run).toHaveBeenCalledTimes(4);
  await advance(1);
  expect(run).toHaveBeenCalledTimes(5);
});

it("retains an already queued edit when switching between change-driven frequencies", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const { rerender } = renderHook(
    (value: CloudSyncConfig) => useCloudSyncScheduler(value, true, run),
    { initialProps: config },
  );
  stored();
  await advance(200);
  rerender({ ...config, frequency: "onSave" });
  await advance(299);
  expect(run).not.toHaveBeenCalled();
  await advance(1);
  expect(run).toHaveBeenCalledOnce();
});

it("uses the configured busy quiet period and rearms pending work when adaptive is disabled", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const { rerender } = renderHook(
    (value: CloudSyncConfig) => useCloudSyncScheduler(value, true, run),
    {
      initialProps: {
        ...config,
        adaptiveSyncQuietSeconds: 60,
      } as CloudSyncConfig,
    },
  );
  for (let i = 0; i < 5; i++) stored();
  await advance(59_999);
  expect(run).not.toHaveBeenCalled();
  await advance(1);
  expect(run).toHaveBeenCalledOnce();
  stored();
  await advance(10_000);
  rerender({ ...config, adaptiveSyncEnabled: false });
  await advance(0);
  expect(run).toHaveBeenCalledTimes(2);
});

it("applies a new maximum to the original batch deadline without losing or restarting it", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const initial = { ...config, realtimeDebounceSeconds: 10 };
  const { rerender } = renderHook(
    (value: CloudSyncConfig) => useCloudSyncScheduler(value, true, run),
    { initialProps: initial },
  );
  stored();
  await advance(2000);
  rerender({
    ...initial,
    realtimeDebounceSeconds: 30,
    debounceMaxWaitSeconds: 6,
  });
  await advance(3999);
  expect(run).not.toHaveBeenCalled();
  await advance(1);
  expect(run).toHaveBeenCalledOnce();
});

it("retains a single adaptive follow-up through a slow sync and a timing edit", async () => {
  const first = deferred();
  const run = vi
    .fn()
    .mockResolvedValue(undefined)
    .mockReturnValueOnce(first.promise);
  const { rerender } = renderHook(
    (value: CloudSyncConfig) => useCloudSyncScheduler(value, true, run),
    { initialProps: config },
  );
  stored();
  await advance(3000);
  expect(run).toHaveBeenCalledOnce();
  for (let i = 0; i < 180; i++) {
    stored();
    await advance(1000);
  }
  rerender({ ...config, debounceMinIntervalSeconds: 20 });
  await advance(100_000);
  expect(run).toHaveBeenCalledOnce();
  await act(async () => first.resolve());
  await advance(19_999);
  expect(run).toHaveBeenCalledOnce();
  await advance(1);
  expect(run).toHaveBeenCalledTimes(2);
  await advance(600_000);
  expect(run).toHaveBeenCalledTimes(2);
});

it("waits for all manual activity and the minimum pause even after maximum wait expires", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  renderHook(() =>
    useCloudSyncScheduler(
      { ...config, debounceMaxWaitSeconds: 5, debounceMinIntervalSeconds: 10 },
      true,
      run,
    ),
  );
  const first = beginCloudSyncActivity({ id: "one", provider: "webdav" });
  const second = beginCloudSyncActivity({ id: "two", provider: "webdav" });
  try {
    for (let i = 0; i < 10; i++) {
      stored();
      await advance(1000);
    }
    act(first);
    await advance(30_000);
    expect(run).not.toHaveBeenCalled();
    act(second);
    await advance(9999);
    expect(run).not.toHaveBeenCalled();
    await advance(1);
    expect(run).toHaveBeenCalledOnce();
  } finally {
    first();
    second();
  }
});

it("defers enabled startup until manual activity ends instead of losing the startup request", async () => {
  const finish = beginCloudSyncActivity({ id: "manual", provider: "webdav" });
  const run = vi.fn().mockResolvedValue(undefined);
  try {
    renderHook(() =>
      useCloudSyncScheduler({ ...config, syncOnStartup: true }, true, run),
    );
    await advance(5000);
    expect(run).not.toHaveBeenCalled();
    act(finish);
    await advance(3000);
    expect(run).toHaveBeenCalledOnce();
  } finally {
    finish();
  }
});

it("keeps on-save's half-second trailing debounce even when adaptive smart sync is on", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  renderHook(() =>
    useCloudSyncScheduler({ ...config, frequency: "onSave" }, true, run),
  );
  for (let i = 0; i < 10; i++) stored();
  await advance(499);
  expect(run).not.toHaveBeenCalled();
  await advance(1);
  expect(run).toHaveBeenCalledOnce();
});

it("ignores unselected and unidentified app writes, database-only events and unselected preferences", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  renderHook(() => useCloudSyncScheduler(config, true, run));
  for (let i = 0; i < 10; i++) {
    stored("recording.managed-scripts");
    preferences({ theme: i % 2 ? "light" : "dark" });
    act(() => {
      window.dispatchEvent(new Event(DATABASE_SYNC_CHANGED_EVENT));
      window.dispatchEvent(new Event("sorng-app-data-store-changed"));
    });
  }
  await advance(600_000);
  expect(run).not.toHaveBeenCalled();
  stored();
  await advance(3000);
  expect(run).toHaveBeenCalledOnce();
});

it("filters database IDs before arming debounce or counting adaptive activity, with a legacy fallback", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  renderHook(() =>
    useCloudSyncScheduler(
      { ...config, selectedItems: ["database:chosen"] },
      true,
      run,
    ),
  );
  const saveDatabase = (databaseId: string) =>
    act(() => {
      window.dispatchEvent(
        new CustomEvent(DATABASE_SYNC_CHANGED_EVENT, {
          detail: { databaseId },
        }),
      );
    });
  for (let i = 0; i < 10; i++) saveDatabase("unselected");
  await advance(10_000);
  expect(run).not.toHaveBeenCalled();
  saveDatabase("chosen");
  for (let i = 0; i < 5; i++) {
    await advance(400);
    saveDatabase("unselected");
  }
  await advance(999);
  expect(run).not.toHaveBeenCalled();
  await advance(1);
  expect(run).toHaveBeenCalledOnce();
  act(() => {
    window.dispatchEvent(new Event(DATABASE_SYNC_CHANGED_EVENT));
  });
  await advance(3000);
  expect(run).toHaveBeenCalledTimes(2);
});

it("ignores status and device-only settings without extending genuine preference changes or looping", async () => {
  let theme = "dark";
  const run = vi.fn(async () => {
    window.dispatchEvent(
      new CustomEvent("settings-updated", {
        detail: {
          theme,
          cloudSync: { lastSyncTime: Date.now(), lastSyncStatus: "success" },
        },
      }),
    );
  });
  renderHook(() =>
    useCloudSyncScheduler(
      { ...config, selectedItems: ["app:settings"] },
      true,
      run,
    ),
  );
  preferences({
    theme: "dark",
    language: undefined,
    cloudSync: { lastSyncTime: 1 },
    logging: { enabled: true },
  });
  theme = "light";
  preferences({ theme });
  for (let i = 0; i < 5; i++) {
    await advance(400);
    preferences({
      theme,
      cloudSync: { lastSyncTime: i },
      logging: { enabled: false },
    });
  }
  await advance(1000);
  expect(run).toHaveBeenCalledOnce();
  await advance(600_000);
  expect(run).toHaveBeenCalledOnce();
});

it("never revives an adaptive batch after unmount during a run", async () => {
  const first = deferred();
  const run = vi.fn().mockReturnValue(first.promise);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler(config, true, run),
  );
  stored();
  await advance(3000);
  for (let i = 0; i < 10; i++) stored();
  unmount();
  await act(async () => first.resolve());
  await advance(600_000);
  expect(run).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
