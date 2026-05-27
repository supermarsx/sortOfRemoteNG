import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings } from "../../../types/settings/settings";
import {
  Code,
  FileText,
  Terminal,
  Tags,
  AlertCircle,
  Bug,
  Info,
  ShieldAlert,
  Settings,
  Save,
  RotateCcw,
  Cpu,
} from "lucide-react";
import { NumberInput } from "../../ui/forms";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
} from "../../ui/settings/SettingsPrimitives";
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
        description="Logging level, tab naming, diagnostics, and the memory watchdog."
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

      {/* Tab Naming */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Tags className="w-4 h-4 text-primary" />}
          title="Tab Naming"
        />
        <Card>
          <Toggle
            icon={<Terminal size={16} />}
            label="Override tab names with hostname"
            description="Display the server hostname instead of the connection name in tabs"
            checked={settings.hostnameOverride}
            onChange={(v) => updateSettings({ hostnameOverride: v })}
            infoTooltip="Display the resolved server hostname in tab titles instead of the user-defined connection name."
          />
        </Card>
      </div>

      {/* Diagnostics */}
      <div className="space-y-4">
        <SectionHeader
          icon={<ShieldAlert className="w-4 h-4 text-primary" />}
          title="Diagnostics"
        />
        <Card>
          <Toggle
            icon={<ShieldAlert size={16} />}
            label="Detect unexpected app close"
            description="Show recovery options if the app was closed unexpectedly"
            checked={settings.detectUnexpectedClose ?? true}
            onChange={(v) => updateSettings({ detectUnexpectedClose: v })}
            infoTooltip="Monitor for abnormal application exits and offer session recovery options on next launch."
          />
        </Card>
      </div>

      {/* Memory Watchdog */}
      <MemoryWatchdogSection settings={settings} updateSettings={updateSettings} />

      {/* Settings Dialog */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Settings className="w-4 h-4 text-primary" />}
          title="Settings Dialog"
        />
        <Card>
          <Toggle
            settingKey="settingsDialog.autoSave"
            icon={<Save size={16} />}
            label="Auto-save settings"
            description="Automatically save changes as you make them (debounced). Disable to require an explicit Save click."
            checked={settings.settingsDialog?.autoSave ?? true}
            onChange={(v) =>
              updateSettings({
                settingsDialog: {
                  ...settings.settingsDialog,
                  showSaveButton: settings.settingsDialog?.showSaveButton ?? false,
                  confirmBeforeReset: settings.settingsDialog?.confirmBeforeReset ?? true,
                  autoSave: v,
                },
              })
            }
            infoTooltip="Automatically persist settings changes as you make them, with a short debounce delay."
          />

          <Toggle
            settingKey="settingsDialog.showSaveButton"
            icon={<Save size={16} />}
            label="Show save button"
            description="Show a manual save button in the settings header. Useful when auto-save is disabled."
            checked={settings.settingsDialog?.showSaveButton ?? false}
            onChange={(v) =>
              updateSettings({
                settingsDialog: {
                  ...settings.settingsDialog,
                  autoSave: settings.settingsDialog?.autoSave ?? true,
                  confirmBeforeReset: settings.settingsDialog?.confirmBeforeReset ?? true,
                  showSaveButton: v,
                },
              })
            }
            infoTooltip="Display a manual save button in the settings header for explicit saving, useful when auto-save is disabled."
          />

          <Toggle
            settingKey="settingsDialog.confirmBeforeReset"
            icon={<RotateCcw size={16} />}
            label="Confirm before reset"
            description="Show a confirmation dialog before resetting a tab's settings to defaults."
            checked={settings.settingsDialog?.confirmBeforeReset ?? true}
            onChange={(v) =>
              updateSettings({
                settingsDialog: {
                  ...settings.settingsDialog,
                  autoSave: settings.settingsDialog?.autoSave ?? true,
                  showSaveButton: settings.settingsDialog?.showSaveButton ?? false,
                  confirmBeforeReset: v,
                },
              })
            }
            infoTooltip="Show a confirmation dialog before resetting a settings tab back to its default values."
          />
        </Card>
      </div>
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

  // Default NumberInput variant already applies `.sor-settings-input`.
  const inputCls = "text-sm";

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
          className={`space-y-4 pt-3 border-t border-[var(--color-border)] ${!mw.enabled ? "opacity-50 pointer-events-none" : ""}`}
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

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-2 flex items-center gap-1">
              JS Heap Thresholds (Main Window)
              <InfoTooltip text="Memory thresholds for the main application window's JavaScript heap. Warning logs to console, Critical shows an overlay, Kill tears down the page." />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[var(--color-textMuted)] mb-1">Warning (MB)</label>
                <NumberInput
                  value={mw.heapWarningMb}
                  onChange={(v: number) => update({ heapWarningMb: v })}
                  className={inputCls}
                  min={64}
                  max={8192}
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-textMuted)] mb-1">Critical (MB)</label>
                <NumberInput
                  value={mw.heapCriticalMb}
                  onChange={(v: number) => update({ heapCriticalMb: v })}
                  className={inputCls}
                  min={128}
                  max={8192}
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-textMuted)] mb-1">Kill (MB)</label>
                <NumberInput
                  value={mw.heapKillMb}
                  onChange={(v: number) => update({ heapKillMb: v })}
                  className={inputCls}
                  min={256}
                  max={16384}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-2 flex items-center gap-1">
              JS Heap Thresholds (Detached Windows)
              <InfoTooltip text="Separate, typically lower thresholds for detached session windows since they should be lightweight." />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[var(--color-textMuted)] mb-1">Warning (MB)</label>
                <NumberInput
                  value={mw.detached.heapWarningMb}
                  onChange={(v: number) => updateDetached({ heapWarningMb: v })}
                  className={inputCls}
                  min={64}
                  max={8192}
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-textMuted)] mb-1">Critical (MB)</label>
                <NumberInput
                  value={mw.detached.heapCriticalMb}
                  onChange={(v: number) => updateDetached({ heapCriticalMb: v })}
                  className={inputCls}
                  min={128}
                  max={8192}
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-textMuted)] mb-1">Kill (MB)</label>
                <NumberInput
                  value={mw.detached.heapKillMb}
                  onChange={(v: number) => updateDetached({ heapKillMb: v })}
                  className={inputCls}
                  min={256}
                  max={16384}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-2 flex items-center gap-1">
              System RAM Thresholds (%)
              <InfoTooltip text="OS-level physical memory thresholds. When system RAM exceeds the kill percentage, the window is torn down to prevent the entire system from freezing. Requires a Tauri backend command." />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--color-textMuted)] mb-1">Warning (%)</label>
                <NumberInput
                  value={mw.systemWarningPct}
                  onChange={(v: number) => update({ systemWarningPct: v })}
                  className={inputCls}
                  min={50}
                  max={99}
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-textMuted)] mb-1">Kill (%)</label>
                <NumberInput
                  value={mw.systemKillPct}
                  onChange={(v: number) => update({ systemKillPct: v })}
                  className={inputCls}
                  min={60}
                  max={99}
                />
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default AdvancedSettings;
