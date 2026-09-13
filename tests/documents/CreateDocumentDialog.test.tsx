import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreateDocumentDialog, {
  type CreateDocumentDialogProps,
} from "../../src/components/documents/CreateDocumentDialog";
import type { DocumentBlock } from "../../src/types/documents/document";
import {
  emptyDatabaseDocuments,
  normalizeDatabaseDocuments,
} from "../../src/utils/documents/validation";
import { initialDocumentBlock } from "../../src/utils/documents/documentBlocks";

const TYPES: readonly DocumentBlock["type"][] = [
  "rich-text",
  "markdown",
  "mermaid",
  "note",
  "wifi",
  "secret",
  "credential",
  "email-account",
  "identity",
  "email",
  "attachment",
  "reference",
  "spreadsheet",
];
const props = (
  extra: Partial<CreateDocumentDialogProps> = {},
): CreateDocumentDialogProps => ({
  isOpen: true,
  onClose: vi.fn(),
  onCreate: vi.fn(),
  folders: [
    { id: "folder-a", name: "Infrastructure" },
    { id: "folder-b", name: "Handover" },
  ],
  initialParentFolderId: null,
  enabledTypes: TYPES,
  ...extra,
});
const name = (value = "Network handover") =>
  fireEvent.change(screen.getByLabelText("Document name"), {
    target: { value },
  });
const submit = () =>
  fireEvent.submit(screen.getByRole("form", { name: "New document details" }));
afterEach(cleanup);

