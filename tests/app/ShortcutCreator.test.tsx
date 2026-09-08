import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import {
  ShortcutCreator,
  ShortcutManagerDialog,
} from "../../src/components/app/ShortcutManagerDialog";

const fixtures = vi.hoisted(() => ({
  scanned: [
    {
      name: "Desktop Alpha",
      path: "C:\\Desktop\\Alpha.lnk",
      target: "C:\\App\\sortofremoteng.exe",
      arguments: null,
      is_sortofremoteng: true,
    },
    {
      name: "Documents Beta",
      path: "C:\\Documents\\Beta.lnk",
      target: "C:\\App\\sortofremoteng.exe",
      arguments: null,
      is_sortofremoteng: true,
    },
  ],
  databaseManager: {
    getAllDatabases: vi.fn().mockResolvedValue([
      { id: "collection-prod", name: "Production Fleet" },
      { id: "collection-lab", name: "Lab Machines" },
    ]),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === "string" ? fallback : (fallback?.defaultValue ?? key),
  }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => fixtures.databaseManager },
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      connections: [
        { id: "connection-prod", name: "Production Desktop" },
        { id: "connection-lab", name: "Lab SSH Server" },
        { id: "group-prod", name: "Production Folder", isGroup: true },
      ],
    },
  }),
}));

async function openCreator() {
  render(<ShortcutCreator isOpen onClose={vi.fn()} />);
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Collection" }), {
    key: "ArrowDown",
  });
  await screen.findByRole("option", { name: "Production Fleet" });
}

