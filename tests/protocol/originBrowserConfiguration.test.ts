import { describe, expect, it } from "vitest";
import {
  originBrowserConfigurationDetails,
  originBrowserNavigationUrl,
  validateOriginBrowserConfiguration,
  type BrowserConfigurationIssue,
} from "../../src/hooks/protocol/originBrowserConfiguration";

const valid = {
  initialUrl: "https://site.invalid/path?token=SECRET#fragment",
  ownerDatabaseId: "db",
  connectionId: "connection",
  sessionId: "tab",
  expectedSecurityRevision: "revision",
  sourceSessionId: "unlock",
  consentKind: "required",
  grantId: null,
};

describe("native browser configuration diagnostics", () => {
  it("preserves a valid navigation URL without publishing its content as diagnostics", () => {
    expect(validateOriginBrowserConfiguration(valid)).toEqual({
      url: valid.initialUrl,
      issues: [],
    });
    expect(originBrowserNavigationUrl(valid.initialUrl)).toBe(valid.initialUrl);
  });

  it.each([
    ["", "url-missing"],
    [null, "url-missing"],
    [17, "url-type"],
    ["site.invalid", "url-invalid"],
    ["https://site.invalid:99999", "url-invalid"],
    ["javascript:alert(1)", "url-scheme"],
    ["https://user:SECRET@site.invalid", "url-credentials"],
    ["https://site.invalid/a b", "url-characters"],
    ["https://site.invalid/\\foo", "url-characters"],
    ["https://site.invalid/\u007f", "url-characters"],
    [`https://site.invalid/${"x".repeat(16_384)}`, "url-too-long"],
    [`https://site.invalid/${"é".repeat(8192)}`, "url-too-long"],
    [`https://site.invalid/${"é".repeat(4096)}`, "url-too-long"],
  ])(
    "identifies the rejected address rule without echoing %s",
    (initialUrl, issue) => {
      const result = validateOriginBrowserConfiguration({
        ...valid,
        initialUrl,
      });
      expect(result).toEqual({ url: null, issues: [issue] });
      const details = originBrowserConfigurationDetails(result.issues);
      expect(details[0].code).toBe(issue);
      expect(details[0].action).toBe("connection");
      expect(JSON.stringify(details)).not.toMatch(
        /SECRET|site\.invalid|alert\(1\)/,
      );
    },
  );

  it.each([
    "ownerDatabaseId",
    "connectionId",
    "sessionId",
    "expectedSecurityRevision",
    "sourceSessionId",
    "grantId",
  ] as const)("identifies the exact rejected %s reference", (field) => {
    for (const [value, reason] of [
      ["", "missing"],
      [123, "type"],
      ["x".repeat(257), "too-long"],
    ] as const) {
      const result = validateOriginBrowserConfiguration({
        ...valid,
        consentKind: "existing-grant",
        grantId: "grant",
        [field]: value,
      });
      expect(result.issues).toEqual([`${field}:${reason}`]);
      const details = originBrowserConfigurationDetails(result.issues);
      expect(details[0].code).toBe(`${field}:${reason}`);
      expect(details[0].problem).toContain(
        reason === "missing"
          ? "missing"
          : reason === "type"
            ? "not stored as text"
            : "256-character",
      );
      expect(JSON.stringify(details)).not.toContain("x".repeat(257));
    }
  });

  it("reports every validation failure together and rejects unknown consent modes", () => {
    const result = validateOriginBrowserConfiguration({
      ...valid,
      initialUrl: "",
      sourceSessionId: "",
      expectedSecurityRevision: "",
      consentKind: "invented-SECRET",
    });
    expect(result.issues).toEqual([
      "url-missing",
      "expectedSecurityRevision:missing",
      "sourceSessionId:missing",
      "consent-kind",
    ]);
    expect(originBrowserConfigurationDetails(result.issues)).toHaveLength(4);
    expect(
      JSON.stringify(originBrowserConfigurationDetails(result.issues)),
    ).not.toContain("SECRET");
  });

  it("ignores arbitrary diagnostic codes and deduplicates fixed ones", () => {
    expect(
      originBrowserConfigurationDetails([
        "SECRET",
        "sessionId:missing:SECRET",
      ] as unknown as BrowserConfigurationIssue[]),
    ).toEqual([]);
    expect(
      originBrowserConfigurationDetails(["url-missing", "url-missing"]),
    ).toHaveLength(1);
  });
});
