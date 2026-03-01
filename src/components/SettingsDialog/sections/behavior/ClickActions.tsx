import React from "react";
import { MousePointer2 } from "lucide-react";
import { Card, SectionHeader, Toggle } from "../../../ui/settings/SettingsPrimitives";
const ClickActions: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<MousePointer2 className="w-4 h-4 text-blue-400" />}
      title="Click Actions"
    />
    <p className="text-xs text-[var(--color-textMuted)]">
      Control what mouse clicks do in the connection tree, tabs, and elsewhere.
    </p>
    <Card>
      <Toggle
        checked={s.singleClickConnect}
        onChange={(v) => u({ singleClickConnect: v })}
        icon={<MousePointer2 size={16} />}
        label="Connect on single click"
        description="Immediately connect when clicking a connection in the tree"
        settingKey="singleClickConnect"
      />
      <Toggle
        checked={s.singleClickDisconnect}
        onChange={(v) => u({ singleClickDisconnect: v })}
        icon={<MousePointer2 size={16} />}
        label="Disconnect on single click (active connections)"
        description="Click an active connection to disconnect it"
        settingKey="singleClickDisconnect"
      />
      <Toggle
        checked={s.doubleClickConnect}
        onChange={(v) => u({ doubleClickConnect: v })}
        icon={<MousePointer2 size={16} />}
        label="Connect on double click"
        description="Double-click a connection to open/connect it"
        settingKey="doubleClickConnect"
      />
      <Toggle
        checked={s.doubleClickRename}
        onChange={(v) => u({ doubleClickRename: v })}
        icon={<MousePointer2 size={16} />}
        label="Rename on double click"
        description="Double-click a connection name to rename it inline"
        settingKey="doubleClickRename"
      />
      <Toggle
        checked={s.middleClickCloseTab}
        onChange={(v) => u({ middleClickCloseTab: v })}
        icon={<MousePointer2 size={16} />}
        label="Middle-click to close tab"
        description="Middle mouse button closes the clicked tab"
        settingKey="middleClickCloseTab"
      />
    </Card>
  </div>
);

export default ClickActions;
