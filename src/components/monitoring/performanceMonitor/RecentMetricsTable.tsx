import React from "react";
import { Mgr } from "./types";

const RecentMetricsTable: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div>
      <h3 className="text-sm font-medium text-[var(--color-textSecondary)] uppercase tracking-wide mb-3">
        {t("performance.recentMetrics", "Recent Metrics")}
      </h3>
      <div className="sor-metric-table-shell">
        <div className="overflow-x-auto">
          <table className="sor-data-table w-full">
            <thead className="bg-[var(--color-surfaceHover)]">
              <tr>
                <th className="sor-th-xs">
                  <div className="flex items-center space-x-1.5">
                    <Clock size={11} />
                    <span>Time</span>
                  </div>
                </th>
                <th className="sor-th-xs">
                  <div className="flex items-center space-x-1.5">
                    <Wifi size={11} className="text-blue-400" />
                    <span>Latency</span>
                  </div>
                </th>
                <th className="sor-th-xs">
                  <div className="flex items-center space-x-1.5">
                    <Activity size={11} className="text-green-400" />
                    <span>Throughput</span>
                  </div>
                </th>
                <th className="sor-th-xs">
                  <div className="flex items-center space-x-1.5">
                    <Cpu size={11} className="text-yellow-400" />
                    <span>CPU</span>
                  </div>
                </th>
                <th className="sor-th-xs">
                  <div className="flex items-center space-x-1.5">
                    <HardDrive size={11} className="text-purple-400" />
                    <span>Memory</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {mgr.recentMetrics.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-sm text-[var(--color-textMuted)]"
                  >
                    {t("performance.noMetrics", "No metrics recorded yet")}
                  </td>
                </tr>
              ) : (
                mgr.recentMetrics.map((metric, index) => (
                  <tr
                    key={index}
                    className="hover:bg-[var(--color-surfaceHover)]/50 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-xs text-[var(--color-textSecondary)]">
                      {new Date(metric.timestamp).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text)] font-medium">
                      <span
                        className={
                          metric.latency > mgr.avgLatency * 1.5
                            ? "text-red-400"
                            : metric.latency < mgr.avgLatency * 0.5
                              ? "text-green-400"
                              : ""
                        }
                      >
                        {metric.latency.toFixed(1)}ms
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--color-text)] font-medium">
                      {mgr.formatBytes(metric.throughput * 1024)}/s
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1.5 bg-[var(--color-surfaceHover)] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${metric.cpuUsage > 80 ? "bg-red-500" : metric.cpuUsage > 50 ? "bg-yellow-500" : "bg-green-500"}`}
                            style={{
                              width: `${Math.min(metric.cpuUsage, 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-[var(--color-text)] font-medium">
                          {metric.cpuUsage.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1.5 bg-[var(--color-surfaceHover)] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${metric.memoryUsage > 80 ? "bg-red-500" : metric.memoryUsage > 50 ? "bg-yellow-500" : "bg-purple-500"}`}
                            style={{
                              width: `${Math.min(metric.memoryUsage, 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-[var(--color-text)] font-medium">
                          {metric.memoryUsage.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default RecentMetricsTable;
