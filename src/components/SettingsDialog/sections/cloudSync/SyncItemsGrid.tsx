import React from "react";
import {
  Settings,
  FileKey,
  Database,
  HardDrive,
  Key,
  Palette,
  Keyboard,
} from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

type CloudSync = Mgr["cloudSync"];
type ItemKey =
  | "syncConnections"
  | "syncSettings"
  | "syncSSHKeys"
  | "syncScripts"
  | "syncColorTags"
  | "syncShortcuts";

function SyncItemsGrid({ mgr }: { mgr: Mgr }) {
  const items: Array<{
    key: ItemKey;
    icon: React.ReactNode;
    label: string;
    description: string;
    tooltip: string;
  }> = [
    {
      key: "syncConnections",
      icon: <HardDrive size={16} />,
      label: "Connections",
      description: "Saved connection entries (hosts, ports, credentials)",
      tooltip: "Sync the full connection list, including folders and per-connection security overrides.",
    },
    {
      key: "syncSettings",
      icon: <Settings size={16} />,
      label: "Settings",
      description: "Application preferences and global settings",
      tooltip: "Sync the app's global settings so preferences follow you across devices.",
    },
    {
      key: "syncSSHKeys",
      icon: <Key size={16} />,
      label: "SSH Keys",
      description: "Private and public SSH keys stored in the app",
      tooltip: "Sync SSH key material. Keys are encrypted in transit but should only be used on trusted devices.",
    },
    {
      key: "syncScripts",
      icon: <FileKey size={16} />,
      label: "Scripts",
      description: "Saved scripts attached to connections",
      tooltip: "Sync the scripts library so post-connect and macro scripts are shared across devices.",
    },
    {
      key: "syncColorTags",
      icon: <Palette size={16} />,
      label: "Color Tags",
      description: "Color tag definitions used to categorize connections",
      tooltip: "Sync the color tag library so categorization stays consistent across devices.",
    },
    {
      key: "syncShortcuts",
      icon: <Keyboard size={16} />,
      label: "Shortcuts",
      description: "Custom keyboard shortcut bindings",
      tooltip: "Sync custom keyboard shortcuts so your bindings are the same everywhere.",
    },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Database className="w-4 h-4 text-primary" />}
        title="What to Sync"
      />
      <Card>
        {items.map(({ key, icon, label, description, tooltip }) => (
          <Toggle
            key={key}
            icon={icon}
            label={label}
            description={description}
            checked={mgr.cloudSync[key]}
            onChange={(v) =>
              mgr.updateCloudSync({ [key]: v } as Partial<CloudSync>)
            }
            infoTooltip={tooltip}
          />
        ))}
      </Card>
    </div>
  );
}

export default SyncItemsGrid;
