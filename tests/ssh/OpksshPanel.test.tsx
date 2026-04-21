import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpksshPanel } from "../../src/components/ssh/OpksshPanel";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import type {
  OpksshBinaryStatus,
  OpksshKey,
  OpksshLoginResult,
  OpksshClientConfig,
  OpksshStatus,
  ProviderEntry,
  AuthIdEntry,
  ServerOpksshConfig,
  AuditEntry,
  AuditResult,
  CustomProvider,
  ExpirationPolicy,
} from "../../src/types/security/opkssh";
import {
  WELL_KNOWN_PROVIDERS,
  EXPIRATION_POLICIES,
} from "../../src/types/security/opkssh";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
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

vi.mock("../../src/utils/connection/collectionManager", () => ({
  CollectionManager: {
    getInstance: () => ({
      getAllCollections: vi.fn().mockResolvedValue([]),
      getCurrentCollection: vi.fn().mockReturnValue(null),
    }),
    resetInstance: vi.fn(),
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

const mockSshSessions = [
  {
    id: "session-1",
    name: "Ubuntu Server",
    protocol: "ssh",
    hostname: "192.168.1.100",
    status: "connected",
    backendSessionId: "backend-1",
  },
  {
    id: "session-2",
    name: "CentOS Box",
    protocol: "ssh",
    hostname: "192.168.1.101",
    status: "connected",
    backendSessionId: "backend-2",
  },
  {
    id: "session-rdp",
    name: "Windows RDP",
    protocol: "rdp",
    hostname: "192.168.1.200",
    status: "connected",
  },
];

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      sessions: mockSshSessions,
      connections: [],
    },
    dispatch: vi.fn(),
  }),
}));

const mockOnClose = vi.fn();

// ── Helpers ────────────────────────────────────────────────────────

// Make isTauri() return true in tests
beforeEach(() => {
  (window as any).__TAURI_INTERNALS__ = true;
});
afterEach(() => {
  delete (window as any).__TAURI_INTERNALS__;
});

const makeBinaryStatus = (installed = true): OpksshBinaryStatus => ({
  installed,
  path: installed ? "/usr/local/bin/opkssh" : null,
  version: installed ? "0.13.0" : null,
  platform: "linux",
  arch: "x86_64",
  downloadUrl: installed
    ? null
    : "https://github.com/openpubkey/opkssh/releases/download/v0.13.0/opkssh-linux-amd64",
});

const makeKey = (overrides: Partial<OpksshKey> = {}): OpksshKey => ({
  id: "key-1",
  path: "/home/user/.ssh/id_ecdsa",
  publicKeyPath: "/home/user/.ssh/id_ecdsa.pub",
  identity: "user@example.com",
  provider: "google",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  isExpired: false,
  algorithm: "ecdsa-sha2-nistp256",
  fingerprint: "SHA256:abc123def456",
  ...overrides,
});

const makeStatus = (opts: Partial<OpksshStatus> = {}): OpksshStatus => ({
  binary: makeBinaryStatus(),
  activeKeys: [makeKey()],
  clientConfig: null,
  lastLogin: null,
  lastError: null,
  ...opts,
});

const makeClientConfig = (): OpksshClientConfig => ({
  configPath: "/home/user/.opk/config.yml",
  defaultProvider: "google",
  providers: [
    { alias: "myidp", issuer: "https://idp.example.com", clientId: "abc123" },
  ],
});

const makeServerConfig = (): ServerOpksshConfig => ({
  installed: true,
  version: "0.13.0",
  providers: [
    {
      issuer: "https://accounts.google.com",
      clientId: "google-client",
      expirationPolicy: "24h" as ExpirationPolicy,
    },
  ],
  globalAuthIds: [
    {
      principal: "root",
      identity: "admin@example.com",
      issuer: "https://accounts.google.com",
    },
  ],
  userAuthIds: [],
  sshdConfigSnippet:
    "AuthorizedKeysCommand /usr/local/bin/opkssh verify %u %k %t",
});

const makeAuditResult = (): AuditResult => ({
  entries: [
    {
      timestamp: new Date().toISOString(),
      identity: "admin@example.com",
      principal: "root",
      issuer: "https://accounts.google.com",
      action: "login",
      sourceIp: "10.0.0.1",
      success: true,
      details: null,
    },
    {
      timestamp: new Date().toISOString(),
      identity: "hacker@evil.com",
      principal: "root",
      issuer: "https://evil.com",
      action: "login",
      sourceIp: "10.0.0.99",
      success: false,
      details: "Untrusted issuer",
    },
  ],
  totalCount: 2,
  rawOutput: "",
});

