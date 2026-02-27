import React from "react";
import { GlobalSettings } from "../../../types/settings";
import { 
  Layout, 
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
  Mouse,
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
} from "lucide-react";

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
      <h3 className="text-lg font-medium text-white flex items-center gap-2">
        <Layout className="w-5 h-5" />
        Layout
      </h3>

      {/* Window Persistence Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-200 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Maximize2 className="w-4 h-4 text-blue-400" />
          Window Persistence
        </h4>
        <div className="space-y-3 ml-1">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.persistWindowSize}
              onChange={(e) => updateSettings({ persistWindowSize: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Maximize2 className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />
            <span className="text-gray-300 group-hover:text-white">Remember window size</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.persistWindowPosition}
              onChange={(e) => updateSettings({ persistWindowPosition: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Move className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />
            <span className="text-gray-300 group-hover:text-white">Remember window position</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.autoRepatriateWindow}
              onChange={(e) => updateSettings({ autoRepatriateWindow: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <ScreenShare className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />
            <span className="text-gray-300 group-hover:text-white">Auto-repatriate window if off-screen</span>
          </label>
          <p className="text-xs text-gray-500 ml-7">
            When enabled, automatically brings window back to a visible monitor if the saved position is off-screen (e.g., after disconnecting an external monitor).
          </p>
        </div>
      </div>

      {/* Sidebar Persistence Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-200 border-b border-gray-700 pb-2 flex items-center gap-2">
          <PanelLeft className="w-4 h-4 text-green-400" />
          Sidebar Persistence
        </h4>
        <div className="space-y-3 ml-1">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.persistSidebarWidth}
              onChange={(e) => updateSettings({ persistSidebarWidth: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <ArrowLeftRight className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />
            <span className="text-gray-300 group-hover:text-white">Remember sidebar width</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.persistSidebarPosition}
              onChange={(e) => updateSettings({ persistSidebarPosition: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Move className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />
            <span className="text-gray-300 group-hover:text-white">Remember sidebar position</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.persistSidebarCollapsed}
              onChange={(e) => updateSettings({ persistSidebarCollapsed: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <FoldVertical className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />
            <span className="text-gray-300 group-hover:text-white">Remember sidebar collapsed state</span>
          </label>
        </div>
      </div>

      {/* Reordering Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-200 border-b border-gray-700 pb-2 flex items-center gap-2">
          <GripVertical className="w-4 h-4 text-purple-400" />
          Tab Interaction
        </h4>
        <div className="space-y-3 ml-1">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.enableTabReorder}
              onChange={(e) => updateSettings({ enableTabReorder: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <FileStack className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />
            <span className="text-gray-300 group-hover:text-white">Allow tab reordering</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.enableConnectionReorder}
              onChange={(e) => updateSettings({ enableConnectionReorder: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Network className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />
            <span className="text-gray-300 group-hover:text-white">Allow connection reordering</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.middleClickCloseTab}
              onChange={(e) => updateSettings({ middleClickCloseTab: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Mouse className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />
            <span className="text-gray-300 group-hover:text-white">Middle-click to close tabs</span>
          </label>
        </div>
      </div>

      {/* Secondary Bar Icons Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-200 border-b border-gray-700 pb-2 flex items-center gap-2">
          <Settings className="w-4 h-4 text-purple-400" />
          Secondary Bar Icons
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-1">
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showQuickConnectIcon}
              onChange={(e) => updateSettings({ showQuickConnectIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Zap className="w-4 h-4 text-yellow-500 group-hover:text-yellow-400" />
            <span className="text-gray-300 group-hover:text-white">Quick Connect</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showCollectionSwitcherIcon}
              onChange={(e) => updateSettings({ showCollectionSwitcherIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <FolderSync className="w-4 h-4 text-blue-500 group-hover:text-blue-400" />
            <span className="text-gray-300 group-hover:text-white">Collection Switcher</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showImportExportIcon}
              onChange={(e) => updateSettings({ showImportExportIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <FileStack className="w-4 h-4 text-green-500 group-hover:text-green-400" />
            <span className="text-gray-300 group-hover:text-white">Import/Export</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showSettingsIcon}
              onChange={(e) => updateSettings({ showSettingsIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Settings className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />
            <span className="text-gray-300 group-hover:text-white">Settings</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showProxyMenuIcon}
              onChange={(e) => updateSettings({ showProxyMenuIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Shield className="w-4 h-4 text-indigo-500 group-hover:text-indigo-400" />
            <span className="text-gray-300 group-hover:text-white">Proxy/VPN Menu</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showInternalProxyIcon}
              onChange={(e) => updateSettings({ showInternalProxyIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <ArrowUpDown className="w-4 h-4 text-cyan-500 group-hover:text-cyan-400" />
            <span className="text-gray-300 group-hover:text-white">Internal Proxy Manager</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showShortcutManagerIcon}
              onChange={(e) => updateSettings({ showShortcutManagerIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Keyboard className="w-4 h-4 text-pink-500 group-hover:text-pink-400" />
            <span className="text-gray-300 group-hover:text-white">Shortcut Manager</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showPerformanceMonitorIcon}
              onChange={(e) => updateSettings({ showPerformanceMonitorIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Activity className="w-4 h-4 text-red-500 group-hover:text-red-400" />
            <span className="text-gray-300 group-hover:text-white">Performance Monitor</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showActionLogIcon}
              onChange={(e) => updateSettings({ showActionLogIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <FileStack className="w-4 h-4 text-cyan-500 group-hover:text-cyan-400" />
            <span className="text-gray-300 group-hover:text-white">Action Log</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showDevtoolsIcon}
              onChange={(e) => updateSettings({ showDevtoolsIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Code className="w-4 h-4 text-amber-500 group-hover:text-amber-400" />
            <span className="text-gray-300 group-hover:text-white">Devtools</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showSecurityIcon}
              onChange={(e) => updateSettings({ showSecurityIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <ShieldCheck className="w-4 h-4 text-emerald-500 group-hover:text-emerald-400" />
            <span className="text-gray-300 group-hover:text-white">Security</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showWolIcon}
              onChange={(e) => updateSettings({ showWolIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Power className="w-4 h-4 text-orange-500 group-hover:text-orange-400" />
            <span className="text-gray-300 group-hover:text-white">Wake-on-LAN</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showBulkSSHIcon}
              onChange={(e) => updateSettings({ showBulkSSHIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Terminal className="w-4 h-4 text-green-500 group-hover:text-green-400" />
            <span className="text-gray-300 group-hover:text-white">Bulk SSH Commander</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showScriptManagerIcon}
              onChange={(e) => updateSettings({ showScriptManagerIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <FileCode className="w-4 h-4 text-purple-500 group-hover:text-purple-400" />
            <span className="text-gray-300 group-hover:text-white">Script Manager</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showErrorLogBar}
              onChange={(e) => updateSettings({ showErrorLogBar: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Bug className="w-4 h-4 text-red-500 group-hover:text-red-400" />
            <span className="text-gray-300 group-hover:text-white">Error Log Bar</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showBackupStatusIcon}
              onChange={(e) => updateSettings({ showBackupStatusIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <HardDrive className="w-4 h-4 text-blue-500 group-hover:text-blue-400" />
            <span className="text-gray-300 group-hover:text-white">Backup Status</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showCloudSyncStatusIcon}
              onChange={(e) => updateSettings({ showCloudSyncStatusIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Cloud className="w-4 h-4 text-cyan-500 group-hover:text-cyan-400" />
            <span className="text-gray-300 group-hover:text-white">Cloud Sync Status</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showSyncBackupStatusIcon}
              onChange={(e) => updateSettings({ showSyncBackupStatusIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <RefreshCw className="w-4 h-4 text-yellow-500 group-hover:text-yellow-400" />
            <span className="text-gray-300 group-hover:text-white">Sync &amp; Backup (Combined)</span>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.showRdpSessionsIcon}
              onChange={(e) => updateSettings({ showRdpSessionsIcon: e.target.checked })}
              className="rounded border-gray-600 bg-gray-700 text-blue-600 w-4 h-4"
            />
            <Cpu className="w-4 h-4 text-indigo-500 group-hover:text-indigo-400" />
            <span className="text-gray-300 group-hover:text-white">RDP Sessions</span>
          </label>
        </div>
      </div>
    </div>
  );
};

export default LayoutSettings;
