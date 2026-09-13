import { describe, expect, it } from "vitest";
import {
  normalizeTrustMetadata,
  validateTrustDescription,
} from "../../src/utils/security/trustMetadata";

describe("identity metadata bounds", () => {
  it("deduplicates tags and preserves description prose", () => {
    expect(
      normalizeTrustMetadata([" office ", "office", ""], "Line one\nLine two"),
    ).toEqual({ tags: ["office"], description: "Line one\nLine two" });
    expect(normalizeTrustMetadata([], "")).toEqual({
      tags: [],
      description: null,
    });
    expect(validateTrustDescription(undefined)).toBeUndefined();
  });
  it.each(["a".repeat(4097), "🔐".repeat(1025), "nul\0text", 3, {}])(
    "rejects invalid descriptions without echoing them",
    (value) => {
      expect(() => validateTrustDescription(value)).toThrow(/4096 UTF-8 bytes/);
    },
  );
  it("accepts exact multibyte limit but refuses oversized tag sets", () => {
    expect(validateTrustDescription("🔐".repeat(1024))).toHaveLength(2048);
    expect(() =>
      normalizeTrustMetadata(
        Array.from({ length: 101 }, (_, index) => `tag${index}`),
        "",
      ),
    ).toThrow(/100 tags/);
    expect(() => normalizeTrustMetadata(["界".repeat(100)], "")).toThrow(
      /256 UTF-8/,
    );
  });
});
