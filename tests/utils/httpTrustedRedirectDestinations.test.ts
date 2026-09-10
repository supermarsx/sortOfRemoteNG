import { describe, expect, it } from "vitest";
import {
  isTrustedHttpRedirectDestination,
  normalizeHttpRedirectOrigin,
  normalizeHttpTrustedRedirectDestinations,
} from "../../src/utils/protocol/httpTrustedRedirectDestinations";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";

describe("trusted redirect destination origins", () => {
  it("leaves legacy connection fields absent and normalizes explicit empty lists", () => {
    expect(normalizeHttpTrustedRedirectDestinations(undefined)).toEqual({
      version: 1,
      origins: [],
    });
    expect(
      normalizeAdvancedProtocolConnection({ protocol: "https" }),
    ).not.toHaveProperty("httpTrustedRedirectDestinations");
  });
  it.each([false, true])(
    "accepts and ignores legacy autoContinue=%s",
    (autoContinue) => {
      expect(
        normalizeHttpTrustedRedirectDestinations({
          version: 1,
          origins: ["https://nas.example"],
          autoContinue,
        }),
      ).toEqual({ version: 1, origins: ["https://nas.example"] });
    },
  );
  it.each([
    ["HTTPS://NAS.EXAMPLE:443/", "https://nas.example"],
    ["http://nas.example:80", "http://nas.example"],
    ["https://nas.example:5001", "https://nas.example:5001"],
    ["https://[::1]:5001/", "https://[::1]:5001"],
    ["https://bücher.example", "https://xn--bcher-kva.example"],
  ])("canonicalizes %s without widening the origin", (input, expected) => {
    expect(normalizeHttpRedirectOrigin(input)).toBe(expected);
  });
  it.each([
    "https://user:SECRET@nas.example",
    "https://@nas.example",
    "https://nas.example/login",
    "https://nas.example/a/..",
    "https://nas.example//",
    "https://nas.example?token=SECRET",
    "https://nas.example?",
    "https://nas.example#",
    "https://*.example",
    "https://.example",
    "https://nas.example.",
    "https://nas.example:0",
    "https://nas.example:65536",
    "https://nas.example\\other",
    "https://%6eas.example",
    "https://nas.example\n",
    " https://nas.example",
    "file:///private",
    "javascript:SECRET",
    "//nas.example",
    "https://",
    "https://" + "a".repeat(2048),
  ])(
    "rejects non-origin input %# without secret-bearing diagnostics",
    (value) => {
      expect(() => normalizeHttpRedirectOrigin(value)).toThrow(
        /Invalid trusted redirect destinations/,
      );
      try {
        normalizeHttpRedirectOrigin(value);
      } catch (error) {
        expect(String(error)).not.toContain("SECRET");
      }
    },
  );
  it.each([
    null,
    false,
    [],
    { version: 2, origins: [] },
    { version: 1, origins: "https://nas.example" },
    {
      version: 1,
      origins: ["https://nas.example", "https://NAS.EXAMPLE:443/"],
    },
    { version: 1, origins: [], allowDowngrade: true },
    { version: 1, origins: [], autoContinue: "true" },
    { version: 1, origins: [], autoContinue: 1 },
    { version: 1, origins: [], autoContinue: null },
    {
      version: 1,
      origins: Array.from({ length: 33 }, (_, i) => `https://nas${i}.example`),
    },
  ])("fails closed for malformed list %#", (value) => {
    expect(() => normalizeHttpTrustedRedirectDestinations(value)).toThrow();
    expect(
      isTrustedHttpRedirectDestination(value, "https://nas.example/login"),
    ).toBe(false);
  });
  it("rejects accessors without executing them", () => {
    let read = false;
    expect(() =>
      normalizeHttpTrustedRedirectDestinations({
        version: 1,
        get origins() {
          read = true;
          return [];
        },
      }),
    ).toThrow();
    expect(read).toBe(false);
  });
  it("matches only exact scheme, host and port, never suffixes or credentials", () => {
    const value = {
      version: 1,
      origins: ["https://nas.example:5001", "http://legacy.example"],
    };
    expect(
      isTrustedHttpRedirectDestination(
        value,
        "https://NAS.EXAMPLE:5001/webman/",
      ),
    ).toBe(true);
    expect(
      isTrustedHttpRedirectDestination(value, "http://legacy.example/path"),
    ).toBe(true);
    for (const url of [
      "https://nas.example/",
      "http://nas.example:5001",
      "https://child.nas.example:5001",
      "https://nas.example.evil:5001",
      "https://user:SECRET@nas.example:5001",
      "https://@nas.example:5001",
      "https://%6eas.example:5001",
      "https://nas.example:0",
    ]) {
      expect(isTrustedHttpRedirectDestination(value, url)).toBe(false);
    }
  });
  it("normalizes a saved JSON roundtrip without changing other security settings", () => {
    const connection = {
      protocol: "https",
      httpTrustedRedirectDestinations: {
        version: 1 as const,
        origins: ["HTTPS://NAS.EXAMPLE:443/"],
      },
      httpVerifySsl: true,
      httpsTrustPolicy: "strict" as const,
    };
    const result = normalizeAdvancedProtocolConnection(
      JSON.parse(JSON.stringify(connection)),
    );
    expect(result).toMatchObject({
      ...connection,
      httpTrustedRedirectDestinations: {
        version: 1,
        origins: ["https://nas.example"],
      },
    });
    expect(result).not.toHaveProperty("httpProxyPolicy");
    expect(result).not.toHaveProperty("httpRedirectAuthentication");
  });
});
