import React from "react";
import {
  X,
  Download,
  BarChart3,
  Activity,
  Cpu,
  HardDrive,
  Wifi,
  Clock,
  RefreshCw,
  Filter,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./ui/Modal";
import { Sparkline, MiniBarChart, TrendIndicator } from "./ui/Charts";
import { usePerformanceMonitor } from "../hooks/monitoring/usePerformanceMonitor";

type Mgr = ReturnType<typeof usePerformanceMonitor>;

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const MonitorHeader: React.FC<{
  mgr: Mgr;
  onClose: () => void;
}> = ({ mgr, onClose }) => {
  const { t } = useTranslation();
  return (
    <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-green-500/20 rounded-lg">
          <BarChart3 size={18} className="text-green-500" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">
            {t("performance.title")}
          </h2>
          <p className="text-xs text-[var(--color-textSecondary)]">
            {mgr.filteredMetrics.length} entries
          </p>
        </div>
      </div>
      <button
        onClick={onClose}
        className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
      >
        <X size={18} />
      </button>
    </div>
  );
};

const SecondaryBar: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 shrink-0">
      <div className="flex flex-wrap items-center gap-3">
        {/* Time Range Filter */}
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-[var(--color-textSecondary)]" />
          <select
            value={mgr.timeRangeFilter}
            onChange={(e) => mgr.setTimeRangeFilter(e.target.value)}
            className="bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg px-2 py-1 text-xs text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All Time</option>
            <option value="1h">Last Hour</option>
            <option value="6h">Last 6 Hours</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
          </select>
        </div>

        {/* Metric Type Filter */}
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-[var(--color-textSecondary)]" />
          <select
            value={mgr.metricFilter}
            onChange={(e) => mgr.setMetricFilter(e.target.value)}
            className="bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg px-2 py-1 text-xs text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All Metrics</option>
            <option value="latency">Latency</option>
            <option value="throughput">Throughput</option>
            <option value="cpu">CPU Usage</option>
            <option value="memory">Memory Usage</option>
          </select>
        </div>

        {/* Update Interval */}
        <div className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <RefreshCw size={14} />
          <span>Update:</span>
          <input
            type="number"
            min={1}
            max={120}
            value={Math.round(mgr.pollIntervalMs / 1000)}
            onChange={(e) =>
              mgr.handlePollIntervalChange(parseInt(e.target.value || "0"))
            }
            className="sor-settings-input sor-settings-input-compact sor-settings-input-sm w-12 text-center"
          />
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
                <th className="px-4 py-3 text-left text-[10px] font-medium text-[var(--color-textMuted)] uppercase tracking-wider">
                  <div className="flex items-center space-x-1.5">
                    <Clock size={11} />
                    <span>Time</span>
                  </div>
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-medium text-[var(--color-textMuted)] uppercase tracking-wider">
                  <div className="flex items-center space-x-1.5">
                    <Wifi size={11} className="text-blue-400" />
                    <span>Latency</span>
                  </div>
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-medium text-[var(--color-textMuted)] uppercase tracking-wider">
                  <div className="flex items-center space-x-1.5">
                    <Activity size={11} className="text-green-400" />
                    <span>Throughput</span>
                  </div>
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-medium text-[var(--color-textMuted)] uppercase tracking-wider">
                  <div className="flex items-center space-x-1.5">
                    <Cpu size={11} className="text-yellow-400" />
                    <span>CPU</span>
                  </div>
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-medium text-[var(--color-textMuted)] uppercase tracking-wider">
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

/* ------------------------------------------------------------------ */
/*  Root component                                                     */
/* ------------------------------------------------------------------ */

interface PerformanceMonitorProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = usePerformanceMonitor(isOpen);

  if (!isOpen) return null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        backdropClassName="bg-black/50"
        panelClassName="max-w-6xl h-[90vh] rounded-xl overflow-hidden border border-[var(--color-border)]"
        contentClassName="bg-[var(--color-surface)]"
      >
        <div className="flex flex-1 min-h-0 flex-col">
          <MonitorHeader mgr={mgr} onClose={onClose} />
          <SecondaryBar mgr={mgr} />
          <div className="p-6 overflow-y-auto flex-1">
            <CurrentMetricsGrid mgr={mgr} />
            <SummaryStats mgr={mgr} />
            <RecentMetricsTable mgr={mgr} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={mgr.showClearConfirm}
        onCancel={() => mgr.setShowClearConfirm(false)}
        onConfirm={mgr.clearMetrics}
        title={t("performance.clearTitle", "Clear Metrics")}
        message={t(
          "performance.clearConfirm",
          "Are you sure you want to clear all performance metrics? This action cannot be undone.",
        )}
        confirmText={t("common.clear", "Clear")}
        cancelText={t("common.cancel", "Cancel")}
        variant="danger"
      />
    </>
  );
};
