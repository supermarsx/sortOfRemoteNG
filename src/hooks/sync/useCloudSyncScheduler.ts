import { useEffect, useRef } from "react";
import {
  CLOUD_SYNC_ACTIVITY_WINDOW_MS,
  CLOUD_SYNC_BUSY_WRITE_COUNT,
  normalizeCloudSyncIntervalMinutes,
  resolveCloudSyncDebounce,
  type CloudSyncConfig,
} from "../../types/settings/cloudSyncSettings";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../utils/storage/appDataJsonStore";
import {
  getCloudSyncActivity,
  subscribeCloudSyncActivity,
} from "../../utils/services/cloudSyncActivity";
import { SettingsManager } from "../../utils/settings/settingsManager";
import {
  subscribeBrowserSessionProjectionChanges,
  type BrowserSessionProjectionChange,
} from "../../utils/services/browserSessionProjectionEvents";

export const DATABASE_SYNC_CHANGED_EVENT = "sorng-database-data-saved";
const intervals: Record<string, number> = {
  every5Minutes: 300_000,
  every15Minutes: 900_000,
  every30Minutes: 1_800_000,
  hourly: 3_600_000,
  daily: 86_400_000,
};

type ChangeBatch = { first: number; last: number; busy: boolean };

// Match the portable appearance artifact in cloudSyncPayload/settingsManager.
// Status, credentials and other device-only settings are not synced content.
const settingsFingerprint = (settings: Record<string, unknown>) =>
  JSON.stringify([
    settings.language,
    settings.theme,
    settings.colorScheme,
    settings.animationsEnabled,
    settings.sidebarWidth,
  ]);

