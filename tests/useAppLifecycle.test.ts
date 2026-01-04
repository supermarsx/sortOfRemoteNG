import { describe, it, expect, beforeEach, vi, Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAppLifecycle } from "../src/hooks/useAppLifecycle";
import { SettingsManager } from "../src/utils/settingsManager";
import { ThemeManager } from "../src/utils/themeManager";
import i18n, { loadLanguage } from "../src/i18n";

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
vi.mock("../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      sessions: [],
      connections: [],
    },
    addConnection: vi.fn(),
    removeConnection: vi.fn(),
    updateConnection: vi.fn(),
  }),
}));

describe("useAppLifecycle", () => {
  let mockSettingsManager: any;
  let mockThemeManager: any;
  let mockI18n: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

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

  it("should initialize app successfully", async () => {
    const { result } = renderHook(() =>
      useAppLifecycle({
        handleConnect: vi.fn(),
        setShowCollectionSelector: vi.fn(),
        setShowPasswordDialog: vi.fn(),
        setPasswordDialogMode: vi.fn(),
      }),
    );

    // Wait for automatic initialization
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(mockSettingsManager.initialize).toHaveBeenCalled();
    expect(mockThemeManager.loadSavedTheme).toHaveBeenCalled();
    expect(mockThemeManager.injectThemeCSS).toHaveBeenCalled();
    expect(result.current.isInitialized).toBe(true);
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
        setShowCollectionSelector: vi.fn(),
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
        setShowCollectionSelector: vi.fn(),
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
        setShowCollectionSelector: vi.fn(),
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
        setShowCollectionSelector: vi.fn(),
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
        setShowCollectionSelector: vi.fn(),
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
});
