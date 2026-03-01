import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../src/types/settings";
import AdvancedSettings from "../src/components/settingsDialog/sections/AdvancedSettings";
import LayoutSettings from "../src/components/settingsDialog/sections/LayoutSettings";
import ApiSettings from "../src/components/settingsDialog/sections/ApiSettings";
import SecuritySettings from "../src/components/settingsDialog/sections/SecuritySettings";
import { TrustVerificationSettings } from "../src/components/settingsDialog/sections/TrustVerificationSettings";
import RecoverySettings from "../src/components/settingsDialog/sections/RecoverySettings";

vi.mock("../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      connections: [{ id: "conn-1", name: "Primary Server" }],
    },
  }),
}));

vi.mock("../src/utils/trustStore", () => ({
  getAllTrustRecords: vi.fn(() => [
    {
      host: "example.local:443",
      type: "tls",
      nickname: "Primary TLS",
      userApproved: true,
      history: [],
      identity: {
        fingerprint: "aa:bb:cc",
        firstSeen: new Date("2024-01-01").toISOString(),
        lastSeen: new Date("2024-01-02").toISOString(),
      },
    },
  ]),
  getAllPerConnectionTrustRecords: vi.fn(() => []),
  removeIdentity: vi.fn(),
  clearAllTrustRecords: vi.fn(),
  formatFingerprint: vi.fn((fingerprint: string) => fingerprint),
  updateTrustRecordNickname: vi.fn(),
}));

const advancedSettings = {
  tabGrouping: "protocol",
  logLevel: "info",
  hostnameOverride: true,
  detectUnexpectedClose: true,
  settingsDialog: {
    autoSave: true,
    showSaveButton: false,
    confirmBeforeReset: true,
  },
} as unknown as GlobalSettings;

const layoutSettings = {
  persistWindowSize: true,
  persistWindowPosition: true,
  autoRepatriateWindow: true,
  persistSidebarWidth: true,
  persistSidebarPosition: false,
  persistSidebarCollapsed: true,
  enableTabReorder: true,
  enableConnectionReorder: true,
  showQuickConnectIcon: true,
  showCollectionSwitcherIcon: true,
  showImportExportIcon: true,
  showSettingsIcon: true,
  showProxyMenuIcon: true,
  showInternalProxyIcon: true,
  showShortcutManagerIcon: true,
  showPerformanceMonitorIcon: true,
  showActionLogIcon: true,
  showDevtoolsIcon: true,
  showSecurityIcon: true,
  showWolIcon: true,
  showBulkSSHIcon: true,
  showScriptManagerIcon: true,
  showMacroManagerIcon: true,
  showRecordingManagerIcon: true,
  showErrorLogBar: true,
  showBackupStatusIcon: true,
  showCloudSyncStatusIcon: true,
  showSyncBackupStatusIcon: true,
  showRdpSessionsIcon: true,
} as unknown as GlobalSettings;

const apiSettings = {
  restApi: {
    enabled: true,
    startOnLaunch: true,
    port: 9876,
    useRandomPort: false,
    allowRemoteConnections: false,
    authentication: true,
    apiKey: "abc123",
    sslEnabled: true,
    sslMode: "manual",
    sslCertPath: "/tmp/cert.pem",
    sslKeyPath: "/tmp/key.pem",
    maxThreads: 4,
    requestTimeout: 30,
    maxRequestsPerMinute: 60,
  },
} as unknown as GlobalSettings;

const securitySettings = {
  encryptionAlgorithm: "AES-256-GCM",
  blockCipherMode: "GCM",
  keyDerivationIterations: 100000,
  benchmarkTimeSeconds: 2,
  autoBenchmarkIterations: true,
  autoLock: {
    enabled: true,
    timeoutMinutes: 10,
  },
  credsspDefaults: {
    oracleRemediation: "mitigated",
    nlaMode: "required",
    tlsMinVersion: "1.2",
    credsspVersion: 6,
    serverCertValidation: "validate",
    allowHybridEx: false,
    nlaFallbackToTls: true,
    enforceServerPublicKeyValidation: true,
    restrictedAdmin: false,
    remoteCredentialGuard: false,
    ntlmEnabled: true,
    kerberosEnabled: false,
    pku2uEnabled: false,
    sspiPackageList: "",
  },
  passwordReveal: {
    enabled: true,
    mode: "toggle",
    autoHideSeconds: 0,
    showByDefault: false,
    maskIcon: false,
  },
  totpEnabled: true,
  totpIssuer: "sortOfRemoteNG",
  totpDigits: 6,
  totpPeriod: 30,
  totpAlgorithm: "sha1",
} as unknown as GlobalSettings;

