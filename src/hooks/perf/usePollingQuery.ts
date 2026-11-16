import { queryStore } from "../../utils/perf/queryStore";
import {
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from "./useQuery";
import { useVisibleInterval } from "./useVisibleInterval";

/**
 * useQuery + visibility-aware polling. The interval revalidates (deduped) and
 * pauses while hidden; coming back fires one catch-up revalidate.
 */
export function usePollingQuery<T, S = T>(
  key: string | null,
  fetcher: () => Promise<T>,
  intervalMs: number | null,
  options: UseQueryOptions<T, S> = {},
): UseQueryResult<S> {
  const result = useQuery<T, S>(key, fetcher, options);
  const active = key !== null && options.enabled !== false;
  useVisibleInterval(
    () => {
      if (key !== null)
        queryStore.refetch<T>(key, fetcher).catch(() => undefined);
    },
    active ? intervalMs : null,
  );
  return result;
}
