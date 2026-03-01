import React from "react";
import { Mgr } from "./types";
import { useTranslation } from "react-i18next";
import { Activity, Cpu, HardDrive, Wifi } from "lucide-react";

const SummaryStats: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-[var(--color-textSecondary)] uppercase tracking-wide mb-3">
        {t("performance.summary", "Summary Statistics")}
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="sor-metric-summary-card">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <Wifi className="text-blue-400" size={16} />
          </div>
          <div>
            <div className="text-[10px] text-[var(--color-textMuted)] uppercase">
              Avg Latency
            </div>
            <div className="text-sm font-semibold text-[var(--color-text)]">
              {mgr.avgLatency.toFixed(1)}ms
            </div>
          </div>
        </div>
        <div className="sor-metric-summary-card">
          <div className="p-2 bg-green-500/10 rounded-lg">
            <Activity className="text-green-400" size={16} />
          </div>
          <div>
            <div className="text-[10px] text-[var(--color-textMuted)] uppercase">
              Avg Throughput
            </div>
            <div className="text-sm font-semibold text-[var(--color-text)]">
              {mgr.formatBytes(mgr.avgThroughput * 1024)}/s
            </div>
          </div>
        </div>
        <div className="sor-metric-summary-card">
          <div className="p-2 bg-yellow-500/10 rounded-lg">
            <Cpu className="text-yellow-400" size={16} />
          </div>
          <div>
            <div className="text-[10px] text-[var(--color-textMuted)] uppercase">
              Avg CPU
            </div>
            <div className="text-sm font-semibold text-[var(--color-text)]">
              {mgr.avgCpuUsage.toFixed(1)}%
            </div>
          </div>
        </div>
        <div className="sor-metric-summary-card">
          <div className="p-2 bg-purple-500/10 rounded-lg">
            <HardDrive className="text-purple-400" size={16} />
          </div>
          <div>
            <div className="text-[10px] text-[var(--color-textMuted)] uppercase">
              Avg Memory
            </div>
            <div className="text-sm font-semibold text-[var(--color-text)]">
              {mgr.avgMemoryUsage.toFixed(1)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SummaryStats;
