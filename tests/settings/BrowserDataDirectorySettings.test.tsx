import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import BrowserDataDirectorySettings from "../../src/components/SettingsDialog/sections/webBrowser/BrowserDataDirectorySettings";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));

const current = {
  parentDirectory: null,
  effectiveDirectory: "/local/app/native-browser",
  activeDirectory: "/local/app/native-browser",
  restartRequired: false,
};

describe("Browser working-data location", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(current);
    mocks.open.mockResolvedValue(null);
  });
  afterEach(cleanup);

  it("shows the resolved folder and opens it through the dedicated native command", async () => {
    render(<BrowserDataDirectorySettings />);
    await screen.findByText(current.effectiveDirectory);
    expect(screen.getByLabelText("Parent folder").className).toContain(
      "sor-settings-input",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("open_browser_data_directory"),
    );
    expect(screen.getByText(/owning encrypted database/)).toBeTruthy();
  });

  it("browses without saving until confirmed and shows restart information", async () => {
    render(<BrowserDataDirectorySettings />);
    await screen.findByText(current.effectiveDirectory);
    mocks.open.mockResolvedValue("/chosen");
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Parent folder") as HTMLInputElement).value,
      ).toBe("/chosen"),
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "set_browser_data_directory",
      expect.anything(),
    );
    mocks.invoke.mockResolvedValue({
      ...current,
      parentDirectory: "/chosen",
      effectiveDirectory: "/chosen/sorng-browser/app",
      restartRequired: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save location" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("set_browser_data_directory", {
        parentDirectory: "/chosen",
      }),
    );
    await screen.findByText(/Browser data location saved/);
    expect(screen.getByText(/Currently using:/)).toBeTruthy();
  });

  it("does not change the draft when the folder picker is cancelled", async () => {
    render(<BrowserDataDirectorySettings />);
    await screen.findByText(current.effectiveDirectory);
    fireEvent.change(screen.getByLabelText("Parent folder"), {
      target: { value: "/draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Browse…" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByLabelText("Parent folder") as HTMLInputElement).value,
    ).toBe("/draft");
  });

  it("offers explicit reset when saved configuration is broken", async () => {
    mocks.invoke.mockRejectedValueOnce("Invalid configuration");
    render(<BrowserDataDirectorySettings />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Use default folder" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("set_browser_data_directory", {
        parentDirectory: null,
      }),
    );
    await screen.findByText(/Browser data location saved/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the draft and existing location after a rejected save", async () => {
    render(<BrowserDataDirectorySettings />);
    await screen.findByText(current.effectiveDirectory);
    fireEvent.change(screen.getByLabelText("Parent folder"), {
      target: { value: "/missing" },
    });
    mocks.invoke.mockRejectedValueOnce(
      "Choose an existing absolute folder for browser working data.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save location" }));
    await screen.findByRole("alert");
    expect(screen.getByText(current.effectiveDirectory)).toBeTruthy();
    expect(
      (screen.getByLabelText("Parent folder") as HTMLInputElement).value,
    ).toBe("/missing");
  });
});
