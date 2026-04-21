import React from "react";
import { GlobalSettings } from "../../../types/settings/settings";
import {
  LayoutGrid,
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
  EyeOff,
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
import { Checkbox } from '../../ui/forms';
import SectionHeading from '../../ui/SectionHeading';
import { InfoTooltip } from '../../ui/InfoTooltip';

interface LayoutSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

export const LayoutSettings: React.FC<LayoutSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  return (
    <div className="space-y-6">
      <SectionHeading icon={<LayoutGrid className="w-5 h-5" />} title="Layout" description="Window persistence, sidebar behavior, tab reordering, and secondary bar icon visibility." />

      {/* Window Persistence Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Maximize2 className="w-4 h-4 text-primary" />
          Window Persistence
        </h4>
        <div className="space-y-3 ml-1">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.persistWindowSize} onChange={(v: boolean) => updateSettings({ persistWindowSize: v })} />
            <Maximize2 className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Remember window size <InfoTooltip text="Save and restore the window dimensions between sessions" />
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.persistWindowPosition} onChange={(v: boolean) => updateSettings({ persistWindowPosition: v })} />
            <Move className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Remember window position <InfoTooltip text="Save and restore the window location on screen between sessions" />
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.autoRepatriateWindow} onChange={(v: boolean) => updateSettings({ autoRepatriateWindow: v })} />
            <ScreenShare className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Auto-repatriate window if off-screen <InfoTooltip text="Move the window back to a visible monitor if its saved position is off-screen" />
            </span>
          </label>
          <p className="text-xs text-[var(--color-textMuted)] ml-7">
            When enabled, automatically brings window back to a visible monitor
            if the saved position is off-screen (e.g., after disconnecting an
            external monitor).
          </p>
        </div>
      </div>

      {/* Sidebar Persistence Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <PanelLeft className="w-4 h-4 text-success" />
          Sidebar Persistence
        </h4>
        <div className="space-y-3 ml-1">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.persistSidebarWidth} onChange={(v: boolean) => updateSettings({ persistSidebarWidth: v })} />
            <ArrowLeftRight className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Remember sidebar width <InfoTooltip text="Persist the sidebar width so it stays the same after restarting" />
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.persistSidebarPosition} onChange={(v: boolean) => updateSettings({ persistSidebarPosition: v })} />
            <Move className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Remember sidebar position <InfoTooltip text="Save whether the sidebar is docked to the left or right side" />
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.persistSidebarCollapsed} onChange={(v: boolean) => updateSettings({ persistSidebarCollapsed: v })} />
            <FoldVertical className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Remember sidebar collapsed state <InfoTooltip text="Persist whether the sidebar is expanded or collapsed between sessions" />
            </span>
          </label>
        </div>
      </div>

      {/* Reordering Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <GripVertical className="w-4 h-4 text-primary" />
          Tab Interaction
        </h4>
        <div className="space-y-3 ml-1">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.enableTabReorder} onChange={(v: boolean) => updateSettings({ enableTabReorder: v })} />
            <FileStack className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Allow tab reordering <InfoTooltip text="Enable drag-and-drop reordering of connection tabs in the tab bar" />
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.enableConnectionReorder} onChange={(v: boolean) => updateSettings({ enableConnectionReorder: v })} />
            <Network className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Allow connection reordering <InfoTooltip text="Enable drag-and-drop reordering of connections in the sidebar tree" />
            </span>
          </label>
        </div>
      </div>

      {/* Secondary Bar Icons Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Settings className="w-4 h-4 text-primary" />
          Secondary Bar Icons
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-1">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showQuickConnectIcon} onChange={(v: boolean) => updateSettings({ showQuickConnectIcon: v })} />
            <Zap className="w-4 h-4 text-warning group-hover:text-warning" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Quick Connect <InfoTooltip text="Show the Quick Connect icon for rapidly connecting to a host" />
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showCollectionSwitcherIcon} onChange={(v: boolean) => updateSettings({ showCollectionSwitcherIcon: v })} />
            <FolderSync className="w-4 h-4 text-primary group-hover:text-primary" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Collection Switcher <InfoTooltip text="Show the icon for switching between connection collections" />
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showImportExportIcon} onChange={(v: boolean) => updateSettings({ showImportExportIcon: v })} />
            <FileStack className="w-4 h-4 text-success group-hover:text-success" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Import/Export <InfoTooltip text="Show the icon for importing and exporting connection data" />
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showSettingsIcon} onChange={(v: boolean) => updateSettings({ showSettingsIcon: v })} />
            <Settings className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Settings <InfoTooltip text="Show the settings icon in the secondary bar" />
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showProxyMenuIcon} onChange={(v: boolean) => updateSettings({ showProxyMenuIcon: v })} />
            <Shield className="w-4 h-4 text-primary group-hover:text-primary" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Proxy/VPN Menu <InfoTooltip text="Show the proxy and VPN management icon" />
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showInternalProxyIcon} onChange={(v: boolean) => updateSettings({ showInternalProxyIcon: v })} />
            <ArrowUpDown className="w-4 h-4 text-info group-hover:text-info" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Internal Proxy Manager <InfoTooltip text="Show the internal authentication proxy manager icon" />
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showShortcutManagerIcon} onChange={(v: boolean) => updateSettings({ showShortcutManagerIcon: v })} />
            <Keyboard className="w-4 h-4 text-primary group-hover:text-primary" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Shortcut Manager <InfoTooltip text="Show the keyboard shortcut manager icon" />
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showPerformanceMonitorIcon} onChange={(v: boolean) => updateSettings({ showPerformanceMonitorIcon: v })} />
            <Activity className="w-4 h-4 text-error group-hover:text-error" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Performance Monitor <InfoTooltip text="Show the real-time performance monitor icon" />
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showActionLogIcon} onChange={(v: boolean) => updateSettings({ showActionLogIcon: v })} />
            <FileStack className="w-4 h-4 text-info group-hover:text-info" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Action Log
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showDevtoolsIcon} onChange={(v: boolean) => updateSettings({ showDevtoolsIcon: v })} />
            <Code className="w-4 h-4 text-warning group-hover:text-warning" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Devtools
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showDebugPanelIcon} onChange={(v: boolean) => updateSettings({ showDebugPanelIcon: v })} />
            <FlaskConical className="w-4 h-4 text-primary group-hover:text-primary" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Debug Panel
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showSecurityIcon} onChange={(v: boolean) => updateSettings({ showSecurityIcon: v })} />
            <ShieldCheck className="w-4 h-4 text-success group-hover:text-success" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Security
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showWolIcon} onChange={(v: boolean) => updateSettings({ showWolIcon: v })} />
            <Power className="w-4 h-4 text-warning group-hover:text-warning" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Wake-on-LAN
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showBulkSSHIcon} onChange={(v: boolean) => updateSettings({ showBulkSSHIcon: v })} />
            <Terminal className="w-4 h-4 text-success group-hover:text-success" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Bulk SSH Commander
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showScriptManagerIcon} onChange={(v: boolean) => updateSettings({ showScriptManagerIcon: v })} />
            <FileCode className="w-4 h-4 text-primary group-hover:text-primary" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Script Manager
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showMacroManagerIcon} onChange={(v: boolean) => updateSettings({ showMacroManagerIcon: v })} />
            <ListVideo className="w-4 h-4 text-warning group-hover:text-warning" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Macro Manager
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showRecordingManagerIcon} onChange={(v: boolean) => updateSettings({ showRecordingManagerIcon: v })} />
            <Disc className="w-4 h-4 text-error group-hover:text-error" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Recording Manager
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showErrorLogBar} onChange={(v: boolean) => updateSettings({ showErrorLogBar: v })} />
            <Bug className="w-4 h-4 text-error group-hover:text-error" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Error Log Bar
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showBackupStatusIcon} onChange={(v: boolean) => updateSettings({ showBackupStatusIcon: v })} />
            <HardDrive className="w-4 h-4 text-primary group-hover:text-primary" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Backup Status
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showCloudSyncStatusIcon} onChange={(v: boolean) => updateSettings({ showCloudSyncStatusIcon: v })} />
            <Cloud className="w-4 h-4 text-info group-hover:text-info" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Cloud Sync Status
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showSyncBackupStatusIcon} onChange={(v: boolean) => updateSettings({ showSyncBackupStatusIcon: v })} />
            <RefreshCw className="w-4 h-4 text-warning group-hover:text-warning" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Sync &amp; Backup (Combined)
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showRdpSessionsIcon} onChange={(v: boolean) => updateSettings({ showRdpSessionsIcon: v })} />
            <Cpu className="w-4 h-4 text-primary group-hover:text-primary" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              RDP Sessions
            </span>
          </label>
        </div>
      </div>
    </div>
  );
};

export default LayoutSettings;
