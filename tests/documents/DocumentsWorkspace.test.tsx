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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DocumentsWorkspace from "../../src/components/documents/DocumentsWorkspace";
import type { DocumentBlockEditorProps } from "../../src/components/documents/DocumentBlockEditor";
import type { SpreadsheetEditorProps } from "../../src/components/documents/SpreadsheetEditor";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type {
  DatabaseDocumentStore,
  DatabaseDocuments,
} from "../../src/types/documents/document";
import { getDocumentDraft } from "../../src/utils/documents/documentDrafts";
import { fixture } from "./fixtures";
import type { DatabaseDocumentType } from "../../src/types/settings/databaseSettings";
import { normalizeDatabaseDocuments } from "../../src/utils/documents/validation";
import { DOCUMENT_TYPE_OPTIONS } from "../../src/utils/documents/documentTypePolicy";
import { createDocumentAttachment } from "../../src/utils/documents/documentAttachments";
import styles from "../../src/components/documents/documents.module.css";

const mock = vi.hoisted(() => ({
  searchDocumentContents: false,
  ready: true,
  policyReady: true,
  disabledTypes: [] as DatabaseDocumentType[],
  store: undefined as DatabaseDocumentStore | undefined,
  appStore: undefined as DatabaseDocumentStore | undefined,
  connections: [] as Connection[],
  sheets: new Map<string, SpreadsheetEditorProps>(),
  open: vi.fn(),
  save: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
  importResult: vi.fn(),
  exportResult: vi.fn(),
  toast: {
    loading: vi.fn(() => "document-save"),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({
    settings: { searchDocumentContents: mock.searchDocumentContents },
  }),
}));
vi.mock("../../src/hooks/documents/useAppDocumentsStore", () => ({
  useAppDocumentsStore: () => mock.appStore,
}));
vi.mock("../../src/hooks/settings/useCurrentDatabaseSettings", () => ({
  useCurrentDatabaseSettings: () => ({
    settings: mock.policyReady
      ? { version: 1, documentTypes: { disabled: mock.disabledTypes } }
      : null,
    scope: mock.policyReady ? mock.store?.scope : null,
    loading: !mock.policyReady,
    error: null,
  }),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: mock.connections },
    documents: mock.store,
    databaseAvailability: {
      status: mock.ready ? "ready" : "suspended",
      databaseId: "db-a",
      generation: 1,
    },
  }),
}));
vi.mock("../../src/contexts/ToastContext", async () => {
  const { createContext } = await import("react");
  return { ToastContext: createContext({ toast: mock.toast }) };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mock.open,
  save: mock.save,
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: mock.readFile,
  writeFile: mock.writeFile,
  stat: mock.stat,
}));
vi.mock("../../src/utils/security/passwordPolicy", () => ({
  validateNewPassword: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/components/connection/editor/ConnectionIconPicker", () => ({
  ConnectionIconPicker: () => null,
}));
vi.mock("../../src/components/documents/DocumentReferencePicker", () => ({
  default: () => null,
}));
vi.mock("../../src/components/documents/SpreadsheetEditor", () => ({
  default: (props: SpreadsheetEditorProps) => {
    mock.sheets.set(props.documentKey, props);
    return (
      <div data-testid="mock-spreadsheet">
        <button onClick={() => props.onValidityChange?.(false)}>
          Pending spreadsheet review
        </button>
        <button onClick={() => props.onValidityChange?.(true)}>
          Accept spreadsheet review
        </button>
        <button
          onClick={() => {
            void props.onImport?.().then(mock.importResult);
          }}
        >
          Import spreadsheet fixture
        </button>
        <button
          onClick={() => {
            void props
              .onExport?.({
                name: "fixture.csv",
                mimeType: "text/csv",
                bytes: new TextEncoder().encode("fixture"),
              })
              .then(mock.exportResult);
          }}
        >
          Export spreadsheet fixture
        </button>
      </div>
    );
  },
}));
vi.mock("../../src/components/documents/DocumentBlockEditor", () => ({
  default: (props: DocumentBlockEditorProps) => (
    <div>
      {props.blocks.map((block) =>
        block.type === "spreadsheet" ? (
          <React.Fragment key={block.id}>
            {props.renderSpreadsheet?.(
              block,
              (workbook) =>
                props.onChange(
                  props.blocks.map((value) =>
                    value.id === block.id ? { ...block, workbook } : value,
                  ),
                ),
              !!props.readOnly,
            )}
          </React.Fragment>
        ) : block.type === "reference" ? (
          <button
            key={block.id}
            onClick={() => props.onReference?.(block.reference)}
          >
            {block.label}
          </button>
        ) : block.type === "attachment" ? (
          <button
            key={block.id}
            onClick={() =>
              props.onChange(
                props.blocks.filter((entry) => entry.id !== block.id),
              )
            }
          >
            Remove attachment fixture
          </button>
        ) : null,
      )}
    </div>
  ),
}));

