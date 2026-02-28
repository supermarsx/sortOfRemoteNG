import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../src/types/settings";
import GeneralSettings from "../src/components/SettingsDialog/sections/GeneralSettings";
import BackendSettings from "../src/components/SettingsDialog/sections/BackendSettings";
import RdpDefaultSettings from "../src/components/SettingsDialog/sections/RdpDefaultSettings";

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
    tlsMinVersion: "1.2",
    certValidationMode: "tofu",
    allowedCipherSuites: [],
    enableInternalApi: true,
    internalApiPort: 9876,
    internalApiAuth: true,
    internalApiCors: false,
    internalApiRateLimit: 100,
    internalApiSsl: false,
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
      '[data-setting-key="language"] select',
    ) as HTMLSelectElement;
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
    ).toBeGreaterThanOrEqual(6);

    const numericInput = container.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    expect(numericInput.className).toContain("sor-settings-input");

    const authCheckbox = container.querySelector(
      'input[type="checkbox"][class*="sor-settings-checkbox"]',
    ) as HTMLInputElement;
    expect(authCheckbox).toBeTruthy();
  });

  it("uses centralized cards/selects/checkboxes in RdpDefaultSettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <RdpDefaultSettings
        settings={baseSettings}
        updateSettings={updateSettings}
      />,
    );

    expect(
      container.querySelectorAll(".sor-settings-card").length,
    ).toBeGreaterThanOrEqual(8);

    const firstSelect = container.querySelector("select") as HTMLSelectElement;
    expect(firstSelect.className).toContain("sor-settings-select");

    const thumbnailCheckbox = container.querySelector(
      'input[type="checkbox"][class*="sor-settings-checkbox"]',
    ) as HTMLInputElement;
    expect(thumbnailCheckbox).toBeTruthy();

    fireEvent.click(thumbnailCheckbox);
    expect(updateSettings).toHaveBeenCalled();
  });
});
