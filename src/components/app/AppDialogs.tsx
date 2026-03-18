import React from "react";
import dynamic from "next/dynamic";
import { Connection, ConnectionSession } from "../../types/connection/connection";
import { GlobalSettings } from "../../types/settings/settings";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { CollectionManager } from "../../utils/connection/collectionManager";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
import RDPSessionPanel from "../rdp/RDPSessionPanel";
import { ErrorLogBar } from "./ErrorLogBar";
import { Modal } from "../ui/overlays/Modal";

const AutoLockManager = dynamic(
  () => import("../security/AutoLockManager").then((module) => module.AutoLockManager),
  { ssr: false },
);
const CollectionSelector = dynamic(
  () => import("../connection/CollectionSelector").then((module) => module.CollectionSelector),
  { ssr: false },
);
const ConnectionEditor = dynamic(
  () => import("../connection/ConnectionEditor").then((module) => module.ConnectionEditor),
  { ssr: false },
);
const QuickConnect = dynamic(
  () => import("../connection/QuickConnect").then((module) => module.QuickConnect),
  { ssr: false },
);
const PasswordDialog = dynamic(
  () => import("../security/PasswordDialog"),
  { ssr: false },
);
const SettingsDialog = dynamic(
  () => import("../settingsDialog").then((module) => module.SettingsDialog),
  { ssr: false },
);
const ImportExport = dynamic(
  () => import("../importExport").then((module) => module.ImportExport),
  { ssr: false },
);
const PerformanceMonitor = dynamic(
  () => import("../monitoring/PerformanceMonitor").then((module) => module.PerformanceMonitor),
  { ssr: false },
);
const ActionLogViewer = dynamic(
  () => import("../monitoring/ActionLogViewer").then((module) => module.ActionLogViewer),
  { ssr: false },
);
const ShortcutManagerDialog = dynamic(
  () => import("./ShortcutManagerDialog").then((module) => module.ShortcutManagerDialog),
  { ssr: false },
);
const ProxyChainMenu = dynamic(
  () => import("../network/ProxyChainMenu"),
  { ssr: false },
);
const InternalProxyManager = dynamic(
  () => import("../network/InternalProxyManager").then((module) => module.InternalProxyManager),
  { ssr: false },
);
const WOLQuickTool = dynamic(
  () => import("../network/WOLQuickTool").then((module) => module.WOLQuickTool),
  { ssr: false },
);
const BulkSSHCommander = dynamic(
  () => import("../ssh/BulkSSHCommander").then((module) => module.BulkSSHCommander),
  { ssr: false },
);
const ServerStatsPanel = dynamic(
  () => import("../ssh/ServerStatsPanel").then((module) => module.ServerStatsPanel),
  { ssr: false },
);
const OpksshPanel = dynamic(
  () => import("../ssh/OpksshPanel").then((module) => module.OpksshPanel),
  { ssr: false },
);
const McpServerPanel = dynamic(
  () => import("../ssh/McpServerPanel").then((module) => module.McpServerPanel),
  { ssr: false },
);
const ScriptManager = dynamic(
  () => import("../recording/ScriptManager").then((module) => module.ScriptManager),
  { ssr: false },
);
const MacroManager = dynamic(
  () => import("../recording/MacroManager"),
  { ssr: false },
);
const RecordingManager = dynamic(
  () => import("../recording/RecordingManager"),
  { ssr: false },
);
const ConnectionDiagnostics = dynamic(
  () => import("../connection/ConnectionDiagnostics").then((module) => module.ConnectionDiagnostics),
  { ssr: false },
);

