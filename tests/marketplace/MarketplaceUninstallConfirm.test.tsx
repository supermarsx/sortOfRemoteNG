import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";

/* ---- Tauri mock ---- */
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      if (vars) return `${key}:${JSON.stringify(vars)}`;
      return key;
    },
  }),
}));

import MarketplacePanel from "../../src/components/marketplace/MarketplacePanel";

/**
 * Helper: render the panel and switch to the installed tab with one plugin.
 */
async function renderWithInstalledPlugin() {
  const plugin = {
    id: "test-plugin",
    name: "Test Plugin",
    installedVersion: "1.0.0",
    latestVersion: "1.0.0",
    enabled: true,
    hasUpdate: false,
  };

  // mkt_get_installed returns our plugin; everything else returns empty/default
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "mkt_get_installed") return Promise.resolve([plugin]);
    if (cmd === "mkt_get_stats")
      return Promise.resolve({
        totalListings: 0,
        installedCount: 1,
        updatesAvailable: 0,
        repositoryCount: 0,
      });
    return Promise.resolve([]);
  });

  await act(async () => {
    render(<MarketplacePanel />);
  });

  // Switch to installed tab
  const tab = screen.getByText("marketplace.tabs.installed");
  await act(async () => {
    fireEvent.click(tab);
  });

  return plugin;
}

describe("MarketplacePanel – uninstall confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue([]);
  });

  it("clicking uninstall shows confirmation dialog", async () => {
    await renderWithInstalledPlugin();

    const uninstallBtn = screen.getByText("marketplace.uninstall");
    await act(async () => {
      fireEvent.click(uninstallBtn);
    });

    // The ConfirmDialog should now be visible with the confirm button text
    await waitFor(() => {
      // The dialog renders a second "marketplace.uninstall" as the confirm button
      const buttons = screen.getAllByText("marketplace.uninstall");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("canceling closes the dialog without uninstalling", async () => {
    await renderWithInstalledPlugin();

    const uninstallBtn = screen.getByText("marketplace.uninstall");
    await act(async () => {
      fireEvent.click(uninstallBtn);
    });

    // Click cancel
    const cancelBtn = await screen.findByText("common.cancel");
    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    // mkt_uninstall should NOT have been called
    const uninstallCalls = mockInvoke.mock.calls.filter(
      (args: any[]) => args[0] === "mkt_uninstall",
    );
    expect(uninstallCalls).toHaveLength(0);
  });

  it("confirming proceeds with uninstall", async () => {
    await renderWithInstalledPlugin();

    const uninstallBtn = screen.getByText("marketplace.uninstall");
    await act(async () => {
      fireEvent.click(uninstallBtn);
    });

    // The confirm dialog now has two "marketplace.uninstall" buttons –
    // the original in the list and the dialog confirm button. Pick the last one.
    await waitFor(() => {
      const buttons = screen.getAllByText("marketplace.uninstall");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    const confirmButtons = screen.getAllByText("marketplace.uninstall");
    const confirmBtn = confirmButtons[confirmButtons.length - 1];

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    // mkt_uninstall should have been called with our plugin id
    await waitFor(() => {
      const uninstallCalls = mockInvoke.mock.calls.filter(
        (args: any[]) => args[0] === "mkt_uninstall",
      );
      expect(uninstallCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
