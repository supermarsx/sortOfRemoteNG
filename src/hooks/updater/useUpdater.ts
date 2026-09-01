import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AvailableUpdate,
  ReleaseNotes,
  RollbackInfo,
  UpdateChannel,
  UpdateHistoryEntry,
  UpdateInfo,
  UpdateProgress,
  UpdaterCheckResult,
  UpdaterConfig,
  UpdaterInstallMode,
  UpdaterSettings,
  UpdaterSettingsPatch,
  UpdaterStatusSnapshot,
  VersionInfo,
} from "../../types/updater/updater";
import { getGlobalHttpProxyUrl } from "../integration/httpProxy";
import { SettingsManager } from "../../utils/settings/settingsManager";

type InvokeArgs = Record<string, unknown>;

let sharedCheckPromise: Promise<UpdaterCheckResult> | null = null;
const SELF_UPDATE_CAPABILITY_LOADING_MESSAGE =
  "Updater capability is still loading. Wait for package compatibility checks to finish and try again.";
const SELF_UPDATE_UNSUPPORTED_FALLBACK =
  "This installation cannot be safely updated in the app.";
const UNSIGNED_UPDATE_INSTALL_MESSAGE =
  "This release has no updater signature. Use the separate unsigned install action only after reviewing and accepting the warning.";
const UNSIGNED_UPDATE_ACKNOWLEDGEMENT_MESSAGE =
  "Confirm that you understand the unsigned update risk before installing.";
const SIGNED_UPDATE_INSTALL_MESSAGE =
  "This update has a valid updater signature. Use the verified download and install action.";
const OFFICIAL_RELEASE_DOWNLOAD_HOST = "github.com";
const OFFICIAL_RELEASE_DOWNLOAD_PATH = [
  "supermarsx",
  "sortOfRemoteNG",
  "releases",
  "download",
] as const;
const SAFE_RELEASE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;
const INSTALL_STATUS_POLL_INTERVAL_MS = 500;
export const UPDATER_SETTINGS_CHANGED_EVENT = "sorng-updater-settings-changed";

function getUpdaterProxyUrl(): string | null {
  const globalProxy =
    SettingsManager.getInstance().getSettings().globalProxy ?? null;
  if (!globalProxy?.enabled) return null;

  const proxyUrl = getGlobalHttpProxyUrl();
  if (!proxyUrl) {
    throw new Error(
      "Updater network access was blocked because the enabled global proxy is not a valid HTTP or HTTPS proxy.",
    );
  }
  return proxyUrl;
}

