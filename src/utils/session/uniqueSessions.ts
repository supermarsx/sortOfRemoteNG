import type {
  ConnectionSession,
  TabLayout,
} from "../../types/connection/connection";

/**
 * Collapses entries that share an id, keeping the first occurrence's position
 * and the LAST occurrence's value (newest write wins). Returns the same array
 * instance when there are no duplicates so memoised consumers stay stable.
 */
export function uniqueById<T extends { id: string }>(items: readonly T[]): T[];
export function uniqueById<T>(
  items: readonly T[],
  getId: (item: T) => string,
): T[];
export function uniqueById<T>(
  items: readonly T[],
  getId: (item: T) => string = (item) => (item as { id: string }).id,
): T[] {
  const indexById = new Map<string, number>();
  let result: T[] | null = null;
  items.forEach((item, index) => {
    const id = getId(item);
    const first = indexById.get(id);
    if (first === undefined) {
      indexById.set(id, result ? result.length : index);
      result?.push(item);
      return;
    }
    if (!result) {
      result = items.slice(0, index) as T[];
    }
    result[first] = item;
  });
  return result ?? (items as T[]);
}

export const uniqueSessionsById = (
  sessions: readonly ConnectionSession[],
): ConnectionSession[] => uniqueById(sessions);

/** Drops layout slots that reference the same session id more than once. */
export const dedupeTabLayout = (layout: TabLayout): TabLayout => {
  const slots = layout.sessions;
  const seen = new Set<string>();
  let duplicate = false;
  for (const slot of slots) {
    if (seen.has(slot.sessionId)) {
      duplicate = true;
      break;
    }
    seen.add(slot.sessionId);
  }
  if (!duplicate) return layout;
  const kept = new Set<string>();
  return {
    ...layout,
    sessions: slots.filter((slot) => {
      if (kept.has(slot.sessionId)) return false;
      kept.add(slot.sessionId);
      return true;
    }),
  };
};
