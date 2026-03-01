import React from "react";
import {
  X,
  RefreshCw,
  Globe,
  Router,
  Network,
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Stethoscope,
  Server,
  Tags,
  Copy,
  MapPin,
  GitBranch,
  Radio,
  Shield,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Info,
  Microscope,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Connection } from "../types/connection";
import { Modal } from "./ui/Modal";
import {
  useConnectionDiagnostics,
  DiagnosticsMgr,
} from "../hooks/connection/useConnectionDiagnostics";
import { DiagnosticResults } from "../types/diagnostics";

/* ── Props ─────────────────────────────────────────────────────── */

interface ConnectionDiagnosticsProps {
  connection: Connection;
  onClose: () => void;
}

/* ── Tiny helpers ──────────────────────────────────────────────── */

const StatusIcon = ({
  status,
}: {
  status: "pending" | "success" | "failed";
}) => {
  switch (status) {
    case "pending":
      return (
        <Loader2
          size={16}
          className="text-[var(--color-textMuted)] animate-spin"
        />
      );
    case "success":
      return <CheckCircle size={16} className="text-green-500" />;
    case "failed":
      return <XCircle size={16} className="text-red-500" />;
  }
};

/* ── Network Checks Section ───────────────────────────────────── */

const NetworkChecksSection = ({ mgr }: { mgr: DiagnosticsMgr }) => {
  const { t } = useTranslation();
  const { results } = mgr;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
        <Globe size={12} />
        {t("diagnostics.networkChecks", "Network Checks")}
      </h3>
      <div className="grid grid-cols-3 gap-3">
        {(
          [
            ["internetCheck", "Internet"],
            ["gatewayCheck", "Gateway"],
            ["subnetCheck", "Target Host"],
          ] as const
        ).map(([key, label]) => (
          <div
            key={key}
            className="flex items-center gap-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]"
          >
            <StatusIcon status={results[key]} />
            <div>
              <div className="text-xs font-medium text-[var(--color-text)]">
                {t(`diagnostics.${key}`, label)}
              </div>
              <div className="text-[10px] text-[var(--color-textMuted)] capitalize">
                {results[key]}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── DNS & IP Info Section ────────────────────────────────────── */

const DnsIpSection = ({ mgr }: { mgr: DiagnosticsMgr }) => {
  const { t } = useTranslation();
  const { results, isRunning } = mgr;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
        <Tags size={12} />
        {t("diagnostics.dnsIp", "DNS & IP Info")}
      </h3>

      {results.dnsResult ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1">
              DNS Resolution
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon
                status={results.dnsResult.success ? "success" : "failed"}
              />
              <span className="text-xs text-[var(--color-text)]">
                {results.dnsResult.success
                  ? results.dnsResult.resolved_ips.join(", ")
                  : results.dnsResult.error || "Failed"}
              </span>
            </div>
            {results.dnsResult.reverse_dns && (
              <div
                className="text-[10px] text-[var(--color-textMuted)] mt-1 truncate"
                title={results.dnsResult.reverse_dns}
              >
                rDNS: {results.dnsResult.reverse_dns}
              </div>
            )}
            <div className="text-[10px] text-[var(--color-textMuted)] mt-1">
              {results.dnsResult.resolution_time_ms}ms
            </div>
          </div>

          {results.ipClassification && (
            <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
              <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1">
                IP Classification
              </div>
              <div className="text-xs text-[var(--color-text)] font-medium">
                {results.ipClassification.ip_type}
                {results.ipClassification.ip_class &&
                  ` (${results.ipClassification.ip_class})`}
              </div>
              <div className="text-[10px] text-[var(--color-textMuted)] mt-1">
                {results.ipClassification.ip}
                {results.ipClassification.is_ipv6 && " (IPv6)"}
              </div>
              {results.ipClassification.network_info && (
                <div
                  className="text-[10px] text-[var(--color-textMuted)] truncate"
                  title={results.ipClassification.network_info}
                >
                  {results.ipClassification.network_info}
                </div>
              )}
            </div>
          )}
        </div>
      ) : isRunning ? (
        <div className="flex items-center justify-center p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          <Loader2
            size={20}
            className="text-[var(--color-textMuted)] animate-spin"
          />
        </div>
      ) : (
        <div className="text-center text-[var(--color-textSecondary)] py-4">
          {t(
            "diagnostics.dnsUnavailable",
            "DNS information not available",
          )}
        </div>
      )}
    </div>
  );
};

/* ── Ping Results Section (with SVG graph) ────────────────────── */

const PingResultsSection = ({ mgr }: { mgr: DiagnosticsMgr }) => {
  const { t } = useTranslation();
  const {
    results,
    avgPingTime,
    pingSuccessRate,
    jitter,
    maxPing,
    minPing,
  } = mgr;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
        <Activity size={12} />
        {t("diagnostics.pingResults", "Ping Results")}
        {results.pings.length > 0 && (
          <span className="ml-auto text-[var(--color-textMuted)] font-normal normal-case">
            {results.pings.filter((p) => p.success).length}/
            {results.pings.length} OK
          </span>
        )}
      </h3>

      {results.pings.length >= 2 && (
        <>
          <PingGraph
            results={results}
            avgPingTime={avgPingTime}
            maxPing={maxPing}
            minPing={minPing}
          />
          <PingStatsGrid
            pingSuccessRate={pingSuccessRate}
            avgPingTime={avgPingTime}
            jitter={jitter}
            results={results}
          />
        </>
      )}

      <div className="flex gap-1.5">
        {results.pings.map((ping, i) => (
          <div
            key={i}
            className={`flex-1 p-2 rounded text-center text-xs font-medium ${
              ping.success
                ? "bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30"
                : "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30"
            }`}
          >
            {ping.success && ping.time_ms
              ? `${ping.time_ms}ms`
              : "Timeout"}
          </div>
        ))}
        {Array(Math.max(0, 10 - results.pings.length))
          .fill(0)
          .map((_, i) => (
            <div
              key={`empty-${i}`}
              className="flex-1 p-2 rounded text-center text-xs bg-[var(--color-surface)] text-[var(--color-textMuted)] border border-[var(--color-border)]"
            >
              -
            </div>
          ))}
      </div>
    </div>
  );
};

/* ── Ping SVG Graph Sub-component ─────────────────────────────── */

const PingGraph = ({
  results,
  avgPingTime,
  maxPing,
  minPing,
}: {
  results: DiagnosticResults;
  avgPingTime: number;
  maxPing: number;
  minPing: number;
}) => {
  const graphWidth = 400;
  const graphHeight = 100;
  const padding = 5;
  const graphMax = Math.max(maxPing * 1.2, 10);
  const graphMin = Math.max(0, minPing * 0.8);
  const range = graphMax - graphMin || 1;
  const pointSpacing = graphWidth / Math.max(9, results.pings.length - 1);

  const points = results.pings.map((ping, i) => ({
    x: i * pointSpacing,
    y: ping.success && ping.time_ms
      ? graphHeight -
        padding -
        ((ping.time_ms - graphMin) / range) * (graphHeight - padding * 2)
      : graphHeight - padding,
    ping,
  }));

  const avgY =
    graphHeight -
    padding -
    ((avgPingTime - graphMin) / range) * (graphHeight - padding * 2);

  const successPoints = points.filter((p) => p.ping.success);
  const linePath =
    successPoints.length >= 2
      ? successPoints
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
          .join(" ")
      : null;

  return (
    <div className="mb-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-3">
      <div className="relative" style={{ height: graphHeight + 10 }}>
        <svg
          viewBox={`-10 0 ${graphWidth + 20} ${graphHeight}`}
          className="w-full h-full"
          preserveAspectRatio="none"
        >
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((frac) => (
            <line
              key={frac}
              x1="0"
              y1={graphHeight * frac}
              x2={graphWidth}
              y2={graphHeight * frac}
              stroke="var(--color-border)"
              strokeWidth="1"
              opacity="0.3"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Average line */}
          {avgPingTime > 0 && (
            <line
              x1="0"
              y1={avgY}
              x2={graphWidth}
              y2={avgY}
              stroke="#3b82f6"
              strokeWidth="2"
              strokeDasharray="6,3"
              opacity="0.6"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Line path */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Points */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="5"
              fill={
                !p.ping.success
                  ? "#ef4444"
                  : p.ping.time_ms && p.ping.time_ms > avgPingTime * 1.5
                    ? "#eab308"
                    : "#22c55e"
              }
              stroke="var(--color-surface)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            >
              <title>
                {p.ping.success ? `${p.ping.time_ms}ms` : "Timeout"}
              </title>
            </circle>
          ))}

          {/* Placeholder points */}
          {Array(Math.max(0, 10 - results.pings.length))
            .fill(0)
            .map((_, i) => (
              <circle
                key={`empty-${i}`}
                cx={(results.pings.length + i) * pointSpacing}
                cy={graphHeight / 2}
                r="4"
                fill="var(--color-border)"
                opacity="0.3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
        </svg>

        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 bottom-0 w-7 flex flex-col justify-between text-[9px] text-[var(--color-textMuted)] pointer-events-none text-right pr-1">
          <span>{graphMax}ms</span>
          <span>{Math.round((graphMax + graphMin) / 2)}ms</span>
          <span>{graphMin}ms</span>
        </div>
      </div>
    </div>
  );
};

/* ── Ping Stats Grid ──────────────────────────────────────────── */

const PingStatsGrid = ({
  pingSuccessRate,
  avgPingTime,
  jitter,
  results,
}: {
  pingSuccessRate: number;
  avgPingTime: number;
  jitter: number;
  results: DiagnosticResults;
}) => {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
      {[
        {
          value: `${pingSuccessRate.toFixed(0)}%`,
          label: t("diagnostics.successRate", "Success Rate"),
        },
        {
          value: avgPingTime > 0 ? `${avgPingTime.toFixed(0)}ms` : "-",
          label: t("diagnostics.avgLatency", "Avg Latency"),
        },
        {
          value: jitter > 0 ? `±${jitter.toFixed(0)}ms` : "-",
          label: t("diagnostics.jitter", "Jitter"),
        },
        {
          value: String(results.pings.filter((p) => p.success).length),
          label: t("diagnostics.successful", "Successful"),
          color: "text-green-500",
        },
        {
          value: String(results.pings.filter((p) => !p.success).length),
          label: t("diagnostics.failed", "Failed"),
          color: "text-red-500",
        },
      ].map((stat) => (
        <div
          key={stat.label}
          className="text-center p-2.5 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]"
        >
          <div
            className={`text-xl font-bold ${stat.color || "text-[var(--color-text)]"}`}
          >
            {stat.value}
          </div>
          <div className="text-[10px] text-[var(--color-textMuted)] uppercase">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
};

/* ── Port Check Section ───────────────────────────────────────── */

const PortCheckSection = ({
  mgr,
  connection,
}: {
  mgr: DiagnosticsMgr;
  connection: Connection;
}) => {
  const { t } = useTranslation();
  const { results, isRunning } = mgr;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
        <Network size={12} />
        {t("diagnostics.portCheck", "Port Check")}
      </h3>

      {results.portCheck ? (
        <div
          className={`p-4 rounded-lg ${
            results.portCheck.open
              ? "bg-green-500/10 border border-green-500/30"
              : "bg-red-500/10 border border-red-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-medium text-[var(--color-text)]">
                {t("diagnostics.port", "Port")} {results.portCheck.port} (
                {connection.protocol.toUpperCase()})
              </div>
              <div className="text-sm text-[var(--color-textSecondary)]">
                {results.portCheck.open
                  ? t(
                      "diagnostics.portOpen",
                      "Port is open and accepting connections",
                    )
                  : t(
                      "diagnostics.portClosed",
                      "Port is closed or filtered",
                    )}
              </div>
            </div>
            <StatusIcon
              status={results.portCheck.open ? "success" : "failed"}
            />
          </div>
          {results.portCheck.banner && (
            <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
              <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1">
                Banner / Fingerprint
              </div>
              <code className="text-xs font-mono bg-[var(--color-surface)] px-2 py-1 rounded text-[var(--color-text)] block truncate">
                {results.portCheck.banner}
              </code>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          <Loader2
            size={20}
            className="text-[var(--color-textMuted)] animate-spin"
          />
        </div>
      )}
    </div>
  );
};

/* ── Traceroute Section ───────────────────────────────────────── */

const TracerouteSection = ({ mgr }: { mgr: DiagnosticsMgr }) => {
  const { t } = useTranslation();
  const { results, isRunning } = mgr;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
        <Router size={12} />
        {t("diagnostics.traceroute", "Traceroute")}
        {results.traceroute.length > 0 && (
          <span className="ml-auto text-[var(--color-textMuted)] font-normal normal-case">
            {results.traceroute.length}{" "}
            {results.traceroute.length === 1
              ? t("diagnostics.hop", "hop")
              : t("diagnostics.hops", "hops")}
          </span>
        )}
      </h3>

      {results.traceroute.length > 0 ? (
        <div className="space-y-0.5 max-h-52 overflow-y-auto font-mono text-xs">
          {results.traceroute.map((hop, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 p-2 rounded ${
                hop.timeout
                  ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                  : "bg-[var(--color-surface)] text-[var(--color-text)]"
              }`}
            >
              <span className="w-5 text-[var(--color-textMuted)] text-right">
                {hop.hop}
              </span>
              <span className="flex-1 truncate">
                {hop.timeout
                  ? "* * *"
                  : `${hop.hostname || hop.ip || "Unknown"}`}
              </span>
              {hop.ip && hop.ip !== hop.hostname && (
                <span className="text-[var(--color-textMuted)]">
                  ({hop.ip})
                </span>
              )}
              <span className="w-14 text-right text-[var(--color-textSecondary)]">
                {hop.time_ms ? `${hop.time_ms}ms` : "-"}
              </span>
            </div>
          ))}
        </div>
      ) : isRunning ? (
        <div className="flex items-center justify-center p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          <Loader2
            size={20}
            className="text-[var(--color-textMuted)] animate-spin"
          />
          <span className="ml-2 text-[var(--color-textSecondary)]">
            {t("diagnostics.runningTraceroute", "Running traceroute...")}
          </span>
        </div>
      ) : (
        <div className="text-center text-[var(--color-textSecondary)] py-4">
          {t(
            "diagnostics.tracerouteUnavailable",
            "Traceroute not available or no results",
          )}
        </div>
      )}
    </div>
  );
};

/* ── Advanced Diagnostics Section ─────────────────────────────── */

const AdvancedDiagnosticsSection = ({ mgr }: { mgr: DiagnosticsMgr }) => {
  const { t } = useTranslation();
  const { results, isRunning } = mgr;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)] rounded-lg p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] mb-3 flex items-center gap-2">
        <Stethoscope size={12} />
        {t("diagnostics.advancedDiagnostics", "Advanced Diagnostics")}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <TcpTimingCard results={results} isRunning={isRunning} />
        <IcmpStatusCard results={results} isRunning={isRunning} />
        <ServiceFingerprintCard results={results} isRunning={isRunning} />
        <MtuCheckCard results={results} isRunning={isRunning} />
      </div>

      {/* TLS Check */}
      {results.tlsCheck && <TlsCheckCard results={results} />}

      {/* Extended Diagnostics */}
      <ExtendedDiagnosticsCards results={results} isRunning={isRunning} />
    </div>
  );
};

