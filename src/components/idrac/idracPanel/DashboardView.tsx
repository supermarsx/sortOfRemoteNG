import React from "react";
import { useTranslation } from "react-i18next";
import {
  Server,
  HeartPulse,
  Power,
  Thermometer,
  HardDrive,
  Cpu,
  MemoryStick,
  Network,
  Package,
  AlertCircle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import type { SubProps } from "./types";

/** Quick badge for health status. */
const HealthBadge: React.FC<{ health?: string }> = ({ health }) => {
  const h = (health ?? "Unknown").toLowerCase();
  if (h === "ok" || h === "healthy")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-success">
        <CheckCircle className="w-3 h-3" /> OK
      </span>
    );
  if (h === "warning")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-warning">
        <AlertCircle className="w-3 h-3" /> Warning
      </span>
    );
  if (h === "critical" || h === "error")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-error">
        <AlertCircle className="w-3 h-3" /> Critical
      </span>
    );
  return (
    <span className="text-[10px] text-[var(--color-text-secondary)]">
      {health ?? "N/A"}
    </span>
  );
};

const DashboardView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const d = mgr.dashboard;

  if (mgr.loading && !d) {
    return (
      <div className="flex items-center justify-center flex-1 text-[var(--color-text-secondary)]">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!d) {
    return (
      <div className="flex items-center justify-center flex-1 text-xs text-[var(--color-text-secondary)]">
        {t("idrac.no_data", "No data available")}
      </div>
    );
  }

  const cards = [
    {
      icon: Server,
      title: t("idrac.dashboard.server", "Server"),
      lines: [
        `${d.system.manufacturer} ${d.system.model}`,
        `SN: ${d.system.serialNumber}`,
        `Tag: ${d.system.serviceTag}`,
        `BIOS: ${d.system.biosVersion}`,
      ],
    },
    {
      icon: HeartPulse,
      title: t("idrac.dashboard.health", "Health"),
      extra: <HealthBadge health={d.health.overallHealth} />,
      lines: [
        `CPU: ${d.health.processors.health ?? "N/A"}`,
        `Memory: ${d.health.memory.health ?? "N/A"}`,
        `Storage: ${d.health.storage.health ?? "N/A"}`,
        `Fans: ${d.health.fans.health ?? "N/A"}`,
      ],
    },
    {
      icon: Power,
      title: t("idrac.dashboard.power", "Power"),
      lines: [
        `State: ${d.system.powerState}`,
        `Current: ${d.power.currentWatts ?? "N/A"} W`,
        `Peak: ${d.power.maxWatts ?? "N/A"} W`,
        `Cap: ${d.power.powerCapEnabled ? `${d.power.powerCapWatts} W` : "Disabled"}`,
      ],
    },
    {
      icon: Thermometer,
      title: t("idrac.dashboard.thermal", "Thermal"),
      lines: d.thermalSummary
        ? [
            `Inlet: ${d.thermalSummary.inletTempCelsius ?? "N/A"} °C`,
            `Exhaust: ${d.thermalSummary.exhaustTempCelsius ?? "N/A"} °C`,
            `Fans: ${d.thermalSummary.fansOk}/${d.thermalSummary.fanCount} OK`,
            `Sensors: ${d.thermalSummary.sensorsOk}/${d.thermalSummary.sensorCount} OK`,
          ]
        : ["No thermal data"],
    },
    {
      icon: Cpu,
      title: t("idrac.dashboard.cpu", "Processors"),
      lines: [
        `${d.system.processorCount}× ${d.system.processorModel}`,
      ],
    },
    {
      icon: MemoryStick,
      title: t("idrac.dashboard.memory", "Memory"),
      lines: [
        `${d.system.memoryGib} GiB total`,
        `${d.memoryDimmCount} DIMMs installed`,
      ],
    },
    {
      icon: HardDrive,
      title: t("idrac.dashboard.storage", "Storage"),
      lines: [
        `${d.virtualDiskCount} virtual disk(s)`,
        `${d.physicalDiskCount} physical disk(s)`,
      ],
    },
    {
      icon: Network,
      title: t("idrac.dashboard.network", "Network"),
      lines: [`${d.nicCount} NIC(s) detected`],
    },
    {
      icon: Package,
      title: t("idrac.dashboard.firmware", "Firmware"),
      lines: [
        `iDRAC: ${d.idrac.firmwareVersion}`,
        `${d.firmwareCount} components`,
      ],
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 space-y-2"
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-warning shrink-0" />
                <span className="text-xs font-medium text-[var(--color-text)] truncate">
                  {card.title}
                </span>
                {"extra" in card && card.extra}
              </div>
              <div className="space-y-0.5">
                {card.lines.map((line, i) => (
                  <p
                    key={i}
                    className="text-[10px] text-[var(--color-text-secondary)] truncate"
                  >
                    {line}
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent events */}
      {d.recentEvents.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <h3 className="text-xs font-medium text-[var(--color-text)] mb-2">
            {t("idrac.dashboard.recent_events", "Recent Events")}
          </h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {d.recentEvents.slice(0, 15).map((ev) => (
              <div
                key={ev.id}
                className="flex items-start gap-2 text-[10px] py-1 border-b border-[var(--color-border)] last:border-0"
              >
                <span
                  className={`shrink-0 font-medium ${
                    ev.severity.toLowerCase() === "critical"
                      ? "text-error"
                      : ev.severity.toLowerCase() === "warning"
                        ? "text-warning"
                        : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {ev.severity}
                </span>
                <span className="text-[var(--color-text-secondary)] truncate">
                  {ev.message}
                </span>
                {ev.created && (
                  <span className="ml-auto text-[var(--color-text-secondary)] shrink-0">
                    {ev.created}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardView;
