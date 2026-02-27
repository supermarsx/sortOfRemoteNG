import React from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { GlobalSettings } from "../../../types/settings";
import { Power, Monitor, Play, RefreshCw, Minimize2, X as XIcon, AppWindow, FolderOpen, EyeOff, Type, MessageSquare, RotateCcw } from "lucide-react";

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



      {/* Welcome Screen */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-gray-300 border-b border-gray-700 pb-2">
          {t("settings.startup.welcomeScreen", "Welcome Screen")}
        </h4>

        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.hideQuickStartMessage ?? false}
            onChange={(e) => updateSettings({ hideQuickStartMessage: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
          <div className="flex items-center gap-2">
            <EyeOff className="w-4 h-4 text-gray-400" />
            <span className="text-[var(--color-textSecondary)]">
              {t("settings.startup.hideQuickStartMessage", "Hide welcome message")}
            </span>
          </div>
        </label>

        <label className="flex items-center space-x-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.hideQuickStartButtons ?? false}
            onChange={(e) => updateSettings({ hideQuickStartButtons: e.target.checked })}
            className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
          />
          <div className="flex items-center gap-2">
            <EyeOff className="w-4 h-4 text-gray-400" />
            <span className="text-[var(--color-textSecondary)]">
              {t("settings.startup.hideQuickStartButtons", "Hide quick action buttons")}
            </span>
          </div>
        </label>

        {/* Custom Welcome Screen Content */}
        <div className="space-y-3 pt-2 border-t border-[var(--color-border)]/50 mt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-textMuted)]">
              {t("settings.startup.customWelcomeContent", "Custom Welcome Content")}
            </span>
            {(settings.welcomeScreenTitle || settings.welcomeScreenMessage) && (
              <button
                type="button"
                onClick={() => updateSettings({ welcomeScreenTitle: undefined, welcomeScreenMessage: undefined })}
                className="text-xs text-[var(--color-textMuted)] hover:text-[var(--color-text)] flex items-center gap-1 transition-colors"
                title={t("settings.startup.resetToDefault", "Reset to default")}
              >
                <RotateCcw className="w-3 h-3" />
                {t("settings.startup.reset", "Reset")}
              </button>
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <Type className="w-4 h-4 text-gray-400" />
              {t("settings.startup.customTitle", "Custom Title")}
            </label>
            <input
              type="text"
              value={settings.welcomeScreenTitle ?? ""}
              onChange={(e) => updateSettings({ welcomeScreenTitle: e.target.value || undefined })}
              placeholder={t("settings.startup.customTitlePlaceholder", "Leave empty for default")}
              className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm placeholder:text-[var(--color-textMuted)] focus:border-[var(--color-accent)] focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
              <MessageSquare className="w-4 h-4 text-gray-400" />
              {t("settings.startup.customMessage", "Custom Message")}
            </label>
            <textarea
              value={settings.welcomeScreenMessage ?? ""}
              onChange={(e) => updateSettings({ welcomeScreenMessage: e.target.value || undefined })}
              placeholder={t("settings.startup.customMessagePlaceholder", "Leave empty for default")}
              rows={3}
              className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-sm placeholder:text-[var(--color-textMuted)] focus:border-[var(--color-accent)] focus:outline-none resize-none transition-colors"
            />
          </div>
        </div>

        <p className="text-xs text-[var(--color-textMuted)] pl-7">
          {t("settings.startup.welcomeScreenNote", "Controls what is shown when no connection is active.")}
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
