import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GpgAgentManager } from "../../src/components/ssh/GpgAgentManager";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: vi.fn(),
      getSettings: vi.fn().mockReturnValue({}),
      loadSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../../src/utils/settings/themeManager", () => ({
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

// Hook mock matching the exact return shape of useGpgAgent
const makeHookReturn = () => ({
  status: null as any,
  config: null as any,
  keys: [] as any[],
  selectedKey: null as any,
  cardInfo: null as any,
  trustStats: null as any,
  auditEntries: [] as any[],
  keyserverResults: [] as any[],
  loading: false,
  error: null as string | null,
  setError: vi.fn(),
  activeTab: "overview",
  setActiveTab: vi.fn(),
  fetchStatus: vi.fn(),
  startAgent: vi.fn(),
  stopAgent: vi.fn(),
  restartAgent: vi.fn(),
  fetchConfig: vi.fn(),
  updateConfig: vi.fn(),
  detectEnvironment: vi.fn(),
  fetchKeys: vi.fn(),
  getKey: vi.fn(),
  generateKey: vi.fn(),
  importKey: vi.fn(),
  importKeyFile: vi.fn(),
  exportKey: vi.fn(),
  exportSecretKey: vi.fn(),
  deleteKey: vi.fn(),
  addUid: vi.fn(),
  revokeUid: vi.fn(),
  addSubkey: vi.fn(),
  revokeSubkey: vi.fn(),
  setExpiration: vi.fn(),
  genRevocation: vi.fn(),
  signData: vi.fn(),
  verifySignature: vi.fn(),
  signKey: vi.fn(),
  encryptData: vi.fn(),
  decryptData: vi.fn(),
  setTrust: vi.fn(),
  fetchTrustStats: vi.fn(),
  updateTrustDb: vi.fn(),
  searchKeyserver: vi.fn(),
  fetchFromKeyserver: vi.fn(),
  sendToKeyserver: vi.fn(),
  refreshKeys: vi.fn(),
  getCardStatus: vi.fn(),
  listCards: vi.fn(),
  cardChangePin: vi.fn(),
  cardFactoryReset: vi.fn(),
  cardSetAttr: vi.fn(),
  cardGenKey: vi.fn(),
  cardMoveKey: vi.fn(),
  cardFetchKey: vi.fn(),
  fetchAuditLog: vi.fn(),
  exportAudit: vi.fn(),
  clearAudit: vi.fn(),
});

let hookReturn = makeHookReturn();

vi.mock("../../src/hooks/ssh/useGpgAgent", () => ({
  useGpgAgent: () => hookReturn,
}));

const mockOnClose = vi.fn();
const defaultProps = { isOpen: true, onClose: mockOnClose };

const renderComponent = (props = {}) =>
  render(<GpgAgentManager {...defaultProps} {...props} />);

