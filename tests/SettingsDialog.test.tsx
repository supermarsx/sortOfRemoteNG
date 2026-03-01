import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { SettingsDialog } from "../src/components/settingsDialog";
import { GlobalSettings } from "../src/types/settings";
import { ToastProvider } from "../src/contexts/ToastContext";

// mock i18n
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const mockSettings: GlobalSettings = {
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
    cacheTTL: 300000,
    hostnameTtl: 300000,
    macTtl: 300000,
  },
  restApi: {
    enabled: false,
    port: 8080,
    authentication: false,
    apiKey: "",
    corsEnabled: true,
    rateLimiting: true,
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

vi.mock("../src/utils/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      loadSettings: vi.fn().mockResolvedValue(mockSettings),
      saveSettings: vi.fn(),
    }),
  },
}));

vi.mock("../src/utils/themeManager", () => ({
  ThemeManager: {
    getInstance: () => ({
      applyTheme: vi.fn(),
      getAvailableThemes: () => ["dark", "light", "auto"],
      getAvailableColorSchemes: () => ["blue"],
    }),
  },
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
});
