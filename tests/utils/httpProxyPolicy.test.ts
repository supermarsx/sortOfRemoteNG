import { describe, expect, it } from "vitest";
import {
  normalizeHttpProxyPolicy,
  validateHttpCustomHeaders,
} from "../../src/utils/connection/httpProxyPolicy";
import { DEFAULT_EXTERNAL_FONT_ORIGINS } from "../../src/types/connection/httpProxyPolicy";

describe("HTTP proxy policy validation", () => {
  it("defaults all-request trust off and accepts only explicit boolean opt-ins", () => {
    const base = normalizeHttpProxyPolicy(undefined);
    expect(base.allowAllRequests).toBe(false);
    delete base.allowAllRequests;
    expect(normalizeHttpProxyPolicy(base).allowAllRequests).toBe(false);
    for (const allowAllRequests of [false, true]) {
      const policy = { ...base, allowAllRequests };
      expect(
        normalizeHttpProxyPolicy(JSON.parse(JSON.stringify(policy))),
      ).toEqual(policy);
    }
    for (const allowAllRequests of [null, 0, 1, "true", "false", {}, []]) {
      expect(() =>
        normalizeHttpProxyPolicy({ ...base, allowAllRequests }),
      ).toThrow("Invalid HTTP proxy policy");
    }
  });
  it("defaults all-script trust off, validates explicit booleans and roundtrips the opt-in", () => {
    const base = normalizeHttpProxyPolicy(undefined);
    expect(base.allowAllScripts).toBe(false);
    delete base.allowAllScripts;
    expect(normalizeHttpProxyPolicy(base).allowAllScripts).toBe(false);
    const optedIn = { ...base, allowAllScripts: true };
    expect(
      normalizeHttpProxyPolicy(JSON.parse(JSON.stringify(optedIn))),
    ).toEqual(optedIn);
    for (const allowAllScripts of [null, 1, "true", {}, []]) {
      expect(() =>
        normalizeHttpProxyPolicy({ ...base, allowAllScripts }),
      ).toThrow("Invalid HTTP proxy policy");
    }
  });
  it("defaults missing font settings to common hosts and clones origin arrays", () => {
    const legacy = normalizeHttpProxyPolicy(undefined);
    delete legacy.allowExternalFonts;
    delete legacy.externalFontOrigins;
    expect(normalizeHttpProxyPolicy(legacy)).toMatchObject({
      allowExternalFonts: true,
      externalFontOrigins: [...DEFAULT_EXTERNAL_FONT_ORIGINS],
    });
    const first = normalizeHttpProxyPolicy(undefined);
    first.externalFontOrigins!.push("https://fonts.example.com");
    expect(normalizeHttpProxyPolicy(undefined).externalFontOrigins).toEqual([
      ...DEFAULT_EXTERNAL_FONT_ORIGINS,
    ]);
    const copy = normalizeHttpProxyPolicy(first);
    expect(copy.externalFontOrigins).toEqual(first.externalFontOrigins);
    expect(copy.externalFontOrigins).not.toBe(first.externalFontOrigins);
  });
  it("canonicalizes and roundtrips font origins while retaining overridden settings", () => {
    const policy = normalizeHttpProxyPolicy({
      ...normalizeHttpProxyPolicy(undefined),
      allowExternalFonts: true,
      sameOriginOnly: true,
      externalFontOrigins: [
        " HTTPS://Fonts.GoogleApis.COM:443/ ",
        "https://fonts.gstatic.com",
        "https://fonts.example.com:8443/",
      ],
    });
    expect(policy.externalFontOrigins).toEqual([
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
      "https://fonts.example.com:8443",
    ]);
    expect(policy.allowExternalFonts).toBe(true);
    expect(
      normalizeHttpProxyPolicy(JSON.parse(JSON.stringify(policy))),
    ).toEqual(policy);
  });
  it.each(
    [
      null,
      "https://fonts.example.com",
      [null],
      [42],
      [""],
      ["http://fonts.example.com"],
      ["//fonts.example.com"],
      ["https://fonts.example.com/path"],
      ["https://fonts.example.com/.."],
      ["https://fonts.example.com?"],
      ["https://fonts.example.com/#"],
      ["https://user:password@fonts.example.com"],
      ["https://@fonts.example.com"],
      ["https://*.example.com"],
      ["https://%2a.example.com"],
      ["https://fonts.example.com\\"],
      ["https://fonts.example.com\n"],
      ["https://fonts.\texample.com"],
      ["https:///fonts.example.com"],
      ["https://fonts.example.com:99999"],
      ["https://fonts.example.com", " HTTPS://FONTS.EXAMPLE.COM:443/ "],
      ["https://" + "a".repeat(2049)],
      Array.from(
        { length: 17 },
        (_, index) => `https://fonts${index}.example.com`,
      ),
    ].map((externalFontOrigins) => ({ externalFontOrigins })),
  )(
    "rejects invalid external font origins case %# even when disabled",
    ({ externalFontOrigins }) => {
      expect(() =>
        normalizeHttpProxyPolicy({
          ...normalizeHttpProxyPolicy(undefined),
          externalFontOrigins,
        }),
      ).toThrow("Invalid HTTP proxy policy");
    },
  );
  it("accepts 16 font origins and rejects malformed opt-in values", () => {
    const base = normalizeHttpProxyPolicy(undefined);
    const externalFontOrigins = Array.from(
      { length: 16 },
      (_, index) => `https://fonts${index}.example.com`,
    );
    expect(
      normalizeHttpProxyPolicy({ ...base, externalFontOrigins })
        .externalFontOrigins,
    ).toEqual(externalFontOrigins);
    for (const allowExternalFonts of [null, 1, "true", {}, []]) {
      expect(() =>
        normalizeHttpProxyPolicy({ ...base, allowExternalFonts }),
      ).toThrow("Invalid HTTP proxy policy");
    }
  });
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
