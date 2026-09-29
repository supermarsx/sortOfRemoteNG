import { describe, expect, it } from "vitest";
import { webPopupTitle } from "../../src/utils/protocol/webPopupTitle";

describe("TacticalRMM computer display titles", () => {
  it.each([
    [
      "PC-WEST-01 - Client-A - Site-B | Take Control",
      "PC-WEST-01 — Take Control",
    ],
    [
      "server.example.test - Client - Site | Take Control",
      "server.example.test — Take Control",
    ],
    [
      "  PC\u202e-WEST\u0000\t01  - Client - Site | Take Control",
      "PC-WEST01 — Take Control",
    ],
    ["端末-東京 - Client - Site | Take Control", "端末-東京 — Take Control"],
  ])("extracts and sanitizes %s", (input, expected) => {
    expect(webPopupTitle(input)).toBe(expected);
  });
  it.each([
    "",
    "Take Control",
    "PC - Client | Take Control",
    "PC - Client - Site",
    "PC - Client - Site | Take Control - extra",
    "PC - Client - Site | Remote Background",
    "PC - Branch - Client - Site | Take Control",
    "PC -  - Site | Take Control",
    "\u202e - Client - Site | Take Control",
    "https://secret?token=private - Client - Site | Take Control",
    "<script> - Client - Site | Take Control",
    "user:password - Client - Site | Take Control",
    "x".repeat(2049) + " - Client - Site | Take Control",
  ])("uses a generic fallback for ambiguous or unsafe titles %s", (input) => {
    expect(webPopupTitle(input)).toBe("Take Control");
  });
  it("bounds display by Unicode code points without splitting a surrogate pair", () => {
    const result = webPopupTitle(
      `${"😀".repeat(110)} - Client - Site | Take Control`,
    );
    expect(result).toBe(`${"😀".repeat(99)}… — Take Control`);
  });
});
