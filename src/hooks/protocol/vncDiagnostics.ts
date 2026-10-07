import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  VncDiagnosticCode,
  VncDiagnosticReport,
  VncDiagnosticRequest,
} from "../../types/protocols/vncDiagnostics";

export const VNC_DIAGNOSTIC_MESSAGES: Record<VncDiagnosticCode, string> = {
  ready:
    "The server sent an RFB greeting. Authentication and desktop access were not tested.",
  refused:
    "TCP connection refused. The endpoint or a firewall actively rejected the connection before VNC authentication.",
  timeout:
    "The check timed out. Filtering, an unavailable host, or an unresponsive service may be responsible.",
  dns: "The target hostname could not be resolved by the system resolver.",
  unreachable: "The network or target is unreachable from this network path.",
  authentication:
    "VNC authentication failed. Confirm the server's authentication method and saved credentials.",
  security:
    "The server's security requirements do not match the allowed VNC security policy.",
  protocol:
    "The endpoint did not provide a valid supported RFB greeting. Confirm this is the VNC port.",
  closed:
    "The server closed the connection before sending a complete RFB greeting.",
  routeBlocked:
    "The configured network path cannot be verified by the native VNC transport. No diagnostic DNS or TCP request was sent.",
  invalidTarget:
    "Enter a hostname or IP address and a TCP port from 1 to 65535; URLs and credentials are not accepted.",
  busy: "Two VNC diagnostics are already running. Wait for them to finish and try again.",
  unavailable:
    "VNC diagnostics could not run. Confirm this native build includes the diagnose_vnc command and retry.",
  unknown:
    "The VNC operation failed. Run the bounded checks to identify the failing stage.",
};

/** Classify only: never return backend text, which can contain secrets. */
export function classifyVncFailure(error: string | null): VncDiagnosticCode {
  const text = error?.toLowerCase() ?? "";
  if (/network path|route.*unsupported|route.*verified/.test(text))
    return "routeBlocked";
  if (/10061|econnrefused|connection refused|actively refused/.test(text))
    return "refused";
  if (/10060|etimedout|timed out|timeout/.test(text)) return "timeout";
  if (/11001|enotfound|name.*resolv|dns|no such host/.test(text)) return "dns";
  if (/10051|10065|enetunreach|ehostunreach|unreachable|no route/.test(text))
    return "unreachable";
  if (/authentication|password|credentials/.test(text)) return "authentication";
  if (/security|unencrypted|tls|weak auth/.test(text)) return "security";
  if (/rfb|protocol|version|handshake/.test(text)) return "protocol";
  if (/closed|reset|eof/.test(text)) return "closed";
  return "unknown";
}

export function vncOsErrorCode(error: string | null): string | null {
  return (
    error?.match(/os error (10061|10060|10051|10065|11001)\b/i)?.[1] ?? null
  );
}

export function vncDiagnosticStepMessage(
  step: VncDiagnosticReport["steps"][number],
): string {
  if (step.status === "skipped")
    return "Not attempted because an earlier stage failed.";
  if (step.status === "failed") return VNC_DIAGNOSTIC_MESSAGES[step.code];
  return step.stage === "dns"
    ? "Target address resolved."
    : step.stage === "tcp"
      ? "TCP connection established."
      : VNC_DIAGNOSTIC_MESSAGES.ready;
}

export function vncDiagnosticFacts(report: VncDiagnosticReport): string[] {
  const addresses = report.resolvedAddresses
    .filter((address) => /^[0-9a-fA-F:.]+$/.test(address))
    .slice(0, 4);
  return [
    ...(addresses.length
      ? [`Resolved addresses: ${addresses.join(", ")}`]
      : []),
    ...(report.protocolVersion && /^\d{3}\.\d{3}$/.test(report.protocolVersion)
      ? [`RFB version: ${report.protocolVersion}`]
      : []),
  ];
}