interface AppDialogsProps {
  appSettings: GlobalSettings;
  showCollectionSelector: boolean;
  showConnectionEditor: boolean;
  showQuickConnect: boolean;
  showPasswordDialog: boolean;
  showSettings: boolean;
  showImportExport: boolean;
  showPerformanceMonitor: boolean;
  showActionLog: boolean;
  showShortcutManager: boolean;
  showProxyMenu: boolean;
  showInternalProxyManager: boolean;
  showWol: boolean;
  showBulkSSH: boolean;
  showServerStats: boolean;
  showOpkssh: boolean;
  showMcpServer: boolean;
  showScriptManager: boolean;
  showMacroManager: boolean;
  showRecordingManager: boolean;
  showDiagnostics: boolean;
  showErrorLog: boolean;
  rdpPanelOpen: boolean;
  setShowCollectionSelector: (v: boolean) => void;
  setShowConnectionEditor: (v: boolean) => void;
  setShowQuickConnect: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setShowImportExport: (v: boolean) => void;
  setShowPerformanceMonitor: (v: boolean) => void;
  setShowActionLog: (v: boolean) => void;
  setShowShortcutManager: (v: boolean) => void;
  setShowProxyMenu: (v: boolean) => void;
  setShowInternalProxyManager: (v: boolean) => void;
  setShowWol: (v: boolean) => void;
  setShowBulkSSH: (v: boolean) => void;
  setShowServerStats: (v: boolean) => void;
  setShowOpkssh: (v: boolean) => void;
  setShowMcpServer: (v: boolean) => void;
  setShowScriptManager: (v: boolean) => void;
  setShowMacroManager: (v: boolean) => void;
  setShowRecordingManager: (v: boolean) => void;
  setShowDiagnostics: (v: boolean) => void;
  setShowErrorLog: React.Dispatch<React.SetStateAction<boolean>>;
  setRdpPanelOpen: (v: boolean) => void;
  editingConnection: Connection | undefined;
  passwordDialogMode: "setup" | "unlock";
  passwordError: string;
  importExportInitialTab: "import" | "export";
  diagnosticsConnection: Connection | null;
  setDiagnosticsConnection: (c: Connection | null) => void;
  hasStoragePassword: boolean;
  dialogState: {
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
  };
  closeConfirmDialog: () => void;
  confirmDialog: React.ReactNode;
  handlePasswordSubmit: (password: string) => void;
  handlePasswordCancel: () => void;
  handleQuickConnectWithHistory: (...args: any[]) => void;
  clearQuickConnectHistory: () => void;
  handleCollectionSelect: (id: string) => Promise<void>;
  handleReattachRdpSession: (sessionId: string) => void;
  handleSessionDetach: (sessionId: string) => void;
  handleConnect?: (connection: Connection) => void;
  sessions: ConnectionSession[];
  connections: Connection[];
  activeRdpBackendIds: string[];
  settingsManager: SettingsManager;
  collectionManager: CollectionManager;
}

const getToolMode = (
  settings: GlobalSettings,
  key: Exclude<
    keyof import("../../types/settings/settings").ToolDisplayModes,
    "globalDefault"
  >,
): "popup" | "tab" => {
  const raw = settings.toolDisplayModes?.[key] ?? "inherit";
  if (raw === "inherit")
    return settings.toolDisplayModes?.globalDefault ?? "popup";
  return raw;
};

