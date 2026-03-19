import React from "react";
import SectionHeading from '../../ui/SectionHeading';
import { useTranslation } from "react-i18next";
import type { GlobalSettings } from "../../../types/settings/settings";
import { MousePointerClick } from "lucide-react";

interface BehaviorSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}
import ClickActions from "./behavior/ClickActions";
import TabBehavior from "./behavior/TabBehavior";
import FocusNavigation from "./behavior/FocusNavigation";
import WindowConnection from "./behavior/WindowConnection";
import ClipboardSection from "./behavior/ClipboardSection";
import IdleTimeout from "./behavior/IdleTimeout";
import ReconnectionSection from "./behavior/ReconnectionSection";
import NotificationsSection from "./behavior/NotificationsSection";
import ConfirmationDialogs from "./behavior/ConfirmationDialogs";
import DragDropSection from "./behavior/DragDropSection";
import ScrollInputSection from "./behavior/ScrollInputSection";

const BehaviorSettings: React.FC<BehaviorSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <SectionHeading icon={<MousePointerClick className="w-5 h-5" />} title="Behavior" description="Click actions, tab behavior, clipboard, notifications, and reconnection settings." />

      <ClickActions s={settings} u={updateSettings} />
      <TabBehavior s={settings} u={updateSettings} />
      <FocusNavigation s={settings} u={updateSettings} />
      <WindowConnection s={settings} u={updateSettings} t={t} />
      <ClipboardSection s={settings} u={updateSettings} />
      <IdleTimeout s={settings} u={updateSettings} />
      <ReconnectionSection s={settings} u={updateSettings} />
      <NotificationsSection s={settings} u={updateSettings} />
      <ConfirmationDialogs s={settings} u={updateSettings} />
      <DragDropSection s={settings} u={updateSettings} />
      <ScrollInputSection s={settings} u={updateSettings} />
    </div>
  );
};

export default BehaviorSettings;
