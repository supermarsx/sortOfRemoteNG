import { useRef } from "react";
import { mergeById } from "../../utils/perf/reconcile";

/**
 * Poll-stable list: a refetch that rebuilds equal rows keeps each unchanged
 * row's identity (and the array's, when nothing changed), so memoized rows and
 * downstream useMemo chains do not recompute.
 */
export function useStableRows<T>(
  rows: T[],
  idOf: (row: T) => string | number,
): T[] {
  const previous = useRef<T[] | undefined>(undefined);
  const next = mergeById(previous.current, rows, idOf);
  previous.current = next;
  return next;
}
