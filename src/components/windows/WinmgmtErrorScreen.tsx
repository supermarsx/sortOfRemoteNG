import React from 'react';
import {
  Copy,
  Check,
  RefreshCw,
  ChevronDown,
  Settings2,
  Zap,
  ArrowRight,
  MonitorX,
  Terminal,
  AlertTriangle,
  ExternalLink,
  Microscope,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  SkipForward,
  Info,
} from 'lucide-react';
import {
  useWinmgmtErrorScreen,
  WINMGMT_ERROR_CATEGORY_LABELS,
  type WinmgmtErrorCategory,
} from '../../hooks/windows/useWinmgmtErrorScreen';

type Mgr = ReturnType<typeof useWinmgmtErrorScreen>;

/* ── Constants ─────────────────────────────────────────────────────── */

interface WinmgmtErrorScreenProps {
  hostname: string;
  errorMessage: string;
  connectionId?: string;
  connectionConfig?: Record<string, unknown>;
  onRetry?: () => void;
  onEditConnection?: () => void;
}

const STEP_ICON: Record<string, React.ReactNode> = {
  pass: <CheckCircle2 size={14} className="text-success" />,
  fail: <XCircle size={14} className="text-error" />,
  warn: <AlertCircle size={14} className="text-warning" />,
  info: <Info size={14} className="text-info" />,
  skip: <SkipForward size={14} style={{ color: 'var(--color-textMuted)' }} />,
};

const STATUS_COLOR: Record<string, string> = {
  fail: 'var(--color-error)',
  warn: 'var(--color-warning)',
  info: 'var(--color-info)',
  pass: 'var(--color-success)',
};

const CATEGORY_ACCENT: Record<WinmgmtErrorCategory, string> = {
  network: 'var(--color-textMuted)',
  winrm_disabled: 'var(--color-warning)',
  auth_failure: 'var(--color-error)',
  access_denied: 'var(--color-error)',
  tls_cert: 'var(--color-info)',
  soap_fault: 'var(--color-warning)',
  timeout: 'var(--color-warning)',
  session_limit: 'var(--color-warning)',
  wmi_namespace: 'var(--color-warning)',
  unknown: 'var(--color-textMuted)',
};

/* ── Sub-components ────────────────────────────────────────────────── */

const HeaderBanner: React.FC<{ mgr: Mgr; hostname: string }> = ({ mgr, hostname }) => {
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
            <span className="app-badge app-badge--neutral" style={{ padding: '1px 6px', fontSize: '9px', verticalAlign: 'middle' }}>WinRM</span>
            <span className="mx-1.5 text-[var(--color-textMuted)]">&middot;</span>
            <span style={{ color: accent }}>{WINMGMT_ERROR_CATEGORY_LABELS[mgr.category]}</span>
          </p>
        </div>
      </div>
    </div>
  );
};

const QuickActions: React.FC<{
  mgr: Mgr;
  onRetry?: () => void;
  onEditConnection?: () => void;
  hasConnectionConfig: boolean;
}> = ({ mgr, onRetry, onEditConnection, hasConnectionConfig }) => (
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
    {hasConnectionConfig && (
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

const WinRmQuickSetup: React.FC<{ category: WinmgmtErrorCategory }> = ({ category }) => {
  if (category !== 'winrm_disabled' && category !== 'auth_failure') return null;
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
            <Terminal size={13} style={{ color: 'var(--color-warning)' }} />
          </span>
          <h4 className="text-xs font-semibold text-[var(--color-text)]">
            {category === 'winrm_disabled' ? 'WinRM Quick Setup' : 'Enable Basic Auth'}
          </h4>
        </div>
        <div className="p-4 space-y-3" style={{ background: 'var(--color-surface)' }}>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Run on the <em className="text-[var(--color-text)] not-italic font-medium">target server</em> in an elevated PowerShell:
          </p>
          {category === 'winrm_disabled' ? (
            <pre
              className="text-xs overflow-x-auto select-all font-mono leading-relaxed rounded-md p-3"
              style={{
                background: 'var(--color-background)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-success)',
              }}
            >
{`# Enable WinRM with default configuration
winrm quickconfig -force

# Verify the listener is active
winrm enumerate winrm/config/listener

# Allow Basic auth (required for non-domain scenarios)
winrm set winrm/config/service/auth @{Basic="true"}

# Allow unencrypted traffic over HTTP (lab/dev only)
winrm set winrm/config/service @{AllowUnencrypted="true"}

# Add firewall rule for WinRM HTTP
netsh advfirewall firewall add rule name="WinRM HTTP" ^
  dir=in action=allow protocol=TCP localport=5985`}</pre>
          ) : (
            <pre
              className="text-xs overflow-x-auto select-all font-mono leading-relaxed rounded-md p-3"
              style={{
                background: 'var(--color-background)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-success)',
              }}
            >
{`# Enable Basic auth on WinRM service
winrm set winrm/config/service/auth @{Basic="true"}

# Check current auth config
winrm get winrm/config/service/auth

# For HTTPS (recommended) — create a self-signed cert + listener:
$cert = New-SelfSignedCertificate -DnsName (hostname) ^
  -CertStoreLocation Cert:\\LocalMachine\\My
winrm create winrm/config/listener?Address=*+Transport=HTTPS ^
  @{Hostname=(hostname); CertificateThumbprint=$cert.Thumbprint}`}</pre>
          )}
          <p className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--color-warning)' }}>
            <AlertTriangle size={11} />
            {category === 'winrm_disabled'
              ? 'AllowUnencrypted should only be used in trusted lab networks. Use HTTPS in production.'
              : 'Basic auth sends credentials Base64-encoded. Use HTTPS to protect credentials in transit.'}
          </p>
        </div>
      </section>
      <div className="flex flex-wrap gap-3 text-xs">
        <a
          href="https://learn.microsoft.com/en-us/windows/win32/winrm/installation-and-configuration-for-windows-remote-management"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 underline underline-offset-2 transition-colors"
          style={{ color: 'var(--color-primary)' }}
        >
          <ExternalLink size={11} />WinRM setup guide
        </a>
        <a
          href="https://learn.microsoft.com/en-us/powershell/scripting/security/remoting/winrmsecurity"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 underline underline-offset-2 transition-colors"
          style={{ color: 'var(--color-primary)' }}
        >
          <ExternalLink size={11} />WinRM security best practices
        </a>
      </div>
    </>
  );
};

const AccessDeniedHelper: React.FC<{ category: WinmgmtErrorCategory }> = ({ category }) => {
  if (category !== 'access_denied') return null;
  return (
    <section className="sor-settings-collapsible">
      <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ background: 'var(--color-surfaceHover)', borderBottom: '1px solid var(--color-border)' }}>
        <span
          className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{
            background: 'color-mix(in srgb, var(--color-error) 15%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-error) 22%, transparent)',
          }}
        >
          <Terminal size={13} style={{ color: 'var(--color-error)' }} />
        </span>
        <h4 className="text-xs font-semibold text-[var(--color-text)]">Fix WMI Remote Access</h4>
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
{`# Allow non-admin users remote WMI access via UAC policy
Set-ItemProperty -Path ^
  "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" ^
  -Name LocalAccountTokenFilterPolicy -Value 1 -Type DWord

# Grant WMI namespace permissions (run wmimgmt.msc for GUI):
# Right-click WMI Control → Properties → Security
# Navigate to Root\\CIMV2 → Add user → Enable Account + Remote Enable

# Grant DCOM remote access:
# dcomcnfg → Component Services → Computers → My Computer
# → Properties → COM Security → Access Permissions → Edit Limits
# → Add user → Allow Remote Access`}</pre>
        <p className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--color-warning)' }}>
          <AlertTriangle size={11} />LocalAccountTokenFilterPolicy disables UAC remote token filtering. Only set this when needed.
        </p>
      </div>
    </section>
  );
};

