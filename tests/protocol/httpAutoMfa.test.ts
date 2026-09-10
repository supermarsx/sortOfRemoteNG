import { describe, expect, it } from "vitest";
import {
  getHttpAutoMfaOrigin,
  normalizeHttpAutoMfa,
} from "../../src/utils/connection/httpAutoMfa";
const enabled = {
  version: 1,
  enabled: true,
  totpConfigId: "auth",
  challengeId: "challenge",
  origin: "https://nas.example",
};
describe("reference-only automatic MFA configuration", () => {
  it("is opt-in and roundtrips only its bounded metadata", () => {
    expect(normalizeHttpAutoMfa(undefined)).toEqual({
      version: 1,
      enabled: false,
    });
    expect(normalizeHttpAutoMfa(JSON.parse(JSON.stringify(enabled)))).toEqual(
      enabled,
    );
  });
  it.each([
    { ...enabled, secret: "SEED" },
    { ...enabled, code: "123456" },
    { ...enabled, totpConfigId: "" },
    { ...enabled, challengeId: undefined },
    { ...enabled, origin: "http://nas.example" },
    { ...enabled, origin: "https://user:password@nas.example" },
    { ...enabled, origin: "https://nas.example/" },
  ])("rejects malformed or secret-bearing metadata", (value) => {
    expect(() => normalizeHttpAutoMfa(value)).toThrow(
      "configuration is invalid",
    );
  });
  it("pins canonical HTTPS authority, including nondefault ports and IPv6", () => {
    expect(
      getHttpAutoMfaOrigin({
        protocol: "https",
        hostname: "NAS.example",
        port: 443,
      }),
    ).toBe("https://nas.example");
    expect(
      getHttpAutoMfaOrigin({
        protocol: "https",
        hostname: "[::1]",
        port: 8443,
      }),
    ).toBe("https://[::1]:8443");
    expect(() =>
      getHttpAutoMfaOrigin({
        protocol: "http",
        hostname: "nas.example",
        port: 80,
      }),
    ).toThrow("requires HTTPS");
    expect(() =>
      getHttpAutoMfaOrigin({
        protocol: "https",
        hostname: "nas.example:81",
        port: 443,
      }),
    ).toThrow();
  });
});
