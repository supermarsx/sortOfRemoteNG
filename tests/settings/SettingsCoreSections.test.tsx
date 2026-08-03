import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../../src/types/settings/settings";
import GeneralSettings from "../../src/components/SettingsDialog/sections/GeneralSettings";
import LanguageSettings from "../../src/components/SettingsDialog/sections/LanguageSettings";
import BackendSettings from "../../src/components/SettingsDialog/sections/BackendSettings";
import RDPDefaultSettings from "../../src/components/SettingsDialog/sections/RdpDefaultSettings";
import ThemeSettings from "../../src/components/SettingsDialog/sections/ThemeSettings";

const { themeT } = vi.hoisted(() => ({
  themeT: vi.fn((key: string, fallback?: string) => fallback ?? key),
}));

vi.mock("../../src/hooks/settings/useThemeSettings", () => ({
  formatLabel: (value: string) => value,
  useThemeSettings: () => ({
    t: themeT,
    themes: ["dark"],
    schemeOptions: [{ value: "blue", label: "Blue", color: "#2563eb" }],
    handleSchemeChange: vi.fn(),
    handleToggleCustomAccent: vi.fn(),
    handleAccentChange: vi.fn(),
    opacityValue: 0.9,
    cssHighlightRef: { current: null },
    highlightedCss: "",
    handleCssScroll: vi.fn(),
  }),
}));

vi.mock(
  "../../src/components/SettingsDialog/sections/theme/LoadingElementSection",
  () => ({ LoadingElementSection: () => null }),
);

const baseSettings = {
  language: "en",
  connectionTimeout: 30,
  autoSaveEnabled: true,
  autoSaveIntervalMinutes: 5,
  warnOnClose: true,
  warnOnDetachClose: true,
  warnOnExit: false,
  confirmMainAppClose: true,
  quickConnectHistoryEnabled: true,
  quickConnectHistory: ["https://example.test"],
  rdpSessionDisplayMode: "popup",
  rdpSessionClosePolicy: "ask",
  rdpSessionThumbnailsEnabled: true,
  rdpSessionThumbnailPolicy: "realtime",
  rdpSessionThumbnailInterval: 5,
  rdpDefaults: {
    enableTls: true,
    enableNla: true,
    useCredSsp: true,
    defaultWidth: 1920,
    defaultHeight: 1080,
  },
  backendConfig: {
    logLevel: "info",
    maxConcurrentRdpSessions: 10,
    rdpServerRenderer: "auto",
    rdpCodecPreference: "auto",
    tcpDefaultBufferSize: 65536,
    tcpKeepAliveSeconds: 30,
    connectionTimeoutSeconds: 15,
    tempFileCleanupEnabled: true,
    tempFileCleanupIntervalMinutes: 60,
    cacheSizeMb: 256,
    allowedCipherSuites: [],
  },
} as unknown as GlobalSettings;