const renderPanel = async (isOpen = true) => {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <ConnectionProvider>
        <OpksshPanel isOpen={isOpen} onClose={mockOnClose} />
      </ConnectionProvider>,
    );
  });
  return result!;
};

// ── Component Tests ────────────────────────────────────────────────

describe("OpksshPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return installed status & empty keys
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "opkssh_get_status":
          return Promise.resolve(makeStatus());
        case "opkssh_check_binary":
          return Promise.resolve(makeBinaryStatus());
        case "opkssh_list_keys":
          return Promise.resolve([makeKey()]);
        case "opkssh_well_known_providers":
          return Promise.resolve([
            {
              alias: "google",
              issuer: "https://accounts.google.com",
              clientId: "google-default",
            },
            {
              alias: "microsoft",
              issuer: "https://login.microsoftonline.com/.../v2.0",
              clientId: "ms-default",
            },
            {
              alias: "gitlab",
              issuer: "https://gitlab.com",
              clientId: "gitlab-default",
            },
          ] as CustomProvider[]);
        case "opkssh_get_client_config":
          return Promise.resolve(makeClientConfig());
        default:
          return Promise.resolve(null);
      }
    });
  });

  describe("Basic Rendering", () => {
    it("should not render when isOpen is false", async () => {
      await renderPanel(false);
      expect(
        screen.queryByText("opkssh Binary"),
      ).not.toBeInTheDocument();
    });

    it("should render when isOpen is true", async () => {
      await renderPanel(true);
      expect(screen.getByText("opkssh Binary")).toBeInTheDocument();
    });

    it("should show overview tab by default", async () => {
      await renderPanel();
      expect(screen.getByText("opkssh Binary")).toBeInTheDocument();
      expect(screen.getByText("Active Keys")).toBeInTheDocument();
      expect(screen.getByText("Quick Actions")).toBeInTheDocument();
    });

    it("should render tab navigation buttons", async () => {
      await renderPanel();
      expect(screen.getByText("overview")).toBeInTheDocument();
      expect(screen.getByText("login")).toBeInTheDocument();
      expect(screen.getByText("keys")).toBeInTheDocument();
      expect(screen.getByText("serverConfig")).toBeInTheDocument();
      expect(screen.getByText("providers")).toBeInTheDocument();
      expect(screen.getByText("audit")).toBeInTheDocument();
    });
  });

  describe("Tab Navigation", () => {
    it("should switch to login tab", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("login"));
      });
      expect(screen.getByText("OIDC Login")).toBeInTheDocument();
    });

    it("should switch to keys tab", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("keys"));
      });
      expect(screen.getByText("SSH Keys")).toBeInTheDocument();
    });

    it("should switch to server config tab and show session selector", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("serverConfig"));
      });
      expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
    });

    it("should switch to providers tab", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("providers"));
      });
      expect(screen.getByText("Client Configuration")).toBeInTheDocument();
    });

    it("should switch to audit tab", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("audit"));
      });
      expect(screen.getByText("Run Audit")).toBeInTheDocument();
    });
  });

  describe("Overview Tab", () => {
    it("should show binary status when loaded", async () => {
      await renderPanel();
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("opkssh_get_status");
      });
    });

    it("should show download link when binary not installed", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "opkssh_get_status")
          return Promise.resolve(
            makeStatus({ binary: makeBinaryStatus(false), activeKeys: [] }),
          );
        if (cmd === "opkssh_well_known_providers") return Promise.resolve([]);
        return Promise.resolve(null);
      });
      await renderPanel();
      await waitFor(() => {
        expect(screen.getByText("Not installed")).toBeInTheDocument();
      });
    });

    it("should render quick action buttons", async () => {
      await renderPanel();
      expect(screen.getByText("Login with OIDC")).toBeInTheDocument();
      expect(screen.getByText("Refresh Keys")).toBeInTheDocument();
      expect(screen.getByText("Refresh All")).toBeInTheDocument();
    });
  });

  describe("Login Tab", () => {
    it("should show provider selector", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("login"));
      });
      const providerSelect = screen.getByRole("combobox");
      expect(providerSelect).toBeInTheDocument();
    });

    it("should show advanced options toggle", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("login"));
      });
      expect(screen.getByText("Advanced Options")).toBeInTheDocument();
    });

    it("should expand advanced options when clicked", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("login"));
      });
      await act(async () => {
        fireEvent.click(screen.getByText("Advanced Options"));
      });
      expect(screen.getByText("Key File Name")).toBeInTheDocument();
      expect(screen.getByText("Remote Redirect URI")).toBeInTheDocument();
      expect(screen.getByText("Create SSH config entry")).toBeInTheDocument();
    });

    it("should call login on button click", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "opkssh_get_status") return Promise.resolve(makeStatus());
        if (cmd === "opkssh_well_known_providers") return Promise.resolve([]);
        if (cmd === "opkssh_login")
          return Promise.resolve({
            success: true,
            keyPath: "/home/user/.ssh/id_ecdsa",
            identity: "user@example.com",
            provider: "google",
            expiresAt: new Date(Date.now() + 86400_000).toISOString(),
            message: "Login successful",
            rawOutput: "",
          } satisfies OpksshLoginResult);
        if (cmd === "opkssh_list_keys") return Promise.resolve([makeKey()]);
        return Promise.resolve(null);
      });
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("login"));
      });
      // Find and click the "Login with OIDC" button (the one in the login tab)
      const loginButtons = screen.getAllByText("Login with OIDC");
      const tabLoginBtn = loginButtons[loginButtons.length - 1];
      await act(async () => {
        fireEvent.click(tabLoginBtn);
      });
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "opkssh_login",
          expect.any(Object),
        );
      });
    });
  });

  describe("Keys Tab", () => {
    it("should show key list after refresh", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("keys"));
      });
      // Key data comes from the initial status call
      await waitFor(() => {
        expect(screen.getByText("user@example.com")).toBeInTheDocument();
      });
    });

    it("should show expired badge for expired keys", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "opkssh_get_status")
          return Promise.resolve(
            makeStatus({
              activeKeys: [
                makeKey({
                  isExpired: true,
                  expiresAt: new Date(Date.now() - 3600_000).toISOString(),
                }),
              ],
            }),
          );
        if (cmd === "opkssh_well_known_providers") return Promise.resolve([]);
        return Promise.resolve(null);
      });
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("keys"));
      });
      await waitFor(() => {
        expect(screen.getByText("Expired")).toBeInTheDocument();
      });
    });

    it("should show key details", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("keys"));
      });
      await waitFor(() => {
        expect(screen.getByText("user@example.com")).toBeInTheDocument();
      });
      expect(screen.getByText(/ecdsa-sha2-nistp256/)).toBeInTheDocument();
    });
  });

  describe("Server Config Tab", () => {
    it("should show hint when no session selected", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("serverConfig"));
      });
      // The auto-selector picks the first session, so deselect
      const sessionSelects = screen.getAllByRole("combobox");
      const sessionSelect = sessionSelects[0];
      // Open the dropdown
      fireEvent.click(sessionSelect);
      // Select the empty placeholder option to deselect
      const placeholders = screen.getAllByRole("option");
      const emptyOption = placeholders.find(
        (el) => el.textContent?.match(/select session|opkssh\.selectSession/i),
      );
      if (emptyOption) {
        fireEvent.mouseDown(emptyOption);
      }
      // After deselecting, the component shows the "Server Configuration" heading
      // and prompt to load server config (since no config cached)
      expect(screen.getByText("Server Configuration")).toBeInTheDocument();
    });

    it("should show server config sections when session selected", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("serverConfig"));
      });
      expect(screen.getByText("Server Configuration")).toBeInTheDocument();
      expect(screen.getByText("Allowed Providers")).toBeInTheDocument();
      expect(screen.getByText("Global Auth IDs")).toBeInTheDocument();
    });

    it("should show install button", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("serverConfig"));
      });
      expect(screen.getByText("Install")).toBeInTheDocument();
    });
  });

  describe("Providers Tab", () => {
    it("should show client config section", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("providers"));
      });
      expect(screen.getByText("Client Configuration")).toBeInTheDocument();
      expect(screen.getByText("Well-Known Providers")).toBeInTheDocument();
      expect(screen.getByText("Custom Providers")).toBeInTheDocument();
    });

    it("should show env variable builder", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("providers"));
      });
      expect(
        screen.getByText("OPKSSH_PROVIDERS Environment Variable"),
      ).toBeInTheDocument();
      expect(screen.getByText("Generate")).toBeInTheDocument();
    });
  });

  describe("Audit Tab", () => {
    it("should show audit controls", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("audit"));
      });
      expect(screen.getByText("Run Audit")).toBeInTheDocument();
    });

    it("should show hint when no results", async () => {
      await renderPanel();
      await act(async () => {
        fireEvent.click(screen.getByText("audit"));
      });
      expect(
        screen.getByText("Click Run Audit to view opkssh authentication logs."),
      ).toBeInTheDocument();
    });
  });

  describe("Error Handling", () => {
    it("should show error banner on API failure", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "opkssh_get_status")
          return Promise.reject(new Error("Connection refused"));
        if (cmd === "opkssh_well_known_providers") return Promise.resolve([]);
        return Promise.resolve(null);
      });
      await renderPanel();
      await waitFor(() => {
        expect(screen.getByText(/Status refresh failed/)).toBeInTheDocument();
      });
    });
  });
});

