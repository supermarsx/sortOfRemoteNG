import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type {
  AvailableUpdate,
  UpdaterSettings,
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

import { UpdaterPanel } from "../../src/components/updater/UpdaterPanel";

// Updater transport values are machine-only SemVer; rendered copy remains YY.N.
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

const update: AvailableUpdate = {
  currentVersion: "25.5.0",
  version: "25.6.0",
  date: "2026-03-30T00:00:00Z",
  body: "Bug fixes and improvements",
  target: "x86_64-pc-windows-msvc",
  downloadUrl: "https://example.test/update-25.6.0.msi",
  signaturePresent: true,
  rawJson: {},
};

const idleStatus: UpdaterStatusSnapshot = {
  status: "idle",
  currentVersion: "25.5.0",
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

const availableStatus: UpdaterStatusSnapshot = {
  ...idleStatus,
  status: "available",
  availableUpdate: update,
  lastCheckedAt: "2026-03-30T12:00:00Z",
};

describe("UpdaterPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(settings);
        case "updater_get_status":
          return Promise.resolve(idleStatus);
        case "updater_check":
          return Promise.resolve({
            updateAvailable: true,
            availableUpdate: update,
            status: availableStatus,
          });
        case "updater_save_settings":
          return Promise.resolve(settings);
        case "updater_download_and_install":
          return Promise.resolve({
            ...availableStatus,
            status: "restart_required",
            progressPercent: 100,
          });
        default:
          return Promise.resolve(undefined);
      }
    });
  });

  it("renders the backend-backed Settings updater section", async () => {
    render(<UpdaterPanel />);

    expect(screen.getByTestId("settings-updater-section")).toBeInTheDocument();
    expect(screen.getByTestId("updater-check-btn")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Current version/i)).toBeInTheDocument();
    });
  });

  it("checks and installs through the new command contract", async () => {
    render(<UpdaterPanel />);

    const checkButton = await screen.findByTestId("updater-check-btn");
    await waitFor(() => expect(checkButton).not.toBeDisabled());
    fireEvent.click(checkButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_check", { force: true });
      expect(screen.getByTestId("updater-install-btn")).toBeInTheDocument();
      expect(screen.getByTestId("updater-current-version")).toHaveTextContent(
        "Current version: 25.5",
      );
      expect(screen.getByTestId("updater-available-version")).toHaveTextContent(
        "New version available: 25.6",
      );
      expect(screen.getByTestId("updater-current-version")).not.toHaveTextContent(
        "25.5.0",
      );
      expect(screen.getByTestId("updater-available-version")).not.toHaveTextContent(
        "25.6.0",
      );
    });

    fireEvent.click(screen.getByTestId("updater-install-btn"));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_download_and_install", {
        version: "25.6.0",
      });
    });
  });

  it("does not expose retired channel, history, or rollback UI", () => {
    render(<UpdaterPanel />);

    expect(screen.queryByText(/Update channel/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Update history/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Rollback/i)).not.toBeInTheDocument();
  });
});
