import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { useUpdater } from "../../src/hooks/updater/useUpdater";

describe("useUpdater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_config": return Promise.resolve({
          enabled: true,
          channel: "stable",
          autoCheck: false,
          autoDownload: false,
          autoInstall: false,
          checkIntervalMs: 86400000,
          notifyOnUpdate: true,
          installOnExit: false,
          keepRollbackCount: 3,
          customUpdateUrl: null,
          preReleaseOptIn: false,
        });
        case "updater_get_version_info": return Promise.resolve({
          currentVersion: "1.5.0",
          buildDate: "2026-03-01",
          commitHash: "abc1234",
          channel: "stable",
          rustVersion: "1.78.0",
          tauriVersion: "2.0.0",
          osInfo: "Windows 11",
        });
        case "updater_get_history": return Promise.resolve([]);
        case "updater_get_rollbacks": return Promise.resolve([]);
        default: return Promise.resolve(null);
      }
    });
  });

  it("checks for updates from backend", async () => {
    const updateInfo = {
      version: "1.6.0",
      currentVersion: "1.5.0",
      channel: "stable",
      releaseDate: "2026-03-30",
      releaseNotes: "Bug fixes and improvements",
      downloadUrl: "https://example.test/update-1.6.0",
      fileSize: 52428800,
      checksum: "sha256:abc123",
      mandatory: false,
      minCurrentVersion: null,
    };
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "updater_check") return Promise.resolve(updateInfo);
      if (cmd === "updater_get_config") return Promise.resolve({ enabled: true, channel: "stable" });
      if (cmd === "updater_get_version_info") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useUpdater());

    let info: unknown = null;
    await act(async () => {
      info = await result.current.checkForUpdates();
    });

    expect(mockInvoke).toHaveBeenCalledWith("updater_check");
    expect(info).toEqual(updateInfo);
    expect(result.current.updateInfo?.version).toBe("1.6.0");
    expect(result.current.checking).toBe(false);
  });

  it("returns current version info", async () => {
    const { result } = renderHook(() => useUpdater());

    // useEffect auto-calls loadConfig + fetchVersionInfo on mount
    await waitFor(() => {
      expect(result.current.versionInfo).not.toBeNull();
    });

    expect(result.current.versionInfo?.currentVersion).toBe("1.5.0");
    expect(result.current.versionInfo?.channel).toBe("stable");
    expect(result.current.versionInfo?.tauriVersion).toBe("2.0.0");
    expect(mockInvoke).toHaveBeenCalledWith("updater_get_version_info");
  });

  it("handles update check failures", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "updater_check") return Promise.reject("Server unreachable");
      if (cmd === "updater_get_config") return Promise.resolve({ enabled: true });
      if (cmd === "updater_get_version_info") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useUpdater());

    let info: unknown = "untouched";
    await act(async () => {
      info = await result.current.checkForUpdates();
    });

    expect(info).toBeNull();
    expect(result.current.error).toBe("Server unreachable");
    expect(result.current.checking).toBe(false);
  });

  it("initiates update download", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "updater_download") return Promise.resolve(undefined);
      if (cmd === "updater_get_status") return Promise.resolve({
        status: "ready",
        downloadedBytes: 52428800,
        totalBytes: 52428800,
        percent: 100,
        speedBps: 0,
        etaSeconds: 0,
        errorMessage: null,
      });
      if (cmd === "updater_get_config") return Promise.resolve({ enabled: true });
      if (cmd === "updater_get_version_info") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useUpdater());

    await act(async () => {
      await result.current.download();
    });

    expect(mockInvoke).toHaveBeenCalledWith("updater_download");
  });

  it("cancels an in-progress download", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "updater_cancel_download") return Promise.resolve(undefined);
      if (cmd === "updater_get_config") return Promise.resolve({ enabled: true });
      if (cmd === "updater_get_version_info") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useUpdater());

    await act(async () => {
      await result.current.cancelDownload();
    });

    expect(mockInvoke).toHaveBeenCalledWith("updater_cancel_download");
    expect(result.current.downloading).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it("fetches update history", async () => {
    const historyEntries = [
      { version: "1.4.0", channel: "stable", installedAt: "2026-02-01", previousVersion: "1.3.0", success: true, rollbackAvailable: true },
      { version: "1.5.0", channel: "stable", installedAt: "2026-03-01", previousVersion: "1.4.0", success: true, rollbackAvailable: true },
    ];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "updater_get_history") return Promise.resolve(historyEntries);
      if (cmd === "updater_get_config") return Promise.resolve({ enabled: true });
      if (cmd === "updater_get_version_info") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useUpdater());

    let list: unknown[] = [];
    await act(async () => {
      list = await result.current.fetchHistory();
    });

    expect(mockInvoke).toHaveBeenCalledWith("updater_get_history");
    expect(list).toHaveLength(2);
    expect(result.current.history[0].version).toBe("1.4.0");
  });

  it("switches update channel", async () => {
    const { result } = renderHook(() => useUpdater());

    // Wait for initial config load
    await waitFor(() => {
      expect(result.current.config).not.toBeNull();
    });

    await act(async () => {
      await result.current.setChannel("beta");
    });

    expect(mockInvoke).toHaveBeenCalledWith("updater_set_channel", { channel: "beta" });
    expect(result.current.config?.channel).toBe("beta");
  });

  it("loads config on mount", async () => {
    const { result } = renderHook(() => useUpdater());

    await waitFor(() => {
      expect(result.current.config).not.toBeNull();
    });

    expect(result.current.config?.enabled).toBe(true);
    expect(result.current.config?.channel).toBe("stable");
    expect(mockInvoke).toHaveBeenCalledWith("updater_get_config");
  });
});
