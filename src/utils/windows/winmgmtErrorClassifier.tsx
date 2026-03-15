/**
 * WMI/WinRM connection-error classification and diagnostic-cause builder.
 *
 * Classifies raw error strings from the sorng-winmgmt Rust backend into
 * actionable categories with probable causes and remediation steps.
 */

import React from 'react';
import {
  Network,
  KeyRound,
  ShieldAlert,
  Shield,
  ServerCrash,
  Timer,
  MonitorX,
  Lock,
  Settings,
  AlertTriangle,
} from 'lucide-react';

/* ── Types ───────────────────────────────────────────────────────── */

export type WinmgmtErrorCategory =
  | 'network'
  | 'winrm_disabled'
  | 'auth_failure'
  | 'access_denied'
  | 'tls_cert'
  | 'soap_fault'
  | 'timeout'
  | 'session_limit'
  | 'wmi_namespace'
  | 'unknown';

export interface DiagnosticCause {
  icon: React.ReactNode;
  title: string;
  description: string;
  remediation: string[];
  severity: 'high' | 'medium' | 'low';
}

/* ── Classification ──────────────────────────────────────────────── */

export function classifyWinmgmtError(raw: string): WinmgmtErrorCategory {
  const msg = raw.toLowerCase();

  // Session limit
  if (msg.includes('maximum session limit') || msg.includes('session limit')) {
    return 'session_limit';
  }

  // Authentication / credentials
  if (
    msg.includes('http 401') ||
    msg.includes('unauthorized') ||
    msg.includes('invalid credentials') ||
    msg.includes('logon failure') ||
    msg.includes('authentication failed') ||
    msg.includes('authentication/access check failed') ||
    msg.includes('bad username or password') ||
    (msg.includes('http 403') && (msg.includes('credential') || msg.includes('logon')))
  ) {
    return 'auth_failure';
  }

  // Access denied (post-auth)
  if (
    msg.includes('access denied') ||
    msg.includes('access is denied') ||
    msg.includes('http 403') ||
    msg.includes('permission denied') ||
    msg.includes('not authorized')
  ) {
    return 'access_denied';
  }

  // WMI namespace errors
  if (
    msg.includes('invalid namespace') ||
    msg.includes('invalid class') ||
    msg.includes('wbem_e_') ||
    msg.includes('0x8004') // WBEM error code prefix
  ) {
    return 'wmi_namespace';
  }

  // WinRM not enabled / listening
  if (
    msg.includes('connection refused') ||
    msg.includes('actively refused') ||
    (msg.includes('failed to create transport') && msg.includes('connect')) ||
    msg.includes('no connection could be made') ||
    msg.includes('wsmanfault') ||
    (msg.includes('connection test failed') && msg.includes('error sending request'))
  ) {
    return 'winrm_disabled';
  }

  // TLS / certificate
  if (
    msg.includes('tls') ||
    msg.includes('ssl') ||
    msg.includes('certificate') ||
    msg.includes('cert') ||
    msg.includes('handshake') ||
    msg.includes('invalid peer certificate')
  ) {
    return 'tls_cert';
  }

  // Timeout
  if (
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('deadline') ||
    msg.includes('elapsed')
  ) {
    return 'timeout';
  }

  // Network / connectivity
  if (
    msg.includes('dns') ||
    msg.includes('resolve') ||
    msg.includes('unreachable') ||
    msg.includes('no route') ||
    msg.includes('network is down') ||
    msg.includes('host not found') ||
    msg.includes('name or service not known') ||
    msg.includes('getaddrinfo') ||
    msg.includes('connection reset') ||
    msg.includes('wmi http request failed')
  ) {
    return 'network';
  }

  // Generic SOAP fault
  if (
    msg.includes('soap fault') ||
    msg.includes('wmi request failed') ||
    msg.includes('wsman:') ||
    msg.includes('faultstring')
  ) {
    return 'soap_fault';
  }

  return 'unknown';
}

/* ── Diagnostic suggestions ──────────────────────────────────────── */

