import { describe, expect, it } from "vitest";
import {
  appendWebNetworkReport,
  parseWebNetworkReport,
} from "../../src/utils/protocol/webNetworkReport";
import { parseWebNetworkGuardStatus } from "../../src/utils/protocol/webNetworkGuard";
const document = {
  sessionId: "proxy-1",
  token: "a".repeat(32),
  sequence: 7,
  navigationToken: "b".repeat(32),
  url: "http://p0123456789abcdef0123456789abcdef.localhost:43123/",
};
const report = {
  type: "sorng_web_network_blocked",
  version: 1,
  sessionId: document.sessionId,
  documentToken: document.token,
  documentSequence: document.sequence,
  navigationToken: document.navigationToken,
  url: document.url,
  kind: "fetch",
  reason: "origin-not-approved",
  origin: "https://cdn.example",
};
describe("untrusted page network report boundary", () => {
  it("accepts a fenced font category without exporting path or page errors", () => {
    expect(
      parseWebNetworkReport(
        { ...report, kind: "font", error: "private" },
        document,
      ),
    ).toEqual({
      kind: "font",
      reason: "origin-not-approved",
      origin: "https://cdn.example",
    });
  });
  it("returns only closed diagnostic categories and an exact origin", () => {
    expect(
      parseWebNetworkReport(
        { ...report, body: "secret", headers: { Authorization: "secret" } },
        document,
      ),
    ).toEqual({
      kind: "fetch",
      reason: "origin-not-approved",
      origin: "https://cdn.example",
    });
  });
  it.each([
    { sessionId: "other" },
    { documentToken: "c".repeat(32) },
    { documentSequence: 6 },
    { navigationToken: null },
    { url: document.url + "other" },
    { version: 2 },
    { kind: "secret" },
    { reason: "raw server body" },
    { origin: "https://cdn.example/path?token=secret" },
    { origin: "https://user:secret@cdn.example" },
    { origin: "file:///secret" },
    { origin: "https://cdn.example/" },
    { origin: "x".repeat(2049) },
  ])("rejects stale or unsafe report %j", (change) => {
    expect(
      parseWebNetworkReport({ ...report, ...change }, document),
    ).toBeNull();
  });
  it("caps and deduplicates diagnostics without growing the stored payload", () => {
    const first = parseWebNetworkReport(report, document)!;
    const rows = [first];
    expect(appendWebNetworkReport(rows, first)).toBe(rows);
    const full = Array.from({ length: 32 }, (_, index) => ({
      ...first,
      origin: `https://host${index}.example`,
    }));
    expect(appendWebNetworkReport(full, first)).toBe(full);
  });
});
describe("native frame guard status contract", () => {
  it("accepts honest enforced and unsupported partial coverage", () => {
    for (const status of [
      { platform: "windows", frameNavigation: "enforced" },
      { platform: "linux", frameNavigation: "unsupported" },
    ])
      expect(
        parseWebNetworkGuardStatus({
          ...status,
          allNetworkRequestsMediated: false,
        }).allNetworkRequestsMediated,
      ).toBe(false);
  });
  it.each([
    undefined,
    {},
    {
      platform: "windows",
      frameNavigation: "unsupported",
      allNetworkRequestsMediated: false,
    },
    {
      platform: "windows",
      frameNavigation: "enforced",
      allNetworkRequestsMediated: true,
    },
    {
      platform: "windows",
      frameNavigation: "guess",
      allNetworkRequestsMediated: false,
    },
  ])("rejects unavailable or overstated protection %j", (value) => {
    expect(() => parseWebNetworkGuardStatus(value)).toThrow();
  });
});
