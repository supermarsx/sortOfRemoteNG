import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCloudSyncSettings } from "../../src/hooks/settings/useCloudSyncSettings";
import {
  defaultCloudSyncConfig,
  type CloudSyncConfig,
} from "../../src/types/settings/cloudSyncSettings";
import type { GlobalSettings } from "../../src/types/settings/settings";
import type { CloudSyncOperationResult } from "../../src/utils/services/cloudSyncService";
import {
  beginCloudSyncActivity,
  cloudSyncTargetIdentity,
} from "../../src/utils/services/cloudSyncActivity";

const mocks = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("../../src/utils/services/cloudSyncService", async (actual) => ({
  ...(await actual<object>()),
  syncCloudTargets: mocks.sync,
}));

const config = (): CloudSyncConfig => ({
  ...defaultCloudSyncConfig,
  enabled: true,
  syncTargets: [
    { id: "work", provider: "nextcloud", label: "Work", enabled: true },
    { id: "home", provider: "nextcloud", label: "Home", enabled: true },
    { id: "off", provider: "sftp", label: "Off", enabled: false },
  ],
});

describe("cloud sync settings target status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears same-provider destination history and discards the pending old result", async () => {
    let finish!: (results: CloudSyncOperationResult[]) => void;
    mocks.sync.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const update = vi.fn();
    const cloudSync: CloudSyncConfig = {
      ...config(),
      targetStatus: {
        work: {
          provider: "nextcloud",
          lastSyncTime: 100,
          lastSuccessTime: 100,
          lastSyncStatus: "success",
        },
      },
    };
    const hook = renderHook(
      ({ cloudSync }) =>
        useCloudSyncSettings({ cloudSync } as GlobalSettings, update),
      { initialProps: { cloudSync } },
    );
    let running!: Promise<void>;
    act(() => {
      running = hook.result.current.handleSyncTarget("work");
    });
    act(() =>
      hook.result.current.updateSyncTarget("work", {
        nextcloud: {
          serverUrl: "https://new.example",
          username: "new-user",
          folderPath: "/new",
          useAppPassword: true,
        },
      }),
    );
    const edited: CloudSyncConfig = update.mock.lastCall![0].cloudSync;
    expect(edited.targetStatus?.work).toBeUndefined();
    hook.rerender({ cloudSync: edited });
    expect(hook.result.current.isTargetSyncing("work")).toBe(false);
    await act(async () => {
      finish([
        {
          targetId: "work",
          provider: "nextcloud",
          status: "success",
          message: "Old destination",
        },
      ]);
      await running;
    });
    expect(
      update.mock.lastCall![0].cloudSync.targetStatus?.work,
    ).toBeUndefined();
  });

  it.each(["remove", "disable"])(
    "recomputes provider status when a failed target is %s",
    (action) => {
      const cloudSync: CloudSyncConfig = {
        ...config(),
        targetStatus: {
          work: {
            provider: "nextcloud",
            lastSyncTime: 100,
            lastSyncStatus: "success",
          },
          home: {
            provider: "nextcloud",
            lastSyncTime: 200,
            lastSyncStatus: "failed",
            lastSyncError: "Offline",
          },
        },
        providerStatus: {
          nextcloud: {
            enabled: true,
            lastSyncStatus: "partial",
            lastSyncError: "Offline",
          },
        },
      };
      const update = vi.fn();
      const hook = renderHook(() =>
        useCloudSyncSettings({ cloudSync } as GlobalSettings, update),
      );
      act(() =>
        action === "remove"
          ? hook.result.current.removeSyncTarget("home")
          : hook.result.current.toggleSyncTarget("home"),
      );
      expect(
        update.mock.lastCall![0].cloudSync.providerStatus.nextcloud,
      ).toEqual({
        enabled: true,
        lastSyncTime: 100,
        lastSyncStatus: "success",
        lastSyncError: undefined,
      });
      act(() => hook.result.current.removeSyncTarget("work"));
      expect(
        update.mock.lastCall![0].cloudSync.providerStatus.nextcloud
          ?.lastSyncStatus,
      ).not.toBe("success");
    },
  );

  it("does not mark newly enabled targets active during Sync All", async () => {
    let finish!: (results: CloudSyncOperationResult[]) => void;
    mocks.sync.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const update = vi.fn();
    const hook = renderHook(
      ({ cloudSync }) =>
        useCloudSyncSettings({ cloudSync } as GlobalSettings, update),
      { initialProps: { cloudSync: config() } },
    );
    let running!: Promise<void>;
    act(() => {
      running = hook.result.current.handleSyncNow();
    });
    const added = {
      ...config(),
      syncTargets: [
        ...config().syncTargets!.map((t) => ({ ...t, enabled: true })),
        { id: "new", label: "New", provider: "webdav" as const, enabled: true },
      ],
    };
    hook.rerender({ cloudSync: added });
    expect(hook.result.current.isTargetSyncing("work")).toBe(true);
    expect(hook.result.current.isTargetSyncing("off")).toBe(false);
    expect(hook.result.current.isTargetSyncing("new")).toBe(false);
    await act(async () => {
      finish([]);
      await running;
    });
  });

  it("does not apply old-provider shared activity to a reconfigured target", () => {
    const cloudSync = {
      ...config(),
      syncTargets: [{ ...config().syncTargets![0], provider: "sftp" as const }],
    };
    const finish = beginCloudSyncActivity({
      id: "work",
      provider: "nextcloud",
      requestIdentity: cloudSyncTargetIdentity("work"),
    });
    try {
      const hook = renderHook(() =>
        useCloudSyncSettings({ cloudSync } as GlobalSettings, vi.fn()),
      );
      expect(hook.result.current.isTargetSyncing("work")).toBe(false);
    } finally {
      act(finish);
    }
  });

  it("shows all enabled targets active and stores results by target after completion", async () => {
    let finish!: (results: CloudSyncOperationResult[]) => void;
    mocks.sync.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const update = vi.fn();
    const hook = renderHook(() =>
      useCloudSyncSettings({ cloudSync: config() } as GlobalSettings, update),
    );
    let running!: Promise<void>;
    act(() => {
      running = hook.result.current.handleSyncNow();
    });
    expect(hook.result.current.isTargetSyncing("work")).toBe(true);
    expect(hook.result.current.isTargetSyncing("home")).toBe(true);
    expect(hook.result.current.isTargetSyncing("off")).toBe(false);
    await act(async () => {
      finish([
        {
          targetId: "work",
          provider: "nextcloud",
          status: "success",
          message: "Done",
        },
        {
          targetId: "home",
          provider: "nextcloud",
          status: "failed",
          message: "Offline",
        },
      ]);
      await running;
    });
    expect(hook.result.current.isSyncing).toBe(false);
    expect(update.mock.lastCall?.[0].cloudSync.targetStatus).toMatchObject({
      work: { lastSyncStatus: "success" },
      home: { lastSyncStatus: "failed", lastSyncError: "Offline" },
    });
  });

  it("uses the newest settings when a run completes without resurrecting a removed target", async () => {
    let finish!: (results: CloudSyncOperationResult[]) => void;
    mocks.sync.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const update = vi.fn();
    const hook = renderHook(
      ({ cloudSync }) =>
        useCloudSyncSettings({ cloudSync } as GlobalSettings, update),
      { initialProps: { cloudSync: config() } },
    );
    let running!: Promise<void>;
    act(() => {
      running = hook.result.current.handleSyncTarget("work");
    });
    expect(hook.result.current.isTargetSyncing("home")).toBe(false);
    const latest = {
      ...config(),
      frequency: "daily" as const,
      syncTargets: config().syncTargets!.filter(
        (target) => target.id !== "work",
      ),
    };
    hook.rerender({ cloudSync: latest });
    await act(async () => {
      finish([
        {
          targetId: "work",
          provider: "nextcloud",
          status: "success",
          message: "Done",
        },
      ]);
      await running;
    });
    expect(update.mock.lastCall?.[0].cloudSync).toEqual(latest);
  });

  it("never invents target results from a provider-wide legacy result", () => {
    const cloudSync = {
      ...config(),
      providerStatus: {
        nextcloud: { enabled: true, lastSyncStatus: "success" as const },
      },
    };
    const hook = renderHook(() =>
      useCloudSyncSettings({ cloudSync } as GlobalSettings, vi.fn()),
    );
    expect(hook.result.current.getTargetStatus("work")).toBeUndefined();
    expect(hook.result.current.getTargetStatus("home")).toBeUndefined();
  });

  it("removes orphaned status on target deletion or provider change", () => {
    const cloudSync: CloudSyncConfig = {
      ...config(),
      targetStatus: {
        work: {
          provider: "nextcloud" as const,
          lastSyncTime: 100,
          lastSyncStatus: "failed" as const,
        },
      },
    };
    const update = vi.fn();
    const hook = renderHook(() =>
      useCloudSyncSettings({ cloudSync } as GlobalSettings, update),
    );
    act(() => hook.result.current.removeSyncTarget("work"));
    expect(update.mock.lastCall?.[0].cloudSync.targetStatus).toEqual({});
    act(() =>
      hook.result.current.updateSyncTarget("work", { provider: "sftp" }),
    );
    expect(update.mock.lastCall?.[0].cloudSync.targetStatus).toEqual({});
  });

  it("does not sync when disabled, and clears local activity on an unexpected rejection", async () => {
    const update = vi.fn();
    const hook = renderHook(
      ({ cloudSync }) =>
        useCloudSyncSettings({ cloudSync } as GlobalSettings, update),
      { initialProps: { cloudSync: { ...config(), enabled: false } } },
    );
    await act(async () => hook.result.current.handleSyncNow());
    expect(mocks.sync).not.toHaveBeenCalled();
    hook.rerender({ cloudSync: config() });
    mocks.sync.mockRejectedValue(new Error("Unavailable"));
    await act(async () => {
      await expect(
        hook.result.current.handleSyncTarget("work"),
      ).rejects.toThrow("Unavailable");
    });
    expect(hook.result.current.isSyncing).toBe(false);
  });
});
