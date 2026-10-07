import { describe, expect, it } from "vitest";

import {
  expectedGoogleOrigins,
  googleAccountsEntryFor,
  googleProxyForUpstream,
  googleUpstreamForProxy,
  type GoogleProxyRoute,
  validateGoogleProxyRoutes,
} from "./googleProxySession";

const source = "https://analytics.google.com";
const proxy = "http://paaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.localhost:43123";

function nativeRoutes(): GoogleProxyRoute[] {
  return [...expectedGoogleOrigins(source)].map(
    ([upstreamOrigin, documents], index) => ({
      upstreamOrigin,
      documents,
      proxyOrigin:
        upstreamOrigin === source
          ? proxy
          : `http://p${(index + 1).toString(16).padStart(32, "0")}.localhost:43123`,
    }),
  );
}

describe("Google proxy session routes", () => {
  it("projects Studio's observed YouTube sign-in continuation through a distinct document alias", () => {
    const studio = "https://studio.youtube.com";
    const youtube = "https://www.youtube.com";
    const scope = expectedGoogleOrigins(studio);
    expect(scope.get(youtube)).toBe(true);
    expect(scope.has("https://accounts.youtube.com")).toBe(false);
    expect(
      expectedGoogleOrigins(youtube).get("https://accounts.youtube.com"),
    ).toBe(true);
    const routes = [...scope].map(([upstreamOrigin, documents], index) => ({
      upstreamOrigin,
      documents,
      proxyOrigin:
        index === 0
          ? proxy
          : `http://p${index.toString(16).padStart(32, "0")}.localhost:43123`,
    }));
    expect(validateGoogleProxyRoutes(routes, studio, proxy, true)).toEqual(
      routes,
    );
    const continuation = new URL(
      "https://www.youtube.com/signin?action_handle_signin=true&app=desktop&hl=en&next=https%3A%2F%2Fstudio.youtube.com%2F&feature=redirect_login",
    );
    const projected = new URL(googleProxyForUpstream(routes, continuation)!);
    expect(projected.origin).toBe(
      routes.find((route) => route.upstreamOrigin === youtube)!.proxyOrigin,
    );
    expect(projected.origin).not.toBe(proxy);
    expect(projected.pathname).toBe("/signin");
    expect(projected.search).toBe(continuation.search);
    expect(projected.searchParams.get("next")).toBe(studio + "/");
    expect(googleUpstreamForProxy(routes, projected)).toBe(continuation.href);
    for (const invalid of [
      "https://www.youtube.com.attacker.test/signin",
      "http://www.youtube.com/signin",
      "https://www.youtube.com:8443/signin",
    ]) {
      expect(googleProxyForUpstream(routes, new URL(invalid))).toBeUndefined();
    }
    expect(() =>
      validateGoogleProxyRoutes(
        routes.filter((route) => route.upstreamOrigin !== youtube),
        studio,
        proxy,
        true,
      ),
    ).toThrow();
    expect(() =>
      validateGoogleProxyRoutes(
        routes.map((route) =>
          route.upstreamOrigin === youtube
            ? { ...route, documents: false }
            : route,
        ),
        studio,
        proxy,
        true,
      ),
    ).toThrow();
    expect(expectedGoogleOrigins(source).has(youtube)).toBe(false);
    expect(
      expectedGoogleOrigins(source).get(
        "https://analyticsadmin.googleapis.com",
      ),
    ).toBe(false);
  });
  it("isolates Adobe's catalog and never starts it at Google Accounts", () => {
    const adobe = "https://adminconsole.adobe.com";
    const routes = [...expectedGoogleOrigins(adobe)].map(
      ([upstreamOrigin, documents], index) => ({
        upstreamOrigin,
        documents,
        proxyOrigin:
          upstreamOrigin === adobe
            ? proxy
            : `http://p${(index + 1).toString(16).padStart(32, "0")}.localhost:43123`,
      }),
    );
    expect(validateGoogleProxyRoutes(routes, adobe, proxy, true)).toEqual(
      routes,
    );
    expect(googleAccountsEntryFor(routes, new URL(adobe))).toBeUndefined();
    expect(
      expectedGoogleOrigins(adobe).get("https://auth.services.adobe.com"),
    ).toBe(true);
    expect(
      expectedGoogleOrigins(adobe).get("https://auth-api.services.adobe.com"),
    ).toBe(false);
    expect(
      expectedGoogleOrigins(adobe).has("https://accounts.google.com"),
    ).toBe(false);
    expect(
      expectedGoogleOrigins("https://adminconsole.adobe.com.attacker.test")
        .size,
    ).toBe(0);
    expect(() =>
      validateGoogleProxyRoutes(routes, source, proxy, true),
    ).toThrow();
    expect(() => validateGoogleProxyRoutes([], adobe, proxy, true)).toThrow();
    const injected = structuredClone(routes);
    injected[1]!.upstreamOrigin =
      "https://auth.services.adobe.com.attacker.test";
    expect(() =>
      validateGoogleProxyRoutes(injected, adobe, proxy, true),
    ).toThrow();
  });
  it("uses an exact profile allowlist and grants no lookalike origin", () => {
    expect([...expectedGoogleOrigins(source)]).toEqual([
      ["https://analytics.google.com", true],
      ["https://accounts.google.com", true],
      ["https://www.google.com", true],
      ["https://www.gstatic.com", false],
      ["https://ssl.gstatic.com", false],
      ["https://fonts.gstatic.com", false],
      ["https://fonts.googleapis.com", false],
      ["https://apis.google.com", false],
      ["https://analyticsadmin.googleapis.com", false],
      ["https://analyticsdata.googleapis.com", false],
    ]);
    expect(
      expectedGoogleOrigins("https://analytics.google.com.attacker.test").size,
    ).toBe(0);
    expect(expectedGoogleOrigins("https://accounts.google.com").size).toBe(0);
  });

  it("accepts only distinct protected aliases on the listener port", () => {
    const routes = nativeRoutes();
    expect(
      validateGoogleProxyRoutes(
        routes,
        `${source}/analytics/web/`,
        `${proxy}/`,
        true,
      ),
    ).toEqual(routes);

    for (const mutate of [
      (copy: GoogleProxyRoute[]) => {
        copy[1]!.proxyOrigin = copy[0]!.proxyOrigin;
      },
      (copy: GoogleProxyRoute[]) => {
        copy[1]!.proxyOrigin = "http://accounts.google.com:43123";
      },
      (copy: GoogleProxyRoute[]) => {
        copy[1]!.proxyOrigin = copy[1]!.proxyOrigin.replace(":43123", ":43124");
      },
      (copy: GoogleProxyRoute[]) => {
        copy[1]!.upstreamOrigin = "https://accounts.google.com.attacker.test";
      },
      (copy: GoogleProxyRoute[]) => {
        copy[1]!.documents = false;
      },
      (copy: GoogleProxyRoute[]) => {
        copy.pop();
      },
    ]) {
      const copy = structuredClone(routes);
      mutate(copy);
      expect(() =>
        validateGoogleProxyRoutes(copy, source, proxy, true),
      ).toThrow();
    }
  });

  it("requires the complete native manifest for a reviewed Google source", () => {
    expect(() =>
      validateGoogleProxyRoutes(undefined, source, proxy, true),
    ).toThrow();
    expect(() => validateGoogleProxyRoutes([], source, proxy, true)).toThrow();
    expect(validateGoogleProxyRoutes(undefined, source, proxy, false)).toEqual(
      [],
    );
    expect(() =>
      validateGoogleProxyRoutes(
        undefined,
        "https://secure.example.test",
        proxy,
        true,
      ),
    ).toThrow();
  });

  it("maps document aliases exactly and has no direct-url fallback", () => {
    const routes = validateGoogleProxyRoutes(
      nativeRoutes(),
      source,
      proxy,
      true,
    );
    const account = routes.find(
      (route) => route.upstreamOrigin === "https://accounts.google.com",
    )!;
    const resource = routes.find(
      (route) => route.upstreamOrigin === "https://www.gstatic.com",
    )!;
    expect(
      googleUpstreamForProxy(
        routes,
        new URL(`${account.proxyOrigin}/v3/signin?q=1#step`),
      ),
    ).toBe("https://accounts.google.com/v3/signin?q=1#step");
    expect(
      googleUpstreamForProxy(
        routes,
        new URL(`${resource.proxyOrigin}/resource.js`),
      ),
    ).toBeUndefined();
    expect(
      googleUpstreamForProxy(
        routes,
        new URL("https://accounts.google.com/v3/signin"),
      ),
    ).toBeUndefined();
    expect(
      googleUpstreamForProxy(
        routes,
        new URL(
          account.proxyOrigin.replace(".localhost", ".localhost.attacker.test"),
        ),
      ),
    ).toBeUndefined();

    const destination = new URL(`${source}/analytics/web/?authuser=1#report`);
    expect(googleProxyForUpstream(routes, destination)).toBe(
      `${proxy}/analytics/web/?authuser=1#report`,
    );
    const entry = new URL(googleAccountsEntryFor(routes, destination)!);
    expect(entry.origin).toBe(account.proxyOrigin);
    expect(entry.pathname).toBe("/ServiceLogin");
    expect(entry.searchParams.get("continue")).toBe(destination.href);
    expect(entry.searchParams.get("followup")).toBe(destination.href);
    expect(
      googleAccountsEntryFor(
        routes,
        new URL("https://accounts.google.com.attacker.test/"),
      ),
    ).toBeUndefined();
  });
});
