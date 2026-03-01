import React from "react";
import SectionHeading from '../../ui/SectionHeading';
import { useTranslation } from "react-i18next";
import SectionHeading from '../../ui/SectionHeading';
import { MousePointerClick } from "lucide-react";
import SectionHeading from '../../ui/SectionHeading';
import TOOL_ENTRIES from "./behavior/TOOL_ENTRIES";
import SectionHeading from '../../ui/SectionHeading';
import ClickActions from "./behavior/ClickActions";
import SectionHeading from '../../ui/SectionHeading';
import TabBehavior from "./behavior/TabBehavior";
import SectionHeading from '../../ui/SectionHeading';
import FocusNavigation from "./behavior/FocusNavigation";
import SectionHeading from '../../ui/SectionHeading';
import WindowConnection from "./behavior/WindowConnection";
import SectionHeading from '../../ui/SectionHeading';
import ClipboardSection from "./behavior/ClipboardSection";
import SectionHeading from '../../ui/SectionHeading';
import IdleTimeout from "./behavior/IdleTimeout";
import SectionHeading from '../../ui/SectionHeading';
import ReconnectionSection from "./behavior/ReconnectionSection";
import SectionHeading from '../../ui/SectionHeading';
import NotificationsSection from "./behavior/NotificationsSection";
import SectionHeading from '../../ui/SectionHeading';
import ConfirmationDialogs from "./behavior/ConfirmationDialogs";
import SectionHeading from '../../ui/SectionHeading';
import DragDropSection from "./behavior/DragDropSection";
import SectionHeading from '../../ui/SectionHeading';
import ScrollInputSection from "./behavior/ScrollInputSection";
import SectionHeading from '../../ui/SectionHeading';
import ToolDisplayModesSection from "./behavior/ToolDisplayModesSection";
import SectionHeading from '../../ui/SectionHeading';

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
      <ToolDisplayModesSection s={settings} u={updateSettings} />
    </div>
  );
};

export default BehaviorSettings;
