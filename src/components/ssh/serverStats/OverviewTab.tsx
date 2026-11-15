import React from "react";
import { useTranslation } from "react-i18next";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Clock,
  Network,
  Activity,
  ArrowDownUp,
  Server,
  Layers,
} from "lucide-react";
import type { ServerStatsSnapshot } from "../../../types/monitoring/serverStats";
import type { ServerStatsEntry } from "../../../utils/ssh/serverStatsHistory";
import {
  MISSING,
  formatAge,
  formatBytes,
  formatCount,
  formatLoad,
  formatPercent,
  formatRate,
  formatUptime,
} from "../../../utils/ssh/serverStatsFormat";
import { StatCard } from "./StatCard";
import { StatusBadge } from "./StatusBadge";
import { deriveStatus } from "../../../utils/ssh/serverStatsTable";

interface OverviewTabProps {
  snapshot: ServerStatsSnapshot;
  /** Rolling history for trends; optional (cards render without sparklines). */
  entry?: ServerStatsEntry | null;
  /** Session status for the header badge; defaults to "connected". */
  sessionStatus?: string;
}

const pct = (v: number) => formatPercent(v, 0);

export const OverviewTab: React.FC<OverviewTabProps> = ({
  snapshot,
  entry,
  sessionStatus = "connected",
}) => {
  const { t } = useTranslation();
  const { cpu, memory, disk, system, ports } = snapshot;
  const series = entry?.series;
  const now = Date.now();
  const collectedMs = Date.parse(snapshot.collectedAt);
  const sampledAt =
    entry?.sampledAt ?? (Number.isFinite(collectedMs) ? collectedMs : null);
  const status = deriveStatus(
    sessionStatus,
    { sampledAt, error: entry?.error ?? null } as ServerStatsEntry,
    now,
  );
  const sortedParts = [...disk.partitions].sort(
    (a, b) => b.usagePercent - a.usagePercent,
  );
  const worstPart = sortedParts[0];
  const io = entry?.latest;
  const hasIoRate = !!io && (io.diskRead !== null || io.diskWrite !== null);

  return (
    <div className="flex flex-col gap-4">
      {/* Summary header */}
      <header
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2"
        aria-label={t("serverStats.summary", "Server summary")}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Server size={20} className="text-primary flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-base font-semibold text-[var(--color-text)] truncate">
              {system.hostname || snapshot.connectionName || MISSING}
            </div>
            <div className="text-xs text-[var(--color-textSecondary)] truncate">
              {[system.osName, system.kernelVersion, system.architecture]
                .filter(Boolean)
                .join(" · ") || MISSING}
            </div>
          </div>
        </div>
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs ml-auto">
          <div>
            <dt className="text-[var(--color-textSecondary)] flex items-center gap-1">
              <Clock size={11} />
              {t("serverStats.uptime", "Uptime")}
            </dt>
            <dd className="text-sm font-semibold tabular-nums text-[var(--color-text)]">
              {system.uptimeSeconds > 0
                ? formatUptime(system.uptimeSeconds)
                : system.uptime || MISSING}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-textSecondary)]">
              {t("serverStats.loggedInUsersShort", "Users")}
            </dt>
            <dd className="text-sm font-semibold tabular-nums text-[var(--color-text)]">
              {formatCount(system.loggedInUsers)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-textSecondary)]">
              {t("serverStats.updated", "Updated")}
            </dt>
            <dd className="text-sm font-semibold text-[var(--color-text)]">
              {sampledAt === null ? MISSING : formatAge(now - sampledAt)}
            </dd>
          </div>
          <div>
            <dt className="sr-only">{t("serverStats.status", "Status")}</dt>
            <dd>
              <StatusBadge status={status} />
            </dd>
          </div>
        </dl>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard
          icon={Cpu}
          title={t("serverStats.cpuUsage", "CPU Usage")}
          value={formatPercent(cpu.usagePercent)}
          percent={cpu.usagePercent}
          trend={series?.cpu}
          trendFormat={pct}
          trendMin={0}
          trendMax={100}
        >
          <div>
            {cpu.coreCount} {t("serverStats.cores", "cores")}
            {cpu.model ? ` · ${cpu.model}` : ""}
          </div>
        </StatCard>

        <StatCard
          icon={MemoryStick}
          title={t("serverStats.memoryUsage", "Memory Usage")}
          value={formatPercent(memory.usagePercent)}
          percent={memory.usagePercent}
          trend={series?.mem}
          trendFormat={pct}
          trendMin={0}
          trendMax={100}
        >
          <div>
            {formatBytes(memory.totalBytes - memory.availableBytes)} /{" "}
            {formatBytes(memory.totalBytes)}
          </div>
        </StatCard>

        {memory.swapTotalBytes > 0 && (
          <StatCard
            icon={Layers}
            title={t("serverStats.swapUsage", "Swap Usage")}
            value={formatPercent(memory.swapUsagePercent)}
            percent={memory.swapUsagePercent}
            trend={series?.swap}
            trendFormat={pct}
            trendMin={0}
            trendMax={100}
          >
            <div>
              {formatBytes(memory.swapUsedBytes)} /{" "}
              {formatBytes(memory.swapTotalBytes)}
            </div>
          </StatCard>
        )}

        <StatCard
          icon={HardDrive}
          title={t("serverStats.diskUsage", "Disk Usage")}
          value={worstPart ? formatPercent(worstPart.usagePercent, 0) : MISSING}
          percent={worstPart?.usagePercent ?? null}
          trend={series?.disk}
          trendFormat={pct}
          trendMin={0}
          trendMax={100}
        >
          {sortedParts.length > 0 ? (
            <>
              {sortedParts.slice(0, 3).map((p) => (
                <div key={p.mountPoint} className="flex justify-between gap-2">
                  <span className="truncate">{p.mountPoint}</span>
                  <span className="tabular-nums">
                    {formatBytes(p.usedBytes)} / {formatBytes(p.totalBytes)} (
                    {p.usagePercent}%)
                  </span>
                </div>
              ))}
              {sortedParts.length > 3 && (
                <div>
                  +{sortedParts.length - 3}{" "}
                  {t("serverStats.morePartitions", "more partitions")}
                </div>
              )}
            </>
          ) : (
            <div>{t("serverStats.noDiskData", "No disk data")}</div>
          )}
        </StatCard>

        <StatCard
          icon={Activity}
          title={t("serverStats.loadAvg", "Load")}
          value={formatLoad(cpu.loadAvg1)}
          trend={series?.load1}
          trendFormat={formatLoad}
          trendMin={0}
        >
          <div className="tabular-nums">
            1m {formatLoad(cpu.loadAvg1)} · 5m {formatLoad(cpu.loadAvg5)} · 15m{" "}
            {formatLoad(cpu.loadAvg15)}
          </div>
        </StatCard>

        <StatCard
          icon={Network}
          title={t("serverStats.networkOverview", "Network")}
          value={formatCount(ports.establishedConnections)}
          trend={series?.conns}
          trendFormat={formatCount}
          trendMin={0}
        >
          <div>{t("serverStats.established", "established connections")}</div>
          <div className="tabular-nums">
            {ports.listeningPorts.length}{" "}
            {t("serverStats.listeningPorts", "listening ports")} ·{" "}
            {ports.timeWaitConnections} {t("serverStats.timeWait", "TIME_WAIT")}
          </div>
        </StatCard>

        {(hasIoRate || disk.io) && (
          <StatCard
            icon={ArrowDownUp}
            title={t("serverStats.diskIoRate", "Disk I/O")}
            value={
              hasIoRate
                ? formatRate((io!.diskRead ?? 0) + (io!.diskWrite ?? 0))
                : MISSING
            }
          >
            <div className="tabular-nums">
              {t("serverStats.readTotal", "Read")} {formatRate(io?.diskRead)} ·{" "}
              {t("serverStats.writeTotal", "Write")} {formatRate(io?.diskWrite)}
            </div>
            {disk.io && (
              <div className="tabular-nums">
                {t("serverStats.sinceBoot", "Since boot")}:{" "}
                {formatBytes(disk.io.readBytes)} /{" "}
                {formatBytes(disk.io.writeBytes)}
              </div>
            )}
          </StatCard>
        )}
      </div>
    </div>
  );
};
