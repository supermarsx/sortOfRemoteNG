import React from "react";
import { Settings, FileKey, Database, HardDrive, Key, Palette, Keyboard } from "lucide-react";
import { Checkbox } from "../../../ui/forms";
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
      icon: <HardDrive className="w-4 h-4 text-blue-400" />,
      label: "Connections",
    },
    {
      key: "syncSettings",
      icon: <Settings className="w-4 h-4 text-purple-400" />,
      label: "Settings",
    },
    {
      key: "syncSSHKeys",
      icon: <Key className="w-4 h-4 text-yellow-400" />,
      label: "SSH Keys",
    },
    {
      key: "syncScripts",
      icon: <FileKey className="w-4 h-4 text-green-400" />,
      label: "Scripts",
    },
    {
      key: "syncColorTags",
      icon: <Palette className="w-4 h-4 text-pink-400" />,
      label: "Color Tags",
    },
    {
      key: "syncShortcuts",
      icon: <Keyboard className="w-4 h-4 text-orange-400" />,
      label: "Shortcuts",
    },
  ];

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
        <Database className="w-4 h-4 inline mr-2" />
        What to Sync
      </label>
      <div className="grid grid-cols-2 gap-3">
        {items.map(({ key, icon, label }) => (
          <label
            key={key}
            className="sor-toggle-card"
          >
            <Checkbox checked={mgr.cloudSync[key]} onChange={(v: boolean) => mgr.updateCloudSync({ [key]: v })} className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
            {icon}
            <span className="text-sm text-[var(--color-text)]">{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default SyncItemsGrid;