const trustSettings = {
  tlsTrustPolicy: "tofu",
  sshTrustPolicy: "strict",
  showTrustIdentityInfo: true,
  certExpiryWarningDays: 5,
} as unknown as GlobalSettings;

describe("Extended settings section centralization", () => {
  it("uses centralized card and checkbox classes in AdvancedSettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <AdvancedSettings
        settings={advancedSettings}
        updateSettings={updateSettings}
      />,
    );

    expect(container.querySelectorAll(".sor-settings-card").length).toBe(5);
    const hostnameOverride = screen.getByRole("checkbox", {
      name: /override tab names with hostname/i,
    });
    expect(hostnameOverride.className).toContain("sor-settings-checkbox");

    fireEvent.click(hostnameOverride);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ hostnameOverride: false }),
    );
  });

  it("uses centralized checkbox classes in LayoutSettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <LayoutSettings
        settings={layoutSettings}
        updateSettings={updateSettings}
      />,
    );

    expect(
      container.querySelectorAll(
        'input[type="checkbox"][class*="sor-settings-checkbox"]',
      ).length,
    ).toBeGreaterThan(20);

    const rememberSize = screen.getByRole("checkbox", {
      name: /remember window size/i,
    });
    fireEvent.click(rememberSize);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ persistWindowSize: false }),
    );
  });

  it("uses centralized card/input/select/checkbox classes in ApiSettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <ApiSettings settings={apiSettings} updateSettings={updateSettings} />,
    );

    expect(
      container.querySelectorAll(".sor-settings-card").length,
    ).toBeGreaterThanOrEqual(8);
    expect(
      container.querySelector('input[type="checkbox"]')?.className,
    ).toContain("sor-settings-checkbox");

    const sslModeSelect = screen.getByDisplayValue(
      "Manual (Provide Certificate)",
    );
    expect(sslModeSelect.className).toContain("sor-settings-select");

    const requestsInput = container.querySelector(
      'input[value="60"]',
    ) as HTMLInputElement;
    expect(requestsInput.className).toContain("sor-settings-input");
    fireEvent.change(requestsInput, { target: { value: "90" } });
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        restApi: expect.objectContaining({ maxRequestsPerMinute: 90 }),
      }),
    );
  });

  it("uses centralized cards/inputs/selects/checkboxes in SecuritySettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <SecuritySettings
        settings={securitySettings}
        updateSettings={updateSettings}
        handleBenchmark={vi.fn()}
        isBenchmarking={false}
      />,
    );

    expect(
      container.querySelectorAll(".sor-settings-card").length,
    ).toBeGreaterThanOrEqual(7);

    const algorithmSelect = container.querySelector(
      '[data-setting-key="encryptionAlgorithm"] select',
    ) as HTMLSelectElement;
    expect(algorithmSelect.className).toContain("sor-settings-select");

    const totpEnabled = container.querySelector(
      '[data-setting-key="totpEnabled"] input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(totpEnabled.className).toContain("sor-settings-checkbox");

    fireEvent.click(totpEnabled);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ totpEnabled: false }),
    );
  });

  it("uses centralized controls in TrustVerificationSettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <TrustVerificationSettings
        settings={trustSettings}
        updateSettings={updateSettings}
      />,
    );

    const tlsPolicySelect = screen.getByDisplayValue(
      "Trust On First Use (TOFU)",
    );
    expect(tlsPolicySelect.className).toContain("sor-settings-select");

    const infoToggle = screen.getByRole("checkbox", {
      name: /show certificate \/ host key info/i,
    });
    expect(infoToggle.className).toContain("sor-settings-checkbox");

    const warningDaysInput = container.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    expect(warningDaysInput.className).toContain("sor-settings-input");
    fireEvent.change(warningDaysInput, { target: { value: "7" } });
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ certExpiryWarningDays: 7 }),
    );
  });

  it("uses centralized card shells in RecoverySettings", () => {
    const { container } = render(<RecoverySettings />);

    expect(container.querySelectorAll(".sor-settings-card").length).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: /delete all/i }));
    expect(
      screen.getByText(
        /permanently delete all app data including your collections/i,
      ),
    ).toBeInTheDocument();
  });
});
