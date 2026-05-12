import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type {
  AvailableUpdate,
  UpdaterSettings,
  UpdaterStatusSnapshot,
} from "../../src/types/updater/updater";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { useUpdater } from "../../src/hooks/updater/useUpdater";

const settings: UpdaterSettings = {
  autoCheckEnabled: true,
  checkIntervalHours: 24,
  privateEndpointEnabled: false,
  privateEndpointUrl: null,
  publicEndpointUrl: "https://github.example/latest.json",
  endpointMode: "public_only",
  resolvedEndpoints: [{ source: "public", url: "https://github.example/latest.json" }],
  dynamicPluginEndpointsSupported: true,
  dynamicPluginEndpointsMessage: null,
  privateEndpointValidationError: null,
};

const update: AvailableUpdate = {
  currentVersion: "1.5.0",
  version: "1.6.0",
  date: "2026-03-30T00:00:00Z",
  body: "Bug fixes and improvements",
  target: "x86_64-pc-windows-msvc",
  downloadUrl: "https://example.test/update-1.6.0.msi",
  signaturePresent: true,
  rawJson: {},
};

const idleStatus: UpdaterStatusSnapshot = {
  status: "idle",
  currentVersion: "1.5.0",
  availableUpdate: null,
  lastCheckedAt: null,
  lastError: null,
  endpointMode: "public_only",
  endpointSource: "public",
  resolvedEndpoints: settings.resolvedEndpoints,
  dynamicPluginEndpointsSupported: true,
  dynamicPluginEndpointsMessage: null,
  privateEndpointValidationError: null,
  downloadedBytes: 0,
  totalBytes: null,
  progressPercent: null,
};

const availableStatus: UpdaterStatusSnapshot = {
  ...idleStatus,
  status: "available",
  availableUpdate: update,
  lastCheckedAt: "2026-03-30T12:00:00Z",
};

const restartStatus: UpdaterStatusSnapshot = {
  ...availableStatus,
  status: "restart_required",
  downloadedBytes: 10,
  totalBytes: 10,
  progressPercent: 100,
};

describe("useUpdater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string, args?: { patch?: Partial<UpdaterSettings> }) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(settings);
        case "updater_get_status":
          return Promise.resolve(idleStatus);
        case "updater_check":
          return Promise.resolve({
            updateAvailable: true,
            availableUpdate: update,
            status: availableStatus,
          });
        case "updater_save_settings":
          return Promise.resolve({ ...settings, ...args?.patch });
        case "updater_download_and_install":
          return Promise.resolve(restartStatus);
        case "updater_relaunch":
          return Promise.resolve(undefined);
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });
  });

  it("loads backend-owned settings and status", async () => {
    const { result } = renderHook(() => useUpdater({ autoLoad: false }));

    await act(async () => {
      await result.current.refreshSettings();
      await result.current.refreshStatus();
    });

    expect(mockInvoke).toHaveBeenCalledWith("updater_get_settings", undefined);
    expect(mockInvoke).toHaveBeenCalledWith("updater_get_status", undefined);
  });

  it("checks for updates through updater_check", async () => {
    const { result } = renderHook(() => useUpdater({ autoLoad: false }));

    await act(async () => {
      const legacyInfo = await result.current.checkForUpdates();
      expect(legacyInfo?.version).toBe("1.6.0");
    });

    expect(mockInvoke).toHaveBeenCalledWith("updater_check", { force: true });
    expect(result.current.availableUpdate?.version).toBe("1.6.0");
    expect(result.current.updateInfo?.checksum).toBe("signed");
  });

  it("saves updater settings through updater_save_settings", async () => {
    const { result } = renderHook(() => useUpdater({ autoLoad: false }));

    await act(async () => {
      await result.current.saveSettings({
        autoCheckEnabled: false,
        checkIntervalHours: 6,
      });
    });

    expect(mockInvoke).toHaveBeenCalledWith("updater_save_settings", {
      patch: { autoCheckEnabled: false, checkIntervalHours: 6 },
    });
  });

  it("downloads and installs through updater_download_and_install", async () => {
    const { result } = renderHook(() => useUpdater({ autoLoad: false }));

    await act(async () => {
      await result.current.check(true);
      await result.current.install("1.6.0");
    });

    expect(mockInvoke).toHaveBeenCalledWith("updater_download_and_install", {
      version: "1.6.0",
    });
    expect(result.current.isRestartRequired).toBe(true);
    expect(result.current.canRelaunch).toBe(true);
  });

  it("relaunches through updater_relaunch", async () => {
    const { result } = renderHook(() => useUpdater({ autoLoad: false }));

    await act(async () => {
      await result.current.relaunch();
    });

    expect(mockInvoke).toHaveBeenCalledWith("updater_relaunch", undefined);
  });

  it("does not call retired updater commands for compatibility helpers", async () => {
    const { result } = renderHook(() => useUpdater({ autoLoad: false }));

    await act(async () => {
      await result.current.cancelDownload();
      await result.current.fetchHistory();
      await result.current.fetchRollbacks();
      await result.current.rollback("1.4.0");
      await result.current.setChannel("beta");
    });

    const commandNames = mockInvoke.mock.calls.map(([cmd]) => cmd);
    expect(commandNames).not.toContain("updater_cancel_download");
    expect(commandNames).not.toContain("updater_get_history");
    expect(commandNames).not.toContain("updater_get_rollbacks");
    expect(commandNames).not.toContain("updater_rollback");
    expect(commandNames).not.toContain("updater_set_channel");
  });
});