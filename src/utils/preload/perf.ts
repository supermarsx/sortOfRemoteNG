/**
 * Cheap tab-open instrumentation. Enabled by `localStorage["sorng.debugPerf"]="1"`
 * or `globalThis.__SORNG_DEBUG_PERF__ = true`; otherwise every call is a no-op.
 */
export function perfEnabled(): boolean {
  try {
    if ((globalThis as { __SORNG_DEBUG_PERF__?: boolean }).__SORNG_DEBUG_PERF__)
      return true;
    return globalThis.localStorage?.getItem("sorng.debugPerf") === "1";
  } catch {
    return false;
  }
}

export function perfMark(name: string): void {
  if (!perfEnabled() || typeof performance?.mark !== "function") return;
  performance.mark(`sorng:${name}`);
}

export function perfMeasure(name: string, from: string, to: string): void {
  if (!perfEnabled() || typeof performance?.measure !== "function") return;
  try {
    performance.measure(`sorng:${name}`, `sorng:${from}`, `sorng:${to}`);
  } catch {
    /* A missing start mark is not worth surfacing. */
  }
}
