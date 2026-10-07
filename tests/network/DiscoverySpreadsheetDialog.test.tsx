import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscoverySpreadsheetDialog } from "../../src/components/network/DiscoverySpreadsheetDialog";
import type { ConnectionContextType } from "../../src/contexts/ConnectionContextTypes";
import type {
  DatabaseDocuments,
  DatabaseDocumentStore,
} from "../../src/types/documents/document";
import type { DatabaseSettings } from "../../src/types/settings/databaseSettings";
import { emptyDatabaseDocuments } from "../../src/utils/documents/validation";
import { registerDocumentDraft } from "../../src/utils/documents/documentDrafts";
import { spreadsheetScan, deferred } from "./discoverySpreadsheetFixtures";

const mocks = vi.hoisted(() => ({
  context: {} as ConnectionContextType,
  app: undefined as DatabaseDocumentStore | undefined,
  settings: { version: 1, documentTypes: { disabled: [] } } as DatabaseSettings,
  policyLoading: false,
  open: vi.fn(),
  activateArgument: vi.fn(),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => mocks.context,
}));
vi.mock("../../src/hooks/documents/useAppDocumentsStore", () => ({
  useAppDocumentsStore: () => mocks.app,
}));
vi.mock("../../src/hooks/settings/useCurrentDatabaseSettings", () => ({
  useCurrentDatabaseSettings: () => ({
    settings: mocks.settings,
    scope: mocks.context.databaseSettings?.scope,
    loading: mocks.policyLoading,
    error: null,
  }),
}));
vi.mock("../../src/hooks/documents/useDocumentSession", () => ({
  useDocumentSession: (activate: unknown) => {
    mocks.activateArgument(activate);
    return mocks.open;
  },
}));

let saved: DatabaseDocuments;
let appSaved: DatabaseDocuments;
const close = vi.fn(),
  activate = vi.fn();
const mount = () => {
  const scan = spreadsheetScan();
  const props = {
    request: { scan, filteredHosts: [scan.hosts[1]], filterText: "router" },
    onClose: close,
    onActivateSession: activate,
  };
  return { ...render(<DiscoverySpreadsheetDialog {...props} />), props };
};
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
};
const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "Save spreadsheet" }));
beforeEach(() => {
  vi.clearAllMocks();
  saved = emptyDatabaseDocuments();
  appSaved = emptyDatabaseDocuments();
  mocks.policyLoading = false;
  mocks.settings = { version: 1, documentTypes: { disabled: [] } };
  mocks.context = {
    state: {
      connections: [
        { id: "north", name: "North", isGroup: true },
        { id: "south", name: "South", isGroup: true },
        {
          id: "north-servers",
          name: "Servers",
          parentId: "north",
          isGroup: true,
        },
        {
          id: "south-servers",
          name: "Servers",
          parentId: "south",
          isGroup: true,
        },
      ],
      sessions: [],
    },
    databaseAvailability: {
      status: "ready",
      databaseId: "db-a",
      generation: 1,
    },
    documents: {
      scope: { databaseId: "db-a", generation: 1 },
      changeRevision: 0,
      read: vi.fn(async () => structuredClone(saved)),
      compareAndSwap: vi.fn(async (_scope, expected, replacement) => {
        expect(expected).toEqual(saved);
        saved = structuredClone(replacement);
      }),
    },
    databaseSettings: {
      scope: { databaseId: "db-a", generation: 1 },
      changeRevision: 0,
      read: vi.fn(async () => structuredClone(mocks.settings)),
      compareAndSwap: vi.fn(),
    },
  } as unknown as ConnectionContextType;
  mocks.app = {
    scope: { kind: "app", databaseId: "app-wide-documents", generation: 9 },
    changeRevision: 0,
    read: vi.fn(async () => structuredClone(appSaved)),
    compareAndSwap: vi.fn(async (_scope, _expected, replacement) => {
      appSaved = structuredClone(replacement);
    }),
  };
});
afterEach(cleanup);

