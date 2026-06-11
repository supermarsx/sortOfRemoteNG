import type { SectionProps } from "./types";
import React from "react";
import { MousePointer2, FolderOpen } from "lucide-react";
import {
  Card,
  SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
const ClickActions: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<MousePointer2 className="w-4 h-4 text-primary" />}
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
        infoTooltip="A single click on a connection in the sidebar tree will immediately open and connect to it. Disable if you prefer single-click to only select."
      />
      <Toggle
        checked={s.singleClickDisconnect}
        onChange={(v) => u({ singleClickDisconnect: v })}
        icon={<MousePointer2 size={16} />}
        label="Disconnect on single click (active connections)"
        description="Click an active connection to disconnect it"
        settingKey="singleClickDisconnect"
        infoTooltip="Single-clicking an already connected session in the tree will disconnect it. Useful for quick teardown but may cause accidental disconnects."
      />
      <Toggle
        checked={s.doubleClickConnect}
        onChange={(v) => u({ doubleClickConnect: v })}
        icon={<MousePointer2 size={16} />}
        label="Connect on double click"
        description="Double-click a connection to open/connect it"
        settingKey="doubleClickConnect"
        infoTooltip="Double-clicking a connection in the tree opens and connects to it. This is the traditional way to initiate a connection."
      />
      <Toggle
        checked={s.doubleClickRename}
        onChange={(v) => u({ doubleClickRename: v })}
        icon={<MousePointer2 size={16} />}
        label="Rename on double click"
        description="Double-click a connection name to rename it inline"
        settingKey="doubleClickRename"
        infoTooltip="Double-clicking a connection name in the tree puts it into inline edit mode so you can rename it without opening a properties dialog."
      />
      <Toggle
        checked={s.middleClickCloseTab}
        onChange={(v) => u({ middleClickCloseTab: v })}
        icon={<MousePointer2 size={16} />}
        label="Middle-click to close tab"
        description="Middle mouse button closes the clicked tab"
        settingKey="middleClickCloseTab"
        infoTooltip="Clicking a tab with the middle mouse button will close it immediately, similar to browser tab behavior."
      />
      <Toggle
        checked={s.folderSingleClickToggle}
        onChange={(v) => u({ folderSingleClickToggle: v })}
        icon={<FolderOpen size={16} />}
        label="Folder expand on single click"
        description="Click anywhere on a folder row to expand or collapse it"
        settingKey="folderSingleClickToggle"
        infoTooltip="When on, a single click anywhere on a folder in the sidebar tree toggles its expanded state. When off, only the small chevron on the left toggles it and the row body just selects."
      />
      <Toggle
        checked={s.folderDoubleClickToggle}
        onChange={(v) => u({ folderDoubleClickToggle: v })}
        icon={<FolderOpen size={16} />}
        label="Folder expand on double click"
        description="Double-click anywhere on a folder row to expand or collapse it"
        settingKey="folderDoubleClickToggle"
        infoTooltip="When on, double-clicking a folder in the sidebar tree toggles its expanded state. This is useful when single-click folder toggling is disabled."
      />
    </Card>
  </div>
);

export default ClickActions;
