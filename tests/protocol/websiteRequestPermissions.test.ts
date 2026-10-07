import { describe, expect, it } from "vitest";
import { normalizeHttpProxyPolicy } from "../../src/utils/connection/httpProxyPolicy";
import {
  allWebsiteRequestsAllowed,
  allowAllWebsiteRequests,
} from "../../src/utils/protocol/websiteRequestPermissions";
import {
  allowAllWebsiteScripts,
  allListedWebsiteScriptPermissions,
  websiteScriptPermission,
} from "../../src/utils/protocol/websiteScriptPermissions";

describe("reviewed website request permission proposals", () => {
  it("opts in without mutating source lists, HTTPS, downgrade or other saved controls", () => {
    const policy = normalizeHttpProxyPolicy({
      ...normalizeHttpProxyPolicy(undefined),
      pageScripts: "block",
      sameOriginOnly: true,
      httpsOnly: true,
      allowExternalFonts: false,
      externalFontOrigins: [],
      externalResourceOrigins: [
        { origin: "https://assets.example.test", kinds: ["stylesheet"] },
      ],
      cacheMode: "bypass",
      queryParameters: [{ name: "tenant", value: "synthetic" }],
    });
    const before = structuredClone(policy);
    const next = allowAllWebsiteRequests(policy)!;
    expect(next).toEqual({
      ...before,
      allowAllRequests: true,
      pageScripts: "allow",
      sameOriginOnly: false,
    });
    expect(next.allowAllScripts).toBe(false);
    expect(next.allowCrossOriginRedirects).toBe(false);
    expect(next.allowHttpDowngradeRedirects).toBe(false);
    expect(next.externalResourceOrigins).not.toBe(
      policy.externalResourceOrigins,
    );
    expect(next.queryParameters).not.toBe(policy.queryParameters);
    expect(policy).toEqual(before);
    expect(allWebsiteRequestsAllowed(next)).toBe(true);
    expect(allowAllWebsiteRequests(next)).toBeNull();
  });

  it("defaults off, respects same-origin restrictions and refuses unavailable or malformed policies", () => {
    const policy = normalizeHttpProxyPolicy(undefined);
    expect(allWebsiteRequestsAllowed(null)).toBe(false);
    expect(allWebsiteRequestsAllowed(policy)).toBe(false);
    expect(
      allWebsiteRequestsAllowed({ ...policy, allowAllScripts: true }),
    ).toBe(false);
    expect(
      allWebsiteRequestsAllowed({
        ...policy,
        allowAllRequests: true,
        sameOriginOnly: true,
      }),
    ).toBe(false);
    expect(allowAllWebsiteRequests(null)).toBeNull();
    expect(
      allowAllWebsiteRequests({ ...policy, httpsOnly: "true" } as never),
    ).toBeNull();
  });

  it.each(["source", "listed", "all-scripts"])(
    "clears dormant all-request trust when granting %s permission",
    (grant) => {
      const policy = {
        ...normalizeHttpProxyPolicy(undefined),
        allowAllRequests: true,
        allowAllScripts: true,
        sameOriginOnly: true,
        pageScripts: "block" as const,
        externalResourceOrigins: [],
      };
      const report = {
        kind: "script",
        reason: "policy-blocked-resource",
        origin: "https://cdn.example.test",
      };
      const before = structuredClone(policy);
      const proposed =
        grant === "source"
          ? websiteScriptPermission(report, policy).policy
          : grant === "listed"
            ? allListedWebsiteScriptPermissions([report], policy).policy
            : allowAllWebsiteScripts(policy);
      expect(proposed).toMatchObject({
        allowAllRequests: false,
        allowAllScripts: grant === "all-scripts",
        sameOriginOnly: false,
        pageScripts: "allow",
      });
      expect(policy).toEqual(before);
      expect(allWebsiteRequestsAllowed(proposed)).toBe(false);
    },
  );

  it.each(["fetch", "navigation"])(
    "does not turn a %s report into a script grant",
    (kind) => {
      const policy = normalizeHttpProxyPolicy(undefined);
      const before = structuredClone(policy);
      expect(
        websiteScriptPermission(
          {
            kind,
            reason: "origin-not-approved",
            origin: "https://api.example.test",
          },
          policy,
        ).policy,
      ).toBeNull();
      expect(policy).toEqual(before);
      expect(policy.allowAllRequests).toBe(false);
    },
  );
});
