import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";
import {
  notifyBrowserSessionProjectionChange,
  type BrowserSessionProjectionChange,
} from "../../src/utils/services/browserSessionProjectionEvents";

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ getSettings: () => ({}) }) },
}));
vi.mock("../../src/utils/storage/appDataJsonStore", () => ({
  APP_DATA_STORE_CHANGED_EVENT: "sorng-app-data-store-changed",
}));
import {
  DATABASE_SYNC_CHANGED_EVENT,
  useCloudSyncScheduler,
} from "../../src/hooks/sync/useCloudSyncScheduler";

const config = {
  ...defaultCloudSyncConfig,
  enabled: true,
  frequency: "realtime" as const,
  selectedItems: ["database:owner"],
  adaptiveSyncEnabled: false,
};
function owner() {
  let valid = true;
  return {
    revoke: () => {
      valid = false;
    },
    change: (
      changeId: string,
      databaseId = "owner",
    ): BrowserSessionProjectionChange => ({
      databaseId,
      changeId,
      assertCurrent: () => {
        if (!valid) throw new Error("Owner changed");
      },
    }),
  };
}
const emit = (change: BrowserSessionProjectionChange) =>
  act(() => notifyBrowserSessionProjectionChange(change));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("coalesces semantic commits and does not extend the deadline for a duplicate", async () => {
  const fence = owner();
  const run = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler(config, true, run),
  );
  emit(fence.change("a"));
  await advance(1000);
  emit(fence.change("b"));
  await advance(1000);
  emit(fence.change("b"));
  await advance(1000);
  expect(run).not.toHaveBeenCalled();
  await advance(1000);
  expect(run).toHaveBeenCalledOnce();
  emit(fence.change("a"));
  emit(fence.change("b"));
  await advance(30_000);
  expect(run).toHaveBeenCalledOnce();
  unmount();
});

it("ignores unselected databases, raw native notifications and activity checkpoints", async () => {
  const run = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler(config, true, run),
  );
  emit(owner().change("other", "other"));
  act(() => {
    window.dispatchEvent(
      new CustomEvent("database-browser-sessions-changed", {
        detail: { databaseId: "owner", changeId: "unverified" },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("database-browser-sessions-checkpoint", {
        detail: { databaseId: "owner" },
      }),
    );
  });
  await advance(30_000);
  expect(run).not.toHaveBeenCalled();
  unmount();
});

it.each([
  "lock",
  "profile change",
  "database switch",
  "unlock generation change",
])(
  "discards cookie-only work when its captured fence reports %s before the debounce expires",
  async () => {
    const fence = owner();
    const run = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useCloudSyncScheduler(config, true, run),
    );
    emit(fence.change("stale"));
    fence.revoke();
    await advance(30_000);
    emit(fence.change("already-revoked"));
    await advance(30_000);
    expect(run).not.toHaveBeenCalled();
    unmount();
  },
);

it("does not discard an ordinary durable edit alongside a revoked cookie event", async () => {
  const fence = owner();
  const run = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler(config, true, run),
  );
  emit(fence.change("cookie"));
  act(() =>
    window.dispatchEvent(
      new CustomEvent(DATABASE_SYNC_CHANGED_EVENT, {
        detail: { databaseId: "owner" },
      }),
    ),
  );
  fence.revoke();
  await advance(30_000);
  expect(run).toHaveBeenCalledOnce();
  unmount();
});

it("keeps a valid selected owner's batch when a different owner is revoked", async () => {
  const first = owner();
  const second = owner();
  const run = vi.fn().mockResolvedValue(undefined);
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler(
      {
        ...config,
        selectedItems: ["database:owner", "database:other"],
      },
      true,
      run,
    ),
  );
  emit(first.change("first"));
  emit(second.change("second", "other"));
  first.revoke();
  await advance(30_000);
  expect(run).toHaveBeenCalledOnce();
  unmount();
});

it("queues one non-overlapping follow-up for semantic changes arriving during sync", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const run = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
  const fence = owner();
  const { unmount } = renderHook(() =>
    useCloudSyncScheduler(config, true, run),
  );
  emit(fence.change("before"));
  await advance(3000);
  emit(fence.change("during"));
  emit(fence.change("during"));
  await advance(30_000);
  expect(run).toHaveBeenCalledOnce();
  await act(async () => {
    finish();
  });
  await advance(30_000);
  expect(run).toHaveBeenCalledTimes(2);
  unmount();
});

it.each(["unmount", "disabled", "manual", "selection", "not-ready"])(
  "drops pending semantic notifications on %s",
  async (reason) => {
    const run = vi.fn().mockResolvedValue(undefined);
    const { rerender, unmount } = renderHook(
      ({ settings, ready }) => useCloudSyncScheduler(settings, ready, run),
      {
        initialProps: {
          settings: {
            ...config,
            frequency:
              config.frequency as typeof defaultCloudSyncConfig.frequency,
          },
          ready: true,
        },
      },
    );
    emit(owner().change("pending"));
    if (reason === "unmount") unmount();
    else
      rerender({
        settings: {
          ...config,
          ...(reason === "disabled" ? { enabled: false } : {}),
          ...(reason === "manual" ? { frequency: "manual" as const } : {}),
          ...(reason === "selection"
            ? { selectedItems: ["database:other"] }
            : {}),
        },
        ready: reason !== "not-ready",
      });
    await advance(30_000);
    expect(run).not.toHaveBeenCalled();
    unmount();
  },
);
