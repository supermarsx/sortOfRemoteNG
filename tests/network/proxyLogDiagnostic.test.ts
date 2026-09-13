import { describe, expect, it } from "vitest";
import {
  parseProxyLogDiagnostic,
  proxyDiagnosticLabels,
  type ProxyLogDiagnostic,
} from "../../src/utils/network/proxyLogDiagnostic";

export const diagnostic: ProxyLogDiagnostic = {
  phase: "quickconnect_direct_probe",
  stage: "queue",
  code: "quickconnect_queue_timeout",
  outcome: "timed_out",
  durationMs: 8000,
  queueMs: 8000,
  activeMs: 0,
  attemptId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  hop: 2,
};
describe("closed proxy log diagnostics", () => {
  it("preserves bounded redirect evidence separately from local response status", () => {
    const redirect = {
      ...diagnostic,
      phase: "quickconnect_redirect",
      stage: "handoff",
      code: "quickconnect_redirect_loop",
      outcome: "failed",
      upstreamStatus: 302,
      redirectSourcePath: "root",
      redirectTargetPath: "dsm",
      redirectTargetOrigin: "https://example-nas.fr3.quickconnect.to",
      redirectQueryRemoved: false,
      sameOriginRedirects: 0,
    };
    expect(parseProxyLogDiagnostic(redirect)).toEqual(redirect);
    const parsed = parseProxyLogDiagnostic({
      ...redirect,
      sameOriginRedirects: 20,
      redirectQueryRemoved: true,
      redirectTargetPath: "other",
    })!;
    expect(proxyDiagnosticLabels(parsed)).toMatchObject({
      candidate: false,
      redirectSourcePath: "Root",
      redirectTargetPath: "Other",
    });
    expect(proxyDiagnosticLabels(parsed).explanation).toContain(
      "HTTP redirect cycle",
    );
    expect(proxyDiagnosticLabels(parsed).explanation).toContain(
      "does not mean the server was unreachable",
    );
  });
  it.each([
    { redirectSourcePath: "/private-path" },
    { redirectTargetPath: "constructor" },
    { redirectQueryRemoved: "true" },
    { redirectQueryRemoved: 1 },
    { sameOriginRedirects: -1 },
    { sameOriginRedirects: 21 },
    { sameOriginRedirects: 0.5 },
    { redirectTargetOrigin: "https://fixture.test/private-path" },
    { redirectTargetOrigin: "https://fixture.test?token=private-query" },
    { redirectTargetOrigin: "https://fixture.test#private-fragment" },
    {
      redirectTargetOrigin:
        "https://private-user:private-password@fixture.test",
    },
    { redirectTargetOrigin: "https://fixture.test/" },
    { redirectTargetOrigin: "https://fixture.test." },
    { redirectTargetOrigin: "https://fixture.test:0" },
    { redirectTargetOrigin: "https://FIXTURE.test" },
    { redirectTargetOrigin: "javascript:private-data" },
    { redirectTargetOrigin: null },
  ])(
    "rejects noncanonical or secret-bearing redirect metadata %#",
    (fields) => {
      expect(parseProxyLogDiagnostic({ ...diagnostic, ...fields })).toBeNull();
    },
  );
  it("accepts native bounded metadata including zero rounded duration", () => {
    expect(parseProxyLogDiagnostic(diagnostic)).toEqual(diagnostic);
    expect(
      parseProxyLogDiagnostic({
        ...diagnostic,
        durationMs: 0,
        queueMs: 0,
        hop: 0,
        upstreamStatus: 599,
      }),
    ).toMatchObject({ durationMs: 0, hop: 0, upstreamStatus: 599 });
    expect(
      parseProxyLogDiagnostic({ ...diagnostic, durationMs: 86400000, hop: 20 }),
    ).not.toBeNull();
    for (const lane of ["control", "direct_probe", "relay_probe"])
      expect(parseProxyLogDiagnostic({ ...diagnostic, lane })).toMatchObject({
        lane,
      });
  });
  it.each([
    undefined,
    null,
    [],
    {},
    { ...diagnostic, phase: "private-phase" },
    { ...diagnostic, stage: "private-stage" },
    { ...diagnostic, outcome: "private-outcome" },
    { ...diagnostic, code: "private-code" },
    { ...diagnostic, headers: { Authorization: "private-token" } },
    { ...diagnostic, durationMs: -1 },
    { ...diagnostic, durationMs: 86400001 },
    { ...diagnostic, durationMs: "8" },
    { ...diagnostic, queueMs: 1.5 },
    { ...diagnostic, activeMs: Infinity },
    { ...diagnostic, hop: 21 },
    { ...diagnostic, hop: -1 },
    { ...diagnostic, upstreamStatus: 99 },
    { ...diagnostic, upstreamStatus: 600 },
    { ...diagnostic, attemptId: "private-token" },
    { ...diagnostic, code: "constructor" },
    { ...diagnostic, phase: "__proto__" },
    { ...diagnostic, lane: "private-lane" },
  ])(
    "discards absent, malformed or unknown metadata without coercion: %#",
    (value) => {
      expect(parseProxyLogDiagnostic(value)).toBeNull();
    },
  );
  it("distinguishes candidate results and request completion from sign-in proof", () => {
    expect(proxyDiagnosticLabels(diagnostic)).toMatchObject({
      candidate: true,
      stage: "Waiting for capacity",
      outcome: "Timed out",
    });
    expect(
      proxyDiagnosticLabels({
        ...diagnostic,
        phase: "http",
        code: "http_response",
        outcome: "succeeded",
      }),
    ).toMatchObject({ candidate: false, outcome: "Request completed" });
  });
  it("does not describe the shared upstream status code as a failure on successful discovery", () => {
    const labels = proxyDiagnosticLabels({
      ...diagnostic,
      phase: "quickconnect_discovery",
      stage: "complete",
      code: "quickconnect_upstream_status",
      outcome: "succeeded",
    });
    expect(labels.outcome).toBe("Request completed");
    expect(labels.explanation).not.toMatch(/unsuccessful|failed|failure/);
    expect(labels.explanation).toContain("does not confirm sign-in");
  });
});
