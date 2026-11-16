/**
 * Cached, deduped Tauri read. Refuses real-time, write and secret commands:
 * throws in dev/test, passes through uncached (plain invoke) in production.
 */
import { getInvoke } from "../tauri/invoke";
import { metrics } from "./metrics";
import { queryStore, type QueryOptions } from "./queryStore";
import { cacheRefusalReason, isDevLike } from "./safety";

/** Deterministic JSON: object keys sorted, undefined dropped. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "";
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) {
        if ((v as Record<string, unknown>)[k] !== undefined)
          out[k] = (v as Record<string, unknown>)[k];
      }
      return out;
    }
    return v;
  });
}

let scope = "";
/**
 * Cache scope (active database/profile id). Included in every key; changing it
 * clears the cache so one profile's data never serves another.
 */
export function setCacheScope(next: string): void {
  if (next === scope) return;
  scope = next;
  queryStore.clearAll();
}

export function cacheKeyFor(
  cmd: string,
  args?: Record<string, unknown>,
): string {
  const ns = cmd.split("_")[0] || cmd;
  return `${ns}:${scope}|${cmd}|${stableStringify(args)}`;
}

async function rawInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error(`[perf] Tauri invoke unavailable for ${cmd}`);
  metrics.count(`invoke:${cmd}`);
  return invoke<T>(cmd, args);
}

export type CachedInvokeOptions<T> = QueryOptions<T> & {
  /** Bypass the cache and fetch (user-requested refresh). */
  force?: boolean;
};

export function cachedInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  opts: CachedInvokeOptions<T> = {},
): Promise<T> {
  const refusal = cacheRefusalReason(cmd);
  if (refusal) {
    if (isDevLike())
      return Promise.reject(
        new Error(`[perf] cachedInvoke refuses "${cmd}": ${refusal}`),
      );
    return rawInvoke<T>(cmd, args);
  }
  const key = cacheKeyFor(cmd, args);
  const fetcher = () => rawInvoke<T>(cmd, args);
  if (opts.force) queryStore.invalidate(key);
  return queryStore.get<T>(key, fetcher, opts);
}

/** Query-key helper for useQuery with the same key space as cachedInvoke. */
export function invokeQueryKey(
  cmd: string,
  args?: Record<string, unknown>,
): string {
  return cacheKeyFor(cmd, args);
}

/** Fetcher for useQuery(key, invokeFetcher(cmd,args)); applies the same guard. */
export function invokeFetcher<T>(
  cmd: string,
  args?: Record<string, unknown>,
): () => Promise<T> {
  const refusal = cacheRefusalReason(cmd);
  if (refusal && isDevLike())
    throw new Error(`[perf] invokeFetcher refuses "${cmd}": ${refusal}`);
  return () => rawInvoke<T>(cmd, args);
}
