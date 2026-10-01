import { act, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
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
afterEach(() => vi.useRealTimers());
const settings = {
  ...defaultCloudSyncConfig,
  enabled: true,
  selectedItems: ["app:settings"],
};

it("runs startup once only after ready and when explicitly enabled", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const { rerender, unmount } = renderHook(
    ({ ready }) =>
      useCloudSyncScheduler({ ...settings, syncOnStartup: true }, ready, run),
    { initialProps: { ready: false } },
  );
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(run).not.toHaveBeenCalled();
  rerender({ ready: true });
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(run).toHaveBeenCalledTimes(1);
  rerender({ ready: true });
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(run).toHaveBeenCalledTimes(1);
  unmount();
});

it("debounces actual durable-save events for onSave", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler({ ...settings, frequency: "onSave" }, true, run),
  );
  act(() => {
    window.dispatchEvent(new Event(DATABASE_SYNC_CHANGED_EVENT));
    window.dispatchEvent(new Event("sorng-app-data-store-changed"));
  });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(run).toHaveBeenCalledTimes(1);
  unmount();
});

it("ignores sync status-only settings broadcasts but responds to a real edit", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler({ ...settings, frequency: "onSave" }, true, run),
  );
  act(() =>
    window.dispatchEvent(
      new CustomEvent("settings-updated", {
        detail: { theme: "dark", cloudSync: { lastSyncStatus: "success" } },
      }),
    ),
  );
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(run).not.toHaveBeenCalled();
  act(() =>
    window.dispatchEvent(
      new CustomEvent("settings-updated", {
        detail: { theme: "light", cloudSync: {} },
      }),
    ),
  );
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(run).toHaveBeenCalledOnce();
  unmount();
});

it("does not overlap scheduled runs with an active target operation", async () => {
  const finish = beginCloudSyncActivity({ id: "work", provider: "nextcloud" });
  const run = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler(
      { ...settings, frequency: "every5Minutes" },
      true,
      run,
    ),
  );
  await act(() => vi.advanceTimersByTimeAsync(300_000));
  expect(run).not.toHaveBeenCalled();
  finish();
  await act(() => vi.advanceTimersByTimeAsync(300_000));
  expect(run).toHaveBeenCalledOnce();
  unmount();
});

it("manual mode never schedules on save or interval", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler(settings, true, run),
  );
  act(() => window.dispatchEvent(new Event(DATABASE_SYNC_CHANGED_EVENT)));
  await act(() => vi.advanceTimersByTimeAsync(86_400_000));
  expect(run).not.toHaveBeenCalled();
  unmount();
});

it.each([
  ["every5Minutes", 300_000],
  ["every15Minutes", 900_000],
  ["every30Minutes", 1_800_000],
  ["hourly", 3_600_000],
  ["daily", 86_400_000],
] as const)(
  "preserves %s timing even when a custom interval is saved",
  async (frequency, duration) => {
    const run = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useCloudSyncScheduler(
        { ...settings, frequency, customIntervalMinutes: 1 },
        true,
        run,
      ),
    );
    await act(() => vi.advanceTimersByTimeAsync(duration - 1));
    expect(run).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(run).toHaveBeenCalledOnce();
    unmount();
  },
);

it.each([
  [7, 420_000],
  [undefined, 900_000],
  [NaN, 900_000],
  [0, 60_000],
  [Number.MAX_SAFE_INTEGER, 604_800_000],
])(
  "schedules custom input %s safely after %i ms",
  async (customIntervalMinutes, duration) => {
    const run = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useCloudSyncScheduler(
        { ...settings, frequency: "custom", customIntervalMinutes },
        true,
        run,
      ),
    );
    act(() => window.dispatchEvent(new Event(DATABASE_SYNC_CHANGED_EVENT)));
    await act(() => vi.advanceTimersByTimeAsync(duration! - 1));
    expect(run).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(run).toHaveBeenCalledOnce();
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(duration!));
    expect(run).toHaveBeenCalledOnce();
  },
);

it("replaces the active timer when custom duration changes and cancels it in manual mode", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const initialProps: CloudSyncConfig = {
    ...settings,
    frequency: "custom",
    customIntervalMinutes: 2,
  };
  const { rerender, unmount } = renderHook(
    (config) => useCloudSyncScheduler(config, true, run),
    { initialProps },
  );
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  rerender({ ...initialProps, customIntervalMinutes: 3 });
  await act(() => vi.advanceTimersByTimeAsync(179_999));
  expect(run).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(run).toHaveBeenCalledOnce();
  rerender({ ...initialProps, frequency: "manual" });
  await act(() => vi.advanceTimersByTimeAsync(600_000));
  expect(run).toHaveBeenCalledOnce();
  unmount();
});

it.each([{ enabled: false }, { selectedItems: [] }])(
  "does not start a custom timer without enabled sync and selection: %j",
  async (overrides) => {
    const run = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useCloudSyncScheduler(
        {
          ...settings,
          ...overrides,
          frequency: "custom",
          customIntervalMinutes: 1,
        },
        true,
        run,
      ),
    );
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(run).not.toHaveBeenCalled();
    unmount();
  },
);
