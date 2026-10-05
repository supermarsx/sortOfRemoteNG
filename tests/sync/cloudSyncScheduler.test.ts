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
  selectedItems: ["database:test", "app:settings"],
  adaptiveSyncEnabled: false,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const saved = () =>
  window.dispatchEvent(new Event(DATABASE_SYNC_CHANGED_EVENT));

it("ignores durable app-store events explicitly outside the selected artifacts", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler(
      {
        ...settings,
        frequency: "realtime",
        selectedItems: ["app:recording.terminal-macros"],
      },
      true,
      run,
    ),
  );
  const stored = (key: string) =>
    window.dispatchEvent(
      new CustomEvent("sorng-app-data-store-changed", { detail: { key } }),
    );
  act(() => stored("recording.managed-scripts"));
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(run).not.toHaveBeenCalled();
  act(() => stored("recording.terminal-macros"));
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(run).toHaveBeenCalledOnce();
  unmount();
});

it("coalesces realtime saves into one trailing run after three quiet seconds", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler({ ...settings, frequency: "realtime" }, true, run),
  );
  for (let i = 0; i < 4; i++) {
    act(saved);
    await act(() => vi.advanceTimersByTimeAsync(1000));
  }
  await act(() => vi.advanceTimersByTimeAsync(1999));
  expect(run).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(run).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(run).toHaveBeenCalledOnce();
  unmount();
});

it("bounds continuous fixed realtime changes to a configured fifteen-second wait", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler(
      { ...settings, frequency: "realtime", debounceMaxWaitSeconds: 15 },
      true,
      run,
    ),
  );
  for (let i = 0; i < 15; i++) {
    act(saved);
    expect(run).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
  }
  expect(run).toHaveBeenCalledOnce();
  unmount();
});

it("retains one trailing batch during a slow run without overlapping or immediately flooding it", async () => {
  const first = deferred();
  const run = vi
    .fn()
    .mockResolvedValue(undefined)
    .mockReturnValueOnce(first.promise);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler({ ...settings, frequency: "realtime" }, true, run),
  );
  act(saved);
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(run).toHaveBeenCalledOnce();
  for (let i = 0; i < 20; i++) {
    act(saved);
    await act(() => vi.advanceTimersByTimeAsync(1000));
  }
  expect(run).toHaveBeenCalledOnce();
  await act(async () => {
    first.resolve();
  });
  await act(() => vi.advanceTimersByTimeAsync(2999));
  expect(run).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(run).toHaveBeenCalledTimes(2);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(run).toHaveBeenCalledTimes(2);
  unmount();
});

it("lets manual work start immediately and coalesces saves until its activity ends", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler({ ...settings, frequency: "realtime" }, true, run),
  );
  act(saved);
  const finish = beginCloudSyncActivity({ id: "manual", provider: "webdav" });
  await run(); // Manual callers are not routed through the scheduler's timer.
  expect(run).toHaveBeenCalledOnce();
  for (let i = 0; i < 5; i++) {
    act(saved);
    await act(() => vi.advanceTimersByTimeAsync(3000));
  }
  expect(run).toHaveBeenCalledOnce();
  act(finish);
  await act(() => vi.advanceTimersByTimeAsync(2999));
  expect(run).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(run).toHaveBeenCalledTimes(2);
  unmount();
});

it("does not lose the in-flight guard when scheduler settings change", async () => {
  const first = deferred();
  const run = vi
    .fn()
    .mockResolvedValue(undefined)
    .mockReturnValueOnce(first.promise);
  const { rerender, unmount } = renderHook(
    (config: CloudSyncConfig) => useCloudSyncScheduler(config, true, run),
    { initialProps: { ...settings, frequency: "realtime" } },
  );
  act(saved);
  await act(() => vi.advanceTimersByTimeAsync(3000));
  rerender({ ...settings, frequency: "onSave" });
  act(saved);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(run).toHaveBeenCalledOnce();
  await act(async () => {
    first.resolve();
  });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(run).toHaveBeenCalledTimes(2);
  unmount();
});

it.each(["disabled", "manual", "unready", "selection", "unmount"] as const)(
  "cleans pending realtime work on %s",
  async (change) => {
    const run = vi.fn().mockResolvedValue(undefined);
    const initial = {
      config: { ...settings, frequency: "realtime" } as CloudSyncConfig,
      ready: true,
    };
    const { rerender, unmount } = renderHook(
      ({ config, ready }) => useCloudSyncScheduler(config, ready, run),
      { initialProps: initial },
    );
    act(saved);
    if (change === "unmount") unmount();
    else
      rerender({
        ready: change !== "unready",
        config: {
          ...initial.config,
          ...(change === "disabled" ? { enabled: false } : {}),
          ...(change === "manual" ? { frequency: "manual" as const } : {}),
          ...(change === "selection"
            ? { selectedItems: ["database:another"] }
            : {}),
        },
      });
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(run).not.toHaveBeenCalled();
    unmount();
  },
);

it("does not reschedule late work after unmount or automatically replay a failed run", async () => {
  const first = deferred();
  const run = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockRejectedValue(new Error("synthetic failure"));
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler({ ...settings, frequency: "realtime" }, true, run),
  );
  act(saved);
  await act(() => vi.advanceTimersByTimeAsync(3000));
  act(saved);
  unmount();
  await act(async () => {
    first.resolve();
  });
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(run).toHaveBeenCalledOnce();
  const next = renderHook(() =>
    useCloudSyncScheduler({ ...settings, frequency: "realtime" }, true, run),
  );
  act(saved);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(run).toHaveBeenCalledTimes(2);
  next.unmount();
});

it("coalesces startup with a pending save without cancelling the startup timer", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler(
      { ...settings, frequency: "realtime", syncOnStartup: true },
      true,
      run,
    ),
  );
  await act(() => vi.advanceTimersByTimeAsync(500));
  act(saved);
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(run).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(run).toHaveBeenCalledOnce();
  unmount();
});

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
