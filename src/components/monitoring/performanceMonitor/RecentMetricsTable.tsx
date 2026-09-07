import React from "react";
import { Mgr } from "./types";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { performanceMetricsCsv } from "../../../hooks/monitoring/usePerformanceMonitor";
import { useTranslation } from "react-i18next";

const RecentMetricsTable: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const handleExportCsv = async () => {
    const filePath = await save({
      defaultPath: "metrics-" + new Date().toISOString().split("T")[0] + ".csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (filePath)
      await writeTextFile(filePath, performanceMetricsCsv(mgr.recentMetrics));
  };
  return (
    <div>
      <h3 className="sor-perf-heading">
        {t("performance.recentMetrics", "Recent Metrics")}
      </h3>
      <p className="text-xs text-[var(--color-textMuted)] mb-3">
        {t(
          "performance.legacyUnverified",
          "Legacy records are unverified; their old generated values are excluded. Connection durations remain available in CSV.",
        )}
      </p>
      <div className="sor-metric-table-shell overflow-x-auto">
        <table className="sor-data-table w-full">
          <thead>
            <tr>
              {[
                t("performance.table.time", "Time"),
                t("performance.table.source", "Source"),
                t("performance.httpRequestTime", "HTTP request time") + " (ms)",
                t("performance.throughput", "Throughput") + " (KB/s)",
                t("performance.table.cpu", "CPU") + " (%)",
                t("performance.jsHeap", "JS heap / allocated heap") + " (%)",
              ].map((label) => (
                <th key={label} className="sor-th-xs">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mgr.recentMetrics.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center">
                  No metrics recorded yet
                </td>
              </tr>
            ) : (
              mgr.recentMetrics.map((metric, index) => (
                <tr key={metric.timestamp + "-" + index}>
                  <td className="px-4 py-2.5 text-xs">
                    {metric.timestamp >= 946684800000
                      ? new Date(metric.timestamp).toLocaleString()
                      : "Unknown (legacy clock)"}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{metric.source}</td>
                  {[
                    metric.latency,
                    metric.throughput,
                    metric.cpuUsage,
                    metric.memoryUsage,
                  ].map((value, column) => (
                    <td key={column} className="px-4 py-2.5 text-xs">
                      {value === null ? "Unavailable" : value.toFixed(1)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end mt-3">
        <button
          onClick={() => void handleExportCsv().catch(console.error)}
          className="sor-btn-secondary"
          aria-label={t(
            "performance.exportCsvAria",
            "Export performance metrics as CSV",
          )}
        >
          {t("performance.exportCsv", "Export CSV")}
        </button>
      </div>
    </div>
  );
};
export default RecentMetricsTable;
