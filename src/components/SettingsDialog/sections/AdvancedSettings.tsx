import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings } from "../../../types/settings/settings";
import {
  Code,
  FileText,
  AlertCircle,
  AlertTriangle,
  Bug,
  Info,
  RotateCcw,
  Cpu,
  Power,
  Monitor,
  ExternalLink,
  HardDrive,
} from "lucide-react";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
} from "../../ui/settings/SettingsPrimitives";
import { SettingsSubGroupHeader as SubGroupHeader } from "../../ui/settings/NetworkPrimitives";
import { InfoTooltip } from "../../ui/InfoTooltip";
import {
  defaultMemoryWatchdogSettings,
  MemoryWatchdogSettings,
} from "../../../types/settings/settings";

interface AdvancedSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

/* ── Static option configs ───────────────────────────── */

const LOG_LEVEL_CONFIG = [
  {
    value: "debug",
    label: "Debug",
    icon: Bug,
    color: "text-primary",
    description: "All messages including debug info",
  },
  {
    value: "info",
    label: "Info",
    icon: Info,
    color: "text-primary",
    description: "Informational messages and above",
  },
  {
    value: "warn",
    label: "Warning",
    icon: AlertCircle,
    color: "text-warning",
    description: "Warnings and errors only",
  },
  {
    value: "error",
    label: "Error",
    icon: AlertCircle,
    color: "text-error",
    description: "Errors only",
  },
];

