import { describe, expect, it } from "vitest";
import { diagnoseWebBrowserSettings } from "../../src/utils/settings/webBrowserSettingsDiagnostics";
import { normalizeWebBrowserSettings } from "../../src/utils/settings/webBrowserSettings";

describe("safe Web Browser settings diagnostics", () => {
  it("does not diagnose valid sparse or normalized settings", () => {
    for (const value of [undefined, {}, normalizeWebBrowserSettings(undefined)])
      expect(diagnoseWebBrowserSettings(value)).toEqual([]);
  });
  it.each([
    ["defaultZoomPercent", 201, "50 to 200"],
    ["initialLoadTimeoutSeconds", 9, "10 to 120"],
    ["documentReadyTimeoutSeconds", 241, "30 to 240"],
    ["minimumFormFillDelayMs", 30001, "0 to 30,000"],
    ["minimumFormSubmitDelayMs", 0.5, "0 to 30,000"],
    ["version", 9, "version 1"],
    ["engine", "SECRET", "real-origin"],
    ["cookiesEnabled", "SECRET", "true or false"],
    ["xsltEnabled", "SECRET", "true or false"],
    ["domainPermissions", { version: 99 }, "exact HTTPS origins"],
    ["defaultPolicy", { allowAllRequests: true }, "per-connection review"],
    ["sessionRetention", {}, "All five fields"],
  ])(
    "identifies %s without exposing its rejected value",
    (field, value, fix) => {
      const issues = diagnoseWebBrowserSettings({ [field as string]: value });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ field: `webBrowser.${field}` });
      expect(issues[0].fix).toContain(fix);
      expect(JSON.stringify(issues)).not.toContain("SECRET");
    },
  );
  it("reports all bad scalar fields and combined delay constraints", () => {
    expect(
      diagnoseWebBrowserSettings({
        cookiesEnabled: "yes",
        defaultZoomPercent: 500,
        minimumFormFillDelayMs: 30000,
        minimumFormSubmitDelayMs: 30000,
      }).map((issue) => issue.field),
    ).toEqual(
      expect.arrayContaining([
        "webBrowser.cookiesEnabled",
        "webBrowser.defaultZoomPercent",
        "webBrowser.minimumFormFillDelayMs + minimumFormSubmitDelayMs",
      ]),
    );
  });
  it("does not copy unknown keys, nested values or parser errors", () => {
    const issues = diagnoseWebBrowserSettings({
      "SECRET-KEY": "PRIVATE",
      domainPermissions: {
        version: 1,
        websites: [{ origin: "https://user:secret@hidden.example" }],
      },
    });
    expect(issues).toHaveLength(2);
    expect(JSON.stringify(issues)).not.toMatch(
      /SECRET|PRIVATE|hidden|user:secret/,
    );
  });
  it.each([null, false, [], 42, "SECRET"])(
    "rejects a non-object root without resetting it (%s)",
    (value) => {
      expect(diagnoseWebBrowserSettings(value)).toEqual([
        {
          field: "webBrowser",
          fix: expect.stringContaining("settings object"),
        },
      ]);
    },
  );
});
