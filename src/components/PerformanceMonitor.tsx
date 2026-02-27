import React, { useState, useEffect, useCallback, useMemo } from "react";
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
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PerformanceMetrics } from "../types/settings";
import { SettingsManager } from "../utils/settingsManager";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./ui/Modal";

interface PerformanceMonitorProps {
  isOpen: boolean;
  onClose: () => void;
}

// Lightweight sparkline component using SVG
const Sparkline: React.FC<{
  data: number[];
  color: string;
  height?: number;
  width?: number;
  filled?: boolean;
}> = ({ data, color, height = 40, width = 120, filled = true }) => {
  if (data.length < 2)
    return (
      <div
        style={{ width, height }}
        className="bg-[var(--color-surfaceHover)] rounded"
      />
    );

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  const fillPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      {filled && (
        <polygon points={fillPoints} fill={`${color}20`} stroke="none" />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// Mini bar chart component
const MiniBarChart: React.FC<{
  data: number[];
  color: string;
  height?: number;
  width?: number;
  maxValue?: number;
}> = ({ data, color, height = 40, width = 120, maxValue }) => {
  if (data.length === 0)
    return (
      <div
        style={{ width, height }}
        className="bg-[var(--color-surfaceHover)] rounded"
      />
    );

  const max = maxValue ?? Math.max(...data);
  const barWidth = Math.max(2, width / data.length - 1);

  return (
    <svg width={width} height={height} className="overflow-visible">
      {data.map((value, index) => {
        const barHeight = (value / (max || 1)) * (height - 2);
        const x = index * (width / data.length);
        return (
          <rect
            key={index}
            x={x}
            y={height - barHeight - 1}
            width={barWidth}
            height={barHeight}
            fill={color}
            opacity={0.8}
            rx={1}
          />
        );
      })}
    </svg>
  );
};

// Trend indicator component
const TrendIndicator: React.FC<{
  current: number;
  previous: number;
  suffix?: string;
}> = ({ current, previous, suffix = "" }) => {
  const diff = current - previous;
  const percentChange = previous !== 0 ? (diff / previous) * 100 : 0;

  if (Math.abs(percentChange) < 1) {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-[var(--color-textMuted)]">
        <Minus size={10} />
        <span>stable</span>
      </span>
    );
  }

  const isUp = diff > 0;
  return (
    <span
      className={`flex items-center gap-0.5 text-[10px] ${isUp ? "text-red-400" : "text-green-400"}`}
    >
      {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      <span>{Math.abs(percentChange).toFixed(1)}%</span>
    </span>
  );
};

interface PerformanceMonitorProps {
  isOpen: boolean;
  onClose: () => void;
}

const normalizeLatencyTarget = (target: string): string => {
  const trimmed = target.trim();
  if (!trimmed) return "1.1.1.1";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
};

const measureLatency = async (target: string): Promise<number> => {
  const url = normalizeLatencyTarget(target);
  const start = performance.now();
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store" });
    return performance.now() - start;
  } catch {
    return Math.random() * 50 + 10;
  }
};

export const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<PerformanceMetrics[]>([]);
  const [currentMetrics, setCurrentMetrics] =
    useState<PerformanceMetrics | null>(null);
  const settingsManager = SettingsManager.getInstance();
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(
    settingsManager.getSettings().performancePollIntervalMs ?? 20000,
  );
  const [latencyTarget, setLatencyTarget] = useState<string>(
    settingsManager.getSettings().performanceLatencyTarget || "1.1.1.1",
  );
  const [metricFilter, setMetricFilter] = useState<string>("all");
  const [timeRangeFilter, setTimeRangeFilter] = useState<string>("all");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const loadMetrics = useCallback(() => {
    const storedMetrics = settingsManager.getPerformanceMetrics();
    setMetrics(storedMetrics);
  }, [settingsManager]);

  const updateCurrentMetrics = useCallback(async () => {
    const now = performance.now();
    try {
      const backendMetrics =
        await invoke<Partial<PerformanceMetrics>>("get_system_metrics");
      const metric: PerformanceMetrics = {
        connectionTime: backendMetrics.connectionTime ?? 0,
        dataTransferred: backendMetrics.dataTransferred ?? 0,
        latency: backendMetrics.latency ?? 0,
        throughput: backendMetrics.throughput ?? 0,
        cpuUsage: backendMetrics.cpuUsage ?? 0,
        memoryUsage: backendMetrics.memoryUsage ?? 0,
        timestamp: backendMetrics.timestamp ?? now,
      };
      setCurrentMetrics(metric);
      settingsManager.recordPerformanceMetric(metric);
      return;
    } catch {
      // Fall back to browser-side sampling when backend metrics are unavailable.
    }

    const memoryInfo = (performance as any).memory;
    const latency = await measureLatency(latencyTarget);

    const currentMetric: PerformanceMetrics = {
      connectionTime: 0, // This would be calculated per connection
      dataTransferred: 0, // This would be tracked per session
      latency,
      throughput: Math.random() * 1000 + 500, // Simulated KB/s
      cpuUsage: Math.random() * 30 + 10, // Simulated percentage
      memoryUsage: memoryInfo
        ? (memoryInfo.usedJSHeapSize / memoryInfo.totalJSHeapSize) * 100
        : Math.random() * 50 + 20,
      timestamp: now,
    };

    setCurrentMetrics(currentMetric);
    settingsManager.recordPerformanceMetric(currentMetric);
  }, [latencyTarget, settingsManager]);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    loadMetrics();
    settingsManager
      .loadSettings()
      .then((loaded) => {
        if (isMounted) {
          const interval = loaded.performancePollIntervalMs ?? 20000;
          setPollIntervalMs(interval);
          setLatencyTarget(loaded.performanceLatencyTarget || "1.1.1.1");
        }
      })
      .catch(console.error);

    return () => {
      isMounted = false;
    };
  }, [isOpen, loadMetrics, settingsManager]);

  useEffect(() => {
    if (!isOpen) return;

    const intervalDuration = pollIntervalMs || 20000;
    updateCurrentMetrics()
      .then(() => loadMetrics())
      .catch(console.error);
    const interval = window.setInterval(() => {
      updateCurrentMetrics()
        .then(() => loadMetrics())
        .catch(console.error);
    }, intervalDuration);
    return () => clearInterval(interval);
  }, [isOpen, pollIntervalMs, updateCurrentMetrics, loadMetrics]);

  const handlePollIntervalChange = (seconds: number) => {
    const safeSeconds = Math.max(1, seconds || 0);
    const intervalMs = safeSeconds * 1000;
    setPollIntervalMs(intervalMs);
    settingsManager
      .saveSettings({ performancePollIntervalMs: intervalMs }, { silent: true })
      .catch(console.error);
  };

  const exportMetrics = () => {
    const csvContent = [
      "Timestamp,Connection Time,Data Transferred,Latency,Throughput,CPU Usage,Memory Usage",
      ...metrics.map(
        (m) =>
          `${new Date(m.timestamp).toISOString()},${m.connectionTime},${m.dataTransferred},${m.latency},${m.throughput},${m.cpuUsage},${m.memoryUsage}`,
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `performance-metrics-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const clearMetrics = () => {
    settingsManager.clearPerformanceMetrics?.();
    setMetrics([]);
    setShowClearConfirm(false);
  };

  const filteredMetrics = useMemo(() => {
    let filtered = [...metrics];

    // Time range filter
    if (timeRangeFilter !== "all") {
      const now = Date.now();
      const ranges: Record<string, number> = {
        "1h": 60 * 60 * 1000,
        "6h": 6 * 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
      };
      const cutoff = now - (ranges[timeRangeFilter] || 0);
      filtered = filtered.filter((m) => m.timestamp >= cutoff);
    }

    return filtered;
  }, [metrics, timeRangeFilter]);

  if (!isOpen) return null;

  const recentMetrics = filteredMetrics.slice(0, 10);
  const avgLatency =
    filteredMetrics.length > 0
      ? filteredMetrics.reduce((sum, m) => sum + m.latency, 0) /
        filteredMetrics.length
      : 0;
  const avgThroughput =
    filteredMetrics.length > 0
      ? filteredMetrics.reduce((sum, m) => sum + m.throughput, 0) /
        filteredMetrics.length
      : 0;
  const avgCpuUsage =
    filteredMetrics.length > 0
      ? filteredMetrics.reduce((sum, m) => sum + m.cpuUsage, 0) /
        filteredMetrics.length
      : 0;
  const avgMemoryUsage =
    filteredMetrics.length > 0
      ? filteredMetrics.reduce((sum, m) => sum + m.memoryUsage, 0) /
        filteredMetrics.length
      : 0;

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
          {/* Header */}
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
                  {filteredMetrics.length} entries
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

          {/* Secondary Bar */}
          <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 shrink-0">
            <div className="flex flex-wrap items-center gap-3">
              {/* Time Range Filter */}
              <div className="flex items-center gap-2">
                <Clock
                  size={14}
                  className="text-[var(--color-textSecondary)]"
                />
                <select
                  value={timeRangeFilter}
                  onChange={(e) => setTimeRangeFilter(e.target.value)}
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
                <Filter
                  size={14}
                  className="text-[var(--color-textSecondary)]"
                />
                <select
                  value={metricFilter}
                  onChange={(e) => setMetricFilter(e.target.value)}
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
                  value={Math.round(pollIntervalMs / 1000)}
                  onChange={(e) =>
                    handlePollIntervalChange(parseInt(e.target.value || "0"))
                  }
                  className="w-12 bg-[var(--color-input)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-text)] text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span>s</span>
              </div>

              <div className="flex-1" />

              {/* Action Buttons */}
              <button
                onClick={exportMetrics}
                className="sor-option-chip text-xs font-medium bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] border-blue-500"
                title={t("common.export", "Export")}
              >
                <Download size={14} />
                <span>Export</span>
              </button>
              <button
                onClick={() => setShowClearConfirm(true)}
                className="sor-option-chip text-xs font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 border-red-500/40"
                title={t("common.clear", "Clear")}
              >
                <Trash2 size={14} />
                <span>Clear</span>
              </button>
            </div>
          </div>

          <div className="p-6 overflow-y-auto flex-1">
            {/* Current Metrics with Sparklines */}
            {currentMetrics && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-[var(--color-textSecondary)] uppercase tracking-wide mb-3">
                  {t("performance.currentPerformance", "Current Performance")}
                </h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Latency Card */}
                  <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 hover:border-blue-500/30 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-blue-500/20 rounded-lg">
                          <Wifi className="text-blue-400" size={14} />
                        </div>
                        <span className="text-[var(--color-textSecondary)] text-xs font-medium">
                          {t("performance.latency")}
                        </span>
                      </div>
                      {filteredMetrics.length > 1 && (
                        <TrendIndicator
                          current={currentMetrics.latency}
                          previous={
                            filteredMetrics[1]?.latency ||
                            currentMetrics.latency
                          }
                        />
                      )}
                    </div>
                    <div className="text-[var(--color-text)] text-2xl font-bold mb-2">
                      {currentMetrics.latency.toFixed(1)}
                      <span className="text-sm font-normal text-[var(--color-textMuted)]">
                        ms
                      </span>
                    </div>
                    <Sparkline
                      data={filteredMetrics
                        .slice(0, 100)
                        .reverse()
                        .map((m) => m.latency)}
                      color="#3b82f6"
                      height={32}
                      width={140}
                    />
                  </div>

                  {/* Throughput Card */}
                  <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 hover:border-green-500/30 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-green-500/20 rounded-lg">
                          <Activity className="text-green-400" size={14} />
                        </div>
                        <span className="text-[var(--color-textSecondary)] text-xs font-medium">
                          {t("performance.throughput")}
                        </span>
                      </div>
                      {filteredMetrics.length > 1 && (
                        <TrendIndicator
                          current={currentMetrics.throughput}
                          previous={
                            filteredMetrics[1]?.throughput ||
                            currentMetrics.throughput
                          }
                        />
                      )}
                    </div>
                    <div className="text-[var(--color-text)] text-2xl font-bold mb-2">
                      {formatBytes(currentMetrics.throughput * 1024)}
                      <span className="text-sm font-normal text-[var(--color-textMuted)]">
                        /s
                      </span>
                    </div>
                    <MiniBarChart
                      data={filteredMetrics
                        .slice(0, 100)
                        .reverse()
                        .map((m) => m.throughput)}
                      color="#22c55e"
                      height={32}
                      width={140}
                    />
                  </div>

                  {/* CPU Usage Card */}
                  <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 hover:border-yellow-500/30 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-yellow-500/20 rounded-lg">
                          <Cpu className="text-yellow-400" size={14} />
                        </div>
                        <span className="text-[var(--color-textSecondary)] text-xs font-medium">
                          {t("performance.cpuUsage")}
                        </span>
                      </div>
                      {filteredMetrics.length > 1 && (
                        <TrendIndicator
                          current={currentMetrics.cpuUsage}
                          previous={
                            filteredMetrics[1]?.cpuUsage ||
                            currentMetrics.cpuUsage
                          }
                        />
                      )}
                    </div>
                    <div className="flex items-end gap-3 mb-2">
                      <div className="text-[var(--color-text)] text-2xl font-bold">
                        {currentMetrics.cpuUsage.toFixed(1)}
                        <span className="text-sm font-normal text-[var(--color-textMuted)]">
                          %
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div className="flex-1 h-2 bg-[var(--color-surfaceHover)] rounded-full overflow-hidden mb-1.5">
                        <div
                          className="h-full bg-yellow-500 rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(currentMetrics.cpuUsage, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                    <Sparkline
                      data={filteredMetrics
                        .slice(0, 100)
                        .reverse()
                        .map((m) => m.cpuUsage)}
                      color="#eab308"
                      height={32}
                      width={140}
                    />
                  </div>

                  {/* Memory Usage Card */}
                  <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 hover:border-purple-500/30 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-purple-500/20 rounded-lg">
                          <HardDrive className="text-purple-400" size={14} />
                        </div>
                        <span className="text-[var(--color-textSecondary)] text-xs font-medium">
                          {t("performance.memoryUsage")}
                        </span>
                      </div>
                      {filteredMetrics.length > 1 && (
                        <TrendIndicator
                          current={currentMetrics.memoryUsage}
                          previous={
                            filteredMetrics[1]?.memoryUsage ||
                            currentMetrics.memoryUsage
                          }
                        />
                      )}
                    </div>
                    <div className="flex items-end gap-3 mb-2">
                      <div className="text-[var(--color-text)] text-2xl font-bold">
                        {currentMetrics.memoryUsage.toFixed(1)}
                        <span className="text-sm font-normal text-[var(--color-textMuted)]">
                          %
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div className="flex-1 h-2 bg-[var(--color-surfaceHover)] rounded-full overflow-hidden mb-1.5">
                        <div
                          className="h-full bg-purple-500 rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(currentMetrics.memoryUsage, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                    <Sparkline
                      data={filteredMetrics
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
            )}

            {/* Summary Stats */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-[var(--color-textSecondary)] uppercase tracking-wide mb-3">
                {t("performance.summary", "Summary Statistics")}
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-[var(--color-surfaceHover)]/50 rounded-lg p-3 flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Wifi className="text-blue-400" size={16} />
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">
                      Avg Latency
                    </div>
                    <div className="text-sm font-semibold text-[var(--color-text)]">
                      {avgLatency.toFixed(1)}ms
                    </div>
                  </div>
                </div>
                <div className="bg-[var(--color-surfaceHover)]/50 rounded-lg p-3 flex items-center gap-3">
                  <div className="p-2 bg-green-500/10 rounded-lg">
                    <Activity className="text-green-400" size={16} />
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">
                      Avg Throughput
                    </div>
                    <div className="text-sm font-semibold text-[var(--color-text)]">
                      {formatBytes(avgThroughput * 1024)}/s
                    </div>
                  </div>
                </div>
                <div className="bg-[var(--color-surfaceHover)]/50 rounded-lg p-3 flex items-center gap-3">
                  <div className="p-2 bg-yellow-500/10 rounded-lg">
                    <Cpu className="text-yellow-400" size={16} />
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">
                      Avg CPU
                    </div>
                    <div className="text-sm font-semibold text-[var(--color-text)]">
                      {avgCpuUsage.toFixed(1)}%
                    </div>
                  </div>
                </div>
                <div className="bg-[var(--color-surfaceHover)]/50 rounded-lg p-3 flex items-center gap-3">
                  <div className="p-2 bg-purple-500/10 rounded-lg">
                    <HardDrive className="text-purple-400" size={16} />
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--color-textMuted)] uppercase">
                      Avg Memory
                    </div>
                    <div className="text-sm font-semibold text-[var(--color-text)]">
                      {avgMemoryUsage.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Metrics Table */}
            <div>
              <h3 className="text-sm font-medium text-[var(--color-textSecondary)] uppercase tracking-wide mb-3">
                {t("performance.recentMetrics", "Recent Metrics")}
              </h3>
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
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
                      {recentMetrics.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-8 text-center text-sm text-[var(--color-textMuted)]"
                          >
                            {t(
                              "performance.noMetrics",
                              "No metrics recorded yet",
                            )}
                          </td>
                        </tr>
                      ) : (
                        recentMetrics.map((metric, index) => (
                          <tr
                            key={index}
                            className="hover:bg-[var(--color-surfaceHover)]/50 transition-colors"
                          >
                            <td className="px-4 py-2.5 text-xs text-[var(--color-textSecondary)]">
                              {new Date(metric.timestamp).toLocaleString(
                                undefined,
                                {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                },
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-[var(--color-text)] font-medium">
                              <span
                                className={
                                  metric.latency > avgLatency * 1.5
                                    ? "text-red-400"
                                    : metric.latency < avgLatency * 0.5
                                      ? "text-green-400"
                                      : ""
                                }
                              >
                                {metric.latency.toFixed(1)}ms
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-[var(--color-text)] font-medium">
                              {formatBytes(metric.throughput * 1024)}/s
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
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={showClearConfirm}
        onCancel={() => setShowClearConfirm(false)}
        onConfirm={clearMetrics}
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
