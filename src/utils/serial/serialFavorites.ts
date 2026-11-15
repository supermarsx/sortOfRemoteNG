import type { QuickActionReference } from "../../types/connection/sessionQuickActions";
import {
  MAX_QUICK_ACTION_ITEMS,
  normalizeQuickActionReferences,
  quickActionReferenceKey,
} from "../connection/sessionQuickActions";

/**
 * Identifier-only serial favorites. Entries are {kind, id} references into the
 * app-wide terminal library; script text is never copied here. Saved
 * connections keep their own list; Quick Connect sessions (whose connection id
 * is regenerated every time) share one app-wide list.
 */
export const SERIAL_FAVORITES_STORAGE_KEY = "sorng.serial.favorites.v1";
export const SERIAL_QUICK_CONNECT_BUCKET = "quick-connect";
const MAX_BUCKETS = 256;

type Buckets = Record<string, QuickActionReference[]>;

function readAll(storage: Storage | undefined): Buckets {
  if (!storage) return {};
  try {
    const raw = storage.getItem(SERIAL_FAVORITES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const result: Buckets = {};
    for (const [bucket, value] of Object.entries(
      parsed as Record<string, unknown>,
    ).slice(0, MAX_BUCKETS)) {
      try {
        // App-wide references only: a serial favorite never names a database.
        result[bucket] = normalizeQuickActionReferences(value).map(
          ({ kind, id }) => ({ kind, id }),
        );
      } catch {
        // A malformed bucket is ignored, never repaired into something else.
      }
    }
    return result;
  } catch {
    return {};
  }
}

const defaultStorage = (): Storage | undefined =>
  typeof window !== "undefined" ? window.localStorage : undefined;

export function loadSerialFavorites(
  bucket: string,
  storage: Storage | undefined = defaultStorage(),
): QuickActionReference[] {
  return readAll(storage)[bucket] ?? [];
}

export function saveSerialFavorites(
  bucket: string,
  items: readonly QuickActionReference[],
  storage: Storage | undefined = defaultStorage(),
): QuickActionReference[] {
  const normalized = normalizeQuickActionReferences(
    items
      .slice(0, MAX_QUICK_ACTION_ITEMS)
      .map(({ kind, id }) => ({ kind, id })),
  );
  if (!storage) return normalized;
  const all = readAll(storage);
  if (normalized.length === 0) delete all[bucket];
  else all[bucket] = normalized;
  storage.setItem(SERIAL_FAVORITES_STORAGE_KEY, JSON.stringify(all));
  return normalized;
}

export function toggleSerialFavorite(
  bucket: string,
  reference: QuickActionReference,
  storage: Storage | undefined = defaultStorage(),
): QuickActionReference[] {
  const current = loadSerialFavorites(bucket, storage);
  const key = quickActionReferenceKey(reference);
  const exists = current.some((item) => quickActionReferenceKey(item) === key);
  const next = exists
    ? current.filter((item) => quickActionReferenceKey(item) !== key)
    : [...current, { kind: reference.kind, id: reference.id }];
  return saveSerialFavorites(bucket, next, storage);
}
