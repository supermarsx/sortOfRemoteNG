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
import { ConnectionTree } from "../../src/components/connection/ConnectionTree";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import { useConnections } from "../../src/contexts/useConnections";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";
import type { Connection } from "../../src/types/connection/connection";
import type { DatabaseDocumentStore } from "../../src/types/documents/document";
import type { TreeDocumentMetadata } from "../../src/components/connection/connectionTree/documentTreeModel";
import { emptyDatabaseDocuments } from "../../src/utils/documents/validation";
import { registerDocumentDraft } from "../../src/utils/documents/documentDrafts";

type Store = DatabaseDocumentStore & {
  readMetadata: (
    scope: NonNullable<DatabaseDocumentStore["scope"]>,
  ) => Promise<TreeDocumentMetadata[]>;
};
const mocks = vi.hoisted(() => ({
  availability: {
    status: "ready",
    databaseId: "tree-documents",
    generation: 1,
  } as DatabaseAvailability,
  store: {} as Store,
  visible: true,
  fullText: false,
  context: {} as ReturnType<typeof useConnections>,
  connect: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  disconnect: vi.fn(),
  activate: vi.fn(),
}));
vi.mock("../../src/contexts/useConnections", async (original) => {
  const actual =
    await original<typeof import("../../src/contexts/useConnections")>();
  return {
    useConnections: () => ({
      ...actual.useConnections(),
      databaseAvailability: mocks.availability,
      documents: mocks.store,
    }),
  };
});
vi.mock("../../src/contexts/SettingsContext", async (original) => {
  const actual =
    await original<typeof import("../../src/contexts/SettingsContext")>();
  return {
    ...actual,
    useSettings: () => ({
      settings: {
        ...actual.defaultSettings,
        showDocumentsInConnectionTree: mocks.visible,
        searchDocumentContents: mocks.fullText,
        singleClickConnect: false,
        folderSingleClickToggle: false,
      },
      updateSettings: vi.fn(),
    }),
  };
});
const folder: Connection = {
  id: "folder",
  name: "Operations",
  hostname: "",
  port: 22,
  protocol: "ssh",
  isGroup: true,
  expanded: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const server: Connection = {
  ...folder,
  id: "collision",
  name: "Server",
  hostname: "server.test",
  isGroup: false,
};
const connections = [folder, server];
const entries: TreeDocumentMetadata[] = [
  {
    id: "nested",
    name: "Nested runbook",
    parentFolderId: folder.id,
    icon: "file-text",
    blockTypes: ["note"],
  },
  {
    id: "collision",
    name: "Root sheet",
    parentFolderId: null,
    icon: "table",
    blockTypes: ["spreadsheet"],
  },
];
function Seed() {
  mocks.context = useConnections();
  const { dispatch } = mocks.context;
  React.useEffect(() => {
    dispatch({ type: "SET_CONNECTIONS", payload: connections });
  }, [dispatch]);
  return (
    <ConnectionTree
      onConnect={mocks.connect}
      onEdit={mocks.edit}
      onDelete={mocks.remove}
      onDisconnect={mocks.disconnect}
      onActivateSession={mocks.activate}
    />
  );
}
function Harness() {
  return (
    <ToastProvider>
      <ConnectionProvider>
        <Seed />
      </ConnectionProvider>
    </ToastProvider>
  );
}
function connectionRow(id: string) {
  return screen
    .getByRole("tree")
    .querySelector(`[data-connection-id="${id}"]`)!
    .closest<HTMLElement>('[role="treeitem"]')!;
}
beforeEach(() => {
  mocks.visible = true;
  mocks.fullText = false;
  mocks.availability = {
    status: "ready",
    databaseId: "tree-documents",
    generation: 1,
  };
  mocks.store = {
    scope: { databaseId: "tree-documents", generation: 1 },
    changeRevision: 0,
    readMetadata: vi.fn(async () => entries),
    read: vi.fn(async () => emptyDatabaseDocuments()),
    compareAndSwap: vi.fn(),
  };
  for (const fn of [
    mocks.connect,
    mocks.edit,
    mocks.remove,
    mocks.disconnect,
    mocks.activate,
  ])
    fn.mockClear();
});
afterEach(cleanup);

describe("documents in the connection tree", () => {
  it("keeps the original layout and does no document reads with the setting off", async () => {
    mocks.visible = false;
    render(<Harness />);
    expect(await screen.findByText("Server")).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Tree entries" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Document type" }),
    ).not.toBeInTheDocument();
    expect(mocks.store.readMetadata).not.toHaveBeenCalled();
    expect(mocks.store.read).not.toHaveBeenCalled();
  });
  it("uses real folder expansion, doc-only ancestors, connection-only and type filters", async () => {
    render(<Harness />);
    expect(
      await screen.findByRole("treeitem", { name: "Root sheet, document" }),
    ).toHaveAttribute("aria-level", "1");
    expect(
      screen.queryByRole("treeitem", { name: "Nested runbook, document" }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(connectionRow("folder")).getAllByRole("button")[0]);
    expect(
      await screen.findByRole("treeitem", { name: "Nested runbook, document" }),
    ).toHaveAttribute("aria-level", "2");
    fireEvent.click(within(connectionRow("folder")).getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    expect(
      screen.getByRole("treeitem", { name: "Nested runbook, document" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Server")).not.toBeInTheDocument();
    expect(
      mocks.context.state.connections.find((c) => c.id === "folder")?.expanded,
    ).toBe(false);
    fireEvent.click(screen.getByRole("combobox", { name: "Document type" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Spreadsheets" }));
    expect(screen.queryByText("Operations")).not.toBeInTheDocument();
    expect(screen.queryByText("Nested runbook")).not.toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: "Root sheet, document" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connections" }));
    expect(screen.getByText("Server")).toBeInTheDocument();
    expect(screen.queryByText("Root sheet")).not.toBeInTheDocument();
    expect(mocks.store.read).not.toHaveBeenCalled();
  });
  it("searches names and restores ancestors without reading bodies", async () => {
    render(<Harness />);
    await screen.findByText("Root sheet");
    act(() =>
      mocks.context.dispatch({
        type: "SET_FILTER",
        payload: { searchTerm: "runbook" },
      }),
    );
    expect(
      screen.getByRole("treeitem", { name: "Nested runbook, document" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.queryByText("Server")).not.toBeInTheDocument();
    expect(screen.queryByText("Root sheet")).not.toBeInTheDocument();
    expect(mocks.store.read).not.toHaveBeenCalled();
  });
  it("keeps document selection separate despite ID collision, and Enter opens the exact owner without connecting", async () => {
    render(<Harness />);
    const doc = await screen.findByRole("treeitem", {
      name: "Root sheet, document",
    });
    fireEvent.click(screen.getByText("Server"));
    expect(mocks.context.state.selectedConnectionIds.has(server.id)).toBe(true);
    fireEvent.keyDown(connectionRow(server.id), { key: "ArrowDown" });
    expect(doc).toHaveFocus();
    expect(mocks.context.state.selectedConnectionIds.size).toBe(0);
    expect(mocks.context.state.selectedConnection).toBeNull();
    fireEvent.keyDown(doc, { key: "Enter" });
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.context.state.sessions).toHaveLength(1);
    expect(mocks.context.state.sessions[0]).toMatchObject({
      protocol: "tool:documents",
      ownerDatabaseId: "tree-documents",
      documentsWorkspace: {
        scope: "database",
        databaseId: "tree-documents",
        documentId: "collision",
      },
    });
    fireEvent.keyDown(doc, { key: "ArrowUp" });
    expect(connectionRow(server.id)).toHaveFocus();
    fireEvent.keyDown(connectionRow(server.id), { key: "Enter" });
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: server.id, protocol: "ssh" }),
    );
  });
  it("clears multi-selection and rejects connection actions, drag payloads, drops and root context menu on a document", async () => {
    render(<Harness />);
    const doc = await screen.findByRole("treeitem", {
      name: "Root sheet, document",
    });
    fireEvent.click(screen.getByText("Server"));
    fireEvent.click(screen.getByText("Operations"), { ctrlKey: true });
    expect(mocks.context.state.selectedConnectionIds.size).toBe(2);
    fireEvent.contextMenu(doc);
    expect(mocks.context.state.selectedConnectionIds.size).toBe(0);
    expect(
      screen.queryByTestId("connection-tree-panel-menu"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const before = mocks.context.state.connections;
    const transfer = {
      setData: vi.fn(),
      getData: vi.fn(() => server.id),
      dropEffect: "move",
      effectAllowed: "all",
    };
    fireEvent.dragStart(doc, { dataTransfer: transfer });
    fireEvent.dragOver(doc, { dataTransfer: transfer });
    fireEvent.drop(doc, { dataTransfer: transfer });
    expect(transfer.setData).not.toHaveBeenCalled();
    expect(transfer.dropEffect).toBe("none");
    for (const key of ["Delete", "Backspace", "F2"])
      fireEvent.keyDown(doc, { key });
    fireEvent.keyDown(doc, { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(doc, { key: "a", ctrlKey: true });
    expect(mocks.context.state.connections).toEqual(before);
    for (const fn of [
      mocks.connect,
      mocks.edit,
      mocks.remove,
      mocks.disconnect,
    ])
      expect(fn).not.toHaveBeenCalled();
  });
  it("hides rows and filters immediately on setting off or database lock", async () => {
    const view = render(<Harness />);
    await screen.findByText("Root sheet");
    mocks.visible = false;
    view.rerender(<Harness />);
    expect(screen.queryByText("Root sheet")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Tree entries" }),
    ).not.toBeInTheDocument();
    mocks.visible = true;
    view.rerender(<Harness />);
    await screen.findByText("Root sheet");
    mocks.availability = { ...mocks.availability, status: "suspended" };
    view.rerender(<Harness />);
    expect(screen.queryByText("Root sheet")).not.toBeInTheDocument();
    expect(screen.getByRole("tree")).toHaveTextContent("Database locked");
  });
  it.each(["generation", "revision"])(
    "rejects stale document activation on live %s revocation before a render",
    async (change) => {
      render(<Harness />);
      const doc = await screen.findByRole("treeitem", {
        name: "Root sheet, document",
      });
      if (change === "generation")
        mocks.store.scope = { databaseId: "tree-documents", generation: 2 };
      else mocks.store.changeRevision += 1;
      fireEvent.doubleClick(doc);
      expect(mocks.context.state.sessions).toHaveLength(0);
      expect(mocks.connect).not.toHaveBeenCalled();
    },
  );
  it("protects an existing dirty draft and retries navigation after it is clean", async () => {
    render(<Harness />);
    const doc = await screen.findByRole("treeitem", {
      name: "Root sheet, document",
    });
    let dirty = true;
    const unregister = registerDocumentDraft("draft-test", () => ({
      databaseId: "tree-documents",
      dirty,
      busy: false,
      revision: 0,
    }));
    try {
      fireEvent.doubleClick(doc);
      expect(screen.getByRole("status")).toHaveTextContent("Save or discard");
      expect(mocks.context.state.sessions).toHaveLength(0);
      dirty = false;
      fireEvent.doubleClick(doc);
      expect(mocks.context.state.sessions).toHaveLength(1);
    } finally {
      unregister();
    }
  });
  it("virtualizes document leaves and navigates to the final document by keyboard", async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      ...entries[1],
      id: `doc-${i}`,
      name: `Document ${String(i).padStart(3, "0")}`,
    }));
    vi.mocked(mocks.store.readMetadata).mockResolvedValue(many);
    render(<Harness />);
    await screen.findByText("Document 000");
    expect(screen.getAllByRole("treeitem").length).toBeLessThan(60);
    fireEvent.keyDown(screen.getByRole("tree"), { key: "End" });
    await waitFor(() =>
      expect(
        screen.getByRole("treeitem", { name: "Document 299, document" }),
      ).toHaveFocus(),
    );
    expect(screen.getAllByRole("treeitem").length).toBeLessThan(60);
    expect(mocks.context.state.connections).toHaveLength(2);
  });
});
