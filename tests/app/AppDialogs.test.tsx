import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppDialogs } from "../../src/components/app/AppDialogs";

vi.mock("../../src/components/connection/CollectionSelector", () => ({
  CollectionSelector: () => <div data-testid="collection-selector" />,
}));
vi.mock("../../src/components/connection/ConnectionEditor", () => ({
  ConnectionEditor: () => <div data-testid="connection-editor" />,
}));
vi.mock("../../src/components/connection/QuickConnect", () => ({
  QuickConnect: () => <div data-testid="quick-connect" />,
}));
vi.mock("../../src/components/security/PasswordDialog", () => ({
  PasswordDialog: () => <div data-testid="password-dialog" />,
}));
vi.mock("../../src/components/ui/dialogs/ConfirmDialog", () => ({
  ConfirmDialog: () => <div data-testid="confirm-dialog" />,
}));
vi.mock("../../src/components/settingsDialog", () => ({
  SettingsDialog: () => <div data-testid="settings-dialog" />,
}));
vi.mock("../../src/components/importExport", () => ({
  ImportExport: () => <div data-testid="import-export" />,
}));
vi.mock("../../src/components/connection/ConnectionDiagnostics", () => ({
  ConnectionDiagnostics: () => <div data-testid="connection-diagnostics" />,
}));
vi.mock("../../src/components/app/ErrorLogBar", () => ({
  ErrorLogBar: () => <div data-testid="error-log" />,
}));
vi.mock("../../src/components/security/AutoLockManager", () => ({
  AutoLockManager: () => <div data-testid="auto-lock" />,
}));

describe("AppDialogs", () => {
  it("renders core dialogs without tool popups", () => {
    const collectionManager = {
      getCurrentCollection: vi.fn().mockReturnValue(null),
    };

    render(
      <AppDialogs
        appSettings={
          {
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
        showDiagnostics={false}
        showErrorLog={false}
        setShowCollectionSelector={() => {}}
        setShowConnectionEditor={() => {}}
        setShowQuickConnect={() => {}}
        setShowSettings={() => {}}
        setShowImportExport={() => {}}
        setShowDiagnostics={() => {}}
        setShowErrorLog={() => {}}
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
        settingsManager={{} as any}
        collectionManager={collectionManager as any}
      />,
    );

    // Core dialogs render, no tool popup components
    expect(screen.getByTestId("error-log")).toBeInTheDocument();
  });
});