/* ── TCP Timing Card ──────────────────────────────────────────── */

const TcpTimingCard = ({
  results,
  isRunning,
}: {
  results: DiagnosticResults;
  isRunning: boolean;
}) => {
  const { t } = useTranslation();

  return (
    <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
        {t("diagnostics.tcpTiming", "TCP Timing")}
      </div>
      {results.tcpTiming ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-textSecondary)]">
              Connect
            </span>
            <span
              className={`text-xs font-medium ${
                results.tcpTiming.slow_connection
                  ? "text-yellow-500"
                  : "text-green-500"
              }`}
            >
              {results.tcpTiming.connect_time_ms}ms
            </span>
          </div>
          {results.tcpTiming.slow_connection && (
            <div className="text-[10px] text-yellow-500">
              ⚠ {t("diagnostics.slowConnection", "Slow connection detected")}
            </div>
          )}
          {!results.tcpTiming.success && results.tcpTiming.error && (
            <div
              className="text-[10px] text-red-500 truncate"
              title={results.tcpTiming.error}
            >
              {results.tcpTiming.error}
            </div>
          )}
        </div>
      ) : isRunning ? (
        <Loader2
          size={14}
          className="text-[var(--color-textMuted)] animate-spin"
        />
      ) : (
        <span className="text-xs text-[var(--color-textMuted)]">-</span>
      )}
    </div>
  );
};

