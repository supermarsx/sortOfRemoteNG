import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildSmartSyncBaseline,
  smartMergeSyncSection,
} from "../../src/utils/services/cloudSyncSmartMerge";
import {
  normalizeRecordLedger,
  reconcileRecordLedger,
  type RecordLedger,
} from "../../src/utils/storage/recordLedger";
import { normalizeZonedTimestamp } from "../../src/utils/storage/recordTimestamps";

beforeAll(() => vi.stubGlobal("crypto", webcrypto));
afterAll(() => vi.unstubAllGlobals());

const initial = () => ({
  connections: [
    { id: "a", name: "First" },
    { id: "b", name: "Second" },
  ],
});

async function stamp<T extends object>(
  body: T,
  instant: string,
  previous?: RecordLedger,
) {
  const now = normalizeZonedTimestamp(instant);
  if (!now) throw new Error("Test input must include its offset");
  return {
    ...body,
    recordMetadata: await reconcileRecordLedger(body, previous, {
      mode: "write",
      now,
    }),
  };
}

describe("sync consolidation across timezones", () => {
  it("records the same instant identically regardless of source offset", async () => {
    const utc = await stamp(initial(), "2026-10-05T12:00:00.123Z");
    const west = await stamp(initial(), "2026-10-05T08:00:00.123-04:00");
    const east = await stamp(initial(), "2026-10-05T17:45:00.123+05:45");
    expect(west).toEqual(utc);
    expect(east).toEqual(utc);
    expect(await smartMergeSyncSection(west, east)).toEqual({
      conflictCount: 0,
      value: utc,
    });
    for (const event of utc.recordMetadata.journal)
      expect(event.timestamp).toBe("2026-10-05T12:00:00.123Z");
  });

  it("consolidates independent edits during a repeated DST hour and preserves both histories", async () => {
    const base = await stamp(initial(), "2026-10-24T12:00:00Z");
    const localBody = initial(),
      remoteBody = initial();
    localBody.connections[0].name = "Local edit";
    remoteBody.connections[1].name = "Remote edit";
    // Both wall clocks say 01:30, but these are distinct UTC instants.
    const local = await stamp(
      localBody,
      "2026-10-25T01:30:00+01:00",
      base.recordMetadata,
    );
    const remote = await stamp(
      remoteBody,
      "2026-10-25T01:30:00+00:00",
      base.recordMetadata,
    );
    const merged = await smartMergeSyncSection(
      local,
      remote,
      await buildSmartSyncBaseline(base),
    );
    expect(merged.conflictCount).toBe(0);
    const value = merged.value as typeof base;
    expect(value.connections.map((entry) => entry.name)).toEqual([
      "Local edit",
      "Remote edit",
    ]);
    for (const source of [local, remote])
      expect(value.recordMetadata.journal).toEqual(
        expect.arrayContaining(source.recordMetadata.journal),
      );
    expect(normalizeRecordLedger(value.recordMetadata)).toEqual(
      value.recordMetadata,
    );
    expect(await reconcileRecordLedger(value, value.recordMetadata)).toEqual(
      value.recordMetadata,
    );
    // A second pass must not add synthetic edits or repeat the merge.
    expect(
      await smartMergeSyncSection(
        value,
        value,
        await buildSmartSyncBaseline(value),
      ),
    ).toEqual({
      conflictCount: 0,
      value,
    });
  });

  it("still protects genuine concurrent edits even when one zoned timestamp is later", async () => {
    const base = await stamp(initial(), "2026-10-24T12:00:00Z");
    const a = initial(),
      b = initial();
    a.connections[0].name = "First independent edit";
    b.connections[0].name = "Second independent edit";
    const local = await stamp(
      a,
      "2026-10-25T01:30:00+01:00",
      base.recordMetadata,
    );
    const remote = await stamp(
      b,
      "2026-10-25T01:30:00+00:00",
      base.recordMetadata,
    );
    const result = await smartMergeSyncSection(
      local,
      remote,
      await buildSmartSyncBaseline(base),
    );
    expect(result.conflictCount).toBe(1);
    expect(result).not.toHaveProperty("value");
    expect(result.conflicts).toContainEqual({
      code: "concurrent-edit",
      kind: "connections",
      count: 1,
    });
  });
});
