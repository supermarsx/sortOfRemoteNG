import React from "react";
import { Connection, ConnectionSession } from "../../types/connection";
import { GlobalSettings } from "../../types/settings";
import { SettingsManager } from "../../utils/settingsManager";
import { CollectionManager } from "../../utils/collectionManager";
import { CollectionSelector } from "../connection/CollectionSelector";
import { ConnectionEditor } from "../connection/ConnectionEditor";
import { QuickConnect } from "../connection/QuickConnect";
import { PasswordDialog } from "../security/PasswordDialog";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { SettingsDialog } from "../SettingsDialog";
import { ImportExport } from "../ImportExport";
import { PerformanceMonitor } from "../monitoring/PerformanceMonitor";
import { ActionLogViewer } from "../monitoring/ActionLogViewer";
import { ShortcutManagerDialog } from "./ShortcutManagerDialog";
import { ProxyChainMenu } from "../network/ProxyChainMenu";
import { InternalProxyManager } from "../network/InternalProxyManager";
import { RDPSessionPanel } from "../rdp/RDPSessionPanel";
import { WOLQuickTool } from "../network/WOLQuickTool";
import { BulkSSHCommander } from "../ssh/BulkSSHCommander";
import { ScriptManager } from "../recording/ScriptManager";
import { MacroManager } from "../recording/MacroManager";
import { RecordingManager } from "../recording/RecordingManager";
import { ConnectionDiagnostics } from "../connection/ConnectionDiagnostics";
import { ErrorLogBar } from "../monitoring/ErrorLogBar";
import { AutoLockManager } from "../security/AutoLockManager";
import { Modal } from "../ui/overlays/Modal";

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
  sessions: ConnectionSession[];
  connections: Connection[];
  activeRdpBackendIds: string[];
  settingsManager: SettingsManager;
  collectionManager: CollectionManager;
}

const getToolMode = (
  settings: GlobalSettings,
  key: Exclude<
    keyof import("../../types/settings").ToolDisplayModes,
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

      {rdpPanelOpen && appSettings.rdpSessionDisplayMode === "popup" && (
        <Modal
          isOpen={rdpPanelOpen}
          onClose={() => setRdpPanelOpen(false)}
          closeOnEscape={false}
          backdropClassName="bg-black/60 backdrop-blur-sm p-4"
          panelClassName="max-w-3xl mx-4 h-[90vh]"
          contentClassName="overflow-hidden"
          dataTestId="rdp-session-panel-modal"
        >
          <div className="bg-[var(--color-background)] border border-[var(--color-border)] rounded-xl shadow-2xl w-full h-[90vh] flex flex-col overflow-hidden">
            <RDPSessionPanel
              isVisible={rdpPanelOpen}
              connections={connections}
              activeBackendSessionIds={activeRdpBackendIds}
              onClose={() => setRdpPanelOpen(false)}
              onReattachSession={handleReattachRdpSession}
              onDetachToWindow={(sessionId) => {
                const frontendSession = sessions.find(
                  (s) => s.backendSessionId === sessionId || s.id === sessionId,
                );
                if (frontendSession) {
                  handleSessionDetach(frontendSession.id);
                }
              }}
              thumbnailsEnabled={appSettings.rdpSessionThumbnailsEnabled}
              thumbnailPolicy={appSettings.rdpSessionThumbnailPolicy}
              thumbnailInterval={appSettings.rdpSessionThumbnailInterval}
            />
          </div>
        </Modal>
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
