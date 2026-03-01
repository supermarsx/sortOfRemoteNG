import React from "react";
import { Layers, Clock, ShieldAlert, Zap } from "lucide-react";
import { Card, SectionHeader, SliderRow, Toggle } from "../../../ui/settings/SettingsPrimitives";
const TabBehavior: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Layers className="w-4 h-4 text-cyan-400" />}
      title="Tab Behavior"
    />
    <Card>
      <Toggle
        checked={s.openConnectionInBackground}
        onChange={(v) => u({ openConnectionInBackground: v })}
        icon={<Layers size={16} />}
        label="Open new connections in background"
        description="New tabs open without switching to them"
        settingKey="openConnectionInBackground"
      />
      <Toggle
        checked={s.switchTabOnActivity}
        onChange={(v) => u({ switchTabOnActivity: v })}
        icon={<Zap size={16} />}
        label="Switch to tab on activity"
        description="Automatically focus a tab when it receives new output"
        settingKey="switchTabOnActivity"
      />
      <Toggle
        checked={s.closeTabOnDisconnect}
        onChange={(v) => u({ closeTabOnDisconnect: v })}
        icon={<Layers size={16} />}
        label="Close tab on disconnect"
        description="Automatically close the tab when the session ends"
        settingKey="closeTabOnDisconnect"
      />
      <Toggle
        checked={s.confirmCloseActiveTab}
        onChange={(v) => u({ confirmCloseActiveTab: v })}
        icon={<ShieldAlert size={16} />}
        label="Confirm before closing active tab"
        description="Show a warning before closing a tab with a live session"
        settingKey="confirmCloseActiveTab"
      />
      <Toggle
        checked={s.enableRecentlyClosedTabs}
        onChange={(v) => u({ enableRecentlyClosedTabs: v })}
        icon={<Clock size={16} />}
        label="Enable recently-closed tabs list"
        description="Keep a list of recently closed tabs so you can reopen them"
        settingKey="enableRecentlyClosedTabs"
      />
      {s.enableRecentlyClosedTabs && (
        <SliderRow
          label="Max recently closed"
          value={s.recentlyClosedTabsMax}
          min={1}
          max={50}
          onChange={(v) => u({ recentlyClosedTabsMax: v })}
          settingKey="recentlyClosedTabsMax"
        />
      )}
    </Card>
  </div>
);

export default TabBehavior;