/* ── ICMP Status Card ─────────────────────────────────────────── */

const IcmpStatusCard = ({
  results,
  isRunning,
}: {
  results: DiagnosticResults;
  isRunning: boolean;
}) => {
  const { t } = useTranslation();

  return (
    <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
        {t("diagnostics.icmpStatus", "ICMP Status")}
      </div>
      {results.icmpBlockade ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {results.icmpBlockade.likely_blocked ? (
              <XCircle size={12} className="text-yellow-500" />
            ) : results.icmpBlockade.icmp_allowed ? (
              <CheckCircle size={12} className="text-green-500" />
            ) : (
              <XCircle size={12} className="text-red-500" />
            )}
            <span
              className={`text-xs ${
                results.icmpBlockade.likely_blocked
                  ? "text-yellow-500"
                  : results.icmpBlockade.icmp_allowed
                    ? "text-green-500"
                    : "text-red-500"
              }`}
            >
              {results.icmpBlockade.likely_blocked
                ? t("diagnostics.icmpBlocked", "ICMP Blocked")
                : results.icmpBlockade.icmp_allowed
                  ? t("diagnostics.icmpAllowed", "ICMP Allowed")
                  : t("diagnostics.unreachable", "Unreachable")}
            </span>
          </div>
          <div
            className="text-[10px] text-[var(--color-textMuted)] truncate"
            title={results.icmpBlockade.diagnosis}
          >
            {results.icmpBlockade.diagnosis}
          </div>
        </div>
      ) : isRunning ? (
        <Loader2
          size={14}
          className="text-[var(--color-textMuted)] animate-spin"
        />
      ) : (
        <span className="text-xs text-[var(--color-textMuted)]">-</span>
      )}
    </div>
  );
};