type Request = NonNullable<ConnectionSession["documentsWorkspace"]>;
const request: Request = {
  databaseId: "db-a",
  requestId: "open-1",
  documentId: "doc",
};
let saved: DatabaseDocuments;
beforeEach(() => {
  vi.clearAllMocks();
  mock.searchDocumentContents = false;
  mock.ready = true;
  mock.appStore = undefined;
  mock.policyReady = true;
  mock.disabledTypes = [];
  mock.sheets.clear();
  mock.open.mockReset().mockResolvedValue(null);
  mock.save.mockReset().mockResolvedValue(null);
  mock.stat.mockReset().mockResolvedValue({ size: 4 });
  mock.readFile.mockReset().mockResolvedValue(new TextEncoder().encode("cell"));
  mock.writeFile.mockReset().mockResolvedValue(undefined);
  saved = fixture();
  const other = structuredClone(saved.documents[0]);
  other.id = "other-doc";
  other.name = "Other document";
  saved.documents.push(other);
  saved.documents[0].blocks.push(
    {
      id: "cell-link",
      type: "reference",
      label: "Follow cell",
      reference: {
        databaseId: "db-a",
        kind: "cell",
        id: "other-doc",
        blockId: "sheet",
        sheetId: "main",
        address: "B3",
      },
    },
    {
      id: "host-link",
      type: "reference",
      label: "Open linked connection",
      reference: { databaseId: "db-a", kind: "connection", id: "host" },
    },
    {
      id: "foreign-link",
      type: "reference",
      label: "Open foreign connection",
      reference: { databaseId: "foreign", kind: "connection", id: "host" },
    },
  );
  mock.connections = [
    {
      id: "host",
      name: "Synthetic host",
      protocol: "ssh",
      hostname: "fixture.invalid",
      port: 22,
      isGroup: false,
      createdAt: "2026-09-10",
      updatedAt: "2026-09-10",
    },
  ];
  mock.store = {
    scope: { databaseId: "db-a", generation: 1 },
    changeRevision: 0,
    read: vi.fn(async () => structuredClone(saved)),
    compareAndSwap: vi.fn(async (_scope, expected, replacement) => {
      expect(expected).toEqual(saved);
      saved = structuredClone(replacement);
    }),
  };
});
afterEach(cleanup);
function show(
  next = request,
  onOpenConnection = vi.fn(),
  onChangeScope = vi.fn(),
) {
  return {
    ...render(
      <DocumentsWorkspace
        sessionId="workspace-tab"
        request={next}
        onOpenConnection={onOpenConnection}
        onChangeScope={onChangeScope}
      />,
    ),
    onOpenConnection,
    onChangeScope,
  };
}
const loaded = async () => {
  await screen.findByDisplayValue("Inventory");
  await screen.findByTestId("mock-spreadsheet");
};
const editorHeader = () =>
  within(screen.getByLabelText("Document editor header"));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("protected document workspace integration", () => {
  it("searches ordinary document contents only with explicit opt-in, never structured secrets", async () => {
    const view = show();
    await loaded();
    const query = screen.getByLabelText("Search documents and records");
    fireEvent.change(query, { target: { value: "Fixture" } });
    expect(screen.queryByRole("button", { name: "Open Inventory" })).toBeNull();
    mock.searchDocumentContents = true;
    view.rerender(
      <DocumentsWorkspace sessionId="workspace-tab" request={request} />,
    );
    expect(
      screen.getByRole("button", { name: "Open Inventory" }),
    ).toBeInTheDocument();
    fireEvent.change(query, { target: { value: "PRIVATE_FIXTURE" } });
    expect(screen.queryByRole("button", { name: "Open Inventory" })).toBeNull();
    fireEvent.change(query, { target: { value: "Linked host" } });
    expect(
      screen.getByRole("button", { name: "Open Inventory" }),
    ).toBeInTheDocument();
    mock.searchDocumentContents = false;
    view.rerender(
      <DocumentsWorkspace sessionId="workspace-tab" request={request} />,
    );
    expect(screen.queryByRole("button", { name: "Open Inventory" })).toBeNull();
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
  });

  it("undoes and redoes document edits as drafts, preserving other records and requiring Save", async () => {
    show();
    await loaded();
    const name = screen.getByRole("textbox", { name: "Name" });
    expect(
      screen.getByRole("button", { name: "Undo document edit" }),
    ).toBeDisabled();
    fireEvent.change(name, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Undo document edit" }));
    expect(name).toHaveValue("Inventory");
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Redo document edit" }));
    expect(name).toHaveValue("Renamed");
    const other = structuredClone(saved.documents[1]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(),
    );
    expect(saved.documents[0].name).toBe("Renamed");
    expect(saved.documents[1]).toEqual(other);
    fireEvent.click(screen.getByRole("button", { name: "Undo document edit" }));
    expect(name).toHaveValue("Inventory");
    expect(saved.documents[0].name).toBe("Renamed");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("clears edit history on scope changes and blocks it during a pending spreadsheet review", async () => {
    const view = show();
    await loaded();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Pending spreadsheet review" }),
    );
    expect(
      screen.getByRole("button", { name: "Undo document edit" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Accept spreadsheet review" }),
    );
    expect(
      screen.getByRole("button", { name: "Undo document edit" }),
    ).toBeEnabled();
    mock.store!.scope = { databaseId: "db-a", generation: 2 };
    view.rerender(
      <DocumentsWorkspace sessionId="workspace-tab" request={request} />,
    );
    await screen.findByDisplayValue("Inventory");
    expect(
      screen.getByRole("button", { name: "Undo document edit" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Redo document edit" }),
    ).toBeDisabled();
  });

  it("restores removed attachment bytes with Undo without changing other documents", async () => {
    const attachment = await createDocumentAttachment(
      new TextEncoder().encode("Attachment fixture"),
      "fixture.txt",
      "text/plain",
    );
    saved.attachments.push(attachment);
    saved.documents[0].blocks.push({
      id: "attachment-block",
      type: "attachment",
      attachmentId: attachment.id,
      caption: "Fixture",
    });
    const other = structuredClone(saved.documents[1]);
    show();
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove attachment fixture" }),
    );
    expect(
      screen.queryByRole("button", { name: "Remove attachment fixture" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo document edit" }));
    expect(
      screen.getByRole("button", { name: "Remove attachment fixture" }),
    ).toBeInTheDocument();
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(),
    );
    expect(saved.attachments).toEqual([attachment]);
    expect(saved.documents[0].blocks).toContainEqual({
      id: "attachment-block",
      type: "attachment",
      attachmentId: attachment.id,
      caption: "Fixture",
    });
    expect(saved.documents[1]).toEqual(other);
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
  ] as const)(
    "saves from Name with %s+S once, ignores repeats, and waits for durable readback",
    async (_label, modifier) => {
      const pendingWrite = deferred<void>();
      const pendingReadback = deferred<void>();
      const write = mock.store!.compareAndSwap;
      mock.store!.compareAndSwap = vi.fn(
        async (scope, expected, replacement) => {
          await pendingWrite.promise;
          await write(scope, expected, replacement);
        },
      );
      const original = structuredClone(saved);
      show();
      await loaded();
      expect(editorHeader().getByRole("status")).toHaveTextContent(
        "Library saved",
      );
      expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
      expect(
        editorHeader().getByRole("button", { name: "Save" }),
      ).toBeDisabled();
      vi.mocked(mock.store!.read).mockImplementationOnce(async () => {
        await pendingReadback.promise;
        return structuredClone(saved);
      });
      const name = editorHeader().getByRole("textbox", { name: "Name" });
      name.focus();
      fireEvent.change(name, { target: { value: "Saved from the title" } });
      expect(name).toHaveFocus();
      expect(editorHeader().getByRole("status")).toHaveTextContent(
        "Unsaved library changes",
      );
      expect(saved).toEqual(original);
      expect(
        fireEvent.keyDown(name, { key: "s", ...modifier, repeat: true }),
      ).toBe(false);
      expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
      expect(fireEvent.keyDown(name, { key: "s", ...modifier })).toBe(false);
      expect(mock.store!.compareAndSwap).toHaveBeenCalledOnce();
      expect(editorHeader().getByRole("status")).toHaveTextContent(
        "Saving library…",
      );
      expect(name).toBeDisabled();
      expect(
        editorHeader().getByRole("button", { name: "Saving…" }),
      ).toBeDisabled();
      fireEvent.keyDown(name, { key: "s", ...modifier, repeat: true });
      fireEvent.keyDown(name, { key: "s", ...modifier });
      expect(mock.store!.compareAndSwap).toHaveBeenCalledOnce();
      await act(async () => pendingWrite.resolve());
      await waitFor(() =>
        expect(saved.documents[0].name).toBe("Saved from the title"),
      );
      expect(editorHeader().getByRole("status")).toHaveTextContent(
        "Saving library…",
      );
      expect(getDocumentDraft("workspace-tab")?.dirty).toBe(true);
      expect(mock.toast.update).not.toHaveBeenCalled();
      await act(async () => pendingReadback.resolve());
      await waitFor(() =>
        expect(editorHeader().getByRole("status")).toHaveTextContent(
          "Library saved",
        ),
      );
      expect(name).toBeEnabled();
      expect(
        editorHeader().getByRole("button", { name: "Save" }),
      ).toBeDisabled();
      expect(saved.revision).toBe(original.revision + 1);
      expect(saved.documents[0].blocks).toEqual(original.documents[0].blocks);
      expect(saved.documents[1]).toEqual(original.documents[1]);
      expect(getDocumentDraft("workspace-tab")?.dirty).toBe(false);
      fireEvent.keyDown(name, { key: "s", ...modifier });
      expect(mock.store!.compareAndSwap).toHaveBeenCalledOnce();
      expect(mock.toast.update).toHaveBeenCalledExactlyOnceWith(
        "document-save",
        expect.objectContaining({ type: "success" }),
      );
    },
  );

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
  ] as const)(
    "refuses %s+S during pending spreadsheet review and saves after acceptance",
    async (_label, modifier) => {
      show();
      await loaded();
      const name = editorHeader().getByRole("textbox", { name: "Name" });
      fireEvent.change(name, { target: { value: "Review before saving" } });
      fireEvent.click(
        screen.getByRole("button", { name: "Pending spreadsheet review" }),
      );
      name.focus();
      expect(editorHeader().getByRole("status")).toHaveTextContent(
        "Review pending changes",
      );
      expect(
        editorHeader().getByRole("button", { name: "Save" }),
      ).toBeDisabled();
      expect(fireEvent.keyDown(name, { key: "s", ...modifier })).toBe(false);
      expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
      expect(mock.toast.loading).not.toHaveBeenCalled();
      expect(saved.documents[0].name).toBe("Inventory");
      fireEvent.click(
        screen.getByRole("button", { name: "Accept spreadsheet review" }),
      );
      expect(
        editorHeader().getByRole("button", { name: "Save" }),
      ).toBeEnabled();
      fireEvent.keyDown(name, { key: "s", ...modifier });
      await waitFor(() =>
        expect(editorHeader().getByRole("status")).toHaveTextContent(
          "Library saved",
        ),
      );
      expect(mock.store!.compareAndSwap).toHaveBeenCalledOnce();
      expect(saved.documents[0].name).toBe("Review before saving");
    },
  );

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
  ] as const)(
    "does not handle %s+S outside the document editor or in its portals",
    async (_label, modifier) => {
      const view = show();
      await loaded();
      fireEvent.change(editorHeader().getByRole("textbox", { name: "Name" }), {
        target: { value: "Keep this draft local" },
      });
      const shortcut = { key: "s", ...modifier };
      for (const target of [
        window,
        document.body,
        screen.getByRole("textbox", { name: "Search documents and records" }),
      ])
        expect(fireEvent.keyDown(target, shortcut)).toBe(true);
      fireEvent.click(
        editorHeader().getByRole("combobox", { name: "Owning folder" }),
      );
      const search = screen.getByRole("textbox", { name: "Search folders…" });
      expect(screen.getByRole("main")).not.toContainElement(search);
      expect(fireEvent.keyDown(search, shortcut)).toBe(true);
      fireEvent.keyDown(search, { key: "Escape" });
      fireEvent.click(
        editorHeader().getByRole("button", {
          name: "Document icon: Text file",
        }),
      );
      const picker = screen.getByRole("dialog", {
        name: "Choose document icon",
      });
      expect(screen.getByRole("main")).not.toContainElement(picker);
      expect(
        fireEvent.keyDown(
          within(picker).getByRole("textbox", {
            name: "Search document icons",
          }),
          shortcut,
        ),
      ).toBe(true);
      fireEvent.keyDown(picker, { key: "Escape" });
      fireEvent.click(editorHeader().getByRole("button", { name: "Browse" }));
      expect(
        screen.queryByLabelText("Document editor header"),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
      expect(fireEvent.keyDown(screen.getByRole("main"), shortcut)).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "People" }));
      expect(fireEvent.keyDown(screen.getByRole("main"), shortcut)).toBe(true);
      expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
      expect(saved.documents[0].name).toBe("Inventory");
      view.unmount();
      expect(fireEvent.keyDown(window, shortcut)).toBe(true);
      expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
    },
  );

  it("leaves modified and already-handled key combinations alone", async () => {
    show();
    await loaded();
    const name = editorHeader().getByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value: "Still a draft" } });
    for (const modifiers of [
      {},
      { ctrlKey: true, shiftKey: true },
      { metaKey: true, shiftKey: true },
      { ctrlKey: true, altKey: true },
      { metaKey: true, altKey: true },
    ])
      expect(fireEvent.keyDown(name, { key: "s", ...modifiers })).toBe(true);
    const handled = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    handled.preventDefault();
    fireEvent(name, handled);
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
    expect(saved.documents[0].name).toBe("Inventory");
  });

  it("keeps Name, icon and folder changes in the library draft until a single save", async () => {
    mock.connections.push(
      { ...mock.connections[0], id: "east", name: "East", isGroup: true },
      { ...mock.connections[0], id: "west", name: "West", isGroup: true },
      {
        ...mock.connections[0],
        id: "east-reports",
        name: "Reports",
        parentId: "east",
        isGroup: true,
      },
      {
        ...mock.connections[0],
        id: "west-reports",
        name: "Reports",
        parentId: "west",
        isGroup: true,
      },
    );
    const original = structuredClone(saved);
    show();
    await loaded();
    fireEvent.change(editorHeader().getByRole("textbox", { name: "Name" }), {
      target: { value: "Moved inventory" },
    });
    fireEvent.click(
      editorHeader().getByRole("combobox", { name: "Owning folder" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search folders…" }), {
      target: { value: "west reports" },
    });
    fireEvent.mouseDown(screen.getByRole("option", { name: "West / Reports" }));
    expect(
      editorHeader().getByRole("combobox", { name: "Owning folder" }),
    ).toHaveTextContent("West / Reports");
    fireEvent.click(
      editorHeader().getByRole("button", { name: "Document icon: Text file" }),
    );
    const picker = within(
      screen.getByRole("dialog", { name: "Choose document icon" }),
    );
    fireEvent.change(
      picker.getByRole("textbox", { name: "Search document icons" }),
      { target: { value: "Invoice" } },
    );
    fireEvent.click(picker.getByRole("button", { name: "Invoice" }));
    expect(
      editorHeader().getByRole("button", { name: "Document icon: Invoice" }),
    ).toBeVisible();
    expect(saved).toEqual(original);
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
    expect(getDocumentDraft("workspace-tab")?.dirty).toBe(true);
    fireEvent.click(editorHeader().getByRole("button", { name: "Browse" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open Other document" }),
    );
    expect(editorHeader().getByRole("status")).toHaveTextContent(
      "Unsaved library changes",
    );
    fireEvent.click(editorHeader().getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(editorHeader().getByRole("status")).toHaveTextContent(
        "Library saved",
      ),
    );
    expect(mock.store!.compareAndSwap).toHaveBeenCalledOnce();
    expect(saved.documents[0]).toMatchObject({
      name: "Moved inventory",
      icon: "invoice",
      parentFolderId: "west-reports",
    });
    expect(saved.documents[0].blocks).toEqual(original.documents[0].blocks);
    expect(saved.documents[1]).toEqual(original.documents[1]);
    expect(saved.revision).toBe(original.revision + 1);
    fireEvent.click(
      screen.getByRole("button", { name: "Open Moved inventory" }),
    );
    expect(editorHeader().getByRole("textbox", { name: "Name" })).toHaveValue(
      "Moved inventory",
    );
    expect(
      editorHeader().getByRole("combobox", { name: "Owning folder" }),
    ).toHaveTextContent("West / Reports");
    fireEvent.click(
      editorHeader().getByRole("button", { name: "Document icon: Invoice" }),
    );
    const selectedPicker = within(
      screen.getByRole("dialog", { name: "Choose document icon" }),
    );
    fireEvent.change(
      selectedPicker.getByRole("textbox", { name: "Search document icons" }),
      { target: { value: "Invoice" } },
    );
    expect(
      selectedPicker.getByRole("button", { name: "Invoice" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("preserves a missing folder when a header rename is saved", async () => {
    saved.documents[0].parentFolderId = "removed-folder";
    show();
    await loaded();
    expect(
      editorHeader().getByRole("combobox", { name: "Owning folder" }),
    ).toHaveTextContent("Unavailable folder");
    fireEvent.change(editorHeader().getByRole("textbox", { name: "Name" }), {
      target: { value: "Still in the missing folder" },
    });
    fireEvent.click(editorHeader().getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(editorHeader().getByRole("status")).toHaveTextContent(
        "Library saved",
      ),
    );
    expect(mock.store!.compareAndSwap).toHaveBeenCalledOnce();
    expect(saved.documents[0]).toMatchObject({
      name: "Still in the missing folder",
      parentFolderId: "removed-folder",
    });
    expect(
      editorHeader().getByRole("combobox", { name: "Owning folder" }),
    ).toHaveTextContent("Unavailable folder");
  });

  it("shows the default Database selector when no database is available", async () => {
    mock.ready = false;
    const { onChangeScope } = show();
    const selector = screen.getByRole("combobox", {
      name: "Document storage scope",
    });
    expect(selector).toHaveTextContent("Database");
    fireEvent.click(selector);
    fireEvent.mouseDown(screen.getByRole("option", { name: "App-wide" }));
    expect(onChangeScope).toHaveBeenCalledExactlyOnceWith("app");
    expect(mock.store!.read).not.toHaveBeenCalled();
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
  });

  it("opens the other scope through a callback and blocks dirty or pending editor drafts", async () => {
    const { onChangeScope } = show();
    await loaded();
    const selector = screen.getByRole("combobox", {
      name: "Document storage scope",
    });
    fireEvent.click(selector);
    fireEvent.mouseDown(screen.getByRole("option", { name: "App-wide" }));
    expect(onChangeScope).toHaveBeenCalledExactlyOnceWith("app");
    expect(screen.getByLabelText("Name")).toHaveValue("Inventory");
    fireEvent.click(
      screen.getByRole("button", { name: "Pending spreadsheet review" }),
    );
    expect(selector).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Accept spreadsheet review" }),
    );
    expect(selector).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Unsaved scoped draft" },
    });
    expect(selector).toBeDisabled();
    fireEvent.click(selector);
    expect(onChangeScope).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Name")).toHaveValue("Unsaved scoped draft");
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
  });

  it("blocks scope switching during a save and re-enables it after durable readback", async () => {
    const pending = deferred<void>();
    const write = mock.store!.compareAndSwap;
    mock.store!.compareAndSwap = vi.fn(async (scope, expected, replacement) => {
      await pending.promise;
      await write(scope, expected, replacement);
    });
    show();
    await loaded();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Saved draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const selector = screen.getByRole("combobox", {
      name: "Document storage scope",
    });
    expect(selector).toBeDisabled();
    await act(async () => pending.resolve());
    await waitFor(() => expect(selector).toBeEnabled());
  });

  it("edits app documents, people and tickets using defaults without database policy or folders", async () => {
    mock.ready = false;
    mock.policyReady = false;
    mock.disabledTypes = DOCUMENT_TYPE_OPTIONS.map((item) => item.type);
    saved.documents.forEach((doc) => {
      doc.parentFolderId = null;
    });
    mock.appStore = {
      ...mock.store!,
      scope: { kind: "app", databaseId: "app-wide-documents", generation: 8 },
    };
    mock.connections.push({
      ...mock.connections[0],
      id: "folder",
      name: "Database-only folder",
      isGroup: true,
    });
    show({ ...request, scope: "app", databaseId: "app-wide-documents" });
    await loaded();
    expect(
      screen.getByRole("combobox", { name: "Document storage scope" }),
    ).toHaveTextContent("App-wide");
    expect(screen.queryByText(/Loading this database/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New document" })).toBeEnabled();
    expect(screen.queryByText("Database-only folder")).not.toBeInTheDocument();
    expect(
      editorHeader().getByRole("combobox", { name: "Owning folder" }),
    ).toHaveTextContent("App-wide root");
    expect(
      editorHeader().getByRole("combobox", { name: "Owning folder" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "App document" },
    });
    fireEvent.click(screen.getByRole("button", { name: "People" }));
    fireEvent.click(screen.getByRole("button", { name: "New person" }));
    fireEvent.click(screen.getByRole("button", { name: "Service desk" }));
    fireEvent.click(screen.getByRole("button", { name: "New ticket" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mock.appStore!.compareAndSwap).toHaveBeenCalledOnce(),
    );
    expect(saved.documents[0].name).toBe("App document");
    expect(saved.people).toHaveLength(1);
    expect(saved.tickets).toHaveLength(1);
    expect(saved.documents.every((doc) => doc.parentFolderId === null)).toBe(
      true,
    );
  });

  it("refuses a database reference with an identical app owner ID and record ID", async () => {
    mock.ready = false;
    mock.policyReady = false;
    mock.appStore = {
      ...mock.store!,
      scope: { kind: "app", databaseId: "app-wide-documents", generation: 8 },
    };
    saved.documents[0].blocks.push({
      id: "collision",
      type: "reference",
      label: "Follow colliding owner",
      reference: {
        databaseId: "app-wide-documents",
        kind: "document",
        id: "other-doc",
      },
    });
    show({ ...request, scope: "app", databaseId: "app-wide-documents" });
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: "Follow colliding owner" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /another database or document scope/,
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Inventory");
  });

  it("imports an app attachment without a database and leaves the existing database library untouched", async () => {
    mock.ready = false;
    mock.policyReady = false;
    const databaseSnapshot = structuredClone(saved);
    const appSaved: DatabaseDocuments = { ...fixture(), documents: [] };
    mock.appStore = {
      scope: { kind: "app", databaseId: "app-wide-documents", generation: 8 },
      changeRevision: 0,
      read: vi.fn(async () => structuredClone(appSaved)),
      compareAndSwap: vi.fn(async (_scope, _expected, replacement) => {
        Object.assign(appSaved, structuredClone(replacement));
      }),
    };
    const { container } = show({
      ...request,
      scope: "app",
      databaseId: "app-wide-documents",
      documentId: undefined,
    });
    await screen.findByTestId("documents-workspace");
    const bytes = new TextEncoder().encode(
      "%PDF-1.7\nSynthetic app attachment",
    );
    const file = new File([bytes], "app-attachment.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => bytes.buffer,
    });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    await screen.findByDisplayValue("app-attachment.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mock.appStore!.compareAndSwap).toHaveBeenCalledOnce(),
    );
    expect(appSaved.attachments[0]).toMatchObject({
      name: "app-attachment.pdf",
      mimeType: "application/pdf",
      size: bytes.length,
    });
    expect(appSaved.documents[0]).toMatchObject({
      parentFolderId: null,
      blocks: [
        { type: "attachment", attachmentId: appSaved.attachments[0].id },
      ],
    });
    expect(saved).toEqual(databaseSnapshot);
    expect(mock.store!.read).not.toHaveBeenCalled();
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
  });
  const bulkSelect = (label: string, option: string) => {
    fireEvent.click(screen.getByRole("combobox", { name: label }));
    fireEvent.mouseDown(screen.getByRole("option", { name: option }));
  };
  const bulkTags = (tag: string) => {
    bulkSelect("Bulk tags", "Add tags (keep existing)");
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Tags"), {
      target: { value: tag },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add tag" }));
  };
  const applyBulkReview = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(
      screen.getByRole("region", { name: "Review bulk changes" }),
    ).toBeVisible();
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply to draft" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
  };
  const ticketRows = () =>
    ["First ticket", "Second ticket", "Untouched ticket"].map(
      (title, index) => ({
        id: `ticket-${index}`,
        title,
        description: `Original ${index}`,
        status: "open" as const,
        priority: "normal" as const,
        tags: ["Existing"],
        references: [],
      }),
    );

  it("bulk edits selected ticket status, priority and tags as one protected draft/save", async () => {
    saved = normalizeDatabaseDocuments({ ...saved, tickets: ticketRows() });
    const untouched = structuredClone(saved.tickets[2]);
    show();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Service desk" }));
    for (const title of ["First ticket", "Second ticket"])
      fireEvent.click(
        screen.getByRole("checkbox", { name: `Select ${title} for bulk edit` }),
      );
    fireEvent.click(screen.getByRole("button", { name: "Edit selected" }));
    bulkSelect("Bulk ticket status", "Resolved");
    bulkSelect("Bulk ticket priority", "Urgent");
    bulkTags("Network");
    await applyBulkReview();
    expect(saved.tickets[0].status).toBe("open");
    expect(
      screen.getByText(
        "2 tickets updated in the draft. Save to commit these changes.",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mock.store!.compareAndSwap).toHaveBeenCalledOnce(),
    );
    for (const ticket of saved.tickets.slice(0, 2))
      expect(ticket).toMatchObject({
        status: "resolved",
        priority: "urgent",
        tags: ["Existing", "Network"],
      });
    expect(saved.tickets[2]).toEqual(untouched);
    expect(saved.tickets[0].description).toBe("Original 0");
  });

  it("bulk edits selected people organization/tags without changing contact fields or unselected people", async () => {
    saved = normalizeDatabaseDocuments({
      ...saved,
      people: ["Alex", "Robin", "Unselected"].map((name, index) => ({
        id: `person-${index}`,
        name,
        email: `person${index}@fixture.test`,
        phone: "123",
        organization: "Before",
        notes: "Private notes",
        tags: ["Existing"],
        references: [],
      })),
    });
    const original = structuredClone(saved.people);
    show();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "People" }));
    for (const name of ["Alex", "Robin"])
      fireEvent.click(
        screen.getByRole("checkbox", { name: `Select ${name} for bulk edit` }),
      );
    fireEvent.click(screen.getByRole("button", { name: "Edit selected" }));
    bulkSelect("Bulk organization", "Set organization");
    fireEvent.change(screen.getByLabelText("Organization"), {
      target: { value: "Support" },
    });
    bulkTags("On-call");
    await applyBulkReview();
    expect(saved.people).toEqual(original);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mock.store!.compareAndSwap).toHaveBeenCalledOnce(),
    );
    for (let index = 0; index < 2; index++)
      expect(saved.people[index]).toEqual({
        ...original[index],
        organization: "Support",
        tags: ["Existing", "On-call"],
      });
    expect(saved.people[2]).toEqual(original[2]);
  });

  it("bulk moves documents and changes icons through draft/save while preserving all blocks", async () => {
    mock.connections.push({
      ...mock.connections[0],
      id: "team-folder",
      name: "Team folder",
      isGroup: true,
    });
    saved.documents.forEach((doc) => {
      doc.icon = "folder";
    });
    const original = structuredClone(saved.documents);
    show();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Select page" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit selected" }));
    bulkSelect("Bulk document folder", "Team folder");
    bulkSelect("Bulk document icon", "Change document icon");
    expect(
      within(
        screen.getByRole("dialog", { name: "Bulk edit documents" }),
      ).getByRole("button", { name: /^Document icon:/ }),
    ).toBeVisible();
    await applyBulkReview();
    expect(saved.documents).toEqual(original);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mock.store!.compareAndSwap).toHaveBeenCalledOnce(),
    );
    for (let index = 0; index < 2; index++) {
      expect(saved.documents[index]).toMatchObject({
        parentFolderId: "team-folder",
        icon: "file-text",
      });
      expect(saved.documents[index].blocks).toEqual(original[index].blocks);
      expect(saved.documents[index].name).toBe(original[index].name);
    }
  });

  it.each(["lock", "generation"] as const)(
    "discards a reviewed bulk edit when owner access changes: %s",
    async (change) => {
      const view = show();
      await loaded();
      const original = structuredClone(saved);
      fireEvent.click(screen.getByRole("button", { name: "Select page" }));
      fireEvent.click(screen.getByRole("button", { name: "Edit selected" }));
      bulkSelect("Bulk document icon", "Change document icon");
      fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
      const form = screen.getByRole("form", { name: "Bulk entry changes" });
      if (change === "lock") mock.ready = false;
      else mock.store!.scope = { databaseId: "db-a", generation: 2 };
      view.rerender(
        <DocumentsWorkspace sessionId="workspace-tab" request={request} />,
      );
      expect(
        screen.queryByRole("dialog", { name: "Bulk edit documents" }),
      ).toBeNull();
      fireEvent.submit(form);
      expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
      expect(saved).toEqual(original);
    },
  );

  it.each(["filter", "section"] as const)(
    "does not resurrect bulk selection after a %s round trip",
    async (change) => {
      show();
      await loaded();
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: "Select Inventory for bulk edit",
        }),
      );
      expect(
        screen.getByRole("button", { name: "Edit selected" }),
      ).toBeEnabled();
      if (change === "filter") {
        fireEvent.change(
          screen.getByLabelText("Search documents and records"),
          { target: { value: "Other" } },
        );
        fireEvent.change(
          screen.getByLabelText("Search documents and records"),
          { target: { value: "" } },
        );
      } else {
        fireEvent.click(screen.getByRole("button", { name: "People" }));
        fireEvent.click(screen.getByRole("button", { name: "Documents" }));
      }
      expect(
        screen.getByRole("checkbox", {
          name: "Select Inventory for bulk edit",
        }),
      ).not.toBeChecked();
      expect(
        screen.getByRole("button", { name: "Edit selected" }),
      ).toBeDisabled();
      expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
    },
  );

  it("bounds browser and sidebar rows to 50 and pages larger metadata lists", async () => {
    saved.documents = Array.from({ length: 53 }, (_, index) => ({
      ...structuredClone(saved.documents[0]),
      id: `doc-${index}`,
      name: `Record ${String(index).padStart(2, "0")}`,
    }));
    show({ databaseId: "db-a", requestId: "large-browse" });
    const browser = await screen.findByTestId("documents-browser");
    expect(within(browser).getAllByRole("row")).toHaveLength(51);
    expect(
      screen.getAllByRole("button", { name: /^Open Record / }),
    ).toHaveLength(50);
    fireEvent.click(within(browser).getByRole("button", { name: "Next" }));
    expect(within(browser).getAllByRole("row")).toHaveLength(4);
    expect(
      screen.getAllByRole("button", { name: /^Open Record / }),
    ).toHaveLength(3);
  });
  it("honors the folder entry filter without reading document bodies", async () => {
    mock.connections.push({
      ...mock.connections[0],
      id: "folder",
      name: "Lab",
      isGroup: true,
    });
    saved.documents[0].parentFolderId = "folder";
    show({
      databaseId: "db-a",
      requestId: "folder-browse",
      parentFolderId: "folder",
    });
    const browser = await screen.findByTestId("documents-browser");
    expect(
      within(browser).getByRole("button", { name: "Inventory" }),
    ).toBeInTheDocument();
    expect(
      within(browser).queryByRole("button", { name: "Other document" }),
    ).not.toBeInTheDocument();
    expect(
      within(browser).getByRole("cell", { name: "Lab" }),
    ).toBeInTheDocument();
  });
  it("browses metadata, excludes private contents from search, and opens/creates records", async () => {
    show({ databaseId: "db-a", requestId: "browse" });
    const browser = await screen.findByTestId("documents-browser");
    expect(
      within(browser).getByRole("button", { name: "Inventory" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search documents and records"), {
      target: { value: "PRIVATE_FIXTURE" },
    });
    expect(
      within(browser).queryByRole("button", { name: "Inventory" }),
    ).not.toBeInTheDocument();
    expect(within(browser).getByText(/No records match/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search documents and records"), {
      target: { value: "Inventory" },
    });
    fireEvent.click(within(browser).getByRole("button", { name: "Inventory" }));
    fireEvent.change(screen.getByLabelText("Search documents and records"), {
      target: { value: "" },
    });
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    expect(screen.getByTestId("documents-browser")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    fireEvent.change(await screen.findByLabelText("Document name"), {
      target: { value: "Untitled document" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create document" }));
    expect(
      await screen.findByDisplayValue("Untitled document"),
    ).toBeInTheDocument();
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
  });
  it("shows actionable locked protection guidance without reading or exposing private records", () => {
    mock.ready = false;
    mock.store!.scope = null;
    const onOpenSecurity = vi.fn();
    render(
      <DocumentsWorkspace
        sessionId="workspace-tab"
        request={request}
        onOpenSecurity={onOpenSecurity}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Documents need database protection",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /Security → Current database/,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /global Connections encryption/,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /OS-vaulted global key qualifies/,
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      /without managed protection cannot/,
    );
    expect(mock.store!.read).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("Inventory")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Database security" }));
    expect(onOpenSecurity).toHaveBeenCalledOnce();
  });

  it("shows a read error and recovers only after explicit Retry", async () => {
    vi.mocked(mock.store!.read).mockRejectedValueOnce(
      new Error("Managed document lease unavailable. Unlock and retry."),
    );
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Unlock and retry/,
    );
    expect(screen.queryByDisplayValue("Inventory")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await loaded();
    expect(mock.store!.read).toHaveBeenCalledTimes(2);
  });

  it("consumes a creation request once across draft edits and rerenders, without saving automatically", async () => {
    const create = { databaseId: "db-a", requestId: "new-once", create: true };
    const view = show(create);
    fireEvent.change(await screen.findByLabelText("Document name"), {
      target: { value: "Untitled document" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create document" }));
    await screen.findByDisplayValue("Untitled document");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New private draft" },
    });
    view.rerender(
      <DocumentsWorkspace sessionId="workspace-tab" request={{ ...create }} />,
    );
    expect(
      screen.getAllByRole("button", { name: "Open New private draft" }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Open Untitled document" }),
    ).not.toBeInTheDocument();
    expect(saved.documents).toHaveLength(2);
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
  });

  it("blocks save and navigation while a spreadsheet review is pending, then handles the queued request after review", async () => {
    const view = show();
    await loaded();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Reviewed draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Pending spreadsheet review" }),
    );
    expect(getDocumentDraft("workspace-tab")?.dirty).toBe(true);
    for (const name of [
      "Save",
      "Import",
      "Protected export",
      "New document",
      "People",
      "Open Other document",
    ])
      expect(screen.getByRole("button", { name })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Follow cell" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Review the pending editor changes/,
    );
    view.rerender(
      <DocumentsWorkspace
        sessionId="workspace-tab"
        request={{ ...request, requestId: "open-2", documentId: "other-doc" }}
      />,
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Reviewed draft");
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Accept spreadsheet review" }),
    );
    await screen.findByDisplayValue("Other document");
    expect(
      screen.getByRole("button", { name: "Open Reviewed draft" }),
    ).toBeInTheDocument();
  });

  it("routes a cell reference only to its owning document and block, not another sheet with the same block ID", async () => {
    show();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Follow cell" }));
    await screen.findByDisplayValue("Other document");
    await waitFor(() =>
      expect(
        mock.sheets.get("database:db-a:1:other-doc:sheet")?.focusReference,
      ).toMatchObject({ id: "other-doc", blockId: "sheet", address: "B3" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Inventory" }));
    await screen.findByDisplayValue("Inventory");
    expect(
      mock.sheets.get("database:db-a:1:doc:sheet")?.focusReference,
    ).toBeUndefined();
  });

  it("retains an unaccepted spreadsheet review when another writer publishes a library revision", async () => {
    const view = show();
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: "Pending spreadsheet review" }),
    );
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    const reads = vi.mocked(mock.store!.read).mock.calls.length;
    saved.documents[0].name = "Other writer's saved name";
    mock.store = { ...mock.store!, changeRevision: 1 };
    view.rerender(
      <DocumentsWorkspace sessionId="workspace-tab" request={request} />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /saved library changed/i,
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Inventory");
    expect(mock.store.read).toHaveBeenCalledTimes(reads);
    expect(mock.sheets.get("database:db-a:1:doc:sheet")?.readOnly).toBe(false);
    expect(getDocumentDraft("workspace-tab")?.dirty).toBe(true);
    expect(editorHeader().getByRole("status")).toHaveTextContent(
      "Reload required · draft retained",
    );
    expect(
      editorHeader().getByRole("textbox", { name: "Name" }),
    ).toBeDisabled();
    expect(
      editorHeader().getByRole("combobox", { name: "Owning folder" }),
    ).toBeDisabled();
    expect(
      editorHeader().getByRole("button", { name: "Document icon: Text file" }),
    ).toBeDisabled();
    expect(
      editorHeader().getByRole("button", { name: "Delete" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Open Other document" }),
    ).toBeDisabled();
    expect(mock.store.compareAndSwap).not.toHaveBeenCalled();
    // Resolving the local review does not auto-accept the changed saved baseline.
    fireEvent.click(
      screen.getByRole("button", { name: "Accept spreadsheet review" }),
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Inventory");
    expect(mock.store.read).toHaveBeenCalledTimes(reads);
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(
        fireEvent.keyDown(screen.getByLabelText("Name"), {
          key: "s",
          ...modifier,
        }),
      ).toBe(false);
    }
    expect(mock.toast.loading).not.toHaveBeenCalled();
    expect(mock.store.compareAndSwap).not.toHaveBeenCalled();
  });

  it("protects review-only drafts on beforeunload, but never prevents forced database revocation", async () => {
    const view = show();
    await loaded();
    const before = new Event("beforeunload", { cancelable: true });
    fireEvent(window, before);
    expect(before.defaultPrevented).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Pending spreadsheet review" }),
    );
    const pending = new Event("beforeunload", { cancelable: true });
    fireEvent(window, pending);
    expect(pending.defaultPrevented).toBe(true);
    mock.ready = false;
    mock.store = { ...mock.store!, scope: null };
    view.rerender(
      <DocumentsWorkspace sessionId="workspace-tab" request={request} />,
    );
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    const revoked = new Event("beforeunload", { cancelable: true });
    fireEvent(window, revoked);
    expect(revoked.defaultPrevented).toBe(false);
    expect(mock.store.compareAndSwap).not.toHaveBeenCalled();
  });

  it("never auto-connects typed references and rejects foreign-owner links", async () => {
    const view = show();
    await loaded();
    expect(view.onOpenConnection).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Open foreign connection" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/another database/);
    expect(view.onOpenConnection).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Open linked connection" }),
    );
    expect(view.onOpenConnection).toHaveBeenCalledExactlyOnceWith(
      mock.connections[0],
    );
  });

  it("retains an editable draft and shows an actionable failure when durable save is refused", async () => {
    vi.mocked(mock.store!.compareAndSwap).mockRejectedValueOnce(
      new Error("Synthetic disk failure."),
    );
    show();
    await loaded();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Keep this draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /draft is retained/i,
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Keep this draft");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(saved.documents[0].name).toBe("Inventory");
    expect(getDocumentDraft("workspace-tab")?.dirty).toBe(true);
    expect(mock.toast.update).toHaveBeenLastCalledWith(
      "document-save",
      expect.objectContaining({ type: "error" }),
    );
  });

  it("treats a cancelled native spreadsheet import as no change and performs no file reads", async () => {
    show();
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: "Import spreadsheet fixture" }),
    );
    await waitFor(() => expect(mock.importResult).toHaveBeenCalledWith(null));
    expect(mock.open).toHaveBeenCalledOnce();
    expect(mock.stat).not.toHaveBeenCalled();
    expect(mock.readFile).not.toHaveBeenCalled();
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
    expect(getDocumentDraft("workspace-tab")?.dirty).toBe(false);
  });

  it("cancels spreadsheet export at either the explicit warning or native save dialog without claiming success", async () => {
    show();
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: "Export spreadsheet fixture" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(mock.exportResult).toHaveBeenLastCalledWith("cancelled"),
    );
    expect(mock.save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Export spreadsheet fixture" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() => expect(mock.exportResult).toHaveBeenCalledTimes(2));
    expect(mock.exportResult).toHaveBeenLastCalledWith("cancelled");
    expect(mock.save).toHaveBeenCalledOnce();
    expect(mock.writeFile).not.toHaveBeenCalled();
    expect(mock.toast.update).not.toHaveBeenCalled();
  });

  it("rejects a file path returned after the owning database locks", async () => {
    const save = deferred<string | null>();
    mock.save.mockReturnValueOnce(save.promise);
    const view = show();
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: "Export spreadsheet fixture" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    mock.ready = false;
    mock.store = { ...mock.store!, scope: null };
    view.rerender(
      <DocumentsWorkspace sessionId="workspace-tab" request={request} />,
    );
    await act(async () => {
      save.resolve("C:\\synthetic-only\\never-written.csv");
      await save.promise;
    });
    await waitFor(() =>
      expect(mock.exportResult).toHaveBeenCalledWith("cancelled"),
    );
    expect(mock.writeFile).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("closes a cancelled protected export without changing the library or reporting a saved file", async () => {
    show();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Protected export" }));
    fireEvent.change(screen.getByLabelText("Archive password"), {
      target: { value: "synthetic-export-passphrase" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Choose save location" }),
    );
    await waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Protected document archive" }),
      ).not.toBeInTheDocument(),
    );
    expect(mock.writeFile).not.toHaveBeenCalled();
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
    expect(mock.toast.update).not.toHaveBeenCalled();
  });

  it("removes draft guards when a locked or closed workspace unmounts", async () => {
    const view = show();
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: "Pending spreadsheet review" }),
    );
    expect(getDocumentDraft("workspace-tab")?.dirty).toBe(true);
    view.unmount();
    expect(getDocumentDraft("workspace-tab")).toBeUndefined();
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
  });

  it("filters tickets by text, status, priority and tag, with counts and clear filters", async () => {
    saved = normalizeDatabaseDocuments({
      ...saved,
      tickets: [
        {
          id: "first",
          title: "Replace switch",
          description: "Rack twelve",
          status: "open",
          priority: "high",
          tags: ["Network"],
          references: [],
        },
        {
          id: "second",
          title: "Archive report",
          description: "Monthly",
          status: "closed",
          priority: "low",
          tags: ["Office"],
          references: [],
        },
      ],
    });
    show();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Service desk" }));
    expect(screen.getByText("2 of 2 tickets")).toBeInTheDocument();
    const filters = screen.getByRole("group", { name: "Ticket filters" });
    const status = within(filters).getByRole("combobox", {
      name: "Filter ticket status",
    });
    const priority = within(filters).getByRole("combobox", {
      name: "Filter ticket priority",
    });
    const tag = within(filters).getByRole("combobox", {
      name: "Filter ticket tag",
    });
    expect(filters).toHaveClass(styles.ticketFilters);
    for (const control of [status, priority, tag]) {
      expect(control).toHaveClass("sor-form-select-sm", styles.ticketFilter);
    }
    expect(status).not.toHaveClass(styles.ticketFilterWide);
    expect(priority).not.toHaveClass(styles.ticketFilterWide);
    expect(tag).toHaveClass(styles.ticketFilterWide);
    expect(status).toHaveAttribute("title", "Ticket status: All statuses");
    expect(priority).toHaveAttribute(
      "title",
      "Ticket priority: All priorities",
    );
    expect(tag).toHaveAttribute("title", "Ticket tag: All tags");
    fireEvent.change(screen.getByLabelText("Search documents and records"), {
      target: { value: "TWELVE" },
    });
    expect(screen.getByText("1 of 2 tickets")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("combobox", { name: "Filter ticket status" }),
    );
    fireEvent.mouseDown(screen.getByRole("option", { name: "Open" }));
    fireEvent.click(
      screen.getByRole("combobox", { name: "Filter ticket priority" }),
    );
    fireEvent.mouseDown(screen.getByRole("option", { name: "High" }));
    fireEvent.click(
      screen.getByRole("combobox", { name: "Filter ticket tag" }),
    );
    fireEvent.change(screen.getByLabelText("Search ticket tags"), {
      target: { value: "Off" },
    });
    expect(screen.queryByRole("option", { name: "Network" })).toBeNull();
    fireEvent.mouseDown(screen.getByRole("option", { name: "Office" }));
    expect(tag).toHaveFocus();
    expect(tag).toHaveAttribute("title", "Ticket tag: Office");
    expect(screen.getByText("0 of 2 tickets")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("2 of 2 tickets")).toBeInTheDocument();
    expect(status).toHaveTextContent("All statuses");
    expect(priority).toHaveTextContent("All priorities");
    expect(tag).toHaveTextContent("All tags");
    expect(saved.tickets).toHaveLength(2);
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
  });

  it("adds/removes tags as protected drafts and reloads saved ticket tags", async () => {
    saved = normalizeDatabaseDocuments({
      ...saved,
      tickets: [
        {
          id: "first",
          title: "Replace switch",
          description: "",
          status: "open",
          priority: "high",
          references: [],
        },
      ],
    });
    show();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Service desk" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open Replace switch" }),
    );
    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: " Network " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    expect(
      screen.getByRole("button", { name: "Remove tag Network" }),
    ).toBeInTheDocument();
    expect(saved.tickets[0].tags).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved.tickets[0].tags).toEqual(["Network"]));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove tag Network" }));
    expect(saved.tickets[0].tags).toEqual(["Network"]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved.tickets[0].tags).toEqual([]));
  });

  it("clears ticket filters and unsubmitted tags on owner-generation changes", async () => {
    saved = normalizeDatabaseDocuments({
      ...saved,
      tickets: [
        {
          id: "first",
          title: "Replace switch",
          description: "",
          status: "open",
          priority: "high",
          references: [],
        },
      ],
    });
    const view = show();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Service desk" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open Replace switch" }),
    );
    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: "PRIVATE_TAG_DRAFT" },
    });
    fireEvent.change(screen.getByLabelText("Search documents and records"), {
      target: { value: "no match" },
    });
    mock.store!.scope = { databaseId: "db-a", generation: 2 };
    view.rerender(
      <DocumentsWorkspace sessionId="workspace-tab" request={request} />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Search documents and records")).toHaveValue(
        "",
      ),
    );
    expect(
      screen.queryByDisplayValue("PRIVATE_TAG_DRAFT"),
    ).not.toBeInTheDocument();
    expect(saved.tickets[0].tags).toEqual([]);
  });

  it("opens and cancels the creation dialog without adding a draft or saving", async () => {
    show();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    fireEvent.change(screen.getByLabelText("Document name"), {
      target: { value: "Unsubmitted" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("button", { name: "Open Unsubmitted" }),
    ).not.toBeInTheDocument();
    expect(getDocumentDraft("workspace-tab")?.dirty).toBe(false);
    expect(mock.store!.compareAndSwap).not.toHaveBeenCalled();
  });

  it("uses bounded themed tag suggestions and clears unsubmitted text when selecting another record", async () => {
    saved = normalizeDatabaseDocuments({
      ...saved,
      tickets: [
        {
          id: "first",
          title: "First ticket",
          description: "",
          status: "open",
          priority: "high",
          references: [],
          tags: ["Network", "Office", "Printer", "WiFi", "Laptop", "Server"],
        },
        {
          id: "second",
          title: "Second ticket",
          description: "",
          status: "open",
          priority: "normal",
          references: [],
        },
      ],
    });
    show();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Service desk" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Second ticket" }));
    const suggestions = screen.getByLabelText("Suggested tags");
    expect(within(suggestions).getAllByRole("button")).toHaveLength(5);
    expect(document.querySelector("datalist")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use tag Network" }));
    expect(
      screen.getByRole("button", { name: "Remove tag Network" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: "Unsubmitted" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open First ticket" }));
    expect(screen.getByLabelText("Tags")).toHaveValue("");
    expect(saved.tickets[1].tags).toEqual([]);
  });

  it("blocks creation while policy is unavailable or all document types are disabled, but keeps existing documents", async () => {
    mock.policyReady = false;
    const view = show();
    await loaded();
    expect(screen.getByRole("button", { name: "New document" })).toBeDisabled();
    mock.policyReady = true;
    mock.disabledTypes = DOCUMENT_TYPE_OPTIONS.filter(
      (entry) => entry.type !== "person" && entry.type !== "ticket",
    ).map((entry) => entry.type);
    view.rerender(
      <DocumentsWorkspace sessionId="workspace-tab" request={request} />,
    );
    expect(screen.getByRole("button", { name: "New document" })).toBeDisabled();
    expect(screen.getByDisplayValue("Inventory")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Service desk" }));
    expect(screen.getByRole("button", { name: "New ticket" })).toBeEnabled();
  });
});
