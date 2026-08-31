import type { SectionProps } from "./types";
import type { ProtocolDiagnosticStep } from "../../../types/monitoring/diagnostics";
import type {
  ProxyFailureKind,
  ProxyNavigationFailure,
} from "../../../hooks/protocol/useWebBrowser";

import React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Globe2,
  Info,
  Loader2,
  Microscope,
  RefreshCw,
  RouteOff,
  ServerCrash,
  ShieldAlert,
  WifiOff,
  XCircle,
} from "lucide-react";

const ERROR_BASE =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45";
const ERROR_PRIMARY = `${ERROR_BASE} border-primary bg-primary text-white hover:bg-primary/90`;
const ERROR_SECONDARY = `${ERROR_BASE} border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-primary/50 hover:bg-[var(--color-border)]`;
const ERROR_WARNING = `${ERROR_BASE} border-warning/50 bg-warning/10 text-warning hover:bg-warning/20`;

interface FailurePresentation {
  eyebrow: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: "error" | "warning";
  suggestions: string[];
}

function presentationFor(
  kind: ProxyFailureKind,
  status: number | null,
): FailurePresentation {
  switch (kind) {
    case "dns_failure":
      return {
        eyebrow: "Name resolution failed",
        icon: RouteOff,
        tone: "error",
        suggestions: [
          "Check that the saved hostname is spelled correctly.",
          "Confirm the DNS server or VPN for this network is available.",
          "Try the deep diagnostics below to see which lookup failed.",
        ],
      };
    case "connection_refused":
      return {
        eyebrow: "Service refused the connection",
        icon: ServerCrash,
        tone: "error",
        suggestions: [
          "Confirm the web service is running on the saved port.",
          "Check whether a firewall is rejecting connections to this host.",
          "Verify that HTTP versus HTTPS matches the service configuration.",
        ],
      };
    case "tls_failure":
    case "certificate_rejected":
      return {
        eyebrow: "Secure connection failed",
        icon: ShieldAlert,
        tone: "warning",
        suggestions: [
          "Verify that the certificate is valid for this hostname.",
          "Check the certificate expiry date and issuing chain.",
          "Only change certificate verification after confirming the server identity.",
        ],
      };
    case "timeout":
      return {
        eyebrow: "The server took too long",
        icon: Clock3,
        tone: "warning",
        suggestions: [
          "Check that the host is online and reachable from this network.",
          "Confirm a firewall or VPN is not silently dropping the connection.",
          "Run deep diagnostics to separate DNS, TCP, TLS, and HTTP delays.",
        ],
      };
    case "redirect_loop":
      return {
        eyebrow: "Too many redirects",
        icon: RefreshCw,
        tone: "warning",
        suggestions: [
          "Check whether the service is redirecting between HTTP and HTTPS.",
          "Review reverse-proxy and canonical-host settings on the server.",
          "Open externally to compare the browser's cookie and redirect behavior.",
        ],
      };
    case "http_status":
      return {
        eyebrow: status
          ? `Server returned HTTP ${status}`
          : "Server rejected the request",
        icon: AlertTriangle,
        tone: "warning",
        suggestions: [
          "Confirm the address and saved credentials are correct.",
          "The server may require permission, authentication, or a later retry.",
          "Use diagnostics to inspect the status and redirect chain.",
        ],
      };
    case "bad_request":
    case "invalid_navigation":
      return {
        eyebrow: "The address could not be used",
        icon: Globe2,
        tone: "warning",
        suggestions: [
          "Check the hostname, port, and path in the saved connection.",
          "Web tabs are restricted to the saved connection's HTTP(S) authority.",
          "Use Open externally if the destination intentionally leaves this host.",
        ],
      };
    case "proxy_start_failed":
      return {
        eyebrow: "Internal browser proxy unavailable",
        icon: ServerCrash,
        tone: "error",
        suggestions: [
          "Retry to create a fresh isolated proxy session.",
          "Check the Internal Proxy Manager if the session remains unavailable.",
          "Run diagnostics to confirm whether the target itself is reachable.",
        ],
      };
    default:
      return {
        eyebrow: "Web connection failed",
        icon: WifiOff,
        tone: "error",
        suggestions: [
          "Retry after confirming the host and port are reachable.",
          "Check your VPN, firewall, and proxy settings.",
          "Run deep diagnostics for the failing network stage.",
        ],
      };
  }
}

function diagnosticStatusIcon(step: ProtocolDiagnosticStep) {
  switch (step.status) {
    case "pass":
      return <CheckCircle2 size={15} className="shrink-0 text-success" />;
    case "fail":
      return <XCircle size={15} className="shrink-0 text-error" />;
    case "warn":
      return <AlertTriangle size={15} className="shrink-0 text-warning" />;
    default:
      return <Info size={15} className="shrink-0 text-info" />;
  }
}

