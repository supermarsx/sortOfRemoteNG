import { useEffect } from "react";
import {
  prefetchChunksInSequence,
  shouldWarmChunksAtIdle,
} from "../../utils/perf/preloadScheduler";
import { panelWarmSteps } from "../../utils/perf/preloadPlan";

/** Let first paint, settings load and session restore settle before prefetching. */
export const STARTUP_PREFETCH_DELAY_MS = 3000;

/**
 * Warms the code-split chunks that App.tsx lazy-loads after first paint, via the
 * idle preload scheduler (priority 2-3: never competes with input, terminals or
 * RDP; deferred while the window is hidden or busy). Imports resolve to the same
 * module ids the `dynamic()` calls use, so the later mount finds the chunk.
 *
 * The chunks load strictly one at a time with a pause between them (a chunk's
 * evaluation cannot be interrupted, so a burst of them freezes the UI), and not
 * at all under `next dev`, where each import would trigger an on-demand compile
 * of that panel's module graph.
 */
export function useStartupPrefetch(enabled = true): void {
  useEffect(() => {
    if (!enabled || !shouldWarmChunksAtIdle()) return;
    let cancel: (() => void) | undefined;
    const timer = setTimeout(() => {
      cancel = prefetchChunksInSequence([
        {
          id: "session-viewer",
          importer: () => import("../../components/session/SessionViewer"),
          priority: 2,
        },
        {
          id: "tab-layout-manager",
          importer: () => import("../../components/session/TabLayoutManager"),
          priority: 2,
        },
        ...panelWarmSteps(),
      ]);
    }, STARTUP_PREFETCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      cancel?.();
    };
  }, [enabled]);
}