export const AppDialogs: React.FC<AppDialogsProps> = (props) => {
  const {
    appSettings,
    showCollectionSelector,
    showConnectionEditor,
    showQuickConnect,
    showPasswordDialog,
    showSettings,
    showImportExport,
    showPerformanceMonitor,
    showActionLog,
    showShortcutManager,
    showProxyMenu,
    showInternalProxyManager,
    showWol,
    showBulkSSH,
    showServerStats,
    showOpkssh,
    showMcpServer,
    showScriptManager,
    showMacroManager,
    showRecordingManager,
    showDiagnostics,
    showErrorLog,
    rdpPanelOpen,
    setShowCollectionSelector,
    setShowConnectionEditor,
    setShowQuickConnect,
    setShowSettings,
    setShowImportExport,
    setShowPerformanceMonitor,
    setShowActionLog,
    setShowShortcutManager,
    setShowProxyMenu,
    setShowInternalProxyManager,
    setShowWol,
    setShowBulkSSH,
    setShowServerStats,
    setShowOpkssh,
    setShowMcpServer,
    setShowScriptManager,
    setShowMacroManager,
    setShowRecordingManager,
    setShowDiagnostics,
    setShowErrorLog,
    setRdpPanelOpen,
    editingConnection,
    passwordDialogMode,
    passwordError,
    importExportInitialTab,
    diagnosticsConnection,
    setDiagnosticsConnection,
    hasStoragePassword,
    dialogState,
    closeConfirmDialog,
    confirmDialog,
    handlePasswordSubmit,
    handlePasswordCancel,
    handleQuickConnectWithHistory,
    clearQuickConnectHistory,
    handleCollectionSelect,
    handleReattachRdpSession,
    handleSessionDetach,
    handleConnect,
    sessions,
    connections,
    activeRdpBackendIds,
    settingsManager,
    collectionManager,
  } = props;

  return (
    <>
      {appSettings.autoLock.enabled && hasStoragePassword && (
        <AutoLockManager
          config={appSettings.autoLock}
          onConfigChange={(config) =>
            settingsManager
              .saveSettings({ autoLock: config }, { silent: true })
              .catch(console.error)
          }
          onLock={() => {
            settingsManager.logAction(
              "info",
              "Auto lock",
              undefined,
              "Session locked due to inactivity",
            );
          }}
        />
      )}

      <CollectionSelector
        isOpen={showCollectionSelector}
        onCollectionSelect={handleCollectionSelect}
        onClose={() => setShowCollectionSelector(false)}
      />

      <ConnectionEditor
        connection={editingConnection}
        isOpen={showConnectionEditor}
        onClose={() => setShowConnectionEditor(false)}
      />

      <QuickConnect
        isOpen={showQuickConnect}
        onClose={() => setShowQuickConnect(false)}
        historyEnabled={appSettings.quickConnectHistoryEnabled}
        history={appSettings.quickConnectHistory ?? []}
        onClearHistory={clearQuickConnectHistory}
        onConnect={handleQuickConnectWithHistory}
      />

      <PasswordDialog
        isOpen={showPasswordDialog}
        mode={passwordDialogMode}
        onSubmit={handlePasswordSubmit}
        onCancel={handlePasswordCancel}
        error={passwordError}
        noCollectionSelected={!collectionManager.getCurrentCollection()}
      />

      <ConfirmDialog
        isOpen={dialogState.isOpen}
        message={dialogState.message}
        onConfirm={() => {
          dialogState.onConfirm();
          closeConfirmDialog();
        }}
        onCancel={
          dialogState.onCancel
            ? () => {
                dialogState.onCancel!();
                closeConfirmDialog();
              }
            : closeConfirmDialog
        }
      />

      {confirmDialog}

      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      <ImportExport
        isOpen={showImportExport}
        onClose={() => setShowImportExport(false)}
        initialTab={importExportInitialTab}
      />

      {getToolMode(appSettings, "performanceMonitor") === "popup" && (
        <PerformanceMonitor
          isOpen={showPerformanceMonitor}
          onClose={() => setShowPerformanceMonitor(false)}
        />
      )}

      {getToolMode(appSettings, "actionLog") === "popup" && (
        <ActionLogViewer
          isOpen={showActionLog}
          onClose={() => setShowActionLog(false)}
        />
      )}

      {getToolMode(appSettings, "shortcutManager") === "popup" && (
        <ShortcutManagerDialog
          isOpen={showShortcutManager}
          onClose={() => setShowShortcutManager(false)}
        />
      )}

      {getToolMode(appSettings, "proxyChain") === "popup" && (
        <ProxyChainMenu
          isOpen={showProxyMenu}
          onClose={() => setShowProxyMenu(false)}
        />
      )}

      {getToolMode(appSettings, "internalProxy") === "popup" && (
        <InternalProxyManager
          isOpen={showInternalProxyManager}
          onClose={() => setShowInternalProxyManager(false)}
        />
      )}

      {getToolMode(appSettings, "wol") === "popup" && (
        <WOLQuickTool isOpen={showWol} onClose={() => setShowWol(false)} />
      )}

      {getToolMode(appSettings, "bulkSsh") === "popup" && (
        <BulkSSHCommander
          isOpen={showBulkSSH}
          onClose={() => setShowBulkSSH(false)}
        />
      )}

      {getToolMode(appSettings, "serverStats") === "popup" && (
        <ServerStatsPanel
          isOpen={showServerStats}
          onClose={() => setShowServerStats(false)}
        />
      )}

      {getToolMode(appSettings, "opkssh") === "popup" && (
        <OpksshPanel
          isOpen={showOpkssh}
          onClose={() => setShowOpkssh(false)}
        />
      )}

      {getToolMode(appSettings, "mcpServer") === "popup" && (
        <McpServerPanel
          isOpen={showMcpServer}
          onClose={() => setShowMcpServer(false)}
        />
      )}

      {getToolMode(appSettings, "scriptManager") === "popup" && (
        <ScriptManager
          isOpen={showScriptManager}
          onClose={() => setShowScriptManager(false)}
        />
      )}

      {getToolMode(appSettings, "macroManager") === "popup" && (
        <MacroManager
          isOpen={showMacroManager}
          onClose={() => setShowMacroManager(false)}
        />
      )}

      {getToolMode(appSettings, "recordingManager") === "popup" && (
        <RecordingManager
          isOpen={showRecordingManager}
          onClose={() => setShowRecordingManager(false)}
        />
      )}

      {showDiagnostics && diagnosticsConnection && (
        <ConnectionDiagnostics
          connection={diagnosticsConnection}
          onClose={() => {
            setShowDiagnostics(false);
            setDiagnosticsConnection(null);
          }}
        />
      )}

      <ErrorLogBar
        isVisible={showErrorLog || appSettings.showErrorLogBar}
        onToggle={() => setShowErrorLog(!showErrorLog)}
      />
    </>
  );
};
