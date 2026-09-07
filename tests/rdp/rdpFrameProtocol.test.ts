import { describe, expect, it } from "vitest";
import {
  parseRdpNalEnvelope,
  parseRdpRgbaEnvelope,
} from "../../src/components/rdp/rdpFrameProtocol";

function nalEnvelope(rectCount: number, width = 3840, height = 2160) {
  const data = new ArrayBuffer(28 + rectCount * 8 + 5);
  const view = new DataView(data);
  view.setUint32(0, 0x324c414e, true);
  view.setUint16(4, 7, true);
  view.setUint16(10, width, true);
  view.setUint16(12, height, true);
  view.setUint32(20, rectCount, true);
  view.setUint32(24, 5, true);
  for (let i = 0; i < rectCount; i++) {
    view.setUint16(28 + i * 8 + 4, 1, true);
    view.setUint16(28 + i * 8 + 6, 1, true);
  }
  new Uint8Array(data, 28 + rectCount * 8).set([0, 0, 1, 0x65, 1]);
  return data;
}

describe("RDP frame envelope bounds", () => {
  it.each([32400, 129600, 262144])(
    "keeps %i mask rectangles as compact wire views",
    (count) => {
      const data = nalEnvelope(count, 7680, 4320);
      const parsed = parseRdpNalEnvelope(data);
      expect(parsed.regionCount).toBe(count);
      expect(parsed.regionData?.buffer).toBe(data);
      expect(parsed.regionData?.byteLength).toBe(count * 8);
      expect(parsed.codedWidth).toBe(0);
      expect(parsed.offset).toBe(28 + count * 8);
    },
  );

  it("rejects oversized, truncated, out-of-surface and mismatched coded-dimension metadata", () => {
    expect(() => parseRdpNalEnvelope(nalEnvelope(262145))).toThrow("bounds");
    const data = nalEnvelope(1);
    expect(() => parseRdpNalEnvelope(data.slice(0, -1))).toThrow("bounds");
    const view = new DataView(data);
    view.setUint16(32, 65535, true);
    expect(() => parseRdpNalEnvelope(data)).toThrow("region");
    view.setUint16(32, 1, true);
    view.setUint16(14, 16, true);
    expect(() => parseRdpNalEnvelope(data)).toThrow("bounds");
  });

  it("uses the same offsets with typed array windows and accepts decode-only masks", () => {
    const inner = nalEnvelope(0);
    const outer = new Uint8Array(inner.byteLength + 7);
    outer.set(new Uint8Array(inner), 3);
    expect(
      parseRdpNalEnvelope(outer.subarray(3, 3 + inner.byteLength)),
    ).toMatchObject({ regionCount: 0, offset: 28 });
  });

  it("checks RGBA snapshot flags and preserves legacy payload offsets", () => {
    expect(parseRdpRgbaEnvelope(new ArrayBuffer(12))).toMatchObject({
      offset: 0,
      frameId: null,
      end: true,
    });
    const data = new ArrayBuffer(24);
    const view = new DataView(data);
    view.setUint32(0, 0x32424752, true);
    view.setUint32(4, 23, true);
    view.setUint16(8, 3, true);
    expect(parseRdpRgbaEnvelope(data)).toEqual({
      offset: 12,
      frameId: 23,
      begin: true,
      end: true,
    });
    view.setUint16(8, 4, true);
    expect(() => parseRdpRgbaEnvelope(data)).toThrow("flags");
  });
});
