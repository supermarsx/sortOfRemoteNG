import React, { useState, useMemo, useCallback } from 'react';
import {
  AlertTriangle,
  ShieldAlert,
  Copy,
  Check,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Terminal,
  Info,
  Microscope,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  SkipForward,
  Loader2,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { RdpConnectionSettings } from '../types/connection';
import {
  classifyRdpError,
  buildRdpDiagnostics,
  RDP_ERROR_CATEGORY_LABELS,
  type RdpErrorCategory,
  type DiagnosticReportResult,
} from '../utils/rdpErrorClassifier';

/* ── Component ─────────────────────────────────────────────────────── */

interface RdpErrorScreenProps {
  sessionId: string;
  hostname: string;
  errorMessage: string;
  onRetry?: () => void;
  onEditConnection?: () => void;
  /** Connection details needed for deep diagnostics */
  connectionDetails?: {
    port: number;
    username: string;
    password: string;
    domain?: string;
    rdpSettings?: RdpConnectionSettings;
  };
}

const STEP_ICON: Record<string, React.ReactNode> = {
  pass: <CheckCircle2 size={16} className="text-green-400" />,
  fail: <XCircle size={16} className="text-red-400" />,
  warn: <AlertCircle size={16} className="text-yellow-400" />,
  info: <Info size={16} className="text-blue-400" />,
  skip: <SkipForward size={16} className="text-gray-500" />,
};

const RdpErrorScreen: React.FC<RdpErrorScreenProps> = ({
  sessionId,
  hostname,
  errorMessage,
  onRetry,
  onEditConnection,
  connectionDetails,
}) => {
  const [copied, setCopied] = useState(false);
  const [showRawError, setShowRawError] = useState(false);
  const [expandedCause, setExpandedCause] = useState<number | null>(0);

  /* ── Deep diagnostics state ─────────────────────────────────────── */
  const [diagnosticReport, setDiagnosticReport] = useState<DiagnosticReportResult | null>(null);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const category = useMemo(() => classifyRdpError(errorMessage), [errorMessage]);
  const diagnostics = useMemo(() => buildRdpDiagnostics(category), [category]);

  const handleCopy = async () => {
    const text = [
      `RDP Connection Error — ${hostname}`,
      `Session: ${sessionId}`,
      `Category: ${RDP_ERROR_CATEGORY_LABELS[category]}`,
      '',
      errorMessage,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  };

  const toggleCause = (idx: number) => {
    setExpandedCause(prev => (prev === idx ? null : idx));
  };

  const runDeepDiagnostics = useCallback(async () => {
    if (!connectionDetails) return;
    setIsRunningDiagnostics(true);
    setDiagnosticError(null);
    setDiagnosticReport(null);
    setExpandedStep(null);
    try {
      const report = await invoke<DiagnosticReportResult>('diagnose_rdp_connection', {
        host: hostname,
        port: connectionDetails.port,
        username: connectionDetails.username,
        password: connectionDetails.password,
        domain: connectionDetails.domain ?? null,
        rdpSettings: connectionDetails.rdpSettings ?? null,
      });
      setDiagnosticReport(report);
      // Auto-expand the first failing step
      const failIdx = report.steps.findIndex(s => s.status === 'fail' || s.status === 'warn');
      setExpandedStep(failIdx >= 0 ? failIdx : null);
    } catch (err: unknown) {
      setDiagnosticError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunningDiagnostics(false);
    }
  }, [hostname, connectionDetails]);

  /* severity → header bar colour */
  const headerColor: Record<RdpErrorCategory, string> = {
    duplicate_session: 'from-yellow-900/60 to-yellow-950/40',
    negotiation_failure: 'from-amber-900/60 to-amber-950/40',
    credssp_post_auth: 'from-red-900/60 to-red-950/40',
    credssp_oracle: 'from-purple-900/60 to-purple-950/40',
    credentials: 'from-orange-900/60 to-orange-950/40',
    network: 'from-gray-800/60 to-gray-900/40',
    tls: 'from-blue-900/60 to-blue-950/40',
    unknown: 'from-gray-800/60 to-gray-900/40',
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-gray-950 text-gray-200 overflow-auto">
      {/* ── Header banner ─────────────────────────────────────────── */}
      <div
        className={`flex-shrink-0 bg-gradient-to-r ${headerColor[category]} border-b border-red-800/40 px-6 py-5`}
      >
        <div className="flex items-start gap-4 max-w-3xl mx-auto">
          <AlertTriangle size={36} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-red-300">
              RDP Connection Failed
            </h2>
            <p className="text-sm text-[var(--color-textSecondary)] mt-1 truncate">
              {hostname} &mdash; {RDP_ERROR_CATEGORY_LABELS[category]}
            </p>
            <p className="text-xs text-gray-500 mt-1 font-mono">
              Session {sessionId.slice(0, 8)}…
            </p>
          </div>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-6">

          {/* ── Diagnostic causes (accordion) ──────────────────────── */}
          <section>
            <h3 className="text-sm font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider mb-3 flex items-center gap-2">
              <Info size={14} />
              Probable Causes &amp; Fixes
            </h3>
            <div className="space-y-2">
              {diagnostics.map((cause, idx) => {
                const isOpen = expandedCause === idx;
                return (
                  <div
                    key={idx}
                    className={`rounded-lg border transition-colors ${
                      isOpen
                        ? 'border-[var(--color-border)] bg-[var(--color-background)]/80'
                        : 'border-[var(--color-border)] bg-[var(--color-background)]/40 hover:border-[var(--color-border)]'
                    }`}
                  >
                    {/* accordion header */}
                    <button
                      onClick={() => toggleCause(idx)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left"
                    >
                      {cause.icon}
                      <span className="flex-1 text-sm font-medium text-gray-200">
                        {cause.title}
                      </span>
                      <span
                        className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${
                          cause.severity === 'high'
                            ? 'bg-red-900/60 text-red-300'
                            : cause.severity === 'medium'
                            ? 'bg-yellow-900/60 text-yellow-300'
                            : 'bg-[var(--color-surface)] text-[var(--color-textSecondary)]'
                        }`}
                      >
                        {cause.severity}
                      </span>
                      {isOpen ? (
                        <ChevronUp size={16} className="text-gray-500" />
                      ) : (
                        <ChevronDown size={16} className="text-gray-500" />
                      )}
                    </button>

                    {/* accordion body */}
                    {isOpen && (
                      <div className="px-4 pb-4 space-y-3">
                        <p className="text-sm text-[var(--color-textSecondary)] leading-relaxed">
                          {cause.description}
                        </p>
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            How to fix
                          </p>
                          <ul className="space-y-1.5">
                            {cause.remediation.map((step, si) => (
                              <li
                                key={si}
                                className="flex items-start gap-2 text-sm text-[var(--color-textSecondary)]"
                              >
                                <span className="text-gray-600 select-none">
                                  {si + 1}.
                                </span>
                                {step}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Quick actions ──────────────────────────────────────── */}
          <section className="flex flex-wrap gap-3">
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-[var(--color-text)] text-sm font-medium transition-colors"
              >
                <RefreshCw size={14} />
                Retry Connection
              </button>
            )}
            {onEditConnection && (
              <button
                onClick={onEditConnection}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-border)] hover:bg-[var(--color-border)] text-gray-200 text-sm font-medium transition-colors"
              >
                <Terminal size={14} />
                Edit Connection Settings
              </button>
            )}
            {connectionDetails && (
              <button
                onClick={runDeepDiagnostics}
                disabled={isRunningDiagnostics}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:bg-purple-900 disabled:opacity-60 text-[var(--color-text)] text-sm font-medium transition-colors"
              >
                {isRunningDiagnostics ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Microscope size={14} />
                )}
                {isRunningDiagnostics ? 'Running Diagnostics…' : 'Run Deep Diagnostics'}
              </button>
            )}
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] text-sm font-medium transition-colors"
            >
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy Error'}
            </button>
          </section>

          {/* ── Deep Diagnostics Report ────────────────────────────── */}
          {(diagnosticReport || diagnosticError) && (
            <section className="rounded-lg border border-purple-800/60 bg-[var(--color-background)]/60 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-purple-950/40 border-b border-purple-800/40">
                <Microscope size={16} className="text-purple-400" />
                <h3 className="text-sm font-semibold text-purple-300">Deep Diagnostics Report</h3>
                {diagnosticReport && (
                  <span className="ml-auto text-xs text-gray-500">
                    {diagnosticReport.protocol.toUpperCase()}{' '}
                    {diagnosticReport.resolvedIp && `${diagnosticReport.host} → ${diagnosticReport.resolvedIp}:${diagnosticReport.port}`}
                    {diagnosticReport.totalDurationMs > 0 && ` (${diagnosticReport.totalDurationMs}ms)`}
                  </span>
                )}
              </div>

              {diagnosticError && (
                <div className="px-4 py-3 text-sm text-red-400">
                  Diagnostics failed: {diagnosticError}
                </div>
              )}

              {diagnosticReport && (
                <div className="divide-y divide-[var(--color-border)]/60">
                  {/* Step-by-step results */}
                  {diagnosticReport.steps.map((step, idx) => {
                    const isExpanded = expandedStep === idx;
                    return (
                      <div key={idx}>
                        <button
                          onClick={() => setExpandedStep(p => p === idx ? null : idx)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--color-surface)]/40 transition-colors"
                        >
                          {STEP_ICON[step.status] ?? STEP_ICON.skip}
                          <span className="flex-1 text-sm text-gray-200">{step.name}</span>
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <Clock size={11} />
                            {step.durationMs}ms
                          </span>
                          {step.detail && (
                            isExpanded
                              ? <ChevronUp size={14} className="text-gray-600" />
                              : <ChevronDown size={14} className="text-gray-600" />
                          )}
                        </button>
                        {/* step message (always visible) */}
                        <div className="px-4 pb-1 -mt-1 pl-11">
                          <p className={`text-xs ${step.status === 'fail' ? 'text-red-400' : step.status === 'warn' ? 'text-yellow-400' : step.status === 'info' ? 'text-blue-400' : 'text-gray-500'}`}>
                            {step.message}
                          </p>
                        </div>
                        {/* detail (expanded) */}
                        {isExpanded && step.detail && (
                          <div className="px-4 pb-3 pl-11">
                            <pre className="text-xs text-[var(--color-textSecondary)] whitespace-pre-wrap bg-gray-950/60 border border-[var(--color-border)] rounded p-2 mt-1">
                              {step.detail}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Summary */}
                  <div className="px-4 py-3 space-y-2">
                    <p className="text-sm text-[var(--color-textSecondary)]">
                      <span className="font-semibold text-[var(--color-textSecondary)]">Summary: </span>
                      {diagnosticReport.summary}
                    </p>
                    {diagnosticReport.rootCauseHint && (
                      <div className="rounded-lg border border-yellow-800/50 bg-yellow-950/30 p-3">
                        <h4 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                          <AlertCircle size={12} />
                          Root Cause Analysis
                        </h4>
                        <pre className="text-xs text-yellow-200/80 whitespace-pre-wrap leading-relaxed">
                          {diagnosticReport.rootCauseHint}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── CredSSP-specific GPO helper ─────────────────────────── */}
          {(category === 'credssp_post_auth' || category === 'credssp_oracle') && (
            <section className="rounded-lg border border-purple-900/60 bg-purple-950/30 p-4 space-y-2">
              <h4 className="text-sm font-semibold text-purple-300 flex items-center gap-2">
                <ShieldAlert size={16} />
                CredSSP Quick-Fix Commands
              </h4>
              <p className="text-xs text-[var(--color-textSecondary)]">
                Run these on the <em>target server</em> in an elevated PowerShell to temporarily allow
                connections while you investigate:
              </p>
              <pre className="text-xs bg-gray-950 border border-[var(--color-border)] rounded p-3 overflow-x-auto text-green-300 select-all">
{`# Allow unpatched clients temporarily (revert after testing)
reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\CredSSP\\Parameters" ^
  /v AllowEncryptionOracle /t REG_DWORD /d 2 /f

# Or via Group Policy (preferred):
# gpedit.msc → Computer Configuration
#   → Administrative Templates → System
#   → Credentials Delegation
#   → Encryption Oracle Remediation → Enabled → "Vulnerable"`}</pre>
              <p className="text-[11px] text-yellow-600 flex items-center gap-1">
                <AlertTriangle size={12} />
                Remember to revert to &quot;Mitigated&quot; or &quot;Force Updated Clients&quot; once patching is
                complete.
              </p>
            </section>
          )}

          {/* ── Helpful links ──────────────────────────────────────── */}
          {(category === 'credssp_post_auth' || category === 'credssp_oracle') && (
            <section className="flex flex-wrap gap-3 text-xs">
              <a
                href="https://learn.microsoft.com/en-us/troubleshoot/windows-server/remote/credssp-tspkg-ssp-errors-rds"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-400 hover:text-blue-300 underline underline-offset-2"
              >
                <ExternalLink size={12} />
                Microsoft: CredSSP / TSPKG RDP errors
              </a>
              <a
                href="https://learn.microsoft.com/en-us/windows-server/remote/remote-desktop-services/clients/troubleshoot-remote-desktop-connections"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-400 hover:text-blue-300 underline underline-offset-2"
              >
                <ExternalLink size={12} />
                Microsoft: Troubleshoot RDP connections
              </a>
            </section>
          )}

          {/* ── Raw error toggle ──────────────────────────────────── */}
          <section>
            <button
              onClick={() => setShowRawError(p => !p)}
              className="flex items-center gap-2 text-xs text-gray-500 hover:text-[var(--color-textSecondary)] transition-colors"
            >
              {showRawError ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showRawError ? 'Hide' : 'Show'} full error details
            </button>
            {showRawError && (
              <pre className="mt-2 text-xs bg-[var(--color-background)] border border-[var(--color-border)] rounded p-4 whitespace-pre-wrap break-all text-[var(--color-textSecondary)] max-h-48 overflow-y-auto font-mono">
                {errorMessage}
              </pre>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default RdpErrorScreen;
