import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type {
  AvailableUpdate,
  UpdaterInstallMode,
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
  installMode: "nsis",
  selfUpdateSupported: true,
  selfUpdateMessage: null,
  privateEndpointEnabled: false,
  privateEndpointUrl: null,
  publicEndpointUrl: "https://github.example/latest.json",
  endpointMode: "public_only",
  resolvedEndpoints: [
    { source: "public", url: "https://github.example/latest.json" },
  ],
  dynamicPluginEndpointsSupported: true,
  dynamicPluginEndpointsMessage: null,
  privateEndpointValidationError: null,
};

const idleStatus: UpdaterStatusSnapshot = {
  status: "idle",
  currentVersion: "25.5.0",
  installMode: "nsis",
  selfUpdateSupported: true,
  selfUpdateMessage: null,
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

const availableUpdate: AvailableUpdate = {
  currentVersion: "25.5.0",
  version: "25.6.0",
  date: null,
  body: null,
  target: "windows-x86_64-msi",
  downloadUrl:
    "https://github.example/releases/download/25.6.0/sortOfRemoteNG_25.6.0_windows-x86_64.msi",
  signaturePresent: true,
  rawJson: {},
};

/**
 * Wires the mocked backend to report a self-updating install of `installMode`
 * that has an update waiting, so the install controls are live.
 */
function mockUpdateAvailableFor(installMode: UpdaterInstallMode): void {
  const modeSettings: UpdaterSettings = { ...settings, installMode };
  const modeStatus: UpdaterStatusSnapshot = {
    ...idleStatus,
    installMode,
    status: "available",
    availableUpdate: {
      ...availableUpdate,
      target: `windows-x86_64${installMode === "msi" ? "-msi" : ""}`,
    },
  };
  mockInvoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "updater_get_settings":
        return Promise.resolve(modeSettings);
      case "updater_get_status":
        return Promise.resolve(modeStatus);
      default:
        return Promise.resolve(modeStatus);
    }
  });
}

