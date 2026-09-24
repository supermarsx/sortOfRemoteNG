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
