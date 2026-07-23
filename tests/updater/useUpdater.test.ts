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
import { useUpdaterAutoCheck } from "../../src/hooks/updater/useUpdaterAutoCheck";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const settings: UpdaterSettings = {
  autoCheckEnabled: true,
  checkIntervalHours: 24,
  installMode: "nsis",
  selfUpdateSupported: true,
  selfUpdateMessage: null,
  privateEndpointEnabled: false,
  privateEndpointUrl: null,
  publicEndpointUrl: "https://github.example/latest.json",
  endpointMode: "public_only",
  resolvedEndpoints: [
    { source: "public", url: "https://github.example/latest.json" },
  ],
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
  installMode: "nsis",
  selfUpdateSupported: true,
  selfUpdateMessage: null,
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
    mockInvoke.mockImplementation(
      (cmd: string, args?: { patch?: Partial<UpdaterSettings> }) => {
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
      },
    );
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

  it("launches both capability requests and publishes status while settings is pending", async () => {
    const settingsResponse = deferred<UpdaterSettings>();
    const statusResponse = deferred<UpdaterStatusSnapshot>();
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return settingsResponse.promise;
        case "updater_get_status":
          return statusResponse.promise;
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    const { result } = renderHook(() => useUpdater({ autoLoad: false }));
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refresh();
    });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));
    expect(mockInvoke).toHaveBeenCalledWith("updater_get_settings", undefined);
    expect(mockInvoke).toHaveBeenCalledWith("updater_get_status", undefined);
    expect(result.current.canCheck).toBe(false);

    await act(async () => {
      statusResponse.resolve(idleStatus);
      await statusResponse.promise;
    });
    await waitFor(() => expect(result.current.status).toEqual(idleStatus));
    expect(result.current.settings).toBeNull();
    expect(result.current.loadingSettings).toBe(true);
    expect(result.current.canCheck).toBe(false);

    await act(async () => {
      settingsResponse.resolve(settings);
      await refresh;
    });
    await waitFor(() => expect(result.current.canCheck).toBe(true));
  });

  it("preserves one capability failure after the other request succeeds", async () => {
    const settingsResponse = deferred<UpdaterSettings>();
    const statusResponse = deferred<UpdaterStatusSnapshot>();
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return settingsResponse.promise;
        case "updater_get_status":
          return statusResponse.promise;
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    const { result } = renderHook(() => useUpdater({ autoLoad: false }));
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refresh();
    });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));

    settingsResponse.reject(new Error("settings offline"));
    await act(async () => {
      await settingsResponse.promise.catch(() => undefined);
    });
    await waitFor(() =>
      expect(result.current.lastError).toBe(
        "Updater settings: settings offline",
      ),
    );

    await act(async () => {
      statusResponse.resolve(idleStatus);
      await refresh;
    });

    expect(result.current.status).toEqual(idleStatus);
    expect(result.current.settings).toBeNull();
    expect(result.current.lastError).toBe("Updater settings: settings offline");
    expect(result.current.canCheck).toBe(false);
  });

  it("never transiently enables updates when the pending capability response rejects self-update", async () => {
    const settingsResponse = deferred<UpdaterSettings>();
    const statusResponse = deferred<UpdaterStatusSnapshot>();
    const message =
      "This portable installation is updated manually. Download and extract a newer portable ZIP from GitHub Releases.";
    const portableSettings: UpdaterSettings = {
      ...settings,
      installMode: "portable",
      selfUpdateSupported: false,
      selfUpdateMessage: message,
    };
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return settingsResponse.promise;
        case "updater_get_status":
          return statusResponse.promise;
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    const { result } = renderHook(() => useUpdater({ autoLoad: false }));
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refresh();
    });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));

    await act(async () => {
      statusResponse.resolve(idleStatus);
      await statusResponse.promise;
    });
    await waitFor(() => expect(result.current.status).toEqual(idleStatus));
    expect(result.current.settings).toBeNull();
    expect(result.current.canCheck).toBe(false);

    await act(async () => {
      settingsResponse.resolve(portableSettings);
      await refresh;
    });
    await waitFor(() => expect(result.current.selfUpdateSupported).toBe(false));
    expect(result.current.selfUpdateMessage).toBe(message);
    expect(result.current.canCheck).toBe(false);
  });

  it("clears only each recovered capability error during a retry", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.reject(new Error("settings offline"));
        case "updater_get_status":
          return Promise.reject(new Error("status offline"));
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    const { result } = renderHook(() => useUpdater({ autoLoad: false }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.lastError).toBe(
      "Updater settings: settings offline Updater status: status offline",
    );

    const settingsRetry = deferred<UpdaterSettings>();
    const statusRetry = deferred<UpdaterStatusSnapshot>();
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return settingsRetry.promise;
        case "updater_get_status":
          return statusRetry.promise;
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    let retry!: Promise<void>;
    act(() => {
      retry = result.current.refresh();
    });
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(4));

    await act(async () => {
      settingsRetry.resolve(settings);
      await settingsRetry.promise;
    });
    await waitFor(() => expect(result.current.settings).toEqual(settings));
    expect(result.current.lastError).toBe("Updater status: status offline");
    expect(result.current.canCheck).toBe(false);

    await act(async () => {
      statusRetry.resolve(idleStatus);
      await retry;
    });
    expect(result.current.lastError).toBeNull();
    expect(result.current.canCheck).toBe(true);
  });

  it("checks for updates through updater_check", async () => {
    const { result } = renderHook(() => useUpdater({ autoLoad: false }));

    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.canCheck).toBe(true));

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
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.canCheck).toBe(true));

    await act(async () => {
      await result.current.check(true);
    });
    await waitFor(() => expect(result.current.canInstall).toBe(true));

    await act(async () => {
      await result.current.install("1.6.0");
    });

    expect(mockInvoke).toHaveBeenCalledWith("updater_download_and_install", {
      version: "1.6.0",
    });
    expect(result.current.isRestartRequired).toBe(true);
    expect(result.current.canRelaunch).toBe(true);
  });

  it("fails closed when check or install is called before capability loading", async () => {
    const { result } = renderHook(() => useUpdater({ autoLoad: false }));

    await act(async () => {
      expect(await result.current.check(true)).toBeNull();
      expect(await result.current.install("1.6.0")).toBeNull();
    });

    expect(result.current.lastError).toContain(
      "Updater capability is still loading",
    );
    const commandNames = mockInvoke.mock.calls.map(([cmd]) => cmd);
    expect(commandNames).not.toContain("updater_check");
    expect(commandNames).not.toContain("updater_download_and_install");
  });

  it("does not invoke check or install for an externally managed package", async () => {
    const message =
      "This Flatpak installation is updated externally. Install a newer Flatpak from GitHub Releases.";
    const flatpakSettings: UpdaterSettings = {
      ...settings,
      installMode: "flatpak",
      selfUpdateSupported: false,
      selfUpdateMessage: message,
    };
    const flatpakStatus: UpdaterStatusSnapshot = {
      ...idleStatus,
      installMode: "flatpak",
      selfUpdateSupported: false,
      selfUpdateMessage: message,
    };
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(flatpakSettings);
        case "updater_get_status":
          return Promise.resolve(flatpakStatus);
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    const { result } = renderHook(() => useUpdater({ autoLoad: false }));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.installMode).toBe("flatpak");
    expect(result.current.selfUpdateSupported).toBe(false);
    expect(result.current.canCheck).toBe(false);
    expect(result.current.canInstall).toBe(false);

    await act(async () => {
      expect(await result.current.check(true)).toBeNull();
      expect(await result.current.install("1.6.0")).toBeNull();
    });

    expect(result.current.lastError).toBe(message);
    const commandNames = mockInvoke.mock.calls.map(([cmd]) => cmd);
    expect(commandNames).not.toContain("updater_check");
    expect(commandNames).not.toContain("updater_download_and_install");
  });

  it("skips the automatic check for an externally managed package", async () => {
    const message =
      "This RPM package is updated externally. Install a newer .rpm package from GitHub Releases.";
    const rpmSettings: UpdaterSettings = {
      ...settings,
      installMode: "rpm",
      selfUpdateSupported: false,
      selfUpdateMessage: message,
    };
    const rpmStatus: UpdaterStatusSnapshot = {
      ...idleStatus,
      installMode: "rpm",
      selfUpdateSupported: false,
      selfUpdateMessage: message,
    };
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(rpmSettings);
        case "updater_get_status":
          return Promise.resolve(rpmStatus);
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    const { result } = renderHook(() =>
      useUpdaterAutoCheck({ enabled: false, minIntervalMs: 0 }),
    );
    await act(async () => {
      expect(await result.current.runNow()).toBeNull();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.settings?.installMode).toBe("rpm");
    expect(mockInvoke).not.toHaveBeenCalledWith("updater_check", {
      force: false,
    });
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
