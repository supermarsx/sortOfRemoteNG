import { useEffect } from "react";
import { prefetchChunk } from "../../utils/perf/preloadScheduler";
import { warmPanelsWhenIdle } from "../../utils/perf/preloadPlan";

/** Let first paint, settings load and session restore settle before prefetching. */
export const STARTUP_PREFETCH_DELAY_MS = 3000;

/**
 * Warms the code-split chunks that App.tsx lazy-loads after first paint, via the
 * idle preload scheduler (priority 2-3: never competes with input, terminals or
 * RDP; deferred while the window is hidden or busy). Imports resolve to the same
 * module ids the `dynamic()` calls use, so the later mount finds the chunk.
 */
export function useStartupPrefetch(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    let cancels: Array<() => void> = [];
    const timer = setTimeout(() => {
      cancels = [
        prefetchChunk(
          "session-viewer",
          () => import("../../components/session/SessionViewer"),
          2,
        ),
        prefetchChunk(
          "tab-layout-manager",
          () => import("../../components/session/TabLayoutManager"),
          2,
        ),
        warmPanelsWhenIdle(),
      ];
    }, STARTUP_PREFETCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      cancels.forEach((cancel) => cancel());
    };
  }, [enabled]);
}
