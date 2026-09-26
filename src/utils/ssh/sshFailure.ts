import type {
  ProtocolDiagnosticReport,
  ProtocolDiagnosticStep,
} from "../../types/monitoring/diagnostics";

export type SshFailureKind =
  | "auth"
  | "connection_refused"
  | "timeout"
  | "host_key"
  | "trust_unavailable"
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

export type SshTrustUnavailableReason =
  | "transition"
  | "locked"
  | "database_required"
  | "recovery_required"
  | "unavailable";
export interface SshTrustRecovery {
  reason: SshTrustUnavailableReason;
  summary: string;
  steps: string[];
}

const TRUST_RECOVERY: Record<
  SshTrustUnavailableReason,
  Omit<SshTrustRecovery, "reason">
> = {
  transition: {
    summary:
      "Trust Center is unavailable while encryption storage is being updated.",
    steps: [
      "Wait for the encryption or storage operation to finish.",
      "Choose Retry trust verification to start one new SSH attempt.",
      "Host-key verification remains required; no server key was accepted.",
    ],
  },
  locked: {
    summary: "Trust Center is unavailable because encrypted storage is locked.",
    steps: [
      "Open Settings > Security and unlock encrypted storage.",
      "Open or unlock this connection's owning database.",
      "Choose Retry trust verification. Do not disable host-key verification.",
    ],
  },
  database_required: {
    summary:
      "Trust Center is unavailable because no trust database is open or unlocked.",
    steps: [
      "Open or unlock this connection's owning database.",
      "Wait for the database to finish loading.",
      "Choose Retry trust verification. A different database must not supply this connection's trust decisions.",
    ],
  },
  recovery_required: {
    summary:
      "Trust Center is unavailable because storage recovery is required.",
    steps: [
      "Open Settings > Security and complete the indicated recovery.",
      "Do not reset storage or delete host-key records to dismiss this error.",
      "After recovery, open the owning database and choose Retry trust verification.",
    ],
  },
  unavailable: {
    summary:
      "Trust Center is unavailable. Host-key verification remains blocked.",
    steps: [
      "Check Settings > Security and confirm the owning database is open and unlocked.",
      "Retry trust verification after storage recovers; if this persists, restart the updated desktop app.",
      "Do not reset storage, remove trust records, or disable verification to work around this error.",
    ],
  },
};

/** Handles the native marker and the old error wording without showing raw storage errors. */
export function getSshTrustRecovery(message: string): SshTrustRecovery | null {
  const lower = message.toLowerCase();
  const marker =
    /ssh_trust_unavailable\[(transition|locked|database_required|recovery_required|unavailable)\]/.exec(
      lower,
    );
  if (!marker && !lower.includes("trust center is unavailable")) return null;
  let reason = marker?.[1] as SshTrustUnavailableReason | undefined;
  if (!reason) {
    if (
      lower.includes("encryption storage transition in progress") ||
      lower.includes("encryption storage is being updated")
    )
      reason = "transition";
    else if (
      lower.includes("requires recovery") ||
      lower.includes("recovery required") ||
      lower.includes("storage recovery is required")
    )
      reason = "recovery_required";
    else if (
      lower.includes("encryption is locked") ||
      lower.includes("encryption state is locked") ||
      lower.includes("encrypted storage is locked") ||
      lower.includes("unlock the master key")
    )
      reason = "locked";
    else if (
      lower.includes("no active trust database") ||
      lower.includes("no trust database is open")
    )
      reason = "database_required";
    else reason = "unavailable";
  }
  return {
    reason,
    ...TRUST_RECOVERY[reason],
    steps: [...TRUST_RECOVERY[reason].steps],
  };
}

export function classifySshFailure(message: string): SshFailureClassification {
  const trust = getSshTrustRecovery(message);
  if (trust)
    return {
      kind: "trust_unavailable",
      friendly: trust.summary,
      recoverable: false,
    };
  const lower = message.toLowerCase();
  if (
    lower.includes("no matching key exchange") ||
    lower.includes("no matching kex") ||
    lower.includes("no matching cipher") ||
    lower.includes("no matching mac") ||
    lower.includes("no matching host key") ||
    lower.includes("no matching hostkey") ||
    lower.includes("no matching compression") ||
    lower.includes("no match for method")
  ) {
    return {
      kind: "key_exchange",
      friendly:
        "SSH negotiation reported no matching algorithm - compare the named algorithm family with client and server settings",
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
    /session\(\s*-(9|30)\s*\)/.test(lower) ||
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
    lower.includes("end of file") ||
    /session\(\s*-(7|13|43)\s*\)/.test(lower)
  ) {
    return {
      kind: "transport",
      friendly: "SSH transport was interrupted",
      recoverable: true,
    };
  }
  if (
    lower.includes("unable to exchange encryption keys") ||
    lower.includes("ssh handshake failed") ||
    /session\(\s*-(5|8)\s*\)/.test(lower) ||
    lower.includes("key exchange failed") ||
    lower.includes("key exchange failure") ||
    lower.includes("kex failure")
  ) {
    return {
      kind: "key_exchange",
      friendly:
        "SSH handshake/key exchange failed - the cause is undetermined; run diagnostics and check server SSH logs",
      recoverable: false,
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
  trust_unavailable: "Trust Center",
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
        step.name === `Original connection attempt — ${stage}` &&
        (step.message.includes(failure.technicalDetails) ||
          step.detail?.includes(failure.technicalDetails)),
    );
    if (!alreadyRepresented) {
      steps.push({
        name: `Original connection attempt — ${stage}`,
        status: "fail",
        message: failure.summary,
        durationMs: 0,
        detail: `Duration unavailable: the diagnostic probe did not time the original connection attempt; 0ms is a placeholder.\n${failure.technicalDetails}`,
      });
    }
  }
  return {
    ...report,
    steps,
    summary: deriveSshDiagnosticSummary(steps),
    rootCauseHint: failure
      ? [
          report.rootCauseHint,
          ...report.steps
            .filter(
              (step) =>
                step.status === "fail" &&
                step.detail &&
                !step.name.startsWith("Original connection attempt — "),
            )
            .map((step) => `${step.name}: ${step.detail}`),
          `Original connection attempt: ${failure.technicalDetails}`,
        ]
          .filter(
            (value, index, values) =>
              value &&
              !values.slice(0, index).some((prior) => prior?.includes(value)),
          )
          .join("\n\n")
      : (report.rootCauseHint ?? null),
  };
}
