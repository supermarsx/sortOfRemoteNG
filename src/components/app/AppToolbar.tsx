import React from "react";
import {
  Monitor,
  Zap,
  Terminal,
  Minus,
  Square,
  X,
  Pin,
  Database,
  Shield,
  Droplet,
  Bug,
  ScreenShare,
  FlaskConical,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  GlobalSettings,
  CloudSyncProvider,
} from "../../types/settings/settings";
import { Connection } from "../../types/connection/connection";
import { BackupStatusPopup } from "../sync/BackupStatusPopup";
import { CloudSyncStatusPopup } from "../sync/CloudSyncStatusPopup";
import { SyncBackupStatusBar } from "../sync/SyncBackupStatusBar";
import type { SettingsTabId } from "../SettingsDialog/settingsConstants";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { buildBackupPayload } from "../../utils/services/backupPayload";
import { TOOL_DESCRIPTORS } from "./toolDescriptors";
import type { ToolKey } from "./toolSession";

const ToolGlyph: React.FC<{ tool: ToolKey; size?: number }> = ({
  tool,
  size = 14,
}) => {
  const Icon = TOOL_DESCRIPTORS[tool].icon;
  return <Icon size={size} data-tool-icon={tool} />;
};

interface AppToolbarProps {
  appSettings: GlobalSettings;
  isAlwaysOnTop: boolean;
  rdpPanelOpen: boolean;
  showErrorLog: boolean;
  databaseManager: DatabaseManager;
  connections: Connection[];
  setShowQuickConnect: (v: boolean) => void;
  setShowDatabasePanel: (v: boolean) => void;
  openImportExport: () => void;
  /**
   * Open the settings surface, optionally deep-linked to a tab. Called with no
   * argument by the generic gear icon, and with a tab id by the sync/backup
   * affordances so each lands on its own settings section.
   */
  openSettings: (tab?: SettingsTabId) => void;
  setRdpPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
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
  databaseManager,
  connections,
  setShowQuickConnect,
  setShowDatabasePanel,
  openImportExport,
  openSettings,
  setRdpPanelOpen,
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
  const noCollection = !databaseManager.getCurrentDatabase();

