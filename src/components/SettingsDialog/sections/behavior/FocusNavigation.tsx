import type { SectionProps } from "./types";
import React from "react";
import { Focus, Clock, ArrowLeftRight, Compass } from "lucide-react";
import { Card, SectionHeader, Toggle } from "../../../ui/settings/SettingsPrimitives";
const FocusNavigation: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Focus className="w-4 h-4 text-success" />}
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
        infoTooltip="When you switch to a different tab, automatically place keyboard focus inside the terminal so you can start typing immediately."
      />
      <Toggle
        checked={s.scrollTreeToActiveConnection}
        onChange={(v) => u({ scrollTreeToActiveConnection: v })}
        icon={<Compass size={16} />}
        label="Scroll sidebar to active connection"
        description="Auto-scroll the connection tree to highlight the active session"
        settingKey="scrollTreeToActiveConnection"
        infoTooltip="Automatically scroll the sidebar connection tree to reveal and highlight the connection that corresponds to the active tab."
      />
      <Toggle
        checked={s.restoreLastActiveTab}
        onChange={(v) => u({ restoreLastActiveTab: v })}
        icon={<Clock size={16} />}
        label="Restore last active tab on startup"
        description="Re-select the tab that was focused when the app was closed"
        settingKey="restoreLastActiveTab"
        infoTooltip="When the application starts, automatically select the same tab that was active when you last closed the app."
      />
      <Toggle
        checked={s.tabCycleMru}
        onChange={(v) => u({ tabCycleMru: v })}
        icon={<ArrowLeftRight size={16} />}
        label="Cycle tabs in most-recently-used order"
        description="Ctrl+Tab cycles by recency instead of left-to-right position"
        settingKey="tabCycleMru"
        infoTooltip="When pressing Ctrl+Tab, cycle through tabs in the order you last used them rather than their left-to-right position in the tab bar."
      />
    </Card>
  </div>
);

export default FocusNavigation;
