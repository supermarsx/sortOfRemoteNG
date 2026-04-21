/**
 * Tauri Listener Tracker — wraps `listen()` to track active event listeners.
 * Prevents the async cleanup race condition where `unlisten` is called before
 * the `listen()` promise resolves, leaving orphaned listeners.
 *
 * Usage: replace `listen(event, handler)` with `trackedListen(event, handler)`
 * and use the returned cleanup function (sync, not promise-based).
 */

import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";

interface TrackedListener {
  event: string;
  registeredAt: number;
  unlistenFn: UnlistenFn | null;
  cancelled: boolean;
}

const _active = new Map<number, TrackedListener>();
let _nextId = 0;

/**
 * Register a Tauri event listener with guaranteed cleanup.
 * Returns a synchronous cleanup function that ALWAYS works,
 * even if called before the async `listen()` resolves.
 */
export function trackedListen<T>(
  event: string,
  handler: EventCallback<T>,
): { cleanup: () => void; id: number } {
  const id = _nextId++;
  const entry: TrackedListener = {
    event,
    registeredAt: Date.now(),
    unlistenFn: null,
    cancelled: false,
  };
  _active.set(id, entry);

  // Start async registration
  import("@tauri-apps/api/event").then(({ listen }) => {
    listen<T>(event, (e) => {
      // Don't deliver events if already cancelled
      if (entry.cancelled) return;
      handler(e);
    }).then((unlisten) => {
      if (entry.cancelled) {
        // Cleanup was called before listen resolved — immediately unlisten
        unlisten();
        _active.delete(id);
      } else {
        entry.unlistenFn = unlisten;
      }
    }).catch(() => {
      _active.delete(id);
    });
  }).catch(() => {
    _active.delete(id);
  });

  const cleanup = () => {
    entry.cancelled = true;
    if (entry.unlistenFn) {
      entry.unlistenFn();
      entry.unlistenFn = null;
    }
    _active.delete(id);
  };

  return { cleanup, id };
}

/** Get count of active tracked listeners, grouped by event name. */
export function getListenerStats(): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const entry of _active.values()) {
    stats[entry.event] = (stats[entry.event] || 0) + 1;
  }
  return stats;
}

/** Get total active listener count. */
export function getActiveListenerCount(): number {
  return _active.size;
}

/** Log all active listeners to console. */
export function dumpListeners(): void {
  console.group(`[ListenerTracker] ${_active.size} active listeners`);
  const grouped: Record<string, number[]> = {};
  for (const [id, entry] of _active) {
    if (!grouped[entry.event]) grouped[entry.event] = [];
    grouped[entry.event].push(id);
  }
  for (const [event, ids] of Object.entries(grouped)) {
    console.log(`  ${event}: ${ids.length} listener(s) [ids: ${ids.join(", ")}]`);
  }
  console.groupEnd();
}
