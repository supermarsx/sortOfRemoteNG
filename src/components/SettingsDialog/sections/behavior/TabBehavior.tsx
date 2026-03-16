import type { SectionProps } from "./types";
import React from "react";
import { Layers, Clock, Monitor, ShieldAlert, Zap } from "lucide-react";
import { Card, SectionHeader, SliderRow, Toggle } from "../../../ui/settings/SettingsPrimitives";
const TabBehavior: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Layers className="w-4 h-4 text-info" />}
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
        infoTooltip="When enabled, new connection tabs open behind the current tab instead of immediately switching focus to them."
      />
      <Toggle
        checked={s.openWinmgmtToolInBackground}
        onChange={(v) => u({ openWinmgmtToolInBackground: v })}
        icon={<Monitor size={16} />}
        label="Open Windows management tools in background"
        description="Windows tools (Services, Registry, etc.) open without switching"
        settingKey="openWinmgmtToolInBackground"
        infoTooltip="Open Windows management tool tabs (Services, Registry, Event Viewer, etc.) in the background without interrupting your current work."
      />
      <Toggle
        checked={s.switchTabOnActivity}
        onChange={(v) => u({ switchTabOnActivity: v })}
        icon={<Zap size={16} />}
        label="Switch to tab on activity"
        description="Automatically focus a tab when it receives new output"
        settingKey="switchTabOnActivity"
        infoTooltip="Automatically bring a background tab to the foreground when it receives new output or activity, such as incoming terminal data."
      />
      <Toggle
        checked={s.closeTabOnDisconnect}
        onChange={(v) => u({ closeTabOnDisconnect: v })}
        icon={<Layers size={16} />}
        label="Close tab on disconnect"
        description="Automatically close the tab when the session ends"
        settingKey="closeTabOnDisconnect"
        infoTooltip="Automatically remove the tab when a session disconnects. When disabled, disconnected tabs remain open so you can review output or reconnect."
      />
      <Toggle
        checked={s.confirmCloseActiveTab}
        onChange={(v) => u({ confirmCloseActiveTab: v })}
        icon={<ShieldAlert size={16} />}
        label="Confirm before closing active tab"
        description="Show a warning before closing a tab with a live session"
        settingKey="confirmCloseActiveTab"
        infoTooltip="Display a confirmation prompt before closing a tab that has an active, connected session to prevent accidental disconnections."
      />
      <Toggle
        checked={s.enableRecentlyClosedTabs}
        onChange={(v) => u({ enableRecentlyClosedTabs: v })}
        icon={<Clock size={16} />}
        label="Enable recently-closed tabs list"
        description="Keep a list of recently closed tabs so you can reopen them"
        settingKey="enableRecentlyClosedTabs"
        infoTooltip="Maintain a history of recently closed tabs so you can quickly reopen them. Useful for recovering accidentally closed sessions."
      />
      {s.enableRecentlyClosedTabs && (
        <SliderRow
          label="Max recently closed"
          value={s.recentlyClosedTabsMax}
          min={1}
          max={50}
          onChange={(v) => u({ recentlyClosedTabsMax: v })}
          settingKey="recentlyClosedTabsMax"
          infoTooltip="The maximum number of recently closed tabs to remember. Older entries are discarded when this limit is reached."
        />
      )}
    </Card>
  </div>
);

export default TabBehavior;
