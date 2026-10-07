import { describe, expect, it } from "vitest";
import { originBrowserBounds } from "../../src/types/protocols/originBrowser";

describe("native browser logical viewport contract", () => {
  it("preserves fractional logical pixels and strips extra fields", () => {
    const input = {
      x: 1.25,
      y: 2.5,
      width: 800.5,
      height: 600.25,
      nativeParent: 42,
    };
    expect(originBrowserBounds(input)).toEqual({
      x: 1.25,
      y: 2.5,
      width: 800.5,
      height: 600.25,
    });
    expect(originBrowserBounds(input)).not.toBe(input);
  });

  it.each([
    null,
    { x: -1, y: 0, width: 1, height: 1 },
    { x: 0, y: -1, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0, y: 0, width: 1, height: 0.5 },
    { x: Number.NaN, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: Infinity, height: 1 },
    { x: 32_768, y: 0, width: 1, height: 1 },
    { x: 0, y: 32_768, width: 1, height: 1 },
    { x: 0, y: 0, width: 8193, height: 8192 },
  ])("hides invalid bounds %j", (value) =>
    expect(originBrowserBounds(value)).toBeNull(),
  );

  it("accepts the native area and coordinate limits exactly", () => {
    expect(
      originBrowserBounds({ x: 24_576, y: 24_576, width: 8192, height: 8192 }),
    ).not.toBeNull();
  });
});
