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
import styles from "../../src/components/documents/documents.module.css";

const mock = vi.hoisted(() => ({
  ready: true,
  policyReady: true,
  disabledTypes: [] as DatabaseDocumentType[],
  store: undefined as DatabaseDocumentStore | undefined,
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
  mock.ready = true;
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
function show(next = request, onOpenConnection = vi.fn()) {
  return {
    ...render(
      <DocumentsWorkspace
        sessionId="workspace-tab"
        request={next}
        onOpenConnection={onOpenConnection}
      />,
    ),
    onOpenConnection,
  };
}
const loaded = async () => {
  await screen.findByDisplayValue("Inventory");
  await screen.findByTestId("mock-spreadsheet");
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("protected document workspace integration", () => {
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
        mock.sheets.get("db-a:1:other-doc:sheet")?.focusReference,
      ).toMatchObject({ id: "other-doc", blockId: "sheet", address: "B3" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Inventory" }));
    await screen.findByDisplayValue("Inventory");
    expect(mock.sheets.get("db-a:1:doc:sheet")?.focusReference).toBeUndefined();
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
    expect(mock.sheets.get("db-a:1:doc:sheet")?.readOnly).toBe(false);
    expect(getDocumentDraft("workspace-tab")?.dirty).toBe(true);
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
