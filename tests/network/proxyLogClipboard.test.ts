import { describe, expect, it } from "vitest";
import { proxyLogClipboard } from "../../src/utils/network/proxyLogClipboard";
import type { ProxyRequestLogEntry } from "../../src/hooks/network/useInternalProxyManager";
import type { ProxyLogDiagnostic } from "../../src/utils/network/proxyLogDiagnostic";

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
  it("copies safe redirect categories and actual upstream status independently of a relay candidate result", () => {
    const redirect: ProxyLogDiagnostic = {
      phase: "quickconnect_redirect",
      stage: "handoff",
      outcome: "continuing",
      code: "quickconnect_redirect_pending",
      durationMs: 12,
      upstreamStatus: 302,
      redirectSourcePath: "root",
      redirectTargetPath: "dsm",
      redirectTargetOrigin: "https://target.test",
      redirectQueryRemoved: true,
      sameOriginRedirects: 2,
    };
    const result = proxyLogClipboard([
      { ...entry(2), status: 202, diagnostic: redirect },
      {
        ...entry(1),
        diagnostic: {
          phase: "quickconnect_relay_probe",
          stage: "complete",
          outcome: "succeeded",
          code: "quickconnect_upstream_status",
          durationMs: 5,
          upstreamStatus: 200,
        },
      },
    ]);
    const rows = result.text.split("\n").filter((line) => /^\d+\./.test(line));
    expect(rows[0]).toContain("phase=Relay candidate");
    expect(rows[0]).toContain("upstreamHTTP=200");
    expect(rows[0]).toContain("candidate result only");
    expect(rows[1]).toContain("HTTP 202");
    expect(rows[1]).toContain("upstreamHTTP=302");
    expect(rows[1]).toContain("redirectSourceOrigin=https://fixture.test");
    expect(rows[1]).toContain("redirectTargetOrigin=https://target.test");
    expect(rows[1]).toContain("redirectSourcePath=root");
    expect(rows[1]).toContain("redirectTargetPath=dsm");
    expect(rows[1]).toContain("redirectQueryRemoved=true");
    expect(rows[1]).toContain("sameOriginRedirects=2");
    expect(result.text).not.toMatch(/private\/path|token=secret|#secret/);
    const invalid = proxyLogClipboard([
      {
        ...entry(3),
        diagnostic: {
          ...redirect,
          redirectTargetOrigin: "https://target.test?private-token",
        },
      },
    ]);
    expect(invalid.text).not.toContain("private-token");
    expect(invalid.text).toContain("sequence=3");
    expect(invalid.text).not.toContain("redirectTargetOrigin=");
  });
  it("correlates validated native attempt IDs across proxy sessions and includes safe timings/stages", () => {
    const detail: ProxyLogDiagnostic = {
      phase: "quickconnect_direct_probe",
      lane: "direct_probe",
      stage: "queue",
      outcome: "timed_out",
      code: "quickconnect_queue_timeout",
      durationMs: 10,
      queueMs: 10,
      activeMs: 0,
      attemptId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      hop: 0,
    };
    const result = proxyLogClipboard([
      {
        ...entry(3),
        session_id: "other",
        diagnostic: {
          ...detail,
          attemptId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        },
      },
      {
        ...entry(2),
        session_id: "new-proxy",
        diagnostic: { ...detail, hop: 1, upstreamStatus: 503 },
      },
      { ...entry(1), session_id: "old-proxy", diagnostic: detail },
    ]);
    const rows = result.text.split("\n").filter((line) => /^\d+\./.test(line));
    expect(rows[0]).toContain("session-1");
    expect(rows[1]).toContain("session-2");
    expect(rows[0]).toContain("attempt-1");
    expect(rows[1]).toContain("attempt-1");
    expect(rows[2]).toContain("attempt-2");
    expect(rows[1]).toContain("hop=1");
    expect(rows[1]).toContain("upstreamHTTP=503");
    expect(rows[0]).toContain("stage=Waiting for capacity");
    expect(rows[0]).toContain(
      "durationMs=10 | [quickconnect_queue_timeout] | lane=direct_probe | queueMs=10 | activeMs=0",
    );
    expect(result.text).toContain(
      "candidate result only; not the final connection result",
    );
    expect(result.text).not.toContain("aaaaaaaa-");
  });
  it("does not copy malformed metadata or use its attempt identifier for grouping", () => {
    const supplied = [
      {
        ...entry(1),
        diagnostic: {
          phase: "private-phase",
          attemptId: "private-token",
          headers: { Cookie: "private-cookie" },
        },
      },
    ];
    const result = proxyLogClipboard(
      supplied as unknown as ProxyRequestLogEntry[],
    );
    expect(result.text).not.toContain("private-");
    expect(result.text).not.toContain("attempt-1");
    expect(result.text).toContain("sequence=1");
  });
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
