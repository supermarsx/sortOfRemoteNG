import { describe, expect, it } from "vitest";
import { GOOGLE_SERVICE_PROFILES } from "../../src/utils/connection/googleServiceProfiles";
import { HOSTED_DASHBOARD_PROFILES } from "../../src/utils/connection/hostedDashboardProfiles";
import catalog from "../../src/utils/protocol/googleHostedRoutes.json";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";
import { getConnectionIconDefinition } from "../../src/utils/icons/connectionIconCatalog";
import {
  expectedGoogleOrigins,
  googleAccountsEntryFor,
  googleProxyForUpstream,
  googleUpstreamForProxy,
  validateGoogleProxyRoutes,
} from "../../src/utils/protocol/googleProxySession";

const entries = {
  "youtube-studio": "https://studio.youtube.com/",
  "google-ad-manager": "https://admanager.google.com/",
  "google-adsense": "https://adsense.google.com/adsense/login",
  "google-forms": "https://docs.google.com/forms/",
  "google-gemini": "https://gemini.google.com/",
  "google-workspace-admin": "https://admin.google.com/",
  "google-play-store": "https://play.google.com/store/",
  "google-developers": "https://developers.google.com/",
  "google-play-console": "https://play.google.com/console/",
};

// Consume the lane's export directly: central registry wiring is independent.
describe("additional Google website profiles", () => {
  it("covers all nine services with distinct IDs and reviewed entry points", () => {
    expect(GOOGLE_SERVICE_PROFILES).toHaveLength(9);
    expect(new Set(GOOGLE_SERVICE_PROFILES.map(({ id }) => id)).size).toBe(9);
    expect(
      Object.fromEntries(
        GOOGLE_SERVICE_PROFILES.map(({ id, hostedLoginUrl }) => [
          id,
          hostedLoginUrl,
        ]),
      ),
    ).toEqual(entries);
  });

  it("suggests the existing YouTube vector for Studio without replacing a saved icon", () => {
    const connection = {
      protocol: "https" as const,
      icon: "star",
      httpApplication: {
        version: 1 as const,
        id: "youtube-studio",
        loginMode: "manual" as const,
      },
    };
    expect(getHttpApplicationIconSuggestion(connection)).toMatchObject({
      applicationId: "youtube-studio",
      applicationLabel: "YouTube Studio",
      icon: {
        key: "youtube",
        icon: getConnectionIconDefinition("youtube")!.icon,
      },
    });
    expect(connection.icon).toBe("star");
  });

  describe.each(GOOGLE_SERVICE_PROFILES)("$id", (profile) => {
    const target = new URL(profile.hostedLoginUrl!);

    it("reuses the existing Google adapter with manual first and no custom selectors", () => {
      const existing = HOSTED_DASHBOARD_PROFILES.find(
        ({ id }) => id === "google-account",
      )!;
      expect(profile).toMatchObject({
        capability: "known-form",
        loginFlow: "google",
        loginModes: ["manual", "form"],
        requiresHttps: true,
      });
      expect(profile.selectors).toBeUndefined();
      expect(profile.loginPath).toBeUndefined();
      expect(profile.totpChallenges).toEqual(existing.totpChallenges);
      expect(profile.totpChallenges?.map(({ origins }) => origins)).toEqual([
        ["https://accounts.google.com"],
      ]);
      expect(profile.description).toContain("remain interactive");
      expect(profile.description).toContain(
        "Google may reject embedded browsers",
      );
      expect(target.protocol).toBe("https:");
      expect(target.username + target.password + target.port).toBe("");
      expect(target.search + target.hash).toBe("");
    });

    it("adds only its exact service origin and reviewed sign-in continuation", () => {
      expect((catalog.profiles as Record<string, string>)[profile.id]).toBe(
        target.origin,
      );
      expect(
        (catalog.profileOrigins as Record<string, string[]>)[profile.id],
      ).toEqual(
        profile.id === "youtube-studio"
          ? ["https://www.youtube.com"]
          : undefined,
      );
      const expected = expectedGoogleOrigins(target.origin);
      expect([...expected]).toEqual([
        [target.origin, true],
        ...catalog.loginOrigins.map((origin) => [origin, true]),
        ...catalog.resourceOrigins.map((origin) => [origin, false]),
        ...(profile.id === "youtube-studio"
          ? [["https://www.youtube.com", true]]
          : []),
      ]);
      for (const { hostedLoginUrl } of GOOGLE_SERVICE_PROFILES) {
        const otherOrigin = new URL(hostedLoginUrl!).origin;
        // Store and Console intentionally share one origin, not path isolation.
        expect(expected.has(otherOrigin)).toBe(otherOrigin === target.origin);
      }
      for (const unrelated of [
        "https://google.play",
        "https://forms.google.com",
        "https://accounts.youtube.com",
        "https://www.googletagmanager.com",
        "https://unreviewed.googleapis.com",
        "https://tenant-idp.example.test",
      ]) {
        expect(expected.has(unrelated)).toBe(false);
      }
      expect(expectedGoogleOrigins(target.origin + ".attacker.test").size).toBe(
        0,
      );
      expect(expectedGoogleOrigins(target.origin + ":8443").size).toBe(0);
      expect(
        expectedGoogleOrigins(target.origin.replace("https:", "http:")).size,
      ).toBe(0);
    });

    it("keeps service and Accounts navigation on distinct validated proxy aliases", () => {
      const routes = [...expectedGoogleOrigins(target.origin)].map(
        ([upstreamOrigin, documents], index) => ({
          upstreamOrigin,
          documents,
          proxyOrigin: `http://p${(index + 1).toString(16).padStart(32, "0")}.localhost:43123`,
        }),
      );
      const proxy = routes[0]!.proxyOrigin;
      expect(
        validateGoogleProxyRoutes(routes, target.href, proxy, true),
      ).toEqual(routes);
      expect(new Set(routes.map(({ proxyOrigin }) => proxyOrigin)).size).toBe(
        routes.length,
      );
      const account = routes.find(
        ({ upstreamOrigin }) =>
          upstreamOrigin === "https://accounts.google.com",
      )!;
      const entry = new URL(googleAccountsEntryFor(routes, target)!);
      expect(entry.origin).toBe(account.proxyOrigin);
      expect(entry.origin).not.toBe(proxy);
      expect(entry.pathname).toBe("/ServiceLogin");
      expect(entry.searchParams.get("continue")).toBe(target.href);
      expect(entry.searchParams.get("followup")).toBe(target.href);

      const projected = googleProxyForUpstream(routes, target)!;
      expect(projected).toBe(proxy + target.pathname);
      expect(googleUpstreamForProxy(routes, new URL(projected))).toBe(
        target.href,
      );
      expect(
        googleProxyForUpstream(
          routes,
          new URL("https://tenant-idp.example.test/login"),
        ),
      ).toBeUndefined();
      expect(googleUpstreamForProxy(routes, target)).toBeUndefined();

      for (const resource of routes.filter(({ documents }) => !documents)) {
        expect(
          googleProxyForUpstream(routes, new URL(resource.upstreamOrigin)),
        ).toBeUndefined();
        expect(
          googleUpstreamForProxy(routes, new URL(resource.proxyOrigin)),
        ).toBeUndefined();
      }
      expect(() =>
        validateGoogleProxyRoutes([], target.href, proxy, true),
      ).toThrow();
      expect(() =>
        validateGoogleProxyRoutes(undefined, target.href, proxy, true),
      ).toThrow();
      expect(() =>
        validateGoogleProxyRoutes(
          [
            ...routes,
            {
              upstreamOrigin: "https://tenant-idp.example.test",
              proxyOrigin:
                "http://pffffffffffffffffffffffffffffffff.localhost:43123",
              documents: true,
            },
          ],
          target.href,
          proxy,
          true,
        ),
      ).toThrow();
      expect(() =>
        validateGoogleProxyRoutes(
          routes.map((route) => ({ ...route, documents: true })),
          target.href,
          proxy,
          true,
        ),
      ).toThrow();
    });
  });

  it("keeps Play Store and Console paths distinct without claiming origin separation", () => {
    const store = new URL(entries["google-play-store"]);
    const console = new URL(entries["google-play-console"]);
    expect(store.pathname).not.toBe(console.pathname);
    expect(store.origin).toBe(console.origin);
    expect(expectedGoogleOrigins(store.origin)).toEqual(
      expectedGoogleOrigins(console.origin),
    );
    expect(catalog.profileOrigins).not.toHaveProperty("google-play-store");
    expect(catalog.profileOrigins).not.toHaveProperty("google-play-console");
  });
});
