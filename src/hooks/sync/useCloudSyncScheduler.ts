import { useEffect, useRef } from "react";
import {
  normalizeCloudSyncIntervalMinutes,
  type CloudSyncConfig,
} from "../../types/settings/cloudSyncSettings";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../utils/storage/appDataJsonStore";
import { getCloudSyncActivity } from "../../utils/services/cloudSyncActivity";
import { SettingsManager } from "../../utils/settings/settingsManager";

export const DATABASE_SYNC_CHANGED_EVENT = "sorng-database-data-saved";
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
  const hasSelection = Boolean(config.selectedItems?.length);
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
    let running = false;
    const trigger = async () => {
      if (
        disposed ||
        running ||
        getCloudSyncActivity().length ||
        !latest.current.config.selectedItems?.length
      )
        return;
      running = true;
      try {
        await latest.current.run();
      } catch {
        /* The runner records failures per target; never log credentials. */
      } finally {
        running = false;
      }
    };
    const changed = () => {
      if (running || getCloudSyncActivity().length) return;
      if (!["realtime", "onSave"].includes(latest.current.config.frequency))
        return;
      if (pending) clearTimeout(pending);
      pending = setTimeout(
        () => void trigger(),
        config.frequency === "realtime" ? 1500 : 500,
      );
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
      pending = setTimeout(() => {
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
      if (pending) clearTimeout(pending);
      if (timer) clearInterval(timer);
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
  ]);
}
