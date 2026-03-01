import React from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { GlobalSettings } from "../../../types/settings";
import {
  Power,
  Monitor,
  Play,
  RefreshCw,
  Minimize2,
  X as XIcon,
  AppWindow,
  FolderOpen,
  EyeOff,
  Type,
  MessageSquare,
  RotateCcw,
} from "lucide-react";
import { Checkbox } from '../../ui/forms';

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
      <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
        <Power className="w-5 h-5" />
        {t("settings.startup.title", "Startup & Tray")}
      </h3>
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Application launch behavior, system tray options, and welcome screen
        customization.
      </p>

      {/* Startup Behavior */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2">
          {t("settings.startup.behavior", "Startup Behavior")}
        </h4>

        <div className="sor-settings-card">
          <label className="flex items-center space-x-3 cursor-pointer">
            <Checkbox checked={settings.startWithSystem} onChange={(v: boolean) => handleStartWithSystemChange(v)} />
            <div className="flex items-center gap-2">
              <Play className="w-4 h-4 text-[var(--color-textSecondary)]" />
              <span className="text-[var(--color-textSecondary)]">
                {t("settings.startup.startWithSystem", "Start with system")}
              </span>
            </div>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer">
            <Checkbox checked={settings.startMinimized} onChange={(v: boolean) => updateSettings({ startMinimized: v })} disabled={settings.startMaximized} />
            <div className="flex items-center gap-2">
              <Minimize2 className="w-4 h-4 text-[var(--color-textSecondary)]" />
              <span
                className={`text-[var(--color-textSecondary)] ${settings.startMaximized ? "opacity-50" : ""}`}
              >
                {t("settings.startup.startMinimized", "Start minimized")}
              </span>
            </div>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer">
            <Checkbox checked={settings.startMaximized} onChange={(v: boolean) => updateSettings({ startMaximized: v })} disabled={settings.startMinimized} />
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-[var(--color-textSecondary)]" />
              <span
                className={`text-[var(--color-textSecondary)] ${settings.startMinimized ? "opacity-50" : ""}`}
              >
                {t("settings.startup.startMaximized", "Start maximized")}
              </span>
            </div>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer">
            <Checkbox checked={settings.reconnectPreviousSessions} onChange={(v: boolean) => updateSettings({ reconnectPreviousSessions: v })} />
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-[var(--color-textSecondary)]" />
              <span className="text-[var(--color-textSecondary)]">
                {t(
                  "settings.startup.reconnectSessions",
                  "Reconnect previous sessions on startup",
                )}
              </span>
            </div>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer">
            <Checkbox checked={settings.autoOpenLastCollection} onChange={(v: boolean) => updateSettings({ autoOpenLastCollection: v })} />
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-[var(--color-textSecondary)]" />
              <span className="text-[var(--color-textSecondary)]">
                {t(
                  "settings.startup.autoOpenLastCollection",
                  "Auto-open last used connection collection",
                )}
              </span>
            </div>
          </label>
        </div>
      </div>

      {/* Tray Behavior */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2">
          {t("settings.startup.trayBehavior", "System Tray Behavior")}
        </h4>

        <div className="sor-settings-card">
          <label className="flex items-center space-x-3 cursor-pointer">
            <Checkbox checked={settings.showTrayIcon} onChange={(v: boolean) => updateSettings({ showTrayIcon: v })} />
            <div className="flex items-center gap-2">
              <AppWindow className="w-4 h-4 text-[var(--color-textSecondary)]" />
              <span className="text-[var(--color-textSecondary)]">
                {t("settings.startup.showTrayIcon", "Show system tray icon")}
              </span>
            </div>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer">
            <Checkbox checked={settings.minimizeToTray} onChange={(v: boolean) => updateSettings({ minimizeToTray: v })} disabled={!settings.showTrayIcon} />
            <div className="flex items-center gap-2">
              <Minimize2 className="w-4 h-4 text-[var(--color-textSecondary)]" />
              <span
                className={`text-[var(--color-textSecondary)] ${!settings.showTrayIcon ? "opacity-50" : ""}`}
              >
                {t(
                  "settings.startup.minimizeToTray",
                  "Minimize to notification area",
                )}
              </span>
            </div>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer">
            <Checkbox checked={settings.closeToTray} onChange={(v: boolean) => updateSettings({ closeToTray: v })} disabled={!settings.showTrayIcon} />
            <div className="flex items-center gap-2">
              <XIcon className="w-4 h-4 text-[var(--color-textSecondary)]" />
              <span
                className={`text-[var(--color-textSecondary)] ${!settings.showTrayIcon ? "opacity-50" : ""}`}
              >
                {t(
                  "settings.startup.closeToTray",
                  "Close to notification area",
                )}
              </span>
            </div>
          </label>
        </div>
      </div>

      {/* Welcome Screen */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2">
          {t("settings.startup.welcomeScreen", "Welcome Screen")}
        </h4>

        <div className="sor-settings-card">
          <label className="flex items-center space-x-3 cursor-pointer">
            <Checkbox checked={settings.hideQuickStartMessage ?? false} onChange={(v: boolean) => updateSettings({ hideQuickStartMessage: v })} />
            <div className="flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-[var(--color-textSecondary)]" />
              <span className="text-[var(--color-textSecondary)]">
                {t(
                  "settings.startup.hideQuickStartMessage",
                  "Hide welcome message",
                )}
              </span>
            </div>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer">
            <Checkbox checked={settings.hideQuickStartButtons ?? false} onChange={(v: boolean) => updateSettings({ hideQuickStartButtons: v })} />
            <div className="flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-[var(--color-textSecondary)]" />
              <span className="text-[var(--color-textSecondary)]">
                {t(
                  "settings.startup.hideQuickStartButtons",
                  "Hide quick action buttons",
                )}
              </span>
            </div>
          </label>

          {/* Custom Welcome Screen Content */}
          <div className="space-y-3 pt-2 border-t border-[var(--color-border)]/50 mt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-textMuted)]">
                {t(
                  "settings.startup.customWelcomeContent",
                  "Custom Welcome Content",
                )}
              </span>
              {(settings.welcomeScreenTitle ||
                settings.welcomeScreenMessage) && (
                <button
                  type="button"
                  onClick={() =>
                    updateSettings({
                      welcomeScreenTitle: undefined,
                      welcomeScreenMessage: undefined,
                    })
                  }
                  className="text-xs text-[var(--color-textMuted)] hover:text-[var(--color-text)] flex items-center gap-1 transition-colors"
                  title={t(
                    "settings.startup.resetToDefault",
                    "Reset to default",
                  )}
                >
                  <RotateCcw className="w-3 h-3" />
                  {t("settings.startup.reset", "Reset")}
                </button>
              )}
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <Type className="w-4 h-4 text-[var(--color-textSecondary)]" />
                {t("settings.startup.customTitle", "Custom Title")}
              </label>
              <input
                type="text"
                value={settings.welcomeScreenTitle ?? ""}
                onChange={(e) =>
                  updateSettings({
                    welcomeScreenTitle: e.target.value || undefined,
                  })
                }
                placeholder={t(
                  "settings.startup.customTitlePlaceholder",
                  "Leave empty for default",
                )}
                className="sor-settings-input w-full"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <MessageSquare className="w-4 h-4 text-[var(--color-textSecondary)]" />
                {t("settings.startup.customMessage", "Custom Message")}
              </label>
              <textarea
                value={settings.welcomeScreenMessage ?? ""}
                onChange={(e) =>
                  updateSettings({
                    welcomeScreenMessage: e.target.value || undefined,
                  })
                }
                placeholder={t(
                  "settings.startup.customMessagePlaceholder",
                  "Leave empty for default",
                )}
                rows={3}
                className="sor-settings-input w-full resize-none"
              />
            </div>

            <p className="text-xs text-[var(--color-textMuted)] pl-7">
              {t(
                "settings.startup.welcomeScreenNote",
                "Controls what is shown when no connection is active.",
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Info notice */}
      <div className="p-3 bg-blue-900/30 border border-blue-800/50 rounded-lg text-sm text-blue-300">
        <p>
          {t(
            "settings.startup.note",
            "Note: Some settings require an application restart to take effect.",
          )}
        </p>
      </div>
    </div>
  );
};

export default StartupSettings;
