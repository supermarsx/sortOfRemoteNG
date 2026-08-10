import { describe, expect, it } from "vitest";
import {
  formatBulkTerminalPreview,
  MAX_BULK_TERMINAL_PREVIEW_BYTES,
} from "./bulkTerminalPreview";

describe("Bulk SSH terminal preview formatting", () => {
  it("strips CSI, OSC, C0, and C1 controls while preserving tabs/newlines", () => {
    const raw =
      "\u001b[31mred\u001b[0m\tvalue\r\n" +
      "\u001b]0;secret title\u0007next\u0000\u0001\u0085line";

    expect(formatBulkTerminalPreview(raw)).toBe("red\tvalue\nnextline");
    expect(formatBulkTerminalPreview("\u0090hidden-payload\u009cvisible")).toBe(
      "visible",
    );
  });

  it("keeps the complete formatted preview inside the 64 KiB UTF-8 budget", () => {
    const formatted = formatBulkTerminalPreview(`head\n${"🙂".repeat(40_000)}`);

    expect(new TextEncoder().encode(formatted).length).toBeLessThanOrEqual(
      MAX_BULK_TERMINAL_PREVIEW_BYTES,
    );
    expect(formatted).toMatch(/^\[Earlier terminal output omitted\]\n/);
    expect(formatted).not.toContain("\uFFFD");
  });
});