async function invokeUpdater<T>(
  command: string,
  args?: InvokeArgs,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function startUpdaterCapabilityRequests(): Promise<{
  settings: Promise<UpdaterSettings>;
  status: Promise<UpdaterStatusSnapshot>;
}> {
  const { invoke } = await import("@tauri-apps/api/core");
  const settings = invoke<UpdaterSettings>("updater_get_settings", undefined);
  const status = invoke<UpdaterStatusSnapshot>("updater_get_status", undefined);
  return { settings, status };
}

function runSharedCheck(force = false): Promise<UpdaterCheckResult> {
  if (sharedCheckPromise) return sharedCheckPromise;
  sharedCheckPromise = invokeUpdater<UpdaterCheckResult>("updater_check", {
    force,
    proxyUrl: getUpdaterProxyUrl(),
  }).finally(() => {
    sharedCheckPromise = null;
  });
  return sharedCheckPromise;
}

export const updaterApi = {
  getSettings: () => invokeUpdater<UpdaterSettings>("updater_get_settings"),
  saveSettings: (patch: UpdaterSettingsPatch) =>
    invokeUpdater<UpdaterSettings>("updater_save_settings", { patch }),
  getStatus: () => invokeUpdater<UpdaterStatusSnapshot>("updater_get_status"),
  check: runSharedCheck,
  downloadAndInstall: (version?: string) =>
    invokeUpdater<UpdaterStatusSnapshot>("updater_download_and_install", {
      version: version ?? null,
      proxyUrl: getUpdaterProxyUrl(),
    }),
  installUnsigned: (version?: string, acknowledgedRisk = false) =>
    invokeUpdater<UpdaterStatusSnapshot>("updater_install_unsigned", {
      version: version ?? null,
      acknowledgedRisk,
      proxyUrl: getUpdaterProxyUrl(),
    }),
  relaunch: () => invokeUpdater<void>("updater_relaunch"),
};

export interface UseUpdaterOptions {
  autoLoad?: boolean;
}

export interface UseUpdaterResult {
  settings: UpdaterSettings | null;
  status: UpdaterStatusSnapshot | null;
  installMode: UpdaterInstallMode | null;
  selfUpdateSupported: boolean;
  selfUpdateMessage: string | null;
  checkResult: UpdaterCheckResult | null;
  availableUpdate: AvailableUpdate | null;
  loadingSettings: boolean;
  loadingStatus: boolean;
  savingSettings: boolean;
  checking: boolean;
  downloading: boolean;
  installing: boolean;
  relaunching: boolean;
  error: string | null;
  lastError: string | null;
  isLoading: boolean;
  isBusy: boolean;
  updateAvailable: boolean;
  isChecking: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
  isRestartRequired: boolean;
  isUpToDate: boolean;
  canCheck: boolean;
  canInstall: boolean;
  canInstallUnsigned: boolean;
  canRelaunch: boolean;
  progressPercent: number | null;
  currentVersion: string | null;
  lastCheckedAt: string | null;
  refreshSettings: () => Promise<UpdaterSettings | null>;
  refreshStatus: () => Promise<UpdaterStatusSnapshot | null>;
  refresh: () => Promise<void>;
  saveSettings: (
    patch: UpdaterSettingsPatch,
  ) => Promise<UpdaterSettings | null>;
  check: (force?: boolean) => Promise<UpdaterCheckResult | null>;
  install: (version?: string) => Promise<UpdaterStatusSnapshot | null>;
  installUnsigned: (
    version: string | undefined,
    acknowledgedRisk: boolean,
  ) => Promise<UpdaterStatusSnapshot | null>;
  relaunch: () => Promise<boolean>;
  clearError: () => void;

  updateInfo: UpdateInfo | null;
  progress: UpdateProgress | null;
  versionInfo: VersionInfo | null;
  history: UpdateHistoryEntry[];
  rollbacks: RollbackInfo[];
  releaseNotes: ReleaseNotes | null;
  config: UpdaterConfig | null;
  checkForUpdates: () => Promise<UpdateInfo | null>;
  download: () => Promise<UpdaterStatusSnapshot | null>;
  cancelDownload: () => Promise<boolean>;
  scheduleInstall: (delayMs: number) => Promise<UpdaterStatusSnapshot | null>;
  setChannel: (channel: UpdateChannel) => Promise<boolean>;
  fetchVersionInfo: () => Promise<VersionInfo | null>;
  fetchHistory: () => Promise<UpdateHistoryEntry[]>;
  rollback: (version: string) => Promise<boolean>;
  fetchRollbacks: () => Promise<RollbackInfo[]>;
  fetchReleaseNotes: (version?: string) => Promise<ReleaseNotes | null>;
  loadConfig: () => Promise<UpdaterConfig | null>;
  updateConfig: (
    config: Partial<UpdaterConfig>,
  ) => Promise<UpdaterConfig | null>;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const structured = error as Record<string, unknown>;
    const message =
      typeof structured.message === "string" ? structured.message.trim() : "";
    const rawCode = structured.code;
    const code =
      typeof rawCode === "string" || typeof rawCode === "number"
        ? String(rawCode).trim()
        : "";

    if (message && code) return `${message} (${code})`;
    if (message) return message;
    if (code) return `Updater command failed (${code})`;
  }
  return "Updater command failed";
}

function isOfficialUnsignedArtifactUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== OFFICIAL_RELEASE_DOWNLOAD_HOST ||
      (parsed.port !== "" && parsed.port !== "443") ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return false;
    }

    const segments = parsed.pathname.split("/");
    if (
      segments.length !== 7 ||
      segments[0] !== "" ||
      !OFFICIAL_RELEASE_DOWNLOAD_PATH.every(
        (segment, index) => segments[index + 1] === segment,
      )
    ) {
      return false;
    }

    return segments
      .slice(5)
      .every((segment) => SAFE_RELEASE_PATH_SEGMENT.test(segment));
  } catch {
    return false;
  }
}

function waitForInstallStatusPoll(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (shouldPoll: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", handleAbort);
      resolve(shouldPoll);
    };
    const handleAbort = () => finish(false);
    const timeout = setTimeout(
      () => finish(true),
      INSTALL_STATUS_POLL_INTERVAL_MS,
    );

    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });
}

