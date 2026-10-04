import { useEffect, useRef } from "react";
import {
  normalizeCloudSyncIntervalMinutes,
  type CloudSyncConfig,
} from "../../types/settings/cloudSyncSettings";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../utils/storage/appDataJsonStore";
import {
  getCloudSyncActivity,
  subscribeCloudSyncActivity,
} from "../../utils/services/cloudSyncActivity";
import { SettingsManager } from "../../utils/settings/settingsManager";

export const DATABASE_SYNC_CHANGED_EVENT = "sorng-database-data-saved";
const REALTIME_QUIET_MS = 3000;
const MAX_CHANGE_WAIT_MS = 15_000;
const intervals: Record<string, number> = {
  every5Minutes: 300_000,
  every15Minutes: 900_000,
  every30Minutes: 1_800_000,
  hourly: 3_600_000,
  daily: 86_400_000,
};

/** Main-window scheduler: run only after initialization and durable source writes. */
export function useCloudSyncScheduler(
  config: CloudSyncConfig,
  ready: boolean,
  run: () => Promise<void>,
) {
  const latest = useRef({ config, run });
  latest.current = { config, run };
  const startupRan = useRef(false);
  // An effect restart must not forget a still-running scheduled operation.
  const running = useRef(false);
  const lastFinished = useRef<number | undefined>(undefined);
  const resume = useRef<(() => void) | undefined>(undefined);
  const hasSelection = Boolean(config.selectedItems?.length);
  const selectionKey = JSON.stringify(config.selectedItems ?? []);
  const duration =
    config.frequency === "custom"
      ? normalizeCloudSyncIntervalMinutes(config.customIntervalMinutes) * 60_000
      : intervals[config.frequency];
  useEffect(() => {
    if (
      !ready ||
      !config.enabled ||
      !hasSelection ||
      typeof window === "undefined"
    )
      return;
    let disposed = false;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let startup: ReturnType<typeof setTimeout> | undefined;
    let changes: { first: number; last: number } | undefined;
    const quietMs = config.frequency === "realtime" ? REALTIME_QUIET_MS : 500;
    const clearPending = () => {
      if (pending !== undefined) clearTimeout(pending);
      pending = undefined;
    };
    const trigger = async () => {
      if (
        disposed ||
        running.current ||
        getCloudSyncActivity().length ||
        !latest.current.config.selectedItems?.length
      )
        return;
      // Startup/interval runs consume an already queued change batch, too.
      clearPending();
      changes = undefined;
      running.current = true;
      try {
        await latest.current.run();
      } catch {
        /* The runner records failures per target; never log credentials. */
      } finally {
        running.current = false;
        lastFinished.current = Date.now();
        // Resume the current effect only; a disposed effect cannot revive work.
        resume.current?.();
      }
    };
    const schedule = () => {
      clearPending();
      if (
        disposed ||
        !changes ||
        running.current ||
        getCloudSyncActivity().length
      )
        return;
      const now = Date.now();
      const due = Math.max(
        Math.min(changes.last + quietMs, changes.first + MAX_CHANGE_WAIT_MS),
        // A slow upload/manual action must not be followed by an immediate
        // burst. The maximum wait is bounded only while transport is idle.
        lastFinished.current !== undefined && lastFinished.current <= now
          ? lastFinished.current + quietMs
          : now,
      );
      pending = setTimeout(
        () => {
          pending = undefined;
          void trigger();
        },
        Math.max(0, due - now),
      );
    };
    resume.current = schedule;
    const unsubscribe = subscribeCloudSyncActivity(() => {
      if (!getCloudSyncActivity().length) lastFinished.current = Date.now();
      schedule();
    });
    const changed = (event?: Event) => {
      if (!["realtime", "onSave"].includes(latest.current.config.frequency))
        return;
      if (event?.type === APP_DATA_STORE_CHANGED_EVENT) {
        const key = (event as CustomEvent<{ key?: unknown }>).detail?.key;
        if (
          typeof key === "string" &&
          !latest.current.config.selectedItems?.includes(`app:${key}`)
        )
          return;
      }
      const now = Date.now();
      changes = { first: changes?.first ?? now, last: now };
      schedule();
    };
    const settingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (!detail) return;
      // Sync status writes must not schedule another sync indefinitely.
      const { cloudSync: _sync, ...rest } = detail;
      const fingerprint = JSON.stringify(rest);
      if (lastSettings !== null && fingerprint !== lastSettings) changed();
      lastSettings = fingerprint;
    };
    const { cloudSync: _initialSync, ...initialSettings } =
      SettingsManager.getInstance().getSettings();
    let lastSettings: string | null = JSON.stringify(initialSettings);
    if (!startupRan.current && config.syncOnStartup) {
      startup = setTimeout(() => {
        startupRan.current = true;
        void trigger();
      }, 1000);
    }
    const timer = duration
      ? setInterval(() => void trigger(), duration)
      : undefined;
    window.addEventListener(DATABASE_SYNC_CHANGED_EVENT, changed);
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
    window.addEventListener("settings-updated", settingsChanged);
    return () => {
      disposed = true;
      clearPending();
      changes = undefined;
      if (startup !== undefined) clearTimeout(startup);
      if (timer) clearInterval(timer);
      unsubscribe();
      if (resume.current === schedule) resume.current = undefined;
      window.removeEventListener(DATABASE_SYNC_CHANGED_EVENT, changed);
      window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, changed);
      window.removeEventListener("settings-updated", settingsChanged);
    };
  }, [
    ready,
    config.enabled,
    config.frequency,
    config.syncOnStartup,
    duration,
    hasSelection,
    selectionKey,
  ]);
}
