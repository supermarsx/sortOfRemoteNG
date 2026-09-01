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
    "https://github.com/supermarsx/sortOfRemoteNG/releases/download/25.6/sortOfRemoteNG_25.6.0_windows-x86_64.msi",
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
    expect(interval).toHaveAttribute("min", "1");
    expect(interval).toHaveAttribute("max", "720");

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

  it("persists weekly, monthly, and annual check schedules as exact hours", async () => {
    render(<UpdaterSettingsSection />);

    const schedule = await screen.findByTestId("updater-check-schedule");
    await waitFor(() => expect(schedule).not.toBeDisabled());

    for (const [label, hours] of [
      ["Weekly", 168],
      ["Monthly", 720],
      ["Annually", 8760],
    ] as const) {
      fireEvent.click(schedule);
      fireEvent.mouseDown(await screen.findByRole("option", { name: label }));
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("updater_save_settings", {
          patch: { checkIntervalHours: hours },
        });
        expect(schedule).toHaveTextContent(label);
      });
    }

    expect(
      screen.queryByTestId("updater-check-interval"),
    ).not.toBeInTheDocument();

    fireEvent.click(schedule);
    fireEvent.mouseDown(
      await screen.findByRole("option", { name: "Custom hours" }),
    );
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_save_settings", {
        patch: { checkIntervalHours: 24 },
      });
      expect(screen.getByTestId("updater-check-interval")).toHaveValue(24);
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
    const intervalField = intervalInput.closest(
      '[data-setting-key="updater.checkIntervalHours"]',
    );
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

  it("requires explicit confirmation before invoking the unsigned native installer", async () => {
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
    const installingStatus: UpdaterStatusSnapshot = {
      ...unsignedStatus,
      status: "installing",
    };
    const msiSettings: UpdaterSettings = { ...settings, installMode: "msi" };
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(msiSettings);
        case "updater_get_status":
          return Promise.resolve(unsignedStatus);
        case "updater_install_unsigned":
          return Promise.resolve(installingStatus);
        case "open_url_external":
          return Promise.resolve(undefined);
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    render(<UpdaterSettingsSection />);

    const notice = await screen.findByTestId("updater-unsigned-notice");
    expect(notice).toHaveTextContent("Unsigned update — confirmation required");
    expect(notice).toHaveTextContent(/no updater signature/i);
    expect(notice).toHaveTextContent(/cannot verify who produced/i);
    expect(notice).toHaveTextContent(/cannot cryptographically verify/i);

    const manualLink = screen.getByRole("link", {
      name: /Download manually/i,
    });
    expect(manualLink).toHaveAttribute("href", unsignedUpdate.downloadUrl);
    expect(manualLink).toHaveAttribute("target", "_blank");
    expect(manualLink).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(manualLink);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("open_url_external", {
        url: unsignedUpdate.downloadUrl,
      });
    });

    const confirmation = screen.getByTestId("updater-unsigned-confirmation");
    const installButton = screen.getByTestId("updater-install-unsigned-btn");
    expect(confirmation).not.toBeChecked();
    expect(installButton).toBeDisabled();
    fireEvent.click(installButton);
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "updater_install_unsigned",
      expect.anything(),
    );

    fireEvent.click(confirmation);
    expect(confirmation).toBeChecked();
    expect(installButton).not.toBeDisabled();
    fireEvent.click(installButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("updater_install_unsigned", {
        version: unsignedUpdate.version,
        acknowledgedRisk: true,
        proxyUrl: null,
      });
    });
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "updater_download_and_install",
      expect.anything(),
    );
    expect(screen.queryByTestId("updater-install-btn")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("updater-msi-elevation-notice"),
    ).not.toBeInTheDocument();
  });

  it("resets unsigned acknowledgement when the displayed artifact identity or source changes", async () => {
    const firstUpdate: AvailableUpdate = {
      ...availableUpdate,
      signaturePresent: false,
      target: "windows-x86_64",
      downloadUrl:
        "https://github.com/supermarsx/sortOfRemoteNG/releases/download/25.6/sortOfRemoteNG_25.6.0_windows-x86_64-setup.exe",
    };
    const changedUrlUpdate: AvailableUpdate = {
      ...firstUpdate,
      downloadUrl:
        "https://github.com/supermarsx/sortOfRemoteNG/releases/download/25.6.1/sortOfRemoteNG_25.6.0_windows-x86_64-setup.exe",
    };
    const changedTargetUpdate: AvailableUpdate = {
      ...changedUrlUpdate,
      target: "windows-x86_64-msi",
    };
    const statuses: UpdaterStatusSnapshot[] = [
      {
        ...idleStatus,
        status: "available",
        endpointSource: "public",
        availableUpdate: firstUpdate,
      },
      {
        ...idleStatus,
        status: "available",
        endpointSource: "public",
        availableUpdate: changedUrlUpdate,
      },
      {
        ...idleStatus,
        status: "available",
        endpointSource: "public",
        availableUpdate: changedTargetUpdate,
      },
      {
        ...idleStatus,
        status: "available",
        endpointSource: "private",
        availableUpdate: changedTargetUpdate,
      },
    ];
    let nextCheck = 1;
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(settings);
        case "updater_get_status":
          return Promise.resolve(statuses[0]);
        case "updater_check": {
          const status = statuses[nextCheck++]!;
          return Promise.resolve({
            updateAvailable: true,
            availableUpdate: status.availableUpdate,
            status,
          });
        }
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    render(<UpdaterSettingsSection />);
    await screen.findByTestId("updater-install-unsigned-btn");

    for (const expectedStatus of statuses.slice(1)) {
      const confirmation = screen.getByTestId("updater-unsigned-confirmation");
      fireEvent.click(confirmation);
      expect(confirmation).toBeChecked();

      fireEvent.click(screen.getByTestId("updater-check-btn"));
      await waitFor(() => expect(confirmation).not.toBeChecked());
      expect(
        screen.getByRole("link", { name: /Download manually/i }),
      ).toHaveAttribute("href", expectedStatus.availableUpdate?.downloadUrl);
    }

    expect(nextCheck).toBe(statuses.length);
  });

  it("keeps a non-official unsigned artifact available only as a manual link", async () => {
    const privateUnsignedUpdate: AvailableUpdate = {
      ...availableUpdate,
      signaturePresent: false,
      downloadUrl:
        "https://updates.example.com/releases/25.6/sortOfRemoteNG_25.6.0_windows-x86_64.msi",
    };
    const privateUnsignedStatus: UpdaterStatusSnapshot = {
      ...idleStatus,
      status: "available",
      endpointSource: "private_then_public",
      availableUpdate: privateUnsignedUpdate,
    };
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve({
            ...settings,
            privateEndpointEnabled: true,
            privateEndpointUrl: "https://updates.example.com/latest.json",
          });
        case "updater_get_status":
          return Promise.resolve(privateUnsignedStatus);
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    render(<UpdaterSettingsSection />);

    expect(await screen.findByTestId("updater-unsigned-notice")).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Download manually/i }),
    ).toHaveAttribute("href", privateUnsignedUpdate.downloadUrl);
    expect(
      screen.queryByTestId("updater-install-unsigned-btn"),
    ).not.toBeInTheDocument();
  });

  it("falls back to browser navigation when the native artifact opener rejects", async () => {
    const unsignedUpdate: AvailableUpdate = {
      ...availableUpdate,
      signaturePresent: false,
    };
    const unsignedStatus: UpdaterStatusSnapshot = {
      ...idleStatus,
      status: "available",
      availableUpdate: unsignedUpdate,
    };
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(settings);
        case "updater_get_status":
          return Promise.resolve(unsignedStatus);
        case "open_url_external":
          return Promise.reject(new Error("native opener unavailable"));
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    try {
      render(<UpdaterSettingsSection />);
      const manualLink = await screen.findByRole("link", {
        name: /Download manually/i,
      });
      fireEvent.click(manualLink);

      await waitFor(() => {
        expect(openSpy).toHaveBeenCalledWith(
          unsignedUpdate.downloadUrl,
          "_blank",
          "noopener,noreferrer",
        );
      });
    } finally {
      openSpy.mockRestore();
    }
  });

  it("describes unsigned macOS DMG handoff as a manual completion flow", async () => {
    const macSettings: UpdaterSettings = {
      ...settings,
      installMode: "macos_app",
    };
    const macUpdate: AvailableUpdate = {
      ...availableUpdate,
      signaturePresent: false,
      target: "darwin-aarch64",
      downloadUrl:
        "https://github.com/supermarsx/sortOfRemoteNG/releases/download/25.6/sortOfRemoteNG_25.6.0_darwin-aarch64.dmg",
    };
    const macStatus: UpdaterStatusSnapshot = {
      ...idleStatus,
      status: "available",
      installMode: "macos_app",
      availableUpdate: macUpdate,
    };
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_settings":
          return Promise.resolve(macSettings);
        case "updater_get_status":
          return Promise.resolve(macStatus);
        default:
          return Promise.reject(new Error(`unexpected command ${cmd}`));
      }
    });

    render(<UpdaterSettingsSection />);

    expect(
      await screen.findByTestId("updater-unsigned-macos-manual-step"),
    ).toHaveTextContent(/opens the DMG.*closes sortOfRemoteNG/i);
    expect(
      screen.getByTestId("updater-unsigned-macos-manual-step"),
    ).toHaveTextContent(/Drag the app to Applications.*reopen it/i);
    expect(
      screen.getByTestId("updater-install-unsigned-btn"),
    ).toHaveTextContent("Download and open unsigned update");
  });

  it.each([
    "javascript:alert(document.domain)",
    "file:///C:/Windows/System32/calc.exe",
    "https://user:secret@example.test/update.msi",
    " https://example.test/update.msi",
  ])(
    "does not render an unsafe feed artifact link: %s",
    async (downloadUrl) => {
      const unsafeUpdate: AvailableUpdate = {
        ...availableUpdate,
        signaturePresent: false,
        downloadUrl,
      };
      const unsafeStatus: UpdaterStatusSnapshot = {
        ...idleStatus,
        status: "available",
        availableUpdate: unsafeUpdate,
      };
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      mockInvoke.mockImplementation((cmd: string) => {
        switch (cmd) {
          case "updater_get_settings":
            return Promise.resolve(settings);
          case "updater_get_status":
            return Promise.resolve(unsafeStatus);
          default:
            return Promise.reject(new Error(`unexpected command ${cmd}`));
        }
      });

      try {
        render(<UpdaterSettingsSection />);
        expect(
          await screen.findByTestId("updater-unsigned-notice"),
        ).toBeVisible();
        expect(
          screen.queryByRole("link", { name: /Download manually/i }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("updater-install-unsigned-btn"),
        ).not.toBeInTheDocument();
        expect(openSpy).not.toHaveBeenCalled();
        expect(mockInvoke).not.toHaveBeenCalledWith(
          "open_url_external",
          expect.anything(),
        );
      } finally {
        openSpy.mockRestore();
      }
    },
  );

  it("opens GitHub Releases through the native browser command", async () => {
    const unsupportedMessage =
      "This Flatpak installation is updated externally.";
    const unsupportedSettings: UpdaterSettings = {
      ...settings,
      installMode: "flatpak",
      selfUpdateSupported: false,
      selfUpdateMessage: unsupportedMessage,
    };
    const unsupportedStatus: UpdaterStatusSnapshot = {
      ...idleStatus,
      installMode: "flatpak",
      selfUpdateSupported: false,
      selfUpdateMessage: unsupportedMessage,
    };
    mockInvoke.mockImplementation((cmd: string) =>
      Promise.resolve(
        cmd === "updater_get_settings"
          ? unsupportedSettings
          : unsupportedStatus,
      ),
    );

    render(<UpdaterSettingsSection />);

    const releasesLink = await screen.findByRole("link", {
      name: /Open GitHub Releases/i,
    });
    fireEvent.click(releasesLink);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("open_url_external", {
        url: "https://github.com/supermarsx/sortOfRemoteNG/releases/latest",
      });
    });
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
