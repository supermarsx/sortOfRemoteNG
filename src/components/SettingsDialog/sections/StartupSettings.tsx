import React from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { GlobalSettings } from "../../../types/settings";
import { Power, Monitor, Play, RefreshCw, Minimize2, X as XIcon } from "lucide-react";

interface StartupSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const StartupSettings: React.FC<StartupSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();

  const handleStartWithSystemChange = async (enabled: boolean) => {
    try {
      // Call Tauri to enable/disable autostart
      await invoke("set_autostart", { enabled });
      updateSettings({ startWithSystem: enabled });
    } catch (err) {
      console.error("Failed to set autostart:", err);
      // Revert the setting if it failed
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-white flex items-center gap-2">
        <Power className="w-5 h-5" />
        {t("settings.startup.title", "Startup & Tray")}
      </h3>

      {/* Startup Behavior */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2">
          {t("settings.startup.behavior", "Startup Behavior")}
        </h4>

        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.startWithSystem}
            onChange={(e) => handleStartWithSystemChange(e.target.checked)}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4 text-gray-400" />
            <span className="text-gray-300">
              {t("settings.startup.startWithSystem", "Start with system")}
            </span>
          </div>
        </label>

        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.startMinimized}
            onChange={(e) => updateSettings({ startMinimized: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            disabled={settings.startMaximized}
          />
          <div className="flex items-center gap-2">
            <Minimize2 className="w-4 h-4 text-gray-400" />
            <span className={`text-gray-300 ${settings.startMaximized ? 'opacity-50' : ''}`}>
              {t("settings.startup.startMinimized", "Start minimized")}
            </span>
          </div>
        </label>

        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.startMaximized}
            onChange={(e) => updateSettings({ startMaximized: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            disabled={settings.startMinimized}
          />
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-gray-400" />
            <span className={`text-gray-300 ${settings.startMinimized ? 'opacity-50' : ''}`}>
              {t("settings.startup.startMaximized", "Start maximized")}
            </span>
          </div>
        </label>

        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.reconnectPreviousSessions}
            onChange={(e) => updateSettings({ reconnectPreviousSessions: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-gray-400" />
            <span className="text-gray-300">
              {t("settings.startup.reconnectSessions", "Reconnect previous sessions on startup")}
            </span>
          </div>
        </label>
      </div>

      {/* Tray Behavior */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2">
          {t("settings.startup.trayBehavior", "System Tray Behavior")}
        </h4>

        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.showTrayIcon}
            onChange={(e) => updateSettings({ showTrayIcon: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
          <span className="text-gray-300">
            {t("settings.startup.showTrayIcon", "Show system tray icon")}
          </span>
        </label>

        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.minimizeToTray}
            onChange={(e) => updateSettings({ minimizeToTray: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            disabled={!settings.showTrayIcon}
          />
          <div className="flex items-center gap-2">
            <Minimize2 className="w-4 h-4 text-gray-400" />
            <span className={`text-gray-300 ${!settings.showTrayIcon ? 'opacity-50' : ''}`}>
              {t("settings.startup.minimizeToTray", "Minimize to notification area")}
            </span>
          </div>
        </label>

        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.closeToTray}
            onChange={(e) => updateSettings({ closeToTray: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            disabled={!settings.showTrayIcon}
          />
          <div className="flex items-center gap-2">
            <XIcon className="w-4 h-4 text-gray-400" />
            <span className={`text-gray-300 ${!settings.showTrayIcon ? 'opacity-50' : ''}`}>
              {t("settings.startup.closeToTray", "Close to notification area")}
            </span>
          </div>
        </label>
      </div>

      {/* Info notice */}
      <div className="p-3 bg-blue-900/30 border border-blue-800/50 rounded-lg text-sm text-blue-300">
        <p>
          {t("settings.startup.note", "Note: Some settings require an application restart to take effect.")}
        </p>
      </div>
    </div>
  );
};

export default StartupSettings;
