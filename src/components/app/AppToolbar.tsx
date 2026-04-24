import React from "react";
import {
  Monitor,
  Zap,
  Terminal,
  Minus,
  Square,
  X,
  Pin,
  Settings,
  Database,
  BarChart3,
  ScrollText,
  Shield,
  Droplet,
  Keyboard,
  Network,
  Power,
  Bug,
  FileCode,
  ScreenShare,
  ArrowUpDown,
  Cpu,
  ListVideo,
  Disc,
  Server,
  FlaskConical,
  Tag,
  Layers,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { GlobalSettings, CloudSyncProvider } from "../../types/settings/settings";
import { Connection } from "../../types/connection/connection";
import { BackupStatusPopup } from "../sync/BackupStatusPopup";
import { CloudSyncStatusPopup } from "../sync/CloudSyncStatusPopup";
import { SyncBackupStatusBar } from "../sync/SyncBackupStatusBar";
import { CollectionManager } from "../../utils/connection/collectionManager";

interface AppToolbarProps {
  appSettings: GlobalSettings;
  isAlwaysOnTop: boolean;
  rdpPanelOpen: boolean;
  showErrorLog: boolean;
  collectionManager: CollectionManager;
  connections: Connection[];
  setShowQuickConnect: (v: boolean) => void;
  setShowCollectionSelector: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setRdpPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowInternalProxyManager: (v: boolean) => void;
  setShowProxyMenu: (v: boolean) => void;
  setShowShortcutManager: (v: boolean) => void;
  setShowWol: (v: boolean) => void;
  setShowBulkSSH: (v: boolean) => void;
  setShowServerStats: (v: boolean) => void;
  setShowOpkssh: (v: boolean) => void;
  setShowMcpServer: (v: boolean) => void;
  setShowScriptManager: (v: boolean) => void;
  setShowMacroManager: (v: boolean) => void;
  setShowRecordingManager: (v: boolean) => void;
  setShowPerformanceMonitor: (v: boolean) => void;
  setShowActionLog: (v: boolean) => void;
  setShowErrorLog: React.Dispatch<React.SetStateAction<boolean>>;
  handleToggleTransparency: () => void;
  handleToggleAlwaysOnTop: () => void;
  handleRepatriateWindow: () => void;
  handleMinimize: () => void;
  handleMaximize: () => void;
  handleClose: () => void;
  handleOpenDevtools: () => void;
  handleShowPasswordDialog: () => void;
  performCloudSync: (provider?: CloudSyncProvider) => Promise<void>;
  setShowDebugPanel: (v: boolean) => void;
  setShowTagManager: (v: boolean) => void;
  setShowTabGroupManager: (v: boolean) => void;
}

export const AppToolbar: React.FC<AppToolbarProps> = ({
  appSettings,
  isAlwaysOnTop,
  rdpPanelOpen,
  showErrorLog,
  collectionManager,
  connections,
  setShowQuickConnect,
  setShowCollectionSelector,
  setShowSettings,
  setRdpPanelOpen,
  setShowInternalProxyManager,
  setShowProxyMenu,
  setShowShortcutManager,
  setShowWol,
  setShowBulkSSH,
  setShowServerStats,
  setShowOpkssh,
  setShowMcpServer,
  setShowScriptManager,
  setShowMacroManager,
  setShowRecordingManager,
  setShowPerformanceMonitor,
  setShowActionLog,
  setShowErrorLog,
  handleToggleTransparency,
  handleToggleAlwaysOnTop,
  handleRepatriateWindow,
  handleMinimize,
  handleMaximize,
  handleClose,
  handleOpenDevtools,
  handleShowPasswordDialog,
  performCloudSync,
  setShowDebugPanel,
  setShowTagManager,
  setShowTabGroupManager,
}) => {
  const { t } = useTranslation();
  const noCollection = !collectionManager.getCurrentCollection();

  return (
    <>
      {/* Top bar */}
      <div
        data-testid="toolbar"
        className="h-12 app-bar border-b flex items-center justify-between px-4 select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3">
          <Monitor size={18} className="text-primary" />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">
              {t("app.title")}
            </div>
            <div className="text-[10px] text-[var(--color-textMuted)] uppercase">
              {t("app.subtitle")}
            </div>
          </div>
          {/* Collection name shown in status bar instead */}
        </div>

        {/* Window Controls */}
        <div className="flex items-center space-x-1">
          {(appSettings.showTransparencyToggle ?? false) && (
            <button
              onClick={handleToggleTransparency}
              className="app-bar-button p-2"
              data-tooltip={
                appSettings.windowTransparencyEnabled
                  ? t("toolbar.disableTransparency", "Disable transparency")
                  : t("toolbar.enableTransparency", "Enable transparency")
              }
            >
              {appSettings.windowTransparencyEnabled ? (
                <Droplet size={14} />
              ) : (
                <Droplet size={14} className="opacity-40" />
              )}
            </button>
          )}
          <button
            onClick={handleToggleAlwaysOnTop}
            className="app-bar-button p-2"
            title={isAlwaysOnTop ? t("toolbar.unpinWindow", "Unpin window") : t("toolbar.pinWindow", "Pin window")}
          >
            <Pin
              size={14}
              className={isAlwaysOnTop ? "rotate-45 text-primary" : ""}
            />
          </button>
          <button
            onClick={handleRepatriateWindow}
            className="app-bar-button p-2"
            title={t("toolbar.centerWindow", "Center window on screen")}
          >
            <ScreenShare size={14} />
          </button>
          <button
            data-testid="window-minimize"
            onClick={handleMinimize}
            className="app-bar-button p-2"
            title={t("toolbar.minimize", "Minimize")}
          >
            <Minus size={14} />
          </button>
          <button
            data-testid="window-maximize"
            onClick={handleMaximize}
            className="app-bar-button p-2"
            title={t("toolbar.maximize", "Maximize")}
          >
            <Square size={12} />
          </button>
          <button
            data-testid="window-close"
            onClick={handleClose}
            className="app-bar-button app-bar-button-danger p-2"
            title={t("toolbar.close", "Close")}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Secondary actions bar */}
      <div className="h-9 app-bar-secondary border-b flex items-center justify-between px-3 select-none relative z-20">
        <div className="flex items-center space-x-1">
          {appSettings.showQuickConnectIcon && (
            <button
              onClick={() => setShowQuickConnect(true)}
              className="app-bar-button p-2"
              title={t("connections.quickConnect")}
              data-testid="toolbar-quick-connect"
            >
              <Zap size={14} />
            </button>
          )}
          {appSettings.showCollectionSwitcherIcon && (
            <button
              onClick={() => setShowCollectionSelector(true)}
              className="app-bar-button p-2"
              title={t("toolbar.switchCollection", "Switch Collection")}
              data-testid="toolbar-collection"
            >
              <Database size={14} />
            </button>
          )}
          {appSettings.showSettingsIcon && (
            <button
              onClick={() => setShowSettings(true)}
              className="app-bar-button p-2"
              title={t("toolbar.settings", "Settings")}
              data-testid="toolbar-settings"
            >
              <Settings size={14} />
            </button>
          )}
          <button
            onClick={() => setShowTagManager(true)}
            disabled={noCollection}
            className="app-bar-button p-2"
            title={t("toolbar.tagManager", "Tag Manager")}
          >
            <Tag size={14} />
          </button>
          <button
            onClick={() => setShowTabGroupManager(true)}
            disabled={noCollection}
            className="app-bar-button p-2"
            title={t("toolbar.tabGroupManager", "Tab Group Manager")}
          >
            <Layers size={14} />
          </button>
        </div>

        <div className="flex items-center space-x-1">
          {appSettings.showRdpSessionsIcon && (
            <button
              onClick={() => setRdpPanelOpen(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.rdpSessions", "RDP Sessions")}
            >
              <Cpu size={14} />
            </button>
          )}
          {appSettings.showInternalProxyIcon && (
            <button
              onClick={() => setShowInternalProxyManager(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.internalProxy", "Internal Proxy Manager")}
            >
              <ArrowUpDown size={14} />
            </button>
          )}
          {appSettings.showProxyMenuIcon && (
            <button
              onClick={() => setShowProxyMenu(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.proxyVpn", "Proxy & VPN")}
            >
              <Network size={14} />
            </button>
          )}
          {appSettings.showShortcutManagerIcon && (
            <button
              onClick={() => setShowShortcutManager(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.shortcutManager", "Shortcut Manager")}
            >
              <Keyboard size={14} />
            </button>
          )}
          {appSettings.showWolIcon && (
            <button
              onClick={() => setShowWol(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.wakeOnLan", "Wake-on-LAN")}
            >
              <Power size={14} />
            </button>
          )}
          {appSettings.showBulkSSHIcon && (
            <button
              onClick={() => setShowBulkSSH(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t('bulkSsh.title', 'Bulk SSH Commander')}
            >
              <Terminal size={14} />
            </button>
          )}
          {appSettings.showServerStatsIcon && (
            <button
              onClick={() => setShowServerStats(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t('serverStats.title', 'Server Stats')}
            >
              <Server size={14} />
            </button>
          )}
          {appSettings.showOpksshIcon && (
            <button
              onClick={() => setShowOpkssh(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t('opkssh.title', 'opkssh')}
            >
              <Shield size={14} />
            </button>
          )}
          {appSettings.showMcpServerIcon && (
            <button
              onClick={() => setShowMcpServer(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t('mcpServer.title', 'MCP Server')}
            >
              <Server size={14} />
            </button>
          )}
          {appSettings.showScriptManagerIcon && (
            <button
              onClick={() => setShowScriptManager(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t('scriptManager.title', 'Script Manager')}
            >
              <FileCode size={14} />
            </button>
          )}
          {appSettings.showMacroManagerIcon && (
            <button
              onClick={() => setShowMacroManager(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.macroManager", "Macro Manager")}
            >
              <ListVideo size={14} />
            </button>
          )}
          {appSettings.showRecordingManagerIcon && (
            <button
              onClick={() => setShowRecordingManager(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.recordingManager", "Recording Manager")}
            >
              <Disc size={14} />
            </button>
          )}
          {appSettings.showPerformanceMonitorIcon && (
            <button
              onClick={() => setShowPerformanceMonitor(true)}
              className="app-bar-button p-2"
              title={t("toolbar.performanceMonitor", "Performance Monitor")}
            >
              <BarChart3 size={14} />
            </button>
          )}
          {appSettings.showActionLogIcon && (
            <button
              onClick={() => setShowActionLog(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.actionLog", "Action Log")}
            >
              <ScrollText size={14} />
            </button>
          )}
          {appSettings.showErrorLogBar && (
            <button
              onClick={() => setShowErrorLog(!showErrorLog)}
              className={`app-bar-button p-2 ${showErrorLog ? "text-error" : ""}`}
              title={t("toolbar.toggleErrorLog", "Toggle Error Log")}
            >
              <Bug size={14} />
            </button>
          )}
          {appSettings.showDevtoolsIcon && (
            <button
              onClick={handleOpenDevtools}
              className="app-bar-button p-2"
              title={t("toolbar.devConsole", "Open dev console")}
            >
              <Terminal size={14} />
            </button>
          )}
          {appSettings.showDebugPanelIcon && (
            <button
              onClick={() => setShowDebugPanel(true)}
              className="app-bar-button p-2"
              title={t("toolbar.debugPanel", "Debug Panel")}
            >
              <FlaskConical size={14} />
            </button>
          )}
          {appSettings.showSecurityIcon && (
            <button
              onClick={handleShowPasswordDialog}
              className="app-bar-button p-2"
              title={t("toolbar.security", "Security")}
            >
              <Shield size={14} />
            </button>
          )}
          {appSettings.showBackupStatusIcon && (
            <BackupStatusPopup
              onBackupNow={async () => {
                const data = {
                  connections,
                  settings: appSettings,
                  timestamp: Date.now(),
                };
                await invoke('backup_run_now', {
                  backupType: 'manual',
                  data
                });
              }}
              onOpenSettings={() => setShowSettings(true)}
            />
          )}
          {appSettings.showCloudSyncStatusIcon && (
            <CloudSyncStatusPopup
              cloudSyncConfig={appSettings.cloudSync}
              onSyncNow={performCloudSync}
              onOpenSettings={() => setShowSettings(true)}
            />
          )}
          {appSettings.showSyncBackupStatusIcon && (
            <SyncBackupStatusBar
              cloudSyncConfig={appSettings.cloudSync}
              onSyncNow={() => {
                void performCloudSync();
              }}
              onBackupNow={async () => {
                try {
                  const data = {
                    connections,
                    settings: appSettings,
                    timestamp: Date.now(),
                  };
                  await invoke('backup_run_now', {
                    backupType: 'manual',
                    data
                  });
                } catch (error) {
                  console.error('Backup failed:', error);
                }
              }}
              onOpenSettings={() => setShowSettings(true)}
            />
          )}
        </div>
      </div>
    </>
  );
};
