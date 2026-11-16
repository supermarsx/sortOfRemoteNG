import type {
  DatabaseCredentialSnapshot,
  DatabaseCredentialVaultApi,
} from "../../types/security/databaseCredentialVault";
import { createMemoryCache } from "../../utils/preload/memoryCache";

/**
 * Metadata-only snapshot cache for the credential vault tab.
 *
 * Holds exactly what the vault list already exposes (names, ids, tags,
 * available facet names, a review receipt): never a password, key, TOTP seed
 * or device token. Memory only, bounded, scoped to one database generation and
 * wiped on lock / scope change. A cached snapshot is display data: every
 * mutation or disclosure is still re-verified by the Provider through the
 * receipt, so a stale entry can only fail closed.
 */
interface Entry {
  snapshot: DatabaseCredentialSnapshot;
  /** `api.changeRevision` the snapshot was read under. */
  revision: number;
  at: number;
}

/** A matching revision younger than this needs no native re-verification on tab switch. */
export const VAULT_FRESH_MS = 15_000;
const MAX_ENTRIES = 3;

const cache = createMemoryCache<Entry>(MAX_ENTRIES);
const inflightRevision = new Map<string, number>();
let clock = () => Date.now();

export const scopeKeyOf = (api: DatabaseCredentialVaultApi): string | null =>
  api.scope
    ? JSON.stringify([api.scope.databaseId, api.scope.generation])
    : null;

export function cachedVaultEntry(
  api: DatabaseCredentialVaultApi,
): Entry | undefined {
  const key = scopeKeyOf(api);
  return key ? cache.get(key) : undefined;
}

export function cachedVaultSnapshot(
  api: DatabaseCredentialVaultApi,
): DatabaseCredentialSnapshot | null {
  return cachedVaultEntry(api)?.snapshot ?? null;
}

/** True when switching back needs no native round trip at all. */
export function isVaultCacheFresh(api: DatabaseCredentialVaultApi): boolean {
  const entry = cachedVaultEntry(api);
  return (
    !!entry &&
    entry.revision === api.changeRevision &&
    clock() - entry.at < VAULT_FRESH_MS
  );
}

/** Drop everything not belonging to the current owner (or everything if locked). */
export function purgeVaultCache(api: DatabaseCredentialVaultApi): void {
  const key = scopeKeyOf(api);
  if (!key) cache.clear();
  else cache.retain((candidate) => candidate === key);
  for (const candidate of [...inflightRevision.keys()])
    if (candidate !== key) inflightRevision.delete(candidate);
}

export function clearVaultCache(): void {
  cache.clear();
  inflightRevision.clear();
}

/**
 * One in-flight `list` per scope and revision. `fresh` forces a new read even if
 * one is in flight (used after our own mutation, whose receipts expired).
 */
export function loadVaultSnapshot(
  api: DatabaseCredentialVaultApi,
  options: { fresh?: boolean } = {},
): Promise<DatabaseCredentialSnapshot> {
  const key = scopeKeyOf(api);
  if (!key || !api.scope) return Promise.reject(new Error("Vault unavailable"));
  const revision = api.changeRevision;
  const scope = { ...api.scope };
  if (
    options.fresh ||
    (cache.inflight(key) && inflightRevision.get(key) !== revision)
  )
    cache.invalidate(key);
  inflightRevision.set(key, revision);
  return cache
    .load(key, async () => ({
      snapshot: await api.list(scope),
      revision,
      at: clock(),
    }))
    .then((entry) => entry.snapshot)
    .finally(() => {
      if (!cache.inflight(key)) inflightRevision.delete(key);
    });
}

/**
 * Warm the cache without surfacing errors or prompting. `api.list` only
 * succeeds for an already unlocked, verified, managed database; otherwise it
 * rejects and nothing is cached.
 */
export async function preloadCredentialVault(
  api: DatabaseCredentialVaultApi,
): Promise<void> {
  purgeVaultCache(api);
  if (!api.scope || isVaultCacheFresh(api)) return;
  try {
    await loadVaultSnapshot(api);
  } catch {
    /* Locked, unavailable or changed: the tab will show its own state. */
  }
}

export const vaultCacheSubscribe = cache.subscribe;

/** Test hook. */
export function setVaultCacheClockForTests(next?: () => number): void {
  clock = next ?? (() => Date.now());
}
export const vaultCacheSizeForTests = () => cache.size;
