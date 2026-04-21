import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { SettingsDialog } from "../../src/components/SettingsDialog";
import { GlobalSettings } from "../../src/types/settings/settings";
import { ToastProvider } from "../../src/contexts/ToastContext";

// mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const mockSettings = {
  language: "en",
  theme: "dark",
  colorScheme: "blue",
  autoSaveEnabled: false,
  autoSaveIntervalMinutes: 5,
  singleWindowMode: false,
  singleConnectionMode: false,
  reconnectOnReload: false,
  warnOnClose: false,
  warnOnDetachClose: false,
  warnOnExit: false,
  quickConnectHistoryEnabled: true,
  quickConnectHistory: [],
  autoLock: {
    enabled: false,
    timeoutMinutes: 10,
    lockOnIdle: true,
    lockOnSuspend: true,
    requirePassword: true,
  },
  maxConcurrentConnections: 5,
  connectionTimeout: 30,
  retryAttempts: 0,
  retryDelay: 5000,
  enablePerformanceTracking: false,
  performancePollIntervalMs: 20000,
  performanceLatencyTarget: "1.1.1.1",
  encryptionAlgorithm: "AES-256-GCM",
  blockCipherMode: "GCM",
  keyDerivationIterations: 1000,
  autoBenchmarkIterations: false,
  benchmarkTimeSeconds: 1,
  totpEnabled: false,
  totpIssuer: "",
  totpDigits: 6,
  totpPeriod: 30,
  globalProxy: { type: "http", host: "", port: 8080, enabled: false },
  tabGrouping: "none",
  hostnameOverride: false,
  defaultTabLayout: "tabs",
  enableTabDetachment: false,
  enableTabResize: true,
  enableZoom: true,
  enableTabReorder: true,
  enableConnectionReorder: true,
  colorTags: {},
  enableStatusChecking: false,
  statusCheckInterval: 30,
  statusCheckMethod: "socket",
  persistWindowSize: true,
  persistWindowPosition: true,
  persistSidebarWidth: true,
  persistSidebarPosition: true,
  persistSidebarCollapsed: true,
  windowSize: { width: 1280, height: 720 },
  windowPosition: { x: 120, y: 80 },
  sidebarWidth: 320,
  sidebarPosition: "left",
  sidebarCollapsed: false,
  networkDiscovery: {
    enabled: false,
    ipRange: "",
    portRanges: [],
    protocols: [],
    timeout: 5000,
    maxConcurrent: 50,
    maxPortConcurrent: 100,
    customPorts: {},
    probeStrategies: {},
    cacheTTL: 300000,
    hostnameTtl: 300000,
    macTtl: 300000,
  },
  restApi: {
    enabled: false,
    port: 8080,
    useRandomPort: false,
    authentication: false,
    apiKey: "",
    corsEnabled: true,
    rateLimiting: true,
    startOnLaunch: false,
    allowRemoteConnections: false,
    sslEnabled: false,
    sslMode: "self-signed" as const,
    maxRequestsPerMinute: 60,
    maxThreads: 4,
    requestTimeout: 30000,
  },
  wolEnabled: false,
  wolPort: 9,
  wolBroadcastAddress: "255.255.255.255",
  enableActionLog: false,
  logLevel: "info",
  maxLogEntries: 1000,
  exportEncryption: false,
  exportPassword: undefined,
};

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      loadSettings: vi.fn().mockResolvedValue(mockSettings),
      saveSettings: vi.fn(),
    }),
  },
}));

vi.mock("../../src/utils/settings/themeManager", () => ({
  ThemeManager: {
    getInstance: () => ({
      applyTheme: vi.fn(),
      getAvailableThemes: () => ["dark", "light", "auto"],
      getAvailableColorSchemes: () => ["blue"],
    }),
  },
}));

vi.mock("../../src/components/SettingsDialog/sections/GeneralSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-general" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/BehaviorSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-behavior" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/ThemeSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-theme" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/LayoutSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-layout" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/SecuritySettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-security" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/PerformanceSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-performance" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/ProxySettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-proxy" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/AdvancedSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-advanced" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/StartupSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-startup" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/ApiSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-api" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/RecoverySettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-recovery" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/SSHTerminalSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-ssh" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/BackupSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-backup" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/CloudSyncSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-cloudsync" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/TrustVerificationSettings", () => ({
  TrustVerificationSettings: () => <div data-testid="section-trust" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/WebBrowserSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-webbrowser" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/RdpDefaultSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-rdp" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/BackendSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-backend" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/RecordingSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-recording" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/MacroSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-macros" />,
}));
vi.mock("../../src/components/SettingsDialog/sections/DiagnosticsSettings", () => ({
  __esModule: true,
  default: () => <div data-testid="section-diagnostics" />,
}));

describe("SettingsDialog", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    if (!Element.prototype.scrollTo) {
      Element.prototype.scrollTo = vi.fn();
    }
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("renders general tab content", async () => {
    render(
      <ToastProvider>
        <SettingsDialog isOpen onClose={() => {}} />
      </ToastProvider>,
    );
    const items = await screen.findAllByText("settings.general");
    expect(items.length).toBeGreaterThan(0);
  });

  it("renders multiple tab buttons in the sidebar", async () => {
    render(
      <ToastProvider>
        <SettingsDialog isOpen onClose={() => {}} />
      </ToastProvider>,
    );
    await screen.findByTestId("section-general");
    expect(screen.getByText("settings.general")).toBeInTheDocument();
    expect(screen.getByText("Behavior")).toBeInTheDocument();
    expect(screen.getByText("settings.theme")).toBeInTheDocument();
    expect(screen.getByText("settings.security")).toBeInTheDocument();
  });

  it("switches to Behavior tab when clicked", async () => {
    render(
      <ToastProvider>
        <SettingsDialog isOpen onClose={() => {}} />
      </ToastProvider>,
    );
    await screen.findByTestId("section-general");
    expect(screen.getByTestId("section-general")).toBeInTheDocument();
    expect(screen.queryByTestId("section-behavior")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Behavior"));

    expect(screen.queryByTestId("section-general")).not.toBeInTheDocument();
    expect(screen.getByTestId("section-behavior")).toBeInTheDocument();
  });

  it("switches to Theme tab when clicked", async () => {
    render(
      <ToastProvider>
        <SettingsDialog isOpen onClose={() => {}} />
      </ToastProvider>,
    );
    await screen.findByTestId("section-general");

    fireEvent.click(screen.getByText("settings.theme"));

    expect(screen.queryByTestId("section-general")).not.toBeInTheDocument();
    expect(screen.getByTestId("section-theme")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <SettingsDialog isOpen onClose={onClose} />
      </ToastProvider>,
    );
    await screen.findByTestId("section-general");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("does not render when isOpen is false", () => {
    render(
      <ToastProvider>
        <SettingsDialog isOpen={false} onClose={() => {}} />
      </ToastProvider>,
    );
    expect(screen.queryByTestId("section-general")).not.toBeInTheDocument();
  });
});
