import React from "react";
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
import { NumberInput } from "../../ui/forms";
import SectionHeading from "../../ui/SectionHeading";
import { InfoTooltip } from "../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../ui/settings/SettingsPrimitives";

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
  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Zap className="w-5 h-5 text-primary" />}
        title="Performance"
        description="Connection retry, performance monitoring, status checking, and action logging."
      />

      {/* Connection Retry */}
      <div className="space-y-4">
        <SectionHeader
          icon={<RefreshCw className="w-4 h-4 text-primary" />}
          title="Connection Retry"
        />
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <RefreshCw className="w-4 h-4" />
                Retry Attempts
                <InfoTooltip text="Number of times to retry a failed connection before giving up. Set to 0 to disable retries." />
              </label>
              <NumberInput
                value={settings.retryAttempts}
                onChange={(v: number) => updateSettings({ retryAttempts: v })}
                className="w-full"
                min={0}
                max={10}
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Clock className="w-4 h-4" />
                Retry Delay (ms)
                <InfoTooltip text="Time in milliseconds to wait between connection retry attempts." />
              </label>
              <NumberInput
                value={settings.retryDelay}
                onChange={(v: number) => updateSettings({ retryDelay: v })}
                className="w-full"
                min={1000}
                max={60000}
                step={1000}
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Performance Monitoring */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Gauge className="w-4 h-4 text-primary" />}
          title="Performance Monitoring"
        />
        <Card>
          <Toggle
            checked={settings.enablePerformanceTracking}
            onChange={(v) => updateSettings({ enablePerformanceTracking: v })}
            icon={<Activity size={16} />}
            label="Enable Performance Tracking"
            description="Sample CPU, memory, and latency metrics on a schedule"
            infoTooltip="Collect CPU, memory, and network latency metrics at regular intervals for monitoring dashboard display."
          />

          <div
            className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${!settings.enablePerformanceTracking ? "opacity-50 pointer-events-none" : ""}`}
          >
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Clock className="w-4 h-4" />
                Poll Interval (seconds)
                <InfoTooltip text="How often performance metrics are sampled. Lower values give more detail but use more resources." />
              </label>
              <NumberInput
                value={Math.round(settings.performancePollIntervalMs / 1000)}
                onChange={(v: number) =>
                  updateSettings({
                    performancePollIntervalMs: Math.max(1, v) * 1000,
                  })
                }
                className="w-full"
                min={1}
                max={120}
              />
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
        </Card>
      </div>

      {/* Status Checking */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Wifi className="w-4 h-4 text-primary" />}
          title="Status Checking"
        />
        <Card>
          <Toggle
            checked={settings.enableStatusChecking}
            onChange={(v) => updateSettings({ enableStatusChecking: v })}
            icon={<Zap size={16} />}
            label="Enable Status Checking"
            description="Periodically probe hosts and update connection status indicators"
            infoTooltip="Periodically probe connections to determine if remote hosts are reachable and update their status indicators."
          />

          <div
            className={`space-y-4 ${!settings.enableStatusChecking ? "opacity-50 pointer-events-none" : ""}`}
          >
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Clock className="w-4 h-4" />
                Check Interval (seconds)
                <InfoTooltip text="Time in seconds between status check probes sent to each connection's host." />
              </label>
              <NumberInput
                value={settings.statusCheckInterval}
                onChange={(v: number) =>
                  updateSettings({ statusCheckInterval: v })
                }
                className="w-full"
                min={10}
                max={300}
              />
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
        </Card>
      </div>

      {/* Action Logging */}
      <div className="space-y-4">
        <SectionHeader
          icon={<FileText className="w-4 h-4 text-primary" />}
          title="Action Logging"
        />
        <Card>
          <Toggle
            checked={settings.enableActionLog}
            onChange={(v) => updateSettings({ enableActionLog: v })}
            icon={<History size={16} />}
            label="Enable Action Logging"
            description="Record connections, disconnections, and setting changes in an internal log"
            infoTooltip="Record user actions like connections, disconnections, and setting changes in an internal log."
          />

          <div
            className={`space-y-2 ${!settings.enableActionLog ? "opacity-50 pointer-events-none" : ""}`}
          >
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <FileText className="w-4 h-4" />
              Max Log Entries
              <InfoTooltip text="Maximum number of log entries to keep in memory. Oldest entries are discarded when the limit is reached." />
            </label>
            <NumberInput
              value={settings.maxLogEntries}
              onChange={(v: number) => updateSettings({ maxLogEntries: v })}
              className="w-full"
              min={100}
              max={10000}
              step={100}
            />
          </div>
        </Card>
      </div>
    </div>
  );
};

export default PerformanceSettings;
