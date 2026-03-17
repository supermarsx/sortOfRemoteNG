import React, { useState, useMemo } from "react";
import {
  X,
  Loader2,
  Stethoscope,
  Copy,
  CheckCircle,
  XCircle,
  AlertCircle,
  Info,
  ChevronDown,
  ChevronUp,
  Clock,
  Globe,
  Network,
  Activity,
  Shield,
  Gauge,
  Settings,
  Microscope,
  Play,
  MapPin,
  Router,
  Tags,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Connection } from "../../types/connection/connection";
import { Modal } from "../ui/overlays/Modal";
import { useConnectionDiagnostics, DiagnosticsMgr } from "../../hooks/connection/useConnectionDiagnostics";
import PingGraph from "./diagnostics/PingGraph";
import PingStatsGrid from "./diagnostics/PingStatsGrid";

/* ── Types ─────────────────────────────────────────────────────── */

interface ConnectionDiagnosticsProps {
  connection: Connection;
  onClose: () => void;
}

type CategoryId =
  | "network"
  | "protocol"
  | "authentication"
  | "certificate"
  | "performance"
  | "configuration";

type StepStatus = "idle" | "running" | "pass" | "fail" | "warn" | "info";

interface CategoryDef {
  id: CategoryId;
  label: string;
  icon: React.ReactNode;
}

/* ── Status helpers ────────────────────────────────────────────── */

function StepStatusIcon({ status, size = 14 }: { status: StepStatus; size?: number }) {
  switch (status) {
    case "running":
      return <Loader2 size={size} className="text-primary animate-spin" />;
    case "pass":
      return <CheckCircle size={size} className="text-success" />;
    case "fail":
      return <XCircle size={size} className="text-error" />;
    case "warn":
      return <AlertCircle size={size} className="text-warning" />;
    case "info":
      return <Info size={size} className="text-primary" />;
    default:
      return <div className="rounded-full border-2 border-[var(--color-border)]" style={{ width: size, height: size }} />;
  }
}

function CategoryStatusIcon({ status, size = 16 }: { status: StepStatus; size?: number }) {
  switch (status) {
    case "running":
      return <Loader2 size={size} className="text-primary animate-spin" />;
    case "pass":
      return <CheckCircle size={size} className="text-success" />;
    case "fail":
      return <XCircle size={size} className="text-error" />;
    case "warn":
      return <AlertCircle size={size} className="text-warning" />;
    default:
      return <div className="w-2 h-2 rounded-full bg-[var(--color-border)]" />;
  }
}

/* ── Protocol badge ────────────────────────────────────────────── */

const protocolColors: Record<string, string> = {
  rdp: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  ssh: "bg-green-500/20 text-green-400 border-green-500/30",
  http: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  https: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  vnc: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  winrm: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
};

function ProtocolBadge({ protocol }: { protocol: string }) {
  const color = protocolColors[protocol.toLowerCase()] || "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] border-[var(--color-border)]";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${color}`}>
      {protocol}
    </span>
  );
}

/* ── Expandable detail row ─────────────────────────────────────── */

function DiagRow({
  status,
  label,
  durationMs,
  detail,
  children,
}: {
  status: StepStatus;
  label: string;
  durationMs?: number;
  detail?: string | null;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean(detail) || Boolean(children);

  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] overflow-hidden">
      <button
        onClick={() => hasDetail && setExpanded(!expanded)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${hasDetail ? "hover:bg-[var(--color-surfaceHover)] cursor-pointer" : "cursor-default"}`}
      >
        <StepStatusIcon status={status} />
        <span className="flex-1 text-xs font-medium text-[var(--color-text)]">
          {label}
        </span>
        {durationMs !== undefined && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--color-textSecondary)] tabular-nums">
            <Clock size={10} />
            {durationMs}ms
          </span>
        )}
        {hasDetail && (
          expanded
            ? <ChevronUp size={12} className="text-[var(--color-textMuted)]" />
            : <ChevronDown size={12} className="text-[var(--color-textMuted)]" />
        )}
      </button>
      {expanded && (detail || children) && (
        <div className="px-3 pb-3 border-t border-[var(--color-border)]">
          {detail && (
            <pre className="mt-2 text-[10px] text-[var(--color-textSecondary)] whitespace-pre-wrap bg-[var(--color-surfaceHover)] rounded p-2 font-mono">
              {detail}
            </pre>
          )}
          {children && <div className="mt-2">{children}</div>}
        </div>
      )}
    </div>
  );
}

/* ── Info card (small metric card) ─────────────────────────────── */

function InfoCard({ label, value, subtext, color }: {
  label: string;
  value: string;
  subtext?: string;
  color?: string;
}) {
  return (
    <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1">
        {label}
      </div>
      <div className={`text-sm font-semibold ${color || "text-[var(--color-text)]"}`}>
        {value}
      </div>
      {subtext && (
        <div className="text-[10px] text-[var(--color-textSecondary)] mt-0.5 truncate" title={subtext}>
          {subtext}
        </div>
      )}
    </div>
  );
}

/* ── Category status computation ───────────────────────────────── */

