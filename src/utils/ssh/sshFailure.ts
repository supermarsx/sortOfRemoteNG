import type {
  ProtocolDiagnosticReport,
  ProtocolDiagnosticStep,
} from "../../types/monitoring/diagnostics";

export type SshFailureKind =
  | "auth"
  | "connection_refused"
  | "timeout"
  | "host_key"
  | "key_exchange"
  | "command"
  | "certificate"
  | "key_missing"
  | "permission"
  | "tcp_connect"
  | "network_unreachable"
  | "transport"
  | "unknown";

export interface SshFailureClassification {
  kind: SshFailureKind;
  friendly: string;
  recoverable: boolean;
}

export function classifySshFailure(message: string): SshFailureClassification {
  const lower = message.toLowerCase();
  if (
    lower.includes("unable to exchange encryption keys") ||
    lower.includes("ssh handshake failed") ||
    lower.includes("session(-5)") ||
    lower.includes("key exchange failed") ||
    lower.includes("no matching key exchange") ||
    lower.includes("no matching cipher")
  ) {
    return {
      kind: "key_exchange",
      friendly:
        "SSH key exchange failed - client and server could not agree on encryption algorithms",
      recoverable: false,
    };
  }
  if (
    message.includes("All authentication methods failed") ||
    message.includes("Authentication failed")
  ) {
    return {
      kind: "auth",
      friendly: "Authentication failed - please check your credentials",
      recoverable: false,
    };
  }
  if (
    lower.includes("connection refused") ||
    lower.includes("os error 10061")
  ) {
    return {
      kind: "connection_refused",
      friendly: "Connection refused - please check the host and port",
      recoverable: true,
    };
  }
  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("os error 10060") ||
    lower.includes("connection attempt failed")
  ) {
    return {
      kind: "timeout",
      friendly: "Connection timeout - please check network connectivity",
      recoverable: true,
    };
  }
  if (lower.includes("host key verification failed")) {
    return {
      kind: "host_key",
      friendly: "Host key verification failed - server may have changed",
      recoverable: false,
    };
  }
  if (lower.includes("certificate") || lower.includes("x509")) {
    return {
      kind: "certificate",
      friendly:
        "Certificate validation failed - please verify the server identity",
      recoverable: false,
    };
  }
  if (
    lower.includes("no such file or directory") &&
    lower.includes("private key")
  ) {
    return {
      kind: "key_missing",
      friendly: "Private key file not found - please check the key path",
      recoverable: false,
    };
  }
  if (lower.includes("permission denied")) {
    return {
      kind: "permission",
      friendly: "Permission denied - please check your credentials",
      recoverable: false,
    };
  }
  if (
    lower.includes("channel exec failed") ||
    lower.includes("failed to execute remote command") ||
    lower.includes("remote command failed") ||
    lower.includes("command execution failed")
  ) {
    return {
      kind: "command",
      friendly: "SSH command execution failed after the session connected",
      recoverable: false,
    };
  }
  if (
    lower.includes("failed to establish tcp connection") ||
    lower.includes("failed to connect")
  ) {
    return {
      kind: "tcp_connect",
      friendly: "TCP connection failed - please verify the host and port",
      recoverable: true,
    };
  }
  if (
    lower.includes("no route to host") ||
    lower.includes("network unreachable")
  ) {
    return {
      kind: "network_unreachable",
      friendly: "Network unreachable - please check routing or VPN",
      recoverable: true,
    };
  }
  if (
    lower.includes("transport") ||
    lower.includes("connection reset") ||
    lower.includes("broken pipe") ||
    lower.includes("unexpected eof") ||
    lower.includes("end of file")
  ) {
    return {
      kind: "transport",
      friendly: "SSH transport was interrupted",
      recoverable: true,
    };
  }
  return {
    kind: "unknown",
    friendly: "SSH connection failed - please check credentials and network",
    recoverable: false,
  };
}

const FAILURE_STEP_NAMES: Record<SshFailureKind, string> = {
  auth: "Authentication",
  connection_refused: "TCP Connect",
  timeout: "TCP Connect",
  host_key: "Host Key",
  key_exchange: "Key Exchange",
  command: "Command",
  certificate: "Host Key",
  key_missing: "Authentication",
  permission: "Authentication",
  tcp_connect: "TCP Connect",
  network_unreachable: "TCP Connect",
  transport: "Transport",
  unknown: "Connection Attempt",
};

export interface SshFailureDiagnosticContext {
  kind: SshFailureKind;
  summary: string;
  technicalDetails: string;
}

export function deriveSshDiagnosticSummary(
  steps: ProtocolDiagnosticStep[],
): string {
  if (steps.length === 0) {
    return "SSH diagnostics did not run any probes.";
  }
  const firstFailure = steps.find((step) => {
    const status = step.status as string;
    return !["pass", "info", "warn", "skip"].includes(status);
  });
  if (firstFailure) {
    return `SSH diagnostics failed at ${firstFailure.name}: ${firstFailure.message}`;
  }
  const firstWarning = steps.find(
    (step) => step.status === "warn" || step.status === "skip",
  );
  if (firstWarning) {
    return `SSH diagnostics completed with warnings at ${firstWarning.name}: ${firstWarning.message}`;
  }
  return "All SSH diagnostic probes passed — the service accepted the connection.";
}

/**
 * A fresh diagnostic probe can succeed with default algorithms even though the
 * live configured attempt failed. Merge that original attempt into the report
 * and always derive the summary from the final step list.
 */
export function reconcileSshDiagnosticReport(
  report: ProtocolDiagnosticReport,
  failure?: SshFailureDiagnosticContext | null,
): ProtocolDiagnosticReport {
  const steps = [...report.steps];
  if (failure) {
    const stage = FAILURE_STEP_NAMES[failure.kind];
    const alreadyRepresented = steps.some(
      (step) =>
        step.status === "fail" &&
        (step.message.includes(failure.technicalDetails) ||
          step.detail?.includes(failure.technicalDetails)),
    );
    if (!alreadyRepresented) {
      steps.push({
        name: stage,
        status: "fail",
        message: failure.summary,
        durationMs: 0,
        detail: failure.technicalDetails,
      });
    }
  }
  return {
    ...report,
    steps,
    summary: deriveSshDiagnosticSummary(steps),
    rootCauseHint: failure?.technicalDetails ?? report.rootCauseHint ?? null,
  };
}