/* ── Service Fingerprint Card ─────────────────────────────────── */

const ServiceFingerprintCard = ({
  results,
  isRunning,
}: {
  results: DiagnosticResults;
  isRunning: boolean;
}) => {
  const { t } = useTranslation();

  return (
    <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
        {t("diagnostics.serviceFingerprint", "Service Fingerprint")}
      </div>
      {results.serviceFingerprint ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Server size={12} className="text-[var(--color-accent)]" />
            <span className="text-xs font-medium text-[var(--color-text)]">
              {results.serviceFingerprint.protocol_detected ||
                results.serviceFingerprint.service}
            </span>
          </div>
          {results.serviceFingerprint.version && (
            <div
              className="text-[10px] text-[var(--color-textSecondary)] truncate"
              title={results.serviceFingerprint.version}
            >
              {results.serviceFingerprint.version}
            </div>
          )}
          {results.serviceFingerprint.response_preview && (
            <code className="text-[9px] font-mono text-[var(--color-textMuted)] block truncate bg-[var(--color-surfaceHover)] px-1 py-0.5 rounded">
              {results.serviceFingerprint.response_preview}
            </code>
          )}
        </div>
      ) : isRunning ? (
        <Loader2
          size={14}
          className="text-[var(--color-textMuted)] animate-spin"
        />
      ) : (
        <span className="text-xs text-[var(--color-textMuted)]">-</span>
      )}
    </div>
  );
};

