import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  queryStore,
  type QueryOptions,
  type QuerySnapshot,
  type QueryStatus,
} from "../../utils/perf/queryStore";

export interface UseQueryOptions<T, S> extends QueryOptions<T> {
  /** Project the data; re-render only when the projection changes (isEqual). */
  select?: (data: T) => S;
  isEqual?: (a: S, b: S) => boolean;
  /** Default true. When false nothing is fetched or subscribed. */
  enabled?: boolean;
}

export interface UseQueryResult<S> {
  data: S | undefined;
  status: QueryStatus;
  error: unknown;
  fetching: boolean;
  /** Force a fetch now (deduped). */
  refetch: () => Promise<unknown>;
}

const NOOP_SUBSCRIBE = () => () => undefined;

/**
 * Cached read with stale-while-revalidate. `key = null` disables. Several
 * components with the same key share one fetch and one cache entry.
 */
export function useQuery<T, S = T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: UseQueryOptions<T, S> = {},
): UseQueryResult<S> {
  const enabled = options.enabled !== false && key !== null;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const optsRef = useRef(options);
  optsRef.current = options;
  const memo = useRef<{
    key: string | null;
    snap: QuerySnapshot<T>;
    out: QuerySnapshot<S>;
  } | null>(null);

  const subscribe = useCallback(
    (cb: () => void) =>
      enabled && key !== null
        ? queryStore.subscribe(key, cb)
        : NOOP_SUBSCRIBE(),
    [enabled, key],
  );

  const getSnapshot = useCallback((): QuerySnapshot<S> => {
    if (!enabled || key === null) return queryStore.getSnapshot<S>("\0idle");
    const snap = queryStore.getSnapshot<T>(key);
    const m = memo.current;
    if (m && m.key === key && m.snap === snap) return m.out;
    const { select, isEqual } = optsRef.current;
    const data =
      snap.data === undefined
        ? undefined
        : select
          ? select(snap.data)
          : (snap.data as unknown as S);
    let out: QuerySnapshot<S>;
    if (
      m &&
      m.key === key &&
      m.out.status === snap.status &&
      m.out.error === snap.error &&
      m.out.fetching === snap.fetching &&
      (m.out.data === data ||
        (data !== undefined &&
          m.out.data !== undefined &&
          (isEqual ?? Object.is)(m.out.data, data)))
    )
      out = m.out;
    else
      out = {
        data,
        status: snap.status,
        error: snap.error,
        fetching: snap.fetching,
      };
    memo.current = { key, snap, out };
    return out;
  }, [enabled, key]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled || key === null) return;
    queryStore
      .get<T>(key, () => fetcherRef.current(), optsRef.current)
      .catch(() => undefined);
  }, [enabled, key]);

  const refetch = useCallback(() => {
    if (key === null) return Promise.resolve(undefined);
    return queryStore.refetch<T>(key, () => fetcherRef.current());
  }, [key]);

  return {
    data: snapshot.data,
    status: snapshot.status,
    error: snapshot.error,
    fetching: snapshot.fetching,
    refetch,
  };
}
