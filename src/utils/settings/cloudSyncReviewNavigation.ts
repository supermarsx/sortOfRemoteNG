import { useSyncExternalStore } from "react";
import type { SettingsTabId } from "../../components/SettingsDialog/settingsConstants";

// A short-lived, window-local navigation intent, never persisted with settings.
// Keep it until the section mounts; an event alone would be lost on a closed tab.
let sequence = 0;
let pending = 0;
let expiresAt = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const snapshot = () => (Date.now() < expiresAt ? pending : 0);
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function openCloudSyncConflictReview(
  openSettings: (tab?: SettingsTabId) => void,
) {
  pending = ++sequence;
  expiresAt = Date.now() + 30_000;
  // First select/focus the owning Settings tab using the application's real
  // navigation. useSettingsDialog then explicitly selects the Cloud Sync panel.
  openSettings("cloudSync");
  notify();
}

export function useCloudSyncReviewNavigation(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}

export function finishCloudSyncReviewNavigation(request: number) {
  if (pending !== request) return;
  pending = 0;
  notify();
}
