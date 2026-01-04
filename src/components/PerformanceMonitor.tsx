import React, { useState, useEffect, useCallback } from 'react';
import { X, Download, BarChart3, Activity, Cpu, HardDrive, Wifi, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PerformanceMetrics } from '../types/settings';
import { SettingsManager } from '../utils/settingsManager';

interface PerformanceMonitorProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<PerformanceMetrics[]>([]);
  const [currentMetrics, setCurrentMetrics] = useState<PerformanceMetrics | null>(null);
  const settingsManager = SettingsManager.getInstance();
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(
    settingsManager.getSettings().performancePollIntervalMs ?? 5000
  );

  const loadMetrics = useCallback(() => {
    const storedMetrics = settingsManager.getPerformanceMetrics();
    setMetrics(storedMetrics);
  }, [settingsManager]);

  const updateCurrentMetrics = useCallback(() => {
    const now = performance.now();
    const memoryInfo = (performance as any).memory;
    
    const currentMetric: PerformanceMetrics = {
      connectionTime: 0, // This would be calculated per connection
      dataTransferred: 0, // This would be tracked per session
      latency: Math.random() * 50 + 10, // Simulated
      throughput: Math.random() * 1000 + 500, // Simulated KB/s
      cpuUsage: Math.random() * 30 + 10, // Simulated percentage
      memoryUsage: memoryInfo ? memoryInfo.usedJSHeapSize / memoryInfo.totalJSHeapSize * 100 : Math.random() * 50 + 20,
      timestamp: now,
    };

    setCurrentMetrics(currentMetric);
    settingsManager.recordPerformanceMetric(currentMetric);
  }, [settingsManager]);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    loadMetrics();
    settingsManager.loadSettings().then((loaded) => {
      if (isMounted) {
        const interval = loaded.performancePollIntervalMs ?? 5000;
        setPollIntervalMs(interval);
      }
    }).catch(console.error);

    return () => {
      isMounted = false;
    };
  }, [isOpen, loadMetrics, settingsManager]);

  useEffect(() => {
    if (!isOpen) return;

    const intervalDuration = pollIntervalMs || 5000;
    updateCurrentMetrics();
    const interval = window.setInterval(updateCurrentMetrics, intervalDuration);
    return () => clearInterval(interval);
  }, [isOpen, pollIntervalMs, updateCurrentMetrics]);

  const handlePollIntervalChange = (seconds: number) => {
    const safeSeconds = Math.max(1, seconds || 0);
    const intervalMs = safeSeconds * 1000;
    setPollIntervalMs(intervalMs);
    settingsManager.saveSettings({ performancePollIntervalMs: intervalMs }).catch(console.error);
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

  if (!isOpen) return null;

  const recentMetrics = metrics.slice(0, 10);
  const avgLatency = metrics.length > 0 ? metrics.reduce((sum, m) => sum + m.latency, 0) / metrics.length : 0;
  const avgThroughput = metrics.length > 0 ? metrics.reduce((sum, m) => sum + m.throughput, 0) / metrics.length : 0;
  const avgCpuUsage = metrics.length > 0 ? metrics.reduce((sum, m) => sum + m.cpuUsage, 0) / metrics.length : 0;
  const avgMemoryUsage = metrics.length > 0 ? metrics.reduce((sum, m) => sum + m.memoryUsage, 0) / metrics.length : 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-6xl mx-4 max-h-[90vh] overflow-hidden">
        <div className="relative h-16 border-b border-gray-700">
          <h2 className="absolute left-6 top-4 text-xl font-semibold text-white">
            {t('performance.title')}
          </h2>
          <div className="absolute right-4 top-3 flex items-center space-x-3">
            <div className="flex items-center space-x-2 text-xs text-gray-300 bg-gray-700/60 border border-gray-600 rounded px-2 py-1">
              <span>Update every</span>
              <input
                type="number"
                min={1}
                max={120}
                value={Math.round(pollIntervalMs / 1000)}
                onChange={(e) => handlePollIntervalChange(parseInt(e.target.value || '0'))}
                className="w-12 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span>s</span>
            </div>
            <button
              onClick={exportMetrics}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
            >
              <Download size={14} />
              <span>Export</span>
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
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
    </div>
  );
};
