import { normalizeCloudSyncFailureNotificationMinutes } from "../../types/settings/cloudSyncSettings";

export const CLOUD_SYNC_FAILURE_TOAST_TIME_KEY =
  "sorng-cloud-sync-failure-toast-at-v1";

/** Only an anonymous timestamp is retained, never target details or errors. */
export function createCloudSyncFailureToastLimiter(
  storage: () => Pick<Storage, "getItem" | "setItem"> | undefined = () =>
    typeof window === "undefined" ? undefined : window.localStorage,
  now: () => number = Date.now,
) {
  let lastShown: number | undefined;
  return (intervalMinutes?: number): boolean => {
    const current = now();
    try {
      const raw = storage()?.getItem(CLOUD_SYNC_FAILURE_TOAST_TIME_KEY);
      const stored = raw ? Number(raw) : NaN;
      if (Number.isFinite(stored) && stored >= 0)
        lastShown = Math.max(lastShown ?? 0, stored);
    } catch {
      // Storage availability must not break sync or disable in-memory limiting.
    }
    const interval =
      normalizeCloudSyncFailureNotificationMinutes(intervalMinutes) * 60_000;
    if (
      lastShown !== undefined &&
      current >= lastShown &&
      current - lastShown < interval
    )
      return false;
    // A clock moving backwards starts a new interval rather than silencing errors forever.
    lastShown = current;
    try {
      storage()?.setItem(CLOUD_SYNC_FAILURE_TOAST_TIME_KEY, String(current));
    } catch {
      /* Keep the in-memory deadline if browser storage is unavailable. */
    }
    return true;
  };
}

export const claimCloudSyncFailureNotification =
  createCloudSyncFailureToastLimiter();
