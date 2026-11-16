import { useEffect, useMemo, useRef } from "react";
import {
  preloadOnIntent,
  type PreloadTask,
} from "../../utils/perf/preloadScheduler";

/**
 * Handlers to spread on a button/tab: warms `task` on hover/focus after an
 * 80 ms debounce, cancelled by leave/blur. Never prompts or unlocks.
 */
export function usePreloadIntent(
  id: string,
  task: Omit<PreloadTask, "id">,
): ReturnType<typeof preloadOnIntent> {
  const taskRef = useRef(task);
  taskRef.current = task;
  const handlers = useMemo(
    () =>
      preloadOnIntent(id, {
        get priority() {
          return taskRef.current.priority;
        },
        get cost() {
          return taskRef.current.cost;
        },
        get requires() {
          return taskRef.current.requires;
        },
        run: () => taskRef.current.run(),
      }),
    [id],
  );
  useEffect(() => () => handlers.onPointerLeave(), [handlers]);
  return handlers;
}
