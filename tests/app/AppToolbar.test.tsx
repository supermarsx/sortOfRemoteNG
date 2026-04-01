import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppToolbar } from "../../src/components/app/AppToolbar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, defaultValue?: string) => defaultValue ?? key }),
}));

vi.mock("../../src/components/sync/BackupStatusPopup", () => ({
  BackupStatusPopup: () => <div data-testid="backup-status" />,
}));

vi.mock("../../src/components/sync/CloudSyncStatusPopup", () => ({
  CloudSyncStatusPopup: () => <div data-testid="cloud-sync-status" />,
}));

vi.mock("../../src/components/sync/SyncBackupStatusBar", () => ({
  SyncBackupStatusBar: () => <div data-testid="sync-backup-status" />,
}));

const makeProps = (overrides: Record<string, unknown> = {}) => ({
  appSettings: {
    showTransparencyToggle: false,
    showQuickConnectIcon: true,
    showCollectionSwitcherIcon: true,
    showSettingsIcon: true,
    showRdpSessionsIcon: true,
    showInternalProxyIcon: false,
    showProxyMenuIcon: false,
    showShortcutManagerIcon: false,
    showWolIcon: false,
    showBulkSSHIcon: false,
    showServerStatsIcon: false,
    showOpksshIcon: false,
    showMcpServerIcon: false,
    showScriptManagerIcon: false,
    showMacroManagerIcon: false,
    showRecordingManagerIcon: false,
    showPerformanceMonitorIcon: false,
    showActionLogIcon: false,
    showErrorLogBar: false,
    showDevtoolsIcon: false,
    showDebugPanelIcon: false,
    showSecurityIcon: false,
    showBackupStatusIcon: false,
    showCloudSyncStatusIcon: false,
    showSyncBackupStatusIcon: false,
    windowTransparencyEnabled: false,
  } as any,
  isAlwaysOnTop: false,
  rdpPanelOpen: false,
  showErrorLog: false,
  collectionManager: {} as any,
  connections: [],
  setShowQuickConnect: vi.fn(),
  setShowCollectionSelector: vi.fn(),
  setShowSettings: vi.fn(),
  setRdpPanelOpen: vi.fn(),
  setShowInternalProxyManager: vi.fn(),
  setShowProxyMenu: vi.fn(),
  setShowShortcutManager: vi.fn(),
  setShowWol: vi.fn(),
  setShowBulkSSH: vi.fn(),
  setShowServerStats: vi.fn(),
  setShowOpkssh: vi.fn(),
  setShowMcpServer: vi.fn(),
  setShowScriptManager: vi.fn(),
  setShowMacroManager: vi.fn(),
  setShowRecordingManager: vi.fn(),
  setShowPerformanceMonitor: vi.fn(),
  setShowActionLog: vi.fn(),
  setShowErrorLog: vi.fn(),
  handleToggleTransparency: vi.fn(),
  handleToggleAlwaysOnTop: vi.fn(),
  handleRepatriateWindow: vi.fn(),
  handleMinimize: vi.fn(),
  handleMaximize: vi.fn(),
  handleClose: vi.fn(),
  handleOpenDevtools: vi.fn(),
  handleShowPasswordDialog: vi.fn(),
  performCloudSync: vi.fn(),
  setShowDebugPanel: vi.fn(),
  setShowTagManager: vi.fn(),
  setShowTabGroupManager: vi.fn(),
  ...overrides,
});

describe("AppToolbar", () => {
  it("renders without crashing", () => {
    const { container } = render(<AppToolbar {...(makeProps() as any)} />);
    expect(container.querySelector(".app-bar")).toBeTruthy();
  });

  it("shows the settings button when showSettingsIcon is true and clicking it calls setShowSettings", () => {
    const props = makeProps();
    render(<AppToolbar {...(props as any)} />);
    const settingsBtn = screen.getByTitle("Settings");
    expect(settingsBtn).toBeTruthy();
    fireEvent.click(settingsBtn);
    expect(props.setShowSettings).toHaveBeenCalledWith(true);
  });

  it("calls handleMinimize when minimize button is clicked", () => {
    const props = makeProps();
    render(<AppToolbar {...(props as any)} />);
    const btn = screen.getByTitle("Minimize");
    fireEvent.click(btn);
    expect(props.handleMinimize).toHaveBeenCalledTimes(1);
  });

  it("calls handleMaximize when maximize button is clicked", () => {
    const props = makeProps();
    render(<AppToolbar {...(props as any)} />);
    const btn = screen.getByTitle("Maximize");
    fireEvent.click(btn);
    expect(props.handleMaximize).toHaveBeenCalledTimes(1);
  });

  it("calls handleClose when close button is clicked", () => {
    const props = makeProps();
    render(<AppToolbar {...(props as any)} />);
    const btn = screen.getByTitle("Close");
    fireEvent.click(btn);
    expect(props.handleClose).toHaveBeenCalledTimes(1);
  });

  it("shows pinned state when isAlwaysOnTop is true", () => {
    const props = makeProps({ isAlwaysOnTop: true });
    render(<AppToolbar {...(props as any)} />);
    const pinBtn = screen.getByTitle("Unpin window");
    expect(pinBtn).toBeTruthy();
    // The Pin icon should have the rotate-45 class when pinned
    const svg = pinBtn.querySelector("svg");
    expect(svg?.classList.contains("rotate-45")).toBe(true);
  });

  it("shows unpinned state when isAlwaysOnTop is false", () => {
    const props = makeProps({ isAlwaysOnTop: false });
    render(<AppToolbar {...(props as any)} />);
    const pinBtn = screen.getByTitle("Pin window");
    expect(pinBtn).toBeTruthy();
    const svg = pinBtn.querySelector("svg");
    expect(svg?.classList.contains("rotate-45")).toBe(false);
  });

  it("shows RDP sessions button when showRdpSessionsIcon is enabled", () => {
    const props = makeProps();
    render(<AppToolbar {...(props as any)} />);
    const btn = screen.getByTitle("RDP Sessions");
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(props.setRdpPanelOpen).toHaveBeenCalledWith(true);
  });
});
