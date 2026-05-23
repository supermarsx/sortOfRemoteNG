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
    fireEvent.blur(interval);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_save_settings", {
        patch: { checkIntervalHours: 6 },
      });
    });
  });

  it("uses standard subsection headers with accent-colored icons", async () => {
    const { container } = render(<UpdaterSettingsSection />);

    await screen.findByTestId("settings-updater-section");

    expect(container.querySelector("h3 svg")?.getAttribute("class")).toContain(
      "text-primary",
    );
    expect(container.querySelector(".sor-section-heading")).toBeNull();

    const sectionIcons = Array.from(
      container.querySelectorAll(".sor-settings-section-header > svg"),
    );

    expect(sectionIcons).toHaveLength(3);
    for (const icon of sectionIcons) {
      expect(icon.getAttribute("class")).toContain("text-primary");
    }

    expect(screen.queryByTestId("updater-save-interval-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("updater-private-endpoint-save-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("updater-private-endpoint-clear-btn")).not.toBeInTheDocument();
    expect(screen.getByTestId("updater-reset-defaults-btn")).toBeInTheDocument();
  });

  it("uses standard updater field label/input groups without extra left margin", async () => {
    render(<UpdaterSettingsSection />);

    const intervalInput = await screen.findByTestId("updater-check-interval");
    const intervalField = intervalInput.parentElement;
    expect(intervalField?.className).not.toContain("ml-7");
    expect(intervalField?.querySelector(".sor-settings-row-label")).not.toBeNull();
    expect(intervalField?.querySelector(".sor-settings-row-label svg")).not.toBeNull();

    const endpointToggle = screen.getByTestId("updater-private-endpoint-toggle");
    await waitFor(() => expect(endpointToggle).not.toBeDisabled());
    fireEvent.click(endpointToggle);

    const endpointInput = screen.getByTestId("updater-private-endpoint-input");
    await waitFor(() => expect(endpointInput).not.toBeDisabled());
    const endpointField = endpointInput.parentElement;
    expect(endpointField?.className).not.toContain("ml-7");
    expect(endpointField?.querySelector(".sor-settings-row-label")).not.toBeNull();
    expect(endpointField?.querySelector(".sor-settings-row-label svg")).not.toBeNull();
    expect(document.querySelectorAll(".sor-settings-toggle-row")).toHaveLength(2);
  });

  it("saves the private endpoint on blur and resets updater defaults from the footer", async () => {
    render(<UpdaterSettingsSection />);

    const toggle = await screen.findByTestId("updater-private-endpoint-toggle");
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
    const input = screen.getByTestId("updater-private-endpoint-input");
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, {
      target: { value: "https://updates.example.com/latest.json" },
    });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_save_settings", {
        patch: {
          privateEndpointEnabled: true,
          privateEndpointUrl: "https://updates.example.com/latest.json",
        },
      });
    });

    fireEvent.click(screen.getByTestId("updater-reset-defaults-btn"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_save_settings", {
        patch: {
          autoCheckEnabled: true,
          checkIntervalHours: 24,
          privateEndpointEnabled: false,
          privateEndpointUrl: "",
        },
      });
    });
  });
});
