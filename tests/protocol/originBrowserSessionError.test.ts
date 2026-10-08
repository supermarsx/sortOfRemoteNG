import { describe, expect, it } from "vitest";
import { originBrowserSessionError } from "../../src/hooks/protocol/originBrowserSessionError";
import { originBrowserFailureReason } from "../../src/types/protocols/originBrowser";

const reasons = [
  "renderer",
  "session",
  "callback",
  "native-surface",
  "load",
] as const;
describe("fixed native browser session failure diagnostics", () => {
  it.each(reasons)("accepts %s only in a failed snapshot", (reason) => {
    expect(originBrowserFailureReason("failed", reason)).toBe(reason);
    for (const phase of [
      "starting",
      "attached",
      "closing",
      "closed",
      "other",
      undefined,
    ]) {
      expect(originBrowserFailureReason(phase, reason)).toBeUndefined();
    }
  });

  it.each([
    [
      "renderer",
      "page renderer stopped or its native communication bridge failed",
    ],
    ["session", "private browser session was no longer available or valid"],
    ["callback", "internal native browser callback failed"],
    ["native-surface", "could not maintain the embedded browser view"],
    ["load", "page could not be loaded"],
  ])(
    "explains %s with recovery without diagnosing a GPU cause",
    (reason, detail) => {
      const message = originBrowserSessionError(reason);
      expect(message).toContain(detail);
      expect(message).toContain("Reopen");
      expect(message).toContain("native browser diagnostics");
      expect(message).not.toMatch(
        /GPU|graphics driver|hardware acceleration|password|credentials|https?:\/\//i,
      );
    },
  );

  it.each(
    [
      undefined,
      null,
      false,
      1,
      "",
      "Renderer",
      "future-engine-fault",
      "renderer https://user:SECRET@example.test/?token=SECRET",
      { message: "SECRET" },
      new Error("SECRET"),
      {
        toString() {
          throw new Error("never stringify a native object");
        },
      },
    ].map((reason: unknown) => ({ reason })),
  )(
    "keeps missing, unknown and malformed reasons generic and redacted (%#)",
    ({ reason }) => {
      expect(originBrowserFailureReason("failed", reason)).toBeUndefined();
      const message = originBrowserSessionError(reason);
      expect(message).toContain("No cause was provided by the native browser.");
      expect(message).toContain("Reopen the tab.");
      expect(message).not.toMatch(
        /SECRET|example\.test|token=|future-engine|renderer|GPU/,
      );
    },
  );
});
