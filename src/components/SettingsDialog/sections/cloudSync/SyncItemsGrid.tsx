import React from "react";
import { Settings, FileKey, Database, HardDrive, Key, Palette, Keyboard } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
import { SettingsSectionHeader as SectionHeader } from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";
function SyncItemsGrid({ mgr }: { mgr: Mgr }) {
  const items: Array<{
    key: keyof Pick<
      typeof mgr.cloudSync,
      | "syncConnections"
      | "syncSettings"
      | "syncSSHKeys"
      | "syncScripts"
      | "syncColorTags"
      | "syncShortcuts"
    >;
    icon: React.ReactNode;
    label: string;
  }> = [
    {
      key: "syncConnections",
      icon: <HardDrive className="w-4 h-4 text-[var(--color-textSecondary)]" />,
      label: "Connections",
    },
    {
      key: "syncSettings",
      icon: <Settings className="w-4 h-4 text-[var(--color-textSecondary)]" />,
      label: "Settings",
    },
    {
      key: "syncSSHKeys",
      icon: <Key className="w-4 h-4 text-[var(--color-textSecondary)]" />,
      label: "SSH Keys",
    },
    {
      key: "syncScripts",
      icon: <FileKey className="w-4 h-4 text-[var(--color-textSecondary)]" />,
      label: "Scripts",
    },
    {
      key: "syncColorTags",
      icon: <Palette className="w-4 h-4 text-[var(--color-textSecondary)]" />,
      label: "Color Tags",
    },
    {
      key: "syncShortcuts",
      icon: <Keyboard className="w-4 h-4 text-[var(--color-textSecondary)]" />,
      label: "Shortcuts",
    },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Database className="w-4 h-4 text-primary" />}
        title="What to Sync"
      />
      <div className="sor-settings-card">
        <div className="grid grid-cols-2 gap-3">
          {items.map(({ key, icon, label }) => (
            <label
              key={key}
              className="sor-toggle-card"
            >
              <Checkbox checked={mgr.cloudSync[key]} onChange={(v: boolean) => mgr.updateCloudSync({ [key]: v })} className="sor-checkbox-sm" />
              {icon}
              <span className="text-sm text-[var(--color-text)]">{label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SyncItemsGrid;
