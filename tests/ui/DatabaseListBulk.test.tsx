import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import DatabaseList from "../../src/components/database/list/DatabaseList";
import { ImportExportNavigationContext } from "../../src/components/ImportExport/navigation";
import { useDatabaseSelector } from "../../src/hooks/connection/useDatabaseSelector";
import type { ConnectionDatabase } from "../../src/types/connection/connection";

const mock = vi.hoisted(() => ({
  getAllDatabases: vi.fn(),
  getCurrentDatabase: vi.fn(),
  getDatabase: vi.fn(),
  isDatabaseUnlocked: vi.fn(),
  deleteDatabase: vi.fn(),
  flush: vi.fn(async () => undefined),
  save: vi.fn(async () => undefined),
  select: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => mock },
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ saveData: mock.save, flushPendingSave: mock.flush }),
}));
vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: { getProfiles: () => [], getChains: () => [] },
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({ getSettings: () => ({ exportSecurity: {} }) }),
  },
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { animationsEnabled: false } }),
  default: React.createContext({ settings: { animationsEnabled: false } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));

const alpha: ConnectionDatabase = {
  id: "a",
  name: "Alpha",
  description: "Primary",
  isEncrypted: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  lastAccessed: "2026-01-01",
};
const beta: ConnectionDatabase = { ...alpha, id: "b", name: "Beta" };
function Harness() {
  return (
    <ImportExportNavigationContext.Provider value={mock.navigate}>
      <DatabaseList
        mgr={useDatabaseSelector(true, mock.select)}
        onClose={vi.fn()}
      />
    </ImportExportNavigationContext.Provider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.getAllDatabases.mockResolvedValue([alpha, beta]);
  mock.getDatabase.mockImplementation(async (id: string) =>
    id === "a" ? alpha : beta,
  );
  mock.getCurrentDatabase.mockReturnValue(null);
  mock.isDatabaseUnlocked.mockReturnValue(false);
  mock.deleteDatabase.mockResolvedValue(undefined);
});

describe("actual database bulk controls", () => {
  it("navigates import and row export to the full tool without inline cards or unlocking", async () => {
    mock.getAllDatabases.mockResolvedValue([
      alpha,
      { ...beta, isEncrypted: true },
    ]);
    render(<Harness />);
    await screen.findByRole("checkbox", { name: "Select database Beta" });
    fireEvent.click(screen.getByTestId("database-import"));
    expect(mock.navigate).toHaveBeenLastCalledWith({
      tab: "import",
      format: "json",
    });
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "databaseCenter.actions.export",
      })[1],
    );
    expect(mock.navigate).toHaveBeenLastCalledWith({
      tab: "export",
      format: "json",
      databaseIds: ["b"],
      encrypted: true,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.queryByText("databaseCenter.collections.exportTitle"),
    ).toBeNull();
    expect(
      screen.queryByText("databaseCenter.collections.importTitle"),
    ).toBeNull();
    expect(mock.select).not.toHaveBeenCalled();
    expect(
      screen.getByRole("checkbox", { name: "Select database Alpha" }),
    ).toBeInTheDocument();
  });

  it("passes all bulk-selected IDs including locked and filtered-out rows", async () => {
    mock.getAllDatabases.mockResolvedValue([
      alpha,
      { ...beta, isEncrypted: true },
    ]);
    render(<Harness />);
    await screen.findByRole("checkbox", { name: "Select database Beta" });
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.change(screen.getByPlaceholderText("Search databases..."), {
      target: { value: "Alpha" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Export selected" }));
    expect(mock.navigate).toHaveBeenCalledWith({
      tab: "export",
      format: "json",
      databaseIds: ["a", "b"],
      encrypted: true,
    });
    expect(screen.queryByText("Encrypt export package")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mock.select).not.toHaveBeenCalled();
  });
  it("collects bulk unlock passwords in a popup and cancellation clears them without executing", async () => {
    mock.getAllDatabases.mockResolvedValue([
      { ...alpha, isEncrypted: true },
      { ...beta, isEncrypted: true },
    ]);
    render(<Harness />);
    await screen.findByRole("checkbox", { name: "Select database Alpha" });
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Unlock selected" }));
    const dialog = screen.getByRole("dialog", { name: "Unlock selected (2)" });
    fireEvent.change(within(dialog).getByLabelText("Password for Alpha"), {
      target: { value: "cancelled-secret" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Cancel batch" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unlock selected" }));
    expect(
      within(screen.getByRole("dialog")).getByLabelText("Password for Alpha"),
    ).toHaveValue("");
    expect(mock.select).not.toHaveBeenCalled();
  });
  it("selects via checkboxes without opening a database and retains hidden selections", async () => {
    render(<Harness />);
    expect(
      screen.getByText(
        /Encryption badges and locks here describe each database’s separate password/,
      ),
    ).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Select database Alpha" }),
    );
    expect(mock.select).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("Search databases..."), {
      target: { value: "Beta" },
    });
    expect(screen.getByText("1 visible / 2 total / 1 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select filtered" }));
    expect(screen.getByText("1 visible / 2 total / 2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Invert filtered" }));
    expect(screen.getByText("1 visible / 2 total / 1 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select none" }));
    expect(screen.getByText("1 visible / 2 total / 0 selected")).toBeTruthy();
  });

  it("names every selected target in a destructive confirmation and makes no write on cancel", async () => {
    render(<Harness />);
    await screen.findByRole("checkbox", { name: "Select database Alpha" });
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Alpha, Beta/)).toBeTruthy();
    expect(mock.deleteDatabase).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mock.deleteDatabase).not.toHaveBeenCalled();
  });

  it("reports partial deletion instead of presenting all targets as successful", async () => {
    mock.deleteDatabase.mockRejectedValueOnce(new Error("Storage denied"));
    render(<Harness />);
    await screen.findByRole("checkbox", { name: "Select database Alpha" });
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete 2 databases",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("1 succeeded / 1 failed / 0 skipped / 0 cancelled"),
      ).toBeTruthy(),
    );
    expect(mock.deleteDatabase).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Alpha: failed/)).toBeTruthy();
    const disclosure = screen
      .getByText("View operation results (2)")
      .closest("details");
    expect(disclosure?.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("View operation results (2)"));
    expect(disclosure?.hasAttribute("open")).toBe(true);
  });
});