describe("GpgAgentManager", () => {
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
      // t("gpgAgent.title", "GPG Agent Manager") -> fallback "GPG Agent Manager"
      expect(
        screen.queryByText("GPG Agent Manager"),
      ).not.toBeInTheDocument();
    });

    it("should render when isOpen is true", () => {
      renderComponent();
      expect(screen.getByText("GPG Agent Manager")).toBeInTheDocument();
    });

    it("should display all tab labels", () => {
      renderComponent();
      // t(tab.labelKey, tab.id) -> returns tab.id as fallback
      const tabIds = [
        "overview",
        "keyring",
        "sign-verify",
        "encrypt-decrypt",
        "trust",
        "smartcard",
        "keyserver",
        "audit",
        "config",
      ];
      for (const id of tabIds) {
        expect(screen.getByText(id)).toBeInTheDocument();
      }
    });
  });

  describe("Interaction", () => {
    it("should handle tab switching to keyring", () => {
      renderComponent();
      const keyringTab = screen.getByText("keyring");
      fireEvent.click(keyringTab);
      expect(hookReturn.setActiveTab).toHaveBeenCalledWith("keyring");
    });

    it("should switch to trust tab", () => {
      renderComponent();
      fireEvent.click(screen.getByText("trust"));
      expect(hookReturn.setActiveTab).toHaveBeenCalledWith("trust");
    });

    it("should switch to smartcard tab", () => {
      renderComponent();
      fireEvent.click(screen.getByText("smartcard"));
      expect(hookReturn.setActiveTab).toHaveBeenCalledWith("smartcard");
    });

    it("should switch to audit tab", () => {
      renderComponent();
      fireEvent.click(screen.getByText("audit"));
      expect(hookReturn.setActiveTab).toHaveBeenCalledWith("audit");
    });
  });

  describe("Loading & Error States", () => {
    it("should show loading spinner when loading is true", () => {
      hookReturn = { ...makeHookReturn(), loading: true };
      const { container } = renderComponent();
      expect(
        container.querySelector(".sor-gpg-loading .animate-spin"),
      ).toBeTruthy();
    });

    it("should display error message when error is set", () => {
      hookReturn = {
        ...makeHookReturn(),
        error: "Connection to GPG agent failed",
      };
      renderComponent();
      expect(
        screen.getByText("Connection to GPG agent failed"),
      ).toBeInTheDocument();
    });
  });

  describe("Agent Status (Overview Tab)", () => {
    it("should display agent version when status is available", () => {
      hookReturn = {
        ...makeHookReturn(),
        activeTab: "overview",
        status: {
          running: true,
          version: "2.4.3",
          socket_path: "/run/user/1000/gnupg/S.gpg-agent",
          extra_socket: "/run/user/1000/gnupg/S.gpg-agent.extra",
          ssh_socket: "/run/user/1000/gnupg/S.gpg-agent.ssh",
          scdaemon_running: true,
          card_present: false,
          card_serial: null,
          keys_cached: 3,
          ssh_support: true,
          total_operations: 42,
          pinentry_program: "/usr/bin/pinentry-gtk-2",
        },
      };
      renderComponent();
      expect(screen.getByText("2.4.3")).toBeInTheDocument();
    });

    it("should show Start Agent button when agent is not running", () => {
      hookReturn = {
        ...makeHookReturn(),
        activeTab: "overview",
        status: null,
      };
      renderComponent();
      // t("gpgAgent.actions.start", "Start Agent") -> "Start Agent"
      expect(screen.getByText("Start Agent")).toBeInTheDocument();
    });
  });

  describe("Keyring Tab", () => {
    it("should show empty state when no keys exist", () => {
      hookReturn = { ...makeHookReturn(), activeTab: "keyring", keys: [] };
      renderComponent();
      // t("gpgAgent.keyring.empty", "No Keys Found") -> "No Keys Found"
      expect(screen.getByText("No Keys Found")).toBeInTheDocument();
    });

    it("should display key entries when keys exist", () => {
      hookReturn = {
        ...makeHookReturn(),
        activeTab: "keyring",
        keys: [
          {
            fingerprint: "ABCD1234EF567890ABCD1234EF567890ABCD1234",
            algorithm: "RSA",
            bits: 4096,
            created: "2024-01-15T00:00:00Z",
            expires: null,
            validity: "Ultimate",
            trust: "Ultimate",
            secret: true,
            on_card: false,
            uid_list: [
              {
                name: "Test User",
                email: "test@example.com",
                comment: "",
                validity: "Ultimate",
                primary: true,
                revoked: false,
                signatures: [],
              },
            ],
            subkeys: [],
            capabilities: ["Certify", "Sign"],
          },
        ],
      };
      renderComponent();
      expect(screen.getByText(/ABCD1234/)).toBeInTheDocument();
    });

    it("should show import button", () => {
      hookReturn = { ...makeHookReturn(), activeTab: "keyring" };
      renderComponent();
      // t("gpgAgent.keyring.import", "Import") -> "Import"
      expect(screen.getByText("Import")).toBeInTheDocument();
    });
  });

  describe("Smart Card Tab", () => {
    it("should show empty state when no card is present", () => {
      hookReturn = {
        ...makeHookReturn(),
        activeTab: "smartcard",
        cardInfo: null,
      };
      renderComponent();
      // t("gpgAgent.card.noCard", "No Smart Card Detected") -> "No Smart Card Detected"
      expect(
        screen.getByText("No Smart Card Detected"),
      ).toBeInTheDocument();
    });

    it("should display card info when a card is present", () => {
      hookReturn = {
        ...makeHookReturn(),
        activeTab: "smartcard",
        cardInfo: {
          reader: "Yubico YubiKey OTP+FIDO+CCID",
          serial: "12345678",
          manufacturer: "Yubico",
          application_version: "3.4",
          card_holder: "Test User",
          language: "en",
          signature_count: 42,
          pin_retry_count: [3, 3, 3],
          sig_key_fingerprint: "ABCD1234",
          enc_key_fingerprint: "EF567890",
          auth_key_fingerprint: "12345678",
          key_attributes: [],
        },
      };
      renderComponent();
      expect(screen.getByText("Yubico")).toBeInTheDocument();
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
      // t("gpgAgent.audit.empty", "No Audit Entries") -> "No Audit Entries"
      expect(screen.getByText("No Audit Entries")).toBeInTheDocument();
    });

    it("should display audit entries", () => {
      hookReturn = {
        ...makeHookReturn(),
        activeTab: "audit",
        auditEntries: [
          {
            timestamp: "2024-01-15T10:30:00Z",
            action: "sign",
            key_id: "ABCD1234",
            details: "Signed message",
            success: true,
          },
        ],
      };
      renderComponent();
      expect(screen.getByText("ABCD1234")).toBeInTheDocument();
    });
  });
});
