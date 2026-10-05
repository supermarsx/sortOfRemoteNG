import { describe, expect, it } from "vitest";
import {
  normalizeRecordTimestamp,
  normalizeZonedTimestamp,
} from "../../src/utils/storage/recordTimestamps";

describe("timezone-independent record instants", () => {
  it.each([
    "2026-10-05T12:34:56.789Z",
    "2026-10-05T13:34:56.789+01:00",
    "2026-10-05T08:34:56.789-04:00",
    "2026-10-05T18:19:56.789+05:45",
    "2026-10-06T02:34:56.789+14:00",
  ])("canonicalizes %s to the same UTC instant", (stamp) => {
    expect(normalizeZonedTimestamp(stamp)).toBe("2026-10-05T12:34:56.789Z");
  });

  it("distinguishes repeated local wall times across the DST fall-back", () => {
    const first = normalizeZonedTimestamp("2026-10-25T01:30:00+01:00")!;
    const second = normalizeZonedTimestamp("2026-10-25T01:30:00+00:00")!;
    expect(first).toBe("2026-10-25T00:30:00.000Z");
    expect(second).toBe("2026-10-25T01:30:00.000Z");
    expect(Date.parse(second) - Date.parse(first)).toBe(3_600_000);
  });

  it.each([
    "2026-10-25T01:30:00",
    "2026-10-05 12:34:56",
    "10/05/2026 12:34:56",
    "2026-02-30T12:00:00Z",
    "2025-02-29T12:00:00Z",
    "2026-10-05T24:00:00Z",
    "2026-10-05T12:00:00+24:00",
    "2026-10-05T12:00:00+01:60",
    "2026-10-05T12:00:00Z extra",
    "10000-01-01T00:00:00Z",
  ])("does not guess a timezone or repair an invalid instant: %s", (stamp) => {
    expect(normalizeRecordTimestamp(stamp)).toBeUndefined();
    expect(normalizeZonedTimestamp(stamp)).toBeUndefined();
  });

  it("preserves the legacy ledger contract without calling date-only evidence an explicit zoned instant", () => {
    expect(normalizeRecordTimestamp("2024-02-29")).toBe(
      "2024-02-29T00:00:00.000Z",
    );
    expect(normalizeRecordTimestamp(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(normalizeRecordTimestamp(0.5)).toBeUndefined();
    expect(normalizeRecordTimestamp(Infinity)).toBeUndefined();
    expect(normalizeZonedTimestamp(0)).toBeUndefined();
    expect(normalizeZonedTimestamp("2024-02-29")).toBeUndefined();
    expect(normalizeRecordTimestamp("0001-01-01T00:00:00Z")).toBe(
      "0001-01-01T00:00:00.000Z",
    );
  });
});
