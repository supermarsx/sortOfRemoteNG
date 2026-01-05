import React from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { GlobalSettings } from "../../../types/settings";
import { Power, Monitor, Play, RefreshCw, Minimize2, X as XIcon, MousePointer, MousePointerClick, AppWindow, FolderOpen } from "lucide-react";

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

        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoOpenLastCollection}
            onChange={(e) => updateSettings({ autoOpenLastCollection: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-gray-400" />
            <span className="text-gray-300">
              {t("settings.startup.autoOpenLastCollection", "Auto-open last used connection collection")}
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
          <div className="flex items-center gap-2">
            <AppWindow className="w-4 h-4 text-gray-400" />
            <span className="text-gray-300">
              {t("settings.startup.showTrayIcon", "Show system tray icon")}
            </span>
          </div>
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

      {/* Click Actions */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2">
          {t("settings.startup.clickActions", "Click Actions")}
        </h4>

        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.singleClickConnect}
            onChange={(e) => updateSettings({ singleClickConnect: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
          <div className="flex items-center gap-2">
            <MousePointer className="w-4 h-4 text-gray-400" />
            <span className="text-gray-300">
              {t("settings.startup.singleClickConnect", "Connect on single click")}
            </span>
          </div>
        </label>

        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.singleClickDisconnect}
            onChange={(e) => updateSettings({ singleClickDisconnect: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
          <div className="flex items-center gap-2">
            <MousePointerClick className="w-4 h-4 text-gray-400" />
            <span className="text-gray-300">
              {t("settings.startup.singleClickDisconnect", "Disconnect on single click (active connections)")}
            </span>
          </div>
        </label>

        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.doubleClickRename}
            onChange={(e) => updateSettings({ doubleClickRename: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
          <div className="flex items-center gap-2">
            <MousePointerClick className="w-4 h-4 text-gray-400" />

            <span className="text-gray-300">
              {t("settings.startup.doubleClickRename", "Rename on double click")}
            </span>
          </div>
        </label>

        <p className="text-xs text-gray-500 pl-7">
          {t("settings.startup.clickActionsNote", "When enabled, clicking a connection in the tree will immediately connect or disconnect instead of selecting it.")}
        </p>
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
