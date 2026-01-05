import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings } from "../../../types/settings";
import {
  Settings,
  Globe,
  Clock,
  Save,
  AppWindow,
  Link,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  History,
  LogOut,
  Trash2,
  ShieldAlert,
} from "lucide-react";

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
      <h3 className="text-lg font-medium text-white flex items-center gap-2">
        <Settings className="w-5 h-5" />
        {t("settings.general")}
      </h3>

      {/* Basic Settings Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-400" />
          Language & Timing
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <Globe className="w-4 h-4" />
              {t("settings.language")}
            </label>
            <select
              value={settings.language}
              onChange={(e) => updateSettings({ language: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
            >
              <option value="en">English</option>
              <option value="es">Español (España)</option>
              <option value="fr">Français (France)</option>
              <option value="de">Deutsch (Deutschland)</option>
              <option value="pt-PT">Português (Portugal)</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <Clock className="w-4 h-4" />
              Connection Timeout (seconds)
            </label>
            <input
              type="number"
              value={settings.connectionTimeout}
              onChange={(e) =>
                updateSettings({ connectionTimeout: parseInt(e.target.value) })
              }
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
              min="5"
              max="300"
            />
          </div>
        </div>
      </div>

      {/* Autosave Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Save className="w-4 h-4 text-green-400" />
          Autosave Settings
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.autoSaveEnabled}
              onChange={(e) =>
                updateSettings({ autoSaveEnabled: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Save className="w-4 h-4 text-gray-500 group-hover:text-green-400" />
            <span className="text-gray-300 group-hover:text-white">Enable autosave</span>
          </label>

          <div className={`space-y-2 ${!settings.autoSaveEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <Clock className="w-4 h-4" />
              Autosave Interval (minutes)
            </label>
            <input
              type="number"
              value={settings.autoSaveIntervalMinutes}
              onChange={(e) =>
                updateSettings({ autoSaveIntervalMinutes: parseInt(e.target.value) })
              }
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
              min="1"
              max="120"
            />
          </div>
        </div>
      </div>

      {/* Window & Connection Behavior */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <AppWindow className="w-4 h-4 text-purple-400" />
          Window & Connection Behavior
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-3">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.singleWindowMode}
              onChange={(e) =>
                updateSettings({ singleWindowMode: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <AppWindow className="w-4 h-4 text-gray-500 group-hover:text-purple-400" />
            <span className="text-gray-300 group-hover:text-white">Disallow multiple instances</span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.singleConnectionMode}
              onChange={(e) =>
                updateSettings({ singleConnectionMode: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Link className="w-4 h-4 text-gray-500 group-hover:text-purple-400" />
            <span className="text-gray-300 group-hover:text-white">
              {t("connections.singleConnection")}
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.reconnectOnReload}
              onChange={(e) =>
                updateSettings({ reconnectOnReload: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <RefreshCw className="w-4 h-4 text-gray-500 group-hover:text-purple-400" />
            <span className="text-gray-300 group-hover:text-white">
              {t("connections.reconnectOnReload")}
            </span>
          </label>
        </div>
      </div>

      {/* Warning Settings */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
          Confirmation Warnings
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-3">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.warnOnClose}
              onChange={(e) => updateSettings({ warnOnClose: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <AlertTriangle className="w-4 h-4 text-gray-500 group-hover:text-yellow-400" />
            <span className="text-gray-300 group-hover:text-white">{t("connections.warnOnClose")}</span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.warnOnDetachClose}
              onChange={(e) =>
                updateSettings({ warnOnDetachClose: e.target.checked })
              }
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <ExternalLink className="w-4 h-4 text-gray-500 group-hover:text-yellow-400" />
            <span className="text-gray-300 group-hover:text-white">
              {t("connections.warnOnDetachClose")}
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.warnOnExit}
              onChange={(e) => updateSettings({ warnOnExit: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <LogOut className="w-4 h-4 text-gray-500 group-hover:text-yellow-400" />
            <span className="text-gray-300 group-hover:text-white">{t("connections.warnOnExit")}</span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.detectUnexpectedClose}
              onChange={(e) => updateSettings({ detectUnexpectedClose: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <ShieldAlert className="w-4 h-4 text-gray-500 group-hover:text-yellow-400" />
            <span className="text-gray-300 group-hover:text-white">Detect unexpected app close</span>
          </label>
        </div>
      </div>

      {/* Quick Connect History */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
          <History className="w-4 h-4 text-cyan-400" />
          Quick Connect History
        </h4>

        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center space-x-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={settings.quickConnectHistoryEnabled}
                onChange={(e) =>
                  updateSettings({ quickConnectHistoryEnabled: e.target.checked })
                }
                className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
              />
              <History className="w-4 h-4 text-gray-500 group-hover:text-cyan-400" />
              <span className="text-gray-300 group-hover:text-white">Save Quick Connect history</span>
            </label>
            <button
              type="button"
              onClick={() => updateSettings({ quickConnectHistory: [] })}
              disabled={(settings.quickConnectHistory?.length ?? 0) === 0}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-md bg-gray-700 text-gray-200 hover:bg-red-600/20 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Clear history
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {settings.quickConnectHistory?.length || 0} entries stored
          </p>
        </div>
      </div>
    </div>
  );
};

export default GeneralSettings;