function useCategoryStatuses(mgr: DiagnosticsMgr, connection: Connection) {
  const { results, isRunning, protocolReport, protocolDiagRunning } = mgr;

  return useMemo(() => {
    const statuses: Record<CategoryId, StepStatus> = {
      network: "idle",
      protocol: "idle",
      authentication: "idle",
      certificate: "idle",
      performance: "idle",
      configuration: "idle",
    };

    if (isRunning) {
      // Determine which categories are still running vs completed
      const networkDone = results.internetCheck !== "pending" && results.gatewayCheck !== "pending" && results.subnetCheck !== "pending";
      const hasDns = results.dnsResult !== null;
      const hasPort = results.portCheck !== null;

      if (!networkDone || !hasDns || !hasPort) {
        statuses.network = "running";
      } else {
        const allNetPass = results.internetCheck === "success" && results.gatewayCheck === "success" && results.subnetCheck === "success";
        const dnsPass = results.dnsResult?.success ?? false;
        const portOpen = results.portCheck?.open ?? false;
        if (allNetPass && dnsPass && portOpen) statuses.network = "pass";
        else if (results.subnetCheck === "failed" && !portOpen) statuses.network = "fail";
        else statuses.network = "warn";
      }

      if (protocolDiagRunning) {
        statuses.protocol = "running";
      } else if (protocolReport) {
        const hasFail = protocolReport.steps.some(s => s.status === "fail");
        const hasWarn = protocolReport.steps.some(s => s.status === "warn");
        statuses.protocol = hasFail ? "fail" : hasWarn ? "warn" : "pass";
      }

      // Auth and cert are derived from protocol report
      if (protocolDiagRunning) {
        statuses.authentication = "running";
        statuses.certificate = "running";
      } else if (protocolReport) {
        const authSteps = protocolReport.steps.filter(s =>
          s.name.toLowerCase().includes("auth") || s.name.toLowerCase().includes("credential") || s.name.toLowerCase().includes("login")
        );
        if (authSteps.length > 0) {
          statuses.authentication = authSteps.some(s => s.status === "fail") ? "fail" : authSteps.some(s => s.status === "warn") ? "warn" : "pass";
        }
        const certSteps = protocolReport.steps.filter(s =>
          s.name.toLowerCase().includes("tls") || s.name.toLowerCase().includes("cert") || s.name.toLowerCase().includes("ssl") || s.name.toLowerCase().includes("security")
        );
        if (certSteps.length > 0) {
          statuses.certificate = certSteps.some(s => s.status === "fail") ? "fail" : certSteps.some(s => s.status === "warn") ? "warn" : "pass";
        }
      }

      // TLS check also affects certificate category
      if (results.tlsCheck) {
        if (!results.tlsCheck.tls_supported) statuses.certificate = "fail";
        else if (!results.tlsCheck.certificate_valid) statuses.certificate = "warn";
        else if (statuses.certificate === "idle") statuses.certificate = "pass";
      }

      // Performance
      const hasPings = results.pings.length > 0;
      const hasTcp = results.tcpTiming !== null;
      if (!hasPings && !hasTcp) {
        statuses.performance = "running";
      } else {
        const pingOk = mgr.pingSuccessRate >= 80;
        const tcpOk = results.tcpTiming ? !results.tcpTiming.slow_connection : true;
        statuses.performance = (pingOk && tcpOk) ? "pass" : (!pingOk || (results.tcpTiming && !results.tcpTiming.success)) ? "fail" : "warn";
      }

      // Config is always info once we have basic data
      statuses.configuration = hasDns ? "info" : "running";
    } else {
      // Not running -- compute final statuses
      const networkDone = results.internetCheck !== "pending";
      if (networkDone) {
        const allNetPass = results.internetCheck === "success" && results.gatewayCheck === "success" && results.subnetCheck === "success";
        const dnsPass = results.dnsResult?.success ?? false;
        const portOpen = results.portCheck?.open ?? false;
        if (allNetPass && dnsPass && portOpen) statuses.network = "pass";
        else if (results.subnetCheck === "failed" && !portOpen) statuses.network = "fail";
        else if (results.internetCheck !== "pending") statuses.network = "warn";
      }

      if (protocolReport) {
        const hasFail = protocolReport.steps.some(s => s.status === "fail");
        const hasWarn = protocolReport.steps.some(s => s.status === "warn");
        statuses.protocol = hasFail ? "fail" : hasWarn ? "warn" : "pass";

        const authSteps = protocolReport.steps.filter(s =>
          s.name.toLowerCase().includes("auth") || s.name.toLowerCase().includes("credential") || s.name.toLowerCase().includes("login")
        );
        if (authSteps.length > 0) {
          statuses.authentication = authSteps.some(s => s.status === "fail") ? "fail" : authSteps.some(s => s.status === "warn") ? "warn" : "pass";
        }
        const certSteps = protocolReport.steps.filter(s =>
          s.name.toLowerCase().includes("tls") || s.name.toLowerCase().includes("cert") || s.name.toLowerCase().includes("ssl") || s.name.toLowerCase().includes("security")
        );
        if (certSteps.length > 0) {
          statuses.certificate = certSteps.some(s => s.status === "fail") ? "fail" : certSteps.some(s => s.status === "warn") ? "warn" : "pass";
        }
      }

      if (results.tlsCheck) {
        if (!results.tlsCheck.tls_supported) statuses.certificate = "fail";
        else if (!results.tlsCheck.certificate_valid) statuses.certificate = "warn";
        else if (statuses.certificate === "idle") statuses.certificate = "pass";
      }

      if (results.pings.length > 0 || results.tcpTiming) {
        const pingOk = mgr.pingSuccessRate >= 80;
        const tcpOk = results.tcpTiming ? !results.tcpTiming.slow_connection : true;
        statuses.performance = (pingOk && tcpOk) ? "pass" : (!pingOk || (results.tcpTiming && !results.tcpTiming.success)) ? "fail" : "warn";
      }

      if (results.dnsResult || results.portCheck) {
        statuses.configuration = "info";
      }
    }

    return statuses;
  }, [results, isRunning, protocolReport, protocolDiagRunning, mgr.pingSuccessRate, connection]);
}