function searchAndSelect(placeholder: string, query: string) {
  const input = screen.getByRole("textbox", { name: placeholder });
  fireEvent.change(input, { target: { value: query } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("ShortcutCreator searchable selections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_desktop_path") return "C:\\Desktop";
      if (command === "create_desktop_shortcut")
        return "C:\\Desktop\\Remote.lnk";
      if (command === "scan_shortcuts") return fixtures.scanned;
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("filters collection names case-insensitively and selects with the keyboard", async () => {
    await openCreator();
    const search = screen.getByRole("textbox", {
      name: "Search collections...",
    });
    fireEvent.change(search, { target: { value: "  pRoDuCtIoN  " } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(
      screen.queryByRole("option", { name: "Lab Machines" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(
      screen.getByRole("combobox", { name: "Collection" }),
    ).toHaveTextContent("Production Fleet");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("filters connection names, excludes groups and passes original IDs to shortcut creation", async () => {
    await openCreator();
    searchAndSelect("Search collections...", "Production");
    fireEvent.click(screen.getByRole("combobox", { name: "Connection" }));
    expect(
      screen.queryByRole("option", { name: "Production Folder" }),
    ).not.toBeInTheDocument();
    const search = screen.getByRole("textbox", {
      name: "Search connections...",
    });
    fireEvent.change(search, { target: { value: "dEsKtOp" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(
      screen.queryByRole("option", { name: "Lab SSH Server" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(
      screen.getByRole("combobox", { name: "Connection" }),
    ).toHaveTextContent("Production Desktop");
    fireEvent.change(screen.getByPlaceholderText("My Server Connection"), {
      target: { value: "Remote" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Shortcut" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "create_desktop_shortcut",
        expect.objectContaining({
          name: "Remote",
          collectionId: "collection-prod",
          connectionId: "connection-prod",
          folderPath: "C:\\Desktop",
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Collection" }),
      ).toHaveTextContent("Select a collection..."),
    );
    expect(
      screen.getByRole("combobox", { name: "Connection" }),
    ).toHaveTextContent("Select a connection...");
  });

  it.each([
    ["Collection", "Search collections...", "Production Fleet"],
    ["Connection", "Search connections...", "Production Desktop"],
  ])(
    "shows empty results for %s and clears search when dismissed",
    async (label, placeholder, option) => {
      await openCreator();
      fireEvent.keyDown(
        screen.getByRole("textbox", { name: "Search collections..." }),
        { key: "Escape" },
      );
      const trigger = screen.getByRole("combobox", { name: label });
      fireEvent.click(trigger);
      const search = screen.getByRole("textbox", { name: placeholder });
      fireEvent.change(search, { target: { value: "missing-name" } });
      expect(screen.getByText("No matches")).toBeInTheDocument();
      expect(screen.queryByRole("option")).not.toBeInTheDocument();
      fireEvent.keyDown(search, { key: "Enter" });
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      fireEvent.keyDown(search, { key: "Escape" });
      expect(trigger).toHaveFocus();
      fireEvent.click(trigger);
      expect(screen.getByRole("textbox", { name: placeholder })).toHaveValue(
        "",
      );
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
      expect(invoke).not.toHaveBeenCalledWith(
        "create_desktop_shortcut",
        expect.anything(),
      );
    },
  );

  it("keeps both optional selections clearable after searching", async () => {
    await openCreator();
    searchAndSelect("Search collections...", "Lab");
    fireEvent.click(screen.getByRole("combobox", { name: "Connection" }));
    searchAndSelect("Search connections...", "SSH");
    fireEvent.click(screen.getByRole("combobox", { name: "Collection" }));
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Select a collection..." }),
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Connection" }));
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Select a connection..." }),
    );
    expect(
      screen.getByRole("combobox", { name: "Collection" }),
    ).toHaveTextContent("Select a collection...");
    expect(
      screen.getByRole("combobox", { name: "Connection" }),
    ).toHaveTextContent("Select a connection...");
  });

  async function scan() {
    render(<ShortcutManagerDialog isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Scan" })[1]);
    await screen.findByRole("checkbox", { name: "Select Desktop Alpha" });
  }

  it("selects filtered findings and imports only selected original paths", async () => {
    await scan();
    expect(
      screen.getByRole("button", { name: "Import selected" }),
    ).toBeDisabled();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search scan results" }),
      { target: { value: "desktop" } },
    );
    expect(screen.queryByText("Documents Beta")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all visible shortcuts" }),
    );
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(
      screen.getByRole("checkbox", { name: "Select Documents Beta" }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
    await waitFor(() =>
      expect(screen.queryByText("Desktop Alpha")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Documents Beta")).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem("sortofremoteng-shortcuts") ?? "[]"),
    ).toEqual([
      expect.objectContaining({
        name: "Desktop Alpha",
        path: fixtures.scanned[0].path,
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Import all" }));
    await waitFor(() =>
      expect(screen.queryByText("Documents Beta")).not.toBeInTheDocument(),
    );
    expect(
      JSON.parse(localStorage.getItem("sortofremoteng-shortcuts") ?? "[]"),
    ).toHaveLength(2);
  });

  it("reveals a row folder, clears selection and discards findings without deleting files", async () => {
    await scan();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open containing folder for Desktop Alpha",
      }),
    );
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("open_folder", {
        path: "C:\\Desktop",
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all visible shortcuts" }),
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(
      screen.getByRole("checkbox", { name: "Select Desktop Alpha" }),
    ).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Desktop Alpha" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard selected" }));
    expect(screen.queryByText("Desktop Alpha")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Discard result Documents Beta" }),
    );
    expect(screen.queryByText("Documents Beta")).not.toBeInTheDocument();
    expect(localStorage.getItem("sortofremoteng-shortcuts")).toBeNull();
    expect(
      vi
        .mocked(invoke)
        .mock.calls.every(
          ([command]) =>
            ![
              "delete_shortcut",
              "delete_file",
              "create_desktop_shortcut",
            ].includes(command),
        ),
    ).toBe(true);
  });

  it("imports a single row and discards all remaining findings even under an empty search", async () => {
    await scan();
    fireEvent.click(
      screen.getByRole("button", { name: "Import Desktop Alpha" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Desktop Alpha")).not.toBeInTheDocument(),
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "missing" },
    });
    expect(screen.getByText("No matching scan results")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select all visible shortcuts" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Discard all results" }),
    );
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem("sortofremoteng-shortcuts") ?? "[]"),
    ).toHaveLength(1);
  });

  it("disables result actions and selection while a rescan is pending", async () => {
    await scan();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Desktop Alpha" }),
    );
    let finishScan!: (results: typeof fixtures.scanned) => void;
    const pendingScan = new Promise<typeof fixtures.scanned>((resolve) => {
      finishScan = resolve;
    });
    const originalInvoke = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation((command, args, options) =>
      command === "scan_shortcuts"
        ? pendingScan
        : originalInvoke(command, args, options),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Scan" })[1]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Scanning..." }),
      ).toBeDisabled(),
    );
    for (const label of [
      "Import selected",
      "Import all",
      "Discard selected",
      "Discard all results",
      "Clear selection",
      "Import Desktop Alpha",
      "Discard result Desktop Alpha",
      "Open containing folder for Desktop Alpha",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    expect(
      screen.getByRole("checkbox", { name: "Select Desktop Alpha" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Select all visible shortcuts" }),
    ).toBeDisabled();
    finishScan(fixtures.scanned);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import all" })).toBeEnabled(),
    );
  });
});
