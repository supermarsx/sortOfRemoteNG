import { describe, expect, it } from "vitest";
import { normalizeHttpProxyPolicy } from "../../src/utils/connection/httpProxyPolicy";
import {
  websiteScriptPermission,
  allListedWebsiteScriptPermissions,
  allowAllWebsiteScripts,
  allWebsiteScriptsAllowed,
} from "../../src/utils/protocol/websiteScriptPermissions";
import type { WebNetworkReport } from "../../src/utils/protocol/webNetworkReport";

const report = (origin: string | null): WebNetworkReport => ({
  kind: "script",
  reason: "policy-blocked-resource",
  origin,
});
describe("reviewed website script permission proposals", () => {
  it("makes all-script trust explicit without granting unrelated resources or credentials", () => {
    const policy = {
      ...normalizeHttpProxyPolicy(undefined),
      pageScripts: "block" as const,
      sameOriginOnly: true,
      externalResourceOrigins: [],
      externalFontOrigins: [],
      allowExternalFonts: false,
    };
    const before = structuredClone(policy);
    const next = allowAllWebsiteScripts(policy)!;
    expect(next).toEqual({
      ...before,
      allowAllScripts: true,
      pageScripts: "allow",
      sameOriginOnly: false,
    });
    expect(policy).toEqual(before);
    expect(allWebsiteScriptsAllowed(next)).toBe(true);
    expect(allWebsiteScriptsAllowed({ ...next, sameOriginOnly: true })).toBe(
      false,
    );
    expect(
      allWebsiteScriptsAllowed({ ...next, pageScripts: "inline-only" }),
    ).toBe(false);
    expect(allowAllWebsiteScripts(null)).toBeNull();
    expect(allowAllWebsiteScripts(next)).toBeNull();
    expect(websiteScriptPermission(report(null), next).explanation).toContain(
      "already enabled",
    );
  });
  it("adds listed sources atomically without including inline or future sources", () => {
    const policy = {
      ...normalizeHttpProxyPolicy(undefined),
      externalResourceOrigins: [],
    };
    const reports = [
      report(null),
      report("https://one.test"),
      report("https://two.test"),
      report("https://one.test"),
    ];
    const next = allListedWebsiteScriptPermissions(reports, policy);
    expect(next.count).toBe(2);
    expect(next.policy?.allowAllScripts).toBe(false);
    expect(next.policy?.externalResourceOrigins).toEqual([
      { origin: "https://one.test", kinds: ["script"] },
      { origin: "https://two.test", kinds: ["script"] },
    ]);
    const full = {
      ...policy,
      externalResourceOrigins: Array.from({ length: 15 }, (_, i) => ({
        origin: `https://cdn${i}.test`,
        kinds: ["script" as const],
      })),
    };
    expect(allListedWebsiteScriptPermissions(reports, full).policy).toBeNull();
    expect(full.externalResourceOrigins).toHaveLength(15);
  });
  it("adds only the selected origin's scripts while preserving all other policy fields", () => {
    const policy = {
      ...normalizeHttpProxyPolicy(undefined),
      httpsOnly: true,
      queryParameters: [{ name: "example", value: "private" }],
    };
    const before = structuredClone(policy);
    const next = websiteScriptPermission(
      report("https://cdn.example.test"),
      policy,
    ).policy!;
    expect(next).toEqual({
      ...before,
      externalResourceOrigins: [
        ...before.externalResourceOrigins!,
        { origin: "https://cdn.example.test", kinds: ["script"] },
      ],
    });
    expect(policy).toEqual(before);
  });
  it("preserves existing stylesheet permission when adding scripts", () => {
    const policy = {
      ...normalizeHttpProxyPolicy(undefined),
      externalResourceOrigins: [
        { origin: "https://cdn.example.test", kinds: ["stylesheet" as const] },
      ],
    };
    expect(
      websiteScriptPermission(report("https://cdn.example.test"), policy).policy
        ?.externalResourceOrigins,
    ).toEqual([
      { origin: "https://cdn.example.test", kinds: ["stylesheet", "script"] },
    ]);
  });
  it.each([
    null,
    "http://cdn.example.test",
    "https://cdn.example.test/?token=private",
    "https://user:private@cdn.example.test",
    "https://*.example.test",
    "https://p123.localhost",
    "https://localhost",
    "data:text/javascript,private",
    "https://cdn.example.test\\path",
  ])("does not propose permission for %s", (origin) => {
    expect(
      websiteScriptPermission(
        report(origin),
        normalizeHttpProxyPolicy(undefined),
      ).policy,
    ).toBeNull();
  });
  it("does not broaden already approved sources or bypass invalid policy", () => {
    const policy = normalizeHttpProxyPolicy(undefined);
    expect(
      websiteScriptPermission(report("https://js.stripe.com"), policy)
        .explanation,
    ).toContain("already allowed");
    expect(
      websiteScriptPermission(report("https://cdn.example.test"), null).policy,
    ).toBeNull();
  });
  it("does not treat fetch or unsupported-script-context reports as an external script permission", () => {
    const policy = normalizeHttpProxyPolicy(undefined);
    expect(
      websiteScriptPermission(
        { ...report("https://cdn.example.test"), kind: "fetch" },
        policy,
      ).policy,
    ).toBeNull();
    expect(
      websiteScriptPermission(
        {
          ...report("https://cdn.example.test"),
          reason: "unsupported-network-context",
        },
        policy,
      ).policy,
    ).toBeNull();
  });
  it("respects the 16-source cap but can add script to an existing stylesheet entry", () => {
    const policy = {
      ...normalizeHttpProxyPolicy(undefined),
      externalResourceOrigins: Array.from({ length: 16 }, (_, i) => ({
        origin: `https://cdn${i}.example.test`,
        kinds: ["stylesheet" as const],
      })),
    };
    expect(
      websiteScriptPermission(report("https://extra.example.test"), policy)
        .explanation,
    ).toContain("16-source limit");
    expect(
      websiteScriptPermission(report("https://cdn0.example.test"), policy)
        .policy?.externalResourceOrigins,
    ).toHaveLength(16);
  });
  it("makes restrictive policy changes explicit in the returned proposal", () => {
    const policy = {
      ...normalizeHttpProxyPolicy(undefined),
      sameOriginOnly: true,
      pageScripts: "inline-only" as const,
      allowAllScripts: true,
    };
    expect(
      websiteScriptPermission(report("https://js.stripe.com"), policy).policy,
    ).toMatchObject({
      sameOriginOnly: false,
      pageScripts: "allow",
      allowAllScripts: false,
    });
    expect(policy).toMatchObject({
      sameOriginOnly: true,
      pageScripts: "inline-only",
    });
  });
});
