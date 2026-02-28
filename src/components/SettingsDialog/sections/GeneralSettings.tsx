import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings } from "../../../types/settings";
import {
  Monitor,
  Globe,
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
} from "../../ui/SettingsPrimitives";

interface GeneralSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const inputClass = "sor-settings-input w-full";
const selectClass = "sor-settings-select w-full";

export const GeneralSettings: React.FC<GeneralSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
        <Monitor className="w-5 h-5" />
        General
      </h3>
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Language, autosave, connection timeouts, and general application
        preferences.
      </p>

      <div className="space-y-4">
        <SectionHeader
          icon={<Globe className="w-4 h-4 text-blue-400" />}
          title="Language & Timing"
        />
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div data-setting-key="language" className="space-y-2">
              <label className="flex items-center gap-2 sor-settings-row-label">
                <Globe className="w-4 h-4" />
                {t("settings.language")}
              </label>
              <select
                value={settings.language}
                onChange={(e) => updateSettings({ language: e.target.value })}
                className={selectClass}
              >
                <option value="en">English</option>
                <option value="es">Español (España)</option>
                <option value="fr">Français (France)</option>
                <option value="de">Deutsch (Deutschland)</option>
                <option value="pt-PT">Português (Portugal)</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 sor-settings-row-label">
                <Clock className="w-4 h-4" />
                Connection Timeout (seconds)
              </label>
              <input
                type="number"
                value={settings.connectionTimeout}
                onChange={(e) =>
                  updateSettings({
                    connectionTimeout: parseInt(e.target.value),
                  })
                }
                className={inputClass}
                min="5"
                max="300"
              />
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <SectionHeader
          icon={<Save className="w-4 h-4 text-green-400" />}
          title="Autosave Settings"
        />
        <Card>
          <Toggle
            checked={settings.autoSaveEnabled}
            onChange={(value) => updateSettings({ autoSaveEnabled: value })}
            icon={<Save className="w-4 h-4" />}
            label="Enable autosave"
            settingKey="autoSaveEnabled"
          />

          <div
            data-setting-key="autoSaveIntervalMinutes"
            className={`space-y-2 ${!settings.autoSaveEnabled ? "opacity-50 pointer-events-none" : ""}`}
          >
            <label className="flex items-center gap-2 sor-settings-row-label">
              <Clock className="w-4 h-4" />
              Autosave Interval (minutes)
            </label>
            <input
              type="number"
              value={settings.autoSaveIntervalMinutes}
              onChange={(e) =>
                updateSettings({
                  autoSaveIntervalMinutes: parseInt(e.target.value),
                })
              }
              className={inputClass}
              min="1"
              max="120"
            />
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <SectionHeader
          icon={<AlertTriangle className="w-4 h-4 text-yellow-400" />}
          title="Confirmation Warnings"
        />
        <Card>
          <Toggle
            checked={settings.warnOnClose}
            onChange={(value) => updateSettings({ warnOnClose: value })}
            icon={<AlertTriangle className="w-4 h-4" />}
            label={t("connections.warnOnClose")}
            settingKey="warnOnClose"
          />

          <Toggle
            checked={settings.warnOnDetachClose}
            onChange={(value) => updateSettings({ warnOnDetachClose: value })}
            icon={<ExternalLink className="w-4 h-4" />}
            label={t("connections.warnOnDetachClose")}
            settingKey="warnOnDetachClose"
          />

          <Toggle
            checked={settings.warnOnExit}
            onChange={(value) => updateSettings({ warnOnExit: value })}
            icon={<LogOut className="w-4 h-4" />}
            label={t("connections.warnOnExit")}
            settingKey="warnOnExit"
          />

          <Toggle
            checked={settings.confirmMainAppClose ?? false}
            onChange={(value) => updateSettings({ confirmMainAppClose: value })}
            icon={<MessageSquareWarning className="w-4 h-4" />}
            label="Confirm main app close"
            description="Show a confirmation dialog before closing the main window"
          />
        </Card>
      </div>

      <div className="space-y-4">
        <SectionHeader
          icon={<History className="w-4 h-4 text-cyan-400" />}
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
            />
            <button
              type="button"
              onClick={() => updateSettings({ quickConnectHistory: [] })}
              disabled={(settings.quickConnectHistory?.length ?? 0) === 0}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-md bg-[var(--color-border)] text-gray-200 hover:bg-red-600/20 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Clear history
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {settings.quickConnectHistory?.length || 0} entries stored
          </p>
        </Card>
      </div>
    </div>
  );
};

export default GeneralSettings;