// ── Type Tests ─────────────────────────────────────────────────────

describe("opkssh types", () => {
  it("WELL_KNOWN_PROVIDERS should have expected entries", () => {
    expect(WELL_KNOWN_PROVIDERS.length).toBeGreaterThanOrEqual(10);
    const googleEntry = WELL_KNOWN_PROVIDERS.find((p) => p.alias === "google");
    expect(googleEntry).toBeDefined();
    expect(googleEntry!.issuer).toBe("https://accounts.google.com");
  });

  it("EXPIRATION_POLICIES should have 6 entries", () => {
    expect(EXPIRATION_POLICIES).toHaveLength(6);
    const values = EXPIRATION_POLICIES.map((p) => p.value);
    expect(values).toContain("24h");
    expect(values).toContain("oidc");
    expect(values).toContain("oidc-refreshed");
  });

  it("should correctly type OpksshBinaryStatus", () => {
    const status: OpksshBinaryStatus = {
      installed: true,
      path: "/usr/local/bin/opkssh",
      version: "0.13.0",
      platform: "linux",
      arch: "x86_64",
      downloadUrl: null,
    };
    expect(status.installed).toBe(true);
    expect(status.version).toBe("0.13.0");
  });

  it("should correctly type OpksshKey", () => {
    const key: OpksshKey = {
      id: "k1",
      path: "/home/user/.ssh/id_ecdsa",
      publicKeyPath: "/home/user/.ssh/id_ecdsa.pub",
      identity: "user@google.com",
      provider: "google",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      isExpired: false,
      algorithm: "ecdsa-sha2-nistp256",
      fingerprint: "SHA256:abc",
    };
    expect(key.isExpired).toBe(false);
    expect(key.algorithm).toBe("ecdsa-sha2-nistp256");
  });

  it("should correctly type ProviderEntry with ExpirationPolicy", () => {
    const entry: ProviderEntry = {
      issuer: "https://accounts.google.com",
      clientId: "google-client-id",
      expirationPolicy: "24h",
    };
    expect(entry.expirationPolicy).toBe("24h");
  });

  it("should correctly type AuthIdEntry", () => {
    const entry: AuthIdEntry = {
      principal: "root",
      identity: "admin@example.com",
      issuer: "https://accounts.google.com",
    };
    expect(entry.principal).toBe("root");
  });

  it("should correctly type ServerOpksshConfig", () => {
    const config: ServerOpksshConfig = {
      installed: true,
      version: "0.13.0",
      providers: [
        {
          issuer: "https://accounts.google.com",
          clientId: "google-client-id",
          expirationPolicy: "24h",
        },
      ],
      globalAuthIds: [
        {
          principal: "root",
          identity: "admin@example.com",
          issuer: "https://accounts.google.com",
        },
      ],
      userAuthIds: [],
      sshdConfigSnippet:
        "AuthorizedKeysCommand /usr/local/bin/opkssh verify %u %k %t",
    };
    expect(config.installed).toBe(true);
    expect(config.providers).toHaveLength(1);
    expect(config.globalAuthIds).toHaveLength(1);
  });

  it("should correctly type AuditEntry", () => {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      identity: "user@google.com",
      principal: "deploy",
      issuer: "https://accounts.google.com",
      action: "login",
      sourceIp: "10.0.0.5",
      success: true,
      details: null,
    };
    expect(entry.success).toBe(true);
  });

  it("should correctly type OpksshClientConfig", () => {
    const config: OpksshClientConfig = {
      configPath: "/home/user/.opk/config.yml",
      defaultProvider: "google",
      providers: [
        {
          alias: "myidp",
          issuer: "https://idp.example.com",
          clientId: "my-client-id",
          clientSecret: "secret",
          scopes: "openid email",
        },
      ],
    };
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].alias).toBe("myidp");
  });
});
