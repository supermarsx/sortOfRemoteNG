import React from "react";
import { useTranslation } from "react-i18next";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Thermometer,
  Activity,
  Server,
  Package,
} from "lucide-react";
import type { SubProps } from "./types";

const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

interface StatCardProps {
  icon: React.FC<{ className?: string }>;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  sub?: string;
}

const StatCard: React.FC<StatCardProps> = ({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
  sub,
}) => (
  <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
    <div className="flex items-center gap-3 mb-2">
      <div
        className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}
      >
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <span className="text-xs text-[var(--color-text-secondary)]">
        {label}
      </span>
    </div>
    <div className="text-xl font-semibold text-[var(--color-text)]">
      {value}
    </div>
    {sub && (
      <div className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">
        {sub}
      </div>
    )}
  </div>
);

const ProgressBar: React.FC<{
  pct: number;
  color: string;
  label: string;
  detail?: string;
}> = ({ pct, color, label, detail }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs text-[var(--color-text-secondary)]">
        {label}
      </span>
      <span className="text-xs font-medium text-[var(--color-text)]">
        {pct}%
      </span>
    </div>
    <div className="w-full h-2 rounded-full bg-[var(--color-bg)] overflow-hidden">
      <div
        className={`h-full rounded-full ${color} transition-all`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
    {detail && (
      <div className="text-[10px] text-[var(--color-text-secondary)] mt-0.5">
        {detail}
      </div>
    )}
  </div>
);

const DashboardView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const d = mgr.dashboard;
  const cpu = d?.utilization?.cpu;
  const mem = d?.utilization?.memory;

  const cpuPct = cpu?.system_load ?? 0;
  const memTotal = mem?.physical_memory?.total_real ?? 0;
  const memUsed =
    memTotal - (mem?.physical_memory?.avail_real ?? memTotal);
  const memPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;

  const volumes = d?.storage?.volumes ?? [];
  const disks = d?.storage?.disks ?? [];
  const networkTraffic = d?.utilization?.network ?? [];

  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1">
      {/* Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Server}
          iconColor="text-teal-500"
          iconBg="bg-teal-500/15"
          label={t("synology.dashboard.model", "Model")}
          value={d?.system_info?.model ?? "—"}
          sub={`DSM ${d?.system_info?.version ?? "?"}`}
        />
        <StatCard
          icon={Cpu}
          iconColor="text-primary"
          iconBg="bg-primary/15"
          label={t("synology.dashboard.cpu", "CPU")}
          value={`${cpuPct}%`}
          sub={t("synology.dashboard.systemLoad", "System load")}
        />
        <StatCard
          icon={MemoryStick}
          iconColor="text-accent"
          iconBg="bg-accent/15"
          label={t("synology.dashboard.memory", "Memory")}
          value={`${memPct}%`}
          sub={`${formatBytes(memUsed * 1024)} / ${formatBytes(memTotal * 1024)}`}
        />
        <StatCard
          icon={HardDrive}
          iconColor="text-warning"
          iconBg="bg-warning/15"
          label={t("synology.dashboard.disks", "Disks")}
          value={String(disks.length)}
          sub={`${volumes.length} ${t("synology.dashboard.volumes", "volumes")}`}
        />
      </div>

      {/* Resource utilization */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-teal-500" />
          {t("synology.dashboard.resources", "Resource Utilization")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] space-y-3">
            <ProgressBar
              pct={cpuPct}
              color="bg-primary"
              label={t("synology.dashboard.cpuUsage", "CPU Usage")}
            />
            <ProgressBar
              pct={memPct}
              color="bg-accent"
              label={t("synology.dashboard.memUsage", "Memory Usage")}
              detail={`${formatBytes(memUsed * 1024)} / ${formatBytes(memTotal * 1024)}`}
            />
          </div>

          {/* Network traffic */}
          <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            <div className="flex items-center gap-2 mb-3">
              <Network className="w-4 h-4 text-success" />
              <span className="text-xs font-medium text-[var(--color-text)]">
                {t("synology.dashboard.network", "Network")}
              </span>
            </div>
            {networkTraffic.length > 0 ? (
              <div className="space-y-2">
                {networkTraffic.map((iface, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-[var(--color-text-secondary)]">
                      {iface.device ?? `eth${i}`}
                    </span>
                    <div className="flex gap-3">
                      <span className="text-success">
                        ↑ {formatBytes(iface.tx ?? 0)}/s
                      </span>
                      <span className="text-primary">
                        ↓ {formatBytes(iface.rx ?? 0)}/s
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-[var(--color-text-secondary)]">
                {t("synology.dashboard.noNetwork", "No data")}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Volumes */}
      {volumes.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-warning" />
            {t("synology.dashboard.volumeStatus", "Volume Status")}
          </h3>
          <div className="space-y-2">
            {volumes.map((vol) => {
              const total = vol.size?.total ?? 0;
              const used = vol.size?.used ?? 0;
              const pct =
                total > 0 ? Math.round((used / total) * 100) : 0;
              return (
                <div
                  key={vol.id ?? vol.display_name}
                  className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      {vol.display_name ?? vol.id}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        vol.status === "normal"
                          ? "bg-success/15 text-success"
                          : "bg-warning/15 text-warning"
                      }`}
                    >
                      {vol.status}
                    </span>
                  </div>
                  <ProgressBar
                    pct={pct}
                    color={
                      pct > 90
                        ? "bg-error"
                        : pct > 70
                          ? "bg-warning"
                          : "bg-teal-500"
                    }
                    label=""
                    detail={`${formatBytes(used)} / ${formatBytes(total)}`}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Temperature */}
      {d?.hardware?.fans && d.hardware.fans.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-error" />
            {t("synology.dashboard.thermal", "Thermal")}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {d.hardware.temps?.map((temp, i) => (
              <div
                key={i}
                className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-center"
              >
                <div className="text-lg font-semibold text-[var(--color-text)]">
                  {temp.value ?? "—"}°C
                </div>
                <div className="text-[10px] text-[var(--color-text-secondary)]">
                  {temp.name ?? `Sensor ${i + 1}`}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!d && (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--color-text-secondary)]">
          <Package className="w-5 h-5 mr-2 opacity-50" />
          {t("synology.dashboard.loading", "Loading dashboard data...")}
        </div>
      )}
    </div>
  );
};

export default DashboardView;
