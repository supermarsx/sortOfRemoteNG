import React from 'react';
import { useTranslation } from 'react-i18next';
import { GlobalSettings, StatusCheckMethod } from '../../../types/settings';
import {
  Activity,
  RefreshCw,
  Clock,
  Globe,
  Wifi,
  FileText,
  Gauge,
  Radio,
  Zap,
  History,
} from 'lucide-react';

interface PerformanceSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const STATUS_CHECK_METHODS = [
  { value: 'socket', label: 'Socket', icon: Radio, description: 'Direct TCP connection check' },
  { value: 'http', label: 'HTTP', icon: Globe, description: 'HTTP request check' },
  { value: 'ping', label: 'Ping', icon: Wifi, description: 'ICMP ping check' },
];

export const PerformanceSettings: React.FC<PerformanceSettingsProps> = ({ settings, updateSettings }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
        <Zap className="w-5 h-5" />
        Performance
      </h3>
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Connection retry, performance monitoring, status checking, and action logging.
      </p>

      {/* Retry Settings Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-blue-400" />
          Connection Retry
        </h4>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <RefreshCw className="w-4 h-4" />
                Retry Attempts
              </label>
              <input
                type="number"
                value={settings.retryAttempts}
                onChange={(e) => updateSettings({ retryAttempts: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                min="0"
                max="10"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Clock className="w-4 h-4" />
                Retry Delay (ms)
              </label>
              <input
                type="number"
                value={settings.retryDelay}
                onChange={(e) => updateSettings({ retryDelay: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                min="1000"
                max="60000"
                step="1000"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Monitoring Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-green-400" />
          Performance Monitoring
        </h4>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4 space-y-4">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.enablePerformanceTracking}
              onChange={(e) => updateSettings({ enablePerformanceTracking: e.target.checked })}
              className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600 w-4 h-4"
            />
            <Activity className="w-4 h-4 text-gray-500 group-hover:text-green-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">Enable Performance Tracking</span>
          </label>

          <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${!settings.enablePerformanceTracking ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Clock className="w-4 h-4" />
                Poll Interval (seconds)
              </label>
              <input
                type="number"
                value={Math.round(settings.performancePollIntervalMs / 1000)}
                onChange={(e) =>
                  updateSettings({
                    performancePollIntervalMs: Math.max(1, parseInt(e.target.value || '0')) * 1000,
                  })
                }
                className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                min="1"
                max="120"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Globe className="w-4 h-4" />
                Latency Target Host
              </label>
              <input
                type="text"
                value={settings.performanceLatencyTarget}
                onChange={(e) =>
                  updateSettings({ performanceLatencyTarget: e.target.value || "1.1.1.1" })
                }
                className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                placeholder="1.1.1.1"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Status Checking Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Wifi className="w-4 h-4 text-purple-400" />
          Status Checking
        </h4>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4 space-y-4">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.enableStatusChecking}
              onChange={(e) => updateSettings({ enableStatusChecking: e.target.checked })}
              className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600 w-4 h-4"
            />
            <Zap className="w-4 h-4 text-gray-500 group-hover:text-purple-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">Enable Status Checking</span>
          </label>

          <div className={`space-y-4 ${!settings.enableStatusChecking ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Clock className="w-4 h-4" />
                Check Interval (seconds)
              </label>
              <input
                type="number"
                value={settings.statusCheckInterval}
                onChange={(e) => updateSettings({ statusCheckInterval: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                min="10"
                max="300"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)] mb-2">
                <Radio className="w-4 h-4" />
                Check Method
              </label>
              <div className="grid grid-cols-3 gap-2">
                {STATUS_CHECK_METHODS.map((method) => {
                  const Icon = method.icon;
                  return (
                    <button
                      key={method.value}
                      onClick={() => updateSettings({ statusCheckMethod: method.value as StatusCheckMethod })}
                      className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                        settings.statusCheckMethod === method.value
                          ? 'border-blue-500 bg-blue-600/20 text-[var(--color-text)] ring-1 ring-blue-500/50'
                          : 'border-[var(--color-border)] bg-[var(--color-border)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:border-[var(--color-textSecondary)]'
                      }`}
                    >
                      <Icon className={`w-5 h-5 mb-1 ${settings.statusCheckMethod === method.value ? 'text-purple-400' : ''}`} />
                      <span className="text-sm font-medium">{method.label}</span>
                      <span className="text-xs text-[var(--color-textSecondary)] mt-1 text-center">{method.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Logging Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <FileText className="w-4 h-4 text-yellow-400" />
          Action Logging
        </h4>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4 space-y-4">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.enableActionLog}
              onChange={(e) => updateSettings({ enableActionLog: e.target.checked })}
              className="rounded border-[var(--color-border)] bg-[var(--color-border)] text-blue-600 w-4 h-4"
            />
            <History className="w-4 h-4 text-gray-500 group-hover:text-yellow-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">Enable Action Logging</span>
          </label>

          <div className={`space-y-2 ${!settings.enableActionLog ? 'opacity-50 pointer-events-none' : ''}`}>
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <FileText className="w-4 h-4" />
              Max Log Entries
            </label>
            <input
              type="number"
              value={settings.maxLogEntries}
              onChange={(e) => updateSettings({ maxLogEntries: parseInt(e.target.value) })}
              className="w-full px-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
              min="100"
              max="10000"
              step="100"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PerformanceSettings;