  return (
    <>
      {/* Top bar — kept above the modal backdrop so the window handle never
          fades while a dialog is open. */}
      <div
        data-testid="toolbar"
        className="h-12 app-bar border-b flex items-center justify-between px-4 select-none relative z-[1100]"
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
            title={
              isAlwaysOnTop
                ? t("toolbar.unpinWindow", "Unpin window")
                : t("toolbar.pinWindow", "Pin window")
            }
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

      {/* Secondary actions bar. It is also a drag region so empty space
          behaves like the title bar while the buttons remain clickable. */}
      <div
        data-testid="toolbar-actions"
        className="h-9 app-bar-secondary border-b flex items-center justify-between px-3 select-none relative z-20"
        data-tauri-drag-region
      >
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
              onClick={() => setShowDatabasePanel(true)}
              className="app-bar-button p-2"
              title={t("toolbar.switchCollection", "Collections")}
              data-testid="toolbar-collection"
            >
              <Database size={14} />
            </button>
          )}
          {appSettings.showImportExportIcon && (
            <button
              onClick={openImportExport}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.importExport", "Import / Export")}
              data-testid="toolbar-import-export"
            >
              <ToolGlyph tool="importExport" />
            </button>
          )}
          {appSettings.showSettingsIcon && (
            <button
              onClick={() => openSettings()}
              className="app-bar-button p-2"
              title={t("toolbar.settings", "Settings")}
              data-testid="toolbar-settings"
            >
              <ToolGlyph tool="settings" />
            </button>
          )}
          <button
            onClick={() => setShowTagManager(true)}
            disabled={noCollection}
            className="app-bar-button p-2"
            title={t("toolbar.tagManager", "Tag Manager")}
          >
            <ToolGlyph tool="tagManager" />
          </button>
          <button
            onClick={() => setShowTabGroupManager(true)}
            disabled={noCollection}
            className="app-bar-button p-2"
            title={t("toolbar.tabGroupManager", "Tab Group Manager")}
          >
            <ToolGlyph tool="tabGroupManager" />
          </button>
        </div>

        <div className="flex items-center space-x-1">
          {appSettings.showRdpSessionsIcon && (
            <button
              onClick={() => setRdpPanelOpen(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.sessionManager", "Session Manager")}
            >
              <ToolGlyph tool="rdpSessions" />
            </button>
          )}
          {appSettings.showProxyMenuIcon && (
            <button
              onClick={() => setShowProxyMenu(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.proxyVpn", "Proxy & VPN")}
            >
              <ToolGlyph tool="proxyChain" />
            </button>
          )}
          {appSettings.showShortcutManagerIcon && (
            <button
              onClick={() => setShowShortcutManager(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.shortcutManager", "Shortcut Manager")}
            >
              <ToolGlyph tool="shortcutManager" />
            </button>
          )}
          {appSettings.showWolIcon && (
            <button
              onClick={() => setShowWol(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.wakeOnLan", "Wake-on-LAN")}
            >
              <ToolGlyph tool="wol" />
            </button>
          )}
          {appSettings.showBulkSSHIcon && (
            <button
              onClick={() => setShowBulkSSH(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("bulkSsh.title", "Bulk SSH")}
            >
              <ToolGlyph tool="bulkSsh" />
            </button>
          )}
          {appSettings.showServerStatsIcon && (
            <button
              onClick={() => setShowServerStats(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("serverStats.title", "Server Stats")}
            >
              <ToolGlyph tool="serverStats" />
            </button>
          )}
          {appSettings.showOpksshIcon && (
            <button
              onClick={() => setShowOpkssh(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("opkssh.title", "opkssh")}
            >
              <ToolGlyph tool="opkssh" />
            </button>
          )}
          {appSettings.showMcpServerIcon && (
            <button
              onClick={() => setShowMcpServer(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("mcpServer.title", "MCP Server")}
            >
              <ToolGlyph tool="mcpServer" />
            </button>
          )}
          {appSettings.showScriptManagerIcon && (
            <button
              onClick={() => setShowScriptManager(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("scriptManager.title", "Script Manager")}
            >
              <ToolGlyph tool="scriptManager" />
            </button>
          )}
          {appSettings.showMacroManagerIcon && (
            <button
              onClick={() => setShowMacroManager(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.macroManager", "Macro Manager")}
            >
              <ToolGlyph tool="macroManager" />
            </button>
          )}
          {appSettings.showRecordingManagerIcon && (
            <button
              onClick={() => setShowRecordingManager(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.recordingManager", "Recording Manager")}
            >
              <ToolGlyph tool="recordingManager" />
            </button>
          )}
          {appSettings.showPerformanceMonitorIcon && (
            <button
              onClick={() => setShowPerformanceMonitor(true)}
              className="app-bar-button p-2"
              title={t("toolbar.performanceMonitor", "Performance Monitor")}
            >
              <ToolGlyph tool="performanceMonitor" />
            </button>
          )}
          {appSettings.showActionLogIcon && (
            <button
              onClick={() => setShowActionLog(true)}
              disabled={noCollection}
              className="app-bar-button p-2"
              title={t("toolbar.actionLog", "Action Log")}
            >
              <ToolGlyph tool="actionLog" />
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
                const data = buildBackupPayload(
                  {
                    connections,
                    settings: appSettings,
                    timestamp: Date.now(),
                  },
                  appSettings.backup,
                );
                await invoke("backup_update_config", {
                  config: appSettings.backup,
                });
                await invoke("backup_run_now", {
                  backupType: "manual",
                  data,
                });
              }}
              onOpenSettings={openSettings}
            />
          )}
          {appSettings.showCloudSyncStatusIcon && (
            <CloudSyncStatusPopup
              cloudSyncConfig={appSettings.cloudSync}
              onSyncNow={performCloudSync}
              onOpenSettings={openSettings}
            />
          )}
          {appSettings.showSyncBackupStatusIcon && (
            <SyncBackupStatusBar
              cloudSyncConfig={appSettings.cloudSync}
              onSyncNow={performCloudSync}
              onBackupNow={async () => {
                try {
                  const data = buildBackupPayload(
                    {
                      connections,
                      settings: appSettings,
                      timestamp: Date.now(),
                    },
                    appSettings.backup,
                  );
                  await invoke("backup_update_config", {
                    config: appSettings.backup,
                  });
                  await invoke("backup_run_now", {
                    backupType: "manual",
                    data,
                  });
                } catch (error) {
                  console.error("Backup failed:", error);
                }
              }}
              onOpenSettings={openSettings}
            />
          )}
        </div>
      </div>
    </>
  );
};
