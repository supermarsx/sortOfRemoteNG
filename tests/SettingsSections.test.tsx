import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../src/types/settings";
import MacroSettings from "../src/components/SettingsDialog/sections/MacroSettings";
import RecordingSettings from "../src/components/SettingsDialog/sections/RecordingSettings";
import WebBrowserSettings from "../src/components/SettingsDialog/sections/WebBrowserSettings";

vi.mock("../src/utils/macroService", () => ({
  loadMacros: vi.fn().mockResolvedValue([{ id: "m1" }]),
  loadRecordings: vi.fn().mockResolvedValue([]),
  loadRdpRecordings: vi.fn().mockResolvedValue([{ id: "r1", sizeBytes: 1024 }]),
  loadWebRecordings: vi.fn().mockResolvedValue([]),
  loadWebVideoRecordings: vi.fn().mockResolvedValue([]),
}));

const baseSettings = {
  macros: {
    defaultStepDelayMs: 200,
    confirmBeforeReplay: true,
    maxMacroSteps: 100,
  },
  recording: {
    enabled: true,
    autoRecordSessions: false,
    recordInput: false,
    maxRecordingDurationMinutes: 0,
    maxStoredRecordings: 50,
    defaultExportFormat: "asciicast",
  },
  rdpRecording: {
    enabled: true,
    autoRecordRdpSessions: false,
    autoSaveToLibrary: false,
    defaultVideoFormat: "webm",
    recordingFps: 30,
    videoBitrateMbps: 5,
    maxRdpRecordingDurationMinutes: 0,
    maxStoredRdpRecordings: 20,
  },
  webRecording: {
    enabled: true,
    autoRecordWebSessions: false,
    recordHeaders: true,
    maxWebRecordingDurationMinutes: 0,
    maxStoredWebRecordings: 50,
    defaultExportFormat: "har",
  },
  proxyKeepaliveEnabled: true,
  proxyKeepaliveIntervalSeconds: 10,
  proxyAutoRestart: true,
  proxyMaxAutoRestarts: 3,
  confirmDeleteAllBookmarks: true,
} as unknown as GlobalSettings;

describe("Settings sections centralization", () => {
  it("uses centralized input/checkbox classes in MacroSettings and updates values", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <MacroSettings settings={baseSettings} updateSettings={updateSettings} />,
    );

    const maxStepsInput = container.querySelector(
      '[data-setting-key="macros.maxMacroSteps"] input[type="number"]',
    ) as HTMLInputElement;
    expect(maxStepsInput.className).toContain("sor-settings-input");

    fireEvent.change(maxStepsInput, { target: { value: "120" } });
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        macros: expect.objectContaining({ maxMacroSteps: 120 }),
      }),
    );

    const confirmToggle = container.querySelector(
      '[data-setting-key="macros.confirmBeforeReplay"] input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(confirmToggle.className).toContain("sor-settings-checkbox");
  });

  it("uses centralized form classes in RecordingSettings", () => {
    const updateSettings = vi.fn();
    const { container } = render(
      <RecordingSettings
        settings={baseSettings}
        updateSettings={updateSettings}
      />,
    );

    const durationInput = container.querySelector(
      '[data-setting-key="recording.maxRecordingDurationMinutes"] input[type="number"]',
    ) as HTMLInputElement;
    expect(durationInput.className).toContain("sor-settings-input");

    const formatSelect = container.querySelector(
      '[data-setting-key="recording.defaultExportFormat"] select',
    ) as HTMLSelectElement;
    expect(formatSelect.className).toContain("sor-settings-select");

    const enabledToggle = container.querySelector(
      '[data-setting-key="webRecording.enabled"] input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(enabledToggle.className).toContain("sor-settings-checkbox");
  });

  it("uses centralized tile/input classes in WebBrowserSettings", () => {
    const updateSettings = vi.fn();
    const disabledSettings = {
      ...baseSettings,
      proxyKeepaliveEnabled: false,
      proxyAutoRestart: false,
    } as GlobalSettings;
    const { container } = render(
      <WebBrowserSettings
        settings={disabledSettings}
        updateSettings={updateSettings}
      />,
    );

    const intervalRow = screen
      .getByText("Health-check interval")
      .closest(".sor-settings-tile");
    expect(intervalRow).toHaveClass("sor-settings-tile-disabled");

    const numberInput = container.querySelector(
      'input[value="10"]',
    ) as HTMLInputElement;
    expect(numberInput.className).toContain("sor-settings-input");

    const healthToggle = screen.getByRole("checkbox", {
      name: /enable proxy health checks/i,
    });
    fireEvent.click(healthToggle);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ proxyKeepaliveEnabled: true }),
    );
  });
});
