import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings } from "../../../types/settings";
import {
  Code,
  Layers,
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
} from "lucide-react";
import { Checkbox } from '../../ui/forms';
import SectionHeading from '../../ui/SectionHeading';

interface AdvancedSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const LOG_LEVEL_CONFIG = [
  {
    value: "debug",
    label: "Debug",
    icon: Bug,
    color: "text-purple-400",
    description: "All messages including debug info",
  },
  {
    value: "info",
    label: "Info",
    icon: Info,
    color: "text-blue-400",
    description: "Informational messages and above",
  },
  {
    value: "warn",
    label: "Warning",
    icon: AlertCircle,
    color: "text-yellow-400",
    description: "Warnings and errors only",
  },
  {
    value: "error",
    label: "Error",
    icon: AlertCircle,
    color: "text-red-400",
    description: "Errors only",
  },
];

const TAB_GROUPING_CONFIG = [
  { value: "none", label: "None", description: "No grouping" },
  {
    value: "protocol",
    label: "By Protocol",
    description: "Group by SSH, RDP, etc.",
  },
  {
    value: "status",
    label: "By Status",
    description: "Group by connection state",
  },
  {
    value: "hostname",
    label: "By Hostname",
    description: "Group by server name",
  },
];

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <SectionHeading icon={<Code className="w-5 h-5" />} title="Advanced" description="Tab grouping, logging level, tab naming, and diagnostics." />

      {/* Tab Grouping Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Layers className="w-4 h-4 text-blue-400" />
          Tab Grouping
        </h4>

        <div className="sor-settings-card">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {TAB_GROUPING_CONFIG.map((option) => (
              <button
                key={option.value}
                onClick={() =>
                  updateSettings({ tabGrouping: option.value as any })
                }
                className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                  settings.tabGrouping === option.value
                    ? "border-blue-500 bg-blue-600/20 text-[var(--color-text)] ring-1 ring-blue-500/50"
                    : "border-[var(--color-border)] bg-[var(--color-border)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:border-[var(--color-textSecondary)]"
                }`}
              >
                <Layers className="w-5 h-5 mb-1" />
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-[var(--color-textSecondary)] mt-1 text-center">
                  {option.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Logging Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <FileText className="w-4 h-4 text-green-400" />
          Logging
        </h4>

        <div className="sor-settings-card">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-3">
            Log Level
          </label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {LOG_LEVEL_CONFIG.map((level) => {
              const Icon = level.icon;
              return (
                <button
                  key={level.value}
                  onClick={() =>
                    updateSettings({ logLevel: level.value as any })
                  }
                  className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                    settings.logLevel === level.value
                      ? "border-blue-500 bg-blue-600/20 text-[var(--color-text)] ring-1 ring-blue-500/50"
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
        </div>
      </div>

      {/* Tab Naming Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Tags className="w-4 h-4 text-purple-400" />
          Tab Naming
        </h4>

        <div className="sor-settings-card">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.hostnameOverride} onChange={(v: boolean) => updateSettings({ hostnameOverride: v })} />
            <Terminal className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-purple-400" />
            <div>
              <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
                Override tab names with hostname
              </span>
              <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
                Display the server hostname instead of the connection name in
                tabs
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Diagnostics Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <ShieldAlert className="w-4 h-4 text-yellow-400" />
          Diagnostics
        </h4>

        <div className="sor-settings-card space-y-3">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.detectUnexpectedClose ?? true} onChange={(v: boolean) => updateSettings({ detectUnexpectedClose: v })} />
            <ShieldAlert className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-yellow-400" />
            <div>
              <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
                Detect unexpected app close
              </span>
              <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
                Show recovery options if the app was closed unexpectedly
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Settings Dialog Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Settings className="w-4 h-4" />
          Settings Dialog
        </h4>

        <div className="sor-settings-card space-y-3">
          <label
            data-setting-key="settingsDialog.autoSave"
            className="flex items-center space-x-3 cursor-pointer group"
          >
            <Checkbox checked={settings.settingsDialog?.autoSave ?? true} onChange={(v: boolean) => updateSettings({
                  settingsDialog: {
                    ...settings.settingsDialog,
                    showSaveButton:
                      settings.settingsDialog?.showSaveButton ?? false,
                    confirmBeforeReset:
                      settings.settingsDialog?.confirmBeforeReset ?? true,
                    autoSave: v,
                  },
                })} />
            <Save className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-blue-400" />
            <div>
              <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
                Auto-save settings
              </span>
              <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
                Automatically save changes as you make them (debounced). Disable
                to require an explicit Save click.
              </p>
            </div>
          </label>

          <label
            data-setting-key="settingsDialog.showSaveButton"
            className="flex items-center space-x-3 cursor-pointer group"
          >
            <Checkbox checked={settings.settingsDialog?.showSaveButton ?? false} onChange={(v: boolean) => updateSettings({
                  settingsDialog: {
                    ...settings.settingsDialog,
                    autoSave: settings.settingsDialog?.autoSave ?? true,
                    confirmBeforeReset:
                      settings.settingsDialog?.confirmBeforeReset ?? true,
                    showSaveButton: v,
                  },
                })} />
            <Save className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-green-400" />
            <div>
              <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
                Show save button
              </span>
              <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
                Show a manual save button in the settings header. Useful when
                auto-save is disabled.
              </p>
            </div>
          </label>

          <label
            data-setting-key="settingsDialog.confirmBeforeReset"
            className="flex items-center space-x-3 cursor-pointer group"
          >
            <Checkbox checked={settings.settingsDialog?.confirmBeforeReset ?? true} onChange={(v: boolean) => updateSettings({
                  settingsDialog: {
                    ...settings.settingsDialog,
                    autoSave: settings.settingsDialog?.autoSave ?? true,
                    showSaveButton:
                      settings.settingsDialog?.showSaveButton ?? false,
                    confirmBeforeReset: v,
                  },
                })} />
            <RotateCcw className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-orange-400" />
            <div>
              <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
                Confirm before reset
              </span>
              <p className="text-xs text-[var(--color-textMuted)] mt-0.5">
                Show a confirmation dialog before resetting a tab's settings to
                defaults.
              </p>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
};

export default AdvancedSettings;
