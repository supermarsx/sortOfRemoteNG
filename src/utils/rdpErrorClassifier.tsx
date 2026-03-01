/**
 * RDP connection-error classification and diagnostic-cause builder.
 *
 * Pure logic extracted from RDPErrorScreen so it can be
 * unit-tested and reused (e.g. in logging / telemetry).
 */

import React from 'react';
import {
  RefreshCw,
  ShieldAlert,
  KeyRound,
  UserX,
  Lock,
  ServerCrash,
  Network,
  Shield,
} from 'lucide-react';

/* ── Types ───────────────────────────────────────────────────────── */

export type RDPErrorCategory =
  | 'duplicate_session'
  | 'negotiation_failure'
  | 'credssp_post_auth'
  | 'credssp_oracle'
  | 'credentials'
  | 'network'
  | 'tls'
  | 'unknown';

export interface DiagnosticCause {
  icon: React.ReactNode;
  title: string;
  description: string;
  remediation: string[];
  severity: 'high' | 'medium' | 'low';
}

export interface DiagnosticStepResult {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'warn' | 'info';
  message: string;
  durationMs: number;
  detail: string | null;
}

export interface DiagnosticReportResult {
  host: string;
  port: number;
  protocol: string;
  resolvedIp: string | null;
  steps: DiagnosticStepResult[];
  summary: string;
  rootCauseHint: string | null;
  totalDurationMs: number;
}

/* ── Classification ──────────────────────────────────────────────── */

export function classifyRdpError(raw: string): RDPErrorCategory {
  const msg = raw.toLowerCase();
  if (msg.includes('already active or connecting')) {
    return 'duplicate_session';
  }
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

/* ── Diagnostic suggestions ──────────────────────────────────────── */

export function buildRdpDiagnostics(category: RDPErrorCategory): DiagnosticCause[] {
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
          icon: <Network size={20} className="text-[var(--color-textSecondary)]" />,
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
          icon: <ServerCrash size={20} className="text-[var(--color-textSecondary)]" />,
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

/* ── Labels ──────────────────────────────────────────────────────── */

export const RDP_ERROR_CATEGORY_LABELS: Record<RDPErrorCategory, string> = {
  duplicate_session: 'Duplicate Session',
  negotiation_failure: 'Security Negotiation Failure',
  credssp_post_auth: 'Post-Authentication Rejection (NLA / CredSSP)',
  credssp_oracle: 'CredSSP Encryption Oracle Mismatch',
  credentials: 'Authentication Failure',
  network: 'Network / Connectivity',
  tls: 'TLS / Certificate',
  unknown: 'Connection Error',
};