describe("new-document dialog", () => {
  it("uses complete app button recipes and outlined icon/template selection", () => {
    render(<CreateDocumentDialog {...props()} />);
    const choose = screen.getByRole("button", {
      name: "Document icon: Text file",
    });
    expect(choose).toHaveClass("sor-btn", "sor-btn-secondary");
    expect(choose).toHaveAttribute("title", "Choose document icon");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass(
      "sor-btn",
      "sor-btn-secondary",
    );
    expect(screen.getByRole("button", { name: "Create document" })).toHaveClass(
      "sor-btn",
      "sor-btn-primary",
    );
    expect(
      screen.getByRole("radio", { name: "Blank document" }).closest("label"),
    ).toHaveClass("border-primary");
    expect(
      screen.getByRole("radio", { name: "Blank document" }).closest("label"),
    ).not.toHaveClass("bg-primary/10");
    fireEvent.click(choose);
    fireEvent.change(screen.getByLabelText("Search document icons"), {
      target: { value: "Text file" },
    });
    const selectedIcon = within(
      screen.getByRole("group", { name: "Document icons" }),
    ).getByRole("button", { name: "Text file" });
    expect(selectedIcon).toHaveClass("sor-icon-btn", "sor-accent-choice");
    expect(selectedIcon).toHaveAttribute("aria-pressed", "true");
    expect(selectedIcon).not.toHaveClass("bg-primary/10", "ring-primary");
    expect(selectedIcon.querySelector("svg")).not.toBeNull();
  });

  it("creates nothing on open, focuses the name, and cancels without creating", async () => {
    const p = props();
    const { rerender } = render(<CreateDocumentDialog {...p} isOpen={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(p.onCreate).not.toHaveBeenCalled();
    rerender(<CreateDocumentDialog {...p} />);
    expect(
      screen.getByRole("dialog", { name: "Create new document" }),
    ).toHaveClass("sor-modal-panel", "max-w-2xl", "mx-4");
    await waitFor(() =>
      expect(screen.getByLabelText("Document name")).toHaveFocus(),
    );
    expect(
      screen.getByRole("button", { name: "Create document" }),
    ).toBeDisabled();
    expect(p.onCreate).not.toHaveBeenCalled();
    name("Unsaved draft name");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onCreate).not.toHaveBeenCalled();
    rerender(<CreateDocumentDialog {...p} isOpen={false} />);
    rerender(<CreateDocumentDialog {...p} />);
    expect(screen.getByLabelText("Document name")).toHaveValue("");
  });

  it("validates a required trimmed name before the native form submit path", async () => {
    const p = props();
    render(<CreateDocumentDialog {...p} />);
    expect(screen.getByLabelText("Document name")).toBeRequired();
    name("   ");
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent("1–256");
    expect(p.onCreate).not.toHaveBeenCalled();
    name("x".repeat(257));
    submit();
    expect(p.onCreate).not.toHaveBeenCalled();
    name("  Launch checklist  ");
    submit();
    await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1));
    expect(p.onCreate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(p.onCreate).mock.calls[0][0]).toMatchObject({
      name: "Launch checklist",
      parentFolderId: null,
      icon: "file-text",
      blocks: [],
    });
  });

  it("uses the actual searchable folder selector and passive vector catalog", async () => {
    const p = props({ initialParentFolderId: "folder-a" });
    render(<CreateDocumentDialog {...p} />);
    expect(screen.getByLabelText("Destination folder")).toHaveTextContent(
      "Infrastructure",
    );
    fireEvent.click(screen.getByLabelText("Destination folder"));
    fireEvent.change(screen.getByPlaceholderText("Find a folder…"), {
      target: { value: "Hand" },
    });
    fireEvent.mouseDown(screen.getByRole("option", { name: "Handover" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Document icon: Text file" }),
    );
    fireEvent.change(screen.getByLabelText("Search document icons"), {
      target: { value: "Invoice" },
    });
    const icon = within(
      screen.getByRole("group", { name: "Document icons" }),
    ).getByRole("button", { name: "Invoice" });
    expect(icon.querySelector("svg")).not.toBeNull();
    fireEvent.click(icon);
    name();
    submit();
    await waitFor(() => expect(p.onCreate).toHaveBeenCalledTimes(1));
    expect(vi.mocked(p.onCreate).mock.calls[0][0]).toMatchObject({
      icon: "invoice",
      parentFolderId: "folder-b",
    });
  });

  it.each([
    ["Rich text", "rich-text"],
    ["Markdown", "markdown"],
    ["Spreadsheet", "spreadsheet"],
    ["Note", "note"],
    ["Diagram", "mermaid"],
    ["Wi-Fi", "wifi"],
    ["Secret", "secret"],
    ["Credential", "credential"],
    ["Email account", "email-account"],
    ["Personal identity", "identity"],
    ["Email address", "email"],
  ] as const)(
    "creates a valid editable %s starter using the shared defaults",
    async (label, type) => {
      const p = props();
      render(<CreateDocumentDialog {...p} />);
      name();
      fireEvent.click(screen.getByRole("radio", { name: label }));
      if (type === "email-account")
        fireEvent.change(screen.getByLabelText("Email account address"), {
          target: { value: "mailbox@example.test" },
        });
      submit();
      await waitFor(() => expect(p.onCreate).toHaveBeenCalledTimes(1));
      const document = vi.mocked(p.onCreate).mock.calls[0][0];
      expect(document.blocks).toHaveLength(1);
      expect(document.blocks[0].type).toBe(type);
      expect(() =>
        normalizeDatabaseDocuments({
          ...emptyDatabaseDocuments(),
          documents: [document],
        }),
      ).not.toThrow();
      expect(document.blocks[0]).toEqual(expect.objectContaining({ type }));
      if (type === "spreadsheet")
        expect(document.blocks[0]).toMatchObject({
          workbook: { sheets: [{ rows: 100, columns: 26, cells: {} }] },
        });
    },
  );

  it("does not fabricate an attachment or reference target", () => {
    const p = props();
    render(<CreateDocumentDialog {...p} />);
    expect(screen.queryByRole("radio", { name: "Attachment" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Reference" })).toBeNull();
    expect(screen.getByText(/real file or target/)).toBeInTheDocument();
    expect(() => initialDocumentBlock("attachment")).toThrow(
      "Select the target",
    );
    expect(() => initialDocumentBlock("reference")).toThrow(
      "Select the target",
    );
    const first = initialDocumentBlock("rich-text");
    const second = initialDocumentBlock("rich-text");
    expect(first.id).not.toBe(second.id);
    expect(first).not.toBe(second);
  });

  it("requires a real email-account address before creating its starter", async () => {
    const p = props();
    render(<CreateDocumentDialog {...p} />);
    name();
    fireEvent.click(screen.getByRole("radio", { name: "Email account" }));
    submit();
    expect(p.onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter an email address",
    );
    fireEvent.change(screen.getByLabelText("Email account address"), {
      target: { value: "not-an-address" },
    });
    submit();
    expect(p.onCreate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Email account address"), {
      target: { value: "mailbox@example.test" },
    });
    submit();
    await waitFor(() => expect(p.onCreate).toHaveBeenCalledTimes(1));
    expect(vi.mocked(p.onCreate).mock.calls[0][0].blocks[0]).toMatchObject({
      type: "email-account",
      address: "mailbox@example.test",
      username: "",
      password: "",
      tls: true,
    });
  });

  it("disables unavailable types and rechecks policy and destination after a draft change", () => {
    const p = props();
    const { rerender } = render(<CreateDocumentDialog {...p} />);
    name();
    fireEvent.click(screen.getByRole("radio", { name: "Spreadsheet" }));
    rerender(<CreateDocumentDialog {...p} enabledTypes={["note"]} />);
    expect(screen.getByRole("radio", { name: "Spreadsheet" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Create document" }),
    ).toBeDisabled();
    submit();
    expect(p.onCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Note" }));
    fireEvent.click(screen.getByLabelText("Destination folder"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Infrastructure" }));
    rerender(
      <CreateDocumentDialog {...p} enabledTypes={["note"]} folders={[]} />,
    );
    expect(
      screen.getByRole("button", { name: "Create document" }),
    ).toBeDisabled();
    submit();
    expect(p.onCreate).not.toHaveBeenCalled();
    expect(
      screen
        .getAllByRole("alert")
        .some((item) => item.textContent?.includes("folder")),
    ).toBe(true);
  });

  it("blocks duplicate submission and closing while creating; allows an explicit retry after a safe error", async () => {
    let reject!: (error: Error) => void;
    const create = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue(undefined);
    const p = props({ onCreate: create });
    render(<CreateDocumentDialog {...p} />);
    name();
    submit();
    submit();
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("create-document-dialog"));
    expect(p.onClose).not.toHaveBeenCalled();
    await act(async () => reject(new Error("private database path/secret")));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not create");
    expect(document.body.textContent).not.toContain(
      "private database path/secret",
    );
    expect(screen.getByLabelText("Document name")).toHaveValue(
      "Network handover",
    );
    submit();
    await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("ignores a late completion after its owner-keyed dialog unmounts", async () => {
    let finish!: () => void;
    const p = props({
      onCreate: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { rerender } = render(<CreateDocumentDialog key="owner-a" {...p} />);
    name("Owner A draft");
    submit();
    const next = props();
    rerender(<CreateDocumentDialog key="owner-b" {...next} />);
    name("Owner B draft");
    await act(async () => finish());
    expect(p.onClose).not.toHaveBeenCalled();
    expect(next.onClose).not.toHaveBeenCalled();
    expect(next.onCreate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Document name")).toHaveValue("Owner B draft");
  });

  it("cannot submit while owner access or policy is unavailable", () => {
    const p = props();
    const { rerender } = render(<CreateDocumentDialog {...p} />);
    name();
    rerender(<CreateDocumentDialog {...p} disabled />);
    expect(
      screen.getByRole("button", { name: "Create document" }),
    ).toBeDisabled();
    submit();
    expect(p.onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "content settings are ready",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not bypass an all-disabled database through Blank, but permits a file-only draft", async () => {
    const p = props({ enabledTypes: [] });
    const { rerender } = render(<CreateDocumentDialog {...p} />);
    name();
    expect(
      screen.getByRole("radio", { name: "Blank document" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Create document" }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("content settings");
    submit();
    expect(p.onCreate).not.toHaveBeenCalled();
    rerender(<CreateDocumentDialog {...p} enabledTypes={["attachment"]} />);
    expect(screen.getByRole("radio", { name: "Blank document" })).toBeEnabled();
    submit();
    await waitFor(() => expect(p.onCreate).toHaveBeenCalledTimes(1));
    expect(vi.mocked(p.onCreate).mock.calls[0][0].blocks).toEqual([]);
  });
});
