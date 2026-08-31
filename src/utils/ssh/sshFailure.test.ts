import { describe, expect, it } from "vitest";
import type { ProtocolDiagnosticReport } from "../../types/monitoring/diagnostics";
import {
  classifySshFailure,
  deriveSshDiagnosticSummary,
  reconcileSshDiagnosticReport,
} from "./sshFailure";

const sessionMinusFive =
  "SSH handshake failed: [Session(-5)] Unable to exchange encryption keys";

describe("SSH failure staging", () => {
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
