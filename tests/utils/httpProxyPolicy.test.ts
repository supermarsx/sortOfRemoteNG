import { describe, expect, it } from "vitest";
import {
  normalizeHttpProxyPolicy,
  validateHttpCustomHeaders,
} from "../../src/utils/connection/httpProxyPolicy";

describe("HTTP proxy policy validation", () => {
  it("defaults reviewed redirects off for absent/legacy policies and rejects malformed opt-ins", () => {
    const legacy = { ...normalizeHttpProxyPolicy(undefined) };
    delete legacy.allowCrossOriginRedirects;
    delete legacy.allowHttpDowngradeRedirects;
    expect(normalizeHttpProxyPolicy(legacy).allowHttpDowngradeRedirects).toBe(
      false,
    );
    for (const value of ["true", 1, null, {}])
      expect(() =>
        normalizeHttpProxyPolicy({
          ...legacy,
          allowHttpDowngradeRedirects: value,
        }),
      ).toThrow("Invalid HTTP proxy policy");
    const enabled = {
      ...legacy,
      allowCrossOriginRedirects: true,
      allowHttpDowngradeRedirects: true,
    };
    expect(
      normalizeHttpProxyPolicy(JSON.parse(JSON.stringify(enabled))),
    ).toMatchObject(enabled);
    expect(normalizeHttpProxyPolicy(undefined).allowCrossOriginRedirects).toBe(
      false,
    );
    expect(normalizeHttpProxyPolicy(legacy).allowCrossOriginRedirects).toBe(
      false,
    );
    expect(
      normalizeHttpProxyPolicy({ ...legacy, allowCrossOriginRedirects: true })
        .allowCrossOriginRedirects,
    ).toBe(true);
    for (const value of ["true", 1, null, {}])
      expect(() =>
        normalizeHttpProxyPolicy({
          ...legacy,
          allowCrossOriginRedirects: value,
        }),
      ).toThrow("Invalid HTTP proxy policy");
  });
  it("preserves absent legacy behavior and returns independent parameter arrays", () => {
    const a = normalizeHttpProxyPolicy(undefined);
    a.queryParameters.push({ name: "tenant", value: "private" });
    expect(normalizeHttpProxyPolicy(undefined).queryParameters).toEqual([]);
    expect(a).toMatchObject({
      pageScripts: "allow",
      httpsOnly: false,
      sameOriginOnly: false,
      cacheMode: "normal",
    });
  });
  it("roundtrips all explicit controls and secret-capable query values", () => {
    const value = {
      ...normalizeHttpProxyPolicy(undefined),
      pageScripts: "block",
      httpsOnly: true,
      sameOriginOnly: true,
      cacheMode: "bypass",
      queryParameters: [{ name: "token", value: "private&value=1" }],
    };
    expect(normalizeHttpProxyPolicy(value)).toEqual(value);
  });
  it("rejects malformed, oversized, duplicate and reserved parameter state without echoing secrets", () => {
    const base = normalizeHttpProxyPolicy(undefined);
    for (const value of [
      null,
      {},
      { ...base, arbitrary: true },
      { ...base, pageScripts: "eval" },
      {
        ...base,
        queryParameters: [{ name: "__sorng_navigation_v1", value: "private" }],
      },
      { ...base, queryParameters: [{ name: "token", value: "private\r\n" }] },
      {
        ...base,
        queryParameters: [{ name: "token", value: "x".repeat(4097) }],
      },
      {
        ...base,
        queryParameters: [
          { name: "token", value: "a" },
          { name: "token", value: "b" },
        ],
      },
    ])
      expect(() => normalizeHttpProxyPolicy(value)).toThrow(
        "Invalid HTTP proxy policy",
      );
  });
  it("allows deliberate header credentials only in header mode, never routing overrides", () => {
    expect(
      validateHttpCustomHeaders(
        { Authorization: "Bearer private", "X-Tenant": "a" },
        "header",
      ),
    ).toEqual({ Authorization: "Bearer private", "X-Tenant": "a" });
    expect(validateHttpCustomHeaders({ "X-Tenant": "a" }, "digest")).toEqual({
      "X-Tenant": "a",
    });
    for (const name of ["Authorization", "X-Api-Key", "X-Auth-Token"])
      expect(() =>
        validateHttpCustomHeaders({ [name]: "private" }, "basic"),
      ).toThrow("restricted");
    for (const name of [
      "Host",
      "Cookie",
      "Origin",
      "Referer",
      "Connection",
      "Sec-Fetch-Site",
      "Proxy-Authorization",
      "Content-Length",
      "X-Forwarded-Host",
    ])
      expect(() =>
        validateHttpCustomHeaders({ [name]: "private" }, "header"),
      ).toThrow("restricted");
    expect(() =>
      validateHttpCustomHeaders({ "X-Test": "private\n" }, "header"),
    ).toThrow("restricted");
    expect(() =>
      validateHttpCustomHeaders({ "X-Test": "a", "x-test": "b" }, "header"),
    ).toThrow("restricted");
  });
});
