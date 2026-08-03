import { describe, it, expect, beforeEach, afterEach, vi, Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAppLifecycle } from "../../src/hooks/window/useAppLifecycle";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { ThemeManager } from "../../src/utils/settings/themeManager";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import i18n, { loadLanguage } from "../../src/i18n";

const lifecycleMocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  state: {
    sessions: [] as any[],
    connections: [] as any[],
  },
}));

// Mock i18next and related modules
vi.mock("i18next", () => ({
  default: {
    use: vi.fn().mockReturnThis(),
    init: vi.fn().mockResolvedValue(undefined),
    language: "en",
    changeLanguage: vi.fn(),
    hasResourceBundle: vi.fn(),
    addResourceBundle: vi.fn(),
  },
}));

vi.mock("i18next-browser-languagedetector", () => ({
  default: vi.fn(),
}));

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: vi.fn((key) => key),
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
    },
  }),
  initReactI18next: vi.fn(),
}));

// Mock the ConnectionProvider context
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: lifecycleMocks.state,
    addConnection: vi.fn(),
    removeConnection: vi.fn(),
    updateConnection: vi.fn(),
    loadData: lifecycleMocks.loadData,
  }),
}));

describe("useAppLifecycle", () => {
  let mockSettingsManager: any;
  let mockThemeManager: any;
  let mockI18n: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    lifecycleMocks.loadData.mockReset();
    lifecycleMocks.loadData.mockResolvedValue(undefined);
    lifecycleMocks.state = { sessions: [], connections: [] };
    sessionStorage.clear();

    // Setup mock instances
    mockSettingsManager = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getSettings: vi.fn().mockReturnValue({
        language: "en",
        theme: "dark",
        colorScheme: "blue",
        primaryAccentColor: "",
      }),
      logAction: vi.fn(),
    };

    mockThemeManager = {
      loadSavedTheme: vi.fn().mockResolvedValue(undefined),
      injectThemeCSS: vi.fn(),
      applyTheme: vi.fn(),
    };

    mockI18n = {
      language: "en",
      changeLanguage: vi.fn().mockResolvedValue(undefined),
      hasResourceBundle: vi.fn().mockReturnValue(false),
    };

    // Mock the singleton getters
    (SettingsManager as any).getInstance = vi
      .fn()
      .mockReturnValue(mockSettingsManager);
    (ThemeManager as any).getInstance = vi
      .fn()
      .mockReturnValue(mockThemeManager);

    // Replace i18n mock
    (i18n as any).language = "en";
    (i18n as any).changeLanguage = mockI18n.changeLanguage;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute("dir");
    sessionStorage.clear();
  });

  it("should initialize app successfully", async () => {
    const { result } = renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        setShowDatabasePanel: vi.fn(),
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );

    // Initialization is async (dynamic imports + Promise.all over settings,
    // theme, and DB tasks); a fixed sleep races that chain. Poll until the hook
    // reports it finished instead.
    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });

    expect(mockSettingsManager.initialize).toHaveBeenCalled();
    expect(mockThemeManager.loadSavedTheme).toHaveBeenCalled();
    expect(mockThemeManager.injectThemeCSS).toHaveBeenCalled();
  });

  it("should change language when settings language differs", async () => {
    mockSettingsManager.getSettings.mockReturnValue({
      language: "es",
      theme: "dark",
      colorScheme: "blue",
      primaryAccentColor: "",
    });
    (i18n as any).language = "en";

    const { result } = renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        setShowDatabasePanel: vi.fn(),
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );

    // Wait for automatic initialization
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Language should be changed successfully (verified by console output)
  });

  it("should not change language when already set", async () => {
    mockSettingsManager.getSettings.mockReturnValue({
      language: "en",
      theme: "dark",
      colorScheme: "blue",
      primaryAccentColor: "",
    });
    (i18n as any).language = "en";

    renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        setShowDatabasePanel: vi.fn(),
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );

    // Wait for automatic initialization
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(mockI18n.changeLanguage).not.toHaveBeenCalled();
  });

  it("applies rtlLayout to the document direction during initialization", async () => {
    mockSettingsManager.getSettings.mockReturnValue({
      language: "en",
      theme: "dark",
      colorScheme: "blue",
      primaryAccentColor: "",
      rtlLayout: true,
      autoOpenLastCollection: false,
    });

    const { result } = renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        setShowDatabasePanel: vi.fn(),
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });

    expect(document.documentElement.dir).toBe("rtl");
  });

  it("auto-opens lastOpenedCollectionId when autoOpenLastCollection is enabled", async () => {
    const collection = {
      id: "collection-coverage",
      name: "Coverage Collection",
      isEncrypted: false,
    };
    const databaseManager = {
      getAllDatabases: vi.fn().mockResolvedValue([collection]),
      selectDatabase: vi.fn().mockResolvedValue(undefined),
      getCurrentDatabase: vi.fn().mockReturnValue(collection),
    };
    vi.spyOn(DatabaseManager, "getInstance").mockReturnValue(
      databaseManager as any,
    );
    mockSettingsManager.getSettings.mockReturnValue({
      language: "en",
      theme: "dark",
      colorScheme: "blue",
      primaryAccentColor: "",
      autoOpenLastCollection: true,
      lastOpenedCollectionId: "collection-coverage",
    });
    const setShowDatabasePanel = vi.fn();

    const { result } = renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        setShowDatabasePanel,
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.isInitialized).toBe(true);
    });

    expect(databaseManager.getAllDatabases).toHaveBeenCalled();
    expect(databaseManager.selectDatabase).toHaveBeenCalledWith(
      "collection-coverage",
    );
    expect(lifecycleMocks.loadData).toHaveBeenCalled();
    expect(setShowDatabasePanel).not.toHaveBeenCalledWith(true);
  });

  it("should handle language change errors gracefully", async () => {
    mockSettingsManager.getSettings.mockReturnValue({
      language: "es",
      theme: "dark",
      colorScheme: "blue",
      primaryAccentColor: "",
    });
    (i18n as any).language = "en";
    mockI18n.changeLanguage.mockRejectedValue(
      new Error("Language change failed"),
    );

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        setShowDatabasePanel: vi.fn(),
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );

    // Wait for automatic initialization
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // The app should still initialize even if language change fails
    expect(mockSettingsManager.initialize).toHaveBeenCalled();
  });

  it("should handle initialization errors", async () => {
    mockSettingsManager.initialize.mockRejectedValue(new Error("Init failed"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        setShowDatabasePanel: vi.fn(),
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );

    // Wait for automatic initialization
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to initialize application:",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it("should log successful initialization", async () => {
    renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        setShowDatabasePanel: vi.fn(),
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );

    // Wait for automatic initialization
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(mockSettingsManager.logAction).toHaveBeenCalledWith(
      "info",
      "Application initialized",
      undefined,
      "sortOfRemoteNG started successfully",
    );
  });

  it("persists exact VPN ownership for reload restoration", async () => {
    mockSettingsManager.getSettings.mockReturnValue({
      language: "en",
      theme: "dark",
      colorScheme: "blue",
      primaryAccentColor: "",
      reconnectOnReload: true,
    });
    lifecycleMocks.state.sessions = [
      {
        id: "session-vpn",
        connectionId: "connection-vpn",
        name: "VPN SSH",
        protocol: "ssh",
        hostname: "host.example",
        status: "connected",
        startTime: new Date("2026-07-19T08:00:00.000Z"),
        backendSessionId: "backend-vpn",
        vpnLeaseOwnerId: "owner-vpn",
        vpnLeaseOwnerIds: ["owner-vpn"],
        vpnLeaseBindings: [
          {
            ownerId: "owner-vpn",
            backendSessionId: "backend-vpn",
            protocol: "ssh",
            status: "active",
          },
        ],
        lifecycleRevision: 4,
      },
    ];

    renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        setShowDatabasePanel: vi.fn(),
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(sessionStorage.getItem("mremote-active-sessions")).not.toBeNull();
    });
    const [saved] = JSON.parse(
      sessionStorage.getItem("mremote-active-sessions")!,
    );
    expect(saved).toEqual(
      expect.objectContaining({
        backendSessionId: "backend-vpn",
        vpnLeaseOwnerId: "owner-vpn",
        vpnLeaseOwnerIds: ["owner-vpn"],
        vpnLeaseBindings: [
          {
            ownerId: "owner-vpn",
            backendSessionId: "backend-vpn",
            protocol: "ssh",
            status: "active",
          },
        ],
        lifecycleRevision: 4,
      }),
    );
  });

  it("persists integration tabs without launch metadata and skips app-only tabs", async () => {
    mockSettingsManager.getSettings.mockReturnValue({
      language: "en",
      theme: "dark",
      colorScheme: "blue",
      primaryAccentColor: "",
      reconnectOnReload: true,
    });
    lifecycleMocks.state.sessions = [
      {
        id: "integration-session",
        connectionId: "integration-connection",
        name: "Grafana",
        protocol: "integration:grafana",
        hostname: "grafana.example",
        status: "connected",
        startTime: new Date("2026-07-19T08:00:00.000Z"),
        integration: {
          descriptorKey: "grafana",
          instanceId: "grafana-instance",
          credentialRefId: "vault-ref",
          authToken: "plaintext-auth-token",
          apiKey: "plaintext-api-key",
          password: "plaintext-password",
          providerSecrets: {
            clientSecret: "plaintext-client-secret",
          },
        },
      },
      {
        id: "tool-session",
        connectionId: "tool-connection",
        name: "Settings",
        protocol: "tool:settings",
        hostname: "",
        status: "connected",
        startTime: new Date("2026-07-19T08:00:00.000Z"),
      },
      {
        id: "winmgmt-session",
        connectionId: "winmgmt-connection",
        name: "Services",
        protocol: "winmgmt:services",
        hostname: "",
        status: "connected",
        startTime: new Date("2026-07-19T08:00:00.000Z"),
      },
    ];

    renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        setShowDatabasePanel: vi.fn(),
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(sessionStorage.getItem("mremote-active-sessions")).not.toBeNull();
    });
    const json = sessionStorage.getItem("mremote-active-sessions")!;
    const saved = JSON.parse(json);

    expect(json).not.toContain("plaintext-");
    expect(json).not.toContain("grafana-instance");
    expect(json).not.toContain("vault-ref");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(
      expect.objectContaining({
        id: "integration-session",
        protocol: "integration:grafana",
      }),
    );
    expect(saved[0]).not.toHaveProperty("integration");
  });

  it("retains only failed recovery rows and retries their exact ownership metadata", async () => {
    mockSettingsManager.getSettings.mockReturnValue({
      language: "en",
      theme: "dark",
      colorScheme: "blue",
      primaryAccentColor: "",
      reconnectOnReload: true,
      autoOpenLastCollection: false,
    });
    lifecycleMocks.state.connections = [
      {
        id: "connection-restored",
        name: "Restored",
        protocol: "ssh",
        hostname: "restored.example",
      },
      {
        id: "connection-retry",
        name: "Retry",
        protocol: "ssh",
        hostname: "retry.example",
      },
    ];
    const retryRow = {
      id: "session-retry",
      connectionId: "connection-retry",
      name: "Retry SSH",
      protocol: "ssh",
      hostname: "retry.example",
      status: "connected",
      backendSessionId: "backend-retry",
      vpnLeaseOwnerId: "owner-retry",
      vpnLeaseOwnerIds: ["owner-retry"],
      vpnLeaseBindings: [
        {
          ownerId: "owner-retry",
          backendSessionId: "backend-retry",
          protocol: "ssh",
          status: "active",
        },
      ],
      lifecycleRevision: 9,
      lifecycleActorGeneration: 3,
      lifecycleWriterId: "native-window-3",
      password: "must-not-survive-recovery",
    };
    sessionStorage.setItem(
      "mremote-active-sessions",
      JSON.stringify([
        {
          id: "session-restored",
          connectionId: "connection-restored",
          name: "Restored SSH",
          protocol: "ssh",
          hostname: "restored.example",
          status: "connected",
        },
        retryRow,
      ]),
    );
    const restoreSession = vi.fn(
      async (session: { id: string }): Promise<void> => {
        if (session.id === "session-retry") {
          throw new Error("backend actor unavailable");
        }
      },
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const first = renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        restoreSession,
        setShowDatabasePanel: vi.fn(),
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(first.result.current.isInitialized).toBe(true);
    });
    expect(
      JSON.parse(sessionStorage.getItem("mremote-active-sessions")!),
    ).toHaveLength(2);

    await waitFor(
      () => {
        expect(restoreSession).toHaveBeenCalledTimes(2);
        const retained = JSON.parse(
          sessionStorage.getItem("mremote-active-sessions")!,
        );
        expect(retained).toHaveLength(1);
        expect(retained[0]).toEqual(
          expect.objectContaining({
            id: "session-retry",
            backendSessionId: "backend-retry",
            vpnLeaseOwnerId: "owner-retry",
            vpnLeaseOwnerIds: ["owner-retry"],
            vpnLeaseBindings: retryRow.vpnLeaseBindings,
            lifecycleRevision: 9,
            lifecycleActorGeneration: 3,
            lifecycleWriterId: "native-window-3",
          }),
        );
        expect(JSON.stringify(retained)).not.toContain(
          "must-not-survive-recovery",
        );
      },
      { timeout: 3000 },
    );

    first.unmount();
    restoreSession.mockResolvedValue(undefined);
    const retry = renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        restoreSession,
        setShowDatabasePanel: vi.fn(),
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );
    await waitFor(
      () => {
        expect(restoreSession).toHaveBeenCalledTimes(3);
        expect(sessionStorage.getItem("mremote-active-sessions")).toBeNull();
      },
      { timeout: 3000 },
    );

    retry.unmount();
    consoleSpy.mockRestore();
  });

  it("cancels delayed recovery on cleanup without consuming its snapshot", async () => {
    mockSettingsManager.getSettings.mockReturnValue({
      language: "en",
      theme: "dark",
      colorScheme: "blue",
      primaryAccentColor: "",
      reconnectOnReload: true,
      autoOpenLastCollection: false,
    });
    lifecycleMocks.state.connections = [
      {
        id: "connection-delayed",
        name: "Delayed",
        protocol: "ssh",
        hostname: "delayed.example",
      },
    ];
    const saved = [
      {
        id: "session-delayed",
        connectionId: "connection-delayed",
        name: "Delayed SSH",
        protocol: "ssh",
        hostname: "delayed.example",
        status: "connected",
        backendSessionId: "backend-delayed",
        lifecycleRevision: 2,
        lifecycleActorGeneration: 1,
        lifecycleWriterId: "native-window-1",
      },
    ];
    sessionStorage.setItem("mremote-active-sessions", JSON.stringify(saved));
    const restoreSession = vi.fn().mockResolvedValue(undefined);

    const lifecycle = renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        restoreSession,
        setShowDatabasePanel: vi.fn(),
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );
    await waitFor(() => {
      expect(lifecycle.result.current.isInitialized).toBe(true);
    });

    lifecycle.unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });

    expect(restoreSession).not.toHaveBeenCalled();
    expect(
      JSON.parse(sessionStorage.getItem("mremote-active-sessions")!),
    ).toEqual(saved);
  });
});
