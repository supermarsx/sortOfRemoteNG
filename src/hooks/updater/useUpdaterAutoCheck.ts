import { useCallback, useEffect, useRef, useState } from "react";
import type {
  UpdaterCheckResult,
  UpdaterSettings,
  UpdaterStatusSnapshot,
} from "../../types/updater/updater";
import {
  boundedUpdaterTimerDelay,
  checkIntervalMilliseconds,
  HOUR_MS,
  millisecondsUntilNextCheck,
} from "../../utils/updater/checkSchedule";
import { UPDATER_SETTINGS_CHANGED_EVENT, updaterApi } from "./useUpdater";

const STRICT_MODE_DUPLICATE_WINDOW_MS = 30_000;

let sharedAutoCheckPromise: Promise<UpdaterCheckResult | null> | null = null;
let lastAutoCheckStartedAt = 0;

export interface UseUpdaterAutoCheckOptions {
  enabled?: boolean;
  startDelayMs?: number;
  minIntervalMs?: number;
  onResult?: (result: UpdaterCheckResult) => void;
  onError?: (message: string) => void;
}

export interface UseUpdaterAutoCheckResult {
  settings: UpdaterSettings | null;
  status: UpdaterStatusSnapshot | null;
  lastResult: UpdaterCheckResult | null;
  checking: boolean;
  error: string | null;
  lastCheckedAt: string | null;
  refresh: () => Promise<void>;
  runNow: () => Promise<UpdaterCheckResult | null>;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Updater auto-check failed";
}

function intervalMsFor(
  settings: UpdaterSettings,
  minIntervalMs: number,
): number {
  return checkIntervalMilliseconds(settings.checkIntervalHours, minIntervalMs);
}

function isDue(
  status: UpdaterStatusSnapshot | null,
  intervalMs: number,
): boolean {
  if (!status?.lastCheckedAt) return true;
  const lastCheckedAt = Date.parse(status.lastCheckedAt);
  if (!Number.isFinite(lastCheckedAt)) return true;
  return Date.now() - lastCheckedAt >= intervalMs;
}

function isUpdaterBusy(status: UpdaterStatusSnapshot | null): boolean {
  return (
    status?.status === "checking" ||
    status?.status === "downloading" ||
    status?.status === "installing" ||
    status?.status === "restart_required"
  );
}

function runSharedAutoCheck(): Promise<UpdaterCheckResult | null> {
  const now = Date.now();
  if (sharedAutoCheckPromise) return sharedAutoCheckPromise;
  if (now - lastAutoCheckStartedAt < STRICT_MODE_DUPLICATE_WINDOW_MS) {
    return Promise.resolve(null);
  }
  lastAutoCheckStartedAt = now;
  sharedAutoCheckPromise = updaterApi.check(false).finally(() => {
    sharedAutoCheckPromise = null;
  });
  return sharedAutoCheckPromise;
}

export function useUpdaterAutoCheck(
  options: UseUpdaterAutoCheckOptions = {},
): UseUpdaterAutoCheckResult {
  const {
    enabled = true,
    startDelayMs = 0,
    minIntervalMs = HOUR_MS,
    onResult,
    onError,
  } = options;
  const mountedRef = useRef(false);
  const [settings, setSettings] = useState<UpdaterSettings | null>(null);
  const [status, setStatus] = useState<UpdaterStatusSnapshot | null>(null);
  const [lastResult, setLastResult] = useState<UpdaterCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleRevision, setScheduleRevision] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleSettingsChanged = () => {
      setScheduleRevision((revision) => revision + 1);
    };
    window.addEventListener(
      UPDATER_SETTINGS_CHANGED_EVENT,
      handleSettingsChanged,
    );
    return () => {
      window.removeEventListener(
        UPDATER_SETTINGS_CHANGED_EVENT,
        handleSettingsChanged,
      );
    };
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [nextSettings, nextStatus] = await Promise.all([
        updaterApi.getSettings(),
        updaterApi.getStatus(),
      ]);
      if (mountedRef.current) {
        setSettings(nextSettings);
        setStatus(nextStatus);
      }
    } catch (caught) {
      const message = toErrorMessage(caught);
      if (mountedRef.current) setError(message);
      onError?.(message);
    }
  }, [onError]);

  const runNow = useCallback(async (): Promise<UpdaterCheckResult | null> => {
    setChecking(true);
    setError(null);
    try {
      const nextSettings = await updaterApi.getSettings();
      const nextStatus = await updaterApi.getStatus();
      if (mountedRef.current) {
        setSettings(nextSettings);
        setStatus(nextStatus);
      }
      if (
        !nextSettings.selfUpdateSupported ||
        !nextStatus.selfUpdateSupported ||
        !nextSettings.autoCheckEnabled ||
        isUpdaterBusy(nextStatus)
      ) {
        return null;
      }
      const intervalMs = intervalMsFor(nextSettings, minIntervalMs);
      if (!isDue(nextStatus, intervalMs)) return null;
      const result = await runSharedAutoCheck();
      if (result && mountedRef.current) {
        setLastResult(result);
        setStatus(result.status);
      }
      if (result) onResult?.(result);
      return result;
    } catch (caught) {
      const message = toErrorMessage(caught);
      if (mountedRef.current) setError(message);
      onError?.(message);
      return null;
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }, [minIntervalMs, onError, onResult]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        void tickAndReschedule();
      }, boundedUpdaterTimerDelay(delayMs));
    };

    const tickAndReschedule = async () => {
      await runNow();
      if (cancelled) return;

      const [latestSettings, latestStatus] = await Promise.all([
        updaterApi.getSettings().catch(() => null),
        updaterApi.getStatus().catch(() => null),
      ]);
      const transientFailureRetryMs = Math.max(minIntervalMs, HOUR_MS);
      if (!latestSettings || !latestStatus) {
        schedule(transientFailureRetryMs);
        return;
      }
      if (
        cancelled ||
        !latestSettings.selfUpdateSupported ||
        !latestSettings.autoCheckEnabled ||
        !latestStatus.selfUpdateSupported
      ) {
        return;
      }

      const intervalMs = intervalMsFor(latestSettings, minIntervalMs);
      const remainingMs = millisecondsUntilNextCheck(
        intervalMs,
        latestStatus.lastCheckedAt,
      );
      const retryMs = Math.min(intervalMs, transientFailureRetryMs);
      schedule(remainingMs > 0 ? remainingMs : retryMs);
    };

    schedule(scheduleRevision === 0 ? Math.max(0, startDelayMs) : 0);

    return () => {
      cancelled = true;
      if (typeof timer === "number") window.clearTimeout(timer);
    };
  }, [enabled, minIntervalMs, runNow, scheduleRevision, startDelayMs]);

  return {
    settings,
    status,
    lastResult,
    checking,
    error,
    lastCheckedAt: status?.lastCheckedAt ?? null,
    refresh,
    runNow,
  };
}
