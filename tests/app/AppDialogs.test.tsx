import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppDialogs } from "../../src/components/app/AppDialogs";

// CollectionSelector was migrated to a tool-panel tab (DatabasePanel)
// and is no longer imported here, so it doesn't need a mock.
vi.mock("../../src/components/connection/ConnectionEditor", () => ({
  ConnectionEditor: () => <div data-testid="connection-editor" />,
}));
vi.mock("../../src/components/connection/QuickConnect", () => ({
  QuickConnect: ({ isOpen, onClose }: any) =>
    isOpen ? <div data-testid="quick-connect"><button onClick={onClose}>close-qc</button></div> : null,
}));
vi.mock("../../src/components/security/PasswordDialog", () => ({
  __esModule: true,
  default: ({ isOpen }: any) =>
    isOpen ? <div data-testid="password-dialog" /> : null,
}));
vi.mock("../../src/components/ui/dialogs/ConfirmDialog", () => ({
  ConfirmDialog: ({ isOpen }: any) =>
    isOpen ? <div data-testid="confirm-dialog" /> : null,
}));
vi.mock("../../src/components/SettingsDialog", () => ({
  SettingsDialog: ({ isOpen, onClose }: any) =>
    isOpen ? <div data-testid="settings-dialog"><button onClick={onClose}>close-settings</button></div> : null,
}));
vi.mock("../../src/components/connection/ConnectionDiagnostics", () => ({
  ConnectionDiagnostics: ({ onClose }: any) =>
    <div data-testid="connection-diagnostics"><button onClick={onClose}>close-diag</button></div>,
}));
vi.mock("../../src/components/app/ErrorLogBar", () => ({
  ErrorLogBar: () => <div data-testid="error-log" />,
}));
vi.mock("../../src/components/security/AutoLockManager", () => ({
  AutoLockManager: () => <div data-testid="auto-lock" />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

const defaultAppSettings = {
  showErrorLogBar: false,
  autoLock: {
    enabled: false,
    timeoutMinutes: 10,
    lockOnIdle: true,
    lockOnSuspend: true,
    requirePassword: true,
  },
  quickConnectHistoryEnabled: true,
  quickConnectHistory: [],
};

function makeProps(overrides: Record<string, any> = {}) {
  return {
    appSettings: defaultAppSettings as any,
    showDatabasePanel: false,
    showQuickConnect: false,
    showPasswordDialog: false,
    showSettings: false,
    showDiagnostics: false,
    showErrorLog: false,
    setShowDatabasePanel: vi.fn(),
    setShowQuickConnect: vi.fn(),
    setShowSettings: vi.fn(),
    setShowDiagnostics: vi.fn(),
    setShowErrorLog: vi.fn(),
    passwordDialogMode: "unlock" as const,
    passwordError: "",
    diagnosticsConnection: null,
    setDiagnosticsConnection: vi.fn(),
    hasStoragePassword: false,
    dialogState: { isOpen: false, message: "", onConfirm: vi.fn() },
    closeConfirmDialog: vi.fn(),
    confirmDialog: <div />,
    handlePasswordSubmit: vi.fn(),
    handlePasswordCancel: vi.fn(),
    handleQuickConnectWithHistory: vi.fn(),
    clearQuickConnectHistory: vi.fn(),
    handleDatabaseSelect: vi.fn(),
    settingsManager: { saveSettings: vi.fn(), logAction: vi.fn() } as any,
    databaseManager: { getCurrentDatabase: vi.fn().mockReturnValue(null) } as any,
    ...overrides,
  };
}

describe("AppDialogs", () => {
  it("renders core dialogs without tool popups", () => {
    const databaseManager = {
      getCurrentDatabase: vi.fn().mockReturnValue(null),
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
        showDatabasePanel={false}
        showQuickConnect={false}
        showPasswordDialog={false}
        showSettings={false}
        showDiagnostics={false}
        showErrorLog={false}
        setShowDatabasePanel={() => {}}
        setShowQuickConnect={() => {}}
        setShowSettings={() => {}}
        setShowDiagnostics={() => {}}
        setShowErrorLog={() => {}}
        passwordDialogMode="unlock"
        passwordError=""
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
        handleDatabaseSelect={async () => {}}
        settingsManager={{} as any}
        databaseManager={databaseManager as any}
      />,
    );

    // Core dialogs render, no tool popup components
    expect(screen.getByTestId("error-log")).toBeInTheDocument();
  });

  // CollectionSelector was migrated to a tool-panel tab (DatabasePanel)
  // and is no longer mounted from AppDialogs. The legacy flag has no
  // visual effect here anymore — AppDialogs should render nothing for it.
  it("does not mount the legacy CollectionSelector modal", () => {
    render(<AppDialogs {...makeProps({ showDatabasePanel: true })} />);
    expect(screen.queryByTestId("collection-selector")).not.toBeInTheDocument();
  });

  it("shows SettingsDialog when showSettings is true", () => {
    render(<AppDialogs {...makeProps({ showSettings: true })} />);
    expect(screen.getByTestId("settings-dialog")).toBeInTheDocument();
  });

  it("shows ConnectionDiagnostics when showDiagnostics and diagnosticsConnection exist", async () => {
    const conn = { id: "c1", name: "Test", protocol: "ssh", hostname: "h", port: 22 } as any;
    render(<AppDialogs {...makeProps({ showDiagnostics: true, diagnosticsConnection: conn })} />);
    expect(await screen.findByTestId("connection-diagnostics")).toBeInTheDocument();
  });

  it("does not show ConnectionDiagnostics without diagnosticsConnection", () => {
    render(<AppDialogs {...makeProps({ showDiagnostics: true, diagnosticsConnection: null })} />);
    expect(screen.queryByTestId("connection-diagnostics")).not.toBeInTheDocument();
  });

  it("shows AutoLockManager when autoLock.enabled and hasStoragePassword", async () => {
    const settings = {
      ...defaultAppSettings,
      autoLock: { ...defaultAppSettings.autoLock, enabled: true },
    };
    render(<AppDialogs {...makeProps({ appSettings: settings, hasStoragePassword: true })} />);
    expect(await screen.findByTestId("auto-lock")).toBeInTheDocument();
  });

  it("does not show AutoLockManager when autoLock is disabled", () => {
    render(<AppDialogs {...makeProps()} />);
    expect(screen.queryByTestId("auto-lock")).not.toBeInTheDocument();
  });

  it("calls setShowSettings(false) when closing SettingsDialog", () => {
    const setShowSettings = vi.fn();
    render(<AppDialogs {...makeProps({ showSettings: true, setShowSettings })} />);
    fireEvent.click(screen.getByText("close-settings"));
    expect(setShowSettings).toHaveBeenCalledWith(false);
  });
});
