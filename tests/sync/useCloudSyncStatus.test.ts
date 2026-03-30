import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

import {
  useCloudSyncStatus,
  formatRelativeTime,
  PROVIDER_NAMES,
} from "../../src/hooks/sync/useCloudSyncStatus";
import type { CloudSyncProvider } from "../../src/types/settings/settings";

describe("useCloudSyncStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sync status from backend", () => {
    const config = {
      enabled: true,
      enabledProviders: ["googleDrive", "oneDrive"] as CloudSyncProvider[],
      providerStatus: {
        googleDrive: { enabled: true, lastSyncTime: Date.now() / 1000 - 30, lastSyncStatus: "success" as const },
        oneDrive: { enabled: true, lastSyncTime: Date.now() / 1000 - 3600, lastSyncStatus: "success" as const },
      },
      frequency: "hourly",
    };

    const { result } = renderHook(() =>
      useCloudSyncStatus({ cloudSyncConfig: config }),
    );

    expect(result.current.hasSync).toBe(true);
    expect(result.current.enabledProviders).toEqual(["googleDrive", "oneDrive"]);
    expect(result.current.isSyncing).toBe(false);
    expect(result.current.getLastSyncTime()).toBeDefined();
  });

  it("detects sync conflicts", () => {
    const config = {
      enabled: true,
      enabledProviders: ["sftp"] as CloudSyncProvider[],
      providerStatus: {
        sftp: {
          enabled: true,
          lastSyncTime: Date.now() / 1000 - 60,
          lastSyncStatus: "conflict" as const,
          lastSyncError: "Remote file modified",
        },
      },
      frequency: "manual",
    };

    const { result } = renderHook(() =>
      useCloudSyncStatus({ cloudSyncConfig: config }),
    );

    expect(result.current.hasSync).toBe(true);
    expect(result.current.config.providerStatus.sftp?.lastSyncStatus).toBe("conflict");
    expect(result.current.config.providerStatus.sftp?.lastSyncError).toBe("Remote file modified");
  });

  it("handles sync errors gracefully", async () => {
    const onSyncNow = vi.fn().mockRejectedValue(new Error("Network error"));
    const config = {
      enabled: true,
      enabledProviders: ["googleDrive"] as CloudSyncProvider[],
      providerStatus: {},
      frequency: "manual",
    };

    const { result } = renderHook(() =>
      useCloudSyncStatus({ cloudSyncConfig: config, onSyncNow }),
    );

    // handleSyncAll should not throw even when onSyncNow rejects
    await act(async () => {
      try {
        await result.current.handleSyncAll();
      } catch {
        // error is expected to propagate; verify state resets
      }
    });

    // After the call completes (even with error), isSyncing should reset
    expect(result.current.isSyncing).toBe(false);
  });

  it("returns hasSync=false when sync is disabled", () => {
    const config = {
      enabled: false,
      enabledProviders: [] as CloudSyncProvider[],
      providerStatus: {},
      frequency: "manual",
    };

    const { result } = renderHook(() =>
      useCloudSyncStatus({ cloudSyncConfig: config }),
    );

    expect(result.current.hasSync).toBe(false);
    expect(result.current.enabledProviders).toEqual([]);
  });

  it("returns defaults when no config provided", () => {
    const { result } = renderHook(() =>
      useCloudSyncStatus({}),
    );

    expect(result.current.hasSync).toBe(false);
    expect(result.current.config.enabled).toBe(false);
    expect(result.current.enabledProviders).toEqual([]);
  });

  it("syncs a specific provider", async () => {
    const onSyncNow = vi.fn().mockResolvedValue(undefined);
    const config = {
      enabled: true,
      enabledProviders: ["googleDrive", "sftp"] as CloudSyncProvider[],
      providerStatus: {},
      frequency: "manual",
    };

    const { result } = renderHook(() =>
      useCloudSyncStatus({ cloudSyncConfig: config, onSyncNow }),
    );

    await act(async () => {
      await result.current.handleSyncProvider("sftp");
    });

    expect(onSyncNow).toHaveBeenCalledWith("sftp");
    expect(result.current.isSyncing).toBe(false);
    expect(result.current.syncingProvider).toBeNull();
  });

  it("filters out 'none' from enabled providers", () => {
    const config = {
      enabled: true,
      enabledProviders: ["none", "googleDrive"] as CloudSyncProvider[],
      providerStatus: {},
      frequency: "manual",
    };

    const { result } = renderHook(() =>
      useCloudSyncStatus({ cloudSyncConfig: config }),
    );

    expect(result.current.enabledProviders).toEqual(["googleDrive"]);
  });
});

describe("formatRelativeTime", () => {
  it("returns 'Never' for undefined timestamp", () => {
    expect(formatRelativeTime(undefined)).toBe("Never");
  });

  it("returns 'Just now' for recent timestamps", () => {
    const now = Date.now() / 1000;
    expect(formatRelativeTime(now - 10)).toBe("Just now");
  });

  it("returns minutes ago", () => {
    const now = Date.now() / 1000;
    expect(formatRelativeTime(now - 300)).toBe("5m ago");
  });

  it("returns hours ago", () => {
    const now = Date.now() / 1000;
    expect(formatRelativeTime(now - 7200)).toBe("2h ago");
  });

  it("returns days ago", () => {
    const now = Date.now() / 1000;
    expect(formatRelativeTime(now - 172800)).toBe("2d ago");
  });
});

describe("PROVIDER_NAMES", () => {
  it("has entries for all providers", () => {
    expect(PROVIDER_NAMES.googleDrive).toBe("Google Drive");
    expect(PROVIDER_NAMES.oneDrive).toBe("OneDrive");
    expect(PROVIDER_NAMES.sftp).toBe("SFTP");
    expect(PROVIDER_NAMES.webdav).toBe("WebDAV");
    expect(PROVIDER_NAMES.nextcloud).toBe("Nextcloud");
  });
});
