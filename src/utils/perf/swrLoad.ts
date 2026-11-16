/**
 * Reopen-time stale-while-revalidate for management panels (iDRAC, Proxmox,
 * Synology, iLO, ...). Background lane only; never used for real-time I/O.
 *
 *  - First load after a (re)open applies the cached value synchronously, then
 *    revalidates; if the value is still inside `ttlMs` nothing is fetched.
 *  - The revalidated value is structurally shared with the cached one, so an
 *    unchanged panel gets the SAME reference and React skips the update.
 *  - Mutations call through and then invalidate the device tag.
 *  - Secrets are never cached: callers pass only read results, the queryStore
 *    refuses secret-named fields in dev, and `cacheRefusalReason` is checked
 *    for every command a loader reads.
 */
import { cacheKeyFor } from "./cachedInvoke";
import { queryStore } from "./queryStore";
import { cacheRefusalReason } from "./safety";

export interface SwrDevice {
  /** Namespace, e.g. "idrac" (LRU cap and tag are per namespace + device). */
  ns: string;
  /** Stable device identity (host:port:user...). NEVER a password/token. */
  device: string;
}

const READ_VERB =
  /(?:^|_)(?:get|list|check|is|has|query|find|describe|status|read|fetch|search|info|count|rrd)(?:_|$)/;
/** Session lifecycle: same device + same login => same data, keep the cache. */
const SESSION_VERB = /(?:^|_)(?:connect|disconnect|login|logout|ping)(?:_|$)/;

/** True when a command changes device state (invalidate the device cache). */
export function isMutatingCommand(cmd: string): boolean {
  if (SESSION_VERB.test(cmd)) return false;
  return !READ_VERB.test(cmd);
}

export function deviceTag(d: SwrDevice): string {
  return `${d.ns}-device:${d.device}`;
}

/** Drop everything cached for one device (call after a write completes). */
export function invalidateDevice(d: SwrDevice): void {
  queryStore.invalidate({ tag: deviceTag(d) });
}

/** Drop everything cached for a namespace (process-wide clients: Proxmox). */
export function invalidateNamespace(ns: string): void {
  queryStore.invalidate((key) => key.startsWith(`${ns}:`));
}

/** Call after `cmd` has succeeded; invalidates when it was a write. */
export function noteCommandDone(d: SwrDevice, cmd: string): void {
  if (isMutatingCommand(cmd)) invalidateDevice(d);
}

export interface SwrLoadOptions {
  /** Fresh window; inside it no network call is made. Default 10 s. */
  ttlMs?: number;
}

/**
 * Read for a device, returning the fresh value. `onCached` receives the
 * cached value synchronously (before any await) when one exists, so a panel
 * can paint on first render and revalidate behind it. A secret/real-time/write
 * command in `cmds` makes this a plain uncached fetch.
 */
export function swrRead<T>(
  d: SwrDevice | null,
  loader: string,
  cmds: readonly string[],
  fetcher: () => Promise<T>,
  onCached?: (value: T) => void,
  opts: SwrLoadOptions = {},
): Promise<T> {
  if (!d || !d.device || cmds.some((c) => cacheRefusalReason(c)))
    return fetcher();
  const key = cacheKeyFor(`${d.ns}_${loader}`, { device: d.device });
  const cached = queryStore.getSnapshot<T>(key);
  if (cached.data !== undefined && onCached) onCached(cached.data as T);
  return queryStore.get<T>(key, fetcher, {
    ttlMs: opts.ttlMs ?? 10_000,
    staleMs: 0,
    tags: [deviceTag(d)],
    maxEntries: 100,
  });
}

/**
 * Load `loader` for a device: apply cached first, revalidate, apply fresh
 * (only when it differs from what was applied). Rejects exactly when
 * `fetcher` rejects (callers keep their error handling).
 */
export async function swrLoad<T>(
  d: SwrDevice | null,
  loader: string,
  cmds: readonly string[],
  fetcher: () => Promise<T>,
  apply: (value: T) => void,
  opts: SwrLoadOptions = {},
): Promise<void> {
  let applied: T | undefined;
  let didApply = false;
  const value = await swrRead(
    d,
    loader,
    cmds,
    fetcher,
    (v) => {
      applied = v;
      didApply = true;
      apply(v);
    },
    opts,
  );
  if (!didApply || value !== applied) apply(value);
}
