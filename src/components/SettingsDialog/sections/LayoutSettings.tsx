import React from "react";
import { GlobalSettings } from "../../../types/settings/settings";
import {
  LayoutGrid,
  Layers,
  Maximize2,
  Move,
  PanelLeft,
  ArrowLeftRight,
  FoldVertical,
  GripVertical,
  Network,
  Zap,
  FolderSync,
  FileStack,
  Settings,
  Shield,
  Keyboard,
  Activity,
  Code,
  ShieldCheck,
  Terminal,
  FileCode,
  Power,
  ScreenShare,
  ArrowUpDown,
  Bug,
  HardDrive,
  Cloud,
  RefreshCw,
  Cpu,
  ListVideo,
  Disc,
  FlaskConical,
} from "lucide-react";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../ui/InfoTooltip";

interface LayoutSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

/* ── Tab layout / grouping option configs ─────────────── */

const TAB_GROUPING_CONFIG = [
  { value: "none", label: "None", description: "No grouping" },
  {
    value: "protocol",
    label: "By Protocol",
    description: "Group by SSH, RDP, etc.",
  },
  {
    value: "status",
    label: "By Status",
    description: "Group by connection state",
  },
  {
    value: "hostname",
    label: "By Hostname",
    description: "Group by server name",
  },
];

const DEFAULT_TAB_LAYOUT_CONFIG: Array<{
  value: GlobalSettings["defaultTabLayout"];
  label: string;
  description: string;
}> = [
  { value: "tabs", label: "Tabs", description: "One session visible at a time" },
  { value: "splitVertical", label: "Split L/R", description: "2 columns, fills rows" },
  { value: "splitHorizontal", label: "Split T/B", description: "2 rows, fills columns" },
  { value: "sideBySide", label: "Side-by-Side", description: "2 cols, all sessions" },
  { value: "grid2", label: "Grid 2", description: "Capped at 2 tiles" },
  { value: "grid4", label: "Grid 4", description: "Capped at 4 tiles" },
  { value: "grid6", label: "Grid 6", description: "Capped at 6 tiles" },
  { value: "mosaic", label: "Mosaic", description: "Auto sqrt grid" },
  { value: "miniMosaic", label: "Mini Mosaic", description: "Preview tiles" },
  { value: "customGrid", label: "Custom Grid", description: "Pick rows × cols" },
];