/* ── Network panel ─────────────────────────────────────────────── */

function NetworkPanel({ mgr, connection }: { mgr: DiagnosticsMgr; connection: Connection }) {
  const { t } = useTranslation();
  const { results, isRunning } = mgr;

  return (
    <div className="space-y-4">
      {/* Connectivity Checks */}
      <div>
        <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2 flex items-center gap-2">
          <Globe size={12} />
          {t("diagnostics.connectivityChecks", "Connectivity Checks")}
        </h4>
        <div className="grid grid-cols-3 gap-2">
          {([
            ["internetCheck", "Internet", "8.8.8.8 reachable"],
            ["gatewayCheck", "Gateway", "Default gateway"],
            ["subnetCheck", "Target Host", connection.hostname],
          ] as const).map(([key, label, desc]) => {
            const val = results[key];
            const status: StepStatus = val === "pending" ? (isRunning ? "running" : "idle") : val === "success" ? "pass" : "fail";
            return (
              <div key={key} className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div className="flex items-center gap-2 mb-1">
                  <StepStatusIcon status={status} size={12} />
                  <span className="text-xs font-medium text-[var(--color-text)]">{label}</span>
                </div>
                <div className="text-[10px] text-[var(--color-textMuted)]">{desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* DNS Resolution */}
      <div>
        <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2 flex items-center gap-2">
          <Tags size={12} />
          DNS Resolution
        </h4>
        {results.dnsResult ? (
          <DiagRow
            status={results.dnsResult.success ? "pass" : "fail"}
            label={results.dnsResult.success
              ? `Resolved: ${results.dnsResult.resolved_ips.join(", ")}`
              : `DNS failed: ${results.dnsResult.error || "Unknown error"}`}
            durationMs={results.dnsResult.resolution_time_ms}
            detail={[
              results.dnsResult.reverse_dns ? `Reverse DNS: ${results.dnsResult.reverse_dns}` : null,
              results.dnsResult.dns_server ? `DNS Server: ${results.dnsResult.dns_server}` : null,
              results.ipClassification ? `IP Type: ${results.ipClassification.ip_type}${results.ipClassification.ip_class ? ` (${results.ipClassification.ip_class})` : ""}` : null,
              results.ipClassification?.network_info ? `Network: ${results.ipClassification.network_info}` : null,
              results.ipClassification?.is_ipv6 ? "Address Family: IPv6" : results.ipClassification ? "Address Family: IPv4" : null,
            ].filter(Boolean).join("\n") || null}
          />
        ) : isRunning ? (
          <div className="flex items-center gap-2 p-3 text-xs text-[var(--color-textSecondary)]">
            <Loader2 size={14} className="animate-spin" /> Resolving...
          </div>
        ) : null}
      </div>

      {/* Port Check */}
      <div>
        <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2 flex items-center gap-2">
          <Network size={12} />
          TCP Port Check
        </h4>
        {results.portCheck ? (
          <DiagRow
            status={results.portCheck.open ? "pass" : "fail"}
            label={`Port ${results.portCheck.port} (${connection.protocol.toUpperCase()}) -- ${results.portCheck.open ? "Open" : "Closed/Filtered"}`}
            durationMs={results.portCheck.time_ms}
            detail={[
              results.portCheck.service ? `Service: ${results.portCheck.service}` : null,
              results.portCheck.banner ? `Banner: ${results.portCheck.banner}` : null,
            ].filter(Boolean).join("\n") || null}
          />
        ) : isRunning ? (
          <div className="flex items-center gap-2 p-3 text-xs text-[var(--color-textSecondary)]">
            <Loader2 size={14} className="animate-spin" /> Checking port...
          </div>
        ) : null}
      </div>

      {/* Traceroute */}
      {(results.traceroute.length > 0 || isRunning) && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2 flex items-center gap-2">
            <Router size={12} />
            Traceroute
            {results.traceroute.length > 0 && (
              <span className="ml-auto font-normal normal-case text-[var(--color-textMuted)]">
                {results.traceroute.length} hops
              </span>
            )}
          </h4>
          {results.traceroute.length > 0 ? (
            <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden max-h-48 overflow-y-auto">
              {results.traceroute.map((hop, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 px-3 py-1.5 font-mono text-xs border-b border-[var(--color-border)] last:border-b-0 ${
                    hop.timeout ? "text-warning/80" : "text-[var(--color-text)]"
                  }`}
                >
                  <span className="w-5 text-[var(--color-textMuted)] text-right tabular-nums">{hop.hop}</span>
                  <span className="flex-1 truncate">
                    {hop.timeout ? "* * *" : hop.hostname || hop.ip || "Unknown"}
                  </span>
                  {hop.ip && hop.ip !== hop.hostname && (
                    <span className="text-[var(--color-textMuted)]">({hop.ip})</span>
                  )}
                  <span className="w-14 text-right text-[var(--color-textSecondary)] tabular-nums">
                    {hop.time_ms ? `${hop.time_ms}ms` : "-"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 text-xs text-[var(--color-textSecondary)]">
              <Loader2 size={14} className="animate-spin" /> Running traceroute...
            </div>
          )}
        </div>
      )}

      {/* ICMP Blockade */}
      {results.icmpBlockade && (
        <DiagRow
          status={results.icmpBlockade.likely_blocked ? "warn" : results.icmpBlockade.icmp_allowed ? "pass" : "fail"}
          label={results.icmpBlockade.likely_blocked
            ? "ICMP likely blocked by firewall"
            : results.icmpBlockade.icmp_allowed
              ? "ICMP allowed"
              : "ICMP and TCP unreachable"}
          detail={`Diagnosis: ${results.icmpBlockade.diagnosis}\nICMP: ${results.icmpBlockade.icmp_allowed ? "Allowed" : "Blocked"}\nTCP: ${results.icmpBlockade.tcp_reachable ? "Reachable" : "Unreachable"}`}
        />
      )}

      {/* MTU */}
      {results.mtuCheck && (
        <DiagRow
          status={results.mtuCheck.fragmentation_needed ? "warn" : "pass"}
          label={`Path MTU: ${results.mtuCheck.path_mtu || "Unknown"} (recommended: ${results.mtuCheck.recommended_mtu})`}
          detail={results.mtuCheck.fragmentation_needed ? "Fragmentation detected on the path. This may affect performance." : null}
        />
      )}
    </div>
  );
}

/* ── Protocol panel ────────────────────────────────────────────── */

function ProtocolPanel({ mgr, connection }: { mgr: DiagnosticsMgr; connection: Connection }) {
  const { protocolReport, protocolDiagRunning, protocolDiagError } = mgr;
  const proto = connection.protocol.toLowerCase();

  const protocolHints: Record<string, string[]> = {
    rdp: [
      "Security negotiation probe (TLS, CredSSP, NLA)",
      "CredSSP oracle remediation check",
      "Display capability check (color depth, resolution)",
      "Codec support (RemoteFX, H.264)",
      "Gateway connectivity (if configured)",
    ],
    ssh: [
      "Key exchange algorithms",
      "Host key verification",
      "Available auth methods (password, publickey, keyboard-interactive)",
      "Shell / PTY allocation test",
      "Port forwarding capability",
    ],
    http: [
      "TLS version and cipher suite",
      "Certificate chain validation",
      "HTTP response status and headers",
      "Redirect chain",
      "Content-Security-Policy headers",
    ],
    https: [
      "TLS version and cipher suite",
      "Certificate chain validation",
      "HTTP response status and headers",
      "Redirect chain",
      "Content-Security-Policy headers",
    ],
    winrm: [
      "HTTP/HTTPS endpoint check",
      "Auth method detection (Basic, Negotiate, Kerberos)",
      "WMI namespace access test",
      "Credential format validation",
    ],
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <ProtocolBadge protocol={proto} />
        <span className="text-xs text-[var(--color-textSecondary)]">
          {connection.hostname}:{connection.port || "default"}
        </span>
      </div>

      {/* Service fingerprint */}
      {mgr.results.serviceFingerprint && (
        <DiagRow
          status="info"
          label={`Service: ${mgr.results.serviceFingerprint.protocol_detected || mgr.results.serviceFingerprint.service}${mgr.results.serviceFingerprint.version ? ` (${mgr.results.serviceFingerprint.version})` : ""}`}
          detail={[
            `Port: ${mgr.results.serviceFingerprint.port}`,
            mgr.results.serviceFingerprint.banner ? `Banner: ${mgr.results.serviceFingerprint.banner}` : null,
            mgr.results.serviceFingerprint.response_preview ? `Response: ${mgr.results.serviceFingerprint.response_preview}` : null,
          ].filter(Boolean).join("\n")}
        />
      )}

      {/* Protocol-specific expected tests */}
      {!protocolReport && !protocolDiagRunning && !protocolDiagError && protocolHints[proto] && (
        <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-2">
            {proto.toUpperCase()} Diagnostics
          </div>
          <div className="space-y-1">
            {protocolHints[proto].map((hint, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-border)]" />
                {hint}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Running state */}
      {protocolDiagRunning && (
        <div className="flex items-center gap-2 p-4 bg-primary/5 border border-primary/20 rounded-lg text-xs text-primary">
          <Loader2 size={14} className="animate-spin" />
          Running {proto.toUpperCase()} protocol diagnostics...
        </div>
      )}

      {/* Error */}
      {protocolDiagError && (
        <div className="p-3 bg-error/10 border border-error/30 rounded-lg text-xs text-error">
          Diagnostics failed: {protocolDiagError}
        </div>
      )}

      {/* Protocol report steps */}
      {protocolReport && (
        <div className="space-y-2">
          {protocolReport.steps.map((step, idx) => (
            <DiagRow
              key={idx}
              status={step.status === "skip" ? "idle" : step.status}
              label={step.name}
              durationMs={step.durationMs}
              detail={[
                step.message,
                step.detail ? `\n${step.detail}` : null,
              ].filter(Boolean).join("")}
            />
          ))}

          {/* Summary */}
          <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] space-y-2">
            <p className="text-xs text-[var(--color-text)]">
              <span className="font-semibold text-[var(--color-textSecondary)]">Summary: </span>
              {protocolReport.summary}
            </p>
            <div className="flex items-center gap-3 text-[10px] text-[var(--color-textSecondary)]">
              <span>Host: {protocolReport.host}:{protocolReport.port}</span>
              {protocolReport.resolvedIp && <span>IP: {protocolReport.resolvedIp}</span>}
              <span>Duration: {protocolReport.totalDurationMs}ms</span>
            </div>
          </div>

          {/* Root cause */}
          {protocolReport.rootCauseHint && (
            <div className="p-3 border border-warning/30 bg-warning/5 rounded-lg">
              <h4 className="text-[10px] font-semibold text-warning uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <AlertCircle size={10} />
                Root Cause Analysis
              </h4>
              <pre className="text-[10px] text-warning/80 whitespace-pre-wrap leading-relaxed">
                {protocolReport.rootCauseHint}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Authentication panel ──────────────────────────────────────── */

function AuthenticationPanel({ mgr, connection }: { mgr: DiagnosticsMgr; connection: Connection }) {
  const { protocolReport, protocolDiagRunning } = mgr;
  const proto = connection.protocol.toLowerCase();

  const authSteps = protocolReport?.steps.filter(s => {
    const n = s.name.toLowerCase();
    return n.includes("auth") || n.includes("credential") || n.includes("login") || n.includes("password") || n.includes("key exchange") || n.includes("negotiate");
  }) || [];

  return (
    <div className="space-y-4">
      {/* Connection auth config */}
      <div>
        <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2">
          Authentication Configuration
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <InfoCard
            label="Auth Type"
            value={connection.authType || (connection.privateKey ? "Key" : "Password")}
          />
          <InfoCard
            label="Username"
            value={connection.username || "(not set)"}
            color={connection.username ? undefined : "text-[var(--color-textMuted)]"}
          />
          {proto === "rdp" && connection.domain && (
            <InfoCard label="Domain" value={connection.domain} />
          )}
          {proto === "ssh" && connection.privateKey && (
            <InfoCard label="Private Key" value="Configured" color="text-success" />
          )}
        </div>
      </div>

      {/* Auth diagnostic steps */}
      {protocolDiagRunning && (
        <div className="flex items-center gap-2 p-3 text-xs text-primary">
          <Loader2 size={14} className="animate-spin" />
          Testing authentication...
        </div>
      )}

      {authSteps.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-1">
            Authentication Tests
          </h4>
          {authSteps.map((step, idx) => (
            <DiagRow
              key={idx}
              status={step.status === "skip" ? "idle" : step.status}
              label={step.name}
              durationMs={step.durationMs}
              detail={[step.message, step.detail].filter(Boolean).join("\n")}
            />
          ))}
        </div>
      ) : !protocolDiagRunning && protocolReport ? (
        <div className="text-xs text-[var(--color-textSecondary)] p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          No specific authentication steps were reported for this protocol diagnostic.
        </div>
      ) : null}

      {/* Protocol-specific auth hints */}
      {!protocolReport && !protocolDiagRunning && (
        <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-2">
            Expected Auth Checks
          </div>
          {proto === "rdp" && (
            <div className="space-y-1 text-xs text-[var(--color-textSecondary)]">
              <div>NLA / CredSSP authentication</div>
              <div>TLS security negotiation</div>
              <div>Credential validation</div>
            </div>
          )}
          {proto === "ssh" && (
            <div className="space-y-1 text-xs text-[var(--color-textSecondary)]">
              <div>Available auth methods: password, publickey, keyboard-interactive</div>
              <div>Key exchange algorithm negotiation</div>
              <div>Host key verification</div>
            </div>
          )}
          {(proto === "http" || proto === "https") && (
            <div className="space-y-1 text-xs text-[var(--color-textSecondary)]">
              <div>HTTP authentication headers</div>
              <div>Basic / Bearer / API key auth test</div>
            </div>
          )}
          {proto === "winrm" && (
            <div className="space-y-1 text-xs text-[var(--color-textSecondary)]">
              <div>Basic / Negotiate / Kerberos detection</div>
              <div>Credential format validation</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Certificate / Security panel ──────────────────────────────── */

function CertificatePanel({ mgr, connection }: { mgr: DiagnosticsMgr; connection: Connection }) {
  const { results, protocolReport, protocolDiagRunning } = mgr;

  const secSteps = protocolReport?.steps.filter(s => {
    const n = s.name.toLowerCase();
    return n.includes("tls") || n.includes("cert") || n.includes("ssl") || n.includes("security") || n.includes("handshake") || n.includes("credssp");
  }) || [];

  return (
    <div className="space-y-4">
      {/* TLS Check results */}
      {results.tlsCheck && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2 flex items-center gap-2">
            <Shield size={12} />
            TLS / SSL Check
          </h4>
          <div className="space-y-2">
            <DiagRow
              status={results.tlsCheck.tls_supported ? "pass" : "fail"}
              label={results.tlsCheck.tls_supported
                ? `TLS ${results.tlsCheck.tls_version || ""} supported`
                : `TLS not supported${results.tlsCheck.error ? `: ${results.tlsCheck.error}` : ""}`}
              durationMs={results.tlsCheck.handshake_time_ms}
              detail={[
                results.tlsCheck.certificate_subject ? `Subject: ${results.tlsCheck.certificate_subject}` : null,
                results.tlsCheck.certificate_issuer ? `Issuer: ${results.tlsCheck.certificate_issuer}` : null,
                results.tlsCheck.certificate_expiry ? `Expiry: ${new Date(results.tlsCheck.certificate_expiry).toLocaleDateString()}` : null,
              ].filter(Boolean).join("\n") || null}
            />

            {results.tlsCheck.tls_supported && (
              <div className="grid grid-cols-2 gap-2">
                <InfoCard
                  label="Certificate"
                  value={results.tlsCheck.certificate_valid ? "Valid" : "Invalid"}
                  color={results.tlsCheck.certificate_valid ? "text-success" : "text-error"}
                  subtext={results.tlsCheck.certificate_subject}
                />
                <InfoCard
                  label="Expiry"
                  value={results.tlsCheck.certificate_expiry
                    ? new Date(results.tlsCheck.certificate_expiry).toLocaleDateString()
                    : "Unknown"}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Protocol security steps */}
      {secSteps.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2">
            Protocol Security Checks
          </h4>
          <div className="space-y-2">
            {secSteps.map((step, idx) => (
              <DiagRow
                key={idx}
                status={step.status === "skip" ? "idle" : step.status}
                label={step.name}
                durationMs={step.durationMs}
                detail={[step.message, step.detail].filter(Boolean).join("\n")}
              />
            ))}
          </div>
        </div>
      )}

      {/* Leakage detection */}
      {results.leakageDetection && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2">
            Proxy / VPN Leak Check
          </h4>
          <DiagRow
            status={results.leakageDetection.overall_status === "secure" ? "pass" : results.leakageDetection.overall_status === "leak_detected" ? "fail" : "warn"}
            label={results.leakageDetection.overall_status === "secure"
              ? "No leaks detected"
              : results.leakageDetection.overall_status === "leak_detected"
                ? "Leak detected!"
                : "Potential leak"}
            detail={[
              results.leakageDetection.detected_public_ip ? `Public IP: ${results.leakageDetection.detected_public_ip}` : null,
              results.leakageDetection.dns_leak_detected ? "DNS Leak: Detected" : null,
              results.leakageDetection.ip_mismatch_detected ? "IP Mismatch: Detected" : null,
              results.leakageDetection.dns_servers_detected.length > 0 ? `DNS Servers: ${results.leakageDetection.dns_servers_detected.join(", ")}` : null,
              ...results.leakageDetection.notes,
            ].filter(Boolean).join("\n") || null}
          />
        </div>
      )}

      {/* Placeholder when nothing */}
      {!results.tlsCheck && secSteps.length === 0 && !results.leakageDetection && !protocolDiagRunning && (
        <div className="text-xs text-[var(--color-textSecondary)] p-4 text-center">
          No certificate or security data available. TLS checks run automatically for HTTPS and common TLS ports.
        </div>
      )}

      {protocolDiagRunning && !results.tlsCheck && secSteps.length === 0 && (
        <div className="flex items-center gap-2 p-3 text-xs text-primary">
          <Loader2 size={14} className="animate-spin" />
          Running security checks...
        </div>
      )}
    </div>
  );
}

/* ── Performance panel ─────────────────────────────────────────── */

function PerformancePanel({ mgr }: { mgr: DiagnosticsMgr }) {
  const { results, avgPingTime, pingSuccessRate, jitter, maxPing, minPing, isRunning } = mgr;

  return (
    <div className="space-y-4">
      {/* Ping results */}
      <div>
        <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2 flex items-center gap-2">
          <Activity size={12} />
          Latency (ICMP Ping)
          {results.pings.length > 0 && (
            <span className="ml-auto font-normal normal-case text-[var(--color-textMuted)]">
              {results.pings.filter(p => p.success).length}/{results.pings.length}
            </span>
          )}
        </h4>

        {results.pings.length >= 2 && (
          <>
            <PingGraph results={results} avgPingTime={avgPingTime} maxPing={maxPing} minPing={minPing} />
            <PingStatsGrid pingSuccessRate={pingSuccessRate} avgPingTime={avgPingTime} jitter={jitter} results={results} />
          </>
        )}

        <div className="flex gap-1.5">
          {results.pings.map((ping, i) => (
            <div
              key={i}
              className={`flex-1 p-1.5 rounded text-center text-[10px] font-medium tabular-nums ${
                ping.success
                  ? "bg-success/15 text-success border border-success/30"
                  : "bg-error/15 text-error border border-error/30"
              }`}
            >
              {ping.success && ping.time_ms ? `${ping.time_ms}` : "X"}
            </div>
          ))}
          {Array(Math.max(0, 10 - results.pings.length)).fill(0).map((_, i) => (
            <div key={`e-${i}`} className="flex-1 p-1.5 rounded text-center text-[10px] bg-[var(--color-surface)] text-[var(--color-textMuted)] border border-[var(--color-border)]">
              -
            </div>
          ))}
        </div>
      </div>

      {/* TCP Timing */}
      {(results.tcpTiming || isRunning) && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2">
            TCP Connection Timing
          </h4>
          {results.tcpTiming ? (
            <div className="grid grid-cols-3 gap-2">
              <InfoCard
                label="Connect"
                value={`${results.tcpTiming.connect_time_ms}ms`}
                color={results.tcpTiming.slow_connection ? "text-warning" : "text-success"}
              />
              {results.tcpTiming.syn_ack_time_ms !== undefined && (
                <InfoCard label="SYN-ACK" value={`${results.tcpTiming.syn_ack_time_ms}ms`} />
              )}
              <InfoCard
                label="Total"
                value={`${results.tcpTiming.total_time_ms}ms`}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 text-xs text-[var(--color-textSecondary)]">
              <Loader2 size={14} className="animate-spin" /> Measuring...
            </div>
          )}
          {results.tcpTiming?.slow_connection && (
            <div className="mt-2 p-2 bg-warning/10 border border-warning/30 rounded text-xs text-warning">
              Slow TCP connection detected. This may indicate network congestion or high latency.
            </div>
          )}
        </div>
      )}

      {/* Jitter summary */}
      {avgPingTime > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <InfoCard label="Avg Latency" value={`${avgPingTime.toFixed(1)}ms`} />
          <InfoCard label="Jitter" value={jitter > 0 ? `+/-${jitter.toFixed(1)}ms` : "-"} color={jitter > 20 ? "text-warning" : undefined} />
          <InfoCard label="Packet Loss" value={`${(100 - pingSuccessRate).toFixed(0)}%`} color={pingSuccessRate < 80 ? "text-error" : pingSuccessRate < 95 ? "text-warning" : "text-success"} />
        </div>
      )}

      {/* Asymmetric routing */}
      {results.asymmetricRouting && (
        <DiagRow
          status={results.asymmetricRouting.asymmetry_detected ? "warn" : "pass"}
          label={results.asymmetricRouting.asymmetry_detected
            ? "Asymmetric routing detected"
            : "Symmetric routing path"}
          detail={[
            `Confidence: ${results.asymmetricRouting.confidence}`,
            `Path Stability: ${results.asymmetricRouting.path_stability}`,
            results.asymmetricRouting.latency_variance !== undefined ? `Latency Variance: +/-${results.asymmetricRouting.latency_variance.toFixed(2)}ms` : null,
            results.asymmetricRouting.ttl_analysis.received_ttl ? `TTL: ${results.asymmetricRouting.ttl_analysis.received_ttl}${results.asymmetricRouting.ttl_analysis.estimated_hops ? ` (~${results.asymmetricRouting.ttl_analysis.estimated_hops} hops)` : ""}` : null,
            ...results.asymmetricRouting.notes,
          ].filter(Boolean).join("\n")}
        />
      )}
    </div>
  );
}

/* ── Configuration panel ───────────────────────────────────────── */

function ConfigurationPanel({ mgr, connection }: { mgr: DiagnosticsMgr; connection: Connection }) {
  const { results } = mgr;
  const proto = connection.protocol.toLowerCase();

  return (
    <div className="space-y-4">
      {/* Effective connection settings */}
      <div>
        <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2 flex items-center gap-2">
          <Settings size={12} />
          Effective Connection Settings
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <InfoCard label="Protocol" value={connection.protocol.toUpperCase()} />
          <InfoCard label="Hostname" value={connection.hostname} />
          <InfoCard label="Port" value={String(connection.port || "default")} />
          <InfoCard label="Username" value={connection.username || "(not set)"} color={connection.username ? undefined : "text-[var(--color-textMuted)]"} />
          {connection.domain && <InfoCard label="Domain" value={connection.domain} />}
          {connection.timeout && <InfoCard label="Timeout" value={`${connection.timeout}s`} />}
        </div>
      </div>

      {/* Protocol-specific config */}
      {proto === "rdp" && connection.rdpSettings && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2">
            RDP Settings
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {connection.rdpSettings.display && (
              <>
                <InfoCard label="Resolution" value={`${connection.rdpSettings.display.width || "auto"}x${connection.rdpSettings.display.height || "auto"}`} />
                <InfoCard label="Color Depth" value={`${connection.rdpSettings.display.colorDepth || 32}-bit`} />
              </>
            )}
            {connection.rdpSettings.security && (
              <>
                <InfoCard label="NLA" value={connection.rdpSettings.security.enableNla ? "Enabled" : "Disabled"} color={connection.rdpSettings.security.enableNla ? "text-success" : "text-warning"} />
                <InfoCard label="CredSSP" value={connection.rdpSettings.security.useCredSsp ? "Enabled" : "Disabled"} />
                <InfoCard label="TLS" value={connection.rdpSettings.security.enableTls ? "Enabled" : "Disabled"} />
              </>
            )}
            {connection.rdpSettings.gateway?.enabled && (
              <InfoCard label="Gateway" value={connection.rdpSettings.gateway.hostname || "Configured"} />
            )}
            {connection.rdpSettings.performance?.codecs && (
              <InfoCard
                label="Codecs"
                value={[
                  connection.rdpSettings.performance.codecs.remoteFx ? "RemoteFX" : null,
                  connection.rdpSettings.performance.codecs.enableGfx ? "H.264" : null,
                ].filter(Boolean).join(", ") || "None"}
              />
            )}
          </div>
        </div>
      )}

      {proto === "ssh" && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2">
            SSH Settings
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <InfoCard label="Auth Type" value={connection.privateKey ? "Public Key" : "Password"} />
            <InfoCard label="Keep-Alive" value={connection.sshKeepAliveInterval ? `${connection.sshKeepAliveInterval}s` : "Default"} />
            {connection.sshConnectionConfigOverride && (
              <InfoCard label="Config Override" value="Active" color="text-primary" />
            )}
          </div>
        </div>
      )}

      {proto === "winrm" && connection.winrmSettings && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2">
            WinRM Settings
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <InfoCard label="HTTP Port" value={String(connection.winrmSettings.httpPort || 5985)} />
            <InfoCard label="HTTPS Port" value={String(connection.winrmSettings.httpsPort || 5986)} />
            <InfoCard label="Auth Method" value={connection.winrmSettings.authMethod || "negotiate"} />
            <InfoCard label="SSL" value={connection.winrmSettings.preferSsl ? "Preferred" : "Optional"} />
          </div>
        </div>
      )}

      {/* IP Geolocation */}
      {results.ipGeoInfo && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2 flex items-center gap-2">
            <MapPin size={12} />
            IP Geolocation
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <InfoCard label="IP" value={results.ipGeoInfo.ip} />
            <InfoCard
              label="Location"
              value={[results.ipGeoInfo.city, results.ipGeoInfo.region, results.ipGeoInfo.country].filter(Boolean).join(", ") || "Unknown"}
            />
            {results.ipGeoInfo.asn && (
              <InfoCard label="ASN" value={`AS${results.ipGeoInfo.asn}`} subtext={results.ipGeoInfo.asn_org} />
            )}
            {results.ipGeoInfo.isp && (
              <InfoCard label="ISP" value={results.ipGeoInfo.isp} />
            )}
          </div>
          {results.ipGeoInfo.is_datacenter && (
            <div className="mt-2 p-2 bg-warning/10 border border-warning/30 rounded text-xs text-warning">
              This IP belongs to a datacenter / hosting provider.
            </div>
          )}
        </div>
      )}

      {/* UDP probe */}
      {results.udpProbe && (
        <DiagRow
          status={results.udpProbe.response_received ? "pass" : "warn"}
          label={`UDP port ${results.udpProbe.port}: ${results.udpProbe.response_received ? "Response received" : results.udpProbe.response_type === "icmp_unreachable" ? "Port closed" : "No response (filtered?)"}`}
          durationMs={results.udpProbe.latency_ms}
          detail={results.udpProbe.response_data ? `Response: ${results.udpProbe.response_data}` : null}
        />
      )}

      {/* Security chain info */}
      {connection.security?.tunnelChain && connection.security.tunnelChain.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-[var(--color-textSecondary)] mb-2">
            Tunnel Chain
          </h4>
          <div className="space-y-1">
            {connection.security.tunnelChain.map((layer, i) => (
              <div key={layer.id} className="flex items-center gap-2 p-2 bg-[var(--color-surface)] rounded border border-[var(--color-border)] text-xs">
                <span className="text-[var(--color-textMuted)] tabular-nums">{i + 1}.</span>
                <span className="font-medium text-[var(--color-text)]">{layer.name || layer.type}</span>
                <span className={`ml-auto text-[10px] ${layer.enabled ? "text-success" : "text-[var(--color-textMuted)]"}`}>
                  {layer.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────── */

export const ConnectionDiagnostics: React.FC<ConnectionDiagnosticsProps> = ({
  connection,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useConnectionDiagnostics(connection);
  const [activeCategory, setActiveCategory] = useState<CategoryId>("network");
  const statuses = useCategoryStatuses(mgr, connection);

  const categories: CategoryDef[] = [
    { id: "network", label: t("diagnostics.cat.network", "Network"), icon: <Globe size={14} /> },
    { id: "protocol", label: t("diagnostics.cat.protocol", "Protocol"), icon: <Microscope size={14} /> },
    { id: "authentication", label: t("diagnostics.cat.auth", "Authentication"), icon: <Shield size={14} /> },
    { id: "certificate", label: t("diagnostics.cat.certificate", "Certificate / Security"), icon: <Shield size={14} /> },
    { id: "performance", label: t("diagnostics.cat.performance", "Performance"), icon: <Gauge size={14} /> },
    { id: "configuration", label: t("diagnostics.cat.config", "Configuration"), icon: <Settings size={14} /> },
  ];

  const renderPanel = () => {
    switch (activeCategory) {
      case "network":
        return <NetworkPanel mgr={mgr} connection={connection} />;
      case "protocol":
        return <ProtocolPanel mgr={mgr} connection={connection} />;
      case "authentication":
        return <AuthenticationPanel mgr={mgr} connection={connection} />;
      case "certificate":
        return <CertificatePanel mgr={mgr} connection={connection} />;
      case "performance":
        return <PerformancePanel mgr={mgr} />;
      case "configuration":
        return <ConfigurationPanel mgr={mgr} connection={connection} />;
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      backdropClassName="bg-black/50 backdrop-blur-sm"
      panelClassName="relative max-w-[1200px] rounded-xl overflow-hidden border border-[var(--color-border)]"
      contentClassName="relative bg-[var(--color-surface)]"
    >
      <div className="flex flex-col" style={{ height: "min(82vh, 800px)" }}>
        {/* ── Header ────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-[var(--color-border)] px-5 py-3 flex items-center gap-3 bg-[var(--color-surface)]">
          <div className="p-1.5 bg-primary/20 rounded-lg">
            <Stethoscope size={16} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[var(--color-text)] truncate">
                {connection.name}
              </h2>
              <ProtocolBadge protocol={connection.protocol} />
            </div>
            <p className="text-[11px] text-[var(--color-textSecondary)] truncate">
              {connection.hostname}:{connection.port || "default"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {mgr.isRunning && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-md text-[10px] font-medium mr-1">
                <Loader2 size={10} className="animate-spin" />
                <span className="max-w-[140px] truncate">{mgr.currentStep}</span>
              </div>
            )}
            <button
              onClick={mgr.runDiagnostics}
              disabled={mgr.isRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
              title="Run All Diagnostics"
            >
              {mgr.isRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              Run All
            </button>
            <button
              onClick={mgr.copyDiagnosticsToClipboard}
              className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] transition-colors"
              title="Copy diagnostics"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] transition-colors"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── Body: sidebar + content ──────────────────────────── */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-[220px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 overflow-y-auto">
            <nav className="py-2">
              {categories.map((cat) => {
                const isActive = activeCategory === cat.id;
                const status = statuses[cat.id];
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary border-r-2 border-primary"
                        : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    <span className={isActive ? "text-primary" : "text-[var(--color-textMuted)]"}>
                      {cat.icon}
                    </span>
                    <span className="flex-1 text-xs font-medium truncate">
                      {cat.label}
                    </span>
                    <CategoryStatusIcon status={status} size={14} />
                  </button>
                );
              })}
            </nav>

            {/* Overall summary in sidebar footer */}
            {mgr.protocolReport && (
              <div className="mx-3 mt-2 mb-3 p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1">Summary</div>
                <div className="text-[10px] text-[var(--color-textSecondary)] leading-relaxed line-clamp-3">
                  {mgr.protocolReport.summary}
                </div>
                <div className="text-[10px] text-[var(--color-textMuted)] mt-1 tabular-nums">
                  {mgr.protocolReport.totalDurationMs}ms total
                </div>
              </div>
            )}
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto p-5">
            <div className="max-w-[800px]">
              {renderPanel()}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
