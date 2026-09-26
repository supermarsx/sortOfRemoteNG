import { Activity, Clock3, LoaderCircle } from "lucide-react";
import type { useNetworkDiscovery } from "../../hooks/network/useNetworkDiscovery";

type Manager = ReturnType<typeof useNetworkDiscovery>;
const duration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function DiscoveryScanProgress({ mgr }: { mgr: Manager }) {
  if (!mgr.hasScanned) return null;
  const status = mgr.scanStatus;
  const tcpTimeout = Math.ceil(mgr.config.timeout / 1000);
  const maxProbeSeconds = Math.max(
    tcpTimeout +
      2 +
      (mgr.config.identifyServices ? Math.min(tcpTimeout, 5) : 0),
    mgr.config.pingMethod && mgr.config.pingMethod !== "none"
      ? Math.ceil((mgr.config.pingTimeout ?? 1000) / 1000)
      : 0,
  );
  const phase = mgr.isStopping
    ? "Stopping — waiting for active probes"
    : mgr.scanOutcome === "failed"
      ? "Scan failed"
      : mgr.scanOutcome === "stopped"
        ? "Scan stopped"
        : mgr.scanOutcome === "complete"
          ? "Scan complete"
          : {
              preparing: "Preparing scan",
              discovering: "Checking host reachability",
              scanning: "Checking TCP ports",
              identifying: "Probing and identifying service",
              complete: "Finishing scan",
            }[status?.phase ?? "preparing"];
  const percentage = Math.max(0, Math.min(100, Math.round(mgr.scanProgress)));
  return (
    <section
      aria-label="Scan progress"
      className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          role="status"
          className="flex items-center gap-2 text-sm font-medium"
        >
          {mgr.isScanning ? (
            <LoaderCircle size={16} className="animate-spin text-primary" />
          ) : (
            <Activity size={16} className="text-primary" />
          )}
          {phase}
        </p>
        <span className="flex items-center gap-1.5 text-xs text-[var(--color-textSecondary)]">
          <Clock3 size={13} />
          Elapsed {duration(mgr.elapsedMs)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Network scan completion"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
        className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--color-textSecondary)]">
        <span>
          {status
            ? `${status.completedHosts} / ${status.totalHosts} addresses`
            : "Preparing addresses…"}
        </span>
        {status && (
          <>
            <span>
              {status.completedProbes} / {status.totalProbes} checks processed
            </span>
            <span>{status.activeProbes} active</span>
            <span>{status.skippedHosts} skipped hosts</span>
          </>
        )}
        <span>{percentage}%</span>
      </div>
      {mgr.isScanning && status?.currentHost && (
        <p
          className="truncate font-mono text-xs"
          title={`${status.currentHost}${status.currentPort ? `:${status.currentPort}` : ""}`}
        >
          Current: {status.currentHost}
          {status.currentPort ? ` · TCP ${status.currentPort}` : ""}
        </p>
      )}
      {mgr.isStopping && (
        <p className="text-xs text-[var(--color-textSecondary)]">
          Queued work is cancelled.{" "}
          {mgr.native
            ? `Active probes can take up to ${maxProbeSeconds}s from their start, including banner and HTTP identification limits.`
            : "Waiting for the active browser requests to stop."}
        </p>
      )}
    </section>
  );
}
