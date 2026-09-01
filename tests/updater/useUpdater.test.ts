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

import {
  UPDATER_SETTINGS_CHANGED_EVENT,
  updaterApi,
  useUpdater,
} from "../../src/hooks/updater/useUpdater";
import { useUpdaterAutoCheck } from "../../src/hooks/updater/useUpdaterAutoCheck";
import { SettingsManager } from "../../src/utils/settings/settingsManager";

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
  downloadUrl:
    "https://github.com/supermarsx/sortOfRemoteNG/releases/download/1.6/sortOfRemoteNG_1.6.0_windows-x86_64.msi",
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
    SettingsManager.resetInstance();
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
          case "updater_install_unsigned":
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

    expect(mockInvoke).toHaveBeenCalledWith("updater_check", {
      force: true,
      proxyUrl: null,
    });
    expect(result.current.availableUpdate?.version).toBe("1.6.0");
    expect(result.current.updateInfo?.checksum).toBe("signed");
  });

  it("routes updater checks and downloads through the configured HTTP proxy", async () => {
    SettingsManager.getInstance().applyInMemory({
      globalProxy: {
        type: "http-connect",
        host: "proxy.internal",
        port: 8443,
        username: "proxy-user",
        password: "p@ss word",
        enabled: true,
      },
    });
    const proxyUrl = "http://proxy-user:p%40ss%20word@proxy.internal:8443";

    await updaterApi.check(true);
    await updaterApi.downloadAndInstall("1.6.0");
    await updaterApi.installUnsigned("1.6.0", true);

    expect(mockInvoke).toHaveBeenCalledWith("updater_check", {
      force: true,
      proxyUrl,
    });
    expect(mockInvoke).toHaveBeenCalledWith("updater_download_and_install", {
      version: "1.6.0",
      proxyUrl,
    });
    expect(mockInvoke).toHaveBeenCalledWith("updater_install_unsigned", {
      version: "1.6.0",
      acknowledgedRisk: true,
      proxyUrl,
    });
  });

  it("fails closed instead of bypassing an enabled unsupported proxy", () => {
    SettingsManager.getInstance().applyInMemory({
      globalProxy: {
        type: "socks5",
        host: "proxy.internal",
        port: 1080,
        enabled: true,
      },
    });

    expect(() => updaterApi.check(true)).toThrow(
      "Updater network access was blocked",
    );
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "updater_check",
      expect.anything(),
    );
  });

  it("saves updater settings through updater_save_settings", async () => {
    const settingsChanged = vi.fn();
    window.addEventListener(UPDATER_SETTINGS_CHANGED_EVENT, settingsChanged);
    const { result } = renderHook(() => useUpdater({ autoLoad: false }));

    try {
      await act(async () => {
        await result.current.saveSettings({
          autoCheckEnabled: false,
          checkIntervalHours: 6,
        });
      });

      expect(mockInvoke).toHaveBeenCalledWith("updater_save_settings", {
        patch: { autoCheckEnabled: false, checkIntervalHours: 6 },
      });
      expect(settingsChanged).toHaveBeenCalledTimes(1);
      expect(
        (settingsChanged.mock.calls[0]?.[0] as CustomEvent<UpdaterSettings>)
          .detail,
      ).toMatchObject({
        autoCheckEnabled: false,
        checkIntervalHours: 6,
      });
    } finally {
      window.removeEventListener(
        UPDATER_SETTINGS_CHANGED_EVENT,
        settingsChanged,
      );
    }
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
    expect(result.current.canInstallUnsigned).toBe(false);

    await act(async () => {
      expect(await result.current.installUnsigned("1.6.0", true)).toBeNull();
    });
    expect(result.current.lastError).toContain("valid updater signature");
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "updater_install_unsigned",
      expect.anything(),
    );

    await act(async () => {
      await result.current.install("1.6.0");
    });

    expect(mockInvoke).toHaveBeenCalledWith("updater_download_and_install", {
      version: "1.6.0",
      proxyUrl: null,
    });
    expect(result.current.isRestartRequired).toBe(true);
    expect(result.current.canInstall).toBe(false);
    expect(result.current.canInstallUnsigned).toBe(false);
    expect(result.current.canRelaunch).toBe(true);
  });

  it("shows signed-install progress while IPC is pending and stops polling after success", async () => {
    vi.useFakeTimers();
    const installResponse = deferred<UpdaterStatusSnapshot>();
    const progressStatus: UpdaterStatusSnapshot = {
      ...availableStatus,
      status: "downloading",
      downloadedBytes: 150_000_000,
      totalBytes: 600_000_000,
      progressPercent: 25,
    };
    let statusCalls = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(settings);
        case "updater_get_status":
          statusCalls += 1;
          return Promise.resolve(
            statusCalls === 1 ? availableStatus : progressStatus,
          );
        case "updater_download_and_install":
          return installResponse.promise;
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    const { result, unmount } = renderHook(() =>
      useUpdater({ autoLoad: false }),
    );
    let installPromise: Promise<UpdaterStatusSnapshot | null> | undefined;

    try {
      await act(async () => {
        await result.current.refresh();
      });
      expect(result.current.canInstall).toBe(true);

      act(() => {
        installPromise = result.current.install(update.version);
      });
      expect(result.current.isInstalling).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(statusCalls).toBe(2);
      expect(result.current.isDownloading).toBe(true);
      expect(result.current.status).toEqual(progressStatus);
      expect(result.current.progress).toMatchObject({
        downloadedBytes: 150_000_000,
        totalBytes: 600_000_000,
        percent: 25,
      });

      await act(async () => {
        installResponse.resolve(restartStatus);
        await expect(installPromise).resolves.toEqual(restartStatus);
      });

      const callsAtCompletion = statusCalls;
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(statusCalls).toBe(callsAtCompletion);
      expect(result.current.status).toEqual(restartStatus);
    } finally {
      installResponse.resolve(restartStatus);
      unmount();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("keeps unsigned-install progress visible without letting polling errors mask terminal failure", async () => {
    vi.useFakeTimers();
    const installResponse = deferred<UpdaterStatusSnapshot>();
    const unsignedUpdate: AvailableUpdate = {
      ...update,
      signaturePresent: false,
    };
    const unsignedStatus: UpdaterStatusSnapshot = {
      ...availableStatus,
      availableUpdate: unsignedUpdate,
    };
    const progressStatus: UpdaterStatusSnapshot = {
      ...unsignedStatus,
      status: "downloading",
      downloadedBytes: 300_000_000,
      totalBytes: 600_000_000,
      progressPercent: 50,
    };
    let statusCalls = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(settings);
        case "updater_get_status":
          statusCalls += 1;
          if (statusCalls === 1) return Promise.resolve(unsignedStatus);
          if (statusCalls === 2) return Promise.resolve(progressStatus);
          if (statusCalls === 3) {
            return Promise.reject(new Error("progress telemetry unavailable"));
          }
          return Promise.resolve(unsignedStatus);
        case "updater_install_unsigned":
          return installResponse.promise;
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    const { result, unmount } = renderHook(() =>
      useUpdater({ autoLoad: false }),
    );
    let installPromise: Promise<UpdaterStatusSnapshot | null> | undefined;

    try {
      await act(async () => {
        await result.current.refresh();
      });
      expect(result.current.canInstallUnsigned).toBe(true);

      act(() => {
        installPromise = result.current.installUnsigned(update.version, true);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(result.current.status).toEqual(progressStatus);
      expect(result.current.progressPercent).toBe(50);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(statusCalls).toBe(3);
      expect(result.current.lastError).toBeNull();

      await act(async () => {
        installResponse.reject({
          message: "Unsigned installer validation failed",
          code: "unsigned_validation_failed",
        });
        await expect(installPromise).resolves.toBeNull();
      });

      expect(result.current.lastError).toBe(
        "Unsigned installer validation failed (unsigned_validation_failed)",
      );
      const callsAtFailure = statusCalls;
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(statusCalls).toBe(callsAtFailure);
    } finally {
      installResponse.resolve(restartStatus);
      unmount();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("stops updater status polling when a pending install hook unmounts", async () => {
    vi.useFakeTimers();
    const installResponse = deferred<UpdaterStatusSnapshot>();
    let statusCalls = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(settings);
        case "updater_get_status":
          statusCalls += 1;
          return Promise.resolve(availableStatus);
        case "updater_download_and_install":
          return installResponse.promise;
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    const { result, unmount } = renderHook(() =>
      useUpdater({ autoLoad: false }),
    );
    let installPromise: Promise<UpdaterStatusSnapshot | null> | undefined;

    try {
      await act(async () => {
        await result.current.refresh();
      });
      act(() => {
        installPromise = result.current.install(update.version);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(statusCalls).toBe(2);

      unmount();
      const callsAtUnmount = statusCalls;
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(statusCalls).toBe(callsAtUnmount);

      installResponse.resolve(restartStatus);
      await expect(installPromise).resolves.toEqual(restartStatus);
    } finally {
      installResponse.resolve(restartStatus);
      unmount();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("keeps an unsigned update retained but not installable once restart is required", async () => {
    const unsignedUpdate: AvailableUpdate = {
      ...update,
      signaturePresent: false,
    };
    const unsignedRestartStatus: UpdaterStatusSnapshot = {
      ...restartStatus,
      availableUpdate: unsignedUpdate,
    };
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(settings);
        case "updater_get_status":
          return Promise.resolve(unsignedRestartStatus);
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    const { result } = renderHook(() => useUpdater({ autoLoad: false }));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.availableUpdate).toEqual(unsignedUpdate);
    expect(result.current.isRestartRequired).toBe(true);
    expect(result.current.canInstall).toBe(false);
    expect(result.current.canInstallUnsigned).toBe(false);
    expect(result.current.canRelaunch).toBe(true);
  });

  it("keeps signed installation blocked for an unsigned release and requires explicit risk acknowledgement", async () => {
    const unsignedUpdate: AvailableUpdate = {
      ...update,
      signaturePresent: false,
    };
    const unsignedStatus: UpdaterStatusSnapshot = {
      ...availableStatus,
      availableUpdate: unsignedUpdate,
    };
    const unsignedInstallingStatus: UpdaterStatusSnapshot = {
      ...unsignedStatus,
      status: "installing",
    };
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(settings);
        case "updater_get_status":
          return Promise.resolve(idleStatus);
        case "updater_check":
          return Promise.resolve({
            updateAvailable: true,
            availableUpdate: unsignedUpdate,
            status: unsignedStatus,
          });
        case "updater_install_unsigned":
          return Promise.resolve(unsignedInstallingStatus);
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    const { result } = renderHook(() => useUpdater({ autoLoad: false }));
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.canCheck).toBe(true));
    await act(async () => {
      await result.current.check(true);
    });

    expect(result.current.availableUpdate).toEqual(unsignedUpdate);
    expect(result.current.updateAvailable).toBe(true);
    expect(result.current.updateInfo?.checksum).toBe("");
    expect(result.current.canInstall).toBe(false);
    expect(result.current.canInstallUnsigned).toBe(true);

    await act(async () => {
      expect(await result.current.install("1.6.0")).toBeNull();
    });

    expect(result.current.lastError).toContain("no updater signature");
    expect(result.current.lastError).toContain("unsigned install action");

    await act(async () => {
      expect(await result.current.installUnsigned("1.6.0", false)).toBeNull();
    });
    expect(result.current.lastError).toContain(
      "understand the unsigned update risk",
    );
    const commandNames = mockInvoke.mock.calls.map(([cmd]) => cmd);
    expect(commandNames).not.toContain("updater_download_and_install");
    expect(commandNames).not.toContain("updater_install_unsigned");

    await act(async () => {
      expect(await result.current.installUnsigned("1.6.0", true)).toEqual(
        unsignedInstallingStatus,
      );
    });

    expect(mockInvoke).toHaveBeenCalledWith("updater_install_unsigned", {
      version: "1.6.0",
      acknowledgedRisk: true,
      proxyUrl: null,
    });
    expect(result.current.isInstalling).toBe(true);
    expect(result.current.canInstallUnsigned).toBe(false);
  });

  it("surfaces structured native unsigned-install rejection details", async () => {
    const unsignedUpdate: AvailableUpdate = {
      ...update,
      signaturePresent: false,
    };
    const unsignedStatus: UpdaterStatusSnapshot = {
      ...availableStatus,
      availableUpdate: unsignedUpdate,
    };
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(settings);
        case "updater_get_status":
          return Promise.resolve(unsignedStatus);
        case "updater_install_unsigned":
          return Promise.reject({
            message: "The downloaded installer could not be launched",
            code: "unsigned_installer_launch_failed",
          });
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    const { result } = renderHook(() => useUpdater({ autoLoad: false }));
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.canInstallUnsigned).toBe(true));

    await act(async () => {
      expect(
        await result.current.installUnsigned(unsignedUpdate.version, true),
      ).toBeNull();
    });

    expect(result.current.lastError).toBe(
      "The downloaded installer could not be launched (unsigned_installer_launch_failed)",
    );
    expect(mockInvoke).toHaveBeenCalledWith("updater_install_unsigned", {
      version: unsignedUpdate.version,
      acknowledgedRisk: true,
      proxyUrl: null,
    });
  });

  it.each([
    [
      "a private host",
      "https://updates.example.com/supermarsx/sortOfRemoteNG/releases/download/1.6/update.msi",
    ],
    [
      "a different repository",
      "https://github.com/other/sortOfRemoteNG/releases/download/1.6/update.msi",
    ],
    [
      "URL credentials",
      "https://user@github.com/supermarsx/sortOfRemoteNG/releases/download/1.6/update.msi",
    ],
    [
      "a nonstandard port",
      "https://github.com:444/supermarsx/sortOfRemoteNG/releases/download/1.6/update.msi",
    ],
    [
      "a query string",
      "https://github.com/supermarsx/sortOfRemoteNG/releases/download/1.6/update.msi?download=1",
    ],
    [
      "a fragment",
      "https://github.com/supermarsx/sortOfRemoteNG/releases/download/1.6/update.msi#artifact",
    ],
  ])(
    "does not offer unsigned installation for %s",
    async (_label, downloadUrl) => {
      const unsignedUpdate: AvailableUpdate = {
        ...update,
        downloadUrl,
        signaturePresent: false,
      };
      const unsignedStatus: UpdaterStatusSnapshot = {
        ...availableStatus,
        endpointSource: "private_then_public",
        availableUpdate: unsignedUpdate,
      };
      mockInvoke.mockImplementation((cmd: string) => {
        switch (cmd) {
          case "updater_get_settings":
            return Promise.resolve(settings);
          case "updater_get_status":
            return Promise.resolve(unsignedStatus);
          default:
            return Promise.reject(new Error(`unexpected command ${cmd}`));
        }
      });

      const { result } = renderHook(() => useUpdater({ autoLoad: false }));
      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.availableUpdate).toEqual(unsignedUpdate);
      expect(result.current.updateAvailable).toBe(true);
      expect(result.current.canInstall).toBe(false);
      expect(result.current.canInstallUnsigned).toBe(false);
    },
  );

  it("fails closed when check or install is called before capability loading", async () => {
    const { result } = renderHook(() => useUpdater({ autoLoad: false }));

    await act(async () => {
      expect(await result.current.check(true)).toBeNull();
      expect(await result.current.install("1.6.0")).toBeNull();
      expect(await result.current.installUnsigned("1.6.0", true)).toBeNull();
    });

    expect(result.current.lastError).toContain(
      "Updater capability is still loading",
    );
    const commandNames = mockInvoke.mock.calls.map(([cmd]) => cmd);
    expect(commandNames).not.toContain("updater_check");
    expect(commandNames).not.toContain("updater_download_and_install");
    expect(commandNames).not.toContain("updater_install_unsigned");
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
      expect(await result.current.installUnsigned("1.6.0", true)).toBeNull();
    });

    expect(result.current.lastError).toBe(message);
    const commandNames = mockInvoke.mock.calls.map(([cmd]) => cmd);
    expect(commandNames).not.toContain("updater_check");
    expect(commandNames).not.toContain("updater_download_and_install");
    expect(commandNames).not.toContain("updater_install_unsigned");
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
      proxyUrl: null,
    });
  });

  it("reschedules auto-check after transient settings or status IPC failures", async () => {
    vi.useFakeTimers();
    const getSettings = vi
      .spyOn(updaterApi, "getSettings")
      .mockRejectedValueOnce(new Error("settings IPC unavailable"))
      .mockRejectedValueOnce(new Error("settings IPC unavailable"))
      .mockResolvedValue(settings);
    const getStatus = vi
      .spyOn(updaterApi, "getStatus")
      .mockRejectedValueOnce(new Error("status IPC unavailable"))
      .mockResolvedValue(idleStatus);
    const check = vi.spyOn(updaterApi, "check").mockResolvedValue({
      updateAvailable: true,
      availableUpdate: update,
      status: availableStatus,
    });

    const { result, unmount } = renderHook(() =>
      useUpdaterAutoCheck({ startDelayMs: 0, minIntervalMs: 0 }),
    );

    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
        await vi.waitFor(() => {
          expect(getStatus).toHaveBeenCalledTimes(1);
          expect(vi.getTimerCount()).toBe(1);
        });
      });

      expect(result.current.error).toBe("settings IPC unavailable");
      expect(check).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      expect(getSettings).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersToNextTimerAsync();
        await vi.waitFor(() => expect(check).toHaveBeenCalledWith(false));
      });

      expect(result.current.error).toBeNull();
      expect(result.current.lastResult?.availableUpdate?.version).toBe("1.6.0");
    } finally {
      unmount();
      getSettings.mockRestore();
      getStatus.mockRestore();
      check.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
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
