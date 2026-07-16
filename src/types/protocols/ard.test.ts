import { describe, expect, it } from "vitest";
import {
  ARD_SETTINGS_VERSION,
  ARD_APPLE_ACCOUNT_IDENTIFIER_MAX_LENGTH,
  DEFAULT_ARD_SETTINGS,
  normalizeAppleAccountIdentifier,
  normalizeArdSettings,
} from "./ard";

describe("normalizeArdSettings", () => {
  it("returns durable defaults for absent and malformed values", () => {
    expect(normalizeArdSettings(undefined)).toEqual(DEFAULT_ARD_SETTINGS);
    expect(
      normalizeArdSettings({
        version: 99,
        authMode: "appleIdPassword",
        autoReconnect: "yes",
      }),
    ).toEqual(DEFAULT_ARD_SETTINGS);
  });

  it("preserves native account metadata without inventing an Apple Account secret", () => {
    expect(
      normalizeArdSettings({
        authMode: "appleAccountNative",
        appleAccountIdentifier: "  owner@example.test  ",
        autoReconnect: false,
        curtainOnConnect: true,
        localCursor: false,
        viewOnly: true,
      }),
    ).toEqual({
      version: ARD_SETTINGS_VERSION,
      authMode: "appleAccountNative",
      appleAccountIdentifier: "owner@example.test",
      autoReconnect: false,
      curtainOnConnect: true,
      localCursor: false,
      viewOnly: true,
    });
  });

  it("removes controls, trims, and bounds Apple Account identifiers", () => {
    const oversized = ` \u0000owner\n@example.test\u007f${"x".repeat(400)} `;
    const normalized = normalizeAppleAccountIdentifier(oversized);

    expect(normalized).toHaveLength(ARD_APPLE_ACCOUNT_IDENTIFIER_MAX_LENGTH);
    expect(normalized).toMatch(/^owner@example\.test/);
    expect(
      Array.from(normalized ?? "").every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return !(codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
      }),
    ).toBe(true);
    expect(normalizeAppleAccountIdentifier(" \n\t ")).toBeUndefined();
    expect(
      normalizeAppleAccountIdentifier({ email: "owner@example.test" }),
    ).toBeUndefined();
  });

  it("drops native-only account metadata from embedded authentication modes", () => {
    expect(
      normalizeArdSettings({
        authMode: "macOsAccount",
        appleAccountIdentifier: "owner@example.test",
      }),
    ).not.toHaveProperty("appleAccountIdentifier");
  });
});
