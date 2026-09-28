import { Activity, Clock3, LoaderCircle } from "lucide-react";
import type { useNetworkDiscovery } from "../../hooks/network/useNetworkDiscovery";
import { effectiveDiscoveryPingMethod } from "../../utils/discovery/discoveryPing";

type Manager = ReturnType<typeof useNetworkDiscovery>;
const cpuCount = (value: number | null | undefined) =>
  value != null && Number.isSafeInteger(value) && value > 0 ? value : null;
const duration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function DiscoveryScanProgress({ mgr }: { mgr: Manager }) {
  if (!mgr.hasScanned) return null;
  const status = mgr.scanStatus;
  const physicalCores = cpuCount(status?.physicalCores);
  const hostDiscoveryEnabled =
    effectiveDiscoveryPingMethod(mgr.config) !== "none";
  const serviceScanEnabled = mgr.config.serviceScanEnabled !== false;
  const tcpTimeout = Math.ceil(mgr.config.timeout / 1000);
  const maxProbeSeconds = Math.max(
    serviceScanEnabled
      ? tcpTimeout +
          2 +
          (mgr.config.identifyServices ? Math.min(tcpTimeout, 5) : 0)
      : 0,
    hostDiscoveryEnabled
      ? Math.ceil((mgr.config.pingTimeout ?? 1000) / 1000)
      : 0,
  );
  const phase = mgr.isStopping
    ? "Stopping — waiting for active probes"
    : mgr.isPaused
      ? status?.activeProbes
        ? "Paused — active probes are finishing"
        : "Scan paused"
      : status?.paused && mgr.isScanning
        ? "Waiting for capacity"
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
                  resolving: "Resolving hostnames",
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
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-right text-xs text-[var(--color-textSecondary)]">
          {mgr.isScanning && (
            <span>
              ETA{" "}
              {mgr.isPaused ||
              mgr.isStopping ||
              status?.paused ||
              status?.etaMs == null ||
              !Number.isFinite(status.etaMs)
                ? "—"
                : `~${duration(status.etaMs)} remaining`}
              {!mgr.isPaused &&
              !mgr.isStopping &&
              !status?.paused &&
              status?.etaMs == null
                ? " · estimating…"
                : ""}
            </span>
          )}
          <span className="ml-auto flex items-center justify-end gap-1.5 whitespace-nowrap tabular-nums">
            <Clock3 size={13} />
            Elapsed {duration(mgr.elapsedMs)}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-success/10 px-3 py-2">
          <span className="block text-lg font-semibold text-success">
            {status?.liveHosts ?? mgr.discoveredHosts.length}
          </span>
          <span className="text-xs text-[var(--color-textSecondary)]">
            Live hosts found
          </span>
        </div>
        <div className="rounded-lg bg-primary/10 px-3 py-2">
          <span className="block text-lg font-semibold text-primary">
            {status?.livePorts ??
              mgr.discoveredHosts.reduce(
                (total, host) => total + host.openPorts.length,
                0,
              )}
          </span>
          <span className="text-xs text-[var(--color-textSecondary)]">
            Open ports found
          </span>
        </div>
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
            {status.workerLimit != null && (
              <span>
                Workers {status.activeWorkers ?? 0} / {status.workerLimit}
              </span>
            )}
            {status.probeLimit != null && (
              <span>Probe limit {status.probeLimit}</span>
            )}
          </>
        )}
        <span>{percentage}%</span>
      </div>
      {mgr.native && mgr.isScanning && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-textSecondary)]">
          <span title="System CPU busy time: 0–100% across all logical processors. Task Manager may show frequency-weighted utility instead.">
            System CPU busy time{" "}
            {status?.cpuPercent == null ||
            !Number.isFinite(status.cpuPercent) ||
            status.cpuPercent < 0 ||
            status.cpuPercent > 100
              ? "unavailable"
              : `${Math.round(status.cpuPercent)}%`}
          </span>
          <span title="Logical processors available to this process and total logical processors in the system">
            Logical CPUs: {cpuCount(status?.logicalCpus) ?? "unknown"} available
            to process / {cpuCount(status?.systemLogicalCpus) ?? "unknown"}{" "}
            total
          </span>
          {physicalCores != null && (
            <span>Physical cores: {physicalCores}</span>
          )}
          {status?.cpuSampleIntervalMs != null &&
            Number.isFinite(status.cpuSampleIntervalMs) &&
            status.cpuSampleIntervalMs > 0 && (
              <span>
                CPU sample: {Math.round(status.cpuSampleIntervalMs)} ms
                {status.cpuSampleAgeMs != null &&
                  Number.isFinite(status.cpuSampleAgeMs) &&
                  status.cpuSampleAgeMs >= 0 &&
                  ` · age ${Math.round(status.cpuSampleAgeMs)} ms`}
              </span>
            )}
          <span>
            Interface load{" "}
            {status?.networkUtilizationPercent == null
              ? "unavailable"
              : `${Math.round(status.networkUtilizationPercent)}%`}
          </span>
          {status?.throttleReason && (
            <span className="text-warning">{status.throttleReason}</span>
          )}
        </div>
      )}
      {status?.discoveryWarning && (
        <p className="text-xs text-warning" role="status">
          {status.discoveryWarning}
        </p>
      )}
      {mgr.isPaused && (
        <p className="text-xs text-[var(--color-textSecondary)]">
          No new hosts or probes are launched while paused. Resume continues the
          existing queue.
        </p>
      )}
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
            ? serviceScanEnabled
              ? `Active probes can take up to ${maxProbeSeconds}s from their start, including banner and service identification limits.`
              : `Active reachability probes have a requested ${maxProbeSeconds}s budget from their start.`
            : "Waiting for the active browser requests to stop."}
          {mgr.native &&
            hostDiscoveryEnabled &&
            " Windows native ARP/ICMP calls must finish at the OS level before their slots are released; stopping can exceed the requested timeout."}
        </p>
      )}
    </section>
  );
}
