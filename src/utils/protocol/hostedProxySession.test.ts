import { describe, expect, it } from "vitest";
import canva from "./canvaHostedRoutes.json";
import instagram from "./instagramHostedRoutes.json";
import {
  expectedGoogleOrigins,
  googleAccountsEntryFor,
  googleProxyForUpstream,
  googleUpstreamForProxy,
  type GoogleProxyRoute,
  validateGoogleProxyRoutes,
} from "./googleProxySession";

const proxy = "http://paaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.localhost:43123";
const resourceProxy =
  "http://pbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.localhost:43123";
const providers = [
  {
    name: "canva",
    catalog: canva,
    source: "https://www.canva.com",
    resource: "https://static.canva.com",
    login: "/login/",
  },
  {
    name: "instagram",
    catalog: instagram,
    source: "https://www.instagram.com",
    resource: "https://static.cdninstagram.com",
    login: "/accounts/login/",
  },
];

describe.each(providers)(
  "$name hosted proxy catalog",
  ({ name, catalog, source, resource, login }) => {
    const routes = (): GoogleProxyRoute[] => [
      { upstreamOrigin: source, proxyOrigin: proxy, documents: true },
      {
        upstreamOrigin: resource,
        proxyOrigin: resourceProxy,
        documents: false,
      },
    ];

    it("grants exactly its source document and reviewed resource origin", () => {
      expect(catalog).toEqual({
        profiles: { [name]: source },
        loginOrigins: [],
        resourceOrigins: [resource],
        profileOrigins: {},
      });
      expect([...expectedGoogleOrigins(source)]).toEqual([
        [source, true],
        [resource, false],
      ]);
      expect(
        validateGoogleProxyRoutes(routes(), source + login, proxy, true),
      ).toEqual(routes());
      for (const other of [
        source + ".attacker.test",
        source.replace("https:", "http:"),
        resource,
      ])
        expect(expectedGoogleOrigins(other).size).toBe(0);
    });

    it("preserves exact native-issued document aliases and URL components", () => {
      const suffix = `${login}?next=%2Fhome#login`;
      expect(googleProxyForUpstream(routes(), new URL(source + suffix))).toBe(
        proxy + suffix,
      );
      expect(googleUpstreamForProxy(routes(), new URL(proxy + suffix))).toBe(
        source + suffix,
      );
      const replacement = routes();
      replacement[0].proxyOrigin =
        "http://pcccccccccccccccccccccccccccccccc.localhost:43123";
      expect(() =>
        validateGoogleProxyRoutes(replacement, source, proxy, true),
      ).toThrow();
    });

    it("does not infer Google, Adobe, another provider or arbitrary SSO routes", () => {
      expect(
        googleAccountsEntryFor(routes(), new URL(source + login)),
      ).toBeUndefined();
      for (const origin of [
        "https://accounts.google.com",
        "https://auth.services.adobe.com",
        "https://login.microsoftonline.com",
        ...providers.filter((p) => p.name !== name).map((p) => p.source),
      ]) {
        expect(expectedGoogleOrigins(source).has(origin)).toBe(false);
        expect(
          googleProxyForUpstream(routes(), new URL(origin + "/login")),
        ).toBeUndefined();
        const injected = routes();
        injected[1] = {
          ...injected[1],
          upstreamOrigin: origin,
          documents: true,
        };
        expect(() =>
          validateGoogleProxyRoutes(injected, source, proxy, true),
        ).toThrow();
      }
    });

    it("never promotes resource-only assets into document navigation", () => {
      expect(
        googleProxyForUpstream(routes(), new URL(resource + "/web/bundle.js")),
      ).toBeUndefined();
      expect(
        googleUpstreamForProxy(
          routes(),
          new URL(resourceProxy + "/web/bundle.js"),
        ),
      ).toBeUndefined();
      expect(
        googleAccountsEntryFor(routes(), new URL(resource)),
      ).toBeUndefined();
      const promoted = routes();
      promoted[1].documents = true;
      expect(() =>
        validateGoogleProxyRoutes(promoted, source, proxy, true),
      ).toThrow();
    });

    it.each([
      "https://pbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.localhost:43123",
      "http://pbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.localhost:43124",
      "http://pbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.localhost.attacker.test:43123",
      "http://localhost:43123",
      "http://127.0.0.1:43123",
      resourceProxy + "/asset",
      resourceProxy + "?route=1",
      resourceProxy + "#asset",
      resourceProxy.replace("http://", "http://user:secret@"),
      proxy,
    ])("rejects unsafe or aliased resource URL %s", (invalidAlias) => {
      const invalid = routes();
      invalid[1].proxyOrigin = invalidAlias;
      expect(() =>
        validateGoogleProxyRoutes(invalid, source, proxy, true),
      ).toThrow();
    });

    it("fails closed for missing, partial, duplicate or expanded native catalogs", () => {
      for (const invalid of [
        undefined,
        [],
        routes().slice(0, 1),
        [routes()[0], routes()[0]],
        [
          ...routes(),
          {
            upstreamOrigin: "https://api.canva.com",
            proxyOrigin:
              "http://pcccccccccccccccccccccccccccccccc.localhost:43123",
            documents: false,
          },
        ],
      ])
        expect(() =>
          validateGoogleProxyRoutes(invalid, source, proxy, true),
        ).toThrow();
    });

    it("rejects credential-bearing and unknown document URLs in either direction", () => {
      expect(
        googleProxyForUpstream(
          routes(),
          new URL(source.replace("https://", "https://user:secret@") + login),
        ),
      ).toBeUndefined();
      expect(
        googleUpstreamForProxy(
          routes(),
          new URL(proxy.replace("http://", "http://user:secret@") + login),
        ),
      ).toBeUndefined();
      expect(
        googleUpstreamForProxy(
          routes(),
          new URL(
            "http://pcccccccccccccccccccccccccccccccc.localhost:43123/login",
          ),
        ),
      ).toBeUndefined();
    });
  },
);