/* ── MTU Check Card ───────────────────────────────────────────── */

const MtuCheckCard = ({
  results,
  isRunning,
}: {
  results: DiagnosticResults;
  isRunning: boolean;
}) => {
  const { t } = useTranslation();

  return (
    <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
        {t("diagnostics.mtuCheck", "MTU Check")}
      </div>
      {results.mtuCheck ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-textSecondary)]">
              Path MTU
            </span>
            <span className="text-xs font-medium text-[var(--color-text)]">
              {results.mtuCheck.path_mtu
                ? `${results.mtuCheck.path_mtu}`
                : "Unknown"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-textSecondary)]">
              Recommended
            </span>
            <span className="text-xs font-medium text-[var(--color-text)]">
              {results.mtuCheck.recommended_mtu}
            </span>
          </div>
          {results.mtuCheck.fragmentation_needed && (
            <div className="text-[10px] text-yellow-500">
              ⚠{" "}
              {t(
                "diagnostics.fragmentationNeeded",
                "Fragmentation detected",
              )}
            </div>
          )}
        </div>
      ) : isRunning ? (
        <Loader2
          size={14}
          className="text-[var(--color-textMuted)] animate-spin"
        />
      ) : (
        <span className="text-xs text-[var(--color-textMuted)]">-</span>
      )}
    </div>
  );
};

/* ── TLS Check Card ───────────────────────────────────────────── */

