import React from "react";
import { useTranslation } from "react-i18next";
import { Cpu, MemoryStick, HardDrive, Clock, Server, Users } from "lucide-react";
import type { ServerStatsSnapshot } from "../../../types/monitoring/serverStats";

interface OverviewTabProps {
  snapshot: ServerStatsSnapshot;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full h-2 bg-background dark:bg-surface rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function usageColor(pct: number): string {
  if (pct >= 90) return "bg-error";
  if (pct >= 70) return "bg-warning";
  return "bg-info";
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ snapshot }) => {
  const { t } = useTranslation();
  const { cpu, memory, disk, system, ports } = snapshot;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {/* CPU Card */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Cpu size={16} className="text-info" />
          <span className="text-sm font-semibold text-[var(--color-text)]">
            {t("serverStats.cpuUsage", "CPU Usage")}
          </span>
        </div>
        <div className="text-3xl font-bold text-[var(--color-text)] mb-1">
          {cpu.usagePercent.toFixed(1)}%
        </div>
        <ProgressBar value={cpu.usagePercent} color={usageColor(cpu.usagePercent)} />
        <div className="mt-2 text-xs text-[var(--color-textSecondary)]">
          {cpu.coreCount} {t("serverStats.cores", "cores")} · {cpu.model}
        </div>
        <div className="text-xs text-[var(--color-textSecondary)]">
          {t("serverStats.loadAvg", "Load")}: {cpu.loadAvg1.toFixed(2)} / {cpu.loadAvg5.toFixed(2)} / {cpu.loadAvg15.toFixed(2)}
        </div>
      </div>

      {/* Memory Card */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <MemoryStick size={16} className="text-primary" />
          <span className="text-sm font-semibold text-[var(--color-text)]">
            {t("serverStats.memoryUsage", "Memory Usage")}
          </span>
        </div>
        <div className="text-3xl font-bold text-[var(--color-text)] mb-1">
          {memory.usagePercent.toFixed(1)}%
        </div>
        <ProgressBar value={memory.usagePercent} color={usageColor(memory.usagePercent)} />
        <div className="mt-2 text-xs text-[var(--color-textSecondary)]">
          {formatBytes(memory.totalBytes - memory.availableBytes)} / {formatBytes(memory.totalBytes)}
        </div>
        {memory.swapTotalBytes > 0 && (
          <div className="text-xs text-[var(--color-textSecondary)]">
            Swap: {formatBytes(memory.swapUsedBytes)} / {formatBytes(memory.swapTotalBytes)} ({memory.swapUsagePercent.toFixed(1)}%)
          </div>
        )}
      </div>

      {/* Disk Card */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <HardDrive size={16} className="text-warning" />
          <span className="text-sm font-semibold text-[var(--color-text)]">
            {t("serverStats.diskUsage", "Disk Usage")}
          </span>
        </div>
        {disk.partitions.length > 0 ? (
          <div className="space-y-2">
            {disk.partitions.slice(0, 3).map((p) => (
              <div key={p.mountPoint}>
                <div className="flex justify-between text-xs text-[var(--color-textSecondary)] mb-0.5">
                  <span>{p.mountPoint}</span>
                  <span>{p.usagePercent}%</span>
                </div>
                <ProgressBar value={p.usagePercent} color={usageColor(p.usagePercent)} />
                <div className="text-xs text-[var(--color-textSecondary)]">
                  {formatBytes(p.usedBytes)} / {formatBytes(p.totalBytes)}
                </div>
              </div>
            ))}
            {disk.partitions.length > 3 && (
              <div className="text-xs text-[var(--color-textSecondary)]">
                +{disk.partitions.length - 3} {t("serverStats.morePartitions", "more partitions")}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-[var(--color-textSecondary)]">
            {t("serverStats.noDiskData", "No disk data")}
          </div>
        )}
      </div>

      {/* Uptime Card */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={16} className="text-success" />
          <span className="text-sm font-semibold text-[var(--color-text)]">
            {t("serverStats.uptime", "Uptime")}
          </span>
        </div>
        <div className="text-xl font-bold text-[var(--color-text)]">{system.uptime}</div>
        <div className="mt-1 text-xs text-[var(--color-textSecondary)]">{system.osName}</div>
        <div className="text-xs text-[var(--color-textSecondary)]">{system.kernelVersion}</div>
      </div>

      {/* System Card */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Server size={16} className="text-primary" />
          <span className="text-sm font-semibold text-[var(--color-text)]">
            {t("serverStats.systemInfo", "System")}
          </span>
        </div>
        <div className="space-y-1 text-xs text-[var(--color-textSecondary)]">
          <div><span className="font-medium">{t("serverStats.hostname", "Host")}:</span> {system.hostname}</div>
          <div><span className="font-medium">{t("serverStats.arch", "Arch")}:</span> {system.architecture}</div>
          <div><span className="font-medium">{t("serverStats.time", "Time")}:</span> {system.serverTime}</div>
        </div>
      </div>

      {/* Network Card */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users size={16} className="text-primary" />
          <span className="text-sm font-semibold text-[var(--color-text)]">
            {t("serverStats.networkOverview", "Network")}
          </span>
        </div>
        <div className="space-y-1 text-xs text-[var(--color-textSecondary)]">
          <div>{ports.listeningPorts.length} {t("serverStats.listeningPorts", "listening ports")}</div>
          <div>{ports.establishedConnections} {t("serverStats.established", "established connections")}</div>
          <div>{ports.timeWaitConnections} {t("serverStats.timeWait", "TIME_WAIT")}</div>
          <div>{system.loggedInUsers} {t("serverStats.loggedInUsers", "logged in users")}</div>
        </div>
      </div>
    </div>
  );
};
