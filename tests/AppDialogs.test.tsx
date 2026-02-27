import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { AppDialogs } from "../src/components/AppDialogs";

vi.mock("../src/components/CollectionSelector", () => ({
  CollectionSelector: () => <div data-testid="collection-selector" />,
}));
vi.mock("../src/components/ConnectionEditor", () => ({
  ConnectionEditor: () => <div data-testid="connection-editor" />,
}));
vi.mock("../src/components/QuickConnect", () => ({
  QuickConnect: () => <div data-testid="quick-connect" />,
}));
vi.mock("../src/components/PasswordDialog", () => ({
  PasswordDialog: () => <div data-testid="password-dialog" />,
}));
vi.mock("../src/components/ConfirmDialog", () => ({
  ConfirmDialog: () => <div data-testid="confirm-dialog" />,
}));
vi.mock("../src/components/SettingsDialog", () => ({
  SettingsDialog: () => <div data-testid="settings-dialog" />,
}));
vi.mock("../src/components/ImportExport", () => ({
  ImportExport: () => <div data-testid="import-export" />,
}));
vi.mock("../src/components/PerformanceMonitor", () => ({
  PerformanceMonitor: () => <div data-testid="perf-monitor" />,
}));
vi.mock("../src/components/ActionLogViewer", () => ({
  ActionLogViewer: () => <div data-testid="action-log" />,
}));
vi.mock("../src/components/ShortcutManagerDialog", () => ({
  ShortcutManagerDialog: () => <div data-testid="shortcut-manager" />,
}));
vi.mock("../src/components/ProxyChainMenu", () => ({
  ProxyChainMenu: () => <div data-testid="proxy-menu" />,
}));
vi.mock("../src/components/InternalProxyManager", () => ({
  InternalProxyManager: () => <div data-testid="internal-proxy" />,
}));
vi.mock("../src/components/WOLQuickTool", () => ({
  WOLQuickTool: () => <div data-testid="wol" />,
}));
vi.mock("../src/components/BulkSSHCommander", () => ({
  BulkSSHCommander: () => <div data-testid="bulk-ssh" />,
}));
vi.mock("../src/components/ScriptManager", () => ({
  ScriptManager: () => <div data-testid="script-manager" />,
}));
vi.mock("../src/components/MacroManager", () => ({
  MacroManager: () => <div data-testid="macro-manager" />,
}));
vi.mock("../src/components/RecordingManager", () => ({
  RecordingManager: () => <div data-testid="recording-manager" />,
}));
vi.mock("../src/components/ConnectionDiagnostics", () => ({
  ConnectionDiagnostics: () => <div data-testid="connection-diagnostics" />,
}));
vi.mock("../src/components/ErrorLogBar", () => ({
  ErrorLogBar: () => <div data-testid="error-log" />,
}));
vi.mock("../src/components/AutoLockManager", () => ({
  AutoLockManager: () => <div data-testid="auto-lock" />,
}));
vi.mock("../src/components/RdpSessionPanel", () => ({
  RdpSessionPanel: ({ onClose }: { onClose: () => void }) => (
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
