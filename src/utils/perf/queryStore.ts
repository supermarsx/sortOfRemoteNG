/**
 * Memory-only query cache: in-flight dedupe, TTL + stale-while-revalidate,
 * bounded LRU per namespace, tag/event/manual invalidation, structural-sharing
 * reconciliation, optimistic mutation with rollback, and
 * useSyncExternalStore-compatible subscriptions.
 *
 * BACKGROUND LANE ONLY. Never route terminal/RDP/serial I/O, writes, or
 * secrets through here (see laneRegistry/safety). Never persisted.
 */
import { assertBackgroundEvent } from "./laneRegistry";
import { metrics } from "./metrics";
import { structuralShare } from "./reconcile";
import { assertNoSecretFields, registerCache } from "./safety";
import { subscribeEvent } from "./eventBus";

export type QueryStatus = "loading" | "fresh" | "stale" | "error";

export interface QuerySnapshot<T = unknown> {
  readonly data: T | undefined;
  readonly status: QueryStatus;
  readonly error: unknown;
  /** True while a fetch is in flight (including background revalidation). */
  readonly fetching: boolean;
}

export interface QueryOptions<T> {
  /** Fresh window. Default 5000 ms. 0 = always revalidate (dedupe still applies). */
  ttlMs?: number;
  /** Extra window after ttl in which stale data is served while revalidating. Default 30000 ms. */
  staleMs?: number;
  /** LRU cap for this key's namespace (text before the first ":"). Default 200. */
  maxEntries?: number;
  /** Custom reconcile (prev, next). Default structuralShare. Return prev to keep identity. */
  reconcile?: (prev: T | undefined, next: T) => T;
  tags?: readonly string[];
  /** Secrets are never cacheable. Type-forbids true. */
  secret?: false;
}

export type InvalidateMatch =
  string | { tag: string } | { prefix: string } | ((key: string) => boolean);

interface Entry<T = unknown> {
  key: string;
  ns: string;
  hasValue: boolean;
  value: T | undefined;
  fetchedAt: number;
  invalid: boolean;
  error: unknown;
  tags: Set<string>;
  epoch: number;
  inflight?: Promise<T>;
  fetcher?: () => Promise<T>;
  opts: QueryOptions<T>;
  snap: QuerySnapshot<T>;
}

const DEFAULT_TTL = 5000;
const DEFAULT_STALE = 30000;
const DEFAULT_MAX = 200;
const IDLE: QuerySnapshot = Object.freeze({
  data: undefined,
  status: "loading",
  error: undefined,
  fetching: false,
});

export interface QueryStoreDeps {
  now?: () => number;
  name?: string;
}

