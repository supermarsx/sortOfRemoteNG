import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Monitor } from "lucide-react";
const fixture = vi.hoisted(() => ({ value: {} as any }));
vi.mock("../../src/hooks/icons/useIconExplorer", () => ({
  useIconExplorer: () => fixture.value,
}));
import IconExplorerTab from "../../src/components/icons/IconExplorerTab";
const entries = Array.from({ length: 205 }, (_, i) => ({
  key: "icon-" + i,
  kind: i === 204 ? "custom" : "builtin",
  label: "Example " + i,
  originalLabel: "Original " + i,
  notes: i === 110 ? "needle archived lab" : "",
  category: i === 204 ? "custom" : "folders",
  keywords: ["sample"],
  icon: Monitor,
}));
beforeEach(() => {
  fixture.value = {
    entries,
    ready: true,
    accessEpoch: 1,
    locked: false,
    error: null,
    busy: false,
    message: null,
    preview: null,
    updateMetadata: vi.fn().mockResolvedValue(undefined),
    deleteCustom: vi.fn().mockResolvedValue(undefined),
    exportIcons: vi.fn().mockResolvedValue(undefined),
    importFile: vi.fn(),
    applyImport: vi.fn(),
    dismissImport: vi.fn(),
  };
});
describe("autonomous Icon Explorer workspace", () => {
  it("cancels deletion review when the same custom key is replaced by a synchronized entry", () => {
    const { rerender } = render(<IconExplorerTab />);
    fireEvent.change(screen.getByRole("combobox", { name: "Icon source" }), {
      target: { value: "custom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select filtered" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete custom (1)" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fixture.value.entries = [
      ...entries.slice(0, 204),
      { ...entries[204], label: "New synchronized artwork" },
    ];
    fixture.value.accessEpoch = 2;
    rerender(<IconExplorerTab />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fixture.value.deleteCustom).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete custom (1)" }));
    expect(
      within(screen.getByRole("dialog")).getByText(/New synchronized artwork/),
    ).toBeInTheDocument();
  });
  it("does not resurrect a delete confirmation after a batched lock/unlock epoch change", () => {
    const { rerender } = render(<IconExplorerTab />);
    fireEvent.change(screen.getByRole("combobox", { name: "Icon source" }), {
      target: { value: "custom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select filtered" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete custom (1)" }));
    // Both lifecycle changes may arrive before the next React render.
    fixture.value.accessEpoch = 3;
    rerender(<IconExplorerTab />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fixture.value.deleteCustom).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete custom (1)" }));
    fixture.value.locked = true;
    fixture.value.accessEpoch = 4;
    rerender(<IconExplorerTab />);
    fixture.value.locked = false;
    fixture.value.accessEpoch = 5;
    rerender(<IconExplorerTab />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("reports an unavailable corrupt library without pretending it is still loading or resetting it", () => {
    fixture.value.ready = false;
    fixture.value.error = "Invalid icon library";
    render(<IconExplorerTab />);
    expect(screen.getByText(/Icon library unavailable/)).toBeInTheDocument();
    expect(screen.queryByText("Loading icon library…")).toBeNull();
    expect(fixture.value.deleteCustom).not.toHaveBeenCalled();
  });
  it("combines category sidebar navigation and search, then clears active filters", () => {
    render(<IconExplorerTab />);
    const sidebar = screen.getByRole("navigation", { name: "Icon sections" });
    fireEvent.click(
      within(sidebar).getByRole("button", { name: "Folders (204)" }),
    );
    expect(
      within(sidebar).getByRole("button", { name: "Folders (204)" }),
    ).toHaveAttribute("aria-current", "page");
    const search = screen.getByRole("textbox", { name: "Search icons" });
    expect(search).toHaveClass("sor-search-input");
    expect(search).not.toHaveClass("sor-form-input");
    fireEvent.change(search, { target: { value: "needle" } });
    expect(screen.getByText("1 matching · 0 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(search).toHaveValue("");
    expect(screen.getByText("205 matching · 0 selected")).toBeInTheDocument();
  });
  it("preserves a stale notes draft but blocks overwriting metadata updated elsewhere", () => {
    const { rerender } = render(<IconExplorerTab />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect Example 0" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
      target: { value: "My unsaved notes" },
    });
    fixture.value.entries = [
      { ...entries[0], label: "Synced rename", notes: "Remote notes" },
      ...entries.slice(1),
    ];
    rerender(<IconExplorerTab />);
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue(
      "My unsaved notes",
    );
    expect(
      screen.getByRole("button", { name: "Save name and notes" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Reload saved metadata" }),
    );
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue(
      "Remote notes",
    );
    expect(screen.getByRole("textbox", { name: "Personal name" })).toHaveValue(
      "Synced rename",
    );
    expect(fixture.value.updateMetadata).not.toHaveBeenCalled();
  });
  it("renders at most 96 icons, pages and searches notes without eagerly rendering the catalog", () => {
    render(<IconExplorerTab />);
    expect(
      within(screen.getByRole("list", { name: "Icon catalog" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(96);
    fireEvent.click(screen.getAllByRole("button", { name: "Next page" })[0]);
    expect(
      screen.getByRole("button", { name: "Inspect Example 110" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search icons" }), {
      target: { value: "needle lab" },
    });
    expect(
      within(screen.getByRole("list", { name: "Icon catalog" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(1);
    expect(screen.getAllByText("Page 1 of 1 · 1 icons")).toHaveLength(2);
  });
  it("edits only personal metadata for a built-in and exposes its immutable key", () => {
    render(<IconExplorerTab />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect Example 0" }));
    const detail = screen.getByRole("complementary", { name: "Icon details" });
    expect(within(detail).getByText("icon-0")).toBeInTheDocument();
    expect(
      within(detail).queryByRole("button", { name: "Delete custom icon" }),
    ).toBeNull();
    fireEvent.change(
      within(detail).getByRole("textbox", { name: "Personal name" }),
      { target: { value: "My host" } },
    );
    fireEvent.change(within(detail).getByRole("textbox", { name: "Notes" }), {
      target: { value: "Local annotation" },
    });
    fireEvent.click(
      within(detail).getByRole("button", { name: "Save name and notes" }),
    );
    expect(fixture.value.updateMetadata).toHaveBeenCalledWith(
      "icon-0",
      "My host",
      "Local annotation",
    );
    expect(fixture.value.deleteCustom).not.toHaveBeenCalled();
  });
  it("keeps selection across pages and exports the exact selected keys", () => {
    render(<IconExplorerTab />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Example 0" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Next page" })[0]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Example 100" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Export selected JSON" }),
    );
    expect(fixture.value.exportIcons).toHaveBeenCalledWith(
      ["icon-0", "icon-100"],
      "json",
    );
  });
  it("filters custom icons and requires explicit deletion confirmation", () => {
    render(<IconExplorerTab />);
    fireEvent.change(screen.getByRole("combobox", { name: "Icon source" }), {
      target: { value: "custom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select filtered" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete custom (1)" }));
    expect(fixture.value.deleteCustom).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(fixture.value.deleteCustom).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete custom (1)" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete custom icons",
      }),
    );
    expect(fixture.value.deleteCustom).toHaveBeenCalledWith(["icon-204"], 1);
  });
  it("reviews import conflicts with safe skip defaults in a bounded dialog", () => {
    fixture.value.preview = {
      id: "preview",
      entries: entries.slice(0, 2),
      conflicts: [
        { key: "icon-0", existingLabel: "Old", incomingLabel: "Example 0" },
      ],
      warnings: ["Plaintext export"],
    };
    render(<IconExplorerTab />);
    const dialog = screen.getByRole("dialog", { name: "Review icon import" });
    expect(dialog.querySelector(".sor-modal-body")?.className).toContain(
      "overflow-y-auto",
    );
    expect(dialog.querySelector(".sor-modal-footer")?.className).toContain(
      "shrink-0",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Apply reviewed import" }),
    );
    expect(fixture.value.applyImport).toHaveBeenCalledWith({
      "icon-0": "skip",
    });
    fireEvent.change(
      within(dialog).getByRole("combobox", { name: "Conflict for Example 0" }),
      { target: { value: "replace" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Apply reviewed import" }),
    );
    expect(fixture.value.applyImport).toHaveBeenLastCalledWith({
      "icon-0": "replace",
    });
  });
  it("does not display user metadata or actionable controls when locked", () => {
    fixture.value.locked = true;
    render(<IconExplorerTab />);
    expect(screen.getByText(/Unlock the application/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Icon catalog" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Import/ })).toBeNull();
  });
});
