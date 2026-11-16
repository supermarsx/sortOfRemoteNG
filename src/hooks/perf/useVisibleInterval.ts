import { useEffect, useRef } from "react";
import {
  createVisibleInterval,
  type VisibleIntervalOptions,
} from "../../utils/perf/visibility";

/**
 * setInterval that pauses while the window is hidden and fires one catch-up
 * call on return (never a burst). `ms = null` disables.
 */
export function useVisibleInterval(
  callback: () => void,
  ms: number | null,
  options: VisibleIntervalOptions = {},
): void {
  const saved = useRef(callback);
  saved.current = callback;
  const { hidden, immediate } = options;
  useEffect(() => {
    if (ms === null) return;
    return createVisibleInterval(() => saved.current(), ms, {
      hidden,
      immediate,
    });
  }, [ms, hidden, immediate]);
}