describe("Core settings section centralization", () => {
  it("uses centralized controls in GeneralSettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <GeneralSettings
        settings={baseSettings}
        updateSettings={updateSettings}
      />,
    );

    const autosaveToggle = container.querySelector(
      '[data-setting-key="autoSaveEnabled"] input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(autosaveToggle.className).toContain("sor-settings-checkbox");

    fireEvent.click(autosaveToggle);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ autoSaveEnabled: false }),
    );
  });

  it("uses centralized controls in LanguageSettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <LanguageSettings
        settings={baseSettings}
        updateSettings={updateSettings}
      />,
    );

    const languageSelect = container.querySelector(
      '[data-setting-key="language"] [role="combobox"]',
    ) as HTMLElement;
    expect(languageSelect.className).toContain("sor-settings-select");
    fireEvent.click(languageSelect);
    const languageOptions = within(screen.getByRole("listbox"));
    expect(
      languageOptions.getByRole("option", { name: "English (Leetspeak)" }),
    ).toBeInTheDocument();
    fireEvent.mouseDown(
      languageOptions.getByRole("option", { name: "English (Pirate)" }),
    );
    expect(updateSettings).toHaveBeenCalledWith({ language: "en-x-pirate" });
    expect(
      screen.getByLabelText(
        "Choose the display language for the application interface. Changes apply immediately.",
      ),
    ).toBeInTheDocument();

    const autoDetectToggle = container.querySelector(
      '[data-setting-key="autoDetectOsLanguage"] input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(autoDetectToggle.className).toContain("sor-settings-checkbox");

    fireEvent.click(autoDetectToggle);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ autoDetectOsLanguage: true }),
    );
  });

  it("uses the accent color for GeneralSettings section icons", () => {
    const { container } = render(
      <GeneralSettings settings={baseSettings} updateSettings={vi.fn()} />,
    );

    const sectionIcons = Array.from(
      container.querySelectorAll(".sor-settings-section-header > svg"),
    );

    expect(sectionIcons).toHaveLength(7);
    for (const icon of sectionIcons) {
      expect(icon.getAttribute("class")).toContain("text-primary");
    }
  });

  it("uses centralized cards and form controls in BackendSettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <BackendSettings
        settings={baseSettings}
        updateSettings={updateSettings}
      />,
    );

    expect(
      container.querySelectorAll(".sor-settings-card").length,
    ).toBeGreaterThanOrEqual(4);

    const numericInput = container.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    expect(numericInput.className).toContain("sor-settings-input");

    const authCheckbox = container.querySelector(
      'input[type="checkbox"][class*="sor-settings-checkbox"]',
    ) as HTMLInputElement;
    expect(authCheckbox).toBeTruthy();
  });

  it("uses centralized cards/selects/checkboxes in RDPDefaultSettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <RDPDefaultSettings
        settings={baseSettings}
        updateSettings={updateSettings}
      />,
    );

    expect(container.querySelectorAll(".sor-settings-card")).toHaveLength(13);
    expect(container.querySelector("h3 svg")?.getAttribute("class")).toContain(
      "text-primary",
    );
    expect(container.querySelector(".sor-section-heading")).toBeNull();

    const sectionHeaders = Array.from(
      container.querySelectorAll(".sor-settings-section-header"),
    );
    expect(sectionHeaders).toHaveLength(13);
    for (const header of sectionHeaders) {
      const icon = header.firstElementChild;
      expect(icon?.tagName.toLowerCase()).toBe("svg");
      expect(icon?.getAttribute("class")).toContain("text-primary");
      expect(icon?.getAttribute("class")).not.toMatch(
        /\btext-(error|success|warning|info)\b/,
      );
    }

    const firstSelect = container.querySelector(
      '[role="combobox"]',
    ) as HTMLElement;
    expect(firstSelect.className).toContain("sor-settings-select");

    const thumbnailCheckbox = container.querySelector(
      'input[type="checkbox"][class*="sor-settings-checkbox"]',
    ) as HTMLInputElement;
    expect(thumbnailCheckbox).toBeTruthy();

    fireEvent.click(thumbnailCheckbox);
    expect(updateSettings).toHaveBeenCalled();
  });
  it("routes every ThemeSettings manifest candidate through translation fallbacks", () => {
    themeT.mockClear();
    const settings = {
      ...baseSettings,
      theme: "dark",
      colorScheme: "blue",
      useCustomAccent: false,
      primaryAccentColor: "#2563eb",
      backgroundGlowEnabled: false,
      backgroundGlowFollowsColorScheme: true,
      backgroundGlowColor: "#2563eb",
      backgroundGlowOpacity: 0.4,
      backgroundGlowRadius: 640,
      backgroundGlowBlur: 120,
      windowTransparencyEnabled: false,
      windowTransparencyOpacity: 0.9,
      showTransparencyToggle: false,
      animationsEnabled: true,
      reduceMotion: false,
      enableTabGroupAnimations: true,
      animationDuration: 200,
      customCss: "",
    } as unknown as GlobalSettings;

    render(<ThemeSettings settings={settings} updateSettings={vi.fn()} />);

    const expectedCalls = [
      ["themeSettings.colorScheme", "Color Scheme"],
      ["themeSettings.customAccent", "Custom Accent"],
      [
        "themeSettings.customAccentDescription",
        "Replace the preset scheme with any color you pick",
      ],
      ["themeSettings.accentColor", "Accent Color"],
      ["themeSettings.enableBackgroundGlow", "Enable background glow effect"],
      [
        "themeSettings.enableBackgroundGlowDescription",
        "Add a soft radial glow behind the main content area",
      ],
      ["themeSettings.glowFollowsColorScheme", "Glow follows color scheme"],
      [
        "themeSettings.glowFollowsColorSchemeDescription",
        "Auto-tint the glow to match the selected color scheme",
      ],
      ["themeSettings.glowOpacity", "Glow Opacity"],
      ["themeSettings.glowRadius", "Glow Radius"],
      ["themeSettings.glowBlur", "Glow Blur"],
      [
        "themeSettings.glowDescription",
        "The glow effect appears centered in the main content area for an exquisite visual experience.",
      ],
      ["themeSettings.experimental", "Experimental"],
      [
        "themeSettings.transparencyWarning",
        "Window transparency is experimental and may cause visual artifacts on some platforms or compositors. Disabled by default.",
      ],
      ["themeSettings.enableTransparency", "Enable window transparency"],
      [
        "themeSettings.enableTransparencyDescription",
        "Make the application window semi-transparent so the desktop shows through",
      ],
      ["themeSettings.opacityLevel", "Opacity Level"],
      [
        "themeSettings.showTransparencyToggle",
        "Show transparency toggle in title bar",
      ],
      [
        "themeSettings.showTransparencyToggleDescription",
        "Add a quick-toggle button to the window title bar",
      ],
      [
        "themeSettings.animationsDescription",
        "Master switch for every UI animation and transition",
      ],
      [
        "themeSettings.reduceMotionDescription",
        "Use subtle animations only — better for motion sensitivity",
      ],
      [
        "themeSettings.tabGroupAnimationsDescription",
        "Fade and slide groups as they are added, removed, or filtered",
      ],
      ["themeSettings.customCssPlaceholder", "/* Enter custom CSS rules... */"],
      [
        "themeSettings.customCssDescription",
        "Add custom styles to personalize the application appearance.",
      ],
      ["settings.theme", "Theme"],
      [
        "themeSettings.description",
        "Color scheme, background glow, window transparency, animations, and custom CSS.",
      ],
    ] as const;
    expect(expectedCalls).toHaveLength(26);
    for (const [key, fallback] of expectedCalls) {
      expect(themeT).toHaveBeenCalledWith(key, fallback);
    }
  });
});
