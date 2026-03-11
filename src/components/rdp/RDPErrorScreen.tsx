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
  Info,
  Microscope,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  SkipForward,
  Loader2,
  MonitorX,
  Settings2,
  Zap,
  ArrowRight,
} from 'lucide-react';
import type { RDPConnectionSettings } from '../../types/connection/connection';
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
  pass: <CheckCircle2 size={14} className="text-success" />,
  fail: <XCircle size={14} className="text-error" />,
  warn: <AlertCircle size={14} className="text-warning" />,
  info: <Info size={14} className="text-info" />,
  skip: <SkipForward size={14} style={{ color: 'var(--color-textMuted)' }} />,
};

const CATEGORY_ACCENT: Record<RDPErrorCategory, string> = {
  duplicate_session: 'var(--color-warning)',
  negotiation_failure: 'var(--color-warning)',
  credssp_post_auth: 'var(--color-error)',
  credssp_oracle: 'var(--color-accent, var(--color-primary))',
  credentials: 'var(--color-warning)',
  network: 'var(--color-textMuted)',
  tls: 'var(--color-info)',
  unknown: 'var(--color-textMuted)',
};

const STATUS_COLOR: Record<string, string> = {
  fail: 'var(--color-error)',
  warn: 'var(--color-warning)',
  info: 'var(--color-info)',
  pass: 'var(--color-success)',
};

/* ── Sub-components ────────────────────────────────────────────────── */

