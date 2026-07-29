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
          <Select value={mgr.timeRangeFilter} onChange={(v: string) => mgr.setTimeRangeFilter(v)} options={[{ value: "all", label: t("performance.timeRange.all", "All Time") }, { value: "1h", label: t("performance.timeRange.lastHour", "Last Hour") }, { value: "6h", label: t("performance.timeRange.last6Hours", "Last 6 Hours") }, { value: "24h", label: t("performance.timeRange.last24Hours", "Last 24 Hours") }, { value: "7d", label: t("performance.timeRange.last7Days", "Last 7 Days") }]} className="bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg px-2 py-1 text-xs text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>

        {/* Metric Type Filter */}
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-[var(--color-textSecondary)]" />
          <Select value={mgr.metricFilter} onChange={(v: string) => mgr.setMetricFilter(v)} options={[{ value: "all", label: t("performance.metricFilter.all", "All Metrics") }, { value: "latency", label: t("performance.latency", "Latency") }, { value: "throughput", label: t("performance.throughput", "Throughput") }, { value: "cpu", label: t("performance.cpuUsage", "CPU Usage") }, { value: "memory", label: t("performance.memoryUsage", "Memory Usage") }]} className="bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg px-2 py-1 text-xs text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>

        {/* Update Interval */}
        <div className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <RefreshCw size={14} />
          <span>{t("performance.updateLabel", "Update:")}</span>
          <NumberInput value={Math.round(mgr.pollIntervalMs / 1000)} onChange={(v: number) => mgr.handlePollIntervalChange(v)} variant="settings-compact" className="w-12 text-center" min={1} max={120} />
          <span>s</span>
        </div>

        <div className="flex-1" />

        {/* Action Buttons */}
        <button
          onClick={mgr.exportMetrics}
          className="sor-option-chip text-xs font-medium bg-primary hover:bg-secondary text-[var(--color-text)] border-primary"
          title={t("common.export", "Export")}
        >
          <Download size={14} />
          <span>{t("common.export", "Export")}</span>
        </button>
        <button
          onClick={() => mgr.setShowClearConfirm(true)}
          className="sor-option-chip text-xs font-medium bg-error/20 hover:bg-error/30 text-error border-error/40"
          title={t("common.clear", "Clear")}
        >
          <Trash2 size={14} />
          <span>{t("common.clear", "Clear")}</span>
        </button>
      </div>
    </div>
  );
};


export default SecondaryBar;