/** Main-window scheduler: run only after initialization and durable source writes. */
export function useCloudSyncScheduler(
  config: CloudSyncConfig,
  ready: boolean,
  run: () => Promise<void>,
) {
  const debounce = resolveCloudSyncDebounce(config);
  const latest = useRef({ config, run, debounce });
  latest.current = { config, run, debounce };
  const startupRan = useRef(false);
  // An effect restart must not forget a still-running scheduled operation.
  const running = useRef(false);
  const lastFinished = useRef<number | undefined>(undefined);
  const resume = useRef<(() => void) | undefined>(undefined);
  const hasSelection = Boolean(config.selectedItems?.length);
  const selectionKey = JSON.stringify(config.selectedItems ?? []);
  const queued = useRef<{
    selectionKey: string;
    changes?: ChangeBatch;
    recentWrites: number[];
    ordinaryChange: boolean;
    browserChanges: Map<string, BrowserSessionProjectionChange>;
  }>({
    selectionKey,
    recentWrites: [],
    ordinaryChange: false,
    browserChanges: new Map(),
  });
  // Bounded, opaque commit IDs; duplicates must not prolong the quiet period.
  const browserCommits = useRef(new Set<string>());
  const duration =
    config.frequency === "custom"
      ? normalizeCloudSyncIntervalMinutes(config.customIntervalMinutes) * 60_000
      : intervals[config.frequency];
  useEffect(() => {
    const changeDriven = ["realtime", "onSave"].includes(config.frequency);
    if (
      !ready ||
      !config.enabled ||
      !changeDriven ||
      queued.current.selectionKey !== selectionKey
    )
      queued.current = {
        selectionKey,
        recentWrites: [],
        ordinaryChange: false,
        browserChanges: new Map(),
      };
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
    const state = queued.current;
    let scheduled = false;
    let startupDue = false;
    const clearPending = () => {
      if (pending !== undefined) clearTimeout(pending);
      pending = undefined;
    };
    const pruneBrowserChanges = () => {
      for (const [databaseId, change] of state.browserChanges) {
        try {
          change.assertCurrent();
          if (
            !latest.current.config.selectedItems?.includes(
              `database:${databaseId}`,
            )
          )
            state.browserChanges.delete(databaseId);
        } catch {
          state.browserChanges.delete(databaseId);
        }
      }
      if (
        state.changes &&
        !state.ordinaryChange &&
        !state.browserChanges.size
      ) {
        state.changes = undefined;
        state.recentWrites = [];
      }
    };
    const trigger = async () => {
      pruneBrowserChanges();
      if (
        disposed ||
        (!state.changes && !scheduled) ||
        running.current ||
        getCloudSyncActivity().length ||
        !latest.current.config.selectedItems?.length
      )
        return;
      // Startup/interval runs consume an already queued change batch, too.
      clearPending();
      state.changes = undefined;
      state.ordinaryChange = false;
      state.browserChanges.clear();
      scheduled = false;
      if (startupDue) startupRan.current = true;
      startupDue = false;
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
      pruneBrowserChanges();
      if (
        disposed ||
        (!state.changes && !scheduled) ||
        running.current ||
        getCloudSyncActivity().length
      )
        return;
      const now = Date.now();
      const { adaptive, quietMs, busyQuietMs, maxWaitMs, minIntervalMs } =
        latest.current.debounce;
      const changes = state.changes;
      const quiet = adaptive && changes?.busy ? busyQuietMs : quietMs;
      const due = Math.max(
        scheduled || !changes
          ? now
          : Math.min(changes.last + quiet, changes.first + maxWaitMs),
        // A slow upload/manual action must not be followed by an immediate
        // burst. The maximum wait is bounded only while transport is idle.
        lastFinished.current !== undefined && lastFinished.current <= now
          ? lastFinished.current + minIntervalMs
          : now,
      );
      if (due <= now) {
        void trigger();
        return;
      }
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
    const changed = (ordinary = true) => {
      if (!["realtime", "onSave"].includes(latest.current.config.frequency))
        return;
      state.ordinaryChange ||= ordinary;
      const now = Date.now();
      // Five timestamps suffice for a bounded rolling activity window. Keep
      // collecting during sync: a local edit must survive as one follow-up.
      state.recentWrites = state.recentWrites
        .filter((time) => time > now - CLOUD_SYNC_ACTIVITY_WINDOW_MS)
        .concat(now)
        .slice(-CLOUD_SYNC_BUSY_WRITE_COUNT);
      state.changes = {
        first: state.changes?.first ?? now,
        last: now,
        busy:
          state.changes?.busy === true ||
          state.recentWrites.length >= CLOUD_SYNC_BUSY_WRITE_COUNT,
      };
      schedule();
    };
    const unsubscribeBrowserChanges = subscribeBrowserSessionProjectionChanges(
      (change) => {
        if (
          disposed ||
          !["realtime", "onSave"].includes(latest.current.config.frequency) ||
          !latest.current.config.selectedItems?.includes(
            `database:${change.databaseId}`,
          ) ||
          browserCommits.current.has(change.changeId)
        )
          return;
        try {
          change.assertCurrent();
        } catch {
          return;
        }
        browserCommits.current.add(change.changeId);
        if (browserCommits.current.size > 256)
          browserCommits.current.delete(
            browserCommits.current.values().next().value!,
          );
        state.browserChanges.set(change.databaseId, change);
        changed(false);
      },
    );
    const appDataChanged = (event: Event) => {
      const key = (event as CustomEvent<{ key?: unknown }>).detail?.key;
      if (
        typeof key === "string" &&
        latest.current.config.selectedItems?.includes(`app:${key}`)
      )
        changed();
    };
    const databaseChanged = (event: Event) => {
      const databaseId = (event as CustomEvent<{ databaseId?: unknown }>).detail
        ?.databaseId;
      if (typeof databaseId === "string") {
        if (
          latest.current.config.selectedItems?.includes(
            `database:${databaseId}`,
          )
        )
          changed();
        return;
      }
      // Older producers emit a plain Event. Retain the coarse fallback:
      // guessing the active database could hide legitimate background saves.
      if (
        latest.current.config.selectedItems?.some((id) =>
          id.startsWith("database:"),
        )
      )
        changed();
    };
    const settingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (!detail || typeof detail !== "object") return;
      const fingerprint = settingsFingerprint(detail);
      if (
        latest.current.config.selectedItems?.includes("app:settings") &&
        fingerprint !== lastSettings
      )
        changed();
      lastSettings = fingerprint;
    };
    let lastSettings = settingsFingerprint(
      SettingsManager.getInstance().getSettings() as unknown as Record<
        string,
        unknown
      >,
    );
    if (!startupRan.current && config.syncOnStartup) {
      startup = setTimeout(() => {
        startupDue = true;
        scheduled = true;
        schedule();
      }, 1000);
    }
    const timer = duration
      ? setInterval(() => {
          // Preserve periodic semantics: an occupied tick is skipped.
          if (running.current || getCloudSyncActivity().length) return;
          scheduled = true;
          schedule();
        }, duration)
      : undefined;
    window.addEventListener(DATABASE_SYNC_CHANGED_EVENT, databaseChanged);
    window.addEventListener(APP_DATA_STORE_CHANGED_EVENT, appDataChanged);
    window.addEventListener("settings-updated", settingsChanged);
    schedule();
    return () => {
      disposed = true;
      clearPending();
      if (startup !== undefined) clearTimeout(startup);
      if (timer) clearInterval(timer);
      unsubscribe();
      unsubscribeBrowserChanges();
      if (resume.current === schedule) resume.current = undefined;
      window.removeEventListener(DATABASE_SYNC_CHANGED_EVENT, databaseChanged);
      window.removeEventListener(APP_DATA_STORE_CHANGED_EVENT, appDataChanged);
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
  useEffect(() => {
    // Timing edits re-arm the existing batch, retaining its first-write
    // deadline and activity history. They must not restart startup/intervals.
    resume.current?.();
  }, [
    debounce.adaptive,
    debounce.quietMs,
    debounce.busyQuietMs,
    debounce.maxWaitMs,
    debounce.minIntervalMs,
  ]);
}
