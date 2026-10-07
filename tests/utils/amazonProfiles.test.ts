import { describe, expect, it } from "vitest";
import {
  AMAZON_SHOPPING_MARKETS,
  AMAZON_SHOPPING_PROFILES,
  detectAmazonShoppingMarket,
} from "../../src/utils/connection/amazonProfiles";
import {
  AWS_CONSOLE_DESTINATIONS,
  AWS_CONSOLE_PROFILES,
} from "../../src/utils/connection/awsConsoleProfiles";
import {
  HTTP_APPLICATION_PROFILES,
  getHttpApplicationLoginModes,
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import { getHttpApplicationExternalTarget } from "../../src/utils/auth/httpApplicationExternal";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";
import type { Connection } from "../../src/types/connection/connection";

// Contract tests only: no real accounts, live website requests or authenticated
// sign-in proofs. The explicit list prevents guessed countries from sneaking in.
const expectedMarkets = {
  GB: "www.amazon.co.uk",
  IE: "www.amazon.ie",
  DE: "www.amazon.de",
  FR: "www.amazon.fr",
  IT: "www.amazon.it",
  ES: "www.amazon.es",
  NL: "www.amazon.nl",
  BE: "www.amazon.com.be",
  SE: "www.amazon.se",
  PL: "www.amazon.pl",
  TR: "www.amazon.com.tr",
  US: "www.amazon.com",
  CA: "www.amazon.ca",
  MX: "www.amazon.com.mx",
  BR: "www.amazon.com.br",
  JP: "www.amazon.co.jp",
  IN: "www.amazon.in",
  AU: "www.amazon.com.au",
  SG: "www.amazon.sg",
  AE: "www.amazon.ae",
  SA: "www.amazon.sa",
  EG: "www.amazon.eg",
  ZA: "www.amazon.co.za",
};

const profiles = [...AMAZON_SHOPPING_PROFILES, ...AWS_CONSOLE_PROFILES];
const connectionFor = (id: string): Partial<Connection> => ({
  protocol: "https",
  hostname: new URL(getHttpApplicationProfile(id)!.hostedLoginUrl!).hostname,
  port: 443,
  authType: "basic",
  httpAutoLogin: true,
  username: "fixture-account",
  password: "fixture-password",
  basicAuthPassword: "fixture-not-for-website",
  httpHeaders: { Authorization: "Bearer fixture-api-token" },
  httpAutoMfa: { version: 1, enabled: true },
  httpApplication: { version: 1, id, loginMode: "manual" },
});

describe("Amazon retail and AWS console preset boundaries", () => {
  it("enumerates exactly 23 actual shopping storefronts, not delivery destinations", () => {
    expect(AMAZON_SHOPPING_MARKETS).toHaveLength(23);
    expect(
      Object.fromEntries(
        AMAZON_SHOPPING_MARKETS.map((m) => [m.code, m.hostname]),
      ),
    ).toEqual(expectedMarkets);
    expect(AMAZON_SHOPPING_PROFILES).toHaveLength(1);
    for (const market of AMAZON_SHOPPING_MARKETS) {
      const profile = getHttpApplicationProfile(
        `amazon-shopping-${market.code.toLowerCase()}`,
      )!;
      expect(profile.id).toBe("amazon-shopping");
      const legacy = normalizeHttpApplicationSettings({
        version: 1,
        id: `amazon-shopping-${market.code.toLowerCase()}`,
        loginMode: "manual",
      });
      expect(legacy).toEqual({
        version: 1,
        id: "amazon-shopping",
        loginMode: "manual",
        amazonMarketplace: market.code,
      });
      expect(normalizeHttpApplicationSettings(legacy)).toEqual(legacy);
    }
    for (const unavailable of ["pt", "at", "ch", "no", "dk", "fi", "cn"]) {
      expect(
        getHttpApplicationProfile(`amazon-shopping-${unavailable}`),
      ).toBeUndefined();
    }
  });

  it("keeps commercial, China and GovCloud consoles separate from shopping", () => {
    expect(AWS_CONSOLE_DESTINATIONS.map(({ id, url }) => [id, url])).toEqual([
      ["aws-console", "https://console.aws.amazon.com/"],
      ["aws-console-china", "https://console.amazonaws.cn/"],
      ["aws-console-govcloud", "https://console.amazonaws-us-gov.com/"],
    ]);
    expect(new Set(HTTP_APPLICATION_PROFILES.map((p) => p.id)).size).toBe(
      HTTP_APPLICATION_PROFILES.length,
    );
    for (const profile of profiles) {
      expect(
        HTTP_APPLICATION_PROFILES.filter((p) => p.id === profile.id),
      ).toEqual([profile]);
    }
  });

  it.each(profiles)(
    "$id remains interactive, including stale autofill/MFA settings",
    (profile) => {
      expect(getHttpApplicationLoginModes(profile)).toEqual(["manual"]);
      expect(profile.capability).toBe("manual");
      expect(profile.requiresHttps).toBe(true);
      expect(profile.selectors).toBeUndefined();
      expect(profile.loginFlow).toBeUndefined();
      expect(profile.totpChallenges).toBeUndefined();
      expect(
        normalizeHttpApplicationSettings({ id: profile.id }),
      ).toMatchObject({
        id: profile.id,
        loginMode: "manual",
      });
      expect(resolveHttpApplicationLogin(connectionFor(profile.id))).toEqual({
        credentials: null,
        upstreamAuthMode: "none",
        autoLogin: false,
      });
      for (const loginMode of ["form", "basic", "digest"] as const) {
        const connection = connectionFor(profile.id);
        connection.httpApplication = { version: 1, id: profile.id, loginMode };
        expect(
          normalizeHttpApplicationSettings(connection.httpApplication)?.invalid,
        ).toBe(true);
        expect(() => resolveHttpApplicationLogin(connection)).toThrow(
          /invalid|unavailable/,
        );
      }
    },
  );

  it.each(profiles)(
    "$id does not even read stored secret fields in manual mode",
    (profile) => {
      const connection = connectionFor(profile.id);
      for (const name of ["password", "basicAuthPassword", "httpHeaders"]) {
        Object.defineProperty(connection, name, {
          get() {
            throw new Error("Secret must not be read");
          },
        });
      }
      expect(resolveHttpApplicationLogin(connection)).toMatchObject({
        credentials: null,
        autoLogin: false,
      });
    },
  );

  it.each(profiles)(
    "$id permits its exact origin, not a regional/account lookalike",
    (profile) => {
      const connection = connectionFor(profile.id);
      const target = new URL(profile.hostedLoginUrl!);
      expect(() =>
        validateHttpApplicationTarget(connection, target.href),
      ).not.toThrow();
      for (const other of profiles.filter((p) => p.id !== profile.id)) {
        expect(() =>
          validateHttpApplicationTarget(connection, other.hostedLoginUrl!),
        ).toThrow();
      }
      for (const invalid of [
        `http://${target.hostname}/`,
        `https://${target.hostname}:8443/`,
        `https://${target.hostname}.attacker.test/`,
        `https://attacker.test/?next=${encodeURIComponent(target.href)}`,
        `https://user:secret@${target.hostname}/`,
        `https://sellercentral.${target.hostname.replace(/^www\./, "")}/`,
      ]) {
        expect(() =>
          validateHttpApplicationTarget(connection, invalid),
        ).toThrow();
      }
    },
  );

  it.each(profiles)(
    "$id provides a query-free explicit handoff without changing the connection",
    (profile) => {
      const connection = connectionFor(profile.id);
      const snapshot = structuredClone(connection);
      expect(
        getHttpApplicationExternalTarget(connection, profile.hostedLoginUrl!),
      ).toEqual({
        label: profile.label,
        url: profile.hostedLoginUrl,
      });
      expect(
        getHttpApplicationExternalTarget(connection, "https://attacker.test/"),
      ).toBeNull();
      expect(connection).toEqual(snapshot);
      const url = new URL(profile.hostedLoginUrl!);
      expect(url.username + url.password + url.search + url.hash).toBe("");
    },
  );

  it.each(profiles)(
    "$id has a distinct shopping or AWS icon suggestion without overwriting a saved icon",
    (profile) => {
      const connection = { ...connectionFor(profile.id), icon: "star" };
      expect(getHttpApplicationIconSuggestion(connection)?.icon.key).toBe(
        profile.id === "amazon-shopping" ? "amazon-shopping" : "aws",
      );
      expect(connection.icon).toBe("star");
    },
  );

  it.each(AMAZON_SHOPPING_MARKETS)(
    "detects $country from the URL and supports legacy, automatic and explicit choices",
    (market) => {
      for (const hostname of [
        market.hostname,
        market.hostname.replace(/^www\./, ""),
      ]) {
        expect(detectAmazonShoppingMarket(hostname)?.code).toBe(market.code);
        expect(
          detectAmazonShoppingMarket(
            `https://${hostname.toUpperCase()}:443/ap/signin?test=1#login`,
          )?.code,
        ).toBe(market.code);
        for (const amazonMarketplace of [undefined, "auto", market.code]) {
          const connection = {
            ...connectionFor("amazon-shopping"),
            hostname,
            httpApplication: {
              version: 1 as const,
              id: "amazon-shopping",
              loginMode: "manual" as const,
              amazonMarketplace,
            },
          };
          expect(() =>
            validateHttpApplicationTarget(connection, `https://${hostname}/`),
          ).not.toThrow();
          expect(
            getHttpApplicationExternalTarget(
              connection,
              `https://${hostname}/ap/signin?token=not-retained`,
            ),
          ).toEqual({ label: "Amazon Shopping", url: `https://${hostname}/` });
        }
      }
      const legacy = {
        ...connectionFor("amazon-shopping"),
        hostname: market.hostname,
        httpApplication: {
          version: 1 as const,
          id: `amazon-shopping-${market.code.toLowerCase()}`,
          loginMode: "manual" as const,
        },
      };
      expect(() =>
        validateHttpApplicationTarget(legacy, `https://${market.hostname}/`),
      ).not.toThrow();
      expect(getHttpApplicationIconSuggestion(legacy)?.icon.key).toBe(
        "amazon-shopping",
      );
    },
  );

  it.each([
    "www.amazon.com.evil.test",
    "sellercentral.amazon.de",
    "https://user:password@www.amazon.de/",
    "https://www.amazon.de:8443/",
    "amazon.pt",
    "ftp://www.amazon.com",
    "https://www.amazon.com%2f.evil.test",
    "https://www.amazon.com\\@evil.test",
  ])("does not detect unapproved authority %s", (address) => {
    expect(detectAmazonShoppingMarket(address)).toBeUndefined();
  });

  it("rejects a URL inconsistent with an explicit marketplace and malformed imported marketplace settings", () => {
    const connection = connectionFor("amazon-shopping");
    connection.httpApplication!.amazonMarketplace = "DE";
    expect(() =>
      validateHttpApplicationTarget(connection, "https://www.amazon.com/"),
    ).toThrow(/marketplace/);
    for (const amazonMarketplace of [
      null,
      "ZZ",
      "de",
      "",
      1,
      {},
      "https://www.amazon.de",
    ]) {
      expect(
        normalizeHttpApplicationSettings({
          version: 1,
          id: "amazon-shopping",
          loginMode: "manual",
          amazonMarketplace,
        })?.invalid,
      ).toBe(true);
    }
    expect(
      normalizeHttpApplicationSettings({
        version: 1,
        id: "aws-console",
        loginMode: "manual",
        amazonMarketplace: "DE",
      })?.invalid,
    ).toBe(true);
    expect(
      normalizeHttpApplicationSettings({
        version: 1,
        id: "amazon-shopping-fr",
        loginMode: "manual",
        amazonMarketplace: "DE",
      })?.invalid,
    ).toBe(true);
  });
});
