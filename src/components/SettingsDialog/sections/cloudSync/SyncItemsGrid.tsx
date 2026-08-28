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

/*
 * The six toggles are written out rather than mapped over a table because
 * `settingKey` has to be a **literal** string in the JSX: the settings-search
 * drift guard (`tests/settings/settingsSearchDrift.test.ts`) reads the keys
 * straight off the AST, and a computed `settingKey={`cloudSync.${key}`}` is
 * invisible to it — which would make every one of these settings unfindable.
 */

function SyncItemsGrid({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Database className="w-4 h-4 text-primary" />}
        title="What to Sync"
      />
      <Card>
        <Toggle
          settingKey="cloudSync.syncConnections"
          icon={<HardDrive size={16} />}
          label="Connections"
          description="Saved connection entries (hosts, ports, credentials)"
          checked={mgr.cloudSync.syncConnections}
          onChange={(v) => mgr.updateCloudSync({ syncConnections: v })}
          infoTooltip="Sync the full connection list, including folders and per-connection security overrides."
        />

        <Toggle
          settingKey="cloudSync.syncSettings"
          icon={<Settings size={16} />}
          label="Settings"
          description="Application preferences and global settings"
          checked={mgr.cloudSync.syncSettings}
          onChange={(v) => mgr.updateCloudSync({ syncSettings: v })}
          infoTooltip="Sync the app's global settings so preferences follow you across devices."
        />

        <Toggle
          settingKey="cloudSync.syncSSHKeys"
          icon={<Key size={16} />}
          label="SSH Keys"
          description="Private and public SSH keys stored in the app"
          checked={mgr.cloudSync.syncSSHKeys}
          onChange={(v) => mgr.updateCloudSync({ syncSSHKeys: v })}
          infoTooltip="Sync SSH key material. Keys are encrypted in transit but should only be used on trusted devices."
        />

        <Toggle
          settingKey="cloudSync.syncScripts"
          icon={<FileKey size={16} />}
          label="Scripts"
          description="Saved scripts attached to connections"
          checked={mgr.cloudSync.syncScripts}
          onChange={(v) => mgr.updateCloudSync({ syncScripts: v })}
          infoTooltip="Sync the scripts library so post-connect and macro scripts are shared across devices."
        />

        <Toggle
          settingKey="cloudSync.syncColorTags"
          icon={<Palette size={16} />}
          label="Color Tags"
          description="Color tag definitions used to categorize connections"
          checked={mgr.cloudSync.syncColorTags}
          onChange={(v) => mgr.updateCloudSync({ syncColorTags: v })}
          infoTooltip="Sync the color tag library so categorization stays consistent across devices."
        />

        <Toggle
          settingKey="cloudSync.syncShortcuts"
          icon={<Keyboard size={16} />}
          label="Shortcuts"
          description="Custom keyboard shortcut bindings"
          checked={mgr.cloudSync.syncShortcuts}
          onChange={(v) => mgr.updateCloudSync({ syncShortcuts: v })}
          infoTooltip="Sync custom keyboard shortcuts so your bindings are the same everywhere."
        />
      </Card>
    </div>
  );
}

export default SyncItemsGrid;
