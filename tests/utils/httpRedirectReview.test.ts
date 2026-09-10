import { describe, expect, it } from "vitest";
import {
  anonymousRedirectConnection,
  parseHttpRedirectReview,
} from "../../src/utils/protocol/httpRedirectReview";
import type { Connection } from "../../src/types/connection/connection";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import {
  registerRuntimeConnection,
  getRuntimeWebNavigation,
  clearRuntimeConnectionsForTests,
} from "../../src/utils/session/runtimeConnectionRegistry";
const review = {
  receiptId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  sessionId: "s",
  sourceOrigin: "https://source.invalid",
  destinationUrl: "https://target.invalid/admin/",
  navigationToken: null,
  documentSequence: 1,
  removedQuery: false,
};
describe("redirect review boundary", () => {
  it("requires both explicit downgrade opt-ins, honors HTTPS-only, and preserves consent across reviewed hops", () => {
    const candidate = {
      ...review,
      destinationUrl: "http://target.invalid/admin/",
    };
    const policy = {
      ...DEFAULT_HTTP_PROXY_POLICY,
      allowCrossOriginRedirects: true,
      allowHttpDowngradeRedirects: true,
    };
    for (const blocked of [
      undefined,
      { ...policy, allowCrossOriginRedirects: false },
      { ...policy, allowHttpDowngradeRedirects: false },
      { ...policy, httpsOnly: true },
    ])
      expect(
        parseHttpRedirectReview(candidate, "s", review.sourceOrigin, blocked),
      ).toBeNull();
    expect(
      parseHttpRedirectReview(candidate, "s", review.sourceOrigin, policy),
    ).toEqual(candidate);
    const source = { httpProxyPolicy: policy } as Connection;
    const plain = anonymousRedirectConnection(source, candidate);
    expect(plain).toMatchObject({
      protocol: "http",
      port: 80,
      httpAutoLogin: false,
      httpProxyPolicy: {
        httpsOnly: false,
        allowCrossOriginRedirects: true,
        allowHttpDowngradeRedirects: true,
      },
    });
    const secure = anonymousRedirectConnection(source, review);
    expect(secure.httpProxyPolicy?.httpsOnly).toBe(false);
    expect(secure.httpProxyPolicy?.allowHttpDowngradeRedirects).toBe(true);
  });
  it.each([
    ["http", "http", true],
    ["http", "https", true],
    ["https", "https", true],
    ["https", "http", false],
  ])("%s to %s review is allowed=%s", (from, to, allowed) => {
    const candidate = {
      ...review,
      sourceOrigin: `${from}://source.invalid`,
      destinationUrl: `${to}://target.invalid/admin/`,
    };
    expect(
      !!parseHttpRedirectReview(candidate, "s", candidate.sourceOrigin),
    ).toBe(allowed);
  });
  it.each([
    "https://user:password@target.invalid/",
    "https://target.invalid/?token=private",
    "https://target.invalid/#private",
    "https://target.invalid:0/",
    "javascript:alert(1)",
    "https://source.invalid/",
  ])("rejects unreviewed destination %s", (destinationUrl) => {
    expect(
      parseHttpRedirectReview(
        { ...review, destinationUrl },
        "s",
        review.sourceOrigin,
      ),
    ).toBeNull();
  });
  it("uses a narrow anonymous whitelist, preserves network transport only and requires fresh trust", () => {
    const source = {
      id: "source",
      name: "Original",
      hostname: "source.invalid",
      protocol: "https",
      port: 443,
      isGroup: false,
      createdAt: "now",
      updatedAt: "now",
      username: "secret-user",
      password: "secret-password",
      basicAuthUsername: "secret-basic",
      httpHeaders: { Authorization: "secret-header" },
      httpFormAutomation: { fields: ["secret-field"] },
      httpAutoMfa: { enabled: true },
      totpConfigs: [{ secret: "secret-seed" }],
      scripts: { onConnect: ["secret-code"] },
      httpApplication: { id: "synology", loginMode: "form" },
      httpVerifySsl: false,
      proxyChainId: "route",
      httpProxyPolicy: {
        pageScripts: "block",
        sameOriginOnly: true,
        queryParameters: [{ name: "token", value: "secret-query" }],
      },
    } as unknown as Connection;
    const result = anonymousRedirectConnection(source, review);
    expect(JSON.stringify(result)).not.toContain("secret-");
    expect(result).toMatchObject({
      protocol: "https",
      hostname: "target.invalid",
      port: 443,
      httpVerifySsl: true,
      httpsTrustPolicy: "always-ask",
      httpAutoLogin: false,
      proxyChainId: "route",
      httpProxyPolicy: {
        allowCrossOriginRedirects: true,
        queryParameters: [],
        pageScripts: "block",
      },
    });
    expect(result.id).not.toBe(source.id);
    expect(result.httpApplication).toBeUndefined();
    expect(result.parentId).toBeUndefined();
    registerRuntimeConnection(result, {
      initialUrl: review.destinationUrl,
      redirectHops: 1,
      assertCurrent: () => {},
    });
    expect(getRuntimeWebNavigation(result.id)).toBeDefined();
    registerRuntimeConnection({ ...result });
    expect(getRuntimeWebNavigation(result.id)).toBeUndefined();
    clearRuntimeConnectionsForTests();
  });
});
