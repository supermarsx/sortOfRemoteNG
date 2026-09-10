import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { BrowserScript } from "../../src/types/recording/webAutomation";
vi.mock("../../src/components/ui/editor/ScriptCodeEditor", () => ({
  default: ({
    code,
    onChange,
    ariaLabel,
    readOnly,
  }: {
    code: string;
    onChange: (code: string) => void;
    ariaLabel: string;
    readOnly?: boolean;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={code}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
const h = vi.hoisted(() => ({
  load: vi.fn(),
  apply: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  ready: true,
  busy: false,
  editing: false,
  cancelEdit: vi.fn(),
  scripts: [] as BrowserScript[],
}));
vi.mock("../../src/utils/recording/managedScriptPersistence", () => ({
  managedScriptsStore: { load: h.load },
}));
vi.mock("../../src/utils/recording/defaultScriptCatalog", () => ({
  applyDefaultScriptSelection: h.apply,
}));
vi.mock("../../src/hooks/recording/useWebsiteUserScripts", () => ({
  useWebsiteUserScripts: () => ({
    scripts: h.scripts,
    ready: h.ready,
    busy: h.busy,
    error: null,
    epoch: 1,
    save: h.save,
    remove: h.remove,
    reload: vi.fn(),
  }),
}));
vi.mock("../../src/hooks/recording/useScriptManager", () => ({
  useScriptManager: () => ({
    isEditing: h.editing,
    handleCancelEdit: h.cancelEdit,
  }),
}));
vi.mock("../../src/components/recording/scriptManager/FilterToolbar", () => ({
  default: () => null,
}));
vi.mock("../../src/components/recording/scriptManager/ScriptList", () => ({
  default: () => null,
}));
vi.mock("../../src/components/recording/scriptManager/DetailPane", () => ({
  default: () => null,
}));
import { DefaultScriptCatalog } from "../../src/components/recording/scriptManager/DefaultScriptCatalog";
import WebsiteUserScriptsPanel from "../../src/components/recording/scriptManager/WebsiteUserScriptsPanel";
import { defaultScripts } from "../../src/data/defaultScripts";
import { ScriptManager } from "../../src/components/recording/ScriptManager";
const item: BrowserScript = {
  id: "script-stable",
  kind: "script",
  name: "Website fixture",
  description: "Read page title",
  code: "document.title",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
beforeEach(() => {
  vi.clearAllMocks();
  h.ready = true;
  h.busy = false;
  h.editing = false;
  h.scripts = [item];
  h.save.mockImplementation(async (item: BrowserScript) => {
    h.scripts = [item];
    return true;
  });
  h.remove.mockResolvedValue(true);
  h.load.mockResolvedValue({ value: null });
  h.apply.mockResolvedValue({
    value: { customScripts: [], modifiedDefaults: [], deletedDefaultIds: [] },
  });
});
describe("default script catalog UI", () => {
  it("retains the terminal draft until explicitly discarded when entering Browse", async () => {
    h.editing = true;
    render(<ScriptManager isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Browse scripts" }));
    expect(screen.getByText("Discard script draft?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(h.cancelEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Browse scripts" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await screen.findByText(/191 bundled entries/);
    expect(h.cancelEdit).toHaveBeenCalledOnce();
    expect(screen.getByRole("tab", { name: "Browse scripts" })).toHaveClass(
      "sor-tab-trigger-active",
    );
  });
  it("opens Browse scripts as an embedded subtab, not a modal", async () => {
    render(<ScriptManager isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Browse scripts" }));
    await screen.findByText(/191 bundled entries/);
    expect(screen.getByRole("tab", { name: "Browse scripts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /close.*catalog|cancel/i }),
    ).not.toBeInTheDocument();
  });
  it("bounds rendered rows and provides device CLI preview without import or execution", async () => {
    const { container } = render(<DefaultScriptCatalog onApplied={vi.fn()} />);
    await act(async () => undefined);
    expect(container.querySelectorAll("[data-catalog-key]")).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 2 of 4")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Browse script platform"), {
      target: { value: "arista-eos" },
    });
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText(/77 matching/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Arista EOS — Version and Inventory/,
      }),
    );
    expect(
      screen.getByText(/Literal terminal input, not a Bash program/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cannot be imported as an interpreter script/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import / restore 0 selected" }),
    ).toBeDisabled();
    expect(h.apply).not.toHaveBeenCalled();
  });
  it("filters catalog by platform/category and previews without importing", async () => {
    render(<DefaultScriptCatalog onApplied={vi.fn()} />);
    await act(async () => undefined);
    expect(screen.getByLabelText("Browse script platform")).toHaveStyle({
      width: "auto",
    });
    expect(screen.getByLabelText("Browse script category")).toHaveStyle({
      width: "auto",
    });
    fireEvent.change(screen.getByLabelText("Browse script platform"), {
      target: { value: "windows" },
    });
    fireEvent.change(screen.getByLabelText("Browse script category"), {
      target: { value: "Packages / Windows" },
    });
    expect(
      screen.getByRole("checkbox", {
        name: "Select Installed Windows packages (winget)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", {
        name: "Select Installed Debian packages (dpkg)",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Installed Windows packages (winget)"));
    expect(screen.getByText("winget list").closest("pre")).toHaveTextContent(
      "winget list",
    );
    expect(h.apply).not.toHaveBeenCalled();
  });
  it("requires explicit overwrite review for selected modified defaults", async () => {
    const value = {
      customScripts: [],
      modifiedDefaults: [{ ...defaultScripts[0], script: "echo mine" }],
      deletedDefaultIds: [],
    };
    h.load.mockResolvedValue({ value });
    const onApplied = vi.fn();
    render(<DefaultScriptCatalog onApplied={onApplied} />);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: `Select ${defaultScripts[0].name}`,
      }),
    );
    const confirm = await screen.findByRole("checkbox", {
      name: /Replace the 1 selected/,
    });
    expect(
      screen.getByRole("button", { name: "Import / restore 1 selected" }),
    ).toBeDisabled();
    fireEvent.click(confirm);
    fireEvent.click(
      screen.getByRole("button", { name: "Import / restore 1 selected" }),
    );
    await waitFor(() =>
      expect(h.apply).toHaveBeenCalledWith([defaultScripts[0].id], value, true),
    );
    expect(onApplied).toHaveBeenCalledOnce();
  });
  it("never treats failed storage load as an empty writable library", async () => {
    h.load.mockRejectedValueOnce(new Error("locked"));
    render(<DefaultScriptCatalog onApplied={vi.fn()} />);
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: `Select ${defaultScripts[0].name}`,
      }),
    );
    expect(
      screen.getByRole("button", { name: "Import / restore 1 selected" }),
    ).toBeDisabled();
    expect(h.apply).not.toHaveBeenCalled();
  });
});
describe("website userscript library UI", () => {
  it("locks draft fields and library switching while a write is pending", () => {
    const { rerender } = render(<ScriptManager isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Website userscripts" }));
    fireEvent.click(screen.getByRole("button", { name: "New website script" }));
    h.busy = true;
    rerender(<ScriptManager isOpen onClose={vi.fn()} />);
    expect(screen.getByLabelText("Script name")).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeDisabled();
    expect(screen.getByLabelText("Website JavaScript")).toHaveAttribute(
      "readonly",
    );
    expect(
      screen.getByRole("tab", { name: "Terminal scripts" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel edit" })).toBeDisabled();
    h.busy = false;
    rerender(<ScriptManager isOpen onClose={vi.fn()} />);
    expect(screen.getByLabelText("Script name")).not.toBeDisabled();
    expect(screen.getByLabelText("Website JavaScript")).not.toHaveAttribute(
      "readonly",
    );
  });
  it("mounts website management only after selection and protects drafts when switching library kind", async () => {
    render(<ScriptManager isOpen onClose={vi.fn()} />);
    expect(
      screen.queryByLabelText("Website userscript library"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Website userscripts" }));
    fireEvent.click(screen.getByRole("button", { name: "New website script" }));
    fireEvent.change(screen.getByLabelText("Script name"), {
      target: { value: "Unsaved fixture" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Terminal scripts" }));
    expect(screen.getByText("Discard script draft?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Script name")).toHaveValue("Unsaved fixture");
    fireEvent.click(screen.getByRole("tab", { name: "Terminal scripts" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(
      screen.queryByLabelText("Website userscript library"),
    ).not.toBeInTheDocument();
    expect(h.save).not.toHaveBeenCalled();
  });
  it("uses an app confirmation to cancel an unsaved website edit", () => {
    render(<WebsiteUserScriptsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "New website script" }));
    fireEvent.change(screen.getByLabelText("Script name"), {
      target: { value: "Unsaved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Script name")).toHaveValue("Unsaved");
    expect(h.save).not.toHaveBeenCalled();
  });
  it("requires explicit current-version review after an external update or deletion", () => {
    const { rerender } = render(<WebsiteUserScriptsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Website fixture/ }));
    h.scripts = [{ ...item, code: "document.body.dataset.changed" }];
    rerender(<WebsiteUserScriptsPanel />);
    expect(
      screen.queryByRole("button", { name: "Edit website script" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("document.title")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Review current version" }),
    );
    expect(
      screen.getByRole("button", { name: "Edit website script" }),
    ).toBeInTheDocument();
    h.scripts = [];
    rerender(<WebsiteUserScriptsPanel />);
    expect(screen.getByRole("status")).toHaveTextContent("deleted");
    expect(
      screen.queryByRole("button", { name: "Delete website script" }),
    ).not.toBeInTheDocument();
  });
  it("offers explicit save but never execution or automatic permission changes", async () => {
    render(<WebsiteUserScriptsPanel />);
    expect(
      screen.queryByRole("button", { name: /run|execute/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New website script" }));
    fireEvent.change(screen.getByLabelText("Script name"), {
      target: { value: "New fixture" },
    });
    fireEvent.change(screen.getByLabelText("Website JavaScript"), {
      target: { value: "document.body.dataset.fixture = 'yes';" },
    });
    expect(h.save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save website script" }),
    );
    await waitFor(() => expect(h.save).toHaveBeenCalledOnce());
    expect(h.save.mock.calls[0][0]).toMatchObject({
      name: "New fixture",
      kind: "script",
    });
    expect(h.save.mock.calls[0][1]).toBeUndefined();
  });
  it("retains original ID and expected version when editing, duplicates under a new ID", async () => {
    const { rerender } = render(<WebsiteUserScriptsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Website fixture/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit website script" }),
    );
    fireEvent.change(screen.getByLabelText("Script name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save website script" }),
    );
    await waitFor(() => expect(h.save).toHaveBeenCalledOnce());
    expect(h.save.mock.calls[0][0].id).toBe(item.id);
    expect(h.save.mock.calls[0][1]).toEqual(item);
    rerender(<WebsiteUserScriptsPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: "Duplicate website script" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save website script" }),
    );
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
    expect(h.save.mock.calls[1][0].id).not.toBe(item.id);
    expect(h.save.mock.calls[1][1]).toBeUndefined();
  });
  it("requires reviewed deletion and hides all private source when access becomes unavailable", async () => {
    const { rerender } = render(<WebsiteUserScriptsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Website fixture/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Delete website script" }),
    );
    expect(h.remove).not.toHaveBeenCalled();
    expect(
      screen.getByText(/references will remain unresolved/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith(item));
    h.ready = false;
    rerender(<WebsiteUserScriptsPanel />);
    expect(screen.queryByText("document.title")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New website script" }),
    ).not.toBeInTheDocument();
  });
});