export function buildWinmgmtDiagnostics(category: WinmgmtErrorCategory): DiagnosticCause[] {
  switch (category) {
    case 'network':
      return [
        {
          icon: <Network size={20} className="text-[var(--color-textSecondary)]" />,
          title: 'Network connectivity issue',
          description:
            'Cannot reach the target host. DNS resolution may have failed, or there is no network path to the machine.',
          remediation: [
            'Verify the hostname or IP address is correct.',
            'Try pinging the target: ping <hostname> from a terminal.',
            'Check that no firewall or network segmentation is blocking access.',
            'If using a hostname, verify DNS resolves correctly: nslookup <hostname>.',
            'Ensure the target machine is powered on and on the network.',
          ],
          severity: 'high',
        },
      ];

    case 'winrm_disabled':
      return [
        {
          icon: <MonitorX size={20} className="text-[var(--color-warning)]" />,
          title: 'WinRM service not running or not listening',
          description:
            'The connection was refused, which usually means the Windows Remote Management (WinRM) service is not running ' +
            'or is not configured to listen on the expected port (5985 for HTTP, 5986 for HTTPS).',
          remediation: [
            'On the target machine, run: winrm quickconfig in an elevated PowerShell.',
            'Verify the service is running: Get-Service WinRM — it should be Running.',
            'Check the listener exists: winrm enumerate winrm/config/listener.',
            'Ensure port 5985 (HTTP) or 5986 (HTTPS) is open in Windows Firewall.',
            'For remote machines in a workgroup, you may also need to add the target to TrustedHosts.',
          ],
          severity: 'high',
        },
        {
          icon: <Settings size={20} className="text-[var(--color-textMuted)]" />,
          title: 'Wrong port or protocol',
          description:
            'The connection may be targeting the wrong port. HTTP uses 5985, HTTPS uses 5986. Custom ports are possible but uncommon.',
          remediation: [
            'Verify the port is correct for the chosen protocol (HTTP=5985, HTTPS=5986).',
            'Try switching between HTTP and HTTPS in the connection settings.',
            'Test port reachability: Test-NetConnection <host> -Port 5985.',
          ],
          severity: 'medium',
        },
      ];

    case 'auth_failure':
      return [
        {
          icon: <KeyRound size={20} className="text-[var(--color-error)]" />,
          title: 'Invalid credentials',
          description:
            'The WinRM server rejected the supplied username/password. This is an HTTP 401 Unauthorized response.',
          remediation: [
            'Double-check the username, password, and domain.',
            'For domain accounts, use the format DOMAIN\\username or username@domain.tld.',
            'For local accounts, use .\\username or just the username without a domain.',
            'Verify the account is not locked out or expired in Active Directory / local user management.',
            'Test the credentials by logging into the target machine directly.',
          ],
          severity: 'high',
        },
        {
          icon: <ShieldAlert size={20} className="text-[var(--color-warning)]" />,
          title: 'Basic auth not enabled on target',
          description:
            'WinRM on the target may have Basic authentication disabled. By default, WinRM only allows Basic auth over HTTPS, ' +
            'not plain HTTP.',
          remediation: [
            'On the target, check: winrm get winrm/config/service/auth — look for Basic = true.',
            'To enable: winrm set winrm/config/service/auth @{Basic="true"} (elevated PS).',
            'For better security, switch the connection to use HTTPS (port 5986) instead of enabling Basic over HTTP.',
            'Consider using Negotiate/Kerberos auth if in a domain environment.',
          ],
          severity: 'high',
        },
      ];

    case 'access_denied':
      return [
        {
          icon: <Lock size={20} className="text-[var(--color-error)]" />,
          title: 'Access denied — insufficient permissions',
          description:
            'Authentication succeeded but the account does not have permission to access WMI on the target. ' +
            'The user must be in the local Administrators group or have explicit WMI permissions.',
          remediation: [
            'Add the account to the local Administrators group on the target machine.',
            'Or grant WMI permissions: wmimgmt.msc → WMI Control → Properties → Security → root\\cimv2 → add user with Remote Enable.',
            'For non-admin accounts, also grant DCOM permissions via dcomcnfg → My Computer → COM Security → Access/Launch Permissions.',
            'Check that UAC remote restrictions aren\'t blocking: set LocalAccountTokenFilterPolicy to 1 in HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System.',
          ],
          severity: 'high',
        },
      ];

    case 'tls_cert':
      return [
        {
          icon: <Shield size={20} className="text-[var(--color-info)]" />,
          title: 'TLS / Certificate error',
          description:
            'The HTTPS connection to WinRM failed due to a certificate issue. The server may be using a self-signed certificate, ' +
            'or the certificate hostname doesn\'t match.',
          remediation: [
            'Enable "Skip CA check" or "Skip CN check" in the connection settings to accept self-signed certificates.',
            'Or install the server\'s CA certificate in the client\'s trust store.',
            'Verify the server has a valid HTTPS listener: winrm enumerate winrm/config/listener.',
            'If switching from HTTPS is acceptable, try connecting via HTTP (port 5985) instead.',
          ],
          severity: 'high',
        },
      ];

    case 'timeout':
      return [
        {
          icon: <Timer size={20} className="text-[var(--color-warning)]" />,
          title: 'Connection timed out',
          description:
            'The connection attempt exceeded the timeout limit. The target machine may be slow to respond, ' +
            'behind a firewall that silently drops packets, or the WinRM service is overloaded.',
          remediation: [
            'Increase the connection timeout in the connection settings (default is 30 seconds).',
            'Verify the target is reachable: ping <hostname>.',
            'Check that firewalls are not silently dropping WinRM traffic (as opposed to rejecting it).',
            'If the machine is under heavy load, wait and retry.',
            'Try connecting to the IP address directly to rule out DNS delays.',
          ],
          severity: 'medium',
        },
      ];

    case 'session_limit':
      return [
        {
          icon: <AlertTriangle size={20} className="text-[var(--color-warning)]" />,
          title: 'Maximum session limit reached',
          description:
            'The local session pool has reached its limit. This usually means many connections are open simultaneously.',
          remediation: [
            'Close unused Windows management tabs to free session slots.',
            'Disconnect from machines you are no longer actively managing.',
            'The default limit is 50 concurrent sessions — this is rarely an issue in normal use.',
          ],
          severity: 'low',
        },
      ];

    case 'wmi_namespace':
      return [
        {
          icon: <Settings size={20} className="text-[var(--color-warning)]" />,
          title: 'WMI namespace or class error',
          description:
            'The requested WMI namespace (e.g. root\\cimv2) or WMI class does not exist on the target. ' +
            'This can happen if a Windows feature is not installed or if the WMI repository is corrupt.',
          remediation: [
            'Verify the namespace exists on the target: Get-WmiObject -Namespace root\\cimv2 -Class __Namespace.',
            'If the WMI repository is corrupt, rebuild it: winmgmt /salvagerepository.',
            'Ensure the target OS version supports the queried WMI classes.',
            'Try the default namespace root\\cimv2 if using a custom one.',
          ],
          severity: 'medium',
        },
      ];

    case 'soap_fault':
      return [
        {
          icon: <ServerCrash size={20} className="text-[var(--color-warning)]" />,
          title: 'WS-Management protocol error',
          description:
            'The WinRM server returned a SOAP fault. This is a protocol-level error in the WS-Management communication.',
          remediation: [
            'Check the raw error message for specific fault details — the SOAP fault text usually explains the issue.',
            'Common causes: invalid WQL query, resource not found, provider load failure.',
            'Verify WinRM is properly configured: winrm get winrm/config.',
            'Check the Windows Event Log on the target for WinRM-related errors (Microsoft-Windows-WinRM/Operational).',
          ],
          severity: 'medium',
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
            'Review the full raw error message for clues.',
            'Verify WinRM is enabled on the target: winrm quickconfig.',
            'Check network connectivity, firewall rules, and credentials.',
            'Try connecting with different authentication or protocol settings.',
          ],
          severity: 'medium',
        },
      ];
  }
}

