/**
 * Canonical record instants are UTC ISO strings at millisecond precision.
 * Legacy numeric values are Unix milliseconds and ISO calendar dates mean UTC
 * midnight. A timezone-free date-time is ambiguous and is never parsed using
 * the current device's timezone. Keep this contract identical on every device.
 */
export function normalizeRecordTimestamp(value: unknown): string | undefined {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return undefined;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) &&
      date.getUTCFullYear() >= 0 &&
      date.getUTCFullYear() <= 9999
      ? date.toISOString()
      : undefined;
  }
  if (typeof value !== "string") return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) value += "T00:00:00.000Z";
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return undefined;
  const [, y, m, d, h, min, s, , zone] = match;
  const year = Number(y),
    month = Number(m),
    day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    Number(h) > 23 ||
    Number(min) > 59 ||
    Number(s) > 59 ||
    (zone !== "Z" &&
      (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
  )
    return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? normalizeRecordTimestamp(time) : undefined;
}

/** Review must not turn a legacy date without an offset into a known instant. */
export function normalizeZonedTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.includes("T")) return undefined;
  return normalizeRecordTimestamp(value);
}
