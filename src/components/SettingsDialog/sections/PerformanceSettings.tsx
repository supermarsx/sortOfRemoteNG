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
  Timer,
  Target,
  Hash,
} from "lucide-react";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
  SettingsTextRow,
  SettingsSelectRow,
} from "../../ui/settings/SettingsPrimitives";

interface PerformanceSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const STATUS_CHECK_OPTIONS = [
  { value: "socket", label: "Socket — direct TCP connection check" },
  { value: "http", label: "HTTP — HTTP request check" },
  { value: "ping", label: "Ping — ICMP echo check" },
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
          <SettingsNumberRow
            settingKey="retryAttempts"
            icon={<RefreshCw size={16} />}
            label="Retry attempts"
            value={settings.retryAttempts}
            min={0}
            max={10}
            onChange={(v) => updateSettings({ retryAttempts: v })}
            infoTooltip="Number of times to retry a failed connection before giving up. Set to 0 to disable retries."
          />

          <SettingsNumberRow
            settingKey="retryDelay"
            icon={<Timer size={16} />}
            label="Retry delay"
            value={settings.retryDelay}
            min={1000}
            max={60000}
            step={1000}
            unit="ms"
            onChange={(v) => updateSettings({ retryDelay: v })}
            infoTooltip="Time in milliseconds to wait between connection retry attempts."
          />
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
            label="Enable performance tracking"
            description="Sample CPU, memory, and latency metrics on a schedule."
            infoTooltip="Collect CPU, memory, and network latency metrics at regular intervals for monitoring dashboard display."
          />

          <div
            className={`flex flex-col gap-2.5 ${
              settings.enablePerformanceTracking
                ? ""
                : "opacity-50 pointer-events-none"
            }`}
          >
            <SettingsNumberRow
              settingKey="performancePollIntervalMs"
              icon={<Clock size={16} />}
              label="Poll interval"
              value={Math.round(settings.performancePollIntervalMs / 1000)}
              min={1}
              max={120}
              unit="s"
              onChange={(v) =>
                updateSettings({
                  performancePollIntervalMs: Math.max(1, v) * 1000,
                })
              }
              infoTooltip="How often performance metrics are sampled. Lower values give more detail but use more resources."
            />

            <SettingsTextRow
              settingKey="performanceLatencyTarget"
              icon={<Target size={16} />}
              label="Latency target host"
              value={settings.performanceLatencyTarget}
              placeholder="1.1.1.1"
              onChange={(v) =>
                updateSettings({
                  performanceLatencyTarget: v || "1.1.1.1",
                })
              }
              infoTooltip="IP address or hostname used to measure network latency via ping or HTTP request."
            />
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
            label="Enable status checking"
            description="Periodically probe hosts and update connection status indicators."
            infoTooltip="Periodically probe connections to determine if remote hosts are reachable and update their status indicators."
          />

          <div
            className={`flex flex-col gap-2.5 ${
              settings.enableStatusChecking
                ? ""
                : "opacity-50 pointer-events-none"
            }`}
          >
            <SettingsNumberRow
              settingKey="statusCheckInterval"
              icon={<Clock size={16} />}
              label="Check interval"
              value={settings.statusCheckInterval}
              min={10}
              max={300}
              unit="s"
              onChange={(v) => updateSettings({ statusCheckInterval: v })}
              infoTooltip="Time in seconds between status check probes sent to each connection's host."
            />

            <SettingsSelectRow
              settingKey="statusCheckMethod"
              icon={<Radio size={16} />}
              label="Check method"
              value={settings.statusCheckMethod}
              options={STATUS_CHECK_OPTIONS}
              onChange={(v) =>
                updateSettings({
                  statusCheckMethod: v as StatusCheckMethod,
                })
              }
              infoTooltip="Protocol used to check if a remote host is reachable. Socket is fastest; HTTP validates web services; Ping uses ICMP."
            />
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
            label="Enable action logging"
            description="Record connections, disconnections, and setting changes in an internal log."
            infoTooltip="Record user actions like connections, disconnections, and setting changes in an internal log."
          />

          <div
            className={
              settings.enableActionLog
                ? undefined
                : "opacity-50 pointer-events-none"
            }
          >
            <SettingsNumberRow
              settingKey="maxLogEntries"
              icon={<Hash size={16} />}
              label="Max log entries"
              value={settings.maxLogEntries}
              min={100}
              max={10000}
              step={100}
              unit="entries"
              onChange={(v) => updateSettings({ maxLogEntries: v })}
              infoTooltip="Maximum number of log entries to keep in memory. Oldest entries are discarded when the limit is reached."
            />
          </div>
        </Card>
      </div>
    </div>
  );
};

export default PerformanceSettings;