export function createQueryStore(deps: QueryStoreDeps = {}) {
  const now = deps.now ?? (() => Date.now());
  const entries = new Map<string, Entry>(); // insertion order = LRU order
  const listeners = new Map<string, Set<() => void>>();
  const nsMax = new Map<string, number>();

  const nsOf = (key: string) => {
    const i = key.indexOf(":");
    return i < 0 ? key : key.slice(0, i);
  };

  const computeSnap = (e: Entry): QuerySnapshot => {
    const fetching = e.inflight !== undefined;
    let status: QueryStatus;
    if (!e.hasValue) status = e.error !== undefined ? "error" : "loading";
    else {
      const ttl = e.opts.ttlMs ?? DEFAULT_TTL;
      status =
        !e.invalid && now() - e.fetchedAt < ttl && e.error === undefined
          ? "fresh"
          : "stale";
    }
    const prev = e.snap;
    if (
      prev.data === e.value &&
      prev.status === status &&
      prev.error === e.error &&
      prev.fetching === fetching
    )
      return prev;
    return { data: e.value, status, error: e.error, fetching };
  };

  const publish = (e: Entry) => {
    const next = computeSnap(e);
    if (next === e.snap) return;
    e.snap = next;
    const set = listeners.get(e.key);
    if (set) for (const cb of [...set]) cb();
  };

  const touch = (e: Entry) => {
    entries.delete(e.key);
    entries.set(e.key, e);
  };

  const evict = (ns: string) => {
    const max = nsMax.get(ns) ?? DEFAULT_MAX;
    let count = 0;
    for (const e of entries.values()) if (e.ns === ns) count++;
    if (count <= max) return;
    for (const e of [...entries.values()]) {
      if (count <= max) break;
      if (e.ns !== ns || e.inflight || listeners.get(e.key)?.size) continue;
      entries.delete(e.key);
      count--;
      metrics.count("cache.evict");
    }
  };

  const ensure = <T>(key: string, opts: QueryOptions<T>): Entry<T> => {
    let e = entries.get(key) as Entry<T> | undefined;
    if (!e) {
      e = {
        key,
        ns: nsOf(key),
        hasValue: false,
        value: undefined,
        fetchedAt: 0,
        invalid: false,
        error: undefined,
        tags: new Set(),
        epoch: 0,
        opts,
        snap: IDLE as QuerySnapshot<T>,
      };
      entries.set(key, e as Entry);
      if (opts.maxEntries) nsMax.set(e.ns, opts.maxEntries);
      evict(e.ns);
    } else {
      touch(e as Entry);
      e.opts = opts;
      if (opts.maxEntries) nsMax.set(e.ns, opts.maxEntries);
    }
    for (const t of opts.tags ?? []) e.tags.add(t);
    return e;
  };

  const commit = <T>(e: Entry<T>, raw: T): T => {
    assertNoSecretFields(raw, `queryStore(${e.key})`);
    const reconcile = e.opts.reconcile ?? structuralShare;
    const value = e.hasValue ? reconcile(e.value, raw) : raw;
    e.value = value;
    e.hasValue = true;
    e.fetchedAt = now();
    e.invalid = false;
    e.error = undefined;
    return value;
  };

  const startFetch = <T>(
    e: Entry<T>,
    fetcher: () => Promise<T>,
  ): Promise<T> => {
    if (e.inflight) {
      metrics.count("cache.dedupe");
      return e.inflight;
    }
    metrics.count("cache.fetch");
    const epoch = e.epoch;
    const p: Promise<T> = (async () => {
      try {
        const raw = await fetcher();
        if (e.epoch === epoch && entries.get(e.key) === (e as Entry)) {
          return commit(e, raw);
        }
        return raw; // invalidated/cleared meanwhile: caller gets it, cache does not
      } catch (err) {
        if (e.epoch === epoch && entries.get(e.key) === (e as Entry)) {
          e.error = err;
          if (!e.hasValue && !listeners.get(e.key)?.size) entries.delete(e.key);
        }
        throw err;
      } finally {
        if (e.inflight === p) e.inflight = undefined;
        if (entries.get(e.key) === (e as Entry)) publish(e as Entry);
      }
    })();
    e.inflight = p;
    publish(e as Entry);
    return p;
  };

  const store = {
    /**
     * Get a value: fresh -> cached; within ttl+staleMs -> cached now and one
     * background revalidate; otherwise fetch (concurrent callers share one fetch).
     */
    get<T>(
      key: string,
      fetcher: () => Promise<T>,
      opts: QueryOptions<T> = {},
    ): Promise<T> {
      if ((opts as { secret?: boolean }).secret === true)
        return Promise.reject(
          new Error("[perf] secret values are never cacheable"),
        );
      const e = ensure(key, opts);
      e.fetcher = fetcher;
      if (e.hasValue && !e.invalid) {
        const age = now() - e.fetchedAt;
        const ttl = opts.ttlMs ?? DEFAULT_TTL;
        if (age < ttl) {
          metrics.count("cache.hit");
          return Promise.resolve(e.value as T);
        }
        if (age < ttl + (opts.staleMs ?? DEFAULT_STALE)) {
          metrics.count("cache.stale");
          publish(e);
          startFetch(e, fetcher).catch(() => undefined);
          return Promise.resolve(e.value as T);
        }
      }
      metrics.count("cache.miss");
      return startFetch(e, fetcher);
    },

    /** Force a fetch now (deduped with any in-flight fetch). Uses the last fetcher unless given. */
    refetch<T>(key: string, fetcher?: () => Promise<T>): Promise<T> {
      const e = entries.get(key) as Entry<T> | undefined;
      const f = fetcher ?? e?.fetcher;
      if (!e || !f)
        return Promise.reject(new Error(`[perf] no fetcher for ${key}`));
      e.fetcher = f;
      return startFetch(e, f);
    },

    /** Synchronous read of the cached value (no fetch, no LRU touch). */
    peek<T>(key: string): T | undefined {
      return entries.get(key)?.value as T | undefined;
    },

    getSnapshot<T = unknown>(key: string): QuerySnapshot<T> {
      return (entries.get(key)?.snap ?? IDLE) as QuerySnapshot<T>;
    },

    subscribe(key: string, cb: () => void): () => void {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(cb);
      return () => {
        set!.delete(cb);
        if (set!.size === 0) listeners.delete(key);
      };
    },

    /** Write a value directly (reconciled, marks fresh). */
    set<T>(key: string, value: T, opts: QueryOptions<T> = {}): T {
      const e = ensure(key, opts);
      e.epoch++;
      e.inflight = undefined;
      const out = commit(e, value);
      publish(e);
      return out;
    },

    /**
     * Mark matching entries stale and discard in-flight results. Entries with
     * active subscribers refetch immediately (stale data stays visible).
     */
    invalidate(match: InvalidateMatch): number {
      const test: (e: Entry) => boolean =
        typeof match === "string"
          ? (e) => e.key === match
          : typeof match === "function"
            ? (e) => match(e.key)
            : "tag" in match
              ? (e) => e.tags.has(match.tag)
              : (e) => e.key.startsWith(match.prefix);
      let n = 0;
      for (const e of [...entries.values()]) {
        if (!test(e)) continue;
        n++;
        e.invalid = true;
        e.epoch++;
        e.inflight = undefined;
        publish(e);
        if (listeners.get(e.key)?.size && e.fetcher)
          startFetch(e, e.fetcher).catch(() => undefined);
      }
      metrics.count("cache.invalidate", n);
      return n;
    },

    /**
     * Invalidate when a BACKGROUND event fires. One shared Tauri listener per
     * event name no matter how many callers. Returns dispose.
     */
    invalidateOnEvent(eventName: string, match: InvalidateMatch): () => void {
      assertBackgroundEvent(eventName, "invalidateOnEvent");
      return subscribeEvent(eventName, () => {
        store.invalidate(match);
      });
    },

    /**
     * Optimistic mutation. `apply` patches the cached value immediately; `run`
     * is the (real-time lane) write; on failure the pre-apply value is
     * restored and the error rethrown. On success, `commit` (if given)
     * reconciles with the server value, then matching tags/keys are invalidated.
     */
    async mutate<T, R = unknown>(
      key: string,
      m: {
        apply?: (prev: T | undefined) => T;
        run: () => Promise<R>;
        commit?: (result: R, current: T | undefined) => T;
        invalidate?: readonly InvalidateMatch[];
      },
    ): Promise<R> {
      const e = entries.get(key) as Entry<T> | undefined;
      const before = e && {
        hasValue: e.hasValue,
        value: e.value,
        fetchedAt: e.fetchedAt,
        invalid: e.invalid,
      };
      let applied: T | undefined;
      if (e && m.apply) {
        e.epoch++; // an in-flight refetch must not overwrite the optimistic value
        e.inflight = undefined;
        applied = m.apply(e.value);
        e.value = applied;
        e.hasValue = true;
        publish(e as Entry);
        metrics.count("cache.optimistic");
      }
      try {
        const result = await m.run();
        const cur = entries.get(key) as Entry<T> | undefined;
        if (cur && m.commit) {
          cur.epoch++;
          const next = m.commit(result, cur.value);
          cur.value = cur.hasValue ? structuralShare(cur.value, next) : next;
          cur.hasValue = true;
          cur.fetchedAt = now();
          cur.invalid = false;
          publish(cur as Entry);
        }
        for (const inv of m.invalidate ?? []) store.invalidate(inv);
        return result;
      } catch (err) {
        const cur = entries.get(key) as Entry<T> | undefined;
        if (cur && before && m.apply) {
          // Only roll back if nobody replaced our optimistic value meanwhile.
          if (cur.value === applied) {
            cur.epoch++;
            cur.value = before.value;
            cur.hasValue = before.hasValue;
            cur.fetchedAt = before.fetchedAt;
            cur.invalid = before.invalid;
            publish(cur as Entry);
          } else {
            store.invalidate(key);
          }
          metrics.count("cache.rollback");
        }
        throw err;
      }
    },

    /** Drop everything (lock, logout, DB switch). In-flight results are discarded. */
    clearAll(): void {
      const keys = [...entries.keys()];
      for (const e of entries.values()) {
        e.epoch++;
        e.inflight = undefined;
      }
      entries.clear();
      for (const key of keys) {
        const set = listeners.get(key);
        if (set) for (const cb of [...set]) cb();
      }
    },

    get size(): number {
      return entries.size;
    },
    keys(): string[] {
      return [...entries.keys()];
    },
    namespaceSize(ns: string): number {
      let n = 0;
      for (const e of entries.values()) if (e.ns === ns) n++;
      return n;
    },
  };

  registerCache(deps.name ?? "queryStore", {
    clear: store.clearAll,
    size: () => entries.size,
  });
  return store;
}

export type QueryStore = ReturnType<typeof createQueryStore>;

/** The app-wide store. */
export const queryStore: QueryStore = createQueryStore();
