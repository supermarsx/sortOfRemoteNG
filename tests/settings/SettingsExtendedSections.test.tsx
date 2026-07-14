import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../../src/types/settings/settings";
import AdvancedSettings from "../../src/components/SettingsDialog/sections/AdvancedSettings";
import LayoutSettings from "../../src/components/SettingsDialog/sections/LayoutSettings";
import ApiSettings from "../../src/components/SettingsDialog/sections/ApiSettings";
import SecuritySettings from "../../src/components/SettingsDialog/sections/SecuritySettings";
import { TrustVerificationSettings } from "../../src/components/SettingsDialog/sections/TrustVerificationSettings";
import RecoverySettings from "../../src/components/SettingsDialog/sections/RecoverySettings";

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      connections: [{ id: "conn-1", name: "Primary Server" }],
    },
  }),
}));

vi.mock("../../src/utils/auth/trustStore", () => ({
  getAllTrustRecords: vi.fn(() => [
    {
      host: "web.example.local:443",
      type: "https",
      nickname: "Primary HTTPS",
      userApproved: true,
      history: [],
      identity: {
        fingerprint: "https:aa:bb:cc",
        firstSeen: new Date("2024-01-01").toISOString(),
        lastSeen: new Date("2024-01-02").toISOString(),
      },
    },
    {
      host: "cert.example.local:443",
      type: "certificate",
      nickname: "Primary General Cert",
      userApproved: true,
      history: [],
      identity: {
        fingerprint: "cert:aa:bb:cc",
        firstSeen: new Date("2024-01-01").toISOString(),
        lastSeen: new Date("2024-01-02").toISOString(),
      },
    },
    {
      host: "rdp.example.local:3389",
      type: "rdp",
      nickname: "Primary RDP",
      userApproved: true,
      history: [],
      identity: {
        fingerprint: "rdp:aa:bb:cc",
        firstSeen: new Date("2024-01-01").toISOString(),
        lastSeen: new Date("2024-01-02").toISOString(),
      },
    },
    {
      host: "ssh.example.local:22",
      type: "ssh",
      nickname: "Primary SSH",
      userApproved: true,
      history: [],
      identity: {
        fingerprint: "ssh:aa:bb:cc",
        firstSeen: new Date("2024-01-01").toISOString(),
        lastSeen: new Date("2024-01-02").toISOString(),
      },
    },
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
  resolveEffectiveTrustPolicy: vi.fn(
    (
      connectionPolicy: string | undefined,
      categoryPolicy: string | undefined,
      rootPolicy: string | undefined,
      fallbackPolicy = "always-ask",
    ) =>
      [connectionPolicy, categoryPolicy, rootPolicy].find(
        (policy) => policy && policy !== "inherit",
      ) ?? fallbackPolicy,
  ),
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
  showInternalProxyIcon: false,
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
  trustPolicy: "tofu",
  certificateTrustPolicy: "inherit",
  httpsTrustPolicy: "tofu",
  tlsTrustPolicy: "tofu",
  sshTrustPolicy: "strict",
  rdpTrustPolicy: "tofu",
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

    expect(
      container.querySelectorAll(".sor-settings-card").length,
    ).toBeGreaterThanOrEqual(2);
    const watchdogToggle = screen.getByRole("checkbox", {
      name: /enable memory watchdog/i,
    });
    expect(watchdogToggle.className).toContain("sor-settings-checkbox");

    fireEvent.click(watchdogToggle);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ memoryWatchdog: expect.any(Object) }),
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

    expect(container.querySelectorAll(".sor-settings-card")).toHaveLength(6);
    expect(container.querySelector("h3 svg")?.getAttribute("class")).toContain(
      "text-primary",
    );
    expect(container.querySelector(".sor-section-heading")).toBeNull();

    const sectionHeaders = Array.from(
      container.querySelectorAll(".sor-settings-section-header"),
    );
    expect(sectionHeaders).toHaveLength(6);
    for (const header of sectionHeaders) {
      const icon = header.firstElementChild;
      expect(icon?.tagName.toLowerCase()).toBe("svg");
      expect(icon?.getAttribute("class")).toContain("text-primary");
    }

    const secondaryBarHeader = screen
      .getByText("Secondary Bar Icons")
      .closest(".sor-settings-section-header") as HTMLElement;
    const secondaryBarCard =
      secondaryBarHeader.nextElementSibling as HTMLElement;
    // Each row is a <label> rendered by the shared Toggle primitive,
    // wrapping a leading icon span (text-textSecondary).
    const secondaryBarRows = Array.from(
      secondaryBarCard.querySelectorAll("label"),
    );

    expect(secondaryBarRows).toHaveLength(21);
    for (const row of secondaryBarRows) {
      const iconWrapper = row.querySelector(".sor-settings-toggle-icon");
      expect(iconWrapper).not.toBeNull();
      const wrapperClass = iconWrapper?.getAttribute("class") ?? "";
      expect(wrapperClass).not.toMatch(
        /\btext-(primary|warning|success|error|info)\b/,
      );
    }
    expect(secondaryBarCard.querySelectorAll("[data-tooltip]")).toHaveLength(
      21,
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

    // Enable + ServerControls + Network + Auth + SSL + Performance + RateLimit
    expect(
      container.querySelectorAll(".sor-settings-card").length,
    ).toBeGreaterThanOrEqual(7);
    expect(
      container.querySelector('input[type="checkbox"]')?.className,
    ).toContain("sor-settings-checkbox");

    const sslModeSelect = screen
      .getByText("Manual (Provide Certificate)")
      .closest('[role="combobox"]') as HTMLElement;
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

    // SecuritySettings now embeds EncryptionAtRestSection (Phase 4),
    // which adds 1–2 cards depending on the live encryption state
    // (status badge always renders; setup / migration / change-pw
    // cards are conditional). The hook's command surface is mocked
    // away in jsdom so only the "not available" placeholder card
    // renders; assert "≥ 9" to stay robust against future additions.
    expect(
      container.querySelectorAll(".sor-settings-card").length,
    ).toBeGreaterThanOrEqual(9);
    expect(container.querySelector("h3 svg")?.getAttribute("class")).toContain(
      "text-primary",
    );
    expect(container.querySelector(".sor-section-heading")).toBeNull();

    const sectionHeaders = Array.from(
      container.querySelectorAll(".sor-settings-section-header"),
    );
    // Same robustness note as the card-count assertion above:
    // SecuritySettings now embeds EncryptionAtRestSection, which adds
    // 1+ section headers in jsdom (only the "not available" path
    // renders without a Tauri runtime). Assert "≥ 9" so the existing
    // subsections stay covered without coupling to the dynamic count.
    expect(sectionHeaders.length).toBeGreaterThanOrEqual(9);
    for (const header of sectionHeaders) {
      const icon = header.firstElementChild;
      expect(icon?.tagName.toLowerCase()).toBe("svg");
      expect(icon?.getAttribute("class")).toContain("text-primary");
    }

    const sshKeyTypeRow = document.querySelector(
      '[data-setting-key="sshKeyType"]',
    );
    expect(sshKeyTypeRow).not.toBeNull();
    expect(
      sshKeyTypeRow?.querySelector('[role="combobox"]')?.className,
    ).toContain("sor-settings-select");

    const generateSshKeyButton = screen.getByRole("button", {
      name: /generate & save key file/i,
    });
    expect(generateSshKeyButton.className).toContain("bg-primary");
    expect(generateSshKeyButton.className).toContain("hover:bg-primary/90");
    expect(generateSshKeyButton.className).not.toContain("success");
    // Generate button must no longer be full-width.
    expect(generateSshKeyButton.className).not.toContain("w-full");

    const algorithmSelect = container.querySelector(
      '[data-setting-key="encryptionAlgorithm"] [role="combobox"]',
    ) as HTMLElement;
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

    expect(screen.getByText("Default Trust Policy")).toBeInTheDocument();
    expect(screen.getByText("General Certificate Policy")).toBeInTheDocument();
    // Trust Policies, Policy Guide, Verification Options, Stored Identities.
    expect(
      container.querySelectorAll(".sor-settings-card").length,
    ).toBeGreaterThanOrEqual(4);
    expect(container.querySelector("h3 svg")?.getAttribute("class")).toContain(
      "text-primary",
    );
    expect(container.querySelector(".sor-section-heading")).toBeNull();

    const sectionHeaders = Array.from(
      container.querySelectorAll(".sor-settings-section-header"),
    );
    expect(sectionHeaders).toHaveLength(4);
    for (const header of sectionHeaders) {
      const icon = header.firstElementChild;
      expect(icon?.tagName.toLowerCase()).toBe("svg");
      expect(icon?.getAttribute("class")).toContain("text-primary");
    }

    // Each policy now renders as a standard SettingsSelectRow, identified
    // by data-setting-key, with the row label carrying the leading icon.
    for (const settingKey of [
      "trustPolicy",
      "certificateTrustPolicy",
      "httpsTrustPolicy",
      "sshTrustPolicy",
      "rdpTrustPolicy",
    ]) {
      const policyRow = container.querySelector(
        `[data-setting-key="${settingKey}"]`,
      ) as HTMLElement | null;
      expect(policyRow).not.toBeNull();
      expect(
        policyRow?.querySelector('[role="combobox"]')?.className,
      ).toContain("sor-settings-select");
    }

    const tlsPolicySelect = screen
      .getAllByText("Trust On First Use (TOFU)")[0]
      .closest('[role="combobox"]') as HTMLElement;
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

  it("renders inherited Trust Center policy controls", async () => {
    const updateSettings = vi.fn();
    render(
      <TrustVerificationSettings
        settings={{
          ...trustSettings,
          trustPolicy: "strict",
          certificateTrustPolicy: "inherit",
          httpsTrustPolicy: "tofu",
        }}
        updateSettings={updateSettings}
      />,
    );

    const certificateRow = document.querySelector(
      '[data-setting-key="certificateTrustPolicy"]',
    ) as HTMLElement;
    expect(certificateRow).not.toBeNull();
    expect(within(certificateRow).getByRole("combobox")).toHaveTextContent(
      "Inherit Default Policy",
    );
    expect(certificateRow).toHaveTextContent("Effective: Strict");

    const httpsRow = document.querySelector(
      '[data-setting-key="httpsTrustPolicy"]',
    ) as HTMLElement;
    fireEvent.click(within(httpsRow).getByRole("combobox"));
    fireEvent.mouseDown(
      await screen.findByRole("option", { name: "Inherit Default Policy" }),
    );

    expect(updateSettings).toHaveBeenCalledWith({
      httpsTrustPolicy: "inherit",
    });
  });

  it("groups Trust Center identities by explicit record type", async () => {
    render(
      <TrustVerificationSettings
        settings={trustSettings}
        updateSettings={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/HTTPS Certificates \(1\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/General Certificates \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/RDP Certificates \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/SSH Host Keys \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Legacy TLS \(1\)/i)).toBeInTheDocument();
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
