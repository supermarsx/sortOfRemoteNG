import React from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { GlobalSettings } from "../../../types/settings/settings";
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
import { Textarea } from "../../ui/forms";
import SectionHeading from "../../ui/SectionHeading";
import { InfoTooltip } from "../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../ui/settings/SettingsPrimitives";

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
      <SectionHeading
        icon={<Power className="w-5 h-5 text-primary" />}
        title={t("settings.startup.title", "Startup & Tray")}
        description="Application launch behavior, system tray options, and welcome screen customization."
      />

      {/* Startup Behavior */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Play className="w-4 h-4 text-primary" />}
          title={t("settings.startup.behavior", "Startup Behavior")}
        />
        <Card>
          <Toggle
            checked={settings.startWithSystem}
            onChange={(v) => void handleStartWithSystemChange(v)}
            icon={<Play size={16} />}
            label={t("settings.startup.startWithSystem", "Start with system")}
            description="Launch the application when the operating system starts"
            settingKey="startWithSystem"
            infoTooltip="Automatically launch the application when the operating system starts"
          />
          <Toggle
            checked={settings.startMinimized}
            onChange={(v) => updateSettings({ startMinimized: v })}
            icon={<Minimize2 size={16} />}
            label={t("settings.startup.startMinimized", "Start minimized")}
            description="Open the application minimized to the taskbar or system tray"
            settingKey="startMinimized"
            infoTooltip="Start the application minimized to the taskbar or system tray"
          />
          <Toggle
            checked={settings.startMaximized}
            onChange={(v) => updateSettings({ startMaximized: v })}
            icon={<Monitor size={16} />}
            label={t("settings.startup.startMaximized", "Start maximized")}
            description="Open the application window in full-screen mode"
            settingKey="startMaximized"
            infoTooltip="Open the application window in maximized (full-screen) mode"
          />
          <Toggle
            checked={settings.reconnectPreviousSessions}
            onChange={(v) => updateSettings({ reconnectPreviousSessions: v })}
            icon={<RefreshCw size={16} />}
            label={t(
              "settings.startup.reconnectSessions",
              "Reconnect previous sessions on startup",
            )}
            description="Re-establish sessions that were active at the last shutdown"
            settingKey="reconnectPreviousSessions"
            infoTooltip="Automatically reconnect all sessions that were active when the application was last closed"
          />
          <Toggle
            checked={settings.autoOpenLastCollection}
            onChange={(v) => updateSettings({ autoOpenLastCollection: v })}
            icon={<FolderOpen size={16} />}
            label={t(
              "settings.startup.autoOpenLastCollection",
              "Auto-open last used connection collection",
            )}
            description="Load the most recently used connection collection on launch"
            settingKey="autoOpenLastCollection"
            infoTooltip="Automatically load the most recently used connection collection on startup"
          />
        </Card>
      </div>

      {/* Tray Behavior */}
      <div className="space-y-4">
        <SectionHeader
          icon={<AppWindow className="w-4 h-4 text-primary" />}
          title={t("settings.startup.trayBehavior", "System Tray Behavior")}
        />
        <Card>
          <Toggle
            checked={settings.showTrayIcon}
            onChange={(v) => updateSettings({ showTrayIcon: v })}
            icon={<AppWindow size={16} />}
            label={t("settings.startup.showTrayIcon", "Show system tray icon")}
            description="Display an icon in the system notification area"
            settingKey="showTrayIcon"
            infoTooltip="Display an icon in the system notification area for quick access"
          />

          <div
            className={`flex flex-col gap-2.5 ${
              settings.showTrayIcon ? "" : "opacity-50 pointer-events-none"
            }`}
          >
            <Toggle
              checked={settings.minimizeToTray}
              onChange={(v) => updateSettings({ minimizeToTray: v })}
              icon={<Minimize2 size={16} />}
              label={t(
                "settings.startup.minimizeToTray",
                "Minimize to notification area",
              )}
              description="Hide the window on minimize, accessible from the tray icon"
              settingKey="minimizeToTray"
              infoTooltip="When minimizing, hide the window and keep it accessible from the system tray icon"
            />
            <Toggle
              checked={settings.closeToTray}
              onChange={(v) => updateSettings({ closeToTray: v })}
              icon={<XIcon size={16} />}
              label={t(
                "settings.startup.closeToTray",
                "Close to notification area",
              )}
              description="Minimize to tray on window close instead of quitting"
              settingKey="closeToTray"
              infoTooltip="When closing the window, minimize to the system tray instead of quitting the application"
            />
          </div>
        </Card>
      </div>

      {/* Welcome Screen */}
      <div className="space-y-4">
        <SectionHeader
          icon={<MessageSquare className="w-4 h-4 text-primary" />}
          title={t("settings.startup.welcomeScreen", "Welcome Screen")}
        />
        <Card>
          <Toggle
            checked={settings.hideQuickStartMessage ?? false}
            onChange={(v) => updateSettings({ hideQuickStartMessage: v })}
            icon={<EyeOff size={16} />}
            label={t(
              "settings.startup.hideQuickStartMessage",
              "Hide welcome message",
            )}
            description="Hide the introductory text shown on the start screen"
            settingKey="hideQuickStartMessage"
            infoTooltip="Hide the introductory welcome message shown on the start screen"
          />

          <Toggle
            checked={settings.hideQuickStartButtons ?? false}
            onChange={(v) => updateSettings({ hideQuickStartButtons: v })}
            icon={<EyeOff size={16} />}
            label={t(
              "settings.startup.hideQuickStartButtons",
              "Hide quick action buttons",
            )}
            description="Hide the shortcut buttons for common actions"
            settingKey="hideQuickStartButtons"
            infoTooltip="Hide the shortcut buttons for common actions on the welcome screen"
          />

          {/* Custom Welcome Screen Content */}
          <div className="space-y-3 pt-3 mt-1 border-t border-[var(--color-border)]/50">
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
                {t("settings.startup.customTitle", "Custom Title")}{" "}
                <InfoTooltip text="Set a custom title to display on the welcome screen instead of the default" />
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
                {t("settings.startup.customMessage", "Custom Message")}{" "}
                <InfoTooltip text="Set a custom message to display on the welcome screen instead of the default" />
              </label>
              <Textarea
                value={settings.welcomeScreenMessage ?? ""}
                onChange={(v) =>
                  updateSettings({
                    welcomeScreenMessage: v || undefined,
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

            <p className="text-xs text-[var(--color-textMuted)]">
              {t(
                "settings.startup.welcomeScreenNote",
                "Controls what is shown when no connection is active.",
              )}
            </p>
          </div>
        </Card>
      </div>

      {/* Info notice */}
      <div className="p-3 bg-primary/30 border border-primary/50 rounded-lg text-sm text-primary">
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
