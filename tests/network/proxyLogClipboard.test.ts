import { describe, expect, it } from "vitest";
import { proxyLogClipboard } from "../../src/utils/network/proxyLogClipboard";
import type { ProxyRequestLogEntry } from "../../src/hooks/network/useInternalProxyManager";

const entry = (id: number): ProxyRequestLogEntry => ({
  id: String(id),
  session_id: "private-session",
  timestamp: "2026-09-13T09:00:00Z",
  method: "GET",
  url: "https://fixture.test/private/path?token=secret#secret",
  status: 200,
  error: null,
});
describe("safe retained proxy log clipboard snapshot", () => {
  it.each([0, 4, 1000, 1200])(
    "copies at most the newest 1000 of %s in chronological order without mutation",
    (size) => {
      const entries = Array.from({ length: size }, (_, i) => entry(size - i));
      const original = structuredClone(entries);
      const result = proxyLogClipboard(entries);
      expect(result.count).toBe(Math.min(size, 1000));
      const rows = result.text
        .split("\n")
        .filter((line) => /^\d+\./.test(line));
      expect(rows).toHaveLength(result.count);
      if (size) {
        expect(rows[0]).toContain(`sequence=${Math.max(1, size - 999)} |`);
        expect(rows[rows.length - 1]).toContain(`sequence=${size} |`);
      }
      expect(entries).toEqual(original);
      expect(result.text).toContain("oldest to newest");
    },
  );
  it("omits arbitrary paths, credentials, queries, fragments, error text and unlisted fields", () => {
    const supplied = [
      {
        ...entry(1),
        url: "https://private-user:private-password@fixture.test/private-token?token=private-query#private-fragment",
        error: "Authorization: Bearer private-error",
        headers: { Cookie: "private-cookie" },
        body: "private-body",
      },
    ];
    const result = proxyLogClipboard(supplied);
    expect(result.text).toContain("https://fixture.test");
    expect(result.text).not.toMatch(/private-|Authorization|Bearer/);
    expect(result.text).toContain("session-1");
    expect(result.text).toContain("duration is unavailable");
    expect(result.text).toContain("| unknown");
  });
  it("preserves closed request categories and fixed diagnostic codes, without guessing unknowns", () => {
    const urls = [
      "Attempted QuickConnect tunnel setup: https://dec.quickconnect.to",
      "QuickConnect NAS probe: https://example.direct.quickconnect.to:5001",
      "https://proxy.test/__sortofremoteng_quickconnect_redirect_v1?destination=private-target",
      "WebSocket handshake",
      "QuickConnect regional discovery: https://dec.quickconnect.to",
    ];
    const result = proxyLogClipboard(
      urls.map((url, i) => ({
        ...entry(i + 1),
        url,
        status: 403,
        error: "HTTP 403 [quickconnect_request_limit]",
      })),
    );
    for (const label of [
      "Attempted QuickConnect tunnel setup",
      "QuickConnect NAS probe",
      "QuickConnect redirect",
      "WebSocket handshake",
      "QuickConnect regional discovery",
    ])
      expect(result.text).toContain(label);
    expect(result.text).toContain("[quickconnect_request_limit]");
    expect(result.text).not.toContain("private-target");
  });
  it("fails closed for malformed or secret-bearing fields and unknown diagnostic codes", () => {
    const result = proxyLogClipboard([
      {
        ...entry(1),
        id: "private-id",
        method: "GET private-method",
        timestamp: "private-time",
        url: "private-url",
        error: "HTTP 403 [private_code]",
        status: NaN,
      },
    ]);
    expect(result.text).not.toContain("private");
    expect(result.text).toContain("sequence=unavailable");
    expect(result.text).toContain(
      "OTHER | HTTP unknown | unavailable | unknown",
    );
  });
});
