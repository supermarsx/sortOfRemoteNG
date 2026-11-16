/**
 * Structural-sharing reconciliation: a refetch that returns equal data keeps
 * the previous object identities so memoised rows/selectors do not re-render.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

const MAX_DEPTH = 40;

/** Returns `prev` (same identity) when deep-equal to `next`, else the minimal new tree. */
export function structuralShare<T>(prev: unknown, next: T, depth = 0): T {
  if (Object.is(prev, next)) return next;
  if (depth > MAX_DEPTH) return next;
  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length;
    const out = next.map((item, i) => {
      const shared = structuralShare(prev[i], item, depth + 1);
      if (same && shared !== prev[i]) same = false;
      return shared;
    });
    return (same ? prev : out) as unknown as T;
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    let same = prevKeys.length === nextKeys.length;
    const out: Record<string, unknown> = {};
    for (const k of nextKeys) {
      const shared = structuralShare(prev[k], next[k], depth + 1);
      out[k] = shared;
      if (same && (!(k in prev) || shared !== prev[k])) same = false;
    }
    return (same ? prev : out) as unknown as T;
  }
  if (
    prev instanceof Date &&
    next instanceof Date &&
    prev.getTime() === next.getTime()
  )
    return prev as unknown as T;
  return next;
}

/**
 * Row-stable array merge: rows keep prev identity when unchanged, order and
 * membership come from `next`. Returns `prev` itself when nothing changed.
 */
export function mergeById<T>(
  prev: readonly T[] | undefined,
  next: readonly T[],
  idOf: (row: T) => string | number,
): T[] {
  if (!prev || prev.length === 0) return next as T[];
  const byId = new Map<string | number, T>();
  for (const row of prev) byId.set(idOf(row), row);
  let same = prev.length === next.length;
  const out = next.map((row, i) => {
    const old = byId.get(idOf(row));
    const shared = old === undefined ? row : structuralShare(old, row);
    if (same && shared !== prev[i]) same = false;
    return shared;
  });
  return same ? (prev as T[]) : out;
}
