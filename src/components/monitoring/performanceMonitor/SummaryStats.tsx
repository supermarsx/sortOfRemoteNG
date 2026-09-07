import React from "react";
import { Mgr } from "./types";
import { useTranslation } from "react-i18next";

const SummaryStats: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="mb-6">
      <h3 className="sor-perf-heading">
        {t("performance.summary", "Summary Statistics")}
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          [
            t(
              "performance.summaryStats.avgHttpRequest",
              "Avg HTTP request time",
            ),
            mgr.avgLatency,
            "ms",
          ],
          [
            t("performance.summaryStats.avgThroughput", "Avg Throughput"),
            mgr.avgThroughput,
            "KB/s",
          ],
          [
            t("performance.summaryStats.avgCpu", "Avg CPU"),
            mgr.avgCpuUsage,
            "%",
          ],
          [
            t(
              "performance.summaryStats.avgJsHeap",
              "Avg JS heap / allocated heap",
            ),
            mgr.avgMemoryUsage,
            "%",
          ],
        ].map(([label, value, unit]) => (
          <div key={String(label)} className="sor-metric-summary-card">
            <div>
              <div className="text-[10px] text-[var(--color-textMuted)] uppercase">
                {label}
              </div>
              <div className="text-sm font-semibold">
                {typeof value === "number"
                  ? value.toFixed(1) + " " + unit
                  : t("performance.unavailable", "Unavailable")}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
export default SummaryStats;
