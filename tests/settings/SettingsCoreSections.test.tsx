import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../../src/types/settings/settings";
import GeneralSettings from "../../src/components/SettingsDialog/sections/GeneralSettings";
import BackendSettings from "../../src/components/SettingsDialog/sections/BackendSettings";
import RDPDefaultSettings from "../../src/components/SettingsDialog/sections/RdpDefaultSettings";

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

    const languageSelect = container.querySelector(
      '[data-setting-key="language"] [role="combobox"]',
    ) as HTMLElement;
    expect(languageSelect.className).toContain("sor-settings-select");

    const autosaveToggle = container.querySelector(
      '[data-setting-key="autoSaveEnabled"] input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(autosaveToggle.className).toContain("sor-settings-checkbox");

    fireEvent.click(autosaveToggle);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ autoSaveEnabled: false }),
    );
  });

  it("uses the accent color for GeneralSettings section icons", () => {
    const { container } = render(
      <GeneralSettings
        settings={baseSettings}
        updateSettings={vi.fn()}
      />,
    );

    const sectionIcons = Array.from(
      container.querySelectorAll(".sor-settings-section-header > svg"),
    );

    expect(sectionIcons).toHaveLength(4);
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

    const firstSelect = container.querySelector('[role="combobox"]') as HTMLElement;
    expect(firstSelect.className).toContain("sor-settings-select");

    const thumbnailCheckbox = container.querySelector(
      'input[type="checkbox"][class*="sor-settings-checkbox"]',
    ) as HTMLInputElement;
    expect(thumbnailCheckbox).toBeTruthy();

    fireEvent.click(thumbnailCheckbox);
    expect(updateSettings).toHaveBeenCalled();
  });
});
