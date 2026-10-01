import { describe, expect, it } from "vitest";
import chatgpt from "./chatgptHostedRoutes.json";
import claude from "./claudeHostedRoutes.json";
import {
  expectedGoogleOrigins,
  googleAccountsEntryFor,
  googleProxyForUpstream,
  googleUpstreamForProxy,
  hostedSessionLabel,
  requiresHostedProxyRoutes,
  validateGoogleProxyRoutes,
  type GoogleProxyRoute,
} from "./googleProxySession";

const proxy = "http://paaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.localhost:43123";
describe.each([
  {
    id: "chatgpt",
    label: "ChatGPT",
    source: "https://chatgpt.com",
    catalog: chatgpt,
  },
  {
    id: "claude",
    label: "Claude",
    source: "https://claude.ai",
    catalog: claude,
  },
])("$label proxy routes", ({ id, label, source, catalog }) => {
  const routes = (): GoogleProxyRoute[] =>
    [...expectedGoogleOrigins(source)].map(
      ([upstreamOrigin, documents], index) => ({
        upstreamOrigin,
        documents,
        proxyOrigin:
          index === 0
            ? proxy
            : `http://p${String(index).padStart(32, "0")}.localhost:43123`,
      }),
    );

  it("requires the complete native-issued catalog and provider-specific label", () => {
    expect(requiresHostedProxyRoutes(id)).toBe(true);
    expect(catalog.profiles).toEqual({ [id]: source });
    expect(hostedSessionLabel(routes().map((r) => r.upstreamOrigin))).toBe(
      label,
    );
    expect(validateGoogleProxyRoutes(routes(), source, proxy, true)).toEqual(
      routes(),
    );
    for (const bad of [
      undefined,
      [],
      routes().slice(1),
      [...routes(), routes()[0]],
    ])
      expect(() =>
        validateGoogleProxyRoutes(bad, source, proxy, true),
      ).toThrow();
  });

  it("does not add SSO, APIs or the other provider implicitly", () => {
    expect(googleAccountsEntryFor(routes(), new URL(source))).toBeUndefined();
    for (const origin of [
      "https://accounts.google.com",
      "https://login.microsoftonline.com",
      "https://api.openai.com",
      "https://api.anthropic.com",
      "https://auth.services.adobe.com",
      source === "https://claude.ai"
        ? "https://chatgpt.com"
        : "https://claude.ai",
    ]) {
      expect(expectedGoogleOrigins(source).has(origin)).toBe(false);
      expect(googleProxyForUpstream(routes(), new URL(origin))).toBeUndefined();
    }
  });

  it("projects login and challenge URLs only onto exact issued aliases", () => {
    const challenge = routes().find(
      (r) => r.upstreamOrigin === "https://challenges.cloudflare.com",
    )!;
    expect(challenge.documents).toBe(true); // Frame transport, NOT a credential grant.
    expect(
      googleProxyForUpstream(
        routes(),
        new URL(challenge.upstreamOrigin + "/frame"),
      ),
    ).toBe(challenge.proxyOrigin + "/frame");
    expect(
      googleUpstreamForProxy(routes(), new URL(proxy + "/login?next=%2F#step")),
    ).toBe(source + "/login?next=%2F#step");
    for (const alias of [
      source,
      "http://localhost:43123",
      "http://pbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.localhost:43124",
    ]) {
      const changed = routes();
      changed[1] = { ...changed[1], proxyOrigin: alias };
      expect(() =>
        validateGoogleProxyRoutes(changed, source, proxy, true),
      ).toThrow();
    }
  });

  it("rejects downgraded, credential-bearing or unrelated document projections", () => {
    for (const target of [
      source.replace("https:", "http:"),
      source + ":444/",
      source + ".attacker.test/",
      source.replace("https://", "https://user:secret@"),
    ])
      expect(googleProxyForUpstream(routes(), new URL(target))).toBeUndefined();
    for (const route of routes().filter((r) => !r.documents)) {
      expect(
        googleProxyForUpstream(routes(), new URL(route.upstreamOrigin)),
      ).toBeUndefined();
      expect(
        googleUpstreamForProxy(routes(), new URL(route.proxyOrigin)),
      ).toBeUndefined();
      const promoted = routes().map((r) =>
        r.upstreamOrigin === route.upstreamOrigin
          ? { ...r, documents: true }
          : r,
      );
      expect(() =>
        validateGoogleProxyRoutes(promoted, source, proxy, true),
      ).toThrow();
    }
  });
});
