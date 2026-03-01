import React from 'react';
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
import type { RDPConnectionSettings } from '../../types/connection';
import {
  useRDPErrorScreen,
  RDP_ERROR_CATEGORY_LABELS,
  type RDPErrorCategory,
} from '../../hooks/rdp/useRDPErrorScreen';

type Mgr = ReturnType<typeof useRDPErrorScreen>;

/* ── Constants ─────────────────────────────────────────────────────── */

interface RDPErrorScreenProps {
  sessionId: string;
  hostname: string;
  errorMessage: string;
  onRetry?: () => void;
  onEditConnection?: () => void;
  connectionDetails?: {
    port: number;
    username: string;
    password: string;
    domain?: string;
    rdpSettings?: RDPConnectionSettings;
  };
}

const STEP_ICON: Record<string, React.ReactNode> = {
  pass: <CheckCircle2 size={16} className="text-green-400" />,
  fail: <XCircle size={16} className="text-red-400" />,
  warn: <AlertCircle size={16} className="text-yellow-400" />,
  info: <Info size={16} className="text-blue-400" />,
  skip: <SkipForward size={16} className="text-[var(--color-textMuted)]" />,
};

const HEADER_COLOR: Record<RDPErrorCategory, string> = {
  duplicate_session: 'from-yellow-900/60 to-yellow-950/40',
  negotiation_failure: 'from-amber-900/60 to-amber-950/40',
  credssp_post_auth: 'from-red-900/60 to-red-950/40',
  credssp_oracle: 'from-purple-900/60 to-purple-950/40',
  credentials: 'from-orange-900/60 to-orange-950/40',
  network: 'from-gray-800/60 to-gray-900/40',
  tls: 'from-blue-900/60 to-blue-950/40',
  unknown: 'from-gray-800/60 to-gray-900/40',
};

/* ── Sub-components ────────────────────────────────────────────────── */

const HeaderBanner: React.FC<{ mgr: Mgr; hostname: string; sessionId: string }> = ({ mgr, hostname, sessionId }) => (
  <div className={`flex-shrink-0 bg-gradient-to-r ${HEADER_COLOR[mgr.category]} border-b border-red-800/40 px-6 py-5`}>
    <div className="flex items-start gap-4 max-w-3xl mx-auto">
      <AlertTriangle size={36} className="text-red-400 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-red-300">RDP Connection Failed</h2>
        <p className="text-sm text-[var(--color-textSecondary)] mt-1 truncate">
          {hostname} &mdash; {RDP_ERROR_CATEGORY_LABELS[mgr.category]}
        </p>
        <p className="text-xs text-[var(--color-textMuted)] mt-1 font-mono">Session {sessionId.slice(0, 8)}…</p>
      </div>
    </div>
  </div>
);

