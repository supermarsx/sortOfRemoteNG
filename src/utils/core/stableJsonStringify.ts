/** Deterministic JSON identity for in-memory comparisons, never a log or hash.
 * Match JSON persistence semantics (including Date/toJSON and omitted undefined
 * properties), then order object keys. Array order remains significant.
 */
export function stableJsonStringify(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new TypeError("A JSON-serializable comparison value is required.");
  const plain: unknown = JSON.parse(serialized);
  return JSON.stringify(plain, (_key, entry: unknown) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : entry,
  );
}
