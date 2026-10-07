import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DocumentEditorHeader, {
  type DocumentEditorHeaderProps,
} from "../../src/components/documents/DocumentEditorHeader";
import { fixture } from "./fixtures";

const folders: DocumentEditorHeaderProps["folders"] = [
  { id: "east", name: "East" },
  { id: "east-team", name: "Team", parentId: "east" },
  { id: "east-reports", name: "Reports", parentId: "east-team" },
  { id: "west", name: "West" },
  { id: "west-team", name: "Team", parentId: "west" },
  { id: "west-reports", name: "Reports", parentId: "west-team" },
];
const props = (
  extra: Partial<DocumentEditorHeaderProps> = {},
): DocumentEditorHeaderProps => ({
  document: fixture().documents[0],
  folders,
  scope: "database",
  busy: false,
  saving: false,
  dirty: false,
  valid: true,
  stale: false,
  onChange: vi.fn(),
  onSave: vi.fn(),
  onBrowse: vi.fn(),
  onPrint: vi.fn(),
  onExport: vi.fn(),
  onDelete: vi.fn(),
  ...extra,
});
afterEach(cleanup);

describe("document editor header", () => {
  it("exposes the document Name and emits only a draft name patch", () => {
    const p = props();
    const original = structuredClone(p.document);
    const view = render(<DocumentEditorHeader {...p} />);
    const header = screen.getByLabelText("Document editor header");
    const name = within(header).getByRole("textbox", { name: "Name" });
    expect(name).toBeVisible();
    expect(name).toHaveValue("Inventory");
    expect(name).toHaveAttribute("maxlength", "256");
    expect(
      within(header).getByLabelText("Document location"),
    ).toHaveTextContent(/Database\s*\/\s*Documents/);
    fireEvent.change(name, { target: { value: "  Renamed draft  " } });
    expect(p.onChange).toHaveBeenCalledExactlyOnceWith({
      name: "  Renamed draft  ",
    });
    expect(p.document).toEqual(original);
    expect(p.onSave).not.toHaveBeenCalled();
    view.rerender(
      <DocumentEditorHeader
        {...p}
        document={{ ...p.document, name: "  Renamed draft  " }}
        dirty
      />,
    );
    expect(name).toHaveValue("  Renamed draft  ");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Unsaved library changes",
    );
  });

  it("searches full ancestor paths and selects the correct duplicate leaf by ID", () => {
    const p = props();
    const view = render(<DocumentEditorHeader {...p} />);
    const folder = screen.getByRole("combobox", { name: "Owning folder" });
    expect(folder).toHaveTextContent("Database root");
    fireEvent.click(folder);
    expect(
      screen.getByRole("option", { name: "East / Team / Reports" }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", { name: "West / Team / Reports" }),
    ).toBeVisible();
    const search = screen.getByRole("textbox", { name: "Search folders…" });
    fireEvent.change(search, { target: { value: "wEsT reports" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(
      screen.queryByRole("option", { name: "East / Team / Reports" }),
    ).not.toBeInTheDocument();
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "West / Team / Reports" }),
    );
    expect(p.onChange).toHaveBeenCalledExactlyOnceWith({
      parentFolderId: "west-reports",
    });
    expect(p.onSave).not.toHaveBeenCalled();
    view.rerender(
      <DocumentEditorHeader
        {...p}
        document={{ ...p.document, parentFolderId: "west-reports" }}
      />,
    );
    expect(folder).toHaveTextContent("West / Team / Reports");
    expect(screen.getByLabelText("Document location")).toHaveTextContent(
      "West / Team / Reports",
    );
    fireEvent.click(folder);
    fireEvent.mouseDown(screen.getByRole("option", { name: "Database root" }));
    expect(p.onChange).toHaveBeenLastCalledWith({ parentFolderId: null });
    expect(p.onChange).toHaveBeenCalledTimes(2);
  });

  it("preserves a missing owning folder until the user explicitly chooses a destination", () => {
    const p = props();
    p.document.parentFolderId = "missing-folder";
    render(<DocumentEditorHeader {...p} />);
    const folder = screen.getByRole("combobox", { name: "Owning folder" });
    expect(folder).toHaveTextContent("Unavailable folder");
    expect(folder).not.toHaveTextContent("Database root");
    expect(screen.getByLabelText("Document location")).toHaveTextContent(
      "Unavailable folder",
    );
    expect(p.onChange).not.toHaveBeenCalled();
    fireEvent.click(folder);
    const missing = screen.getByRole("option", { name: "Unavailable folder" });
    expect(missing).toHaveAttribute("aria-selected", "true");
    expect(missing).toHaveAttribute("aria-disabled", "true");
    fireEvent.mouseDown(missing);
    expect(p.onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Rename without moving" },
    });
    expect(p.onChange).toHaveBeenCalledExactlyOnceWith({
      name: "Rename without moving",
    });
    expect(p.document.parentFolderId).toBe("missing-folder");
    fireEvent.mouseDown(screen.getByRole("option", { name: "Database root" }));
    expect(p.onChange).toHaveBeenLastCalledWith({ parentFolderId: null });
    expect(p.onSave).not.toHaveBeenCalled();
  });

  it("keeps folders searchable and selectable when ancestor links contain cycles or gaps", () => {
    const p = props({
      folders: [
        { id: "self", name: "Self", parentId: "self" },
        { id: "alpha", name: "Alpha", parentId: "beta" },
        { id: "beta", name: "Beta", parentId: "alpha" },
        { id: "orphan", name: "Orphan", parentId: "missing-parent" },
      ],
    });
    render(<DocumentEditorHeader {...p} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Owning folder" }));
    expect(screen.getAllByRole("option")).toHaveLength(5);
    expect(screen.getByRole("option", { name: "Self" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Orphan" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Alpha / Beta" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Beta / Alpha" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Search folders…" }), {
      target: { value: "alpha beta" },
    });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.mouseDown(screen.getByRole("option", { name: "Beta / Alpha" }));
    expect(p.onChange).toHaveBeenCalledExactlyOnceWith({
      parentFolderId: "alpha",
    });
    expect(p.onSave).not.toHaveBeenCalled();
  });

  it("restricts app scope to its disabled root even if database folders are supplied", () => {
    const p = props({ scope: "app" });
    p.document.parentFolderId = "east-reports";
    render(<DocumentEditorHeader {...p} />);
    const folder = screen.getByRole("combobox", { name: "Owning folder" });
    expect(folder).toHaveTextContent("App-wide root");
    expect(folder).toBeDisabled();
    expect(screen.getByLabelText("Document location")).toHaveTextContent(
      /App-wide\s*\/\s*Documents/,
    );
    fireEvent.click(folder);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/East|West|Database root/),
    ).not.toBeInTheDocument();
    expect(p.onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Name" })).toBeEnabled();
  });

  it("emits an icon draft patch from the actual compact picker", () => {
    const p = props();
    render(<DocumentEditorHeader {...p} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Document icon: Text file" }),
    );
    const picker = within(
      screen.getByRole("dialog", { name: "Choose document icon" }),
    );
    fireEvent.change(
      picker.getByRole("textbox", { name: "Search document icons" }),
      {
        target: { value: "Invoice" },
      },
    );
    fireEvent.click(picker.getByRole("button", { name: "Invoice" }));
    expect(p.onChange).toHaveBeenCalledExactlyOnceWith({ icon: "invoice" });
    expect(p.document.icon).toBe("file-text");
    expect(p.onSave).not.toHaveBeenCalled();
  });

  it.each([
    ["Browse", "onBrowse"],
    ["Print", "onPrint"],
    ["Export text", "onExport"],
    ["Delete", "onDelete"],
  ] as const)(
    "dispatches %s without saving or patching the document",
    (label, callback) => {
      const p = props();
      render(<DocumentEditorHeader {...p} />);
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(p[callback]).toHaveBeenCalledOnce();
      for (const other of [
        "onBrowse",
        "onPrint",
        "onExport",
        "onDelete",
      ] as const)
        if (other !== callback) expect(p[other]).not.toHaveBeenCalled();
      expect(p.onSave).not.toHaveBeenCalled();
      expect(p.onChange).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      state: "saved",
      dirty: false,
      valid: true,
      busy: false,
      saving: false,
      stale: false,
      status: "Library saved",
      enabled: false,
    },
    {
      state: "unsaved",
      dirty: true,
      valid: true,
      busy: false,
      saving: false,
      stale: false,
      status: "Unsaved library changes",
      enabled: true,
    },
    {
      state: "pending review",
      dirty: true,
      valid: false,
      busy: false,
      saving: false,
      stale: false,
      status: "Review pending changes",
      enabled: false,
    },
    {
      state: "review without serialized changes",
      dirty: false,
      valid: false,
      busy: false,
      saving: false,
      stale: false,
      status: "Review pending changes",
      enabled: false,
    },
    {
      state: "busy",
      dirty: true,
      valid: true,
      busy: true,
      saving: false,
      stale: false,
      status: "Unsaved library changes",
      enabled: false,
    },
    {
      state: "saving",
      dirty: true,
      valid: true,
      busy: true,
      saving: true,
      stale: false,
      status: "Saving library…",
      enabled: false,
    },
    {
      state: "stale",
      dirty: true,
      valid: true,
      busy: false,
      saving: false,
      stale: true,
      status: "Reload required · draft retained",
      enabled: false,
    },
  ])(
    "announces $state library status and gates Save",
    ({ state: _state, status, enabled, ...flags }) => {
      const p = props(flags);
      render(<DocumentEditorHeader {...p} />);
      expect(screen.getByRole("status")).toHaveTextContent(status);
      const save = screen.getByRole("button", {
        name: p.saving ? "Saving…" : "Save",
      });
      expect(save).toHaveAttribute("aria-keyshortcuts", "Control+s Meta+s");
      if (enabled) expect(save).toBeEnabled();
      else expect(save).toBeDisabled();
      fireEvent.click(save);
      expect(p.onSave).toHaveBeenCalledTimes(enabled ? 1 : 0);
      expect(p.onChange).not.toHaveBeenCalled();
    },
  );

  it.each(["busy", "stale"] as const)("disables mutations when %s", (state) => {
    const p = props({ dirty: true, [state]: true });
    render(<DocumentEditorHeader {...p} />);
    expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
    for (const control of [
      screen.getByRole("combobox", { name: "Owning folder" }),
      screen.getByRole("button", { name: "Document icon: Text file" }),
      screen.getByRole("button", { name: "Delete" }),
      screen.getByRole("button", { name: "Save" }),
    ]) {
      expect(control).toBeDisabled();
      fireEvent.click(control);
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(p.onChange).not.toHaveBeenCalled();
    expect(p.onDelete).not.toHaveBeenCalled();
    expect(p.onSave).not.toHaveBeenCalled();
    for (const label of ["Browse", "Print", "Export text"]) {
      const button = screen.getByRole("button", { name: label });
      if (state === "busy") expect(button).toBeDisabled();
      else expect(button).toBeEnabled();
    }
  });

  it("blocks browsing and output while a review is pending, keeping draft controls editable", () => {
    const p = props({ dirty: true, valid: false });
    render(<DocumentEditorHeader {...p} />);
    for (const label of ["Browse", "Print", "Export text", "Save"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(p.onBrowse).not.toHaveBeenCalled();
    expect(p.onPrint).not.toHaveBeenCalled();
    expect(p.onExport).not.toHaveBeenCalled();
    expect(p.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Name" })).toBeEnabled();
    expect(
      screen.getByRole("combobox", { name: "Owning folder" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Document icon: Text file" }),
    ).toBeEnabled();
  });
});
