import React from "react";
import { GlobalSettings } from "../../../types/settings";
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
} from "lucide-react";
import { Checkbox } from '../../ui/forms';
import SectionHeading from '../../ui/SectionHeading';

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
          <Maximize2 className="w-4 h-4 text-blue-400" />
          Window Persistence
        </h4>
        <div className="space-y-3 ml-1">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.persistWindowSize} onChange={(v: boolean) => updateSettings({ persistWindowSize: v })} />
            <Maximize2 className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Remember window size
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.persistWindowPosition} onChange={(v: boolean) => updateSettings({ persistWindowPosition: v })} />
            <Move className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Remember window position
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.autoRepatriateWindow} onChange={(v: boolean) => updateSettings({ autoRepatriateWindow: v })} />
            <ScreenShare className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Auto-repatriate window if off-screen
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
          <PanelLeft className="w-4 h-4 text-green-400" />
          Sidebar Persistence
        </h4>
        <div className="space-y-3 ml-1">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.persistSidebarWidth} onChange={(v: boolean) => updateSettings({ persistSidebarWidth: v })} />
            <ArrowLeftRight className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Remember sidebar width
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.persistSidebarPosition} onChange={(v: boolean) => updateSettings({ persistSidebarPosition: v })} />
            <Move className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Remember sidebar position
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.persistSidebarCollapsed} onChange={(v: boolean) => updateSettings({ persistSidebarCollapsed: v })} />
            <FoldVertical className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Remember sidebar collapsed state
            </span>
          </label>
        </div>
      </div>

      {/* Reordering Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <GripVertical className="w-4 h-4 text-purple-400" />
          Tab Interaction
        </h4>
        <div className="space-y-3 ml-1">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.enableTabReorder} onChange={(v: boolean) => updateSettings({ enableTabReorder: v })} />
            <FileStack className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Allow tab reordering
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.enableConnectionReorder} onChange={(v: boolean) => updateSettings({ enableConnectionReorder: v })} />
            <Network className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Allow connection reordering
            </span>
          </label>
        </div>
      </div>

      {/* Secondary Bar Icons Section */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Settings className="w-4 h-4 text-purple-400" />
          Secondary Bar Icons
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-1">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showQuickConnectIcon} onChange={(v: boolean) => updateSettings({ showQuickConnectIcon: v })} />
            <Zap className="w-4 h-4 text-yellow-500 group-hover:text-yellow-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Quick Connect
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showCollectionSwitcherIcon} onChange={(v: boolean) => updateSettings({ showCollectionSwitcherIcon: v })} />
            <FolderSync className="w-4 h-4 text-blue-500 group-hover:text-blue-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Collection Switcher
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showImportExportIcon} onChange={(v: boolean) => updateSettings({ showImportExportIcon: v })} />
            <FileStack className="w-4 h-4 text-green-500 group-hover:text-green-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Import/Export
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showSettingsIcon} onChange={(v: boolean) => updateSettings({ showSettingsIcon: v })} />
            <Settings className="w-4 h-4 text-[var(--color-textMuted)] group-hover:text-[var(--color-textSecondary)]" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Settings
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showProxyMenuIcon} onChange={(v: boolean) => updateSettings({ showProxyMenuIcon: v })} />
            <Shield className="w-4 h-4 text-indigo-500 group-hover:text-indigo-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Proxy/VPN Menu
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showInternalProxyIcon} onChange={(v: boolean) => updateSettings({ showInternalProxyIcon: v })} />
            <ArrowUpDown className="w-4 h-4 text-cyan-500 group-hover:text-cyan-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Internal Proxy Manager
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showShortcutManagerIcon} onChange={(v: boolean) => updateSettings({ showShortcutManagerIcon: v })} />
            <Keyboard className="w-4 h-4 text-pink-500 group-hover:text-pink-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Shortcut Manager
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showPerformanceMonitorIcon} onChange={(v: boolean) => updateSettings({ showPerformanceMonitorIcon: v })} />
            <Activity className="w-4 h-4 text-red-500 group-hover:text-red-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Performance Monitor
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showActionLogIcon} onChange={(v: boolean) => updateSettings({ showActionLogIcon: v })} />
            <FileStack className="w-4 h-4 text-cyan-500 group-hover:text-cyan-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Action Log
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showDevtoolsIcon} onChange={(v: boolean) => updateSettings({ showDevtoolsIcon: v })} />
            <Code className="w-4 h-4 text-amber-500 group-hover:text-amber-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Devtools
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showSecurityIcon} onChange={(v: boolean) => updateSettings({ showSecurityIcon: v })} />
            <ShieldCheck className="w-4 h-4 text-emerald-500 group-hover:text-emerald-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Security
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showWolIcon} onChange={(v: boolean) => updateSettings({ showWolIcon: v })} />
            <Power className="w-4 h-4 text-orange-500 group-hover:text-orange-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Wake-on-LAN
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showBulkSSHIcon} onChange={(v: boolean) => updateSettings({ showBulkSSHIcon: v })} />
            <Terminal className="w-4 h-4 text-green-500 group-hover:text-green-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Bulk SSH Commander
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showScriptManagerIcon} onChange={(v: boolean) => updateSettings({ showScriptManagerIcon: v })} />
            <FileCode className="w-4 h-4 text-purple-500 group-hover:text-purple-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Script Manager
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showMacroManagerIcon} onChange={(v: boolean) => updateSettings({ showMacroManagerIcon: v })} />
            <ListVideo className="w-4 h-4 text-orange-500 group-hover:text-orange-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Macro Manager
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showRecordingManagerIcon} onChange={(v: boolean) => updateSettings({ showRecordingManagerIcon: v })} />
            <Disc className="w-4 h-4 text-red-500 group-hover:text-red-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Recording Manager
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showErrorLogBar} onChange={(v: boolean) => updateSettings({ showErrorLogBar: v })} />
            <Bug className="w-4 h-4 text-red-500 group-hover:text-red-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Error Log Bar
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showBackupStatusIcon} onChange={(v: boolean) => updateSettings({ showBackupStatusIcon: v })} />
            <HardDrive className="w-4 h-4 text-blue-500 group-hover:text-blue-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Backup Status
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showCloudSyncStatusIcon} onChange={(v: boolean) => updateSettings({ showCloudSyncStatusIcon: v })} />
            <Cloud className="w-4 h-4 text-cyan-500 group-hover:text-cyan-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Cloud Sync Status
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showSyncBackupStatusIcon} onChange={(v: boolean) => updateSettings({ showSyncBackupStatusIcon: v })} />
            <RefreshCw className="w-4 h-4 text-yellow-500 group-hover:text-yellow-400" />
            <span className="text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
              Sync &amp; Backup (Combined)
            </span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <Checkbox checked={settings.showRdpSessionsIcon} onChange={(v: boolean) => updateSettings({ showRdpSessionsIcon: v })} />
            <Cpu className="w-4 h-4 text-indigo-500 group-hover:text-indigo-400" />
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
