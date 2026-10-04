import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCloudSyncSettings,
  conflictDescriptions,
  conflictLabels,
} from "../../src/hooks/settings/useCloudSyncSettings";
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

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  test: vi.fn(),
  review: vi.fn(),
  resolve: vi.fn(),
}));
// Hook tests exercise status aggregation but never execute payload/transport work.
vi.mock("../../src/utils/services/cloudSyncEngine", () => ({}));
vi.mock("../../src/utils/services/cloudSyncService", async (actual) => ({
  ...(await actual<object>()),
  syncCloudTargets: mocks.sync,
  testCloudSyncTarget: mocks.test,
  reviewCloudSyncTarget: mocks.review,
  resolveCloudSyncTarget: mocks.resolve,
}));

const config = (): CloudSyncConfig => ({
  ...defaultCloudSyncConfig,
  enabled: true,
  selectedItems: ["record:work"],
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
    await act(async () => hook.result.current.handleSyncTarget("work"));
    expect(hook.result.current.isSyncing).toBe(false);
    expect(update.mock.lastCall![0].cloudSync.targetStatus.work).toMatchObject({
      lastSyncStatus: "failed",
      lastSyncError: expect.stringContaining("could not complete"),
    });
  });

  it("passes current configuration and selections unchanged to sync", async () => {
    mocks.sync.mockResolvedValue([]);
    const cloudSync = {
      ...config(),
      compressionEnabled: false,
      maxFileSizeMB: 17,
      excludePatterns: ["*.tmp"],
      selectedItems: ["record:chosen"],
    };
    const hook = renderHook(() =>
      useCloudSyncSettings({ cloudSync } as GlobalSettings, vi.fn()),
    );
    await act(async () => hook.result.current.handleSyncTarget("work"));
    expect(mocks.sync).toHaveBeenCalledWith(
      [cloudSync.syncTargets![0]],
      cloudSync,
    );
  });

  it.each([undefined, []])(
    "requires an explicit item selection (%j), ignoring legacy toggles",
    async (selectedItems) => {
      const cloudSync = { ...config(), selectedItems };
      const hook = renderHook(() =>
        useCloudSyncSettings({ cloudSync } as GlobalSettings, vi.fn()),
      );
      expect(hook.result.current.validationError).toContain(
        "Select at least one",
      );
      await act(async () => hook.result.current.handleSyncNow());
      expect(mocks.sync).not.toHaveBeenCalled();
    },
  );

  it("probes with current config without writing sync history, and redacts known secrets", async () => {
    const cloudSync = config();
    cloudSync.syncTargets![0].nextcloud = {
      serverUrl: "https://cloud.test",
      username: "test",
      appPassword: "private-secret",
      folderPath: "/app",
      useAppPassword: true,
    };
    const update = vi.fn();
    mocks.test.mockResolvedValue({
      provider: "nextcloud",
      status: "failed",
      message: "Denied private-secret",
      canRead: true,
      canWrite: false,
    });
    const hook = renderHook(() =>
      useCloudSyncSettings({ cloudSync } as GlobalSettings, update),
    );
    await act(async () => hook.result.current.handleTestTarget("work"));
    expect(mocks.test).toHaveBeenCalledWith(
      cloudSync.syncTargets![0],
      cloudSync,
    );
    expect(update).not.toHaveBeenCalled();
    expect(hook.result.current.getTargetTestResult("work")).toMatchObject({
      status: "failed",
      message: "Denied [redacted]",
      canRead: true,
      canWrite: false,
    });
    expect(hook.result.current.getTargetTestResult("home")).toBeUndefined();
  });

  it.each(["remove", "edit", "disable", "provider"])(
    "discards a pending probe after target %s",
    async (change) => {
      let finish!: (result: CloudSyncOperationResult) => void;
      mocks.test.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const initial = config();
      const hook = renderHook(
        ({ cloudSync }) =>
          useCloudSyncSettings({ cloudSync } as GlobalSettings, vi.fn()),
        { initialProps: { cloudSync: initial } },
      );
      let running!: Promise<void>;
      act(() => {
        running = hook.result.current.handleTestTarget("work");
      });
      const latest = {
        ...initial,
        syncTargets: initial.syncTargets!.flatMap((target) =>
          target.id !== "work"
            ? [target]
            : change === "remove"
              ? []
              : [
                  {
                    ...target,
                    ...(change === "disable"
                      ? { enabled: false }
                      : change === "provider"
                        ? { provider: "googleDrive" as const }
                        : {
                            nextcloud: {
                              serverUrl: "https://new.test",
                              username: "changed",
                              folderPath: "/app",
                              useAppPassword: true,
                            },
                          }),
                  },
                ],
        ),
      };
      hook.rerender({ cloudSync: latest });
      await act(async () => {
        finish({
          provider: "nextcloud",
          status: "success",
          message: "Old probe",
          canRead: true,
          canWrite: true,
        });
        await running;
      });
      expect(hook.result.current.getTargetTestResult("work")).toBeUndefined();
      expect(hook.result.current.testingTargetId).toBeNull();
    },
  );

  it("does not duplicate overlapping operations and returns a safe per-target thrown error", async () => {
    let fail!: (error: Error) => void;
    mocks.test.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const cloudSync = config();
    const hook = renderHook(() =>
      useCloudSyncSettings({ cloudSync } as GlobalSettings, vi.fn()),
    );
    let running!: Promise<void>;
    act(() => {
      running = hook.result.current.handleTestTarget("work");
      void hook.result.current.handleTestTarget("work");
      void hook.result.current.handleSyncNow();
    });
    expect(mocks.test).toHaveBeenCalledOnce();
    expect(mocks.sync).not.toHaveBeenCalled();
    await act(async () => {
      fail(new Error("secret in backend exception"));
      await running;
    });
    expect(
      hook.result.current.getTargetTestResult("work")?.message,
    ).not.toContain("secret");
  });

  it("allows a probe with no selected data, but respects disabled master and target", async () => {
    mocks.test.mockResolvedValue({
      provider: "nextcloud",
      status: "success",
      message: "Probe",
      canRead: true,
      canWrite: true,
    });
    const cloudSync: CloudSyncConfig = { ...config(), selectedItems: [] };
    const hook = renderHook(
      ({ cloudSync }) =>
        useCloudSyncSettings({ cloudSync } as GlobalSettings, vi.fn()),
      { initialProps: { cloudSync } },
    );
    await act(async () => hook.result.current.handleTestTarget("work"));
    expect(mocks.test).toHaveBeenCalledOnce();
    hook.rerender({ cloudSync: { ...cloudSync, enabled: false } });
    await act(async () => hook.result.current.handleTestTarget("work"));
    await act(async () => hook.result.current.handleTestTarget("off"));
    expect(mocks.test).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    "",
    "MD5:1234",
    "SHA256:bad",
    `SHA256:${"A".repeat(43)}=`,
    `SHA256:${"A".repeat(42)}`,
    `SHA256:${"A".repeat(44)}`,
  ])(
    "rejects unpinned SFTP without calling native (%s)",
    async (hostKeyFingerprint) => {
      const cloudSync = {
        ...config(),
        syncTargets: [
          {
            id: "ssh",
            label: "SSH",
            provider: "sftp" as const,
            enabled: true,
            sftp: {
              host: "ssh.test",
              port: 22,
              username: "test",
              authMethod: "password" as const,
              folderPath: "/sync",
              hostKeyFingerprint,
            },
          },
        ],
      };
      const update = vi.fn();
      const hook = renderHook(() =>
        useCloudSyncSettings({ cloudSync } as GlobalSettings, update),
      );
      await act(async () => hook.result.current.handleTestTarget("ssh"));
      await act(async () => hook.result.current.handleSyncTarget("ssh"));
      expect(mocks.test).not.toHaveBeenCalled();
      expect(mocks.sync).not.toHaveBeenCalled();
      expect(hook.result.current.getTargetTestResult("ssh")?.message).toContain(
        "SHA256",
      );
      expect(
        update.mock.lastCall![0].cloudSync.targetStatus.ssh.lastSyncError,
      ).toContain("SHA256");
    },
  );

  it.each(["keepLocal", "keepRemote"] as const)(
    "routes the legacy %s shortcut through review without applying choices",
    async (resolution) => {
      mocks.review.mockImplementation(async (target) => ({
        targetId: target.id,
        requestIdentity: cloudSyncTargetIdentity(target.id),
        reviewKey: "fresh",
        items: [],
      }));
      const cloudSync: CloudSyncConfig = {
        ...config(),
        conflictResolution: "askEveryTime",
        targetStatus: {
          work: {
            provider: "nextcloud",
            lastSyncTime: 1,
            lastSyncStatus: "conflict",
          },
        },
      };
      const update = vi.fn();
      const hook = renderHook(() =>
        useCloudSyncSettings({ cloudSync } as GlobalSettings, update),
      );
      expect(mocks.sync).not.toHaveBeenCalled();
      await act(async () =>
        hook.result.current.handleResolveConflict("work", resolution),
      );
      expect(mocks.review).toHaveBeenCalledWith(
        cloudSync.syncTargets![0],
        cloudSync,
      );
      expect(mocks.sync).not.toHaveBeenCalled();
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(hook.result.current.conflictReview?.choices).toEqual({});
      expect(update).not.toHaveBeenCalled();
    },
  );

  it("forwards a pinned SFTP target to the native probe", async () => {
    const cloudSync: CloudSyncConfig = {
      ...config(),
      syncTargets: [
        {
          id: "ssh",
          label: "SSH",
          provider: "sftp",
          enabled: true,
          sftp: {
            host: "ssh.test",
            port: 22,
            username: "test",
            authMethod: "password",
            folderPath: "/sync",
            hostKeyFingerprint: `SHA256:${"A".repeat(43)}`,
          },
        },
      ],
    };
    mocks.test.mockResolvedValue({
      provider: "sftp",
      status: "success",
      message: "Probe",
      canRead: true,
      canWrite: true,
    });
    const hook = renderHook(() =>
      useCloudSyncSettings({ cloudSync } as GlobalSettings, vi.fn()),
    );
    await act(async () => hook.result.current.handleTestTarget("ssh"));
    expect(mocks.test).toHaveBeenCalledWith(
      cloudSync.syncTargets![0],
      cloudSync,
    );
    expect(hook.result.current.getTargetTestResult("ssh")?.canWrite).toBe(true);
  });

  it("trims the SFTP fingerprint before persisting it", () => {
    const cloudSync = config();
    const update = vi.fn();
    const hook = renderHook(() =>
      useCloudSyncSettings({ cloudSync } as GlobalSettings, update),
    );
    act(() =>
      hook.result.current.updateSyncTarget("off", {
        sftp: {
          host: "ssh.test",
          port: 22,
          username: "test",
          authMethod: "password",
          folderPath: "/sync",
          hostKeyFingerprint: `  SHA256:${"A".repeat(43)}\n`,
        },
      }),
    );
    expect(
      update.mock.lastCall![0].cloudSync.syncTargets.find(
        (target: { id: string }) => target.id === "off",
      ).sftp.hostKeyFingerprint,
    ).toBe(`SHA256:${"A".repeat(43)}`);
  });

  it("describes target review and whole-artifact conflict semantics accurately", () => {
    expect(conflictDescriptions.askEveryTime).toContain("target status");
    expect(conflictDescriptions.askEveryTime).not.toContain("dialog");
    expect(conflictLabels.keepNewer).toBe("Newer when unambiguous");
    expect(conflictDescriptions.keepNewer).toBe(
      "One-sided changes sync automatically. If both copies changed, review is required; clock timestamps never choose a winner.",
    );
    expect(conflictDescriptions.merge).toContain(
      "Records inside an archive are not merged",
    );
    expect(conflictLabels.smartMerge).toBe("Smart Merge");
    expect(conflictDescriptions.smartMerge).toContain(
      "successful shared sync baseline",
    );
    expect(conflictDescriptions.smartMerge).toContain("disjoint record edits");
    expect(conflictDescriptions.smartMerge).toContain("supported artifacts");
    expect(conflictDescriptions.smartMerge).toContain("explicit review");
    expect(conflictDescriptions.smartMerge).toContain(
      "Clocks never choose a winner",
    );
  });

  it.each([
    { selectedItems: [] },
    { selectedItems: ["different-item"] },
    { encryptBeforeSync: false },
    { syncEncryptionPassword: "new-password" },
    { excludePatterns: ["*.private"] },
    { enabled: false },
  ] satisfies Partial<CloudSyncConfig>[])(
    "revokes every target before publishing changed consent %j",
    async (patch) => {
      const cloudSync = config();
      let finish!: (results: CloudSyncOperationResult[]) => void;
      mocks.sync.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const identities = cloudSync.syncTargets!.map((target) =>
        cloudSyncTargetIdentity(target.id),
      );
      const update = vi.fn();
      const hook = renderHook(
        ({ cloudSync }) =>
          useCloudSyncSettings({ cloudSync } as GlobalSettings, update),
        { initialProps: { cloudSync } },
      );
      let running!: Promise<void>;
      act(() => {
        running = hook.result.current.handleSyncTarget("work");
      });
      act(() => hook.result.current.updateCloudSync(patch));
      cloudSync.syncTargets!.forEach((target, index) =>
        expect(cloudSyncTargetIdentity(target.id)).not.toBe(identities[index]),
      );
      hook.rerender({ cloudSync: { ...cloudSync, ...patch } });
      await act(async () => {
        finish([
          {
            provider: "nextcloud",
            targetId: "work",
            status: "success",
            message: "Old selection",
            requestIdentity: identities[0],
          },
        ]);
        await running;
      });
      expect(
        update.mock.lastCall![0].cloudSync.targetStatus?.work,
      ).toBeUndefined();
    },
  );

  it("revokes queued target identities before publishing OS-vault opt-out and ignores an in-flight result", async () => {
    const cloudSync = { ...config(), autoUnlockOsVaultDatabases: true };
    const identities = cloudSync.syncTargets!.map((target) =>
      cloudSyncTargetIdentity(target.id),
    );
    let finish!: (results: CloudSyncOperationResult[]) => void;
    mocks.sync.mockReturnValueOnce(
      new Promise<CloudSyncOperationResult[]>((resolve) => {
        finish = resolve;
      }),
    );
    const update = vi.fn((patch: Partial<GlobalSettings>) => {
      if (patch.cloudSync?.autoUnlockOsVaultDatabases === false) {
        // Queued work captures these identities before it starts. Revoke them
        // synchronously, before the new consent reaches persistence or effects.
        cloudSync.syncTargets!.forEach((target, index) =>
          expect(cloudSyncTargetIdentity(target.id)).not.toBe(
            identities[index],
          ),
        );
      }
    });
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
      hook.result.current.updateCloudSync({
        autoUnlockOsVaultDatabases: false,
      }),
    );
    expect(update.mock.lastCall![0].cloudSync?.autoUnlockOsVaultDatabases).toBe(
      false,
    );
    hook.rerender({
      cloudSync: { ...cloudSync, autoUnlockOsVaultDatabases: false },
    });
    await act(async () => {
      finish([
        {
          provider: "nextcloud",
          targetId: "work",
          status: "success",
          message: "Result from revoked OS-vault consent",
          requestIdentity: identities[0],
        },
      ]);
      await running;
    });
    expect(
      update.mock.lastCall![0].cloudSync?.targetStatus?.work,
    ).toBeUndefined();
  });

  it("does not revoke runs for status writes, unchanged consent, or notification edits", () => {
    const cloudSync = config();
    const identity = cloudSyncTargetIdentity("work");
    const hook = renderHook(() =>
      useCloudSyncSettings({ cloudSync } as GlobalSettings, vi.fn()),
    );
    act(() =>
      hook.result.current.updateCloudSync({
        lastSyncStatus: "success",
        targetStatus: {},
        notifyOnSync: false,
      }),
    );
    act(() =>
      hook.result.current.updateCloudSync({
        selectedItems: [...cloudSync.selectedItems!],
        encryptBeforeSync: cloudSync.encryptBeforeSync,
        syncEncryptionPassword: undefined,
        excludePatterns: [],
      }),
    );
    expect(cloudSyncTargetIdentity("work")).toBe(identity);
  });

  it("keeps optional OAuth refresh settings when saving a manual access token", () => {
    const cloudSync: CloudSyncConfig = {
      ...config(),
      syncTargets: [
        {
          id: "drive",
          label: "Drive",
          provider: "oneDrive",
          enabled: true,
          oneDrive: {
            folderPath: "/existing",
            clientId: "client",
            clientSecret: "secret",
            tenantId: "tenant",
          },
        },
      ],
    };
    const update = vi.fn();
    const hook = renderHook(() =>
      useCloudSyncSettings({ cloudSync } as GlobalSettings, update),
    );
    act(() => hook.result.current.openTokenDialog("drive"));
    act(() =>
      hook.result.current.setAuthForm({
        accessToken: "manual",
        refreshToken: "",
        accountEmail: "person@example.test",
        tokenExpiry: "",
      }),
    );
    act(() => hook.result.current.saveTokenDialog());
    expect(
      update.mock.lastCall![0].cloudSync.syncTargets[0].oneDrive,
    ).toMatchObject({
      clientId: "client",
      clientSecret: "secret",
      tenantId: "tenant",
      accessToken: "manual",
      folderPath: "/existing",
    });
    expect(hook.result.current.authTargetId).toBeNull();
  });
});