const HeaderBanner: React.FC<{ mgr: Mgr; hostname: string; sessionId: string }> = ({ mgr, hostname, sessionId }) => {
  const accent = CATEGORY_ACCENT[mgr.category];
  return (
    <div
      className="flex-shrink-0 px-6 py-5 border-b border-[var(--color-border)]"
      style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 10%, var(--color-surface)) 0%, var(--color-surface) 100%)` }}
    >
      <div className="flex items-center gap-4 max-w-3xl mx-auto">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: `color-mix(in srgb, ${accent} 15%, transparent)`,
            border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
          }}
        >
          <MonitorX size={20} style={{ color: accent }} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Connection Failed</h2>
          <p className="text-[13px] text-[var(--color-textSecondary)] mt-0.5 truncate">
            {hostname}
            <span className="mx-1.5 text-[var(--color-textMuted)]">&middot;</span>
            <span style={{ color: accent }}>{RDP_ERROR_CATEGORY_LABELS[mgr.category]}</span>
          </p>
        </div>
        <span className="text-[10px] text-[var(--color-textMuted)] font-mono tabular-nums flex-shrink-0 opacity-60">
          {sessionId.slice(0, 8)}
        </span>
      </div>
    </div>
  );
};

const QuickActions: React.FC<{
  mgr: Mgr;
  onRetry?: () => void;
  onEditConnection?: () => void;
  hasConnectionDetails: boolean;
}> = ({ mgr, onRetry, onEditConnection, hasConnectionDetails }) => (
  <section className="flex flex-wrap gap-2">
    {onRetry && (
      <button onClick={onRetry} className="sor-btn sor-btn-primary">
        <RefreshCw size={13} /> Retry Connection
      </button>
    )}
    {onEditConnection && (
      <button onClick={onEditConnection} className="sor-btn sor-btn-secondary">
        <Settings2 size={13} /> Edit Settings
      </button>
    )}
    {hasConnectionDetails && (
      <button onClick={mgr.runDeepDiagnostics} disabled={mgr.isRunningDiagnostics} className="sor-btn sor-btn-accent">
        {mgr.isRunningDiagnostics ? <Loader2 size={13} className="animate-spin" /> : <Microscope size={13} />}
        {mgr.isRunningDiagnostics ? 'Running…' : 'Deep Diagnostics'}
      </button>
    )}
    <button onClick={mgr.handleCopy} className="sor-btn sor-btn-ghost">
      {mgr.copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      {mgr.copied ? 'Copied' : 'Copy Error'}
    </button>
  </section>
);

const CauseAccordion: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <section className="space-y-2">
    <h3 className="sor-diag-section-title">
      <Zap size={13} />
      Probable Causes
    </h3>
    {mgr.diagnostics.map((cause, idx) => {
      const isOpen = mgr.expandedCause === idx;
      return (
        <div
          key={idx}
          className="rounded-lg overflow-hidden transition-all"
          style={{
            background: isOpen
              ? 'color-mix(in srgb, var(--color-border) 40%, transparent)'
              : 'color-mix(in srgb, var(--color-border) 30%, transparent)',
            border: isOpen ? '1px solid var(--color-border)' : '1px solid transparent',
          }}
        >
          <button onClick={() => mgr.toggleCause(idx)} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left group">
            <span className="flex-shrink-0">{cause.icon}</span>
            <span className="flex-1 text-[13px] text-[var(--color-text)] font-medium">{cause.title}</span>
            <span className={`app-badge text-[9px] uppercase font-bold tracking-wider ${
              cause.severity === 'high' ? 'app-badge--error' : cause.severity === 'medium' ? 'app-badge--warning' : 'app-badge--neutral'
            }`}>
              {cause.severity}
            </span>
            <span className="text-[var(--color-textMuted)] transition-transform" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)' }}>
              <ChevronDown size={14} />
            </span>
          </button>
          {isOpen && (
            <div className="px-3.5 pb-3.5 space-y-3 border-t border-[var(--color-border)]">
              <p className="text-[13px] text-[var(--color-textSecondary)] leading-relaxed pt-3">{cause.description}</p>
              <div className="rounded-md" style={{ background: 'color-mix(in srgb, var(--color-surface) 50%, transparent)', padding: '0.75rem' }}>
                <p className="text-[10px] font-semibold text-[var(--color-textMuted)] uppercase tracking-wider mb-2 flex items-center gap-1">
                  <ArrowRight size={10} /> Steps to Fix
                </p>
                <ol className="space-y-1.5">
                  {cause.remediation.map((step, si) => (
                    <li key={si} className="flex items-start gap-2 text-[13px] text-[var(--color-textSecondary)]">
                      <span
                        className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-semibold mt-0.5"
                        style={{
                          background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
                          color: 'var(--color-primary)',
                        }}
                      >
                        {si + 1}
                      </span>
                      <span className="leading-snug">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>
      );
    })}
  </section>
);

const DiagnosticsReport: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.diagnosticReport && !mgr.diagnosticError) return null;
  return (
    <section className="sor-settings-collapsible">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ background: 'var(--color-surfaceHover)', borderBottom: '1px solid var(--color-border)' }}>
        <span
          className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{
            background: 'color-mix(in srgb, var(--color-accent, var(--color-primary)) 15%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent, var(--color-primary)) 22%, transparent)',
          }}
        >
          <Microscope size={13} style={{ color: 'var(--color-accent, var(--color-primary))' }} />
        </span>
        <h3 className="text-xs font-semibold text-[var(--color-text)]">Deep Diagnostics</h3>
        {mgr.diagnosticReport && (
          <span className="ml-auto text-[10px] text-[var(--color-textMuted)] font-mono tabular-nums flex items-center gap-1.5">
            <span className="app-badge app-badge--info" style={{ padding: '1px 6px', fontSize: '9px' }}>
              {mgr.diagnosticReport.protocol.toUpperCase()}
            </span>
            {mgr.diagnosticReport.resolvedIp && (
              <span>{mgr.diagnosticReport.host} → {mgr.diagnosticReport.resolvedIp}:{mgr.diagnosticReport.port}</span>
            )}
            {mgr.diagnosticReport.totalDurationMs > 0 && (
              <span className="flex items-center gap-0.5">
                <Clock size={9} />{mgr.diagnosticReport.totalDurationMs}ms
              </span>
            )}
          </span>
        )}
      </div>

      {/* Error state */}
      {mgr.diagnosticError && (
        <div className="px-4 py-3 text-[13px] flex items-center gap-2" style={{ background: 'color-mix(in srgb, var(--color-error) 10%, transparent)', color: 'var(--color-error)' }}>
          <XCircle size={14} />
          Diagnostics failed: {mgr.diagnosticError}
        </div>
      )}

      {/* Step list */}
      {mgr.diagnosticReport && (
        <div>
          {mgr.diagnosticReport.steps.map((step, idx) => {
            const isExpanded = mgr.expandedStep === idx;
            const stepColor = STATUS_COLOR[step.status] || 'var(--color-textMuted)';
            return (
              <div
                key={idx}
                style={{
                  borderBottom: idx < mgr.diagnosticReport!.steps.length - 1 ? '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' : undefined,
                  background: isExpanded ? 'color-mix(in srgb, var(--color-border) 20%, transparent)' : undefined,
                }}
              >
                <button
                  onClick={() => mgr.toggleStep(idx)}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors"
                  style={{ minHeight: '2.25rem' }}
                >
                  {STEP_ICON[step.status] ?? STEP_ICON.skip}
                  <span className="flex-1 text-[13px] text-[var(--color-text)]">{step.name}</span>
                  <span className="flex items-center gap-1 text-[10px] font-mono tabular-nums" style={{ color: 'var(--color-textMuted)' }}>
                    <Clock size={9} />{step.durationMs}ms
                  </span>
                  {step.detail && (
                    <span className="text-[var(--color-textMuted)]" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 150ms' }}>
                      <ChevronDown size={12} />
                    </span>
                  )}
                </button>

                {/* Inline status message */}
                <div className="px-4 pb-1.5 -mt-0.5" style={{ paddingLeft: '2.625rem' }}>
                  <p className="text-xs leading-snug" style={{ color: stepColor }}>
                    {step.message}
                  </p>
                </div>

                {/* Expanded detail */}
                {isExpanded && step.detail && (
                  <div className="px-4 pb-3" style={{ paddingLeft: '2.625rem' }}>
                    <pre
                      className="text-xs whitespace-pre-wrap font-mono leading-relaxed rounded-md p-2.5 mt-1"
                      style={{
                        background: 'var(--color-background)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-textSecondary)',
                      }}
                    >
                      {step.detail}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}

          {/* Summary footer */}
          <div className="px-4 py-3 space-y-2.5" style={{ background: 'color-mix(in srgb, var(--color-surface) 50%, transparent)', borderTop: '1px solid var(--color-border)' }}>
            <p className="text-[13px] text-[var(--color-textSecondary)]">
              <span className="font-medium text-[var(--color-text)]">Summary: </span>{mgr.diagnosticReport.summary}
            </p>
            {mgr.diagnosticReport.rootCauseHint && (
              <div
                className="rounded-lg p-3"
                style={{
                  background: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)',
                }}
              >
                <h4 className="text-[10px] font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-warning)' }}>
                  <AlertCircle size={11} />Root Cause
                </h4>
                <pre className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'color-mix(in srgb, var(--color-warning) 85%, var(--color-text))' }}>
                  {mgr.diagnosticReport.rootCauseHint}
                </pre>
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
      <section className="sor-settings-collapsible">
        <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ background: 'var(--color-surfaceHover)', borderBottom: '1px solid var(--color-border)' }}>
          <span
            className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
            style={{
              background: 'color-mix(in srgb, var(--color-warning) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-warning) 22%, transparent)',
            }}
          >
            <ShieldAlert size={13} style={{ color: 'var(--color-warning)' }} />
          </span>
          <h4 className="text-xs font-semibold text-[var(--color-text)]">CredSSP Quick-Fix</h4>
        </div>
        <div className="p-4 space-y-3" style={{ background: 'var(--color-surface)' }}>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Run on the <em className="text-[var(--color-text)] not-italic font-medium">target server</em> in an elevated PowerShell:
          </p>
          <pre
            className="text-xs overflow-x-auto select-all font-mono leading-relaxed rounded-md p-3"
            style={{
              background: 'var(--color-background)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-success)',
            }}
          >
{`# Allow unpatched clients temporarily (revert after testing)
reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\CredSSP\\Parameters" ^
  /v AllowEncryptionOracle /t REG_DWORD /d 2 /f

