import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Loader2,
  Microscope,
  RefreshCw,
  Server,
  ShieldAlert,
  WifiOff,
  XCircle,
} from "lucide-react";
import type { ProtocolDiagnosticReport } from "../../../types/monitoring/diagnostics";
import { redactSecrets } from "../../../utils/errors/redact";
import type { SshFailureKind } from "../../../hooks/ssh/useWebTerminal";
import type { WebTerminalMgr } from "./types";

const FAILURE_LABELS: Record<SshFailureKind, string> = {
  auth: "Authentication",
  connection_refused: "Connection refused",
  timeout: "Connection timeout",
  host_key: "Host key verification",
  certificate: "Certificate validation",
  key_missing: "Private key",
  permission: "Permission denied",
  tcp_connect: "TCP connection",
  network_unreachable: "Network routing",
  transport: "Transport interrupted",
  unknown: "Connection failure",
};

const TROUBLESHOOTING: Record<SshFailureKind, string[]> = {
  auth: [
    "Verify the saved username and authentication method.",
    "Confirm that the password, private key, or key passphrase is still valid.",
    "Check the server authentication log and authorized_keys permissions.",
  ],
  connection_refused: [
    "Wait for the host and SSH service to finish restarting.",
    "Confirm that sshd is listening on the configured port.",
    "Check host and network firewalls for a rejected TCP connection.",
  ],
  timeout: [
    "Confirm that the host has finished booting and responds on the network.",
    "Verify the SSH port and any firewall or security-group rule.",
    "Check the selected VPN, proxy, jump-host, and route to the target.",
  ],
  host_key: [
    "Verify the server fingerprint through a trusted channel.",
    "If the host was rebuilt, approve the new key only after verification.",
    "Remove a stale stored identity only when the key change is expected.",
  ],
  certificate: [
    "Verify the server identity and certificate validity period.",
    "Check the local trust store and any inspecting proxy.",
    "Correct the certificate chain instead of disabling verification.",
  ],
  key_missing: [
    "Confirm that the configured private-key file still exists.",
    "Check that the desktop process can read the key file.",
    "Select the correct key in the connection editor and retry.",
  ],
  permission: [
    "Verify that this account is permitted to open an SSH session.",
    "Check server-side AllowUsers, AllowGroups, and shell policy.",
    "Review the SSH server authentication log for the rejected method.",
  ],
  tcp_connect: [
    "Confirm the hostname, SSH port, and server availability.",
    "Check DNS resolution and the route selected for this connection.",
    "Verify proxy, jump-host, and VPN reachability.",
  ],
  network_unreachable: [
    "Connect or repair the VPN associated with this host.",
    "Verify the local route, gateway, and DNS result.",
    "Check whether a jump host or proxy in the connection path is offline.",
  ],
  transport: [
    "If the host is rebooting, leave this tab open while automatic reconnect runs.",
    "Check for a network, VPN, proxy, or jump-host interruption.",
    "Use Deep Diagnostics after the host is expected to be online.",
  ],
  unknown: [
    "Confirm that the host and SSH service are online.",
    "Verify the configured endpoint, authentication, and network path.",
    "Run Deep Diagnostics and copy the sanitized report if the issue persists.",
  ],
};

const STEP_ICON = {
  pass: <CheckCircle2 size={14} className="text-success" />,
  fail: <XCircle size={14} className="text-error" />,
  warn: <AlertTriangle size={14} className="text-warning" />,
  info: <ShieldAlert size={14} className="text-info" />,
  skip: <ChevronDown size={14} className="text-[var(--color-textMuted)]" />,
};

