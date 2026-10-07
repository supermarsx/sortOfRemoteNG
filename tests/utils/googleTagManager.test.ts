import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import {
  FIRST_PARTY_GOOGLE_HTTP_APPLICATION_IDS,
  getFirstPartyGoogleHostedApplicationUrl,
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  getReviewedApplicationProfile,
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";
import { resolveEffectiveConnectionIcon } from "../../src/utils/icons/resolveConnectionIcon";
import {
  expectedGoogleOrigins,
  googleAccountsEntryFor,
  googleProxyForUpstream,
  validateGoogleProxyRoutes,
} from "../../src/utils/protocol/googleProxySession";
import catalog from "../../src/utils/protocol/googleHostedRoutes.json";

const id = "google-tag-manager";
const origin = "https://tagmanager.google.com";
const connection = (
  loginMode: "manual" | "form" = "manual",
): Partial<Connection> => ({
  protocol: "https",
  hostname: "tagmanager.google.com",
  port: 443,
  authType: "basic",
  username: "fixture@example.test",
  password: "fixture-password",
  httpAutoLogin: true,
  httpApplication: { version: 1, id, loginMode },
});

describe("Google Tag Manager website preset", () => {
  it("registers its official dashboard separately from script distribution hosts", () => {
    expect(FIRST_PARTY_GOOGLE_HTTP_APPLICATION_IDS).toContain(id);
    expect(getFirstPartyGoogleHostedApplicationUrl(id)).toBe(`${origin}/`);
    expect(getHttpApplicationProfile(id)).toMatchObject({
      label: "Google Tag Manager",
      category: "monitoring",
      requiresHttps: true,
      capability: "known-form",
      loginFlow: "google",
      loginModes: ["manual", "form"],
    });
    expect(catalog.profiles[id]).toBe(origin);
    expect(getReviewedApplicationProfile(connection())).toBe("google-hosted");
  });

  it("keeps credentials inert until the existing Google login flow is selected", () => {
    expect(normalizeHttpApplicationSettings({ id })).toMatchObject({
      id,
      loginMode: "manual",
    });
    expect(resolveHttpApplicationLogin(connection())).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
    expect(resolveHttpApplicationLogin(connection("form"))).toEqual({
      credentials: {
        username: "fixture@example.test",
        password: "fixture-password",
      },
      upstreamAuthMode: "google-form",
      loginFlow: "google",
      autoLogin: true,
    });
    expect(getHttpApplicationProfile(id)?.selectors).toBeUndefined();
    expect(getHttpApplicationProfile(id)?.totpChallenges).toEqual(
      getHttpApplicationProfile("google-analytics")?.totpChallenges,
    );
    expect(() =>
      resolveHttpApplicationLogin({
        ...connection("form"),
        httpAutoLoginSelectors: { passwordSelector: "#unreviewed" },
      }),
    ).toThrow(/does not accept selector overrides/);
  });

  it("uses explicitly resolved vault credentials without reusing connection-local secrets", () => {
    const linked = {
      ...connection("form"),
      credentialSource: {
        kind: "vault" as const,
        credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    };
    expect(resolveHttpApplicationLogin(linked).credentials).toBeNull();
    expect(
      resolveHttpApplicationLogin(linked, {
        username: "vault@example.test",
        password: "vault-fixture",
      }).credentials,
    ).toEqual({ username: "vault@example.test", password: "vault-fixture" });
  });

  it.each([
    "http://tagmanager.google.com/",
    "https://tagmanager.google.com.attacker.test/",
    "https://tagmanager.google.com:8443/",
    "https://user:secret@tagmanager.google.com/",
    "https://www.googletagmanager.com/",
    "https://accounts.google.com/",
  ])("refuses %s as the saved Tag Manager dashboard", (url) => {
    expect(() => validateHttpApplicationTarget(connection(), url)).toThrow(
      /requires HTTPS/,
    );
  });

  it("admits dashboard workspace paths and preserves them through the Google sign-in handoff", () => {
    const target = new URL(
      `${origin}/#/container/accounts/123/containers/456/workspaces/7`,
    );
    expect(() =>
      validateHttpApplicationTarget(connection(), target.href),
    ).not.toThrow();
    const routes = [...expectedGoogleOrigins(origin)].map(
      ([upstreamOrigin, documents], index) => ({
        upstreamOrigin,
        documents,
        proxyOrigin: `http://p${(index + 1).toString(16).padStart(32, "0")}.localhost:43123`,
      }),
    );
    const proxy = routes[0]!.proxyOrigin;
    expect(validateGoogleProxyRoutes(routes, origin, proxy, true)).toEqual(
      routes,
    );
    const login = new URL(googleAccountsEntryFor(routes, target)!);
    expect(login.origin).toBe(
      routes.find(
        (route) => route.upstreamOrigin === "https://accounts.google.com",
      )!.proxyOrigin,
    );
    expect(login.pathname).toBe("/ServiceLogin");
    expect(login.searchParams.get("continue")).toBe(target.href);
    expect(login.searchParams.get("followup")).toBe(target.href);
    expect(googleProxyForUpstream(routes, target)).toBe(
      proxy + "/" + target.hash,
    );
    expect(() => validateGoogleProxyRoutes([], origin, proxy, true)).toThrow();
  });

  it("adds only the selected dashboard to its session and no global script permission", () => {
    expect([...expectedGoogleOrigins(origin)]).toEqual([
      [origin, true],
      ...catalog.loginOrigins.map((value) => [value, true]),
      ...catalog.resourceOrigins.map((value) => [value, false]),
    ]);
    for (const source of [
      "https://analytics.google.com",
      "https://adminconsole.adobe.com",
      "https://unrelated.test",
    ]) {
      expect(expectedGoogleOrigins(source).has(origin)).toBe(false);
      expect(
        expectedGoogleOrigins(source).has("https://www.googletagmanager.com"),
      ).toBe(false);
    }
    expect(
      expectedGoogleOrigins(origin).has("https://www.googletagmanager.com"),
    ).toBe(false);
    expect(expectedGoogleOrigins(origin + ".attacker.test").size).toBe(0);
  });

  it("offers its own brand icon and preserves saved icon choices", () => {
    expect(getHttpApplicationIconSuggestion(connection())?.icon.key).toBe(id);
    const input = {
      protocol: "https",
      httpApplication: connection().httpApplication,
    };
    expect(
      resolveEffectiveConnectionIcon({ ...input, icon: id }),
    ).toMatchObject({
      key: id,
      source: "override",
    });
    expect(
      resolveEffectiveConnectionIcon({ ...input, icon: "star" }),
    ).toMatchObject({ key: "star", source: "override" });
  });
});
