import React from "react";
import dynamic from "next/dynamic";
import { useTranslation } from "react-i18next";
import { Connection } from "../../types/connection/connection";
import { GlobalSettings } from "../../types/settings/settings";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
import { FeatureErrorBoundary } from "./FeatureErrorBoundary";
import { ProtocolRepairNotice } from "../connection/ProtocolRepairDialog";
import type { SettingsTabId } from "../SettingsDialog/settingsConstants";

const QuickConnect = dynamic(
  () =>
    import("../connection/QuickConnect").then((module) => module.QuickConnect),
  { ssr: false },
);
const SettingsDialog = dynamic(
  () => import("../SettingsDialog").then((module) => module.SettingsDialog),
  { ssr: false },
);
const ConnectionDiagnostics = dynamic(
  () =>
    import("../connection/ConnectionDiagnostics").then(
      (module) => module.ConnectionDiagnostics,
    ),
  { ssr: false },
);
const RDPCertTrustPrompt = dynamic(
  () =>
    import("../rdp/RDPCertTrustPrompt").then(
      (module) => module.RDPCertTrustPrompt,
    ),
  { ssr: false },
);

interface AppDialogsProps {
  appSettings: GlobalSettings;
  showDatabasePanel: boolean;
  showQuickConnect: boolean;
  showSettings: boolean;
  showDiagnostics: boolean;
  setShowDatabasePanel: (v: boolean) => void;
  setShowQuickConnect: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  /** Settings tab the last "open settings" affordance asked for. */
  settingsInitialTab?: SettingsTabId;
  /** Bump to re-apply an unchanged `settingsInitialTab`. */
  settingsInitialTabNonce?: number;
  setShowDiagnostics: (v: boolean) => void;
  databasePanelInitialTab?: "collections";
  diagnosticsConnection: Connection | null;
  setDiagnosticsConnection: (c: Connection | null) => void;
  dialogState: {
    isOpen: boolean;
    message: string;
    title?: string;
    confirmText?: string;
    cancelText?: string;
    variant?: "default" | "danger" | "warning";
    onConfirm: () => void;
    onCancel?: () => void;
    secondaryAction?: {
      label: string;
      onClick: () => void;
      variant?: "default" | "warning";
    };
  };
  closeConfirmDialog: () => void;
  confirmDialog: React.ReactNode;
  handleQuickConnectWithHistory: (...args: any[]) => void;
  clearQuickConnectHistory: () => void;
  handleDatabaseSelect: (id: string, password?: string) => Promise<void>;
  onBeforeCurrentLock?: () => Promise<void>;
  /**
   * Inverse of `handleDatabaseSelect` — closes the currently-open
   * database and clears the connection panel + auto-open pointer.
   * Threaded through here for symmetry; the picker that consumes it
   * lives in the ToolPanel tab, not in this dialog tree, but keeping
   * both in sync at the App boundary keeps the API tidy.
   */
  handleDatabaseClose?: () => Promise<void>;
  handleConnect?: (connection: Connection) => void;
  settingsManager: SettingsManager;
  databaseManager: DatabaseManager;
}

export const AppDialogs: React.FC<AppDialogsProps> = (props) => {
  const { t } = useTranslation();
  const {
    appSettings,
    showDatabasePanel,
    showQuickConnect,
    showSettings,
    showDiagnostics,
    setShowDatabasePanel,
    setShowQuickConnect,
    setShowSettings,
    settingsInitialTab,
    settingsInitialTabNonce,
    setShowDiagnostics,
    databasePanelInitialTab,
    diagnosticsConnection,
    setDiagnosticsConnection,
    dialogState,
    closeConfirmDialog,
    confirmDialog,
    handleQuickConnectWithHistory,
    clearQuickConnectHistory,
    handleDatabaseSelect,
    handleConnect,
    settingsManager,
    databaseManager,
  } = props;

  return (
    <>
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

      <ConfirmDialog
        isOpen={dialogState.isOpen}
        message={dialogState.message}
        title={dialogState.title}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        variant={dialogState.variant}
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
        secondaryAction={
          dialogState.secondaryAction
            ? {
                label: dialogState.secondaryAction.label,
                onClick: () => {
                  dialogState.secondaryAction!.onClick();
                  closeConfirmDialog();
                },
                variant: dialogState.secondaryAction.variant,
              }
            : undefined
        }
      />

      {confirmDialog}

      <FeatureErrorBoundary
        boundaryKey="settings-dialog"
        title={t("errorBoundary.settingsCrashed", "Settings crashed")}
        message={t(
          "errorBoundary.settingsCrashedDescription",
          "The settings dialog hit a render error. You can retry without restarting the app.",
        )}
      >
        <SettingsDialog
          onDatabaseSelect={handleDatabaseSelect}
          onDatabaseClose={props.handleDatabaseClose}
          onBeforeCurrentLock={props.onBeforeCurrentLock}
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          initialTab={settingsInitialTab}
          initialTabNonce={settingsInitialTabNonce}
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

      <RDPCertTrustPrompt />

      <ProtocolRepairNotice
        databaseId={databaseManager.getCurrentDatabase()?.id ?? null}
      />
    </>
  );
};
