/**
 * Small, memory-only, bounded keyed cache shared by the tab preloaders.
 *
 * - LRU with a hard entry cap (oldest entry evicted first).
 * - Concurrent loads of one key share a single in-flight promise.
 * - `subscribe`/`getSnapshot`-compatible so a component may use
 *   `useSyncExternalStore`.
 * - Every cache registers itself so lock/logout/vault-close can wipe all of
 *   them with `clearAllPreloadCaches()`.
 *
 * Never put secret values in a cache. Callers store metadata or data the UI
 * already holds while its tab is open, and drop it on lock.
 */
export interface MemoryCache<T> {
  get(key: string): T | undefined;
  has(key: string): boolean;
  set(key: string, value: T): void;
  delete(key: string): void;
  /** Drop every entry whose key does not satisfy `keep`. */
  retain(keep: (key: string) => boolean): void;
  clear(): void;
  readonly size: number;
  /**
   * Run `loader` once per key at a time. Concurrent callers share the promise.
   * A result is only stored if the cache was not cleared/invalidated meanwhile.
   */
  load(key: string, loader: () => Promise<T>): Promise<T>;
  inflight(key: string): boolean;
  /** Mark a key stale: its value is dropped and any in-flight result discarded. */
  invalidate(key: string): void;
  subscribe(listener: () => void): () => void;
  readonly version: number;
}

const registry = new Set<() => void>();

/** Wipe every registered preload cache (lock, logout, vault close). */
export function clearAllPreloadCaches(): void {
  for (const clear of registry) clear();
}

export function createMemoryCache<T>(maxEntries: number): MemoryCache<T> {
  if (!Number.isInteger(maxEntries) || maxEntries < 1)
    throw new Error("maxEntries must be a positive integer");
  const entries = new Map<string, T>();
  const pending = new Map<string, { promise: Promise<T>; epoch: number }>();
  const epochs = new Map<string, number>();
  let globalEpoch = 0;
  let version = 0;
  const listeners = new Set<() => void>();
  const bump = () => {
    version += 1;
    for (const listener of [...listeners]) listener();
  };
  const epochOf = (key: string) => globalEpoch + (epochs.get(key) ?? 0);
  const cache: MemoryCache<T> = {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key) as T;
      // Touch for LRU order.
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    has: (key) => entries.has(key),
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxEntries)
        entries.delete(entries.keys().next().value as string);
      bump();
    },
    delete(key) {
      if (entries.delete(key)) bump();
    },
    retain(keep) {
      let changed = false;
      for (const key of [...entries.keys()])
        if (!keep(key)) {
          entries.delete(key);
          changed = true;
        }
      if (changed) bump();
    },
    clear() {
      globalEpoch += 1;
      pending.clear();
      if (entries.size) {
        entries.clear();
        bump();
      }
    },
    get size() {
      return entries.size;
    },
    load(key, loader) {
      const existing = pending.get(key);
      if (existing && existing.epoch === epochOf(key)) return existing.promise;
      const epoch = epochOf(key);
      const slot = { promise: undefined as unknown as Promise<T>, epoch };
      slot.promise = (async () => {
        try {
          const value = await loader();
          if (epochOf(key) === epoch) cache.set(key, value);
          return value;
        } finally {
          if (pending.get(key) === slot) pending.delete(key);
        }
      })();
      pending.set(key, slot);
      return slot.promise;
    },
    inflight: (key) => pending.has(key),
    invalidate(key) {
      epochs.set(key, (epochs.get(key) ?? 0) + 1);
      pending.delete(key);
      if (entries.delete(key)) bump();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get version() {
      return version;
    },
  };
  registry.add(cache.clear);
  return cache;
}