function SSHConnectionOverview({ mgr }: { mgr: WebTerminalMgr }) {
  const failure = mgr.sshFailure;
  const [copied, setCopied] = useState(false);
  const [diagnostics, setDiagnostics] =
    useState<ProtocolDiagnosticReport | null>(null);
  const [diagnosticError, setDiagnosticError] = useState("");
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const port = mgr.connection?.port || 22;
  const kind = failure?.kind ?? "unknown";
  const retrying = mgr.status === "reconnecting";

  const secrets = useMemo(
    () =>
      [
        mgr.connection?.password,
        mgr.connection?.passphrase,
        mgr.connection?.totpSecret,
        mgr.sshConnectionConfig.proxyCommandPassword,
      ].filter((value): value is string => Boolean(value)),
    [
      mgr.connection?.passphrase,
      mgr.connection?.password,
      mgr.connection?.totpSecret,
      mgr.sshConnectionConfig.proxyCommandPassword,
    ],
  );

  const safe = (value: unknown) =>
    redactSecrets(
      value instanceof Error ? value.message : String(value ?? ""),
      secrets,
    );

  const copyDiagnostics = async () => {
    const maxAttempts =
      failure?.maxRetryAttempts === 0
        ? "unlimited"
        : String(failure?.maxRetryAttempts ?? 0);
    const report = [
      "SSH connection diagnostics",
      `Endpoint: ${mgr.session.hostname}:${port}`,
      `Category: ${FAILURE_LABELS[kind]}`,
      `Status: ${mgr.status}`,
      `Summary: ${failure?.summary || mgr.error || "Connection unavailable"}`,
      `Retry attempt: ${failure?.retryAttempt ?? 0} of ${maxAttempts}`,
      `Occurred: ${failure?.occurredAt || new Date().toISOString()}`,
      "",
      `Technical details: ${safe(failure?.technicalDetails || mgr.error)}`,
    ];
    if (diagnostics) {
      report.push(
        "",
        `Deep diagnostics: ${safe(diagnostics.summary)}`,
        ...diagnostics.steps.map(
          (step) =>
            `- ${step.name}: ${step.status} — ${safe(step.message)}${
              step.detail ? ` (${safe(step.detail)})` : ""
            }`,
        ),
      );
    }
    try {
      await navigator.clipboard.writeText(report.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

  const runDiagnostics = async () => {
    if (!mgr.connection) return;
    setDiagnosticsRunning(true);
    setDiagnosticError("");
    setDiagnostics(null);
    try {
      const report = await invoke<ProtocolDiagnosticReport>(
        "diagnose_ssh_connection",
        {
          host: mgr.session.hostname,
          port,
          username: mgr.connection.username || "",
          password: mgr.connection.password || null,
          privateKeyPath: mgr.connection.privateKey || null,
          privateKeyPassphrase: mgr.connection.passphrase || null,
          connectTimeoutSecs:
            mgr.sshTerminalConfig?.tcpOptions?.connectionTimeout ?? 15,
        },
      );
      setDiagnostics({
        ...report,
        summary: safe(report.summary),
        rootCauseHint: report.rootCauseHint ? safe(report.rootCauseHint) : null,
        steps: report.steps.map((step) => ({
          ...step,
          message: safe(step.message),
          detail: step.detail ? safe(step.detail) : null,
        })),
      });
    } catch (diagnosticFailure) {
      setDiagnosticError(safe(diagnosticFailure));
    } finally {
      setDiagnosticsRunning(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col overflow-hidden bg-[var(--color-background)]"
      data-testid="ssh-connection-overview"
      role="region"
      aria-label={
        retrying ? "SSH session reconnecting" : "SSH connection failed"
      }
    >
      <div className="flex-shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-warning/30 bg-warning/10">
            {retrying ? (
              <RefreshCw size={20} className="animate-spin text-warning" />
            ) : (
              <WifiOff size={20} className="text-error" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">
              {retrying ? "Restoring SSH session" : "SSH connection failed"}
            </h2>
            <p className="mt-0.5 truncate text-[13px] text-[var(--color-textSecondary)]">
              {mgr.session.hostname}:{port}
              <span className="mx-1.5 text-[var(--color-textMuted)]">·</span>
              <span className={retrying ? "text-warning" : "text-error"}>
                {FAILURE_LABELS[kind]}
              </span>
            </p>
          </div>
          <span
            className={`app-badge ${retrying ? "app-badge--warning" : "app-badge--error"}`}
          >
            {retrying ? "Reconnecting" : "Needs attention"}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-6 py-5">
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="flex items-start gap-3">
              <Server
                size={18}
                className="mt-0.5 flex-shrink-0 text-[var(--color-primary)]"
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">
                  {failure?.summary || mgr.error || "Connection unavailable"}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-textSecondary)]">
                  The session tab and its previous terminal output are being
                  preserved. A replacement backend actor is created only after
                  the old actor and its owned network path are cleaned up.
                </p>
              </div>
            </div>
            {failure?.retryScheduled && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs">
                <Clock size={13} className="text-warning" />
                <span>
                  Automatic retry {failure.retryAttempt}
                  {failure.maxRetryAttempts > 0
                    ? ` of ${failure.maxRetryAttempts}`
                    : " (unlimited)"}
                  {" · "}
                  delay {failure.retryDelaySeconds}s
                </span>
              </div>
            )}
          </section>

          <section className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={mgr.handleReconnect}
              disabled={retrying}
              className="sor-btn sor-btn-primary"
            >
              <RefreshCw size={13} />
              {retrying ? "Retry now" : "Reconnect"}
            </button>
            <button
              type="button"
              onClick={runDiagnostics}
              disabled={diagnosticsRunning || !mgr.connection}
              className="sor-btn sor-btn-accent"
            >
              {diagnosticsRunning ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Microscope size={13} />
              )}
              {diagnosticsRunning ? "Running…" : "Deep Diagnostics"}
            </button>
            <button
              type="button"
              onClick={copyDiagnostics}
              className="sor-btn sor-btn-ghost"
            >
              {copied ? (
                <Check size={13} className="text-success" />
              ) : (
                <Copy size={13} />
              )}
              {copied ? "Copied" : "Copy diagnostics"}
            </button>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-textSecondary)]">
              What to check
            </h3>
            <ol className="space-y-2">
              {TROUBLESHOOTING[kind].map((step, index) => (
                <li
                  key={step}
                  className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3 text-[13px]"
                >
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                    {index + 1}
                  </span>
                  <span className="leading-relaxed text-[var(--color-textSecondary)]">
                    {step}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {diagnosticError && (
            <section className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-xs text-error">
              Deep Diagnostics failed: {diagnosticError}
            </section>
          )}

          {diagnostics && (
            <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
                <Microscope size={14} className="text-primary" />
                <h3 className="text-xs font-semibold">Deep Diagnostics</h3>
                <span className="ml-auto text-[10px] text-[var(--color-textMuted)]">
                  {diagnostics.totalDurationMs}ms
                </span>
              </div>
              <div>
                {diagnostics.steps.map((step) => (
                  <details
                    key={`${step.name}-${step.durationMs}`}
                    className="border-b border-[var(--color-border)] last:border-b-0"
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-2.5 text-xs">
                      {STEP_ICON[step.status]}
                      <span className="flex-1">{step.name}</span>
                      <span className="text-[10px] text-[var(--color-textMuted)]">
                        {step.durationMs}ms
                      </span>
                    </summary>
                    <div className="space-y-2 px-4 pb-3 pl-10 text-xs text-[var(--color-textSecondary)]">
                      <p>{step.message}</p>
                      {step.detail && (
                        <pre className="whitespace-pre-wrap break-all rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-2 font-mono">
                          {step.detail}
                        </pre>
                      )}
                    </div>
                  </details>
                ))}
              </div>
              <div className="border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-textSecondary)]">
                <span className="font-semibold text-[var(--color-text)]">
                  Summary:{" "}
                </span>
                {diagnostics.summary}
                {diagnostics.rootCauseHint && (
                  <p className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-warning">
                    {diagnostics.rootCauseHint}
                  </p>
                )}
              </div>
            </section>
          )}

          {failure?.technicalDetails && (
            <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-[var(--color-textSecondary)]">
                Sanitized technical details
              </summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border-t border-[var(--color-border)] bg-[var(--color-background)] p-4 text-xs text-[var(--color-textSecondary)]">
                {safe(failure.technicalDetails)}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

export default SSHConnectionOverview;
