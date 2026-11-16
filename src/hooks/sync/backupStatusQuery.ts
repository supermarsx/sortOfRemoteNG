import { cachedInvoke } from "../../utils/perf/cachedInvoke";
import { queryStore } from "../../utils/perf/queryStore";

/**
 * Shared, deduped read of the backup status. The toolbar status bar and the
 * backup popover both poll it; with this they share one invoke per TTL window
 * instead of one each every 30 s.
 */
export function readBackupStatus<T>(force = false): Promise<T> {
  return cachedInvoke<T>("backup_get_status", undefined, {
    ttlMs: 10_000,
    staleMs: 60_000,
    tags: ["backup"],
    force,
  });
}

/** Mark the cached status stale after a backup run/config change. */
export function invalidateBackupStatus(): void {
  queryStore.invalidate({ tag: "backup" });
}
