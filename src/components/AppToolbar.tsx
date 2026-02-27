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
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { GlobalSettings, CloudSyncProvider } from "../types/settings";
import { Connection } from "../types/connection";
import { BackupStatusPopup } from "./BackupStatusPopup";
import { CloudSyncStatusPopup } from "./CloudSyncStatusPopup";
import { SyncBackupStatusBar } from "./SyncBackupStatusBar";
import { CollectionManager } from "../utils/collectionManager";

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
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Top bar */}
      <div
        className="h-12 app-bar border-b flex items-center justify-between px-4 select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3">
          <Monitor size={18} className="text-blue-400" />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">
              {t("app.title")}
            </div>
            <div className="text-[10px] text-gray-500 uppercase">
              {t("app.subtitle")}
            </div>
          </div>
          {collectionManager.getCurrentCollection() && (
            <span className="text-[10px] text-blue-300 bg-blue-900/30 px-2 py-1 rounded">
              {collectionManager.getCurrentCollection()?.name}
            </span>
          )}
        </div>

        {/* Window Controls */}
        <div className="flex items-center space-x-1">
          {(appSettings.showTransparencyToggle ?? true) && (
            <button
              onClick={handleToggleTransparency}
              className="app-bar-button p-2"
              data-tooltip={
                appSettings.windowTransparencyEnabled
                  ? "Disable transparency"
                  : "Enable transparency"
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
            title={isAlwaysOnTop ? "Unpin window" : "Pin window"}
          >
            <Pin
              size={14}
              className={isAlwaysOnTop ? "rotate-45 text-blue-400" : ""}
            />
          </button>
          <button
            onClick={handleRepatriateWindow}
            className="app-bar-button p-2"
            title="Center window on screen"
          >
            <ScreenShare size={14} />
          </button>
          <button
            onClick={handleMinimize}
            className="app-bar-button p-2"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="app-bar-button p-2"
            title="Maximize"
          >
            <Square size={12} />
          </button>
          <button
            onClick={handleClose}
            className="app-bar-button app-bar-button-danger p-2"
            title="Close"
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
            >
              <Zap size={14} />
            </button>
          )}
          {appSettings.showCollectionSwitcherIcon && (
            <button
              onClick={() => setShowCollectionSelector(true)}
              className="app-bar-button p-2"
              title="Switch Collection"
            >
              <Database size={14} />
            </button>
          )}
          {appSettings.showSettingsIcon && (
            <button
              onClick={() => setShowSettings(true)}
              className="app-bar-button p-2"
              title="Settings"
            >
              <Settings size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center space-x-1">
          {appSettings.showRdpSessionsIcon && (
            <button
              onClick={() => setRdpPanelOpen(prev => !prev)}
              className={`app-bar-button p-2 ${rdpPanelOpen ? 'text-indigo-400' : ''}`}
              title="RDP Sessions"
            >
              <Cpu size={14} />
            </button>
          )}
          {appSettings.showInternalProxyIcon && (
            <button
              onClick={() => setShowInternalProxyManager(true)}
              className="app-bar-button p-2"
              title="Internal Proxy Manager"
            >
              <ArrowUpDown size={14} />
            </button>
          )}
          {appSettings.showProxyMenuIcon && (
            <button
              onClick={() => setShowProxyMenu(true)}
              className="app-bar-button p-2"
              title="Proxy & VPN"
            >
              <Network size={14} />
            </button>
          )}
          {appSettings.showShortcutManagerIcon && (
            <button
              onClick={() => setShowShortcutManager(true)}
              className="app-bar-button p-2"
              title="Shortcut Manager"
            >
              <Keyboard size={14} />
            </button>
          )}
          {appSettings.showWolIcon && (
            <button
              onClick={() => setShowWol(true)}
              className="app-bar-button p-2"
              title="Wake-on-LAN"
            >
              <Power size={14} />
            </button>
          )}
          {appSettings.showBulkSSHIcon && (
            <button
              onClick={() => setShowBulkSSH(true)}
              className="app-bar-button p-2"
              title={t('bulkSsh.title', 'Bulk SSH Commander')}
            >
              <Terminal size={14} />
            </button>
          )}
          {appSettings.showScriptManagerIcon && (
            <button
              onClick={() => setShowScriptManager(true)}
              className="app-bar-button p-2"
              title={t('scriptManager.title', 'Script Manager')}
            >
              <FileCode size={14} />
            </button>
          )}
          {appSettings.showMacroManagerIcon && (
            <button
              onClick={() => setShowMacroManager(true)}
              className="app-bar-button p-2"
              title="Macro Manager"
            >
              <ListVideo size={14} />
            </button>
          )}
          {appSettings.showRecordingManagerIcon && (
            <button
              onClick={() => setShowRecordingManager(true)}
              className="app-bar-button p-2"
              title="Recording Manager"
            >
              <Disc size={14} />
            </button>
          )}
          {appSettings.showPerformanceMonitorIcon && (
            <button
              onClick={() => setShowPerformanceMonitor(true)}
              className="app-bar-button p-2"
              title="Performance Monitor"
            >
              <BarChart3 size={14} />
            </button>
          )}
          {appSettings.showActionLogIcon && (
            <button
              onClick={() => setShowActionLog(true)}
              className="app-bar-button p-2"
              title="Action Log"
            >
              <ScrollText size={14} />
            </button>
          )}
          {appSettings.showErrorLogBar && (
            <button
              onClick={() => setShowErrorLog(!showErrorLog)}
              className={`app-bar-button p-2 ${showErrorLog ? "text-red-400" : ""}`}
              title="Toggle Error Log"
            >
              <Bug size={14} />
            </button>
          )}
          {appSettings.showDevtoolsIcon && (
            <button
              onClick={handleOpenDevtools}
              className="app-bar-button p-2"
              title="Open dev console"
            >
              <Terminal size={14} />
            </button>
          )}
          {appSettings.showSecurityIcon && (
            <button
              onClick={handleShowPasswordDialog}
              className="app-bar-button p-2"
              title="Security"
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
