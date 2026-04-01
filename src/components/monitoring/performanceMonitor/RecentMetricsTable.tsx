import React from "react";
import { Mgr } from "./types";
import { useTranslation } from "react-i18next";
import { Activity, Clock, Cpu, HardDrive, Wifi, Download } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

const RecentMetricsTable: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();

  const handleExportCsv = async () => {
    const header = "Time,Latency (ms),Throughput (KB/s),CPU (%),Memory (%)";
    const rows = mgr.recentMetrics.map((m) =>
      [
        new Date(m.timestamp).toISOString(),
        m.latency.toFixed(1),
        m.throughput.toFixed(1),
        m.cpuUsage.toFixed(1),
        m.memoryUsage.toFixed(1),
      ].join(","),
    );
    const csv = [header, ...rows].join("\n");

    const filePath = await save({
      defaultPath: `metrics-${new Date().toISOString().split("T")[0]}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (filePath) {
      await writeTextFile(filePath, csv);
    }
  };

  return (
    <div>
      <h3 className="sor-perf-heading">
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
                    <Wifi size={11} className="text-primary" />
                    <span>Latency</span>
                  </div>
                </th>
                <th className="sor-th-xs">
                  <div className="flex items-center space-x-1.5">
                    <Activity size={11} className="text-success" />
                    <span>Throughput</span>
                  </div>
                </th>
                <th className="sor-th-xs">
                  <div className="flex items-center space-x-1.5">
                    <Cpu size={11} className="text-warning" />
                    <span>CPU</span>
                  </div>
                </th>
                <th className="sor-th-xs">
                  <div className="flex items-center space-x-1.5">
                    <HardDrive size={11} className="text-accent" />
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
                    key={`${metric.timestamp}-${index}`}
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
                            ? "text-error"
                            : metric.latency < mgr.avgLatency * 0.5
                              ? "text-success"
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
                            className={`h-full rounded-full ${metric.cpuUsage > 80 ? "bg-error" : metric.cpuUsage > 50 ? "bg-warning" : "bg-success"}`}
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
                            className={`h-full rounded-full ${metric.memoryUsage > 80 ? "bg-error" : metric.memoryUsage > 50 ? "bg-warning" : "bg-accent"}`}
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
      <div className="flex justify-end mt-3">
        <button
          onClick={handleExportCsv}
          aria-label="Export performance metrics as CSV"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-xs text-[var(--color-text)]"
        >
          <Download size={12} />
          {t("performance.exportCsv", "Export CSV")}
        </button>
      </div>
    </div>
  );
};

export default RecentMetricsTable;