# Or via Group Policy (preferred):
# gpedit.msc → Computer Configuration
#   → Administrative Templates → System
#   → Credentials Delegation
#   → Encryption Oracle Remediation → Enabled → "Vulnerable"`}</pre>
          <p className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--color-warning)' }}>
            <AlertTriangle size={11} />Revert to &quot;Mitigated&quot; once patching is complete.
          </p>
        </div>
      </section>
      <div className="flex flex-wrap gap-3 text-xs">
        <a
          href="https://learn.microsoft.com/en-us/troubleshoot/windows-server/remote/credssp-tspkg-ssp-errors-rds"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 underline underline-offset-2 transition-colors"
          style={{ color: 'var(--color-primary)' }}
        >
          <ExternalLink size={11} />CredSSP / TSPKG errors
        </a>
        <a
          href="https://learn.microsoft.com/en-us/windows-server/remote/remote-desktop-services/clients/troubleshoot-remote-desktop-connections"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 underline underline-offset-2 transition-colors"
          style={{ color: 'var(--color-primary)' }}
        >
          <ExternalLink size={11} />Troubleshoot RDP connections
        </a>
      </div>
    </>
  );
};

const RawErrorToggle: React.FC<{ mgr: Mgr; errorMessage: string }> = ({ mgr, errorMessage }) => (
  <section>
    <button onClick={mgr.toggleRawError} className="flex items-center gap-1.5 text-xs transition-colors" style={{ color: 'var(--color-textMuted)' }}>
      <span style={{ transform: mgr.showRawError ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 150ms' }}>
        <ChevronDown size={12} />
      </span>
      {mgr.showRawError ? 'Hide' : 'Show'} raw error
    </button>
    {mgr.showRawError && (
      <pre
        className="mt-2 text-xs whitespace-pre-wrap break-all max-h-48 overflow-y-auto font-mono leading-relaxed rounded-md p-3"
        style={{
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-textSecondary)',
        }}
      >
        {errorMessage}
      </pre>
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
    <div className="absolute inset-0 flex flex-col bg-[var(--color-background)] overflow-hidden">
      <HeaderBanner mgr={mgr} hostname={hostname} sessionId={sessionId} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-5 space-y-5">
          <QuickActions mgr={mgr} onRetry={onRetry} onEditConnection={onEditConnection} hasConnectionDetails={!!connectionDetails} />
          <CauseAccordion mgr={mgr} />
          <DiagnosticsReport mgr={mgr} />
          <CredSspHelper category={mgr.category} />
          <RawErrorToggle mgr={mgr} errorMessage={errorMessage} />
        </div>
      </div>
    </div>
  );
};

export default RDPErrorScreen;