const CauseAccordion: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <section>
    <h3 className="text-sm font-semibold text-[var(--color-textSecondary)] uppercase tracking-wider mb-3 flex items-center gap-2">
      <Info size={14} />
      Probable Causes &amp; Fixes
    </h3>
    <div className="space-y-2">
      {mgr.diagnostics.map((cause, idx) => {
        const isOpen = mgr.expandedCause === idx;
        return (
          <div key={idx} className={`rounded-lg border transition-colors ${isOpen ? 'border-[var(--color-border)] bg-[var(--color-background)]/80' : 'border-[var(--color-border)] bg-[var(--color-background)]/40 hover:border-[var(--color-border)]'}`}>
            <button onClick={() => mgr.toggleCause(idx)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
              {cause.icon}
              <span className="flex-1 text-sm font-medium text-[var(--color-textSecondary)]">{cause.title}</span>
              <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${cause.severity === 'high' ? 'bg-red-900/60 text-red-300' : cause.severity === 'medium' ? 'bg-yellow-900/60 text-yellow-300' : 'bg-[var(--color-surface)] text-[var(--color-textSecondary)]'}`}>
                {cause.severity}
              </span>
              {isOpen ? <ChevronUp size={16} className="text-[var(--color-textMuted)]" /> : <ChevronDown size={16} className="text-[var(--color-textMuted)]" />}
            </button>
            {isOpen && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-sm text-[var(--color-textSecondary)] leading-relaxed">{cause.description}</p>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--color-textMuted)] uppercase tracking-wider">How to fix</p>
                  <ul className="space-y-1.5">
                    {cause.remediation.map((step, si) => (
                      <li key={si} className="flex items-start gap-2 text-sm text-[var(--color-textSecondary)]">
                        <span className="text-[var(--color-textMuted)] select-none">{si + 1}.</span>
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
);

const QuickActions: React.FC<{
  mgr: Mgr;
  onRetry?: () => void;
  onEditConnection?: () => void;
  hasConnectionDetails: boolean;
}> = ({ mgr, onRetry, onEditConnection, hasConnectionDetails }) => (
  <section className="flex flex-wrap gap-3">
    {onRetry && (
      <button onClick={onRetry} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-[var(--color-text)] text-sm font-medium transition-colors">
        <RefreshCw size={14} /> Retry Connection
      </button>
    )}
    {onEditConnection && (
      <button onClick={onEditConnection} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] text-sm font-medium transition-colors">
        <Terminal size={14} /> Edit Connection Settings
      </button>
    )}
    {hasConnectionDetails && (
      <button onClick={mgr.runDeepDiagnostics} disabled={mgr.isRunningDiagnostics} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:bg-purple-900 disabled:opacity-60 text-[var(--color-text)] text-sm font-medium transition-colors">
        {mgr.isRunningDiagnostics ? <Loader2 size={14} className="animate-spin" /> : <Microscope size={14} />}
        {mgr.isRunningDiagnostics ? 'Running Diagnostics…' : 'Run Deep Diagnostics'}
      </button>
    )}
    <button onClick={mgr.handleCopy} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] text-sm font-medium transition-colors">
      {mgr.copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
      {mgr.copied ? 'Copied!' : 'Copy Error'}
    </button>
  </section>
);

const DiagnosticsReport: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.diagnosticReport && !mgr.diagnosticError) return null;
  return (
    <section className="rounded-lg border border-purple-800/60 bg-[var(--color-background)]/60 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-purple-950/40 border-b border-purple-800/40">
        <Microscope size={16} className="text-purple-400" />
        <h3 className="text-sm font-semibold text-purple-300">Deep Diagnostics Report</h3>
        {mgr.diagnosticReport && (
          <span className="ml-auto text-xs text-[var(--color-textMuted)]">
            {mgr.diagnosticReport.protocol.toUpperCase()}{' '}
            {mgr.diagnosticReport.resolvedIp && `${mgr.diagnosticReport.host} → ${mgr.diagnosticReport.resolvedIp}:${mgr.diagnosticReport.port}`}
            {mgr.diagnosticReport.totalDurationMs > 0 && ` (${mgr.diagnosticReport.totalDurationMs}ms)`}
          </span>
        )}
      </div>
      {mgr.diagnosticError && (
        <div className="px-4 py-3 text-sm text-red-400">Diagnostics failed: {mgr.diagnosticError}</div>
      )}
      {mgr.diagnosticReport && (
        <div className="divide-y divide-[var(--color-border)]/60">
          {mgr.diagnosticReport.steps.map((step, idx) => {
            const isExpanded = mgr.expandedStep === idx;
            return (
              <div key={idx}>
                <button onClick={() => mgr.toggleStep(idx)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--color-surface)]/40 transition-colors">
                  {STEP_ICON[step.status] ?? STEP_ICON.skip}
                  <span className="flex-1 text-sm text-[var(--color-textSecondary)]">{step.name}</span>
                  <span className="flex items-center gap-1 text-xs text-[var(--color-textMuted)]"><Clock size={11} />{step.durationMs}ms</span>
                  {step.detail && (isExpanded ? <ChevronUp size={14} className="text-[var(--color-textMuted)]" /> : <ChevronDown size={14} className="text-[var(--color-textMuted)]" />)}
                </button>
                <div className="px-4 pb-1 -mt-1 pl-11">
                  <p className={`text-xs ${step.status === 'fail' ? 'text-red-400' : step.status === 'warn' ? 'text-yellow-400' : step.status === 'info' ? 'text-blue-400' : 'text-[var(--color-textMuted)]'}`}>{step.message}</p>
                </div>
                {isExpanded && step.detail && (
                  <div className="px-4 pb-3 pl-11">
                    <pre className="text-xs text-[var(--color-textSecondary)] whitespace-pre-wrap bg-[var(--color-background)]/60 border border-[var(--color-border)] rounded p-2 mt-1">{step.detail}</pre>
                  </div>
                )}
              </div>
            );
          })}
          <div className="px-4 py-3 space-y-2">
            <p className="text-sm text-[var(--color-textSecondary)]">
              <span className="font-semibold text-[var(--color-textSecondary)]">Summary: </span>{mgr.diagnosticReport.summary}
            </p>
            {mgr.diagnosticReport.rootCauseHint && (
              <div className="rounded-lg border border-yellow-800/50 bg-yellow-950/30 p-3">
                <h4 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-1 flex items-center gap-1.5"><AlertCircle size={12} />Root Cause Analysis</h4>
                <pre className="text-xs text-yellow-200/80 whitespace-pre-wrap leading-relaxed">{mgr.diagnosticReport.rootCauseHint}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

const CredSspHelper: React.FC<{ category: RDPErrorCategory }> = ({ category }) => {
  if (category !== 'credssp_post_auth' && category !== 'credssp_oracle') return null;
  return (
    <>
      <section className="rounded-lg border border-purple-900/60 bg-purple-950/30 p-4 space-y-2">
        <h4 className="text-sm font-semibold text-purple-300 flex items-center gap-2"><ShieldAlert size={16} />CredSSP Quick-Fix Commands</h4>
        <p className="text-xs text-[var(--color-textSecondary)]">Run these on the <em>target server</em> in an elevated PowerShell to temporarily allow connections while you investigate:</p>
        <pre className="text-xs bg-[var(--color-background)] border border-[var(--color-border)] rounded p-3 overflow-x-auto text-green-300 select-all">
{`# Allow unpatched clients temporarily (revert after testing)
reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\CredSSP\\Parameters" ^
  /v AllowEncryptionOracle /t REG_DWORD /d 2 /f

# Or via Group Policy (preferred):
# gpedit.msc → Computer Configuration
#   → Administrative Templates → System
#   → Credentials Delegation
#   → Encryption Oracle Remediation → Enabled → "Vulnerable"`}</pre>
        <p className="text-[11px] text-yellow-600 flex items-center gap-1">
          <AlertTriangle size={12} />Remember to revert to &quot;Mitigated&quot; or &quot;Force Updated Clients&quot; once patching is complete.
        </p>
      </section>
      <section className="flex flex-wrap gap-3 text-xs">
        <a href="https://learn.microsoft.com/en-us/troubleshoot/windows-server/remote/credssp-tspkg-ssp-errors-rds" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-400 hover:text-blue-300 underline underline-offset-2">
          <ExternalLink size={12} />Microsoft: CredSSP / TSPKG RDP errors
        </a>
        <a href="https://learn.microsoft.com/en-us/windows-server/remote/remote-desktop-services/clients/troubleshoot-remote-desktop-connections" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-400 hover:text-blue-300 underline underline-offset-2">
          <ExternalLink size={12} />Microsoft: Troubleshoot RDP connections
        </a>
      </section>
    </>
  );
};

const RawErrorToggle: React.FC<{ mgr: Mgr; errorMessage: string }> = ({ mgr, errorMessage }) => (
  <section>
    <button onClick={mgr.toggleRawError} className="flex items-center gap-2 text-xs text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)] transition-colors">
      {mgr.showRawError ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      {mgr.showRawError ? 'Hide' : 'Show'} full error details
    </button>
    {mgr.showRawError && (
      <pre className="mt-2 text-xs bg-[var(--color-background)] border border-[var(--color-border)] rounded p-4 whitespace-pre-wrap break-all text-[var(--color-textSecondary)] max-h-48 overflow-y-auto font-mono">{errorMessage}</pre>
    )}
  </section>
);

/* ── Root Component ────────────────────────────────────────────────── */

const RDPErrorScreen: React.FC<RDPErrorScreenProps> = ({
  sessionId,
  hostname,
  errorMessage,
  onRetry,
  onEditConnection,
  connectionDetails,
}) => {
  const mgr = useRDPErrorScreen({ sessionId, hostname, errorMessage, connectionDetails });

  return (
    <div className="absolute inset-0 flex flex-col bg-[var(--color-background)] text-[var(--color-textSecondary)] overflow-auto">
      <HeaderBanner mgr={mgr} hostname={hostname} sessionId={sessionId} />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <CauseAccordion mgr={mgr} />
          <QuickActions mgr={mgr} onRetry={onRetry} onEditConnection={onEditConnection} hasConnectionDetails={!!connectionDetails} />
          <DiagnosticsReport mgr={mgr} />
          <CredSspHelper category={mgr.category} />
          <RawErrorToggle mgr={mgr} errorMessage={errorMessage} />
        </div>
      </div>
    </div>
  );
};

export default RDPErrorScreen;
