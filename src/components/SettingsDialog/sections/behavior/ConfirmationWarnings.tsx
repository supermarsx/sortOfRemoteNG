import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ExternalLink,
  LogOut,
  MessageSquareWarning,
} from "lucide-react";
import type { GlobalSettings } from "../../../../types/settings/settings";
import {
  SettingsCard as Card,
  SettingsSectionHeader as SectionHeader,
  SettingsToggleRow as Toggle,
} from "../../../ui/settings/SettingsPrimitives";

export default function ConfirmationWarnings({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<AlertTriangle className="w-4 h-4 text-primary" />}
        title={t(
          "settingsGeneral.confirmationWarnings",
          "Confirmation Warnings",
        )}
      />
      <Card>
        <Toggle
          checked={settings.warnOnClose}
          onChange={(value) => updateSettings({ warnOnClose: value })}
          icon={<AlertTriangle className="w-4 h-4" />}
          label={t("connections.warnOnClose", "Warn on close")}
          settingKey="warnOnClose"
          infoTooltip={t(
            "settingsGeneral.warnOnCloseTooltip",
            "Show a confirmation dialog when you attempt to close a tab that has an active connection, preventing accidental disconnections.",
          )}
        />

        <Toggle
          checked={settings.warnOnDetachClose}
          onChange={(value) => updateSettings({ warnOnDetachClose: value })}
          icon={<ExternalLink className="w-4 h-4" />}
          label={t(
            "connections.warnOnDetachClose",
            "Warn on detached tab close",
          )}
          settingKey="warnOnDetachClose"
          infoTooltip={t(
            "settingsGeneral.warnOnDetachCloseTooltip",
            "Show a confirmation dialog before closing a tab that has been detached into its own window.",
          )}
        />

        <Toggle
          checked={settings.warnOnExit}
          onChange={(value) => updateSettings({ warnOnExit: value })}
          icon={<LogOut className="w-4 h-4" />}
          label={t("connections.warnOnExit", "Warn on exit")}
          settingKey="warnOnExit"
          infoTooltip={t(
            "settingsGeneral.warnOnExitTooltip",
            "Show a warning when you try to quit the application while there are still active connections open.",
          )}
        />

        <Toggle
          checked={settings.confirmMainAppClose ?? false}
          onChange={(value) => updateSettings({ confirmMainAppClose: value })}
          icon={<MessageSquareWarning className="w-4 h-4" />}
          label={t(
            "settingsGeneral.confirmMainAppClose",
            "Confirm main app close",
          )}
          settingKey="confirmMainAppClose"
          description={t(
            "settingsGeneral.confirmMainAppCloseDescription",
            "Show a confirmation dialog before closing the main window",
          )}
          infoTooltip={t(
            "settingsGeneral.confirmMainAppCloseTooltip",
            "Always prompt for confirmation before the main application window is closed, even if no connections are active.",
          )}
        />
      </Card>
    </div>
  );
}
