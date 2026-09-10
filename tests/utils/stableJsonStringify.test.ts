import { describe, expect, it } from "vitest";
import { stableJsonStringify } from "../../src/utils/core/stableJsonStringify";

describe("stable JSON comparison identities", () => {
  it("ignores recursive object key order without modifying the input", () => {
    const input = { z: [{ port: 443, host: "fixture" }], a: true };
    const before = JSON.stringify(input);
    expect(stableJsonStringify(input)).toBe(
      stableJsonStringify({ a: true, z: [{ host: "fixture", port: 443 }] }),
    );
    expect(JSON.stringify(input)).toBe(before);
  });
  it("retains every array position and security value", () => {
    const input = {
      fields: [
        { name: "one", value: "secret" },
        { name: "two", value: "other" },
      ],
      enabled: true,
    };
    expect(stableJsonStringify(input)).not.toBe(
      stableJsonStringify({ ...input, fields: [...input.fields].reverse() }),
    );
    expect(stableJsonStringify(input)).not.toBe(
      stableJsonStringify({ ...input, enabled: false }),
    );
    expect(stableJsonStringify(input)).not.toBe(
      stableJsonStringify({
        ...input,
        fields: [{ name: "one", value: "changed" }, input.fields[1]],
      }),
    );
  });
  it("matches the native JSON roundtrip for dates, toJSON, undefined, and shared references", () => {
    const shared = { b: 2, a: 1 };
    const input = {
      date: new Date("2026-09-10T00:00:00Z"),
      missing: undefined,
      list: [undefined, shared, shared],
      value: { toJSON: () => ({ z: 1, a: 2 }) },
    };
    expect(stableJsonStringify(input)).toBe(
      stableJsonStringify(JSON.parse(JSON.stringify(input))),
    );
    expect(stableJsonStringify(input)).toContain(
      '"date":"2026-09-10T00:00:00.000Z"',
    );
    expect(stableJsonStringify(input)).not.toContain('"missing"');
    expect(stableJsonStringify(input)).toContain('"list":[null,');
  });
  it("rejects non-JSON top-level values and cycles rather than equating them", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => stableJsonStringify(cyclic)).toThrow();
    expect(() => stableJsonStringify(undefined)).toThrow();
  });
});
