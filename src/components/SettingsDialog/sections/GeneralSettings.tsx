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
} from "lucide-react";
import {
  SettingsCard as Card,
  SettingsSectionHeader as SectionHeader,
  SettingsToggleRow as Toggle,
} from "../../ui/settings/SettingsPrimitives";
import { NumberInput } from '../../ui/forms';
import SectionHeading from '../../ui/SectionHeading';
import { InfoTooltip } from '../../ui/InfoTooltip';

interface GeneralSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const inputClass = "sor-settings-input w-full";

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <SectionHeading icon={<Monitor className="w-5 h-5 text-primary" />} title="General" description="Autosave, connection timeouts, and general application preferences." />

      <div className="space-y-4">
        <SectionHeader
          icon={<Clock className="w-4 h-4 text-primary" />}
          title="Timing"
        />
        <Card>
          <div
            data-setting-key="connectionTimeout"
            className="sor-settings-select-row"
          >
            <span className="sor-settings-row-label flex items-center gap-1">
              <span className="text-[var(--color-textSecondary)] mr-1">
                <Clock size={16} />
              </span>
              Connection Timeout (seconds)
              <InfoTooltip text="Maximum time in seconds to wait for a connection to be established before giving up. Increase this for slow or high-latency networks." />
            </span>
            <NumberInput
              value={settings.connectionTimeout}
              onChange={(v: number) =>
                updateSettings({ connectionTimeout: v })
              }
              variant="settings-compact"
              className="text-right"
              style={{ width: "5rem" }}
              min={5}
              max={300}
            />
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <SectionHeader
          icon={<Save className="w-4 h-4 text-primary" />}
          title="Autosave Settings"
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
            data-setting-key="autoSaveIntervalMinutes"
            className={`space-y-2 ${!settings.autoSaveEnabled ? "opacity-50 pointer-events-none" : ""}`}
          >
            <label className="flex items-center gap-2 sor-settings-row-label">
              <Clock className="w-4 h-4" />
              Autosave Interval (minutes)
              <InfoTooltip text="How often the connection file is automatically saved. Lower values save more frequently but may cause brief pauses on large files." />
            </label>
            <NumberInput value={settings.autoSaveIntervalMinutes} onChange={(v: number) => updateSettings({
                  autoSaveIntervalMinutes: v,
                })} className={inputClass} min={1} max={120} />
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
    </div>
  );
};

export default GeneralSettings;
