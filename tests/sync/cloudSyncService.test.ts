import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  defaultCloudSyncConfig,
  type CloudSyncConfig,
  type CloudSyncTarget,
} from "../../src/types/settings/cloudSyncSettings";
import {
  aggregateCloudSyncResults,
  cloudSyncStatusUpdate,
  syncCloudTargets,
} from "../../src/utils/services/cloudSyncService";
import {
  beginCloudSyncActivity,
  getCloudSyncActivity,
  subscribeCloudSyncActivity,
  invalidateCloudSyncTarget,
} from "../../src/utils/services/cloudSyncActivity";
import { useCloudSyncStatus } from "../../src/hooks/sync/useCloudSyncStatus";
import { useCloudSyncActivity } from "../../src/hooks/sync/useCloudSyncActivity";

const target = (id: string): CloudSyncTarget => ({
  id,
  label: id,
  provider: "nextcloud",
  enabled: true,
});
const config = (): CloudSyncConfig => ({
  ...defaultCloudSyncConfig,
  enabled: true,
  syncTargets: [target("work"), target("home")],
});

describe("per-target cloud sync results", () => {
  it("rejects a completed request after its destination revision changes", async () => {
    const current = config();
    const results = await syncCloudTargets(current.syncTargets!);
    expect(typeof results[0].requestIdentity).toBe("symbol");
    invalidateCloudSyncTarget("work");
    const next = cloudSyncStatusUpdate(current, results, 100);
    expect(next.targetStatus?.work).toBeUndefined();
    expect(next.targetStatus?.home.lastSyncStatus).toBe("failed");
    expect(next.targetStatus?.home).not.toHaveProperty("requestIdentity");
    const retried = cloudSyncStatusUpdate(
      current,
      await syncCloudTargets([target("work")]),
      200,
    );
    expect(retried.targetStatus?.work.lastSyncTime).toBe(200);
  });

  it("keeps request identities and credentials out of persisted status and activity JSON", async () => {
    const secretTarget = {
      ...target("private"),
      nextcloud: {
        serverUrl: "https://private.example",
        username: "private-user",
        password: "secret-value",
        folderPath: "/private",
        useAppPassword: false,
      },
    };
    const snapshots: string[] = [];
    const unsubscribe = subscribeCloudSyncActivity(() =>
      snapshots.push(JSON.stringify(getCloudSyncActivity())),
    );
    try {
      const results = await syncCloudTargets([secretTarget]);
      const saved = cloudSyncStatusUpdate(
        { ...config(), syncTargets: [secretTarget] },
        results,
      );
      expect(JSON.stringify(saved)).not.toMatch(
        /secret-value|private-user|private\.example|requestIdentity/,
      );
      expect(snapshots.join(" ")).not.toMatch(
        /secret-value|private-user|private\.example|requestIdentity/,
      );
    } finally {
      unsubscribe();
    }
  });

  it("keeps two accounts on the same provider independent", () => {
    const update = cloudSyncStatusUpdate(
      config(),
      [
        {
          provider: "nextcloud",
          targetId: "work",
          status: "success",
          message: "Done",
        },
        {
          provider: "nextcloud",
          targetId: "home",
          status: "failed",
          message: "Storage unavailable",
        },
      ],
      100,
    );
    expect(update.targetStatus).toEqual({
      work: {
        provider: "nextcloud",
        lastSyncTime: 100,
        lastSyncStatus: "success",
        lastSuccessTime: 100,
        lastSyncError: undefined,
      },
      home: {
        provider: "nextcloud",
        lastSyncTime: 100,
        lastSyncStatus: "failed",
        lastSuccessTime: undefined,
        lastSyncError: "Storage unavailable",
      },
    });
    expect(update.providerStatus?.nextcloud?.lastSyncStatus).toBe("partial");
  });

  it("retains the last successful time after a later failure and roundtrip", () => {
    const first = {
      ...config(),
      ...cloudSyncStatusUpdate(
        config(),
        [
          {
            provider: "nextcloud",
            targetId: "work",
            status: "success",
            message: "Done",
          },
        ],
        100,
      ),
    };
    const next = cloudSyncStatusUpdate(
      first,
      [
        {
          provider: "nextcloud",
          targetId: "work",
          status: "failed",
          message: "Offline",
        },
      ],
      200,
    );
    expect(JSON.parse(JSON.stringify(next)).targetStatus.work).toMatchObject({
      lastSyncTime: 200,
      lastSuccessTime: 100,
      lastSyncStatus: "failed",
      lastSyncError: "Offline",
    });
    const recovered = cloudSyncStatusUpdate(
      { ...first, ...next },
      [
        {
          provider: "nextcloud",
          targetId: "work",
          status: "success",
          message: "Done",
        },
      ],
      300,
    );
    expect(recovered.targetStatus?.work.lastSyncError).toBeUndefined();
    expect(recovered.targetStatus?.work.lastSuccessTime).toBe(300);
  });

  it("does not label all targets successful after retrying only one", () => {
    const first = {
      ...config(),
      ...cloudSyncStatusUpdate(
        config(),
        [
          {
            provider: "nextcloud",
            targetId: "work",
            status: "failed",
            message: "Work offline",
          },
          {
            provider: "nextcloud",
            targetId: "home",
            status: "failed",
            message: "Home offline",
          },
        ],
        100,
      ),
    };
    const next = cloudSyncStatusUpdate(
      first,
      [
        {
          provider: "nextcloud",
          targetId: "work",
          status: "success",
          message: "Done",
        },
      ],
      200,
    );
    expect(next.targetStatus?.home).toEqual(first.targetStatus?.home);
    expect(next.providerStatus?.nextcloud?.lastSyncStatus).toBe("partial");
    expect(next.providerStatus?.nextcloud?.lastSyncError).toBe("Home offline");
  });

  it("does not assign legacy provider-wide success to a new target", () => {
    const legacy = {
      ...config(),
      providerStatus: {
        nextcloud: { enabled: true, lastSyncStatus: "success" as const },
      },
    };
    const next = cloudSyncStatusUpdate(
      legacy,
      [
        {
          provider: "nextcloud",
          targetId: "work",
          status: "success",
          message: "Done",
        },
      ],
      100,
    );
    expect(next.targetStatus?.home).toBeUndefined();
    expect(next.providerStatus?.nextcloud?.lastSyncStatus).toBe("partial");
  });

  it("does not resurrect removed or reconfigured targets", () => {
    const current = {
      ...config(),
      syncTargets: [{ ...target("work"), provider: "sftp" as const }],
    };
    expect(
      cloudSyncStatusUpdate(current, [
        {
          provider: "nextcloud",
          targetId: "work",
          status: "success",
          message: "Done",
        },
        {
          provider: "nextcloud",
          targetId: "home",
          status: "success",
          message: "Done",
        },
      ]),
    ).toEqual({});
  });

  it("does not remove other enabled providers when syncing one target", () => {
    const current = {
      ...config(),
      syncTargets: [
        target("work"),
        { ...target("other"), provider: "sftp" as const },
      ],
    };
    const next = cloudSyncStatusUpdate(current, [
      {
        provider: "nextcloud",
        targetId: "work",
        status: "failed",
        message: "Unavailable",
      },
    ]);
    expect(next.enabledProviders).toEqual(["nextcloud", "sftp"]);
  });

  it("preserves partial outcomes even without a fully successful target", () => {
    expect(
      aggregateCloudSyncResults([
        { provider: "sftp", status: "partial", message: "One file failed" },
      ]),
    ).toEqual({ status: "partial", message: "One file failed" });
  });

  it("reports the unimplemented Nextcloud application sync honestly", async () => {
    const snapshots: number[] = [];
    const unsubscribe = subscribeCloudSyncActivity(() =>
      snapshots.push(getCloudSyncActivity().length),
    );
    try {
      const result = await syncCloudTargets([
        target("work"),
        { ...target("off"), enabled: false },
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ targetId: "work", status: "failed" });
      expect(result[0].message).toContain("no data was transferred");
      expect(snapshots).toEqual([1, 0]);
      expect(getCloudSyncActivity()).toEqual([]);
    } finally {
      unsubscribe();
    }
  });
});