/* ── Main component ──────────────────────────────────── */

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t: _t } = useTranslation();
  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Code className="w-5 h-5 text-primary" />}
        title="Advanced"
        description="Logging level and the memory watchdog."
      />

      {/* Logging */}
      <div className="space-y-4">
        <SectionHeader
          icon={<FileText className="w-4 h-4 text-primary" />}
          title="Logging"
        />
        <Card>
          <label className="text-sm text-[var(--color-textSecondary)] mb-3 flex items-center gap-1">
            Log Level
            <InfoTooltip text="Minimum severity of log messages to record. Debug captures everything; Error captures only failures." />
          </label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {LOG_LEVEL_CONFIG.map((level) => {
              const Icon = level.icon;
              return (
                <button
                  key={level.value}
                  onClick={() => updateSettings({ logLevel: level.value as any })}
                  className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                    settings.logLevel === level.value
                      ? "border-primary bg-primary/20 text-[var(--color-text)] ring-1 ring-primary/50"
                      : "border-[var(--color-border)] bg-[var(--color-border)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:border-[var(--color-textSecondary)]"
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 mb-1 ${settings.logLevel === level.value ? level.color : ""}`}
                  />
                  <span className="text-sm font-medium">{level.label}</span>
                  <span className="text-xs text-[var(--color-textSecondary)] mt-1 text-center">
                    {level.description}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Memory Watchdog */}
      <MemoryWatchdogSection settings={settings} updateSettings={updateSettings} />
    </div>
  );
};

/* ── Memory Watchdog subsection ──────────────────────── */

const MemoryWatchdogSection: React.FC<AdvancedSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const mw = settings.memoryWatchdog ?? defaultMemoryWatchdogSettings;

  const update = (patch: Partial<MemoryWatchdogSettings>) => {
    updateSettings({ memoryWatchdog: { ...mw, ...patch } });
  };
  const updateDetached = (patch: Partial<MemoryWatchdogSettings["detached"]>) => {
    updateSettings({
      memoryWatchdog: {
        ...mw,
        detached: { ...mw.detached, ...patch },
      },
    });
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Cpu className="w-4 h-4 text-primary" />}
        title={
          <span className="flex items-center gap-2">
            Memory Watchdog
            <InfoTooltip text="Monitors JS heap and system RAM usage. Automatically tears down the page if thresholds are exceeded to protect your system from freezing." />
          </span>
        }
      />

      <Card>
        <Toggle
          icon={<Cpu size={16} />}
          label="Enable memory watchdog"
          description="Monitor JS heap and system RAM; tear down the page when thresholds are exceeded."
          checked={mw.enabled}
          onChange={(v) => update({ enabled: v })}
          infoTooltip="When disabled, no memory monitoring runs. The application will not be protected from runaway memory usage."
        />

        <div
          className={`flex flex-col gap-2.5 pt-3 border-t border-[var(--color-border)] ${!mw.enabled ? "opacity-50 pointer-events-none" : ""}`}
        >
          <SettingsNumberRow
            icon={<RotateCcw size={16} />}
            label="Poll Interval"
            value={mw.intervalMs}
            min={1000}
            max={30000}
            step={500}
            unit="ms"
            onChange={(v) => update({ intervalMs: v })}
            infoTooltip="How often the watchdog checks memory usage. Lower values detect leaks faster but use slightly more CPU."
          />

          <SubGroupHeader icon={<Monitor size={11} />} label="Main window heap" />

          <SettingsNumberRow
            icon={<AlertTriangle size={16} />}
            label="Main heap — Warning"
            value={mw.heapWarningMb}
            min={64}
            max={8192}
            unit="MB"
            onChange={(v) => update({ heapWarningMb: v })}
            infoTooltip="Main-window JS heap usage that triggers a warning log."
          />
          <SettingsNumberRow
            icon={<AlertCircle size={16} />}
            label="Main heap — Critical"
            value={mw.heapCriticalMb}
            min={128}
            max={8192}
            unit="MB"
            onChange={(v) => update({ heapCriticalMb: v })}
            infoTooltip="Main-window JS heap usage that surfaces an in-app overlay."
          />
          <SettingsNumberRow
            icon={<Power size={16} />}
            label="Main heap — Kill"
            value={mw.heapKillMb}
            min={256}
            max={16384}
            unit="MB"
            onChange={(v) => update({ heapKillMb: v })}
            infoTooltip="Main-window JS heap usage at which the page is torn down to protect the system."
          />

          <SubGroupHeader
            icon={<ExternalLink size={11} />}
            label="Detached window heap"
          />

          <SettingsNumberRow
            icon={<AlertTriangle size={16} />}
            label="Detached heap — Warning"
            value={mw.detached.heapWarningMb}
            min={64}
            max={8192}
            unit="MB"
            onChange={(v) => updateDetached({ heapWarningMb: v })}
            infoTooltip="Detached-window JS heap warning threshold (usually lower than the main window)."
          />
          <SettingsNumberRow
            icon={<AlertCircle size={16} />}
            label="Detached heap — Critical"
            value={mw.detached.heapCriticalMb}
            min={128}
            max={8192}
            unit="MB"
            onChange={(v) => updateDetached({ heapCriticalMb: v })}
            infoTooltip="Detached-window JS heap critical threshold."
          />
          <SettingsNumberRow
            icon={<Power size={16} />}
            label="Detached heap — Kill"
            value={mw.detached.heapKillMb}
            min={256}
            max={16384}
            unit="MB"
            onChange={(v) => updateDetached({ heapKillMb: v })}
            infoTooltip="Detached-window JS heap usage at which the window is torn down."
          />

          <SubGroupHeader
            icon={<HardDrive size={11} />}
            label="System RAM"
          />

          <SettingsNumberRow
            icon={<AlertTriangle size={16} />}
            label="System RAM — Warning"
            value={mw.systemWarningPct}
            min={50}
            max={99}
            unit="%"
            onChange={(v) => update({ systemWarningPct: v })}
            infoTooltip="OS-level physical RAM usage that triggers a warning log."
          />
          <SettingsNumberRow
            icon={<Power size={16} />}
            label="System RAM — Kill"
            value={mw.systemKillPct}
            min={60}
            max={99}
            unit="%"
            onChange={(v) => update({ systemKillPct: v })}
            infoTooltip="OS-level physical RAM usage at which the window is torn down to prevent the system from freezing. Requires the Tauri backend command."
          />
        </div>
      </Card>
    </div>
  );
};

export default AdvancedSettings;
