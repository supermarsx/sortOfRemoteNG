import { describe, expect, it, vi } from "vitest";
import { snapshotRecordPayload } from "../../src/utils/storage/recordLedger";

describe("runtime record payload serialization", () => {
  it("converts nested connection/recycle-bin dates without changing the input", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    const input = {
      connections: [{ createdAt: date }],
      recycleBin: { entries: [{ connection: { updatedAt: date } }] },
    };
    expect(snapshotRecordPayload(input)).toEqual(
      JSON.parse(JSON.stringify(input)),
    );
    expect(input.connections[0].createdAt).toBe(date);
  });

  it("retains strict validation and never runs getters or custom serialization", () => {
    const getter = vi.fn();
    const toJSON = vi.fn();
    const accessor = Object.defineProperty({}, "secret", {
      enumerable: true,
      get: getter,
    });
    for (const value of [
      new Date(NaN),
      new Map(),
      accessor,
      { toJSON },
      Object.assign(new Date(), { toJSON }),
    ]) {
      expect(() => snapshotRecordPayload({ value })).toThrow(
        "Invalid record ledger",
      );
    }
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
    expect(() => snapshotRecordPayload({ recordMetadata: new Date() })).toThrow(
      "runtime object",
    );
    expect(() =>
      snapshotRecordPayload({ recordMetadata: { version: 999 } }),
    ).toThrow("Invalid record ledger");
  });
});