const ErrorPage: React.FC<SectionProps> = ({ mgr }) => {
  const fallbackFailure: ProxyNavigationFailure = {
    version: 1,
    sessionId: "local",
    kind: "upstream_failure",
    status: null,
    title: "Unable to load webpage",
    url: mgr.currentUrl || mgr.session.hostname,
    reason: "The embedded browser could not complete this navigation.",
    detail: mgr.loadError,
  };
  const failure = mgr.navigationFailure ?? fallbackFailure;
  const presentation = presentationFor(failure.kind, failure.status);
  const FailureIcon = presentation.icon;
  const isWarning = presentation.tone === "warning";
  const iconTone = isWarning
    ? "border-warning/40 bg-warning/10 text-warning"
    : "border-error/40 bg-error/10 text-error";

  return (
    <div
      className="h-full overflow-y-auto bg-[var(--color-background)] text-[var(--color-text)]"
      data-testid="web-navigation-error-screen"
      role="alert"
    >
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center px-5 py-8 sm:px-8">
        <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          <div
            className={`h-1 w-full ${isWarning ? "bg-warning" : "bg-error"}`}
          />
          <div className="p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${iconTone}`}
              >
                <FailureIcon size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span
                    className={`text-xs font-semibold uppercase tracking-[0.12em] ${isWarning ? "text-warning" : "text-error"}`}
                  >
                    {presentation.eyebrow}
                  </span>
                  {failure.status !== null && (
                    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-textMuted)]">
                      HTTP {failure.status}
                    </span>
                  )}
                </div>
                <h2 className="text-xl font-semibold leading-tight">
                  {failure.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-textSecondary)]">
                  {failure.reason}
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2">
              <Globe2
                size={15}
                className="shrink-0 text-[var(--color-textMuted)]"
              />
              <span className="min-w-0 break-all font-mono text-xs text-[var(--color-textSecondary)]">
                {failure.url}
              </span>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button onClick={mgr.handleRefresh} className={ERROR_PRIMARY}>
                <RefreshCw size={15} />
                Retry
              </button>
              <button
                onClick={mgr.handleBack}
                disabled={!mgr.canGoBack}
                className={ERROR_SECONDARY}
              >
                <ArrowLeft size={15} />
                Back
              </button>
              <button
                onClick={mgr.handleOpenExternal}
                className={ERROR_SECONDARY}
              >
                <ExternalLink size={15} />
                Open externally
              </button>
              <button
                onClick={mgr.runDeepDiagnostics}
                disabled={mgr.isRunningDiagnostics}
                className={ERROR_SECONDARY}
              >
                {mgr.isRunningDiagnostics ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Microscope size={15} />
                )}
                {mgr.isRunningDiagnostics ? "Diagnosing…" : "Deep diagnostics"}
              </button>
              {!mgr.proxyAlive && (
                <button
                  onClick={mgr.handleRestartProxy}
                  disabled={mgr.proxyRestarting}
                  className={ERROR_WARNING}
                >
                  <RefreshCw
                    size={15}
                    className={mgr.proxyRestarting ? "animate-spin" : ""}
                  />
                  {mgr.proxyRestarting ? "Restarting…" : "Restart proxy"}
                </button>
              )}
            </div>
          </div>
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h3 className="text-sm font-semibold">What to check</h3>
            <ol className="mt-3 space-y-3 text-sm text-[var(--color-textSecondary)]">
              {presentation.suggestions.map((suggestion, index) => (
                <li key={suggestion} className="flex gap-3 leading-5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-background)] font-mono text-[10px] text-[var(--color-textMuted)]">
                    {index + 1}
                  </span>
                  <span>{suggestion}</span>
                </li>
              ))}
            </ol>
          </section>

          <section
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">
                  Connection diagnostics
                </h3>
                <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                  DNS, TCP, TLS, HTTP, redirects, and response checks
                </p>
              </div>
              {mgr.diagnosticReport && (
                <span className="whitespace-nowrap font-mono text-[11px] text-[var(--color-textMuted)]">
                  {mgr.diagnosticReport.totalDurationMs} ms
                </span>
              )}
            </div>

            {mgr.isRunningDiagnostics && (
              <div className="mt-4 flex items-center gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-3 text-sm text-info">
                <Loader2 size={16} className="animate-spin" />
                Testing each connection stage…
              </div>
            )}

            {mgr.diagnosticError && (
              <div className="mt-4 rounded-md border border-error/30 bg-error/10 px-3 py-3 text-sm text-error">
                {mgr.diagnosticError}
              </div>
            )}

            {mgr.diagnosticReport ? (
              <div className="mt-4">
                <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-textSecondary)]">
                  {mgr.diagnosticReport.summary}
                </p>
                {mgr.diagnosticReport.rootCauseHint && (
                  <p className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
                    {mgr.diagnosticReport.rootCauseHint}
                  </p>
                )}
                <ol className="mt-3 divide-y divide-[var(--color-border)]">
                  {mgr.diagnosticReport.steps.map((step, index) => (
                    <li
                      key={`${step.name}-${index}`}
                      className="py-3 first:pt-0"
                    >
                      <div className="flex items-start gap-2">
                        {diagnosticStatusIcon(step)}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-xs font-semibold">
                              {step.name}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-[var(--color-textMuted)]">
                              {step.durationMs} ms
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-[var(--color-textSecondary)]">
                            {step.message}
                          </p>
                          {step.detail && (
                            <details className="mt-1.5">
                              <summary className="cursor-pointer text-[11px] text-primary hover:underline">
                                Step details
                              </summary>
                              <pre className="mt-2 whitespace-pre-wrap break-words rounded border border-[var(--color-border)] bg-[var(--color-background)] p-2 font-mono text-[10px] leading-4 text-[var(--color-textMuted)]">
                                {step.detail}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              !mgr.isRunningDiagnostics &&
              !mgr.diagnosticError && (
                <div className="mt-4 rounded-md border border-dashed border-[var(--color-border)] px-4 py-5 text-center">
                  <Microscope
                    size={20}
                    className="mx-auto text-[var(--color-textMuted)]"
                  />
                  <p className="mt-2 text-xs leading-5 text-[var(--color-textMuted)]">
                    Run diagnostics to identify the exact stage that failed.
                  </p>
                </div>
              )
            )}
          </section>
        </div>

        <details className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <summary className="cursor-pointer select-none text-xs font-medium text-[var(--color-textSecondary)]">
            Technical details
          </summary>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 font-mono text-[11px] leading-5 text-[var(--color-textMuted)]">
            {failure.detail}
          </pre>
        </details>
      </div>
    </div>
  );
};

export { ErrorPage };
export default ERROR_BASE;
