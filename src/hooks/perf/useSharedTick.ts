import { useCallback, useSyncExternalStore } from "react";
import { tickStore } from "../../utils/perf/visibility";

/**
 * Re-render every `everyN` seconds off ONE shared 1 s timer (paused while
 * hidden). Returns the current tick time in ms; use for elapsed-time UI:
 * `const now = useSharedTick(); elapsed = now - startedAt`.
 */
export function useSharedTick(everyN = 1): number {
  const getSnapshot = useCallback(
    () => tickStore.bucket(everyN) * 1000 * Math.max(1, everyN),
    [everyN],
  );
  return useSyncExternalStore(tickStore.subscribe, getSnapshot, getSnapshot);
}

const noopSubscribe = () => () => {};

/**
 * Conditional variant of the shared tick: subscribes only while `enabled`,
 * returns the exact ms epoch of the last tick (Date.now() at mount time before
 * the first tick). Use for elapsed/countdown UI that is not always on screen.
 */
export function useSharedNow(enabled: boolean): number {
  const now = useSyncExternalStore(
    enabled ? tickStore.subscribe : noopSubscribe,
    tickStore.getSnapshot,
    tickStore.getSnapshot,
  );
  return enabled ? now : Date.now();
}
