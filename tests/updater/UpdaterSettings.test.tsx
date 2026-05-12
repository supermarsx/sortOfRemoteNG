import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type {
  UpdaterSettings,
  UpdaterSettingsPatch,
  UpdaterStatusSnapshot,
} from "../../src/types/updater/updater";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : _key,
  }),
}));

import UpdaterSettingsSection from "../../src/components/SettingsDialog/sections/UpdaterSettings";

const settings: UpdaterSettings = {
  autoCheckEnabled: true,
  checkIntervalHours: 24,
  privateEndpointEnabled: false,
  privateEndpointUrl: null,
  publicEndpointUrl: "https://github.example/latest.json",
  endpointMode: "public_only",
  resolvedEndpoints: [{ source: "public", url: "https://github.example/latest.json" }],
  dynamicPluginEndpointsSupported: true,
  dynamicPluginEndpointsMessage: null,
  privateEndpointValidationError: null,
};

const idleStatus: UpdaterStatusSnapshot = {
  status: "idle",
  currentVersion: "1.5.0",
  availableUpdate: null,
  lastCheckedAt: null,
  lastError: null,
  endpointMode: "public_only",
  endpointSource: "public",
  resolvedEndpoints: settings.resolvedEndpoints,
  dynamicPluginEndpointsSupported: true,
  dynamicPluginEndpointsMessage: null,
  privateEndpointValidationError: null,
  downloadedBytes: 0,
  totalBytes: null,
  progressPercent: null,
};

describe("UpdaterSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string, args?: { patch?: UpdaterSettingsPatch }) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(settings);
        case "updater_get_status":
          return Promise.resolve(idleStatus);
        case "updater_save_settings":
          return Promise.resolve({ ...settings, ...args?.patch });
        default:
          return Promise.resolve({ updateAvailable: false, availableUpdate: null, status: idleStatus });
      }
    });
  });

  it("saves auto-check and interval settings", async () => {
    render(<UpdaterSettingsSection />);

    const toggle = await screen.findByTestId("updater-auto-check-toggle");
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_save_settings", {
        patch: { autoCheckEnabled: false },
      });
    });

    const interval = screen.getByTestId("updater-check-interval");
    fireEvent.change(interval, { target: { value: "6" } });
    fireEvent.click(screen.getByTestId("updater-save-interval-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_save_settings", {
        patch: { checkIntervalHours: 6 },
      });
    });
  });

  it("saves and clears the private endpoint through backend settings", async () => {
    render(<UpdaterSettingsSection />);

    const toggle = await screen.findByTestId("updater-private-endpoint-toggle");
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
    const input = screen.getByTestId("updater-private-endpoint-input");
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, {
      target: { value: "https://updates.example.com/latest.json" },
    });
    fireEvent.click(screen.getByTestId("updater-private-endpoint-save-btn"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_save_settings", {
        patch: {
          privateEndpointEnabled: true,
          privateEndpointUrl: "https://updates.example.com/latest.json",
        },
      });
    });

    fireEvent.click(screen.getByTestId("updater-private-endpoint-clear-btn"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_save_settings", {
        patch: { privateEndpointEnabled: false, privateEndpointUrl: "" },
      });
    });
  });
});