function clampIntervalHours(value: number): number {
  if (!Number.isFinite(value)) return 24;
  return Math.max(1, Math.round(value));
}

function settingsToLegacyConfig(
  settings: UpdaterSettings | null,
): UpdaterConfig | null {
  if (!settings) return null;
  return {
    ...settings,
    enabled: settings.selfUpdateSupported,
    channel: "stable",
    autoCheck: settings.selfUpdateSupported && settings.autoCheckEnabled,
    autoDownload: false,
    autoInstall: false,
    checkIntervalMs: settings.checkIntervalHours * 60 * 60 * 1000,
    notifyOnUpdate: true,
    installOnExit: false,
    keepRollbackCount: 0,
    customUpdateUrl: settings.privateEndpointUrl,
    preReleaseOptIn: false,
  };
}

function legacyConfigPatchToSettingsPatch(
  config: Partial<UpdaterConfig>,
): UpdaterSettingsPatch {
  const patch: UpdaterSettingsPatch = {};
  if (typeof config.autoCheck === "boolean") {
    patch.autoCheckEnabled = config.autoCheck;
  }
  if (typeof config.autoCheckEnabled === "boolean") {
    patch.autoCheckEnabled = config.autoCheckEnabled;
  }
  if (typeof config.checkIntervalMs === "number") {
    patch.checkIntervalHours = clampIntervalHours(
      config.checkIntervalMs / (60 * 60 * 1000),
    );
  }
  if (typeof config.checkIntervalHours === "number") {
    patch.checkIntervalHours = clampIntervalHours(config.checkIntervalHours);
  }
  if (typeof config.privateEndpointEnabled === "boolean") {
    patch.privateEndpointEnabled = config.privateEndpointEnabled;
  }
  if (Object.prototype.hasOwnProperty.call(config, "customUpdateUrl")) {
    const value = config.customUpdateUrl?.trim() ?? "";
    patch.privateEndpointUrl = value;
    patch.privateEndpointEnabled = value.length > 0;
  }
  if (Object.prototype.hasOwnProperty.call(config, "privateEndpointUrl")) {
    patch.privateEndpointUrl = config.privateEndpointUrl?.trim() ?? "";
  }
  return patch;
}

function availableUpdateToLegacy(
  update: AvailableUpdate | null,
): UpdateInfo | null {
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    channel: "stable",
    releaseDate: update.date ?? "",
    releaseNotes: update.body ?? "",
    downloadUrl: update.downloadUrl,
    fileSize: 0,
    checksum: update.signaturePresent ? "signed" : "",
    mandatory: false,
    minCurrentVersion: null,
  };
}

function statusToLegacyProgress(
  status: UpdaterStatusSnapshot | null,
): UpdateProgress | null {
  if (!status) return null;
  const totalBytes = status.totalBytes ?? 0;
  const percent =
    status.progressPercent ?? (status.status === "restart_required" ? 100 : 0);
  return {
    status: status.status === "restart_required" ? "ready" : status.status,
    downloadedBytes: status.downloadedBytes,
    totalBytes,
    percent,
    speedBps: 0,
    etaSeconds: 0,
    errorMessage: status.lastError,
  };
}

function statusToVersionInfo(
  status: UpdaterStatusSnapshot | null,
): VersionInfo | null {
  if (!status) return null;
  return {
    currentVersion: status.currentVersion,
    buildDate: "",
    commitHash: "",
    channel: "stable",
    rustVersion: "",
    tauriVersion: "",
    osInfo: "",
  };
}

function updateToReleaseNotes(
  update: AvailableUpdate | null,
  requestedVersion?: string,
): ReleaseNotes | null {
  if (!update && !requestedVersion) return null;
  const body = update?.body?.trim();
  return {
    version: update?.version ?? requestedVersion ?? "",
    channel: "stable",
    date: update?.date ?? "",
    highlights: body ? [body] : [],
    changes: [],
    breakingChanges: [],
    knownIssues: [],
  };
}

