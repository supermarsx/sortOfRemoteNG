import { describe, expect, it } from "vitest";
import type { ProtocolDiagnosticReport } from "../../types/monitoring/diagnostics";
import {
  classifySshFailure,
  getSshTrustRecovery,
  deriveSshDiagnosticSummary,
  reconcileSshDiagnosticReport,
} from "./sshFailure";

const sessionMinusFive =
  "SSH handshake failed: [Session(-5)] Unable to exchange encryption keys";

describe("SSH failure staging", () => {
  it.each([
    "transition",
    "locked",
    "database_required",
    "recovery_required",
    "unavailable",
  ] as const)(
    "classifies %s trust failures without treating them as key changes or automatic retry",
    (reason) => {
      const message = `SSH_TRUST_UNAVAILABLE[${reason}]: Host key verification stopped; certificate timeout details must not override the trust category`;
      const recovery = getSshTrustRecovery(message)!;
      expect(recovery.reason).toBe(reason);
      expect(recovery.steps.length).toBeGreaterThan(1);
      expect(classifySshFailure(message)).toEqual({
        kind: "trust_unavailable",
        friendly: recovery.summary,
        recoverable: false,
      });
      expect(getSshTrustRecovery(recovery.summary)?.reason).toBe(reason);
      expect(recovery.summary).not.toMatch(/server may have changed/i);
    },
  );
  it("supports the reported legacy transition error without recommending a database or key reset", () => {
    const message =
      "Host key verification failed for fixture.invalid: the Trust Center is unavailable (encryption storage transition in progress; retry after it completes). Open a database so host-key decisions can be recorded.";
    expect(getSshTrustRecovery(message)?.reason).toBe("transition");
    expect(getSshTrustRecovery(message)?.steps[0]).toMatch(/Wait/);
    expect(classifySshFailure(message).friendly).not.toMatch(
      /open a database|server may have changed/i,
    );
  });
  it("keeps actual host-key mismatches separate and hides arbitrary unavailable details", () => {
    expect(
      getSshTrustRecovery("Host key verification failed: server key changed"),
    ).toBeNull();
    expect(
      classifySshFailure("Host key verification failed: server key changed")
        .kind,
    ).toBe("host_key");
    const recovery = getSshTrustRecovery(
      "Trust Center is unavailable: private/path secret=not-for-ui",
    );
    expect(JSON.stringify(recovery)).not.toContain("private/path");
    expect(JSON.stringify(recovery)).not.toContain("not-for-ui");
  });
  it("classifies Session(-5) at key exchange without claiming a mismatch", () => {
    expect(classifySshFailure(sessionMinusFive)).toEqual({
      kind: "key_exchange",
      friendly:
        "SSH handshake/key exchange failed - the cause is undetermined; run diagnostics and check server SSH logs",
      recoverable: false,
    });
  });

  it.each([
    "SSH handshake failed: [Session(-8)] Unable to exchange encryption keys",
    "SSH handshake failed",
    "key exchange failed",
    "Session( -5 )",
  ])("does not infer a mismatch from %s", (message) => {
    expect(classifySshFailure(message).kind).toBe("key_exchange");
    expect(classifySshFailure(message).friendly).toContain(
      "cause is undetermined",
    );
  });

  it.each([
    "key exchange method",
    "cipher",
    "MAC",
    "host key type",
    "hostkey",
    "compression",
  ])("recognizes an explicit no matching %s report", (family) => {
    expect(
      classifySshFailure(`SSH handshake failed: no matching ${family} found`)
        .friendly,
    ).toContain("reported no matching algorithm");
  });

  it.each([
    [
      "SSH handshake failed: [Session(-9)] Unable to exchange encryption keys",
      "timeout",
    ],
    ["SSH handshake failed: [Session(-30)] socket timeout", "timeout"],
    [
      "SSH handshake failed: [Session(-13)] Unable to exchange encryption keys",
      "transport",
    ],
    ["SSH handshake failed: connection reset", "transport"],
  ])("keeps the specific cause in %s", (message, kind) => {
    expect(classifySshFailure(message).kind).toBe(kind);
  });

  it("never reports all-passed when the live attempt failed key exchange", () => {
    const freshProbe: ProtocolDiagnosticReport = {
      host: "fw.example.test",
      port: 22,
      protocol: "ssh",
      resolvedIp: "192.0.2.10",
      steps: [
        {
          name: "TCP Connect",
          status: "pass",
          message: "Connected",
          durationMs: 1,
          detail: null,
        },
        {
          name: "Key Exchange",
          status: "pass",
          message: "SSH handshake completed successfully",
          durationMs: 2,
          detail: null,
        },
      ],
      summary:
        "All diagnostic probes passed — the service is fully reachable and accepted the connection.",
      rootCauseHint: null,
      totalDurationMs: 3,
    };
    const report = reconcileSshDiagnosticReport(freshProbe, {
      kind: "key_exchange",
      summary: "SSH key exchange failed",
      technicalDetails: sessionMinusFive,
    });
    expect(report.steps[report.steps.length - 1]).toEqual({
      name: "Original connection attempt — Key Exchange",
      status: "fail",
      message: "SSH key exchange failed",
      durationMs: 0,
      detail: `Duration unavailable: the diagnostic probe did not time the original connection attempt; 0ms is a placeholder.\n${sessionMinusFive}`,
    });
    expect(report.summary).toContain(
      "failed at Original connection attempt — Key Exchange",
    );
    expect(report.summary).not.toContain("All diagnostic probes passed");
    expect(report.rootCauseHint).toContain(sessionMinusFive);
  });

  it("does not treat an empty or unknown-status report as success", () => {
    expect(deriveSshDiagnosticSummary([])).toMatch(/did not run/i);
    expect(
      deriveSshDiagnosticSummary([
        {
          name: "Key Exchange",
          status: "unexpected" as "pass",
          message: sessionMinusFive,
          durationMs: 0,
          detail: null,
        },
      ]),
    ).toContain("failed at Key Exchange");
  });

  it("retains the live Session(-5) detail when the fresh probe fails generically at the same stage", () => {
    const report = reconcileSshDiagnosticReport(
      {
        host: "fw.example.test",
        port: 22,
        protocol: "ssh",
        resolvedIp: "192.0.2.10",
        steps: [
          {
            name: "Key Exchange",
            status: "fail",
            message: "SSH negotiation failed",
            durationMs: 2,
            detail:
              "Session(-5); category=key exchange; partial KEX unavailable",
          },
        ],
        summary: "Diagnostics stopped at Key Exchange",
        rootCauseHint: "Generic probe failure",
        totalDurationMs: 2,
      },
      {
        kind: "key_exchange",
        summary: "SSH key exchange failed",
        technicalDetails: sessionMinusFive,
      },
    );

    expect(report.steps).toHaveLength(2);
    expect(report.steps[1]?.detail).toContain(sessionMinusFive);
    expect(report.steps[1]?.detail).toContain("Duration unavailable");
    expect(report.rootCauseHint).toContain(sessionMinusFive);
    expect(report.rootCauseHint).toContain("Generic probe failure");
    expect(report.rootCauseHint).toContain("partial KEX unavailable");
    expect(report.summary).not.toContain("All diagnostic probes passed");
  });

  it("keeps identical probe and original errors separate, without duplicating reconciliation", () => {
    const probe: ProtocolDiagnosticReport = {
      host: "fixture.invalid",
      port: 22,
      protocol: "ssh",
      resolvedIp: null,
      summary: "failed",
      rootCauseHint: null,
      totalDurationMs: 2,
      steps: [
        {
          name: "Key Exchange",
          status: "fail",
          message: sessionMinusFive,
          durationMs: 2,
          detail: "Probe evidence",
        },
      ],
    };
    const failure = {
      kind: "key_exchange" as const,
      summary: "Original failed",
      technicalDetails: sessionMinusFive,
    };
    const result = reconcileSshDiagnosticReport(probe, failure);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].name).toBe(
      "Original connection attempt — Key Exchange",
    );
    expect(result.rootCauseHint).toContain("Probe evidence");
    expect(reconcileSshDiagnosticReport(result, failure)).toEqual(result);
  });
});
