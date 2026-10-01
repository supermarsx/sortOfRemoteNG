import type {
  TrustExportRecord,
  TrustRecordTimestamps,
  TrustTimestampSource,
} from "./trustStore";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface PreciseTrustTimestamp {
  /** Whole UTC seconds; fractional precision is kept separately from Date. */
  seconds: number;
  /** Chrono represents a leap second as second 59 with nanos >= 1e9. */
  nanoseconds: number;
}

/** Match chrono's bounded RFC3339 evidence parser without rounding nanoseconds. */
function parseTrustTimestamp(
  value: unknown,
): PreciseTrustTimestamp | undefined {
  if (typeof value !== "string" || value.length > 128) return undefined;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|([+\-\u2212])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (
    !match ||
    match[0] !== value ||
    (value.includes("\u2212") && value.length + 2 > 128)
  )
    return undefined;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fraction = "",
    sign,
    offsetHourText = "0",
    offsetMinuteText = "0",
  ] = match;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offsetHourText,
    offsetMinuteText,
  ].map(Number);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 60 ||
    offsetHour > 23 ||
    offsetMinute > 59
  )
    return undefined;
  const date = new Date(0);
  // setUTCFullYear preserves years 0000..0099 (Date.UTC would add 1900).
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  date.setUTCHours(hour, minute, Math.min(second, 59), 0);
  const offset =
    (offsetHour * 60 + offsetMinute) * 60 * (sign === "+" ? 1 : -1);
  return {
    seconds: date.getTime() / 1000 - offset,
    nanoseconds:
      Number(fraction.slice(0, 9).padEnd(9, "0")) +
      (second === 60 ? 1_000_000_000 : 0),
  };
}

function compareTrustTimestamps(
  a: PreciseTrustTimestamp,
  b: PreciseTrustTimestamp,
): number {
  return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;
}

function formatTrustTimestamp(value: PreciseTrustTimestamp): string {
  const date = new Date(value.seconds * 1000);
  const pad = (number: number, width = 2) =>
    String(number).padStart(width, "0");
  const year = date.getUTCFullYear();
  const yearText =
    year < 0 ? `-${pad(-year, 4)}` : year > 9999 ? `+${year}` : pad(year, 4);
  const nanos = value.nanoseconds % 1_000_000_000;
  const fraction =
    nanos === 0
      ? ""
      : nanos % 1_000_000 === 0
        ? `.${pad(nanos / 1_000_000, 3)}`
        : nanos % 1000 === 0
          ? `.${pad(nanos / 1000, 6)}`
          : `.${pad(nanos, 9)}`;
  const second =
    date.getUTCSeconds() + (value.nanoseconds >= 1_000_000_000 ? 1 : 0);
  return `${yearText}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(second)}${fraction}+00:00`;
}

/** Wire metadata validation using the same chronology and source rules as native. */
export function isValidTrustRecordTimestamps(
  value: unknown,
): value is TrustRecordTimestamps {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    Object.keys(value).some(
      (key) =>
        ![
          "version",
          "created_at",
          "updated_at",
          "created_at_source",
          "updated_at_source",
        ].includes(key),
    )
  )
    return false;
  const isSource = (source: unknown) =>
    source === "recorded" || source === "inferred" || source === "unknown";
  if (!isSource(value.created_at_source) || !isSource(value.updated_at_source))
    return false;
  const created = parseTrustTimestamp(value.created_at);
  const updated = parseTrustTimestamp(value.updated_at);
  if (!created || !updated || compareTrustTimestamps(updated, created) < 0)
    return false;
  const isEpoch = (date: PreciseTrustTimestamp) =>
    date.seconds === 0 && date.nanoseconds === 0;
  return (
    (value.created_at_source !== "unknown" || isEpoch(created)) &&
    (value.updated_at_source !== "unknown" || isEpoch(updated))
  );
}

/**
 * Pure legacy inference matching native infer_record_timestamps. Call only when
 * timestamps is absent/null during archive normalization; retain existing metadata.
 * Historical dates are evidence, not exact lifecycle times or sync authority.
 */
export function inferLegacyTrustRecordTimestamps(
  record: TrustExportRecord,
): TrustRecordTimestamps {
  let earliest: PreciseTrustTimestamp | undefined;
  let latest: PreciseTrustTimestamp | undefined;
  const add = (value: unknown) => {
    const parsed = parseTrustTimestamp(value);
    if (!parsed) return;
    if (!earliest || compareTrustTimestamps(parsed, earliest) < 0)
      earliest = parsed;
    if (!latest || compareTrustTimestamps(parsed, latest) > 0) latest = parsed;
  };
  const addIdentity = (identity: unknown) => {
    if (!isObject(identity)) return;
    add(identity.first_seen);
    add(identity.last_seen);
  };
  addIdentity(record.identity);
  add(record.first_trusted);
  add(record.stats?.last_verified);
  add(record.stats?.last_mismatch);
  for (const entry of record.history ?? []) {
    if (!isObject(entry)) continue;
    addIdentity(entry.identity);
    add(entry.changed_at);
  }
  const source: TrustTimestampSource = earliest ? "inferred" : "unknown";
  const epoch = { seconds: 0, nanoseconds: 0 };
  return {
    version: 1,
    created_at: formatTrustTimestamp(earliest ?? epoch),
    updated_at: formatTrustTimestamp(latest ?? epoch),
    created_at_source: source,
    updated_at_source: source,
  };
}
