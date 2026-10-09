import { describe, expect, it } from "vitest";
import { originBrowserLoadError } from "../../src/hooks/protocol/originBrowserSessionError";
import { originBrowserLoadFailure } from "../../src/types/protocols/originBrowser";

describe("safe native document failure evidence", () => {
  it("distinguishes reaching the private proxy from an upstream tunnel rejection", () => {
    const endpointFailure = originBrowserLoadError({
      code: -130,
      category: "proxy",
    });
    expect(endpointFailure).toContain("configured proxy endpoint");
    expect(endpointFailure).toContain("Retry browser");
    expect(endpointFailure).not.toContain("authentication settings");
    const tunnelFailure = originBrowserLoadError({
      code: -111,
      category: "proxy",
    });
    expect(tunnelFailure).toContain("authentication settings");
    expect(tunnelFailure).not.toContain("request did not reach");
  });
  it.each([
    [-105, "dns", "DNS"],
    [-102, "connection", "connection"],
    [-118, "timeout", "timed out"],
    [-21, "network-changed", "network changed"],
    [-106, "offline", "offline"],
    [-130, "proxy", "proxy"],
    [-202, "certificate", "saved trust policy"],
    [-107, "tls", "TLS"],
    [-20, "blocked", "permissions"],
    [-324, "http", "response"],
    [-310, "redirect", "redirect"],
    [-400, "cache", "resubmitting a form"],
    [-9999, "other", "numeric error code"],
  ])(
    "explains CEF %s from its fixed category only",
    (code, category, detail) => {
      const payload = {
        code,
        category,
        text: "SECRET",
        url: "https://SECRET/?token=SECRET",
      };
      expect(originBrowserLoadFailure("attached", payload)).toEqual({
        code,
        category,
      });
      const message = originBrowserLoadError(payload);
      expect(message).toContain(detail as string);
      expect(message).toContain(String(code));
      expect(message).toContain("no request was automatically retried");
      expect(message).not.toMatch(
        /SECRET|https?:|GPU|disable.*verif|ignore.*cert/,
      );
    },
  );

  it.each(["starting", "failed", "closing", "closed", null])(
    "never converts %s into a recoverable attached session",
    (phase) => {
      expect(
        originBrowserLoadFailure(phase, { code: -105, category: "dns" }),
      ).toBeUndefined();
    },
  );

  it.each([
    null,
    undefined,
    "SECRET",
    {},
    [],
    { code: "-105", category: "dns" },
    { code: -105, category: "SECRET" },
    { code: 0, category: "other" },
    { code: -1, category: "other" },
    { code: -3, category: "other" },
    { code: 200, category: "http" },
    { code: -1.5, category: "other" },
    { code: NaN, category: "other" },
    { code: -Infinity, category: "other" },
    { code: -2147483649, category: "other" },
  ])("drops malformed, transient and unknown payloads (%#)", (payload) => {
    expect(originBrowserLoadFailure("attached", payload)).toBeUndefined();
    expect(originBrowserLoadError(payload)).toBe(
      "The page could not be loaded. Review native browser diagnostics.",
    );
  });
});
