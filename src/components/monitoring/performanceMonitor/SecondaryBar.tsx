import React from "react";
import { Mgr } from "./types";
import { useTranslation } from "react-i18next";
import { Clock, Download, Filter, RefreshCw, Trash2 } from "lucide-react";
import { Select, NumberInput } from "../../ui/forms";

const SecondaryBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 shrink-0">
      <div className="flex flex-wrap items-center gap-3">
        {/* Time Range Filter */}
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-[var(--color-textSecondary)]" />
          <Select value={mgr.timeRangeFilter} onChange={(v: string) => mgr.setTimeRangeFilter(v)} options={[{ value: "all", label: "All Time" }, { value: "1h", label: "Last Hour" }, { value: "6h", label: "Last 6 Hours" }, { value: "24h", label: "Last 24 Hours" }, { value: "7d", label: "Last 7 Days" }]} className="bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg px-2 py-1 text-xs text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>

        {/* Metric Type Filter */}
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-[var(--color-textSecondary)]" />
          <Select value={mgr.metricFilter} onChange={(v: string) => mgr.setMetricFilter(v)} options={[{ value: "all", label: "All Metrics" }, { value: "latency", label: "Latency" }, { value: "throughput", label: "Throughput" }, { value: "cpu", label: "CPU Usage" }, { value: "memory", label: "Memory Usage" }]} className="bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg px-2 py-1 text-xs text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>

        {/* Update Interval */}
        <div className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <RefreshCw size={14} />
          <span>Update:</span>
          <NumberInput value={Math.round(mgr.pollIntervalMs / 1000)} onChange={(v: number) => mgr.handlePollIntervalChange(v)} variant="settings-compact" className="w-12 text-center" min={1} max={120} />
          <span>s</span>
        </div>

        <div className="flex-1" />

        {/* Action Buttons */}
        <button
          onClick={mgr.exportMetrics}
          className="sor-option-chip text-xs font-medium bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] border-blue-500"
          title={t("common.export", "Export")}
        >
          <Download size={14} />
          <span>Export</span>
        </button>
        <button
          onClick={() => mgr.setShowClearConfirm(true)}
          className="sor-option-chip text-xs font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 border-red-500/40"
          title={t("common.clear", "Clear")}
        >
          <Trash2 size={14} />
          <span>Clear</span>
        </button>
      </div>
    </div>
  );
};


export default SecondaryBar;