const TlsCheckCard = ({ results }: { results: DiagnosticResults }) => {
  const { t } = useTranslation();
  if (!results.tlsCheck) return null;

  return (
    <div className="mt-3 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-2">
        {t("diagnostics.tlsCheck", "TLS / SSL Check")}
      </div>
      {results.tlsCheck.tls_supported ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle size={12} className="text-green-500" />
            <span className="text-xs text-green-500">
              {results.tlsCheck.tls_version || "TLS Supported"}
            </span>
            <span className="text-xs text-[var(--color-textMuted)]">
              ({results.tlsCheck.handshake_time_ms}ms)
            </span>
          </div>
          {results.tlsCheck.certificate_valid !== undefined && (
            <div className="flex items-center gap-2">
              {results.tlsCheck.certificate_valid ? (
                <CheckCircle size={10} className="text-green-500" />
              ) : (
                <XCircle size={10} className="text-yellow-500" />
              )}
              <span
                className={`text-[10px] ${
                  results.tlsCheck.certificate_valid
                    ? "text-green-500"
                    : "text-yellow-500"
                }`}
              >
                {results.tlsCheck.certificate_valid
                  ? t("diagnostics.certValid", "Certificate Valid")
                  : t(
                      "diagnostics.certInvalid",
                      "Certificate Invalid/Expired",
                    )}
              </span>
            </div>
          )}
          {results.tlsCheck.certificate_subject && (
            <div
              className="text-[10px] text-[var(--color-textSecondary)] truncate"
              title={results.tlsCheck.certificate_subject}
            >
              <span className="text-[var(--color-textMuted)]">Subject:</span>{" "}
              {results.tlsCheck.certificate_subject}
            </div>
          )}
          {results.tlsCheck.certificate_expiry && (
            <div className="text-[10px] text-[var(--color-textSecondary)]">
              <span className="text-[var(--color-textMuted)]">Expires:</span>{" "}
              {new Date(
                results.tlsCheck.certificate_expiry,
              ).toLocaleDateString()}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <XCircle size={12} className="text-red-500" />
          <span className="text-xs text-red-500">
            {results.tlsCheck.error ||
              t("diagnostics.tlsNotSupported", "TLS not supported")}
          </span>
        </div>
      )}
    </div>
  );
};

/* ── Extended Diagnostics Cards ───────────────────────────────── */

const ExtendedDiagnosticsCards = ({
  results,
  isRunning,
}: {
  results: DiagnosticResults;
  isRunning: boolean;
}) => {
  const { t } = useTranslation();

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-3 text-xs text-[var(--color-textSecondary)] uppercase font-medium">
        <Stethoscope size={14} />
        {t("diagnostics.extendedDiagnostics", "Extended Diagnostics")}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* IP Geolocation */}
        <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
            {t("diagnostics.ipGeo", "IP Geolocation")}
          </div>
          {results.ipGeoInfo ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <MapPin size={12} className="text-[var(--color-accent)]" />
                <span className="text-xs font-medium text-[var(--color-text)]">
                  {results.ipGeoInfo.city ||
                    results.ipGeoInfo.country ||
                    "Unknown"}
                  {results.ipGeoInfo.country_code &&
                    ` (${results.ipGeoInfo.country_code})`}
                </span>
              </div>
              {results.ipGeoInfo.asn && (
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  AS{results.ipGeoInfo.asn}{" "}
                  {results.ipGeoInfo.asn_org &&
                    `- ${results.ipGeoInfo.asn_org}`}
                </div>
              )}
              {results.ipGeoInfo.isp && (
                <div
                  className="text-[10px] text-[var(--color-textMuted)] truncate"
                  title={results.ipGeoInfo.isp}
                >
                  ISP: {results.ipGeoInfo.isp}
                </div>
              )}
              {results.ipGeoInfo.is_datacenter && (
                <div className="text-[10px] text-yellow-500">
                  ⚠ {t("diagnostics.datacenterIp", "Datacenter IP")}
                </div>
              )}
            </div>
          ) : isRunning ? (
            <Loader2
              size={14}
              className="text-[var(--color-textMuted)] animate-spin"
            />
          ) : (
            <span className="text-xs text-[var(--color-textMuted)]">-</span>
          )}
        </div>

        {/* Asymmetric Routing */}
        <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
          <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
            {t("diagnostics.asymmetricRouting", "Routing Analysis")}
          </div>
          {results.asymmetricRouting ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <GitBranch
                  size={12}
                  className={
                    results.asymmetricRouting.asymmetry_detected
                      ? "text-yellow-500"
                      : "text-green-500"
                  }
                />
                <span
                  className={`text-xs font-medium ${
                    results.asymmetricRouting.asymmetry_detected
                      ? "text-yellow-500"
                      : "text-green-500"
                  }`}
                >
                  {results.asymmetricRouting.asymmetry_detected
                    ? t(
                        "diagnostics.asymmetryDetected",
                        "Asymmetry Detected",
                      )
                    : t("diagnostics.symmetricPath", "Symmetric Path")}
                </span>
              </div>
              <div className="text-[10px] text-[var(--color-textSecondary)]">
                {t("diagnostics.confidence", "Confidence")}:{" "}
                {results.asymmetricRouting.confidence}
              </div>
              <div className="text-[10px] text-[var(--color-textMuted)]">
                {t("diagnostics.pathStability", "Stability")}:{" "}
                {results.asymmetricRouting.path_stability}
                {results.asymmetricRouting.latency_variance !== undefined &&
                  ` (±${results.asymmetricRouting.latency_variance.toFixed(1)}ms)`}
              </div>
              {results.asymmetricRouting.ttl_analysis.received_ttl && (
                <div className="text-[10px] text-[var(--color-textMuted)]">
                  TTL:{" "}
                  {results.asymmetricRouting.ttl_analysis.received_ttl}
                  {results.asymmetricRouting.ttl_analysis.estimated_hops &&
                    ` (~${results.asymmetricRouting.ttl_analysis.estimated_hops} hops)`}
                </div>
              )}
            </div>
          ) : isRunning ? (
            <Loader2
              size={14}
              className="text-[var(--color-textMuted)] animate-spin"
            />
          ) : (
            <span className="text-xs text-[var(--color-textMuted)]">-</span>
          )}
        </div>

        {/* UDP Probe */}
        {results.udpProbe && (
          <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
              {t("diagnostics.udpProbe", "UDP Probe")}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Radio
                  size={12}
                  className={
                    results.udpProbe.response_received
                      ? "text-green-500"
                      : "text-yellow-500"
                  }
                />
                <span
                  className={`text-xs font-medium ${
                    results.udpProbe.response_received
                      ? "text-green-500"
                      : "text-yellow-500"
                  }`}
                >
                  {results.udpProbe.response_received
                    ? t(
                        "diagnostics.responseReceived",
                        "Response Received",
                      )
                    : results.udpProbe.response_type === "icmp_unreachable"
                      ? t("diagnostics.portClosed", "Port Closed")
                      : t(
                          "diagnostics.noResponse",
                          "No Response (Filtered?)",
                        )}
                </span>
              </div>
              <div className="text-[10px] text-[var(--color-textSecondary)]">
                Port: {results.udpProbe.port}
              </div>
              {results.udpProbe.latency_ms && (
                <div className="text-[10px] text-[var(--color-textMuted)]">
                  Latency: {results.udpProbe.latency_ms}ms
                </div>
              )}
              {results.udpProbe.response_data && (
                <code className="text-[9px] font-mono text-[var(--color-textMuted)] block truncate bg-[var(--color-surfaceHover)] px-1 py-0.5 rounded">
                  {results.udpProbe.response_data.substring(0, 32)}...
                </code>
              )}
            </div>
          </div>
        )}

        {/* Leakage Detection */}
        {results.leakageDetection && (
          <div className="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div className="text-[10px] uppercase text-[var(--color-textMuted)] mb-1.5">
              {t("diagnostics.leakageDetection", "Proxy/VPN Leak Check")}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Shield
                  size={12}
                  className={
                    results.leakageDetection.overall_status === "secure"
                      ? "text-green-500"
                      : results.leakageDetection.overall_status ===
                          "leak_detected"
                        ? "text-red-500"
                        : "text-yellow-500"
                  }
                />
                <span
                  className={`text-xs font-medium ${
                    results.leakageDetection.overall_status === "secure"
                      ? "text-green-500"
                      : results.leakageDetection.overall_status ===
                          "leak_detected"
                        ? "text-red-500"
                        : "text-yellow-500"
                  }`}
                >
                  {results.leakageDetection.overall_status === "secure"
                    ? t("diagnostics.noLeaks", "No Leaks Detected")
                    : results.leakageDetection.overall_status ===
                        "leak_detected"
                      ? t("diagnostics.leakDetected", "Leak Detected!")
                      : t("diagnostics.potentialLeak", "Potential Leak")}
                </span>
              </div>
              {results.leakageDetection.detected_public_ip && (
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  Public IP: {results.leakageDetection.detected_public_ip}
                </div>
              )}
              {results.leakageDetection.dns_leak_detected && (
                <div className="text-[10px] text-red-500">
                  ⚠ {t("diagnostics.dnsLeak", "DNS Leak Detected")}
                </div>
              )}
              {results.leakageDetection.ip_mismatch_detected && (
                <div className="text-[10px] text-red-500">
                  ⚠ {t("diagnostics.ipMismatch", "IP Mismatch")}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ── Protocol Deep Diagnostics Section ────────────────────────── */

const ProtocolDeepDiagSection = ({
  mgr,
  connection,
}: {
  mgr: DiagnosticsMgr;
  connection: Connection;
}) => {
  const {
    protocolReport,
    protocolDiagRunning,
    protocolDiagError,
    expandedProtoStep,
    setExpandedProtoStep,
  } = mgr;

  if (!protocolReport && !protocolDiagRunning && !protocolDiagError)
    return null;

  return (
    <div className="bg-[var(--color-surfaceHover)]/50 border border-purple-500/30 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-purple-950/20 border-b border-purple-500/20">
        <Microscope size={14} className="text-purple-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-purple-300">
          {connection.protocol.toUpperCase()} Deep Diagnostics
        </h3>
        {protocolReport && (
          <span className="ml-auto text-[10px] text-[var(--color-textSecondary)]">
            {protocolReport.protocol.toUpperCase()}{" "}
            {protocolReport.resolvedIp &&
              `${protocolReport.host} → ${protocolReport.resolvedIp}:${protocolReport.port}`}
            {protocolReport.totalDurationMs > 0 &&
              ` (${protocolReport.totalDurationMs}ms)`}
          </span>
        )}
      </div>

      {protocolDiagRunning && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-purple-400">
          <Loader2 size={14} className="animate-spin" />
          Running {connection.protocol.toUpperCase()} diagnostics…
        </div>
      )}

      {protocolDiagError && (
        <div className="px-4 py-3 text-sm text-red-400">
          Diagnostics failed: {protocolDiagError}
        </div>
      )}

      {protocolReport && (
        <div className="divide-y divide-[var(--color-border)]/40">
          {protocolReport.steps.map((step, idx) => {
            const isExpanded = expandedProtoStep === idx;
            const stepIcon =
              step.status === "pass" ? (
                <CheckCircle size={14} className="text-green-400" />
              ) : step.status === "fail" ? (
                <XCircle size={14} className="text-red-400" />
              ) : step.status === "warn" ? (
                <AlertCircle size={14} className="text-yellow-400" />
              ) : step.status === "info" ? (
                <Info size={14} className="text-blue-400" />
              ) : (
                <Activity size={14} className="text-gray-500" />
              );

            return (
              <div key={idx}>
                <button
                  onClick={() =>
                    setExpandedProtoStep((p) => (p === idx ? null : idx))
                  }
                  className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-[var(--color-surfaceHover)] transition-colors"
                >
                  {stepIcon}
                  <span className="flex-1 text-xs text-[var(--color-text)]">
                    {step.name}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-[var(--color-textSecondary)]">
                    <Clock size={10} />
                    {step.durationMs}ms
                  </span>
                  {step.detail &&
                    (isExpanded ? (
                      <ChevronUp
                        size={12}
                        className="text-[var(--color-textMuted)]"
                      />
                    ) : (
                      <ChevronDown
                        size={12}
                        className="text-[var(--color-textMuted)]"
                      />
                    ))}
                </button>
                <div className="px-4 pb-1 -mt-0.5 pl-10">
                  <p
                    className={`text-[10px] ${
                      step.status === "fail"
                        ? "text-red-400"
                        : step.status === "warn"
                          ? "text-yellow-400"
                          : step.status === "info"
                            ? "text-blue-400"
                            : "text-[var(--color-textSecondary)]"
                    }`}
                  >
                    {step.message}
                  </p>
                </div>
                {isExpanded && step.detail && (
                  <div className="px-4 pb-2 pl-10">
                    <pre className="text-[10px] text-[var(--color-textSecondary)] whitespace-pre-wrap bg-[var(--color-surface)] border border-[var(--color-border)] rounded p-2 mt-1">
                      {step.detail}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}

          {/* Summary */}
          <div className="px-4 py-3 space-y-2">
            <p className="text-xs text-[var(--color-text)]">
              <span className="font-semibold text-[var(--color-textSecondary)]">
                Summary:{" "}
              </span>
              {protocolReport.summary}
            </p>
            {protocolReport.rootCauseHint && (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-950/20 p-3">
                <h4 className="text-[10px] font-semibold text-yellow-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <AlertCircle size={10} />
                  Root Cause Analysis
                </h4>
                <pre className="text-[10px] text-yellow-200/80 whitespace-pre-wrap leading-relaxed">
                  {protocolReport.rootCauseHint}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Root Component ───────────────────────────────────────────── */

export const ConnectionDiagnostics: React.FC<ConnectionDiagnosticsProps> = ({
  connection,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useConnectionDiagnostics(connection);

  return (
    <Modal
      isOpen
      onClose={onClose}
      backdropClassName="bg-black/50 backdrop-blur-sm"
      panelClassName="relative max-w-3xl rounded-xl overflow-hidden border border-[var(--color-border)]"
      contentClassName="relative bg-[var(--color-surface)]"
    >
      <div className="relative flex flex-1 min-h-0 flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Stethoscope size={18} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                {t(
                  "diagnostics.title",
                  "Connection Diagnostics",
                )}
              </h2>
              <p className="text-xs text-[var(--color-textSecondary)]">
                {connection.name} (<span>{connection.hostname}</span>)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mgr.isRunning && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded-lg text-xs">
                <Loader2 size={12} className="animate-spin" />
                {mgr.currentStep}
              </div>
            )}
            <button
              onClick={mgr.copyDiagnosticsToClipboard}
              className="p-2 rounded-lg hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] transition-colors"
              title={t("diagnostics.copyAll", "Copy diagnostics")}
            >
              <Copy size={16} />
            </button>
            <button
              onClick={mgr.runDiagnostics}
              disabled={mgr.isRunning}
              className="p-2 rounded-lg hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] transition-colors disabled:opacity-30"
              title={t("diagnostics.rerun", "Run Again")}
            >
              <RefreshCw
                size={16}
                className={mgr.isRunning ? "animate-spin" : ""}
              />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
              title={t("common.close", "Close")}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <NetworkChecksSection mgr={mgr} />
          <DnsIpSection mgr={mgr} />
          <PingResultsSection mgr={mgr} />
          <PortCheckSection mgr={mgr} connection={connection} />
          <TracerouteSection mgr={mgr} />
          <AdvancedDiagnosticsSection mgr={mgr} />
          <ProtocolDeepDiagSection mgr={mgr} connection={connection} />
        </div>
      </div>
    </Modal>
  );
};
