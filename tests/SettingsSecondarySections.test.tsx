import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../src/types/settings";
import PerformanceSettings from "../src/components/SettingsDialog/sections/PerformanceSettings";
import ThemeSettings from "../src/components/SettingsDialog/sections/ThemeSettings";
import ProxySettings from "../src/components/SettingsDialog/sections/ProxySettings";
import StartupSettings from "../src/components/SettingsDialog/sections/StartupSettings";

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

    expect(container.querySelectorAll(".sor-settings-card").length).toBe(3);
    expect(container.querySelector("select")?.className).toContain(
      "sor-settings-select",
    );
    expect(
      container.querySelector('input[type="checkbox"]')?.className,
    ).toContain("sor-settings-checkbox");
    expect(container.querySelector('input[type="range"]')?.className).toContain(
      "sor-settings-range-full",
    );
  });

  it("uses centralized card/input/checkbox classes in ProxySettings", () => {
    const updateProxy = vi.fn();
    const { container } = render(
      <ProxySettings settings={baseSettings} updateProxy={updateProxy} />,
    );

    expect(container.querySelectorAll(".sor-settings-card").length).toBe(3);
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
});
