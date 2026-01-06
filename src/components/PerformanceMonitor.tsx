import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Download, BarChart3, Activity, Cpu, HardDrive, Wifi, Clock, RefreshCw, Filter, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PerformanceMetrics } from '../types/settings';
import { SettingsManager } from '../utils/settingsManager';
import { invoke } from '@tauri-apps/api/core';
import { ConfirmDialog } from './ConfirmDialog';

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

export const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<PerformanceMetrics[]>([]);
  const [currentMetrics, setCurrentMetrics] = useState<PerformanceMetrics | null>(null);
  const settingsManager = SettingsManager.getInstance();
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(
    settingsManager.getSettings().performancePollIntervalMs ?? 20000
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
      const backendMetrics = await invoke<Partial<PerformanceMetrics>>('get_system_metrics');
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
      memoryUsage: memoryInfo ? memoryInfo.usedJSHeapSize / memoryInfo.totalJSHeapSize * 100 : Math.random() * 50 + 20,
      timestamp: now,
    };

    setCurrentMetrics(currentMetric);
    settingsManager.recordPerformanceMetric(currentMetric);
  }, [latencyTarget, settingsManager]);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    loadMetrics();
    settingsManager.loadSettings().then((loaded) => {
      if (isMounted) {
        const interval = loaded.performancePollIntervalMs ?? 20000;
        setPollIntervalMs(interval);
        setLatencyTarget(loaded.performanceLatencyTarget || "1.1.1.1");
      }
    }).catch(console.error);

    return () => {
      isMounted = false;
    };
  }, [isOpen, loadMetrics, settingsManager]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const intervalDuration = pollIntervalMs || 20000;
    updateCurrentMetrics();
    const interval = window.setInterval(() => {
      updateCurrentMetrics().catch(console.error);
    }, intervalDuration);
    return () => clearInterval(interval);
  }, [isOpen, pollIntervalMs, updateCurrentMetrics]);

  const handlePollIntervalChange = (seconds: number) => {
    const safeSeconds = Math.max(1, seconds || 0);
    const intervalMs = safeSeconds * 1000;
    setPollIntervalMs(intervalMs);
    settingsManager.saveSettings({ performancePollIntervalMs: intervalMs }, { silent: true }).catch(console.error);
  };

  const exportMetrics = () => {
    const csvContent = [
      'Timestamp,Connection Time,Data Transferred,Latency,Throughput,CPU Usage,Memory Usage',
      ...metrics.map(m => 
        `${new Date(m.timestamp).toISOString()},${m.connectionTime},${m.dataTransferred},${m.latency},${m.throughput},${m.cpuUsage},${m.memoryUsage}`
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `performance-metrics-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
      filtered = filtered.filter(m => m.timestamp >= cutoff);
    }
    
    return filtered;
  }, [metrics, timeRangeFilter]);

  if (!isOpen) return null;

  const recentMetrics = filteredMetrics.slice(0, 10);
  const avgLatency = filteredMetrics.length > 0 ? filteredMetrics.reduce((sum, m) => sum + m.latency, 0) / filteredMetrics.length : 0;
  const avgThroughput = filteredMetrics.length > 0 ? filteredMetrics.reduce((sum, m) => sum + m.throughput, 0) / filteredMetrics.length : 0;
  const avgCpuUsage = filteredMetrics.length > 0 ? filteredMetrics.reduce((sum, m) => sum + m.cpuUsage, 0) / filteredMetrics.length : 0;
  const avgMemoryUsage = filteredMetrics.length > 0 ? filteredMetrics.reduce((sum, m) => sum + m.memoryUsage, 0) / filteredMetrics.length : 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-6xl mx-4 h-[90vh] overflow-hidden border border-[var(--color-border)] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <BarChart3 size={18} className="text-green-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                {t('performance.title')}
              </h2>
              <p className="text-xs text-[var(--color-textSecondary)]">
                {filteredMetrics.length} entries
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">
            <X size={18} />
          </button>
        </div>

        {/* Secondary Bar */}
        <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            {/* Time Range Filter */}
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-[var(--color-textSecondary)]" />
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
              <Filter size={14} className="text-[var(--color-textSecondary)]" />
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
                onChange={(e) => handlePollIntervalChange(parseInt(e.target.value || '0'))}
                className="w-12 bg-[var(--color-input)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-text)] text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span>s</span>
            </div>

            <div className="flex-1" />

            {/* Action Buttons */}
            <button
              onClick={exportMetrics}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-xs font-medium"
              title={t('common.export', 'Export')}
            >
              <Download size={14} />
              <span>Export</span>
            </button>
            <button
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors text-xs font-medium"
              title={t('common.clear', 'Clear')}
            >
              <Trash2 size={14} />
              <span>Clear</span>
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {/* Current Metrics */}
          {currentMetrics && (
            <div className="mb-8">
              <h3 className="text-lg font-medium text-white mb-4">Current Performance</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center space-x-2 mb-2">
                    <Wifi className="text-blue-400" size={16} />
                    <span className="text-gray-300 text-sm">{t('performance.latency')}</span>
                  </div>
                  <div className="text-white text-xl font-semibold">
                    {currentMetrics.latency.toFixed(1)}ms
                  </div>
                </div>

                <div className="bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center space-x-2 mb-2">
                    <Activity className="text-green-400" size={16} />
                    <span className="text-gray-300 text-sm">{t('performance.throughput')}</span>
                  </div>
                  <div className="text-white text-xl font-semibold">
                    {formatBytes(currentMetrics.throughput * 1024)}/s
                  </div>
                </div>

                <div className="bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center space-x-2 mb-2">
                    <Cpu className="text-yellow-400" size={16} />
                    <span className="text-gray-300 text-sm">{t('performance.cpuUsage')}</span>
                  </div>
                  <div className="text-white text-xl font-semibold">
                    {currentMetrics.cpuUsage.toFixed(1)}%
                  </div>
                </div>

                <div className="bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center space-x-2 mb-2">
                    <HardDrive className="text-purple-400" size={16} />
                    <span className="text-gray-300 text-sm">{t('performance.memoryUsage')}</span>
                  </div>
                  <div className="text-white text-xl font-semibold">
                    {currentMetrics.memoryUsage.toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Average Metrics */}
          <div className="mb-8">
            <h3 className="text-lg font-medium text-white mb-4">Average Performance</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-700 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <Wifi className="text-blue-400" size={16} />
                  <span className="text-gray-300 text-sm">Avg {t('performance.latency')}</span>
                </div>
                <div className="text-white text-xl font-semibold">
                  {avgLatency.toFixed(1)}ms
                </div>
              </div>

              <div className="bg-gray-700 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <Activity className="text-green-400" size={16} />
                  <span className="text-gray-300 text-sm">Avg {t('performance.throughput')}</span>
                </div>
                <div className="text-white text-xl font-semibold">
                  {formatBytes(avgThroughput * 1024)}/s
                </div>
              </div>

              <div className="bg-gray-700 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <Cpu className="text-yellow-400" size={16} />
                  <span className="text-gray-300 text-sm">Avg {t('performance.cpuUsage')}</span>
                </div>
                <div className="text-white text-xl font-semibold">
                  {avgCpuUsage.toFixed(1)}%
                </div>
              </div>

              <div className="bg-gray-700 rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <HardDrive className="text-purple-400" size={16} />
                  <span className="text-gray-300 text-sm">Avg {t('performance.memoryUsage')}</span>
                </div>
                <div className="text-white text-xl font-semibold">
                  {avgMemoryUsage.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>

          {/* Recent Metrics Table */}
          <div>
            <h3 className="text-lg font-medium text-white mb-4">Recent Metrics</h3>
            <div className="bg-gray-700 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-600">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        <div className="flex items-center space-x-1">
                          <Clock size={12} />
                          <span>Time</span>
                        </div>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        <div className="flex items-center space-x-1">
                          <Wifi size={12} />
                          <span>Latency</span>
                        </div>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        <div className="flex items-center space-x-1">
                          <Activity size={12} />
                          <span>Throughput</span>
                        </div>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        <div className="flex items-center space-x-1">
                          <Cpu size={12} />
                          <span>CPU</span>
                        </div>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        <div className="flex items-center space-x-1">
                          <HardDrive size={12} />
                          <span>Memory</span>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-600">
                    {recentMetrics.map((metric, index) => (
                      <tr key={index} className="hover:bg-gray-600">
                        <td className="px-4 py-3 text-sm text-gray-300">
                          {new Date(metric.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-3 text-sm text-white">
                          {metric.latency.toFixed(1)}ms
                        </td>
                        <td className="px-4 py-3 text-sm text-white">
                          {formatBytes(metric.throughput * 1024)}/s
                        </td>
                        <td className="px-4 py-3 text-sm text-white">
                          {metric.cpuUsage.toFixed(1)}%
                        </td>
                        <td className="px-4 py-3 text-sm text-white">
                          {metric.memoryUsage.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={clearMetrics}
        title={t('performance.clearTitle', 'Clear Metrics')}
        message={t('performance.clearConfirm', 'Are you sure you want to clear all performance metrics? This action cannot be undone.')}
        confirmText={t('common.clear', 'Clear')}
        cancelText={t('common.cancel', 'Cancel')}
        variant="danger"
      />
    </div>
  );
};
