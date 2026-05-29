import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings } from "../../../types/settings/settings";
import {
  Monitor,
  Clock,
  Save,
  AlertTriangle,
  ExternalLink,
  History,
  LogOut,
  Trash2,
  MessageSquareWarning,
  Terminal,
  ShieldAlert,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import {
  SettingsCard as Card,
  SettingsSectionHeader as SectionHeader,
  SettingsToggleRow as Toggle,
  SettingsNumberRow,
} from "../../ui/settings/SettingsPrimitives";
import { SettingsConnectionTimeoutRow } from "../../ui/settings/NetworkPrimitives";
import SectionHeading from '../../ui/SectionHeading';

interface GeneralSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <SectionHeading icon={<Monitor className="w-5 h-5 text-primary" />} title="General" description="Autosave, safety prompts, connection behavior, and general application preferences." />

      {/* ── Data & safety ──────────────────────────────── */}

      <div className="space-y-4">
        <SectionHeader
          icon={<Save className="w-4 h-4 text-primary" />}
          title="Autosave"
        />
        <Card>
          <Toggle
            checked={settings.autoSaveEnabled}
            onChange={(value) => updateSettings({ autoSaveEnabled: value })}
            icon={<Save className="w-4 h-4" />}
            label="Enable autosave"
            settingKey="autoSaveEnabled"
            infoTooltip="Automatically save your connection file at regular intervals so changes are not lost if the app closes unexpectedly."
          />

          <div
            className={
              settings.autoSaveEnabled
                ? undefined
                : "opacity-50 pointer-events-none"
            }
          >
            <SettingsNumberRow
              settingKey="autoSaveIntervalMinutes"
              icon={<Clock className="w-4 h-4" />}
              label="Autosave Interval"
              value={settings.autoSaveIntervalMinutes}
              onChange={(v) => updateSettings({ autoSaveIntervalMinutes: v })}
              min={1}
              max={120}
              unit="min"
              infoTooltip="How often the connection file is automatically saved. Lower values save more frequently but may cause brief pauses on large files."
            />
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <SectionHeader
          icon={<AlertTriangle className="w-4 h-4 text-primary" />}
          title="Confirmation Warnings"
        />
        <Card>
          <Toggle
            checked={settings.warnOnClose}
            onChange={(value) => updateSettings({ warnOnClose: value })}
            icon={<AlertTriangle className="w-4 h-4" />}
            label={t("connections.warnOnClose")}
            settingKey="warnOnClose"
            infoTooltip="Show a confirmation dialog when you attempt to close a tab that has an active connection, preventing accidental disconnections."
          />

          <Toggle
            checked={settings.warnOnDetachClose}
            onChange={(value) => updateSettings({ warnOnDetachClose: value })}
            icon={<ExternalLink className="w-4 h-4" />}
            label={t("connections.warnOnDetachClose")}
            settingKey="warnOnDetachClose"
            infoTooltip="Show a confirmation dialog before closing a tab that has been detached into its own window."
          />

          <Toggle
            checked={settings.warnOnExit}
            onChange={(value) => updateSettings({ warnOnExit: value })}
            icon={<LogOut className="w-4 h-4" />}
            label={t("connections.warnOnExit")}
            settingKey="warnOnExit"
            infoTooltip="Show a warning when you try to quit the application while there are still active connections open."
          />

          <Toggle
            checked={settings.confirmMainAppClose ?? false}
            onChange={(value) => updateSettings({ confirmMainAppClose: value })}
            icon={<MessageSquareWarning className="w-4 h-4" />}
            label="Confirm main app close"
            description="Show a confirmation dialog before closing the main window"
            infoTooltip="Always prompt for confirmation before the main application window is closed, even if no connections are active."
          />
        </Card>
      </div>

      <div className="space-y-4">
        <SectionHeader
          icon={<ShieldAlert className="w-4 h-4 text-primary" />}
          title="Crash Recovery"
        />
        <Card>
          <Toggle
            icon={<ShieldAlert className="w-4 h-4" />}
            label="Detect unexpected app close"
            description="Show recovery options if the app was closed unexpectedly"
            checked={settings.detectUnexpectedClose ?? true}
            onChange={(v) => updateSettings({ detectUnexpectedClose: v })}
            infoTooltip="Monitor for abnormal application exits and offer session recovery options on next launch."
          />
        </Card>
      </div>

      {/* ── Connection behavior ────────────────────────── */}

      <div className="space-y-4">
        <SectionHeader
          icon={<Clock className="w-4 h-4 text-primary" />}
          title="Connections"
        />
        <Card>
          <SettingsConnectionTimeoutRow
            settingKey="connectionTimeout"
            label="Connection timeout"
            value={settings.connectionTimeout}
            onChange={(v) => updateSettings({ connectionTimeout: v })}
            min={5}
            max={300}
            infoTooltip="Maximum time in seconds to wait for a connection to be established before giving up. Increase this for slow or high-latency networks."
          />
        </Card>
      </div>

      <div className="space-y-4">
        <SectionHeader
          icon={<Terminal className="w-4 h-4 text-primary" />}
          title="Tab Naming"
        />
        <Card>
          <Toggle
            icon={<Terminal className="w-4 h-4" />}
            label="Override tab names with hostname"
            description="Display the server hostname instead of the connection name in tabs"
            checked={settings.hostnameOverride}
            onChange={(v) => updateSettings({ hostnameOverride: v })}
            infoTooltip="Display the resolved server hostname in tab titles instead of the user-defined connection name."
          />
        </Card>
      </div>

      <div className="space-y-4">
        <SectionHeader
          icon={<History className="w-4 h-4 text-primary" />}
          title="Quick Connect History"
        />
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Toggle
              checked={settings.quickConnectHistoryEnabled}
              onChange={(value) =>
                updateSettings({ quickConnectHistoryEnabled: value })
              }
              icon={<History className="w-4 h-4" />}
              label="Save Quick Connect history"
              settingKey="quickConnectHistoryEnabled"
              className="min-w-[280px]"
              infoTooltip="Remember previously used Quick Connect addresses so they can be quickly selected again. Disable to keep no history of ad-hoc connections."
            />
            <button
              type="button"
              onClick={() => updateSettings({ quickConnectHistory: [] })}
              disabled={(settings.quickConnectHistory?.length ?? 0) === 0}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-md bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-error/20 hover:text-error disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Clear history
            </button>
          </div>
          <p className="text-xs text-[var(--color-textMuted)]">
            {settings.quickConnectHistory?.length || 0} entries stored
          </p>
        </Card>
      </div>

      {/* ── Settings dialog (meta) ─────────────────────── */}

      <div className="space-y-4">
        <SectionHeader
          icon={<SlidersHorizontal className="w-4 h-4 text-primary" />}
          title="Settings Dialog"
        />
        <Card>
          <Toggle
            settingKey="settingsDialog.autoSave"
            icon={<Save className="w-4 h-4" />}
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
            icon={<Save className="w-4 h-4" />}
            label="Show save button"
            description="Always show a manual Save button in the settings footer. When auto-save is off it is shown regardless."
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
            infoTooltip="Always show a manual Save button in the settings footer for explicit saving. When auto-save is disabled the Save button appears automatically regardless of this setting."
          />

          <Toggle
            settingKey="settingsDialog.confirmBeforeReset"
            icon={<RotateCcw className="w-4 h-4" />}
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

export default GeneralSettings;
