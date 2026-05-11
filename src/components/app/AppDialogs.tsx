import React from "react";
import dynamic from "next/dynamic";
import { Connection } from "../../types/connection/connection";
import { GlobalSettings } from "../../types/settings/settings";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
import { ErrorLogBar } from "./ErrorLogBar";
import { FeatureErrorBoundary } from "./FeatureErrorBoundary";

const AutoLockManager = dynamic(
  () => import("../security/AutoLockManager").then((module) => module.AutoLockManager),
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
  () => import("../SettingsDialog").then((module) => module.SettingsDialog),
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
  showDiagnostics: boolean;
  showErrorLog: boolean;
  setShowCollectionSelector: (v: boolean) => void;
  setShowQuickConnect: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setShowDiagnostics: (v: boolean) => void;
  setShowErrorLog: React.Dispatch<React.SetStateAction<boolean>>;
  passwordDialogMode: "setup" | "unlock";
  passwordError: string;
  collectionSelectorInitialTab?: "collections";
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
  collectionManager: DatabaseManager;
}

export const AppDialogs: React.FC<AppDialogsProps> = (props) => {
  const {
    appSettings,
    showCollectionSelector,
    showQuickConnect,
    showPasswordDialog,
    showSettings,
    showDiagnostics,
    showErrorLog,
    setShowCollectionSelector,
    setShowQuickConnect,
    setShowSettings,
    setShowDiagnostics,
    setShowErrorLog,
    passwordDialogMode,
    passwordError,
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

      {/* The legacy modal Collection Selector has been replaced by the
          tool-tab DatabasePanel; it now mounts inside the ToolPanel via
          the 'database' tool key. */}

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