const TlsHelper: React.FC<{ category: WinmgmtErrorCategory }> = ({ category }) => {
  if (category !== 'tls_cert') return null;
  return (
    <section className="sor-settings-collapsible">
      <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ background: 'var(--color-surfaceHover)', borderBottom: '1px solid var(--color-border)' }}>
        <span
          className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{
            background: 'color-mix(in srgb, var(--color-info) 15%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-info) 22%, transparent)',
          }}
        >
          <Terminal size={13} style={{ color: 'var(--color-info)' }} />
        </span>
        <h4 className="text-xs font-semibold text-[var(--color-text)]">Fix HTTPS / Certificate</h4>
      </div>
      <div className="p-4 space-y-3" style={{ background: 'var(--color-surface)' }}>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Create a self-signed certificate and HTTPS listener on the <em className="text-[var(--color-text)] not-italic font-medium">target server</em>:
        </p>
        <pre
          className="text-xs overflow-x-auto select-all font-mono leading-relaxed rounded-md p-3"
          style={{
            background: 'var(--color-background)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-success)',
          }}
        >
{`# Create a self-signed certificate
$cert = New-SelfSignedCertificate -DnsName (hostname) ^
  -CertStoreLocation Cert:\\LocalMachine\\My ^
  -NotAfter (Get-Date).AddYears(5)

# Delete existing HTTPS listener if present
winrm delete winrm/config/listener?Address=*+Transport=HTTPS 2>$null

# Create HTTPS listener with the certificate
winrm create winrm/config/listener?Address=*+Transport=HTTPS ^
  @{Hostname=(hostname); CertificateThumbprint=$cert.Thumbprint}

# Open HTTPS port in firewall
netsh advfirewall firewall add rule name="WinRM HTTPS" ^
  dir=in action=allow protocol=TCP localport=5986

# Verify
winrm enumerate winrm/config/listener`}</pre>
        <p className="text-[11px] text-[var(--color-textSecondary)]">
          Or enable <strong>"Skip CA check"</strong> in the connection settings to accept self-signed certificates without installing them.
        </p>
      </div>
    </section>
  );
};

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

const WinmgmtErrorScreen: React.FC<WinmgmtErrorScreenProps> = ({
  hostname,
  errorMessage,
  connectionId,
  connectionConfig,
  onRetry,
  onEditConnection,
}) => {
  const mgr = useWinmgmtErrorScreen({ hostname, errorMessage, connectionId, connectionConfig });

  return (
    <div className="absolute inset-0 flex flex-col bg-[var(--color-background)] overflow-hidden">
      <HeaderBanner mgr={mgr} hostname={hostname} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-5 space-y-5">
          <QuickActions mgr={mgr} onRetry={onRetry} onEditConnection={onEditConnection} hasConnectionConfig={!!connectionConfig} />
          <CauseAccordion mgr={mgr} />
          <DiagnosticsReport mgr={mgr} />
          <WinRmQuickSetup category={mgr.category} />
          <AccessDeniedHelper category={mgr.category} />
          <TlsHelper category={mgr.category} />
          <RawErrorToggle mgr={mgr} errorMessage={errorMessage} />
        </div>
      </div>
    </div>
  );
};

export default WinmgmtErrorScreen;
