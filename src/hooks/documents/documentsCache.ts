import type {
  DatabaseDocuments,
  DatabaseDocumentStore,
  DocumentScope,
} from "../../types/documents/document";
import { normalizeDatabaseDocuments } from "../../utils/documents/validation";
import { createMemoryCache } from "../../utils/preload/memoryCache";

/**
 * Memory-only, bounded copy of the last reviewed document library per owner.
 *
 * It is display data for stale-while-revalidate: a tab shows it at once and
 * re-reads in the background. It never carries a review receipt (so it cannot
 * authorise a save), is wiped on lock/unlock (and by `clearAllPreloadCaches`),
 * and is consulted only after the store's own access gate has opened.
 */
const MAX_ENTRIES = 3;
const cache = createMemoryCache<DatabaseDocuments>(MAX_ENTRIES);

/**
 * App-wide access epochs are per hook instance, so they are not part of the key
 * (lock wipes the cache). Database scopes keep their provider generation.
 */
export function documentsCacheKey(scope: DocumentScope): string {
  return (scope.kind ?? "database") === "app"
    ? `app:${scope.databaseId}`
    : `database:${scope.databaseId}:${scope.generation}`;
}

export const cachedDocuments = (scope: DocumentScope | null | undefined) =>
  scope ? cache.get(documentsCacheKey(scope)) : undefined;

export function rememberDocuments(
  scope: DocumentScope,
  data: DatabaseDocuments,
): void {
  cache.set(documentsCacheKey(scope), data);
}

export const clearDocumentsCache = () => cache.clear();

/** Drop entries of other database generations of this owner. */
export function purgeStaleDocuments(scope: DocumentScope): void {
  const keep = documentsCacheKey(scope);
  const prefix = keep.startsWith("app:")
    ? "app:"
    : `database:${scope.databaseId}:`;
  cache.retain((key) => key === keep || !key.startsWith(prefix));
}

/**
 * Warm one store. Skips silently when the store is closed/locked or a read is
 * already in flight; `store.read` itself refuses anything not unlocked.
 */
export async function preloadDocuments(
  store: DatabaseDocumentStore | undefined,
): Promise<void> {
  const scope = store?.scope;
  if (!store || !scope) return;
  const key = documentsCacheKey(scope);
  if (cache.has(key) || cache.inflight(key)) return;
  try {
    await cache.load(key, async () => {
      const data = normalizeDatabaseDocuments(await store.read({ ...scope }));
      // The store must still be the same owner when the read lands.
      const now = store.scope;
      if (
        !now ||
        now.databaseId !== scope.databaseId ||
        now.generation !== scope.generation
      )
        throw new Error("Document owner changed");
      return data;
    });
  } catch {
    /* Locked or unavailable: the tab renders its own state. */
  }
}

export const documentsCacheSizeForTests = () => cache.size;
