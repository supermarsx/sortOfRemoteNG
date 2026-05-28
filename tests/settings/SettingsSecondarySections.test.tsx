import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../../src/types/settings/settings";
import PerformanceSettings from "../../src/components/SettingsDialog/sections/PerformanceSettings";
import ThemeSettings from "../../src/components/SettingsDialog/sections/ThemeSettings";
import ProxySettings from "../../src/components/SettingsDialog/sections/ProxySettings";
import StartupSettings from "../../src/components/SettingsDialog/sections/StartupSettings";

// ── Mocks to prevent OOM from transitive dependency graph ──

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

vi.mock("../../src/utils/settings/themeManager", () => {
  const inst = {
    applyTheme: vi.fn(),
    getCurrentTheme: vi.fn().mockReturnValue("dark"),
    getCurrentColorScheme: vi.fn().mockReturnValue("blue"),
    getAvailableThemes: vi.fn().mockReturnValue(["dark", "light"]),
    getAvailableColorSchemes: vi.fn().mockReturnValue(["blue", "red"]),
    getColorSchemeConfig: vi.fn().mockReturnValue({ primary: "#3b82f6" }),
  };
  return {
    ThemeManager: { getInstance: () => inst },
  };
});

const baseSettings = {
  retryAttempts: 3,
  retryDelay: 5000,
  enablePerformanceTracking: true,
  performancePollIntervalMs: 5000,
  performanceLatencyTarget: "1.1.1.1",
  enableStatusChecking: true,
  statusCheckInterval: 60,
  statusCheckMethod: "socket",
  enableActionLog: true,
  maxLogEntries: 1000,
  theme: "dark",
  colorScheme: "blue",
  primaryAccentColor: "#3b82f6",
  backgroundGlowEnabled: true,
  backgroundGlowFollowsColorScheme: true,
  backgroundGlowColor: "#2563eb",
  backgroundGlowOpacity: 0.3,
  backgroundGlowRadius: 600,
  backgroundGlowBlur: 120,
  windowTransparencyEnabled: true,
  windowTransparencyOpacity: 0.9,
  showTransparencyToggle: true,
  animationsEnabled: true,
  reduceMotion: false,
  animationDuration: 200,
  customCss: "body { color: red; }",
  globalProxy: {
    enabled: true,
    type: "http",
    host: "proxy.local",
    port: 8080,
    username: "",
    password: "",
  },
  startWithSystem: false,
  startMinimized: false,
  startMaximized: false,
  reconnectPreviousSessions: true,
  autoOpenLastCollection: true,
  showTrayIcon: true,
  minimizeToTray: false,
  closeToTray: false,
  hideQuickStartMessage: false,
  hideQuickStartButtons: false,
  welcomeScreenTitle: "Hello",
  welcomeScreenMessage: "Welcome",
} as unknown as GlobalSettings;

describe("Secondary settings section centralization", () => {
  it("uses centralized card/input/checkbox classes in PerformanceSettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <PerformanceSettings
        settings={baseSettings}
        updateSettings={updateSettings}
      />,
    );

    expect(container.querySelectorAll(".sor-settings-card").length).toBe(4);
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

    // Performance Tracking / Action Logging toggles use the shared
    // Toggle primitive (label + description + sor-settings-toggle-icon
    // wrapper, no per-row hover-tint).
    const performanceTrackingRow = screen
      .getByText("Enable Performance Tracking")
      .closest("label");
    expect(
      performanceTrackingRow?.querySelector(".sor-settings-toggle-icon"),
    ).not.toBeNull();

    const actionLoggingRow = screen
      .getByText("Enable Action Logging")
      .closest("label");
    expect(
      actionLoggingRow?.querySelector(".sor-settings-toggle-icon"),
    ).not.toBeNull();
    expect(
      container.querySelector('input[type="number"]')?.className,
    ).toContain("sor-settings-input");
    expect(
      container.querySelector('input[type="checkbox"]')?.className,
    ).toContain("sor-settings-checkbox");

    const maxLogEntriesInput = container.querySelector(
      'input[value="1000"]',
    ) as HTMLInputElement;
    fireEvent.change(maxLogEntriesInput, { target: { value: "1200" } });
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ maxLogEntries: 1200 }),
    );
  });

  it("uses centralized form/range/checkbox classes in ThemeSettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <ThemeSettings settings={baseSettings} updateSettings={updateSettings} />,
    );

    // ThemeSettings now has more cards after package upgrades (theme, color scheme, glow, transparency, animations, custom CSS, etc.)
    expect(container.querySelectorAll(".sor-settings-card").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('[role="combobox"]')?.className).toContain(
      "sor-settings-select",
    );
    expect(
      container.querySelector('input[type="checkbox"]')?.className,
    ).toContain("sor-settings-checkbox");
    expect(container.querySelector('input[type="range"]')?.className).toContain(
      "sor-settings-range",
    );
  });

  it("uses standard section headers with accent-colored icons in ThemeSettings", () => {
    const { container } = render(
      <ThemeSettings settings={baseSettings} updateSettings={vi.fn()} />,
    );

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
  });

  it("uses centralized card/input/checkbox classes in ProxySettings", () => {
    const updateProxy = vi.fn();
    const updateSettings = vi.fn();
    const { container } = render(
      <ProxySettings
        settings={baseSettings}
        updateProxy={updateProxy}
        updateSettings={updateSettings}
      />,
    );

    // Enable Proxy + Proxy Type + Connection Details + Authentication + Presets
    expect(container.querySelectorAll(".sor-settings-card").length).toBe(5);
    expect(
      container.querySelector('input[type="checkbox"]')?.className,
    ).toContain("sor-settings-checkbox");

    const hostInput = container.querySelector(
      'input[placeholder="proxy.example.com"]',
    ) as HTMLInputElement;
    expect(hostInput.className).toContain("sor-settings-input");
    fireEvent.change(hostInput, { target: { value: "corp.proxy" } });
    expect(updateProxy).toHaveBeenCalledWith(
      expect.objectContaining({ host: "corp.proxy" }),
    );
  });

  it("uses centralized card/input/checkbox classes in StartupSettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <StartupSettings
        settings={baseSettings}
        updateSettings={updateSettings}
      />,
    );

    expect(container.querySelectorAll(".sor-settings-card").length).toBe(3);
    expect(
      container.querySelector('input[type="checkbox"]')?.className,
    ).toContain("sor-settings-checkbox");

    const customTitleInput = container.querySelector(
      'input[value="Hello"]',
    ) as HTMLInputElement;
    expect(customTitleInput.className).toContain("sor-settings-input");

    const startMinimizedCheckbox = screen.getByRole("checkbox", {
      name: /start minimized/i,
    });
    fireEvent.click(startMinimizedCheckbox);
    expect(updateSettings).toHaveBeenCalled();
  });

  it("uses the accent color for StartupSettings heading and subsection icons", () => {
    const { container } = render(
      <StartupSettings
        settings={baseSettings}
        updateSettings={vi.fn()}
      />,
    );

    expect(container.querySelector("h3 svg")?.getAttribute("class")).toContain(
      "text-primary",
    );

    const sectionIcons = Array.from(
      container.querySelectorAll(".sor-settings-section-header > svg"),
    );

    expect(sectionIcons).toHaveLength(3);
    for (const icon of sectionIcons) {
      expect(icon.getAttribute("class")).toContain("text-primary");
    }
  });
});
