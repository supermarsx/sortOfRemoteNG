import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import {
  authenticatedRedirectConnection,
  normalizeRedirectAuthentication,
  redirectAuthenticationAvailability,
} from "../../src/utils/protocol/httpRedirectAuthentication";
import { anonymousRedirectConnection } from "../../src/utils/protocol/httpRedirectReview";
const review = {
  receiptId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  sessionId: "s",
  sourceOrigin: "https://source.invalid",
  destinationUrl: "https://target.invalid/",
  navigationToken: null,
  documentSequence: 1,
  removedQuery: false,
};
const source = {
  id: "source",
  protocol: "https",
  hostname: "source.invalid",
  basicAuthUsername: "alice",
  basicAuthPassword: "synthetic-password",
  httpRedirectAuthentication: {
    version: 1,
    mode: "saved-login",
    allowInsecureHttp: false,
  },
  httpProxyPolicy: {
    ...DEFAULT_HTTP_PROXY_POLICY,
    allowCrossOriginRedirects: true,
    allowHttpDowngradeRedirects: true,
  },
  totpSecret: "never-transfer",
  httpHeaders: { "X-Token": "never-transfer" },
  credentialSource: { kind: "local" },
  httpFormAutomation: { beforeLoadScript: "never-transfer" },
} as unknown as Connection;
describe("reviewed redirect saved-login forwarding", () => {
  it("defaults off and refuses malformed policies", () => {
    expect(normalizeRedirectAuthentication(undefined).mode).toBe("none");
    for (const value of [
      null,
      true,
      { version: 1, mode: "all", allowInsecureHttp: true },
      { version: 1, mode: "saved-login", allowInsecureHttp: "true" },
      { version: 1, mode: "none", allowInsecureHttp: false, cookies: true },
    ])
      expect(() => normalizeRedirectAuthentication(value)).toThrow();
    expect(
      redirectAuthenticationAvailability(
        { ...source, httpRedirectAuthentication: undefined },
        review,
      ).available,
    ).toBe(false);
  });
  it("carries only a saved login and retains opt-in for subsequent reviewed hops", () => {
    const result = authenticatedRedirectConnection(source, review, false);
    expect(result.basicAuthPassword).toBe("synthetic-password");
    expect(result.httpRedirectAuthentication?.mode).toBe("saved-login");
    expect(result.httpsTrustPolicy).toBe("inherit");
    expect(JSON.stringify(result)).not.toContain("never-transfer");
    expect(source).toHaveProperty("credentialSource.kind", "local");
    expect(
      anonymousRedirectConnection(source, review).basicAuthPassword,
    ).toBeUndefined();
    expect(
      anonymousRedirectConnection(source, review).httpRedirectAuthentication,
    ).toBeUndefined();
  });
  it("requires policy permission plus per-handoff approval for any plaintext destination", () => {
    const insecure = { ...review, destinationUrl: "http://target.invalid/" };
    expect(() =>
      authenticatedRedirectConnection(source, insecure, true),
    ).toThrow();
    const enabled = {
      ...source,
      httpRedirectAuthentication: {
        version: 1 as const,
        mode: "saved-login" as const,
        allowInsecureHttp: true,
      },
    };
    expect(() =>
      authenticatedRedirectConnection(enabled, insecure, false),
    ).toThrow();
    expect(
      authenticatedRedirectConnection(enabled, insecure, true)
        .basicAuthPassword,
    ).toBe("synthetic-password");
    expect(() =>
      authenticatedRedirectConnection(
        {
          ...enabled,
          httpProxyPolicy: { ...enabled.httpProxyPolicy!, httpsOnly: true },
        },
        insecure,
        true,
      ),
    ).toThrow();
  });
  it("does not pretend that header, manual social login or missing credentials are portable logins", () => {
    expect(
      redirectAuthenticationAvailability(
        { ...source, authType: "header" },
        review,
      ).available,
    ).toBe(false);
    expect(
      redirectAuthenticationAvailability(
        { ...source, basicAuthPassword: undefined },
        review,
      ).available,
    ).toBe(false);
    expect(
      redirectAuthenticationAvailability(
        {
          ...source,
          httpApplication: {
            version: 1,
            id: "synology-dsm",
            loginMode: "manual",
          },
        },
        review,
      ).available,
    ).toBe(false);
  });
  it.each(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "invalid-reference"])(
    "never forwards ignored local credentials from a vault source (%s)",
    (credentialId) => {
      const vault = {
        ...source,
        credentialSource: { kind: "vault" as const, credentialId },
      };
      expect(redirectAuthenticationAvailability(vault, review).available).toBe(
        false,
      );
      expect(() =>
        authenticatedRedirectConnection(vault, review, false),
      ).toThrow();
      const anonymous = anonymousRedirectConnection(vault, review);
      expect(anonymous.credentialSource).toBeUndefined();
      expect(anonymous.basicAuthPassword).toBeUndefined();
    },
  );
});
