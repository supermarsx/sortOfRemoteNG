import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { YubiKeyManager } from "../src/components/ssh/YubiKeyManager";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: vi.fn(),
      getSettings: vi.fn().mockReturnValue({}),
      loadSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../src/utils/settings/themeManager", () => ({
  ThemeManager: {
    getInstance: () => ({
      applyTheme: vi.fn(),
      getCurrentTheme: vi.fn().mockReturnValue("dark"),
    }),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

// Hook mock matching the exact return shape of useYubiKey
const makeHookReturn = () => ({
  devices: [] as any[],
  selectedDevice: null as any,
  pivSlots: [] as any[],
  pivPinStatus: null as any,
  fido2Info: null as any,
  fido2Credentials: [] as any[],
  fido2PinStatus: null as any,
  oathAccounts: [] as any[],
  oathCodes: {} as Record<string, any>,
  otpSlots: [null, null] as [any, any],
  config: null as any,
  auditEntries: [] as any[],
  loading: false,
  error: null as string | null,
  activeTab: "devices",

  // Device
  listDevices: vi.fn(),
  getDeviceInfo: vi.fn(),
  waitForDevice: vi.fn(),
  getDiagnostics: vi.fn(),

  // PIV
  fetchPivCerts: vi.fn(),
  getPivSlot: vi.fn(),
  pivGenerateKey: vi.fn(),
  pivSelfSignCert: vi.fn(),
  pivGenerateCsr: vi.fn(),
  pivImportCert: vi.fn(),
  pivImportKey: vi.fn(),
  pivExportCert: vi.fn(),
  pivDeleteCert: vi.fn(),
  pivDeleteKey: vi.fn(),
  pivAttest: vi.fn(),
  pivChangePin: vi.fn(),
  pivChangePuk: vi.fn(),
  pivChangeMgmtKey: vi.fn(),
  pivUnblockPin: vi.fn(),
  pivGetPinStatus: vi.fn(),
  pivReset: vi.fn(),
  pivSign: vi.fn(),

  // FIDO2
  fetchFido2Info: vi.fn(),
  fetchFido2Credentials: vi.fn(),
  fido2DeleteCredential: vi.fn(),
  fido2SetPin: vi.fn(),
  fido2ChangePin: vi.fn(),
  fido2GetPinStatus: vi.fn(),
  fido2Reset: vi.fn(),
  fido2ToggleAlwaysUv: vi.fn(),
  fido2ListRps: vi.fn(),

  // OATH
  fetchOathAccounts: vi.fn(),
  oathAddAccount: vi.fn(),
  oathDeleteAccount: vi.fn(),
  oathRenameAccount: vi.fn(),
  oathCalculate: vi.fn(),
  oathCalculateAll: vi.fn(),
  oathSetPassword: vi.fn(),
  oathReset: vi.fn(),

  // OTP
  fetchOtpInfo: vi.fn(),
  otpConfigureYubico: vi.fn(),
  otpConfigureChalResp: vi.fn(),
  otpConfigureStatic: vi.fn(),
  otpConfigureHotp: vi.fn(),
  otpDeleteSlot: vi.fn(),
  otpSwapSlots: vi.fn(),

  // Config
  setInterfaces: vi.fn(),
  lockConfig: vi.fn(),
  unlockConfig: vi.fn(),
  fetchConfig: vi.fn(),
  updateConfig: vi.fn(),

  // Audit
  fetchAuditLog: vi.fn(),
  exportAudit: vi.fn(),
  clearAudit: vi.fn(),

  // Management
  factoryResetAll: vi.fn(),
  exportDeviceReport: vi.fn(),

  // Tab
  setActiveTab: vi.fn(),
});

let hookReturn = makeHookReturn();

vi.mock("../src/hooks/ssh/useYubiKey", () => ({
  useYubiKey: () => hookReturn,
}));

const mockOnClose = vi.fn();
const defaultProps = { isOpen: true, onClose: mockOnClose };

const renderComponent = (props = {}) =>
  render(<YubiKeyManager {...defaultProps} {...props} />);

describe("YubiKeyManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookReturn = makeHookReturn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic Rendering", () => {
    it("should not render when isOpen is false", () => {
      renderComponent({ isOpen: false });
      // t("yubikey.title", "YubiKey Manager") -> "YubiKey Manager"
      expect(
        screen.queryByText("YubiKey Manager"),
      ).not.toBeInTheDocument();
    });

    it("should render when isOpen is true", () => {
      renderComponent();
      expect(screen.getByText("YubiKey Manager")).toBeInTheDocument();
    });

    it("should display all tab labels", () => {
      renderComponent();
      // t(tab.labelKey, tab.id.toUpperCase()) -> returns tab.id.toUpperCase()
      const tabLabels = [
        "DEVICES",
        "PIV",
        "FIDO2",
        "OATH",
        "OTP",
        "CONFIG",
        "AUDIT",
      ];
      for (const label of tabLabels) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
    });
  });

  describe("Interaction", () => {
    it("should handle tab switching to PIV", () => {
      renderComponent();
      fireEvent.click(screen.getByText("PIV"));
      expect(hookReturn.setActiveTab).toHaveBeenCalledWith("piv");
    });

    it("should switch to FIDO2 tab", () => {
      renderComponent();
      fireEvent.click(screen.getByText("FIDO2"));
      expect(hookReturn.setActiveTab).toHaveBeenCalledWith("fido2");
    });

    it("should switch to OATH tab", () => {
      renderComponent();
      fireEvent.click(screen.getByText("OATH"));
      expect(hookReturn.setActiveTab).toHaveBeenCalledWith("oath");
    });

    it("should switch to OTP tab", () => {
      renderComponent();
      fireEvent.click(screen.getByText("OTP"));
      expect(hookReturn.setActiveTab).toHaveBeenCalledWith("otp");
    });
  });

  describe("Loading & Error States", () => {
    it("should show loading spinner when loading is true", () => {
      hookReturn = { ...makeHookReturn(), loading: true };
      const { container } = renderComponent();
      expect(
        container.querySelector(".sor-yk-loading .animate-spin"),
      ).toBeTruthy();
    });

    it("should display error message when error is set", () => {
      hookReturn = {
        ...makeHookReturn(),
        error: "Failed to detect YubiKey",
      };
      renderComponent();
      expect(
        screen.getByText("Failed to detect YubiKey"),
      ).toBeInTheDocument();
    });
  });

  describe("Devices Tab", () => {
    it("should show empty state when no devices are connected", () => {
      hookReturn = { ...makeHookReturn(), activeTab: "devices", devices: [] };
      renderComponent();
      // t("yubikey.devices.empty", "Insert a YubiKey") -> "Insert a YubiKey"
      expect(screen.getByText("Insert a YubiKey")).toBeInTheDocument();
    });

    it("should display device list when devices are present", () => {
      hookReturn = {
        ...makeHookReturn(),
        activeTab: "devices",
        devices: [
          {
            serial: 12345678,
            firmware_version: "5.4.3",
            form_factor: "UsbAKeychain",
            usb_interfaces: ["OTP", "FIDO", "CCID"],
            nfc_interfaces: [],
            fips: false,
            config_locked: false,
          },
        ],
      };
      renderComponent();
      // rendered as "Serial: {dev.serial}" => contains "12345678"
      expect(screen.getByText(/12345678/)).toBeInTheDocument();
      expect(screen.getByText(/5\.4\.3/)).toBeInTheDocument();
    });

    it("should show refresh button", () => {
      hookReturn = { ...makeHookReturn(), activeTab: "devices" };
      renderComponent();
      // t("yubikey.devices.refresh", "Refresh") -> "Refresh"
      expect(screen.getByText("Refresh")).toBeInTheDocument();
    });
  });

  describe("PIV Tab", () => {
    it("should show PIN management section", () => {
      hookReturn = {
        ...makeHookReturn(),
        activeTab: "piv",
        selectedDevice: { serial: 12345678 },
        pivPinStatus: {
          pin_retries: 3,
          puk_retries: 3,
          default_pin: true,
          default_puk: true,
          default_mgmt_key: true,
        },
      };
      renderComponent();
      // t("yubikey.piv.pinMgmt", "PIN Management") -> "PIN Management"
      expect(screen.getByText("PIN Management")).toBeInTheDocument();
    });
  });

  describe("OATH Tab", () => {
    it("should show empty state when no accounts", () => {
      hookReturn = {
        ...makeHookReturn(),
        activeTab: "oath",
        selectedDevice: { serial: 12345678 },
        oathAccounts: [],
      };
      renderComponent();
      // t("yubikey.oath.empty", "No OATH Accounts") -> "No OATH Accounts"
      expect(screen.getByText("No OATH Accounts")).toBeInTheDocument();
    });

    it("should display OATH accounts", () => {
      hookReturn = {
        ...makeHookReturn(),
        activeTab: "oath",
        selectedDevice: { serial: 12345678 },
        oathAccounts: [
          {
            id: "GitHub:user@example.com",
            issuer: "GitHub",
            name: "user@example.com",
            oath_type: "TOTP",
            algorithm: "SHA1",
            digits: 6,
            period: 30,
            touch_required: false,
          },
        ],
      };
      renderComponent();
      expect(screen.getByText("GitHub")).toBeInTheDocument();
    });
  });

  describe("FIDO2 Tab", () => {
    it("should show credentials when available", () => {
      hookReturn = {
        ...makeHookReturn(),
        activeTab: "fido2",
        selectedDevice: { serial: 12345678 },
        fido2Credentials: [
          {
            credential_id: "abc123",
            rp_id: "github.com",
            user_name: "testuser",
            user_display_name: "Test User",
            created_at: "2024-01-15T00:00:00Z",
            discoverable: true,
          },
        ],
      };
      renderComponent();
      expect(screen.getByText("github.com")).toBeInTheDocument();
    });
  });

  describe("Audit Tab", () => {
    it("should show empty audit state", () => {
      hookReturn = {
        ...makeHookReturn(),
        activeTab: "audit",
        auditEntries: [],
      };
      renderComponent();
      // t("yubikey.audit.empty", "No Audit Entries") -> "No Audit Entries"
      expect(screen.getByText("No Audit Entries")).toBeInTheDocument();
    });

    it("should display audit entries", () => {
      hookReturn = {
        ...makeHookReturn(),
        activeTab: "audit",
        auditEntries: [
          {
            timestamp: "2024-01-15T10:30:00Z",
            action: "piv_generate_key",
            serial: 12345678,
            details: "Generated RSA-2048 key in slot 9a",
            success: true,
          },
        ],
      };
      renderComponent();
      expect(screen.getByText(/12345678/)).toBeInTheDocument();
    });
  });
});