export function vncDiagnosticTarget(
  connection: Connection | undefined,
  session: ConnectionSession,
) {
  const paths: string[] = [];
  if (!connection) paths.push("Connection configuration unavailable");
  if (
    connection?.proxyProfileId !== undefined ||
    connection?.proxyChainId ||
    connection?.security?.proxy?.enabled
  )
    paths.push("Proxy");
  if (
    connection?.tunnelProfileId !== undefined ||
    connection?.tunnelChainId ||
    connection?.security?.sshTunnel?.enabled
  )
    paths.push("Tunnel");
  if (connection?.connectionChainId) paths.push("Connection chain");
  if (connection?.security?.openvpn?.enabled) paths.push("VPN");
  if (
    connection?.security?.tunnelChain?.some((layer) => layer.enabled !== false)
  )
    paths.push("Tunnel chain");
  if (
    session.networkPath?.transports.some(
      (transport) => transport !== "direct",
    ) ||
    session.networkPath?.connectionIds.length
  )
    paths.push("Session network path");
  if (
    session.vpnLeaseOwnerId ||
    session.vpnLeaseOwnerIds?.length ||
    session.vpnLeaseBindings?.length
  )
    paths.push("Session VPN");
  const request: VncDiagnosticRequest = {
    host: connection?.hostname || session.hostname,
    port: connection?.port || 5900,
    route: paths.length ? "blocked" : "direct",
  };
  return {
    request,
    path: paths.length
      ? `${paths.join(" → ")} (unsupported by native VNC)`
      : "Direct TCP using system routing; system DNS",
  };
}

export function validVncDiagnosticTarget(
  request: VncDiagnosticRequest,
): boolean {
  if (
    !request.host ||
    request.host.length > 253 ||
    !Number.isInteger(request.port) ||
    request.port < 1 ||
    request.port > 65535
  )
    return false;
  if (request.host.includes(":")) {
    const host =
      request.host.startsWith("[") && request.host.endsWith("]")
        ? request.host.slice(1, -1)
        : request.host;
    if (!/^[a-fA-F0-9:.]+$/.test(host)) return false;
    try {
      return new URL(`http://[${host}]/`).hostname.startsWith("[");
    } catch {
      return false;
    }
  }
  return request.host
    .replace(/\.$/, "")
    .split(".")
    .every((label) =>
      /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label),
    );
}

export function vncTargetAddress(request: VncDiagnosticRequest): string {
  return `${request.host.includes(":") && !request.host.startsWith("[") ? `[${request.host}]` : request.host}:${request.port}`;
}

/** Closed fields only. No connection names, IDs, raw errors, credentials or banners. */
export function vncDiagnosticsText(
  request: VncDiagnosticRequest,
  path: string,
  failure: VncDiagnosticCode,
  report: VncDiagnosticReport | null,
  osCode: string | null = null,
): string {
  return [
    "VNC diagnostics (credentials and raw server/error text omitted)",
    `Target: ${validVncDiagnosticTarget(request) ? vncTargetAddress(request) : "[invalid target omitted]"}`,
    `Network path: ${path}`,
    `Connection failure: ${VNC_DIAGNOSTIC_MESSAGES[failure]}`,
    ...(osCode && /^(10061|10060|10051|10065|11001)$/.test(osCode)
      ? [`OS error: ${osCode}`]
      : []),
    ...(report
      ? [
          `Probe result: ${VNC_DIAGNOSTIC_MESSAGES[report.code]}`,
          ...vncDiagnosticFacts(report),
          ...report.steps.map(
            (step) =>
              `${step.stage.toUpperCase()}: ${step.status}; ${vncDiagnosticStepMessage(step)} (${step.durationMs} ms)`,
          ),
          `Elapsed: ${report.durationMs} ms`,
        ]
      : ["Diagnostics have not been run."]),
    "Only DNS, TCP connection and a read-only RFB greeting check; no VNC authentication or input.",
  ].join("\n");
}
