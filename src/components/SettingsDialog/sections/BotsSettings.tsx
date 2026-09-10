import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GlobalSettings } from "../../../types/settings/settings";
import SectionHeading from "../../ui/SectionHeading";
import TelegramSettingsSection from "./bots/TelegramSettingsSection";

export default function BotsSettings({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Bot className="w-5 h-5 text-primary" />}
        title={t("integrations.telegram.bots", "Bots")}
        description={t(
          "integrations.telegram.botsDescription",
          "Manage bot connections, notifications, and messaging integrations.",
        )}
      />
      <TelegramSettingsSection s={settings} u={updateSettings} />
    </div>
  );
}
