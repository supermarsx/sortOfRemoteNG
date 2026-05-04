import React from "react";
import dynamic from "next/dynamic";
import { Connection } from "../../types/connection/connection";
import { GlobalSettings } from "../../types/settings/settings";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { CollectionManager } from "../../utils/connection/collectionManager";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
import { ErrorLogBar } from "./ErrorLogBar";
import { FeatureErrorBoundary } from "./FeatureErrorBoundary";

const AutoLockManager = dynamic(
  () => import("../security/AutoLockManager").then((module) => module.AutoLockManager),
  { ssr: false },
);
const CollectionSelector = dynamic(
  () => import("../connection/CollectionSelector").then((module) => module.CollectionSelector),
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
const ConnectionDiagnostics = dynamic(
  () => import("../connection/ConnectionDiagnostics").then((module) => module.ConnectionDiagnostics),
  { ssr: false },
);
const RDPCertTrustPrompt = dynamic(
  () => import("../rdp/RDPCertTrustPrompt").then((module) => module.RDPCertTrustPrompt),
  { ssr: false },
);

interface AppDialogsProps {
  appSettings: GlobalSettings;
  showCollectionSelector: boolean;
  showQuickConnect: boolean;
  showPasswordDialog: boolean;
  showSettings: boolean;
  showImportExport: boolean;
  showDiagnostics: boolean;
  showErrorLog: boolean;
  setShowCollectionSelector: (v: boolean) => void;
  setShowQuickConnect: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setShowImportExport: (v: boolean) => void;
  setShowDiagnostics: (v: boolean) => void;
  setShowErrorLog: React.Dispatch<React.SetStateAction<boolean>>;
  passwordDialogMode: "setup" | "unlock";
  passwordError: string;
  importExportInitialTab: "import" | "export";
  collectionSelectorInitialTab?: "collections" | "connections" | "proxies";
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
  handleConnect?: (connection: Connection) => void;
  settingsManager: SettingsManager;
  collectionManager: CollectionManager;
}

export const AppDialogs: React.FC<AppDialogsProps> = (props) => {
  const {
    appSettings,
    showCollectionSelector,
    showQuickConnect,
    showPasswordDialog,
    showSettings,
    showImportExport,
    showDiagnostics,
    showErrorLog,
    setShowCollectionSelector,
    setShowQuickConnect,
    setShowSettings,
    setShowImportExport,
    setShowDiagnostics,
    setShowErrorLog,
    passwordDialogMode,
    passwordError,
    importExportInitialTab,
    collectionSelectorInitialTab,
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
    handleConnect,
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
        initialTab={collectionSelectorInitialTab}
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

      <FeatureErrorBoundary
        boundaryKey="settings-dialog"
        title="Settings crashed"
        message="The settings dialog hit a render error. You can retry without restarting the app."
      >
        <SettingsDialog
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
        />
      </FeatureErrorBoundary>

      <ImportExport
        isOpen={showImportExport}
        onClose={() => setShowImportExport(false)}
        initialTab={importExportInitialTab}
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

      <RDPCertTrustPrompt />
    </>
  );
};
