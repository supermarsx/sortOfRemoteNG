import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AppToolbar } from "../../src/components/app/AppToolbar";
import { TOOL_DESCRIPTORS } from "../../src/components/app/toolDescriptors";
import { TOOL_LABELS } from "../../src/components/app/toolSession";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import { DEFAULT_VALUES } from "../../src/components/SettingsDialog/settingsConstants";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
  }),
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
    showImportExportIcon: true,
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
  databaseManager: { getCurrentDatabase: () => null } as any,
  connections: [],
  setShowQuickConnect: vi.fn(),
  setShowDatabasePanel: vi.fn(),
  openImportExport: vi.fn(),
  openSettings: vi.fn(),
  openTrustCenter: vi.fn(),
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
  performCloudSync: vi.fn(),
  setShowDebugPanel: vi.fn(),
  setShowTagManager: vi.fn(),
  setShowTabGroupManager: vi.fn(),
  ...overrides,
});

describe("AppToolbar", () => {
  it("keeps the Action Log visibility preference as a labelled Session Manager shortcut", () => {
    const props = makeProps();
    props.appSettings.showActionLogIcon = true;
    props.databaseManager.getCurrentDatabase = () => ({ id: "fixture-db" });
    render(<AppToolbar {...(props as any)} />);
    fireEvent.click(screen.getByTitle("Session Manager — Action Log"));
    expect(props.setShowActionLog).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.queryByTitle("Action Log")).not.toBeInTheDocument();
  });
  it("opens autonomous security tools from Management without a database and honors both visibility flags", () => {
    const openCredentialVault = vi.fn(),
      openHardwareKeys = vi.fn();
    const props = makeProps();
    const view = render(
      <AppToolbar
        {...props}
        openCredentialVault={openCredentialVault}
        openHardwareKeys={openHardwareKeys}
      />,
    );
    const management = within(
      screen.getByRole("group", { name: "Management" }),
    );
    const vault = management.getByRole("button", {
      name: "Database Credential Vault",
    });
    const keys = management.getByRole("button", { name: "Hardware Keys" });
    expect(vault).toBeEnabled();
    expect(keys).toBeEnabled();
    fireEvent.click(vault);
    fireEvent.click(keys);
    expect(openCredentialVault).toHaveBeenCalledOnce();
    expect(openHardwareKeys).toHaveBeenCalledOnce();
    expect(props.openSettings).not.toHaveBeenCalled();
    view.rerender(
      <AppToolbar
        {...props}
        openCredentialVault={openCredentialVault}
        openHardwareKeys={openHardwareKeys}
        appSettings={{
          ...props.appSettings,
          showCredentialVaultIcon: false,
          showHardwareKeysIcon: false,
        }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Database Credential Vault" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Hardware Keys" }),
    ).not.toBeInTheDocument();
  });
  it("shows a configurable Documents action in Management even before a database is open", () => {
    const props = makeProps();
    const openDocuments = vi.fn();
    const view = render(
      <AppToolbar
        {...props}
        openDocuments={openDocuments}
        appSettings={{ ...props.appSettings, showDocumentsIcon: true }}
      />,
    );
    const button = within(
      screen.getByRole("group", { name: "Management" }),
    ).getByRole("button", { name: "Documents" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(openDocuments).toHaveBeenCalledOnce();
    expect(defaultSettings.showDocumentsIcon).toBe(true);
    view.rerender(
      <AppToolbar
        {...props}
        openDocuments={openDocuments}
        appSettings={{ ...props.appSettings, showDocumentsIcon: false }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Documents" }),
    ).not.toBeInTheDocument();
  });
  it("uses centered half-height decorative group dividers while preserving first-group spacing", () => {
    render(<AppToolbar {...makeProps()} />);
    for (const group of screen.getAllByRole("group")) {
      expect(group).toHaveClass(
        "relative",
        "before:absolute",
        "before:top-1/2",
        "before:h-1/2",
        "before:-translate-y-1/2",
        "before:border-l",
        "before:border-[var(--color-border)]",
        "before:pointer-events-none",
        "first:before:hidden",
        "[&:not(:first-child)]:pl-2",
      );
      expect(group).not.toHaveClass("[&:not(:first-child)]:border-l");
    }
  });

  it("keeps only Quick Connect, Databases and Settings on the left, grouping every other action on the right", () => {
    const props = makeProps({
      openIconExplorer: vi.fn(),
      databaseManager: { getCurrentDatabase: () => ({ id: "db" }) },
    });
    Object.assign(props.appSettings, {
      showScriptManagerIcon: true,
      showMacroManagerIcon: true,
      showSecurityIcon: true,
      showPerformanceMonitorIcon: true,
      showBackupStatusIcon: true,
    });
    render(<AppToolbar {...props} />);
    const left = screen.getByTestId("toolbar-actions-left");
    const right = screen.getByTestId("toolbar-actions-right");
    expect(
      within(left)
        .getAllByRole("group")
        .map((el) => el.getAttribute("aria-label")),
    ).toEqual(["Quick access"]);
    expect(within(left).getAllByRole("button")).toEqual([
      screen.getByTestId("toolbar-quick-connect"),
      screen.getByTestId("toolbar-collection"),
      screen.getByTestId("toolbar-settings"),
    ]);
    expect(
      within(right)
        .getAllByRole("group")
        .map((el) => el.getAttribute("aria-label")),
    ).toEqual([
      "Connections",
      "Tools",
      "Management",
      "Display",
      "Diagnostics",
      "Security",
      "Sync and backup",
    ]);
    expect(right).toContainElement(screen.getByTitle("Script Manager"));
    expect(right).toContainElement(screen.getByTitle("Macro Manager"));
    for (const button of [
      screen.getByRole("button", { name: "Trust Center" }),
      screen.getByRole("button", { name: "Icon Explorer" }),
      screen.getByTitle("Tab Group Manager"),
    ])
      expect(right).toContainElement(button);
    const settings = within(
      screen.getByRole("group", { name: "Security" }),
    ).getAllByRole("button");
    expect(settings.map((el) => el.getAttribute("title"))).toEqual([
      "Security",
    ]);
    fireEvent.click(screen.getByTitle("Tab Group Manager"));
    expect(props.setShowTabGroupManager).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTitle("Security"));
    expect(props.openSettings).toHaveBeenCalledWith("security");
    const nativeBar = screen.getByTestId("toolbar");
    for (const id of ["window-minimize", "window-maximize", "window-close"])
      expect(nativeBar).toContainElement(screen.getByTestId(id));
    expect(screen.getByTestId("toolbar-actions")).not.toContainElement(
      screen.getByTestId("window-close"),
    );
  });

  it("allows app-wide script and macro libraries without a database while preserving other database guards", () => {
    const props = makeProps();
    Object.assign(props.appSettings, {
      showScriptManagerIcon: true,
      showMacroManagerIcon: true,
      showWolIcon: true,
    });
    render(<AppToolbar {...props} />);
    for (const name of ["Script Manager", "Macro Manager"]) {
      expect(screen.getByTitle(name)).toBeEnabled();
      fireEvent.click(screen.getByTitle(name));
    }
    expect(props.setShowScriptManager).toHaveBeenCalledWith(true);
    expect(props.setShowMacroManager).toHaveBeenCalledWith(true);
    for (const name of [
      "Wake-on-LAN",
      "Import / Export",
      "Session Manager",
      "Tag Manager",
      "Tab Group Manager",
    ])
      expect(screen.getByTitle(name)).toBeDisabled();
  });

  it("omits disabled optional actions and empty groups without leaving separator-only surfaces", () => {
    const props = makeProps({ openIconExplorer: vi.fn() });
    Object.assign(props.appSettings, {
      showSettingsIcon: false,
      showIconExplorerIcon: false,
      showTrustCenterIcon: false,
    });
    render(<AppToolbar {...props} />);
    for (const name of [
      "Tools",
      "Display",
      "Diagnostics",
      "Security",
      "Sync and backup",
    ])
      expect(screen.queryByRole("group", { name })).toBeNull();
    for (const name of ["Icon Explorer", "Trust Center"])
      expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByTitle("Script Manager")).toBeNull();
    expect(screen.queryByTitle("Macro Manager")).toBeNull();
    expect(screen.queryByTitle("Settings")).toBeNull();
  });
  it("opens the autonomous Icon Explorer even without an active database", () => {
    const openIconExplorer = vi.fn();
    const props = makeProps({ openIconExplorer });
    const { rerender } = render(<AppToolbar {...props} />);
    const button = screen.getByRole("button", { name: "Icon Explorer" });
    expect(button).toHaveAttribute("data-tooltip", "Icon Explorer");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(openIconExplorer).toHaveBeenCalledOnce();
    expect(props.openSettings).not.toHaveBeenCalled();
    rerender(
      <AppToolbar
        {...props}
        appSettings={{ ...props.appSettings, showIconExplorerIcon: false }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Icon Explorer" })).toBeNull();
  });
  it("shows the configurable Trust Center shortcut and uses the existing tab opener", () => {
    expect(defaultSettings.showTrustCenterIcon).toBe(true);
    expect(DEFAULT_VALUES.showTrustCenterIcon).toBe(true);
    const props = makeProps();
    const { rerender } = render(<AppToolbar {...props} />);
    const button = screen.getByRole("button", { name: "Trust Center" });
    expect(button).toHaveAttribute("data-tooltip", "Trust Center");
    fireEvent.click(button);
    expect(props.openTrustCenter).toHaveBeenCalledOnce();
    expect(props.openSettings).not.toHaveBeenCalled();
    rerender(
      <AppToolbar
        {...props}
        appSettings={{ ...props.appSettings, showTrustCenterIcon: false }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Trust Center" }),
    ).not.toBeInTheDocument();
  });
  it("hides the dev console with both startup and reset defaults", () => {
    expect(defaultSettings.showDevtoolsIcon).toBe(false);
    expect(DEFAULT_VALUES.showDevtoolsIcon).toBe(false);
    const props = makeProps();
    render(
      <AppToolbar
        {...props}
        appSettings={{
          ...props.appSettings,
          showDevtoolsIcon: defaultSettings.showDevtoolsIcon,
        }}
      />,
    );
    expect(screen.queryByTitle("Open dev console")).not.toBeInTheDocument();
  });

  it("restores the dev console button and existing handler when opted in, and hides it when disabled", () => {
    const props = makeProps();
    const { rerender } = render(<AppToolbar {...props} />);
    expect(screen.queryByTitle("Open dev console")).not.toBeInTheDocument();
    rerender(
      <AppToolbar
        {...props}
        appSettings={{ ...props.appSettings, showDevtoolsIcon: true }}
      />,
    );
    fireEvent.click(screen.getByTitle("Open dev console"));
    expect(props.handleOpenDevtools).toHaveBeenCalledTimes(1);
    rerender(<AppToolbar {...props} />);
    expect(screen.queryByTitle("Open dev console")).not.toBeInTheDocument();
  });

  it("keeps the canonical tool descriptor exhaustive", () => {
    expect(Object.keys(TOOL_DESCRIPTORS).sort()).toEqual(
      Object.keys(TOOL_LABELS).sort(),
    );
  });

  it("renders without crashing", () => {
    const { container } = render(<AppToolbar {...(makeProps() as any)} />);
    expect(container.querySelector(".app-bar")).toBeTruthy();
  });

  it("uses title-bar drag regions for both top bars", () => {
    render(<AppToolbar {...(makeProps() as any)} />);

    expect(screen.getByTestId("toolbar")).toHaveAttribute(
      "data-tauri-drag-region",
    );
    expect(screen.getByTestId("toolbar-actions")).toHaveAttribute(
      "data-tauri-drag-region",
    );
  });

  it("shows the settings button when showSettingsIcon is true and clicking it opens settings with no tab", () => {
    const props = makeProps();
    render(<AppToolbar {...(props as any)} />);
    const settingsBtn = screen.getByTitle("Settings");
    expect(settingsBtn).toBeTruthy();
    fireEvent.click(settingsBtn);
    // The generic gear requests no particular tab, so the dialog keeps its
    // default/last tab rather than being deep-linked.
    expect(props.openSettings).toHaveBeenCalledWith();
  });

  it("opens Import / Export through the toolbar action", () => {
    const props = makeProps({
      databaseManager: {
        getCurrentDatabase: () => ({ id: "col-1", name: "Test" }),
      } as any,
    });

    render(<AppToolbar {...(props as any)} />);
    fireEvent.click(screen.getByTestId("toolbar-import-export"));

    expect(props.openImportExport).toHaveBeenCalledTimes(1);
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

  it("shows the Session Manager button when showRdpSessionsIcon is enabled", () => {
    const props = makeProps({
      databaseManager: {
        getCurrentDatabase: () => ({ id: "col-1", name: "Test" }),
      } as any,
    });
    render(<AppToolbar {...(props as any)} />);
    // The old "RDP Sessions" button was folded into the unified Session Manager
    // (commit 82f056df); `showRdpSessionsIcon` still gates it and it still opens
    // the RDP panel via setRdpPanelOpen.
    const btn = screen.getByTitle("Session Manager");
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(props.setRdpPanelOpen).toHaveBeenCalledWith(true);
  });

  it("uses the same canonical icons as the tool tabs it launches", () => {
    const props = makeProps({
      databaseManager: {
        getCurrentDatabase: () => ({ id: "col-1", name: "Test" }),
      } as any,
    });
    Object.assign(props.appSettings, {
      showProxyMenuIcon: true,
      showShortcutManagerIcon: true,
      showWolIcon: true,
      showBulkSSHIcon: true,
      showServerStatsIcon: true,
      showOpksshIcon: true,
      showMcpServerIcon: true,
      showScriptManagerIcon: true,
      showMacroManagerIcon: true,
      showRecordingManagerIcon: true,
      showPerformanceMonitorIcon: true,
      showActionLogIcon: true,
    });

    render(<AppToolbar {...(props as any)} />);

    const expected = [
      ["Import / Export", "importExport"],
      ["Settings", "settings"],
      ["Tag Manager", "tagManager"],
      ["Tab Group Manager", "tabGroupManager"],
      ["Session Manager", "rdpSessions"],
      ["Proxy & VPN", "proxyChain"],
      ["Shortcut Manager", "shortcutManager"],
      ["Wake-on-LAN", "wol"],
      ["Bulk SSH", "bulkSsh"],
      ["Server Stats", "serverStats"],
      ["opkssh", "opkssh"],
      ["MCP Server", "mcpServer"],
      ["Script Manager", "scriptManager"],
      ["Macro Manager", "macroManager"],
      ["Recording Manager", "recordingManager"],
      ["Performance Monitor", "performanceMonitor"],
      ["Session Manager — Action Log", "actionLog"],
    ] as const;

    expected.forEach(([title, toolKey]) => {
      const button = screen.getByTitle(title);
      expect(
        button.querySelector(`[data-tool-icon="${toolKey}"]`),
        `${title} should use ${toolKey}'s canonical icon`,
      ).toBeInTheDocument();
    });
  });
});
