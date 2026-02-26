import React from "react";
import { Connection, ConnectionSession } from "../types/connection";
import { GlobalSettings } from "../types/settings";
import { SettingsManager } from "../utils/settingsManager";
import { CollectionManager } from "../utils/collectionManager";
import { CollectionSelector } from "./CollectionSelector";
import { ConnectionEditor } from "./ConnectionEditor";
import { QuickConnect } from "./QuickConnect";
import { PasswordDialog } from "./PasswordDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsDialog } from "./SettingsDialog";
import { ImportExport } from "./ImportExport";
import { PerformanceMonitor } from "./PerformanceMonitor";
import { ActionLogViewer } from "./ActionLogViewer";
import { ShortcutManagerDialog } from "./ShortcutManagerDialog";
import { ProxyChainMenu } from "./ProxyChainMenu";
import { InternalProxyManager } from "./InternalProxyManager";
import { RdpSessionPanel } from "./RdpSessionPanel";
import { WOLQuickTool } from "./WOLQuickTool";
import { BulkSSHCommander } from "./BulkSSHCommander";
import { ScriptManager } from "./ScriptManager";
import { ConnectionDiagnostics } from "./ConnectionDiagnostics";
import { ErrorLogBar } from "./ErrorLogBar";
import { AutoLockManager } from "./AutoLockManager";

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

      <PerformanceMonitor
        isOpen={showPerformanceMonitor}
        onClose={() => setShowPerformanceMonitor(false)}
      />

      <ActionLogViewer
        isOpen={showActionLog}
        onClose={() => setShowActionLog(false)}
      />

      <ShortcutManagerDialog
        isOpen={showShortcutManager}
        onClose={() => setShowShortcutManager(false)}
      />

      <ProxyChainMenu
        isOpen={showProxyMenu}
        onClose={() => setShowProxyMenu(false)}
      />

      <InternalProxyManager
        isOpen={showInternalProxyManager}
        onClose={() => setShowInternalProxyManager(false)}
      />

      {rdpPanelOpen && appSettings.rdpSessionDisplayMode === 'popup' && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setRdpPanelOpen(false); }}
        >
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl h-[90vh] flex flex-col overflow-hidden">
            <RdpSessionPanel
              isVisible={rdpPanelOpen}
              connections={connections}
              activeBackendSessionIds={activeRdpBackendIds}
              onClose={() => setRdpPanelOpen(false)}
              onReattachSession={handleReattachRdpSession}
              onDetachToWindow={(sessionId) => {
                const frontendSession = sessions.find(
                  s => s.backendSessionId === sessionId || s.id === sessionId
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
        </div>
      )}

      <WOLQuickTool isOpen={showWol} onClose={() => setShowWol(false)} />

      <BulkSSHCommander
        isOpen={showBulkSSH}
        onClose={() => setShowBulkSSH(false)}
      />

      <ScriptManager
        isOpen={showScriptManager}
        onClose={() => setShowScriptManager(false)}
      />

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
