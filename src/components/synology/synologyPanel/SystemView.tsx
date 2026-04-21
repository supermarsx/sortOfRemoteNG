import React from "react";
import { useTranslation } from "react-i18next";
import {
  Server,
  Cpu,
  MemoryStick,
  Clock,
  RefreshCw,
  Power,
  PowerOff,
} from "lucide-react";
import type { SubProps } from "./types";

const SystemView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const info = mgr.systemInfo;
  const util = mgr.utilization;

  const formatUptime = (secs: number) => {
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto flex-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
          <Server className="w-4 h-4 text-teal-500" />
          {t("synology.system.title", "System Information")}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={mgr.rebootNas}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-warning/10 border border-warning/30 text-warning text-xs hover:bg-warning/20 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            {t("synology.system.reboot", "Reboot")}
          </button>
          <button
            onClick={mgr.shutdownNas}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-error/10 border border-error/30 text-error text-xs hover:bg-error/20 transition-colors"
          >
            <PowerOff className="w-3 h-3" />
            {t("synology.system.shutdown", "Shutdown")}
          </button>
        </div>
      </div>

      {/* Info grid */}
      {info && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: "Model", value: info.model },
            { label: "Serial", value: info.serial },
            { label: "DSM Version", value: info.version },
            { label: "Build", value: info.version_string },
            {
              label: "Uptime",
              value: info.uptime ? formatUptime(info.uptime) : "—",
            },
            { label: "Temperature", value: info.temperature ? `${info.temperature}°C` : "—" },
            { label: "RAM", value: info.ram ? `${info.ram} MB` : "—" },
            {
              label: "External IP",
              value: info.external_ip ?? "—",
            },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]"
            >
              <div className="text-[10px] text-[var(--color-textSecondary)] uppercase tracking-wider mb-1">
                {label}
              </div>
              <div className="text-sm font-medium text-[var(--color-text)] truncate">
                {value ?? "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CPU utilization */}
      {util?.cpu && (
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2 flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-primary" />
            {t("synology.system.cpuUtil", "CPU Utilization")}
          </h4>
          <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg font-semibold text-primary">
                  {util.cpu.system_load ?? 0}%
                </div>
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  System
                </div>
              </div>
              <div>
                <div className="text-lg font-semibold text-success">
                  {util.cpu.user_load ?? 0}%
                </div>
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  User
                </div>
              </div>
              <div>
                <div className="text-lg font-semibold text-text-muted">
                  {100 -
                    (util.cpu.system_load ?? 0) -
                    (util.cpu.user_load ?? 0)}
                  %
                </div>
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  Idle
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Memory utilization */}
      {util?.memory && (
        <section>
          <h4 className="text-xs font-semibold text-[var(--color-text)] mb-2 flex items-center gap-2">
            <MemoryStick className="w-3.5 h-3.5 text-primary" />
            {t("synology.system.memUtil", "Memory Utilization")}
          </h4>
          <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg font-semibold text-primary">
                  {util.memory.physical_memory?.total_real ?? "—"}
                </div>
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  Total (KB)
                </div>
              </div>
              <div>
                <div className="text-lg font-semibold text-success">
                  {util.memory.physical_memory?.avail_real ?? "—"}
                </div>
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  Available (KB)
                </div>
              </div>
              <div>
                <div className="text-lg font-semibold text-warning">
                  {util.memory.buffer ?? "—"}
                </div>
                <div className="text-[10px] text-[var(--color-textSecondary)]">
                  Buffer (KB)
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {!info && !util && (
        <div className="flex items-center justify-center py-16 text-sm text-[var(--color-textSecondary)]">
          <Clock className="w-5 h-5 mr-2 opacity-50" />
          {t("synology.system.loading", "Loading system data...")}
        </div>
      )}
    </div>
  );
};

export default SystemView;
