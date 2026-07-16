import { describe, expect, it } from "vitest";
import {
  ARD_SETTINGS_VERSION,
  DEFAULT_ARD_SETTINGS,
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

  it("preserves each supported mode without inventing an Apple Account secret", () => {
    expect(
      normalizeArdSettings({
        authMode: "appleAccountNative",
        autoReconnect: false,
        curtainOnConnect: true,
        localCursor: false,
        viewOnly: true,
      }),
    ).toEqual({
      version: ARD_SETTINGS_VERSION,
      authMode: "appleAccountNative",
      autoReconnect: false,
      curtainOnConnect: true,
      localCursor: false,
      viewOnly: true,
    });
  });
});
