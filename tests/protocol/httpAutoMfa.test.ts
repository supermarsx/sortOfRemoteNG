import { describe, expect, it } from "vitest";
import googleRoutes from "../../src/utils/protocol/googleHostedRoutes.json";
import nativeChallenges from "../../src-tauri/src/origin_browser_totp_catalog.json";
import type { Connection } from "../../src/types/connection/connection";
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
  it.each(Object.entries(googleRoutes.profiles))(
    "pins %s consent to the native-reviewed Google authenticator origin, not its product origin",
    (id, source) => {
      const origin = getHttpAutoMfaOrigin({
        protocol: "https",
        hostname: new URL(source).hostname,
        port: 443,
        httpApplication: { version: 1, id, loginMode: "form" },
      });
      expect(origin).toBe("https://accounts.google.com");
      const challenges = nativeChallenges[id as keyof typeof nativeChallenges];
      expect(challenges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "google-account-totp",
            origins: [origin],
          }),
        ]),
      );
      expect(origin).not.toBe(source);
    },
  );
  it.each([
    { hostname: "analytics.google.com.attacker.test" },
    { hostname: "accounts.google.com" },
    { hostname: "www.google.com" },
    { hostname: "mail.google.com" },
    { port: 8443 },
    { protocol: "http" },
    {
      httpApplication: {
        version: 1,
        id: "google-analytics",
        loginMode: "form",
        invalid: true,
      },
    },
  ])("rejects unreviewed Google profile/source pairs", (override) => {
    const connection = {
      protocol: "https",
      hostname: "analytics.google.com",
      port: 443,
      httpApplication: {
        version: 1,
        id: "google-analytics",
        loginMode: "form",
      },
      ...override,
    } as Connection;
    expect(() => getHttpAutoMfaOrigin(connection)).toThrow();
  });
  it("does not infer Google authority from the hostname without the reviewed profile", () => {
    for (const id of [undefined, "generic-form", "__proto__"]) {
      expect(
        getHttpAutoMfaOrigin({
          protocol: "https",
          hostname: "analytics.google.com",
          port: 443,
          ...(id
            ? {
                httpApplication: {
                  version: 1 as const,
                  id,
                  loginMode: "form" as const,
                },
              }
            : {}),
        }),
      ).toBe("https://analytics.google.com");
    }
  });
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