describe("shared cloud sync activity", () => {
  it("uses stable snapshots and never stores credentials", () => {
    const entry = { ...target("work"), password: "not-for-state" };
    const finish = beginCloudSyncActivity(entry);
    try {
      expect(getCloudSyncActivity()).toBe(getCloudSyncActivity());
      expect(getCloudSyncActivity()).toEqual([
        { id: "work", provider: "nextcloud" },
      ]);
    } finally {
      finish();
    }
  });

  it("keeps overlapping activity alive and treats cleanup as idempotent", () => {
    const finishA = beginCloudSyncActivity(target("work"));
    const finishB = beginCloudSyncActivity(target("work"));
    try {
      finishA();
      finishA();
      expect(getCloudSyncActivity()).toHaveLength(1);
    } finally {
      finishA();
      finishB();
    }
    expect(getCloudSyncActivity()).toEqual([]);
  });

  it("updates separate mounted hooks and prevents duplicate sync actions", () => {
    const onSyncNow = vi.fn();
    const observer = renderHook(() => useCloudSyncActivity());
    const popup = renderHook(() =>
      useCloudSyncStatus({ cloudSyncConfig: config(), onSyncNow }),
    );
    let finish = () => {};
    act(() => {
      finish = beginCloudSyncActivity(target("work"));
    });
    try {
      expect(observer.result.current).toHaveLength(1);
      expect(popup.result.current.isSyncing).toBe(true);
      expect(popup.result.current.isProviderSyncing("nextcloud")).toBe(true);
      expect(popup.result.current.isProviderSyncing("sftp")).toBe(false);
      act(() => {
        void popup.result.current.handleSyncAll();
      });
      expect(onSyncNow).not.toHaveBeenCalled();
    } finally {
      act(finish);
      observer.unmount();
      popup.unmount();
    }
    expect(getCloudSyncActivity()).toEqual([]);
  });
});
