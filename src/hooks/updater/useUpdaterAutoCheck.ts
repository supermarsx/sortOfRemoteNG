import { useCallback, useEffect, useRef, useState } from "react";
import type {
  UpdaterCheckResult,
  UpdaterSettings,
  UpdaterStatusSnapshot,
} from "../../types/updater/updater";
import { updaterApi } from "./useUpdater";

const HOUR_MS = 60 * 60 * 1000;
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

function intervalMsFor(settings: UpdaterSettings, minIntervalMs: number): number {
  const configured = Math.max(1, settings.checkIntervalHours) * HOUR_MS;
  return Math.max(minIntervalMs, configured);
}

function isDue(status: UpdaterStatusSnapshot | null, intervalMs: number): boolean {
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
      if (!nextSettings.autoCheckEnabled || isUpdaterBusy(nextStatus)) return null;
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
    let intervalTimer: number | undefined;

    const tick = async () => {
      if (cancelled) return;
      await runNow();
    };

    const start = async () => {
      await tick();
      if (cancelled) return;
      const latestSettings = await updaterApi.getSettings().catch(() => null);
      if (cancelled || !latestSettings?.autoCheckEnabled) return;
      intervalTimer = window.setInterval(tick, intervalMsFor(latestSettings, minIntervalMs));
    };

    const startTimer = window.setTimeout(() => {
      void start();
    }, Math.max(0, startDelayMs));

    return () => {
      cancelled = true;
      if (typeof startTimer === "number") window.clearTimeout(startTimer);
      if (typeof intervalTimer === "number") window.clearInterval(intervalTimer);
    };
  }, [enabled, minIntervalMs, runNow, startDelayMs]);

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