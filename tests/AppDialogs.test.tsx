import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { AppDialogs } from "../src/components/app/AppDialogs";

vi.mock("../src/components/connection/CollectionSelector", () => ({
  CollectionSelector: () => <div data-testid="collection-selector" />,
}));
vi.mock("../src/components/connection/ConnectionEditor", () => ({
  ConnectionEditor: () => <div data-testid="connection-editor" />,
}));
vi.mock("../src/components/connection/QuickConnect", () => ({
  QuickConnect: () => <div data-testid="quick-connect" />,
}));
vi.mock("../src/components/security/PasswordDialog", () => ({
  PasswordDialog: () => <div data-testid="password-dialog" />,
}));
vi.mock("../src/components/shared/ConfirmDialog", () => ({
  ConfirmDialog: () => <div data-testid="confirm-dialog" />,
}));
vi.mock("../src/components/settingsDialog", () => ({
  SettingsDialog: () => <div data-testid="settings-dialog" />,
}));
vi.mock("../src/components/importExport", () => ({
  ImportExport: () => <div data-testid="import-export" />,
}));
vi.mock("../src/components/monitoring/PerformanceMonitor", () => ({
  PerformanceMonitor: () => <div data-testid="perf-monitor" />,
}));
vi.mock("../src/components/monitoring/ActionLogViewer", () => ({
  ActionLogViewer: () => <div data-testid="action-log" />,
}));
vi.mock("../src/components/app/ShortcutManagerDialog", () => ({
  ShortcutManagerDialog: () => <div data-testid="shortcut-manager" />,
}));
vi.mock("../src/components/network/ProxyChainMenu", () => ({
  ProxyChainMenu: () => <div data-testid="proxy-menu" />,
}));
vi.mock("../src/components/network/InternalProxyManager", () => ({
  InternalProxyManager: () => <div data-testid="internal-proxy" />,
}));
vi.mock("../src/components/network/WOLQuickTool", () => ({
  WOLQuickTool: () => <div data-testid="wol" />,
}));
vi.mock("../src/components/ssh/BulkSSHCommander", () => ({
  BulkSSHCommander: () => <div data-testid="bulk-ssh" />,
}));
vi.mock("../src/components/recording/ScriptManager", () => ({
  ScriptManager: () => <div data-testid="script-manager" />,
}));
vi.mock("../src/components/recording/MacroManager", () => ({
  MacroManager: () => <div data-testid="macro-manager" />,
}));
vi.mock("../src/components/recording/RecordingManager", () => ({
  RecordingManager: () => <div data-testid="recording-manager" />,
}));
vi.mock("../src/components/connection/ConnectionDiagnostics", () => ({
  ConnectionDiagnostics: () => <div data-testid="connection-diagnostics" />,
}));
vi.mock("../src/components/monitoring/ErrorLogBar", () => ({
  ErrorLogBar: () => <div data-testid="error-log" />,
}));
vi.mock("../src/components/security/AutoLockManager", () => ({
  AutoLockManager: () => <div data-testid="auto-lock" />,
}));
vi.mock("../src/components/rdp/RDPSessionPanel", () => ({
  RDPSessionPanel: ({ onClose }: { onClose: () => void }) => (
    <div>
      <span>rdp-session-panel</span>
      <button onClick={onClose}>close-rdp-panel</button>
    </div>
  ),
}));

describe("AppDialogs", () => {
  it("closes RDP session panel popup on backdrop click", () => {
    const setRdpPanelOpen = vi.fn();
    const collectionManager = {
      getCurrentCollection: vi.fn().mockReturnValue(null),
    };

    render(
      <AppDialogs
        appSettings={
          {
            rdpSessionDisplayMode: "popup",
            rdpSessionThumbnailsEnabled: true,
            rdpSessionThumbnailPolicy: "always",
            rdpSessionThumbnailInterval: 5000,
            toolDisplayModes: { globalDefault: "tab" },
            showErrorLogBar: false,
            autoLock: {
              enabled: false,
              timeoutMinutes: 10,
              lockOnIdle: true,
              lockOnSuspend: true,
              requirePassword: true,
            },
          } as any
        }
        showCollectionSelector={false}
        showConnectionEditor={false}
        showQuickConnect={false}
        showPasswordDialog={false}
        showSettings={false}
        showImportExport={false}
        showPerformanceMonitor={false}
        showActionLog={false}
        showShortcutManager={false}
        showProxyMenu={false}
        showInternalProxyManager={false}
        showWol={false}
        showBulkSSH={false}
        showScriptManager={false}
        showMacroManager={false}
        showRecordingManager={false}
        showDiagnostics={false}
        showErrorLog={false}
        rdpPanelOpen={true}
        setShowCollectionSelector={() => {}}
        setShowConnectionEditor={() => {}}
        setShowQuickConnect={() => {}}
        setShowSettings={() => {}}
        setShowImportExport={() => {}}
        setShowPerformanceMonitor={() => {}}
        setShowActionLog={() => {}}
        setShowShortcutManager={() => {}}
        setShowProxyMenu={() => {}}
        setShowInternalProxyManager={() => {}}
        setShowWol={() => {}}
        setShowBulkSSH={() => {}}
        setShowScriptManager={() => {}}
        setShowMacroManager={() => {}}
        setShowRecordingManager={() => {}}
        setShowDiagnostics={() => {}}
        setShowErrorLog={() => {}}
        setRdpPanelOpen={setRdpPanelOpen}
        editingConnection={undefined}
        passwordDialogMode="unlock"
        passwordError=""
        importExportInitialTab="import"
        diagnosticsConnection={null}
        setDiagnosticsConnection={() => {}}
        hasStoragePassword={true}
        dialogState={{ isOpen: false, message: "", onConfirm: () => {} }}
        closeConfirmDialog={() => {}}
        confirmDialog={<div />}
        handlePasswordSubmit={() => {}}
        handlePasswordCancel={() => {}}
        handleQuickConnectWithHistory={() => {}}
        clearQuickConnectHistory={() => {}}
        handleCollectionSelect={async () => {}}
        handleReattachRdpSession={() => {}}
        handleSessionDetach={() => {}}
        sessions={[]}
        connections={[]}
        activeRdpBackendIds={[]}
        settingsManager={{} as any}
        collectionManager={collectionManager as any}
      />,
    );

    expect(screen.getByText("rdp-session-panel")).toBeInTheDocument();

    const backdrop = screen.getByTestId("rdp-session-panel-modal");
    fireEvent.click(backdrop);

    expect(setRdpPanelOpen).toHaveBeenCalledWith(false);
  });
});