describe("UpdaterSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(
      (cmd: string, args?: { patch?: UpdaterSettingsPatch }) => {
        switch (cmd) {
          case "updater_get_settings":
            return Promise.resolve(settings);
          case "updater_get_status":
            return Promise.resolve(idleStatus);
          case "updater_save_settings":
            return Promise.resolve({ ...settings, ...args?.patch });
          default:
            return Promise.resolve({
              updateAvailable: false,
              availableUpdate: null,
              status: idleStatus,
            });
        }
      },
    );
  });

  it("saves auto-check and interval settings", async () => {
    render(<UpdaterSettingsSection />);

    const toggle = await screen.findByTestId("updater-auto-check-toggle");
    const interval = screen.getByTestId("updater-check-interval");
    await waitFor(() => {
      expect(toggle).not.toBeDisabled();
      expect(interval).not.toBeDisabled();
    });

    fireEvent.change(interval, { target: { value: "6" } });
    await waitFor(() => expect(interval).toHaveValue(6));
    fireEvent.blur(interval);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_save_settings", {
        patch: { checkIntervalHours: 6 },
      });
    });
    await waitFor(() => {
      expect(interval).toHaveValue(6);
      expect(toggle).not.toBeDisabled();
    });

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_save_settings", {
        patch: { autoCheckEnabled: false },
      });
      expect(toggle).not.toBeChecked();
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

    expect(
      screen.queryByTestId("updater-save-interval-btn"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("updater-private-endpoint-save-btn"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("updater-private-endpoint-clear-btn"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("updater-reset-defaults-btn"),
    ).toBeInTheDocument();
  });

  it("uses standard updater field label/input groups without extra left margin", async () => {
    render(<UpdaterSettingsSection />);

    const intervalInput = await screen.findByTestId("updater-check-interval");
    const intervalField = intervalInput.parentElement;
    expect(intervalField?.className).not.toContain("ml-7");
    expect(
      intervalField?.querySelector(".sor-settings-row-label"),
    ).not.toBeNull();
    expect(
      intervalField?.querySelector(".sor-settings-row-label svg"),
    ).not.toBeNull();

    const endpointToggle = screen.getByTestId(
      "updater-private-endpoint-toggle",
    );
    await waitFor(() => expect(endpointToggle).not.toBeDisabled());
    fireEvent.click(endpointToggle);

    const endpointInput = screen.getByTestId("updater-private-endpoint-input");
    await waitFor(() => expect(endpointInput).not.toBeDisabled());
    const endpointField = endpointInput.parentElement;
    expect(endpointField?.className).not.toContain("ml-7");
    expect(
      endpointField?.querySelector(".sor-settings-row-label"),
    ).not.toBeNull();
    expect(
      endpointField?.querySelector(".sor-settings-row-label svg"),
    ).not.toBeNull();
    expect(document.querySelectorAll(".sor-settings-toggle-row")).toHaveLength(
      2,
    );
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

  it("warns an MSI install that the update needs admin approval and closes the app", async () => {
    mockUpdateAvailableFor("msi");
    render(<UpdaterSettingsSection />);

    const notice = await screen.findByTestId("updater-msi-elevation-notice");
    expect(notice).toHaveTextContent("Administrator approval required");
    // The three facts the user cannot discover on their own: UAC, the app
    // exiting, and what declining the prompt leaves behind.
    expect(notice).toHaveTextContent(/administrator approval/i);
    expect(notice).toHaveTextContent(/sortOfRemoteNG closes/i);
    expect(notice).toHaveTextContent(/reopens itself/i);
    expect(notice).toHaveTextContent(
      /decline the prompt, nothing is installed/i,
    );
    // Advisory only - it must not gate the install action.
    expect(screen.getByTestId("updater-install-btn")).not.toBeDisabled();
  });

  it.each(["nsis", "appimage"] as const)(
    "shows no MSI elevation notice for a %s install",
    async (installMode) => {
      mockUpdateAvailableFor(installMode);
      render(<UpdaterSettingsSection />);

      await screen.findByTestId("updater-install-btn");
      expect(
        screen.queryByTestId("updater-msi-elevation-notice"),
      ).not.toBeInTheDocument();
    },
  );

  it("shows an unsigned release as a manual download without install controls", async () => {
    const unsignedUpdate: AvailableUpdate = {
      ...availableUpdate,
      signaturePresent: false,
    };
    const unsignedStatus: UpdaterStatusSnapshot = {
      ...idleStatus,
      installMode: "msi",
      status: "available",
      availableUpdate: unsignedUpdate,
    };
    const msiSettings: UpdaterSettings = { ...settings, installMode: "msi" };
    mockInvoke.mockImplementation((cmd: string) =>
      Promise.resolve(
        cmd === "updater_get_settings" ? msiSettings : unsignedStatus,
      ),
    );

    render(<UpdaterSettingsSection />);

    const notice = await screen.findByTestId("updater-unsigned-notice");
    expect(notice).toHaveTextContent("Manual download required");
    expect(notice).toHaveTextContent(/no updater signature/i);
    expect(notice).toHaveTextContent(/install it manually/i);
    expect(
      screen.getByRole("link", { name: /Download manually/i }),
    ).toHaveAttribute("href", unsignedUpdate.downloadUrl);
    expect(screen.queryByTestId("updater-install-btn")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("updater-msi-elevation-notice"),
    ).not.toBeInTheDocument();
  });

  it("shows no MSI elevation notice while an MSI install has no update waiting", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      const modeSettings: UpdaterSettings = { ...settings, installMode: "msi" };
      const modeStatus: UpdaterStatusSnapshot = {
        ...idleStatus,
        installMode: "msi",
      };
      return Promise.resolve(
        cmd === "updater_get_settings" ? modeSettings : modeStatus,
      );
    });
    render(<UpdaterSettingsSection />);

    await screen.findByTestId("updater-check-btn");
    expect(
      screen.queryByTestId("updater-msi-elevation-notice"),
    ).not.toBeInTheDocument();
  });

  it("treats a supported MSI install as self-updating rather than externally managed", async () => {
    mockUpdateAvailableFor("msi");
    render(<UpdaterSettingsSection />);

    await screen.findByTestId("settings-updater-section");
    expect(
      screen.queryByTestId("updater-self-update-notice"),
    ).not.toBeInTheDocument();

    const toggle = await screen.findByTestId("updater-auto-check-toggle");
    const interval = screen.getByTestId("updater-check-interval");
    await waitFor(() => {
      expect(toggle).not.toBeDisabled();
      expect(interval).not.toBeDisabled();
      expect(screen.getByTestId("updater-install-btn")).not.toBeDisabled();
    });
    expect(
      screen.queryByText(
        "Automatic checks are unavailable for externally managed installations.",
      ),
    ).not.toBeInTheDocument();
  });
});
