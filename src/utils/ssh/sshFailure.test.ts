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
  it("classifies Session(-5) at key exchange and retains its exact cause", () => {
    expect(classifySshFailure(sessionMinusFive)).toEqual({
      kind: "key_exchange",
      friendly:
        "SSH key exchange failed - client and server could not agree on encryption algorithms",
      recoverable: false,
    });
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
      name: "Key Exchange",
      status: "fail",
      message: "SSH key exchange failed",
      durationMs: 0,
      detail: sessionMinusFive,
    });
    expect(report.summary).toContain("failed at Key Exchange");
    expect(report.summary).not.toContain("All diagnostic probes passed");
    expect(report.rootCauseHint).toBe(sessionMinusFive);
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
            detail: null,
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
    expect(report.steps[1]?.detail).toBe(sessionMinusFive);
    expect(report.rootCauseHint).toBe(sessionMinusFive);
    expect(report.summary).not.toContain("All diagnostic probes passed");
  });
});
