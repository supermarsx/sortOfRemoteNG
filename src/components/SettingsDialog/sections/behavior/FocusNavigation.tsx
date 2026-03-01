import React from "react";
import { Focus, Clock, ArrowLeftRight, Compass } from "lucide-react";
import { Card, SectionHeader, Toggle } from "../../../ui/settings/SettingsPrimitives";
const FocusNavigation: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Focus className="w-4 h-4 text-emerald-400" />}
      title="Focus & Navigation"
    />
    <Card>
      <Toggle
        checked={s.focusTerminalOnTabSwitch}
        onChange={(v) => u({ focusTerminalOnTabSwitch: v })}
        icon={<Focus size={16} />}
        label="Focus terminal when switching tabs"
        description="Automatically place keyboard focus in the terminal or canvas"
        settingKey="focusTerminalOnTabSwitch"
      />
      <Toggle
        checked={s.scrollTreeToActiveConnection}
        onChange={(v) => u({ scrollTreeToActiveConnection: v })}
        icon={<Compass size={16} />}
        label="Scroll sidebar to active connection"
        description="Auto-scroll the connection tree to highlight the active session"
        settingKey="scrollTreeToActiveConnection"
      />
      <Toggle
        checked={s.restoreLastActiveTab}
        onChange={(v) => u({ restoreLastActiveTab: v })}
        icon={<Clock size={16} />}
        label="Restore last active tab on startup"
        description="Re-select the tab that was focused when the app was closed"
        settingKey="restoreLastActiveTab"
      />
      <Toggle
        checked={s.tabCycleMru}
        onChange={(v) => u({ tabCycleMru: v })}
        icon={<ArrowLeftRight size={16} />}
        label="Cycle tabs in most-recently-used order"
        description="Ctrl+Tab cycles by recency instead of left-to-right position"
        settingKey="tabCycleMru"
      />
    </Card>
  </div>
);

export default FocusNavigation;
