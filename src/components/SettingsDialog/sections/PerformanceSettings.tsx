import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings, StatusCheckMethod } from "../../../types/settings/settings";
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
} from "lucide-react";
import { Checkbox, NumberInput } from '../../ui/forms';
import SectionHeading from '../../ui/SectionHeading';
import { InfoTooltip } from '../../ui/InfoTooltip';

interface PerformanceSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const STATUS_CHECK_METHODS = [
  {
    value: "socket",
    label: "Socket",
    icon: Radio,
    description: "Direct TCP connection check",
  },
  {
    value: "http",
    label: "HTTP",
    icon: Globe,
    description: "HTTP request check",
  },
  { value: "ping", label: "Ping", icon: Wifi, description: "ICMP ping check" },
];

export const PerformanceSettings: React.FC<PerformanceSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <SectionHeading icon={<Zap className="w-5 h-5" />} title="Performance" description="Connection retry, performance monitoring, status checking, and action logging." />

      {/* Retry Settings Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <RefreshCw className="w-4 h-4 text-primary" />
          Connection Retry
        </h4>

        <div className="sor-settings-card">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <RefreshCw className="w-4 h-4" />
                Retry Attempts
                <InfoTooltip text="Number of times to retry a failed connection before giving up. Set to 0 to disable retries." />
              </label>
              <NumberInput value={settings.retryAttempts} onChange={(v: number) => updateSettings({ retryAttempts: v })} className="w-full" min={0} max={10} />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Clock className="w-4 h-4" />
                Retry Delay (ms)
                <InfoTooltip text="Time in milliseconds to wait between connection retry attempts." />
              </label>
              <NumberInput value={settings.retryDelay} onChange={(v: number) => updateSettings({ retryDelay: v })} className="w-full" min={1000} max={60000} step={1000} />
            </div>
          </div>
        </div>
      </div>

      {/* Monitoring Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Gauge className="w-4 h-4 text-success" />
          Performance Monitoring
        </h4>

        <div className="sor-settings-card">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.enablePerformanceTracking} onChange={(v: boolean) => updateSettings({ enablePerformanceTracking: v })} />
            <Activity className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-success" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              Enable Performance Tracking
              <InfoTooltip text="Collect CPU, memory, and network latency metrics at regular intervals for monitoring dashboard display." />
            </span>
          </label>

          <div
            className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${!settings.enablePerformanceTracking ? "opacity-50 pointer-events-none" : ""}`}
          >
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Clock className="w-4 h-4" />
                Poll Interval (seconds)
                <InfoTooltip text="How often performance metrics are sampled. Lower values give more detail but use more resources." />
              </label>
              <NumberInput value={Math.round(settings.performancePollIntervalMs / 1000)} onChange={(v: number) => updateSettings({
                    performancePollIntervalMs:
                      Math.max(1, v) * 1000,
                  })} className="w-full" min={1} max={120} />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Globe className="w-4 h-4" />
                Latency Target Host
                <InfoTooltip text="IP address or hostname used to measure network latency via ping or HTTP request." />
              </label>
              <input
                type="text"
                value={settings.performanceLatencyTarget}
                onChange={(e) =>
                  updateSettings({
                    performanceLatencyTarget: e.target.value || "1.1.1.1",
                  })
                }
                className="sor-settings-input w-full"
                placeholder="1.1.1.1"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Status Checking Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Wifi className="w-4 h-4 text-primary" />
          Status Checking
        </h4>

        <div className="sor-settings-card">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.enableStatusChecking} onChange={(v: boolean) => updateSettings({ enableStatusChecking: v })} />
            <Zap className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-primary" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              Enable Status Checking
              <InfoTooltip text="Periodically probe connections to determine if remote hosts are reachable and update their status indicators." />
            </span>
          </label>

          <div
            className={`space-y-4 ${!settings.enableStatusChecking ? "opacity-50 pointer-events-none" : ""}`}
          >
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Clock className="w-4 h-4" />
                Check Interval (seconds)
                <InfoTooltip text="Time in seconds between status check probes sent to each connection's host." />
              </label>
              <NumberInput value={settings.statusCheckInterval} onChange={(v: number) => updateSettings({
                    statusCheckInterval: v,
                  })} className="w-full" min={10} max={300} />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)] mb-2">
                <Radio className="w-4 h-4" />
                Check Method
                <InfoTooltip text="Protocol used to check if a remote host is reachable. Socket is fastest; HTTP validates web services; Ping uses ICMP." />
              </label>
              <div className="grid grid-cols-3 gap-2">
                {STATUS_CHECK_METHODS.map((method) => {
                  const Icon = method.icon;
                  return (
                    <button
                      key={method.value}
                      onClick={() =>
                        updateSettings({
                          statusCheckMethod: method.value as StatusCheckMethod,
                        })
                      }
                      className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                        settings.statusCheckMethod === method.value
                          ? "border-primary bg-primary/20 text-[var(--color-text)] ring-1 ring-primary/50"
                          : "border-[var(--color-border)] bg-[var(--color-border)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:border-[var(--color-textSecondary)]"
                      }`}
                    >
                      <Icon
                        className={`w-5 h-5 mb-1 ${settings.statusCheckMethod === method.value ? "text-primary" : ""}`}
                      />
                      <span className="text-sm font-medium">
                        {method.label}
                      </span>
                      <span className="text-xs text-[var(--color-textSecondary)] mt-1 text-center">
                        {method.description}
                      </span>
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
        <h4 className="sor-section-heading">
          <FileText className="w-4 h-4 text-warning" />
          Action Logging
        </h4>

        <div className="sor-settings-card">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.enableActionLog} onChange={(v: boolean) => updateSettings({ enableActionLog: v })} />
            <History className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-warning" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)] flex items-center gap-1">
              Enable Action Logging
              <InfoTooltip text="Record user actions like connections, disconnections, and setting changes in an internal log." />
            </span>
          </label>

          <div
            className={`space-y-2 ${!settings.enableActionLog ? "opacity-50 pointer-events-none" : ""}`}
          >
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <FileText className="w-4 h-4" />
              Max Log Entries
              <InfoTooltip text="Maximum number of log entries to keep in memory. Oldest entries are discarded when the limit is reached." />
            </label>
            <NumberInput value={settings.maxLogEntries} onChange={(v: number) => updateSettings({ maxLogEntries: v })} className="w-full" min={100} max={10000} step={100} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PerformanceSettings;
