import React, { useState, useMemo, useCallback } from 'react';
import {
  AlertTriangle,
  ShieldAlert,
  KeyRound,
  UserX,
  Lock,
  ServerCrash,
  Copy,
  Check,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Terminal,
  Info,
  Network,
  Shield,
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

/* ── Deep diagnostic types (match Rust DiagnosticStep/Report) ──── */

interface DiagnosticStepResult {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'warn';
  message: string;
  durationMs: number;
  detail: string | null;
}

interface DiagnosticReportResult {
  host: string;
  port: number;
  resolvedIp: string | null;
  steps: DiagnosticStepResult[];
  summary: string;
  rootCauseHint: string | null;
}

/* ── Error classification ──────────────────────────────────────────── */

interface DiagnosticCause {
  icon: React.ReactNode;
  title: string;
  description: string;
  remediation: string[];
  severity: 'high' | 'medium' | 'low';
}

type ErrorCategory =
  | 'duplicate_session'
  | 'negotiation_failure'
  | 'credssp_post_auth'
  | 'credssp_oracle'
  | 'credentials'
  | 'network'
  | 'tls'
  | 'unknown';

function classifyError(raw: string): ErrorCategory {
  const msg = raw.toLowerCase();
  if (msg.includes('already active or connecting')) {
    return 'duplicate_session';
  }
  // Negotiation failure: server requires a specific security mode the client didn't offer
  if (
    msg.includes('negotiation failure') ||
    (msg.includes('connect_begin') &&
      (msg.includes('negotiat') || msg.includes('security'))) ||
    (msg.includes('requires') && msg.includes('enhanced rdp security')) ||
    (msg.includes('required protocols') && msg.includes('not enabled'))
  ) {
    return 'negotiation_failure';
  }
  if (
    (msg.includes('10054') || msg.includes('forcibly closed')) &&
    (msg.includes('connect_finalize') || msg.includes('nla') || msg.includes('credssp'))
  ) {
    return 'credssp_post_auth';
  }
  if (msg.includes('credssp') && (msg.includes('oracle') || msg.includes('encryption'))) {
    return 'credssp_oracle';
  }
  if (msg.includes('logon') || msg.includes('password') || msg.includes('credential') || msg.includes('account')) {
    return 'credentials';
  }
  if (msg.includes('tls') || msg.includes('ssl') || msg.includes('certificate')) {
    return 'tls';
  }
  if (msg.includes('timeout') || msg.includes('refused') || msg.includes('unreachable') || msg.includes('dns')) {
    return 'network';
  }
  return 'unknown';
}

function buildDiagnostics(category: ErrorCategory): DiagnosticCause[] {
  switch (category) {
    case 'duplicate_session':
      return [
        {
          icon: <RefreshCw size={20} className="text-yellow-400" />,
          title: 'Duplicate connection attempt',
          description:
            'Another session to this server with the same credentials is already being established. ' +
            'This is often caused by React StrictMode\'s double-mount during development, or by rapidly clicking "Connect" twice.',
          remediation: [
            'Click "Retry Connection" below — the stale session will be evicted automatically.',
            'If this keeps happening in production, ensure only one tab or window is connecting to this host.',
          ],
          severity: 'low',
        },
      ];
    case 'negotiation_failure':
      return [
        {
          icon: <ShieldAlert size={20} className="text-amber-400" />,
          title: 'Server requires Enhanced RDP Security (CredSSP / NLA)',
          description:
            'The RDP server requires Enhanced RDP Security with CredSSP (Network Level Authentication) ' +
            'but the current connection settings do not offer it, or the server rejected the offered ' +
            'security protocol during X.224 negotiation.',
          remediation: [
            'In this connection\'s Security settings, ensure "Use CredSSP / NLA" is enabled.',
            'Try enabling "Auto-detect negotiation" so the app can find a working protocol automatically.',
            'If the server requires HYBRID_EX, enable "Allow Hybrid Extended Security" in Security settings.',
            'On the server, check "Security Layer" in RD Session Host Configuration — if set to "Negotiate" or "SSL (TLS 1.0)", the server should accept TLS without CredSSP.',
          ],
          severity: 'high',
        },
        {
          icon: <Lock size={20} className="text-yellow-400" />,
          title: 'Protocol mismatch',
          description:
            'The client offered a security protocol (e.g. TLS-only, plain) that the server does not support. ' +
            'Most modern Windows servers require NLA/CredSSP.',
          remediation: [
            'Switch the negotiation strategy to "NLA First" or "Auto" in the Negotiation settings tab.',
            'On the server, verify Remote Desktop → Advanced → "Require Network Level Authentication" is consistent with your settings.',
          ],
          severity: 'medium',
        },
      ];

    case 'credssp_post_auth':
      return [
        {
          icon: <KeyRound size={20} className="text-red-400" />,
          title: 'Incorrect credentials or domain',
          description:
            'The server accepted the TLS handshake but rejected the NLA/CredSSP credentials. The username, password, or domain may be wrong.',
          remediation: [
            'Double-check the username, password, and domain fields on this connection.',
            'Try the format DOMAIN\\user or user@domain.tld if you haven\'t already.',
            'Test the credentials by logging into the machine locally or via another RDP client.',
          ],
          severity: 'high',
        },
        {
          icon: <UserX size={20} className="text-orange-400" />,
          title: 'Missing Remote Desktop permission',
          description:
            'The account may not have the "Allow log on through Remote Desktop Services" user right, or it is not in the Remote Desktop Users group.',
          remediation: [
            'On the target machine, open System Properties → Remote → Select Users, and add the account.',
            'Or add the account to the "Remote Desktop Users" local group via Computer Management → Local Users and Groups.',
            'For domain-joined machines, check Group Policy for "Allow log on through Remote Desktop Services".',
          ],
          severity: 'high',
        },
        {
          icon: <Lock size={20} className="text-yellow-400" />,
          title: 'Account locked or disabled',
          description:
            'The Windows account may be locked out (too many failed attempts) or disabled by an administrator.',
          remediation: [
            'Check Active Directory or local Computer Management → Users to see if the account is locked / disabled.',
            'Unlock the account and try again.',
            'If the account has expired, contact your domain administrator.',
          ],
          severity: 'medium',
        },
        {
          icon: <ShieldAlert size={20} className="text-purple-400" />,
          title: 'CredSSP Encryption Oracle Remediation policy',
          description:
            'If the server enforces "Force Updated Clients", clients that are not fully patched (or whose policy is set to "Vulnerable") will be rejected after NLA.',
          remediation: [
            'On the server, run gpedit.msc → Computer Configuration → Administrative Templates → System → Credentials Delegation → "Encryption Oracle Remediation".',
            'Set the policy to "Mitigated" or "Vulnerable" temporarily to confirm this is the cause.',
            'Ensure both client and server have the latest Windows updates for CredSSP (CVE-2018-0886).',
            'In this app\'s connection settings, try toggling CredSSP off or switching the negotiation strategy.',
          ],
          severity: 'high',
        },
      ];

    case 'credssp_oracle':
      return [
        {
          icon: <ShieldAlert size={20} className="text-purple-400" />,
          title: 'CredSSP Oracle Remediation mismatch',
          description:
            'The client and server disagree on the CredSSP encryption oracle remediation level.',
          remediation: [
            'Ensure both machines are fully patched.',
            'Adjust the "Encryption Oracle Remediation" GPO on the server.',
            'Try disabling CredSSP in this app\'s connection settings and using TLS-only security.',
          ],
          severity: 'high',
        },
      ];

    case 'credentials':
      return [
        {
          icon: <KeyRound size={20} className="text-red-400" />,
          title: 'Authentication failure',
          description: 'The server rejected the supplied credentials.',
          remediation: [
            'Verify the username, password, and domain.',
            'Ensure the account is not locked or expired.',
          ],
          severity: 'high',
        },
      ];

    case 'tls':
      return [
        {
          icon: <Shield size={20} className="text-blue-400" />,
          title: 'TLS / Certificate error',
          description: 'The TLS handshake with the server failed, possibly due to certificate issues.',
          remediation: [
            'Check that the server\'s certificate is valid and trusted.',
            'Try enabling "Ignore certificate errors" in security settings if available.',
            'Ensure the server supports TLS 1.2 or higher.',
          ],
          severity: 'high',
        },
      ];

    case 'network':
      return [
        {
          icon: <Network size={20} className="text-gray-400" />,
          title: 'Network connectivity issue',
          description: 'Could not establish a TCP connection to the target host.',
          remediation: [
            'Verify the hostname/IP and port are correct.',
            'Check that port 3389 (or custom port) is open on the target firewall.',
            'Ensure there is no VPN or network segmentation blocking the path.',
            'Try pinging the host to verify basic reachability.',
          ],
          severity: 'high',
        },
      ];

    case 'unknown':
    default:
      return [
        {
          icon: <ServerCrash size={20} className="text-gray-400" />,
          title: 'Unexpected connection failure',
          description: 'The connection failed for an unrecognised reason. See the full error below for details.',
          remediation: [
            'Review the full error message and search for the key phrase online.',
            'Try different security / negotiation settings on this connection.',
            'Enable auto-detect negotiation to let the app try multiple protocol configurations.',
          ],
          severity: 'medium',
        },
      ];
  }
}

const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  duplicate_session: 'Duplicate Session',
  negotiation_failure: 'Security Negotiation Failure',
  credssp_post_auth: 'Post-Authentication Rejection (NLA / CredSSP)',
  credssp_oracle: 'CredSSP Encryption Oracle Mismatch',
  credentials: 'Authentication Failure',
  network: 'Network / Connectivity',
  tls: 'TLS / Certificate',
  unknown: 'Connection Error',
};

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

  const category = useMemo(() => classifyError(errorMessage), [errorMessage]);
  const diagnostics = useMemo(() => buildDiagnostics(category), [category]);

  const handleCopy = async () => {
    const text = [
      `RDP Connection Error — ${hostname}`,
      `Session: ${sessionId}`,
      `Category: ${CATEGORY_LABELS[category]}`,
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
  const headerColor: Record<ErrorCategory, string> = {
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
            <p className="text-sm text-gray-400 mt-1 truncate">
              {hostname} &mdash; {CATEGORY_LABELS[category]}
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
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
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
                        ? 'border-gray-600 bg-gray-900/80'
                        : 'border-gray-800 bg-gray-900/40 hover:border-gray-700'
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
                            : 'bg-gray-800 text-gray-400'
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
                        <p className="text-sm text-gray-400 leading-relaxed">
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
                                className="flex items-start gap-2 text-sm text-gray-300"
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
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
              >
                <RefreshCw size={14} />
                Retry Connection
              </button>
            )}
            {onEditConnection && (
              <button
                onClick={onEditConnection}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium transition-colors"
              >
                <Terminal size={14} />
                Edit Connection Settings
              </button>
            )}
            {connectionDetails && (
              <button
                onClick={runDeepDiagnostics}
                disabled={isRunningDiagnostics}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-700 hover:bg-purple-600 disabled:bg-purple-900 disabled:opacity-60 text-white text-sm font-medium transition-colors"
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
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors"
            >
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy Error'}
            </button>
          </section>

          {/* ── Deep Diagnostics Report ────────────────────────────── */}
          {(diagnosticReport || diagnosticError) && (
            <section className="rounded-lg border border-purple-800/60 bg-gray-900/60 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-purple-950/40 border-b border-purple-800/40">
                <Microscope size={16} className="text-purple-400" />
                <h3 className="text-sm font-semibold text-purple-300">Deep Diagnostics Report</h3>
                {diagnosticReport && (
                  <span className="ml-auto text-xs text-gray-500">
                    {diagnosticReport.resolvedIp && `${diagnosticReport.host} → ${diagnosticReport.resolvedIp}:${diagnosticReport.port}`}
                  </span>
                )}
              </div>

              {diagnosticError && (
                <div className="px-4 py-3 text-sm text-red-400">
                  Diagnostics failed: {diagnosticError}
                </div>
              )}

              {diagnosticReport && (
                <div className="divide-y divide-gray-800/60">
                  {/* Step-by-step results */}
                  {diagnosticReport.steps.map((step, idx) => {
                    const isExpanded = expandedStep === idx;
                    return (
                      <div key={idx}>
                        <button
                          onClick={() => setExpandedStep(p => p === idx ? null : idx)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-800/40 transition-colors"
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
                          <p className={`text-xs ${step.status === 'fail' ? 'text-red-400' : step.status === 'warn' ? 'text-yellow-400' : 'text-gray-500'}`}>
                            {step.message}
                          </p>
                        </div>
                        {/* detail (expanded) */}
                        {isExpanded && step.detail && (
                          <div className="px-4 pb-3 pl-11">
                            <pre className="text-xs text-gray-400 whitespace-pre-wrap bg-gray-950/60 border border-gray-800 rounded p-2 mt-1">
                              {step.detail}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Summary */}
                  <div className="px-4 py-3 space-y-2">
                    <p className="text-sm text-gray-300">
                      <span className="font-semibold text-gray-400">Summary: </span>
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
              <p className="text-xs text-gray-400">
                Run these on the <em>target server</em> in an elevated PowerShell to temporarily allow
                connections while you investigate:
              </p>
              <pre className="text-xs bg-gray-950 border border-gray-800 rounded p-3 overflow-x-auto text-green-300 select-all">
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
              className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-400 transition-colors"
            >
              {showRawError ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showRawError ? 'Hide' : 'Show'} full error details
            </button>
            {showRawError && (
              <pre className="mt-2 text-xs bg-gray-900 border border-gray-800 rounded p-4 whitespace-pre-wrap break-all text-gray-400 max-h-48 overflow-y-auto font-mono">
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
