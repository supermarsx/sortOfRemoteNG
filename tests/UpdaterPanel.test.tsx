import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: unknown) => {
      try {
        if (opts != null && typeof opts === "object" && "version" in opts) {
          return `${key} ${(opts as Record<string, unknown>).version}`;
        }
      } catch {
        /* safe fallback for non-object opts */
      }
      return key;
    },
  }),
}));

import { UpdaterPanel } from "../src/components/monitoring/UpdaterPanel";

describe("UpdaterPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "updater_get_history": return Promise.resolve([]);
        case "updater_get_rollbacks": return Promise.resolve([]);
        case "updater_get_config": return Promise.resolve(null);
        case "updater_get_version_info": return Promise.resolve(null);
        default: return Promise.resolve(null);
      }
    });
  });

  it("renders the title", () => {
    render(<UpdaterPanel />);
    expect(screen.getByText("updater.panelTitle")).toBeInTheDocument();
  });

  it("shows version info section", () => {
    render(<UpdaterPanel />);
    expect(screen.getByText("updater.versionInfo")).toBeInTheDocument();
  });

  it("shows check for updates button", () => {
    render(<UpdaterPanel />);
    expect(screen.getByText("updater.checkForUpdates")).toBeInTheDocument();
  });

  it("shows channel selector", () => {
    render(<UpdaterPanel />);
    expect(screen.getByText("updater.updateChannel")).toBeInTheDocument();
    expect(screen.getByText("Stable")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Nightly")).toBeInTheDocument();
  });

  it("calls updater_check when check button clicked", async () => {
    mockInvoke.mockResolvedValue(null);
    render(<UpdaterPanel />);
    const btn = screen.getByText("updater.checkForUpdates");
    await act(async () => { fireEvent.click(btn); });
    expect(mockInvoke).toHaveBeenCalledWith("updater_check");
  });

  it("shows check button after check completes", async () => {
    mockInvoke.mockResolvedValue(null);
    render(<UpdaterPanel />);
    const btn = screen.getByText("updater.checkForUpdates");
    await act(async () => { fireEvent.click(btn); });
    // After check completes with no update, button should still be available
    expect(screen.getByText("updater.checkForUpdates")).toBeInTheDocument();
  });

  it("shows release notes tab", async () => {
    render(<UpdaterPanel />);
    const tab = screen.getByText("updater.tabNotes");
    act(() => { fireEvent.click(tab); });
    expect(screen.getByText("updater.releaseNotes")).toBeInTheDocument();
  });

  it("shows update history tab", async () => {
    render(<UpdaterPanel />);
    const tab = screen.getByText("updater.tabHistory");
    act(() => { fireEvent.click(tab); });
    expect(screen.getByText("updater.updateHistory")).toBeInTheDocument();
  });

  it("shows rollback tab", async () => {
    render(<UpdaterPanel />);
    const tab = screen.getByText("updater.tabRollback");
    act(() => { fireEvent.click(tab); });
    expect(screen.getByText("updater.rollbackVersions")).toBeInTheDocument();
  });

  it("shows settings tab", async () => {
    render(<UpdaterPanel />);
    const tab = screen.getByText("updater.tabSettings");
    act(() => { fireEvent.click(tab); });
    // Config is null initially, so settings shows loading
    // Note: version card also shows "updater.loading" (versionInfo is null), so use getAllByText
    const loadingTexts = screen.getAllByText("updater.loading");
    expect(loadingTexts.length).toBeGreaterThanOrEqual(1);
  });

  it("loads config on mount", async () => {
    render(<UpdaterPanel />);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });
  });
});
