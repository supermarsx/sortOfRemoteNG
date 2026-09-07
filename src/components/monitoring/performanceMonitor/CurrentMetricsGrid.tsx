import React from "react";
import { Mgr } from "./types";
import { Activity, Cpu, HardDrive, Wifi } from "lucide-react";
import { Sparkline } from "../../ui/display";
import { useTranslation } from "react-i18next";

const CurrentMetricsGrid: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  if (!mgr.currentMetrics) return null;
  const cards = [
    {
      key: "latency" as const,
      label: t("performance.httpRequestTime", "HTTP request time"),
      unit: "ms",
      icon: Wifi,
    },
    {
      key: "throughput" as const,
      label: t("performance.throughput", "Throughput"),
      unit: "KB/s",
      icon: Activity,
    },
    {
      key: "cpuUsage" as const,
      label: t("performance.cpuUsage", "CPU usage"),
      unit: "%",
      icon: Cpu,
    },
    {
      key: "memoryUsage" as const,
      label: t("performance.jsHeap", "JS heap / allocated heap"),
      unit: "%",
      icon: HardDrive,
    },
  ];
  return (
    <div className="mb-6">
      <h3 className="sor-perf-heading">
        {t("performance.currentPerformance", "Current Performance")}
      </h3>
      <p className="text-xs text-[var(--color-textMuted)] mb-3">
        {t(
          "performance.measurementScope",
          "HTTP timing includes connection and server response time. JS heap excludes native memory. Unavailable measurements are not estimated.",
        )}
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ key, label, unit, icon: Icon }) => {
          const value = mgr.currentMetrics![key];
          // Stop at the first missing observation instead of drawing across gaps.
          const data: number[] = [];
          for (const metric of mgr.filteredMetrics.slice(0, 100)) {
            const observation = metric[key];
            if (observation === null || !Number.isFinite(observation)) break;
            data.push(observation);
          }
          return (
            <div key={key} className="sor-metric-card sor-metric-card-blue">
              <div className="flex items-center gap-2 mb-3">
                <Icon size={14} />
                <span className="text-xs">{label}</span>
              </div>
              <div className="text-2xl font-bold mb-2">
                {value === null
                  ? t("performance.unavailable", "Unavailable")
                  : value.toFixed(1) + " " + unit}
              </div>
              {data.length > 1 && (
                <Sparkline
                  data={data.reverse()}
                  color="var(--color-primary)"
                  height={32}
                  width={140}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
export default CurrentMetricsGrid;