export function useUpdater(options: UseUpdaterOptions = {}): UseUpdaterResult {
  const { autoLoad = true } = options;
  const mountedRef = useRef(false);
  const installPollControllerRef = useRef<AbortController | null>(null);
  const [settings, setSettings] = useState<UpdaterSettings | null>(null);
  const [status, setStatus] = useState<UpdaterStatusSnapshot | null>(null);
  const [checkResult, setCheckResult] = useState<UpdaterCheckResult | null>(
    null,
  );
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNotes | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [settingsCapabilityLoaded, setSettingsCapabilityLoaded] =
    useState(false);
  const [statusCapabilityLoaded, setStatusCapabilityLoaded] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [checkingAction, setCheckingAction] = useState(false);
  const [installingAction, setInstallingAction] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsRefreshError, setSettingsRefreshError] = useState<
    string | null
  >(null);
  const [statusRefreshError, setStatusRefreshError] = useState<string | null>(
    null,
  );
  const installMode = status?.installMode ?? settings?.installMode ?? null;
  const selfUpdateSupported = !(
    status?.selfUpdateSupported === false ||
    settings?.selfUpdateSupported === false
  );
  const selfUpdateCapabilityLoaded =
    settingsCapabilityLoaded && statusCapabilityLoaded;
  const selfUpdateAllowed =
    selfUpdateCapabilityLoaded &&
    settings?.selfUpdateSupported === true &&
    status?.selfUpdateSupported === true;
  const selfUpdateMessage =
    status?.selfUpdateMessage ?? settings?.selfUpdateMessage ?? null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      installPollControllerRef.current?.abort();
      installPollControllerRef.current = null;
    };
  }, []);

  const pollInstallStatus = useCallback(async (signal: AbortSignal) => {
    while (await waitForInstallStatusPoll(signal)) {
      if (signal.aborted || !mountedRef.current) return;
      try {
        const nextStatus = await updaterApi.getStatus();
        if (signal.aborted || !mountedRef.current) return;
        setStatus(nextStatus);
        setStatusCapabilityLoaded(true);
      } catch {
        // Polling is best-effort progress telemetry. The install command owns
        // the terminal result and error shown to the user.
      }
    }
  }, []);

  const runWithInstallStatusPolling = useCallback(
    async (
      request: () => Promise<UpdaterStatusSnapshot>,
    ): Promise<UpdaterStatusSnapshot> => {
      installPollControllerRef.current?.abort();
      const controller = new AbortController();
      installPollControllerRef.current = controller;
      void pollInstallStatus(controller.signal).catch(() => undefined);

      try {
        return await request();
      } finally {
        controller.abort();
        if (installPollControllerRef.current === controller) {
          installPollControllerRef.current = null;
        }
      }
    },
    [pollInstallStatus],
  );

  const clearError = useCallback(() => {
    setError(null);
    setSettingsRefreshError(null);
    setStatusRefreshError(null);
  }, []);

  const refreshSettings =
    useCallback(async (): Promise<UpdaterSettings | null> => {
      setLoadingSettings(true);
      try {
        const nextSettings = await updaterApi.getSettings();
        if (mountedRef.current) {
          setSettings(nextSettings);
          setSettingsCapabilityLoaded(true);
          setSettingsRefreshError(null);
        }
        return nextSettings;
      } catch (caught) {
        const message = toErrorMessage(caught);
        if (mountedRef.current) {
          setSettingsRefreshError(`Updater settings: ${message}`);
        }
        return null;
      } finally {
        if (mountedRef.current) setLoadingSettings(false);
      }
    }, []);

  const refreshStatus =
    useCallback(async (): Promise<UpdaterStatusSnapshot | null> => {
      setLoadingStatus(true);
      try {
        const nextStatus = await updaterApi.getStatus();
        if (mountedRef.current) {
          setStatus(nextStatus);
          setStatusCapabilityLoaded(true);
          setStatusRefreshError(null);
        }
        return nextStatus;
      } catch (caught) {
        const message = toErrorMessage(caught);
        if (mountedRef.current) {
          setStatusRefreshError(`Updater status: ${message}`);
        }
        return null;
      } finally {
        if (mountedRef.current) setLoadingStatus(false);
      }
    }, []);

  const refresh = useCallback(async () => {
    setLoadingSettings(true);
    setLoadingStatus(true);
    setError(null);

    let requests: Awaited<ReturnType<typeof startUpdaterCapabilityRequests>>;
    try {
      requests = await startUpdaterCapabilityRequests();
    } catch (caught) {
      const message = toErrorMessage(caught);
      if (mountedRef.current) {
        setSettingsRefreshError(`Updater settings: ${message}`);
        setStatusRefreshError(`Updater status: ${message}`);
        setLoadingSettings(false);
        setLoadingStatus(false);
      }
      return;
    }

    const settingsTask = requests.settings
      .then((nextSettings) => {
        if (mountedRef.current) {
          setSettings(nextSettings);
          setSettingsCapabilityLoaded(true);
          setSettingsRefreshError(null);
        }
      })
      .catch((caught) => {
        if (mountedRef.current) {
          setSettingsRefreshError(
            `Updater settings: ${toErrorMessage(caught)}`,
          );
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoadingSettings(false);
      });

    const statusTask = requests.status
      .then((nextStatus) => {
        if (mountedRef.current) {
          setStatus(nextStatus);
          setStatusCapabilityLoaded(true);
          setStatusRefreshError(null);
        }
      })
      .catch((caught) => {
        if (mountedRef.current) {
          setStatusRefreshError(`Updater status: ${toErrorMessage(caught)}`);
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoadingStatus(false);
      });

    await Promise.all([settingsTask, statusTask]);
  }, []);

  const saveSettings = useCallback(
    async (patch: UpdaterSettingsPatch): Promise<UpdaterSettings | null> => {
      setSavingSettings(true);
      setError(null);
      try {
        const nextSettings = await updaterApi.saveSettings(patch);
        if (mountedRef.current) {
          setSettings(nextSettings);
          setSettingsCapabilityLoaded(true);
          setSettingsRefreshError(null);
        }
        window.dispatchEvent(
          new CustomEvent<UpdaterSettings>(UPDATER_SETTINGS_CHANGED_EVENT, {
            detail: nextSettings,
          }),
        );
        const nextStatus = await updaterApi.getStatus();
        if (mountedRef.current) {
          setStatus(nextStatus);
          setStatusCapabilityLoaded(true);
          setStatusRefreshError(null);
        }
        return nextSettings;
      } catch (caught) {
        const message = toErrorMessage(caught);
        if (mountedRef.current) setError(message);
        return null;
      } finally {
        if (mountedRef.current) setSavingSettings(false);
      }
    },
    [],
  );

  const check = useCallback(
    async (force = false): Promise<UpdaterCheckResult | null> => {
      if (!selfUpdateCapabilityLoaded) {
        setError(SELF_UPDATE_CAPABILITY_LOADING_MESSAGE);
        return null;
      }
      if (!selfUpdateAllowed) {
        setError(selfUpdateMessage ?? SELF_UPDATE_UNSUPPORTED_FALLBACK);
        return null;
      }
      setCheckingAction(true);
      setError(null);
      try {
        const result = await updaterApi.check(force);
        if (mountedRef.current) {
          setCheckResult(result);
          setStatus(result.status);
          setStatusCapabilityLoaded(true);
          setReleaseNotes(updateToReleaseNotes(result.availableUpdate));
        }
        return result;
      } catch (caught) {
        const message = toErrorMessage(caught);
        if (mountedRef.current) {
          setError(message);
          await refreshStatus();
        }
        return null;
      } finally {
        if (mountedRef.current) setCheckingAction(false);
      }
    },
    [
      refreshStatus,
      selfUpdateAllowed,
      selfUpdateCapabilityLoaded,
      selfUpdateMessage,
    ],
  );

  const relaunch = useCallback(async (): Promise<boolean> => {
    setRelaunching(true);
    setError(null);
    try {
      await updaterApi.relaunch();
      return true;
    } catch (caught) {
      const message = toErrorMessage(caught);
      if (mountedRef.current) setError(message);
      return false;
    } finally {
      if (mountedRef.current) setRelaunching(false);
    }
  }, []);

  const install = useCallback(
    async (version?: string): Promise<UpdaterStatusSnapshot | null> => {
      if (!selfUpdateCapabilityLoaded) {
        setError(SELF_UPDATE_CAPABILITY_LOADING_MESSAGE);
        return null;
      }
      if (!selfUpdateAllowed) {
        setError(selfUpdateMessage ?? SELF_UPDATE_UNSUPPORTED_FALLBACK);
        return null;
      }
      const discoveredUpdate =
        status?.availableUpdate ?? checkResult?.availableUpdate ?? null;
      if (discoveredUpdate && !discoveredUpdate.signaturePresent) {
        setError(UNSIGNED_UPDATE_INSTALL_MESSAGE);
        return null;
      }
      if (status?.status === "restart_required") {
        await relaunch();
        return status;
      }
      setInstallingAction(true);
      setError(null);
      try {
        const nextStatus = await runWithInstallStatusPolling(() =>
          updaterApi.downloadAndInstall(version),
        );
        if (mountedRef.current) {
          setStatus(nextStatus);
          setStatusCapabilityLoaded(true);
        }
        return nextStatus;
      } catch (caught) {
        const message = toErrorMessage(caught);
        if (mountedRef.current) {
          setError(message);
          await refreshStatus();
        }
        return null;
      } finally {
        if (mountedRef.current) setInstallingAction(false);
      }
    },
    [
      refreshStatus,
      relaunch,
      runWithInstallStatusPolling,
      checkResult?.availableUpdate,
      selfUpdateAllowed,
      selfUpdateCapabilityLoaded,
      selfUpdateMessage,
      status,
    ],
  );

  const installUnsigned = useCallback(
    async (
      version: string | undefined,
      acknowledgedRisk: boolean,
    ): Promise<UpdaterStatusSnapshot | null> => {
      if (!selfUpdateCapabilityLoaded) {
        setError(SELF_UPDATE_CAPABILITY_LOADING_MESSAGE);
        return null;
      }
      if (!selfUpdateAllowed) {
        setError(selfUpdateMessage ?? SELF_UPDATE_UNSUPPORTED_FALLBACK);
        return null;
      }
      if (!acknowledgedRisk) {
        setError(UNSIGNED_UPDATE_ACKNOWLEDGEMENT_MESSAGE);
        return null;
      }

      const discoveredUpdate =
        status?.availableUpdate ?? checkResult?.availableUpdate ?? null;
      if (!discoveredUpdate) {
        setError("No unsigned update is available to install.");
        return null;
      }
      if (discoveredUpdate.signaturePresent) {
        setError(SIGNED_UPDATE_INSTALL_MESSAGE);
        return null;
      }

      setInstallingAction(true);
      setError(null);
      try {
        const nextStatus = await runWithInstallStatusPolling(() =>
          updaterApi.installUnsigned(version, true),
        );
        if (mountedRef.current) {
          setStatus(nextStatus);
          setStatusCapabilityLoaded(true);
        }
        return nextStatus;
      } catch (caught) {
        const message = toErrorMessage(caught);
        if (mountedRef.current) {
          setError(message);
          await refreshStatus();
        }
        return null;
      } finally {
        if (mountedRef.current) setInstallingAction(false);
      }
    },
    [
      checkResult?.availableUpdate,
      refreshStatus,
      runWithInstallStatusPolling,
      selfUpdateAllowed,
      selfUpdateCapabilityLoaded,
      selfUpdateMessage,
      status?.availableUpdate,
    ],
  );

  useEffect(() => {
    if (!autoLoad) return;
    void refresh();
  }, [autoLoad, refresh]);

  const availableUpdate =
    status?.availableUpdate ?? checkResult?.availableUpdate ?? null;
  const updateInfo = useMemo(
    () => availableUpdateToLegacy(availableUpdate),
    [availableUpdate],
  );
  const progress = useMemo(() => statusToLegacyProgress(status), [status]);
  const versionInfo = useMemo(() => statusToVersionInfo(status), [status]);
  const config = useMemo(() => settingsToLegacyConfig(settings), [settings]);
  const progressPercent = status?.progressPercent ?? null;
  const capabilityRefreshError =
    [settingsRefreshError, statusRefreshError].filter(Boolean).join(" ") ||
    null;
  const lastError =
    error ??
    capabilityRefreshError ??
    status?.lastError ??
    status?.privateEndpointValidationError ??
    settings?.privateEndpointValidationError ??
    null;
  const isChecking = checkingAction || status?.status === "checking";
  const isDownloading = status?.status === "downloading";
  const isInstalling = installingAction || status?.status === "installing";
  const isRestartRequired = status?.status === "restart_required";
  const isUpToDate = status?.status === "up_to_date";
  const updateAvailable =
    Boolean(availableUpdate) || status?.status === "available";
  const isLoading = loadingSettings || loadingStatus;
  const isBusy =
    isChecking ||
    isDownloading ||
    isInstalling ||
    savingSettings ||
    relaunching;
  const canCheck = selfUpdateAllowed && !isBusy;
  const canInstall =
    selfUpdateAllowed &&
    updateAvailable &&
    availableUpdate?.signaturePresent === true &&
    !isRestartRequired &&
    !isBusy;
  const canInstallUnsigned =
    selfUpdateAllowed &&
    updateAvailable &&
    availableUpdate?.signaturePresent === false &&
    isOfficialUnsignedArtifactUrl(availableUpdate.downloadUrl) &&
    !isRestartRequired &&
    !isBusy;
  const canRelaunch = isRestartRequired && !relaunching;

  const checkForUpdates = useCallback(async (): Promise<UpdateInfo | null> => {
    const result = await check(true);
    return availableUpdateToLegacy(result?.availableUpdate ?? null);
  }, [check]);

  const download = useCallback(
    () => install(availableUpdate?.version),
    [availableUpdate?.version, install],
  );

  const cancelDownload = useCallback(async (): Promise<boolean> => {
    setError(
      "Cancelling a signed updater download is not supported by the backend updater contract.",
    );
    return false;
  }, []);

  const scheduleInstall = useCallback(
    async (delayMs: number): Promise<UpdaterStatusSnapshot | null> => {
      if (delayMs > 0) {
        setError(
          "Scheduled updater installation is retired. Use the signed install action when ready.",
        );
        return null;
      }
      return install(availableUpdate?.version);
    },
    [availableUpdate?.version, install],
  );

  const setChannel = useCallback(
    async (_channel: UpdateChannel): Promise<boolean> => {
      setError("Update channels are not part of the signed updater P1 flow.");
      return false;
    },
    [],
  );

  const fetchVersionInfo =
    useCallback(async (): Promise<VersionInfo | null> => {
      const nextStatus = await refreshStatus();
      return statusToVersionInfo(nextStatus ?? status);
    }, [refreshStatus, status]);

  const fetchHistory = useCallback(
    async (): Promise<UpdateHistoryEntry[]> => [],
    [],
  );

  const rollback = useCallback(async (_version: string): Promise<boolean> => {
    setError("Rollback is not available in the signed updater P1 flow.");
    return false;
  }, []);

  const fetchRollbacks = useCallback(
    async (): Promise<RollbackInfo[]> => [],
    [],
  );

  const fetchReleaseNotes = useCallback(
    async (version?: string): Promise<ReleaseNotes | null> => {
      const notes = updateToReleaseNotes(availableUpdate, version);
      setReleaseNotes(notes);
      return notes;
    },
    [availableUpdate],
  );

  const loadConfig = useCallback(async (): Promise<UpdaterConfig | null> => {
    const nextSettings = await refreshSettings();
    return settingsToLegacyConfig(nextSettings ?? settings);
  }, [refreshSettings, settings]);

  const updateConfig = useCallback(
    async (
      nextConfig: Partial<UpdaterConfig>,
    ): Promise<UpdaterConfig | null> => {
      const patch = legacyConfigPatchToSettingsPatch(nextConfig);
      if (Object.keys(patch).length === 0)
        return settingsToLegacyConfig(settings);
      const nextSettings = await saveSettings(patch);
      return settingsToLegacyConfig(nextSettings ?? settings);
    },
    [saveSettings, settings],
  );

  return {
    settings,
    status,
    installMode,
    selfUpdateSupported,
    selfUpdateMessage,
    checkResult,
    availableUpdate,
    loadingSettings,
    loadingStatus,
    savingSettings,
    checking: isChecking,
    downloading: isDownloading || isInstalling,
    installing: isInstalling,
    relaunching,
    error: lastError,
    lastError,
    isLoading,
    isBusy,
    updateAvailable,
    isChecking,
    isDownloading,
    isInstalling,
    isRestartRequired,
    isUpToDate,
    canCheck,
    canInstall,
    canInstallUnsigned,
    canRelaunch,
    progressPercent,
    currentVersion: status?.currentVersion ?? null,
    lastCheckedAt: status?.lastCheckedAt ?? null,
    refreshSettings,
    refreshStatus,
    refresh,
    saveSettings,
    check,
    install,
    installUnsigned,
    relaunch,
    clearError,
    updateInfo,
    progress,
    versionInfo,
    history: [],
    rollbacks: [],
    releaseNotes,
    config,
    checkForUpdates,
    download,
    cancelDownload,
    scheduleInstall,
    setChannel,
    fetchVersionInfo,
    fetchHistory,
    rollback,
    fetchRollbacks,
    fetchReleaseNotes,
    loadConfig,
    updateConfig,
  };
}