describe("scan spreadsheet export dialog", () => {
  it("uses the availability epoch for the synchronous connection guard and the document epoch for CAS", async () => {
    mocks.context.databaseAvailability!.generation = 22;
    mocks.context.getCurrentConnections = vi.fn((scope) => {
      expect(scope).toEqual({ databaseId: "db-a", generation: 22 });
      return mocks.context.state.connections;
    });
    mount();
    choose("Document folder", "South / Servers");
    save();
    await screen.findByRole("button", { name: "Open document" });
    expect(mocks.context.getCurrentConnections).toHaveBeenCalled();
    expect(
      vi.mocked(mocks.context.documents!.compareAndSwap).mock.calls[0][0],
    ).toEqual({ databaseId: "db-a", generation: 1 });
  });
  it("checks synchronous access before navigating even without a React rerender", async () => {
    mocks.context.getCurrentConnections = vi.fn(
      () => mocks.context.state.connections,
    );
    mount();
    save();
    const open = await screen.findByRole("button", { name: "Open document" });
    vi.mocked(mocks.context.getCurrentConnections).mockImplementation(() => {
      throw Error("Original database is locked");
    });
    fireEvent.click(open);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Original database is locked",
    );
  });
  it("uses themed modal recipes, visible labels, searchable folder paths and durable save before opening", async () => {
    const durability = deferred<void>();
    const cas = mocks.context.documents!.compareAndSwap;
    mocks.context.documents!.compareAndSwap = vi.fn(
      async (scope, expected, replacement) => {
        await durability.promise;
        await cas(scope, expected, replacement);
      },
    );
    mount();
    const dialog = screen.getByRole("dialog", {
      name: "Export scan to Documents",
    });
    expect(dialog.querySelector(".sor-modal-header")).not.toBeNull();
    expect(dialog.querySelector(".sor-modal-body")).not.toBeNull();
    expect(dialog.querySelector(".sor-modal-footer")).not.toBeNull();
    await waitFor(() =>
      expect(screen.getByLabelText("Document name")).toHaveFocus(),
    );
    expect(screen.getByLabelText("Document storage")).toHaveTextContent(
      "Current database (default)",
    );
    expect(screen.getByLabelText("Results to export")).toHaveTextContent(
      "Filtered hosts (1)",
    );
    fireEvent.change(screen.getByLabelText("Document name"), {
      target: { value: "Routers audit" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Document folder" }));
    fireEvent.change(screen.getByPlaceholderText("Search folders…"), {
      target: { value: "south servers" },
    });
    expect(
      screen.queryByRole("option", { name: "North / Servers" }),
    ).toBeNull();
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "South / Servers" }),
    );
    save();
    await waitFor(() =>
      expect(mocks.context.documents!.compareAndSwap).toHaveBeenCalledOnce(),
    );
    expect(screen.queryByRole("button", { name: "Open document" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    await act(async () => {
      durability.resolve();
    });
    expect(
      await screen.findByRole("button", { name: "Open document" }),
    ).toHaveClass("sor-btn", "sor-btn-primary");
    expect(saved.documents[0]).toMatchObject({
      name: "Routers audit",
      icon: "file-spreadsheet",
      parentFolderId: "south-servers",
    });
    const block = saved.documents[0].blocks[0];
    if (block.type !== "spreadsheet") throw Error("Expected spreadsheet");
    expect(block.workbook.sheets[1].rows).toBe(2);
    expect(block.workbook.sheets[1].cells.A2.value).toBe("192.0.2.11");
    fireEvent.click(screen.getByRole("button", { name: "Open document" }));
    expect(mocks.open).toHaveBeenCalledWith({
      scope: "database",
      documentId: saved.documents[0].id,
    });
    expect(mocks.activateArgument).toHaveBeenCalledWith(activate);
    expect(close).toHaveBeenCalledOnce();
  });
  it("can choose all hosts and app storage without database folders or database policy", async () => {
    mocks.settings.documentTypes.disabled = ["spreadsheet"];
    mount();
    expect(
      screen.getByRole("button", { name: "Save spreadsheet" }),
    ).toBeDisabled();
    choose("Document storage", "App-wide");
    choose("Results to export", "All hosts (2)");
    const folder = screen.getByRole("combobox", { name: "Document folder" });
    expect(folder).toBeDisabled();
    expect(folder).toHaveTextContent("App-wide root");
    expect(screen.queryByText(/North|South/)).toBeNull();
    save();
    await screen.findByRole("button", { name: "Open document" });
    expect(appSaved.documents[0].parentFolderId).toBeNull();
    const block = appSaved.documents[0].blocks[0];
    if (block.type !== "spreadsheet") throw Error("Expected spreadsheet");
    expect(block.workbook.sheets[1].rows).toBe(3);
    expect(mocks.context.documents!.read).not.toHaveBeenCalled();
    expect(mocks.context.databaseSettings!.read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open document" }));
    expect(mocks.open).toHaveBeenCalledWith({
      scope: "app",
      documentId: appSaved.documents[0].id,
    });
  });
  it("blocks pending drafts and focuses Documents without replacing its selection", () => {
    const unregister = registerDocumentDraft("draft", () => ({
      databaseId: "db-a",
      dirty: true,
      busy: false,
      revision: 1,
    }));
    try {
      mount();
      expect(
        screen.getByRole("button", { name: "Save spreadsheet" }),
      ).toBeDisabled();
      fireEvent.click(
        screen.getByRole("button", { name: "Open Documents to resolve draft" }),
      );
      expect(mocks.open).toHaveBeenCalledWith({ scope: "database" });
      expect(mocks.context.documents!.read).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });
  it("rechecks a new unsaved draft before opening a saved document", async () => {
    mount();
    save();
    const button = await screen.findByRole("button", { name: "Open document" });
    const unregister = registerDocumentDraft("late-draft", () => ({
      databaseId: "db-a",
      dirty: true,
      busy: false,
      revision: 1,
    }));
    try {
      fireEvent.click(button);
      expect(mocks.open).not.toHaveBeenCalled();
      expect(
        screen
          .getAllByRole("alert")
          .some((entry) => entry.textContent?.includes("unsaved changes")),
      ).toBe(true);
    } finally {
      unregister();
    }
  });
  it.each(["switch", "lock", "reopen"])(
    "invalidates an open dialog on database %s, even when the database is restored",
    (change) => {
      const { rerender, props } = mount();
      const availability = { ...mocks.context.databaseAvailability! };
      mocks.context.databaseAvailability =
        change === "lock"
          ? { ...availability, status: "suspended" }
          : {
              ...availability,
              databaseId: change === "switch" ? "db-b" : "db-a",
              generation: 2,
            };
      rerender(<DiscoverySpreadsheetDialog {...props} />);
      expect(
        screen.getByText(
          "Storage changed or locked. Close this export and reopen it.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Save spreadsheet" }),
      ).toBeDisabled();
      mocks.context.databaseAvailability = availability;
      rerender(<DiscoverySpreadsheetDialog {...props} />);
      expect(
        screen.getByRole("button", { name: "Save spreadsheet" }),
      ).toBeDisabled();
      expect(mocks.context.documents!.compareAndSwap).not.toHaveBeenCalled();
    },
  );
  it.each(["unmount", "switch", "folder removed"])(
    "prevents a save after an async read when %s occurs",
    async (change) => {
      const pending = deferred<DatabaseDocuments>();
      mocks.context.documents!.read = vi.fn(() => pending.promise);
      const { rerender, props, unmount } = mount();
      choose("Document folder", "South / Servers");
      save();
      if (change === "unmount") unmount();
      else {
        if (change === "switch")
          mocks.context.databaseAvailability = {
            databaseId: "db-b",
            status: "ready",
            generation: 2,
          };
        else mocks.context.state.connections = [];
        rerender(<DiscoverySpreadsheetDialog {...props} />);
      }
      await act(async () => {
        pending.resolve(emptyDatabaseDocuments());
      });
      expect(mocks.context.documents!.compareAndSwap).not.toHaveBeenCalled();
      expect(mocks.open).not.toHaveBeenCalled();
    },
  );
  it("invalidates app exports during app lock and never shows a stale success", async () => {
    const pending = deferred<void>();
    mocks.app!.compareAndSwap = vi.fn(() => pending.promise);
    const { props, rerender } = mount();
    choose("Document storage", "App-wide");
    save();
    await waitFor(() =>
      expect(mocks.app!.compareAndSwap).toHaveBeenCalledOnce(),
    );
    mocks.app = undefined;
    rerender(<DiscoverySpreadsheetDialog {...props} />);
    await act(async () => {
      pending.resolve();
    });
    expect(screen.queryByRole("button", { name: "Open document" })).toBeNull();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("rechecks policy at save time and presents CAS errors without opening or retrying", async () => {
    mocks.context.databaseSettings!.read = vi.fn(
      async (): Promise<DatabaseSettings> => ({
        version: 1,
        documentTypes: { disabled: ["spreadsheet"] },
      }),
    );
    mount();
    save();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Spreadsheets are disabled",
      ),
    );
    expect(mocks.context.documents!.compareAndSwap).not.toHaveBeenCalled();
    mocks.context.databaseSettings!.read = vi.fn(async () => mocks.settings);
    mocks.context.documents!.compareAndSwap = vi.fn(async () => {
      throw Error("Storage full");
    });
    save();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Storage full"),
    );
    expect(mocks.context.documents!.compareAndSwap).toHaveBeenCalledOnce();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("keeps saves unavailable while database policy is loading or storage is absent", () => {
    mocks.policyLoading = true;
    const { props, rerender } = mount();
    expect(
      screen.getByRole("button", { name: "Save spreadsheet" }),
    ).toBeDisabled();
    mocks.context.documents = undefined;
    rerender(<DiscoverySpreadsheetDialog {...props} />);
    expect(
      screen.getByRole("button", { name: "Save spreadsheet" }),
    ).toBeDisabled();
  });
});