export const LayoutSettings: React.FC<LayoutSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<LayoutGrid className="w-5 h-5 text-primary" />}
        title="Layout"
        description="Default tab layout and grouping, window persistence, sidebar behavior, tab reordering, and secondary bar icon visibility."
      />

      {/* Window Persistence */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Maximize2 className="w-4 h-4 text-primary" />}
          title="Window Persistence"
        />
        <Card>
          <Toggle
            checked={settings.persistWindowSize}
            onChange={(v) => updateSettings({ persistWindowSize: v })}
            icon={<Maximize2 size={16} />}
            label="Remember window size"
            description="Save and restore the window dimensions between sessions"
            settingKey="persistWindowSize"
            infoTooltip="Save and restore the window dimensions between sessions"
          />
          <Toggle
            checked={settings.persistWindowPosition}
            onChange={(v) => updateSettings({ persistWindowPosition: v })}
            icon={<Move size={16} />}
            label="Remember window position"
            description="Save and restore where the window sits on screen"
            settingKey="persistWindowPosition"
            infoTooltip="Save and restore the window location on screen between sessions"
          />
          <Toggle
            checked={settings.autoRepatriateWindow}
            onChange={(v) => updateSettings({ autoRepatriateWindow: v })}
            icon={<ScreenShare size={16} />}
            label="Auto-repatriate window if off-screen"
            description="Bring the window back to a visible monitor when its saved position is off-screen (e.g. after disconnecting an external display)"
            settingKey="autoRepatriateWindow"
            infoTooltip="Move the window back to a visible monitor if its saved position is off-screen"
          />
        </Card>
      </div>

      {/* Sidebar Persistence */}
      <div className="space-y-4">
        <SectionHeader
          icon={<PanelLeft className="w-4 h-4 text-primary" />}
          title="Sidebar Persistence"
        />
        <Card>
          <Toggle
            checked={settings.persistSidebarWidth}
            onChange={(v) => updateSettings({ persistSidebarWidth: v })}
            icon={<ArrowLeftRight size={16} />}
            label="Remember sidebar width"
            description="Restore the sidebar width after restarting"
            settingKey="persistSidebarWidth"
            infoTooltip="Persist the sidebar width so it stays the same after restarting"
          />
          <Toggle
            checked={settings.persistSidebarPosition}
            onChange={(v) => updateSettings({ persistSidebarPosition: v })}
            icon={<Move size={16} />}
            label="Remember sidebar position"
            description="Save whether the sidebar is docked left or right"
            settingKey="persistSidebarPosition"
            infoTooltip="Save whether the sidebar is docked to the left or right side"
          />
          <Toggle
            checked={settings.persistSidebarCollapsed}
            onChange={(v) => updateSettings({ persistSidebarCollapsed: v })}
            icon={<FoldVertical size={16} />}
            label="Remember sidebar collapsed state"
            description="Persist expanded or collapsed sidebar state between sessions"
            settingKey="persistSidebarCollapsed"
            infoTooltip="Persist whether the sidebar is expanded or collapsed between sessions"
          />
        </Card>
      </div>

      {/* Tab Interaction */}
      <div className="space-y-4">
        <SectionHeader
          icon={<GripVertical className="w-4 h-4 text-primary" />}
          title="Tab Interaction"
        />
        <Card>
          <Toggle
            checked={settings.enableTabReorder}
            onChange={(v) => updateSettings({ enableTabReorder: v })}
            icon={<FileStack size={16} />}
            label="Allow tab reordering"
            description="Drag-and-drop tabs in the tab bar"
            settingKey="enableTabReorder"
            infoTooltip="Enable drag-and-drop reordering of connection tabs in the tab bar"
          />
          <Toggle
            checked={settings.enableConnectionReorder}
            onChange={(v) => updateSettings({ enableConnectionReorder: v })}
            icon={<Network size={16} />}
            label="Allow connection reordering"
            description="Drag-and-drop connections inside the sidebar tree"
            settingKey="enableConnectionReorder"
            infoTooltip="Enable drag-and-drop reordering of connections in the sidebar tree"
          />
        </Card>
      </div>

      {/* Default Tab Layout */}
      <div className="space-y-4">
        <SectionHeader
          icon={<LayoutGrid className="w-4 h-4 text-primary" />}
          title={
            <span className="flex items-center gap-2">
              Default Tab Layout
              <InfoTooltip text="Tiling mode used when the app starts. The active mode is also persisted across launches once you change it from the toolbar." />
            </span>
          }
        />
        <Card>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {DEFAULT_TAB_LAYOUT_CONFIG.map((option) => (
              <button
                key={option.value}
                onClick={() => updateSettings({ defaultTabLayout: option.value })}
                data-testid={`default-tab-layout-${option.value}`}
                className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                  settings.defaultTabLayout === option.value
                    ? "border-primary bg-primary/20 text-[var(--color-text)] ring-1 ring-primary/50"
                    : "border-[var(--color-border)] bg-[var(--color-border)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:border-[var(--color-textSecondary)]"
                }`}
              >
                <LayoutGrid className="w-5 h-5 mb-1" />
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-[var(--color-textSecondary)] mt-1 text-center">
                  {option.description}
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Tab Grouping */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Layers className="w-4 h-4 text-primary" />}
          title={
            <span className="flex items-center gap-2">
              Tab Grouping
              <InfoTooltip text="Organize open connection tabs into groups based on a shared property." />
            </span>
          }
        />
        <Card>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {TAB_GROUPING_CONFIG.map((option) => (
              <button
                key={option.value}
                onClick={() => updateSettings({ tabGrouping: option.value as any })}
                className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                  settings.tabGrouping === option.value
                    ? "border-primary bg-primary/20 text-[var(--color-text)] ring-1 ring-primary/50"
                    : "border-[var(--color-border)] bg-[var(--color-border)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:border-[var(--color-textSecondary)]"
                }`}
              >
                <Layers className="w-5 h-5 mb-1" />
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-[var(--color-textSecondary)] mt-1 text-center">
                  {option.description}
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Secondary Bar Icons */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Settings className="w-4 h-4 text-primary" />}
          title="Secondary Bar Icons"
        />
        <Card className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
          <Toggle
            checked={settings.showQuickConnectIcon}
            onChange={(v) => updateSettings({ showQuickConnectIcon: v })}
            icon={<Zap size={16} />}
            label="Quick Connect"
            settingKey="showQuickConnectIcon"
            infoTooltip="Show the Quick Connect icon for rapidly connecting to a host"
          />
          <Toggle
            checked={settings.showCollectionSwitcherIcon}
            onChange={(v) => updateSettings({ showCollectionSwitcherIcon: v })}
            icon={<FolderSync size={16} />}
            label="Collection Switcher"
            settingKey="showCollectionSwitcherIcon"
            infoTooltip="Show the icon for switching between connection collections"
          />
          <Toggle
            checked={settings.showImportExportIcon}
            onChange={(v) => updateSettings({ showImportExportIcon: v })}
            icon={<FileStack size={16} />}
            label="Import / Export"
            settingKey="showImportExportIcon"
            infoTooltip="Show the icon for importing and exporting connection data"
          />
          <Toggle
            checked={settings.showSettingsIcon}
            onChange={(v) => updateSettings({ showSettingsIcon: v })}
            icon={<Settings size={16} />}
            label="Settings"
            settingKey="showSettingsIcon"
            infoTooltip="Show the settings icon in the secondary bar"
          />
          <Toggle
            checked={settings.showProxyMenuIcon}
            onChange={(v) => updateSettings({ showProxyMenuIcon: v })}
            icon={<Shield size={16} />}
            label="Proxy / VPN Menu"
            settingKey="showProxyMenuIcon"
            infoTooltip="Show the proxy and VPN management icon"
          />
          <Toggle
            checked={settings.showInternalProxyIcon}
            onChange={(v) => updateSettings({ showInternalProxyIcon: v })}
            icon={<ArrowUpDown size={16} />}
            label="Internal Proxy Manager"
            settingKey="showInternalProxyIcon"
            infoTooltip="Show the internal authentication proxy manager icon"
          />
          <Toggle
            checked={settings.showShortcutManagerIcon}
            onChange={(v) => updateSettings({ showShortcutManagerIcon: v })}
            icon={<Keyboard size={16} />}
            label="Shortcut Manager"
            settingKey="showShortcutManagerIcon"
            infoTooltip="Show the keyboard shortcut manager icon"
          />
          <Toggle
            checked={settings.showPerformanceMonitorIcon}
            onChange={(v) => updateSettings({ showPerformanceMonitorIcon: v })}
            icon={<Activity size={16} />}
            label="Performance Monitor"
            settingKey="showPerformanceMonitorIcon"
            infoTooltip="Show the real-time performance monitor icon"
          />
          <Toggle
            checked={settings.showActionLogIcon}
            onChange={(v) => updateSettings({ showActionLogIcon: v })}
            icon={<FileStack size={16} />}
            label="Action Log"
            settingKey="showActionLogIcon"
            infoTooltip="Show the action log icon for reviewing recent application actions and events"
          />
          <Toggle
            checked={settings.showDevtoolsIcon}
            onChange={(v) => updateSettings({ showDevtoolsIcon: v })}
            icon={<Code size={16} />}
            label="Devtools"
            settingKey="showDevtoolsIcon"
            infoTooltip="Show the developer tools icon for inspecting the application UI"
          />
          <Toggle
            checked={settings.showDebugPanelIcon}
            onChange={(v) => updateSettings({ showDebugPanelIcon: v })}
            icon={<FlaskConical size={16} />}
            label="Debug Panel"
            settingKey="showDebugPanelIcon"
            infoTooltip="Show the debug panel icon for development and troubleshooting tools"
          />
          <Toggle
            checked={settings.showSecurityIcon}
            onChange={(v) => updateSettings({ showSecurityIcon: v })}
            icon={<ShieldCheck size={16} />}
            label="Security"
            settingKey="showSecurityIcon"
            infoTooltip="Show the security icon for quick access to security-related tools"
          />
          <Toggle
            checked={settings.showWolIcon}
            onChange={(v) => updateSettings({ showWolIcon: v })}
            icon={<Power size={16} />}
            label="Wake-on-LAN"
            settingKey="showWolIcon"
            infoTooltip="Show the Wake-on-LAN icon for sending wake packets to remote machines"
          />
          <Toggle
            checked={settings.showBulkSSHIcon}
            onChange={(v) => updateSettings({ showBulkSSHIcon: v })}
            icon={<Terminal size={16} />}
            label="Bulk SSH Commander"
            settingKey="showBulkSSHIcon"
            infoTooltip="Show the Bulk SSH Commander icon for running SSH commands across multiple hosts"
          />
          <Toggle
            checked={settings.showScriptManagerIcon}
            onChange={(v) => updateSettings({ showScriptManagerIcon: v })}
            icon={<FileCode size={16} />}
            label="Script Manager"
            settingKey="showScriptManagerIcon"
            infoTooltip="Show the Script Manager icon for managing reusable scripts"
          />
          <Toggle
            checked={settings.showMacroManagerIcon}
            onChange={(v) => updateSettings({ showMacroManagerIcon: v })}
            icon={<ListVideo size={16} />}
            label="Macro Manager"
            settingKey="showMacroManagerIcon"
            infoTooltip="Show the Macro Manager icon for recording and replaying command sequences"
          />
          <Toggle
            checked={settings.showRecordingManagerIcon}
            onChange={(v) => updateSettings({ showRecordingManagerIcon: v })}
            icon={<Disc size={16} />}
            label="Recording Manager"
            settingKey="showRecordingManagerIcon"
            infoTooltip="Show the Recording Manager icon for managing recorded sessions"
          />
          <Toggle
            checked={settings.showErrorLogBar}
            onChange={(v) => updateSettings({ showErrorLogBar: v })}
            icon={<Bug size={16} />}
            label="Error Log Bar"
            settingKey="showErrorLogBar"
            infoTooltip="Show the error log bar toggle for quickly opening recent application errors"
          />
          <Toggle
            checked={settings.showBackupStatusIcon}
            onChange={(v) => updateSettings({ showBackupStatusIcon: v })}
            icon={<HardDrive size={16} />}
            label="Backup Status"
            settingKey="showBackupStatusIcon"
            infoTooltip="Show the backup status icon for monitoring local backup state"
          />
          <Toggle
            checked={settings.showCloudSyncStatusIcon}
            onChange={(v) => updateSettings({ showCloudSyncStatusIcon: v })}
            icon={<Cloud size={16} />}
            label="Cloud Sync Status"
            settingKey="showCloudSyncStatusIcon"
            infoTooltip="Show the cloud sync status icon for monitoring remote synchronization state"
          />
          <Toggle
            checked={settings.showSyncBackupStatusIcon}
            onChange={(v) => updateSettings({ showSyncBackupStatusIcon: v })}
            icon={<RefreshCw size={16} />}
            label="Sync & Backup (Combined)"
            settingKey="showSyncBackupStatusIcon"
            infoTooltip="Show a combined status icon for backup and cloud sync activity"
          />
          <Toggle
            checked={settings.showRdpSessionsIcon}
            onChange={(v) => updateSettings({ showRdpSessionsIcon: v })}
            icon={<Cpu size={16} />}
            label="RDP Sessions"
            settingKey="showRdpSessionsIcon"
            infoTooltip="Show the RDP Sessions icon for opening and monitoring RDP session tools"
          />
        </Card>
      </div>
    </div>
  );
};

export default LayoutSettings;