/* ── Labels ──────────────────────────────────────────────────────── */

export const WINMGMT_ERROR_CATEGORY_LABELS: Record<WinmgmtErrorCategory, string> = {
  network: 'Network / Connectivity',
  winrm_disabled: 'WinRM Not Listening',
  auth_failure: 'Authentication Failure',
  access_denied: 'Access Denied',
  tls_cert: 'TLS / Certificate',
  soap_fault: 'WS-Management Protocol Error',
  timeout: 'Connection Timeout',
  session_limit: 'Session Limit',
  wmi_namespace: 'WMI Namespace Error',
  unknown: 'Connection Error',
};

/* ── Connection info helper ──────────────────────────────────────── */

export interface WinmgmtConnectionInfo {
  hostname: string;
  port: number;
  protocol: 'HTTP' | 'HTTPS';
  authMethod: string;
  namespace: string;
  username?: string;
  domain?: string;
}

/** Build a human-readable summary of the connection config for diagnostics. */
export function summarizeConnection(info: WinmgmtConnectionInfo): string[] {
  const lines: string[] = [];
  lines.push(`Target: ${info.hostname}:${info.port}`);
  lines.push(`Protocol: WinRM over ${info.protocol}`);
  lines.push(`Auth: ${info.authMethod}`);
  lines.push(`Namespace: ${info.namespace}`);
  if (info.username) {
    lines.push(`User: ${info.domain ? `${info.domain}\\${info.username}` : info.username}`);
  }
  return lines;
}
