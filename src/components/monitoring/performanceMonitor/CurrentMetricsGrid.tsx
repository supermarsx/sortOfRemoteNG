import React from "react";
import { Mgr } from "./types";

const CurrentMetricsGrid: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  if (!mgr.currentMetrics) return null;

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-[var(--color-textSecondary)] uppercase tracking-wide mb-3">
        {t("performance.currentPerformance", "Current Performance")}
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Latency Card */}
        <div className="sor-metric-card sor-metric-card-blue">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-500/20 rounded-lg">
                <Wifi className="text-blue-400" size={14} />
              </div>
              <span className="text-[var(--color-textSecondary)] text-xs font-medium">
                {t("performance.latency")}
              </span>
            </div>
            {mgr.filteredMetrics.length > 1 && (
              <TrendIndicator
                current={mgr.currentMetrics.latency}
                previous={
                  mgr.filteredMetrics[1]?.latency ||
                  mgr.currentMetrics.latency
                }
              />
            )}
          </div>
          <div className="text-[var(--color-text)] text-2xl font-bold mb-2">
            {mgr.currentMetrics.latency.toFixed(1)}
            <span className="text-sm font-normal text-[var(--color-textMuted)]">
              ms
            </span>
          </div>
          <Sparkline
            data={mgr.filteredMetrics
              .slice(0, 100)
              .reverse()
              .map((m) => m.latency)}
            color="#3b82f6"
            height={32}
            width={140}
          />
        </div>

        {/* Throughput Card */}
        <div className="sor-metric-card sor-metric-card-green">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-green-500/20 rounded-lg">
                <Activity className="text-green-400" size={14} />
              </div>
              <span className="text-[var(--color-textSecondary)] text-xs font-medium">
                {t("performance.throughput")}
              </span>
            </div>
            {mgr.filteredMetrics.length > 1 && (
              <TrendIndicator
                current={mgr.currentMetrics.throughput}
                previous={
                  mgr.filteredMetrics[1]?.throughput ||
                  mgr.currentMetrics.throughput
                }
              />
            )}
          </div>
          <div className="text-[var(--color-text)] text-2xl font-bold mb-2">
            {mgr.formatBytes(mgr.currentMetrics.throughput * 1024)}
            <span className="text-sm font-normal text-[var(--color-textMuted)]">
              /s
            </span>
          </div>
          <MiniBarChart
            data={mgr.filteredMetrics
              .slice(0, 100)
              .reverse()
              .map((m) => m.throughput)}
            color="#22c55e"
            height={32}
            width={140}
          />
        </div>

        {/* CPU Usage Card */}
        <div className="sor-metric-card sor-metric-card-yellow">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-yellow-500/20 rounded-lg">
                <Cpu className="text-yellow-400" size={14} />
              </div>
              <span className="text-[var(--color-textSecondary)] text-xs font-medium">
                {t("performance.cpuUsage")}
              </span>
            </div>
            {mgr.filteredMetrics.length > 1 && (
              <TrendIndicator
                current={mgr.currentMetrics.cpuUsage}
                previous={
                  mgr.filteredMetrics[1]?.cpuUsage ||
                  mgr.currentMetrics.cpuUsage
                }
              />
            )}
          </div>
          <div className="flex items-end gap-3 mb-2">
            <div className="text-[var(--color-text)] text-2xl font-bold">
              {mgr.currentMetrics.cpuUsage.toFixed(1)}
              <span className="text-sm font-normal text-[var(--color-textMuted)]">
                %
              </span>
            </div>
            <div className="flex-1 h-2 bg-[var(--color-surfaceHover)] rounded-full overflow-hidden mb-1.5">
              <div
                className="h-full bg-yellow-500 rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(mgr.currentMetrics.cpuUsage, 100)}%`,
                }}
              />
            </div>
          </div>
          <Sparkline
            data={mgr.filteredMetrics
              .slice(0, 100)
              .reverse()
              .map((m) => m.cpuUsage)}
            color="#eab308"
            height={32}
            width={140}
          />
        </div>

        {/* Memory Usage Card */}
        <div className="sor-metric-card sor-metric-card-purple">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-purple-500/20 rounded-lg">
                <HardDrive className="text-purple-400" size={14} />
              </div>
              <span className="text-[var(--color-textSecondary)] text-xs font-medium">
                {t("performance.memoryUsage")}
              </span>
            </div>
            {mgr.filteredMetrics.length > 1 && (
              <TrendIndicator
                current={mgr.currentMetrics.memoryUsage}
                previous={
                  mgr.filteredMetrics[1]?.memoryUsage ||
                  mgr.currentMetrics.memoryUsage
                }
              />
            )}
          </div>
          <div className="flex items-end gap-3 mb-2">
            <div className="text-[var(--color-text)] text-2xl font-bold">
              {mgr.currentMetrics.memoryUsage.toFixed(1)}
              <span className="text-sm font-normal text-[var(--color-textMuted)]">
                %
              </span>
            </div>
            <div className="flex-1 h-2 bg-[var(--color-surfaceHover)] rounded-full overflow-hidden mb-1.5">
              <div
                className="h-full bg-purple-500 rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(mgr.currentMetrics.memoryUsage, 100)}%`,
                }}
              />
            </div>
          </div>
          <Sparkline
            data={mgr.filteredMetrics
              .slice(0, 100)
              .reverse()
              .map((m) => m.memoryUsage)}
            color="#a855f7"
            height={32}
            width={140}
          />
        </div>
      </div>
    </div>
  );
};

export default CurrentMetricsGrid;
